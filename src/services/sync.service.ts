import supabase from '../config/supabase';
import * as spotifyService from './spotify.service';
import * as youtubeService from './youtube.service';
import { rankCandidates } from './matching.service';
import { getMemberPlatformPlaylists } from './platform_playlist.service';
import logger from '../utils/logger';
import {
  Song,
  SyncPlatform,
  AddSongPayload,
  SongCandidate,
  MatchResult,
} from '../types';

// ─── ADD SONG + TRIGGER SYNC ───────────────────────────────────

export const addSongToPlaylist = async ({
  playlistId,
  songData,
  userId,
}: AddSongPayload) => {

  // 1. Buscar canción existente o insertar nueva
  let song: any = null;

  if (songData.spotify_track_id) {
    const { data } = await supabase
      .from('songs')
      .select()
      .eq('spotify_track_id', songData.spotify_track_id)
      .single();
    song = data;
  } else if (songData.youtube_video_id) {
    const { data } = await supabase
      .from('songs')
      .select()
      .eq('youtube_video_id', songData.youtube_video_id)
      .single();
    song = data;
  }

  if (!song) {
    const { data, error } = await supabase
      .from('songs')
      .insert({
        title:            songData.title,
        artist:           songData.artist,
        album:            songData.album            ?? null,
        duration_ms:      songData.duration_ms      ?? null,
        spotify_track_id: songData.spotify_track_id ?? null,
        youtube_video_id: songData.youtube_video_id ?? null,
        cover_url:        songData.cover_url        ?? null,
      })
      .select()
      .single();
    if (error) throw error;
    song = data;
  }

  // 2. Agregar a playlist_songs
  const { error: psError } = await supabase
    .from('playlist_songs')
    .upsert(
      { playlist_id: playlistId, song_id: song.id, added_by: userId },
      { onConflict: 'playlist_id,song_id', ignoreDuplicates: true }
    );
  if (psError) throw psError;

  // 3. Log activity
  await supabase.from('activity_log').insert({
    playlist_id: playlistId,
    user_id:     userId,
    action:      'song_added',
    details:     { song_id: song.id, title: song.title, artist: song.artist },
  });

  // 4. Resolver IDs de ambas plataformas
  await Promise.all([
    _resolveSpotifyId(song, userId),
    _resolveYoutubeId(song),
  ]);

  // 5. Encolar sync para TODOS los miembros con playlists espejo
  await _enqueueSyncForAllMembers(song, playlistId);

  return { song, matchStatus: 'auto', suggestions: [] };
};

// ─── SYNC PARA TODOS LOS MIEMBROS ──────────────────────────────

const _enqueueSyncForAllMembers = async (
  song: any,
  playlistId: string
): Promise<void> => {
  const mirrors = await getMemberPlatformPlaylists(playlistId);

  if (!mirrors.length) {
    logger.warn(`[Sync] No platform mirrors found for playlist ${playlistId}`);
    return;
  }

  for (const mirror of mirrors) {
    const platform = mirror.provider === 'spotify' ? 'spotify' : 'youtube';
    const hasId    = platform === 'spotify'
      ? !!song.spotify_track_id
      : !!song.youtube_video_id;

    if (!hasId) {
      logger.warn(`[Sync] No ${platform} ID for song "${song.title as string}" — skipping member ${mirror.userId}`);
      continue;
    }

    // Verificar si ya existe en la queue para este usuario+playlist+plataforma
    const { data: existing } = await supabase
      .from('sync_queue')
      .select('id')
      .eq('song_id',     song.id)
      .eq('playlist_id', playlistId)
      .eq('platform',    platform)
      .eq('user_id',     mirror.userId)
      .in('status',      ['pending', 'processing'])
      .limit(1);

    if (existing && existing.length > 0) {
      logger.debug(`[Queue] Skipping duplicate: ${platform} song=${song.id as string} user=${mirror.userId}`);
      continue;
    }

    await supabase.from('sync_queue').insert({
      song_id:              song.id,
      playlist_id:          playlistId,
      platform,
      user_id:              mirror.userId,
      platform_playlist_id: mirror.platformPlaylistId,
      status:               'pending',
    });

    logger.info(`[Queue] Enqueued ${platform} sync for user ${mirror.userId}`);
  }
};

// ─── HELPERS ───────────────────────────────────────────────────

const _cleanYoutubeTitle = (title: string): string => {
  return title
    .replace(/^[^-]+-\s*/, '')
    .replace(/\(official\s*(music\s*)?(video|audio|lyric.*|visualizer)\)/gi, '')
    .replace(/\[official\s*(music\s*)?(video|audio|lyric.*|visualizer)\]/gi, '')
    .replace(/\(.*?(lyrics?|lyric video|hd|4k|remaster.*|video oficial)\)/gi, '')
    .replace(/\[.*?(lyrics?|lyric video|hd|4k|remaster.*|video oficial)\]/gi, '')
    .replace(/official\s*(music\s*)?(video|audio)/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
};

const _cleanYoutubeArtist = (artist: string): string => {
  return artist
    .replace(/\s*-\s*Topic$/i, '')
    .replace(/VEVO$/i, '')
    .replace(/Official$/i, '')
    .trim();
};

const _resolveSpotifyId = async (song: any, userId: string): Promise<string | null> => {
  if (song.spotify_track_id) return song.spotify_track_id as string;

  logger.info(`[Sync] Finding Spotify match for "${song.title as string}"...`);
  try {
    const cleanTitle  = _cleanYoutubeTitle(song.title as string);
    const cleanArtist = _cleanYoutubeArtist(song.artist as string);
    const query       = `${cleanTitle} ${cleanArtist}`.trim();

    const results = process.env.NODE_ENV === 'production'
      ? await spotifyService.searchTracksPublic(query)
      : await spotifyService.searchTracks(userId, query);

    const match = rankCandidates(
      { ...song, title: cleanTitle, artist: cleanArtist } as Song,
      results.map((r: any) => ({ ...r, platform: 'spotify' as SyncPlatform }))
    );

    if (match.best) {
      await saveMapping(song as Song, match.best, false);
      await supabase.from('songs').update({ spotify_track_id: match.best.id }).eq('id', song.id);
      song.spotify_track_id = match.best.id;
      logger.info(`[Sync] ✓ Spotify match (score=${match.best.score}): "${match.best.title}"`);
      return match.best.id;
    }

    logger.warn(`[Sync] No Spotify results for "${song.title as string}"`);
    return null;
  } catch (err) {
    logger.warn(`[Sync] Spotify search failed: ${(err as Error).message}`);
    return null;
  }
};

const _resolveYoutubeId = async (song: any): Promise<string | null> => {
  if (song.youtube_video_id) return song.youtube_video_id as string;

  logger.info(`[Sync] Finding YouTube match for "${song.title as string}"...`);
  try {
    const cleanTitle  = _cleanYoutubeTitle(song.title as string);
    const cleanArtist = _cleanYoutubeArtist(song.artist as string);
    const query       = `${cleanTitle} ${cleanArtist}`.trim();

    const results = await youtubeService.searchVideosPublic(query);
    const match   = rankCandidates(
      { ...song, title: cleanTitle, artist: cleanArtist } as Song,
      results.map((r: any) => ({ ...r, platform: 'youtube' as SyncPlatform }))
    );

    if (match.best) {
      await saveMapping(song as Song, match.best, false);
      await supabase.from('songs').update({ youtube_video_id: match.best.id }).eq('id', song.id);
      song.youtube_video_id = match.best.id;
      logger.info(`[Sync] ✓ YouTube match (score=${match.best.score}): "${match.best.title}"`);
      return match.best.id;
    }

    logger.warn(`[Sync] No YouTube results for "${song.title as string}"`);
    return null;
  } catch (err) {
    logger.warn(`[Sync] YouTube search failed: ${(err as Error).message}`);
    return null;
  }
};

// ─── FIND MATCH ────────────────────────────────────────────────

export const findMatch = async (
  song: Song,
  userId: string
): Promise<MatchResult> => {
  const query      = `${song.title} ${song.artist}`;
  let candidates: SongCandidate[] = [];

  try {
    if (song.spotify_track_id) {
      const results = await youtubeService.searchVideos(userId, query);
      candidates    = results.map((r) => ({ ...r, platform: 'youtube' as SyncPlatform }));
    } else if (song.youtube_video_id) {
      const results = await spotifyService.searchTracks(userId, query);
      candidates    = results.map((r) => ({ ...r, platform: 'spotify' as SyncPlatform }));
    }
  } catch (err) {
    logger.warn(`Match search failed for song ${song.id}: ${(err as Error).message}`);
  }

  return rankCandidates(song, candidates);
};

// ─── SAVE MAPPING ──────────────────────────────────────────────

export const saveMapping = async (
  song: Song,
  match: SongCandidate,
  confirmedByUser: boolean
): Promise<void> => {
  const mappingData: Record<string, unknown> = {
    confirmed_by_user: confirmedByUser,
    match_score:       match.score ?? 0,
  };

  if (match.platform === 'youtube') {
    mappingData.spotify_track_id = song.spotify_track_id;
    mappingData.youtube_video_id = match.id;
    await supabase.from('songs').update({ youtube_video_id: match.id }).eq('id', song.id);
  } else {
    mappingData.youtube_video_id = song.youtube_video_id;
    mappingData.spotify_track_id = match.id;
    await supabase.from('songs').update({ spotify_track_id: match.id }).eq('id', song.id);
  }

  await supabase.from('song_mappings').upsert(mappingData);
};

// ─── ENQUEUE SYNC (legacy — kept for confirmMatch) ─────────────

export const enqueueSync = async (
  songId: string,
  playlistId: string,
  platforms: SyncPlatform[]
): Promise<void> => {
  // Obtener mirrors y encolar para cada miembro
  const mirrors = await getMemberPlatformPlaylists(playlistId);

  for (const platform of platforms) {
    const relevantMirrors = mirrors.filter((m) =>
      (platform === 'spotify' && m.provider === 'spotify') ||
      (platform === 'youtube' && m.provider === 'google')
    );

    for (const mirror of relevantMirrors) {
      const { data: existing } = await supabase
        .from('sync_queue')
        .select('id')
        .eq('song_id',     songId)
        .eq('playlist_id', playlistId)
        .eq('platform',    platform)
        .eq('user_id',     mirror.userId)
        .in('status',      ['pending', 'processing'])
        .limit(1);

      if (existing && existing.length > 0) continue;

      await supabase.from('sync_queue').insert({
        song_id:              songId,
        playlist_id:          playlistId,
        platform,
        user_id:              mirror.userId,
        platform_playlist_id: mirror.platformPlaylistId,
        status:               'pending',
      });
    }
  }
};

// ─── PROCESS QUEUE ─────────────────────────────────────────────

export const processQueue = async (): Promise<void> => {
  const { data: items } = await supabase
    .from('sync_queue')
    .select('*, songs(*)')
    .eq('status', 'pending')
    .lte('retry_count', 3)
    .limit(20);

  if (!items?.length) {
    logger.debug('[Queue] No pending items');
    return;
  }

  logger.info(`[Queue] Processing ${items.length} items`);

  for (const item of items) {
    // Ahora usamos user_id y platform_playlist_id directamente del item
    const userId             = item.user_id              as string;
    const platformPlaylistId = item.platform_playlist_id as string;

    logger.info(
      `[Queue] platform=${item.platform as string}, ` +
      `song="${item.songs?.title as string}", ` +
      `user=${userId}, ` +
      `platformPlaylistId=${platformPlaylistId}`
    );

    await supabase.from('sync_queue').update({ status: 'processing' }).eq('id', item.id);

    try {
      if (item.platform === 'spotify') {
        const spotifyTrackId = item.songs?.spotify_track_id as string | null;
        if (!spotifyTrackId)    throw new Error('No Spotify track ID');
        if (!platformPlaylistId) throw new Error('No Spotify playlist ID');
        await spotifyService.addTrackToPlaylist(userId, platformPlaylistId, spotifyTrackId);
        logger.info(`[Sync] ✓ Spotify ← "${item.songs?.title as string}" for user ${userId}`);

      } else if (item.platform === 'youtube') {
        const youtubeVideoId = item.songs?.youtube_video_id as string | null;
        if (!youtubeVideoId)     throw new Error('No YouTube video ID');
        if (!platformPlaylistId) throw new Error('No YouTube playlist ID');
        await youtubeService.addVideoToPlaylist(userId, platformPlaylistId, youtubeVideoId);
        logger.info(`[Sync] ✓ YouTube ← "${item.songs?.title as string}" for user ${userId}`);
      }

      await supabase
        .from('sync_queue')
        .update({ status: 'done', updated_at: new Date().toISOString() })
        .eq('id', item.id);

    } catch (err) {
      const newRetry = (item.retry_count as number) + 1;
      const isFinal  = newRetry >= 3;

      await supabase.from('sync_queue').update({
        status:        isFinal ? 'failed' : 'pending',
        retry_count:   newRetry,
        error_message: (err as Error).message,
        updated_at:    new Date().toISOString(),
      }).eq('id', item.id);

      if (isFinal) {
        logger.error(`[Sync] ✗ Failed ${item.id as string}: ${(err as Error).message}`);
        await supabase.from('song_conflicts').insert({
          song_id:       item.song_id,
          playlist_id:   item.playlist_id,
          platform:      item.platform,
          conflict_type: 'not_available',
        });
      }
    }
  }
};
