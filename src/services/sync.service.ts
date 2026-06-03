import supabase from '../config/supabase';
import * as spotifyService from './spotify.service';
import * as youtubeService from './youtube.service';
import { rankCandidates } from './matching.service';
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

  // 1. Upsert song en BD
  let existingSong = null;

  if (songData.spotify_track_id) {
    const { data } = await supabase
      .from('songs')
      .select()
      .eq('spotify_track_id', songData.spotify_track_id)
      .single();
    existingSong = data;
  } else if (songData.youtube_video_id) {
    const { data } = await supabase
      .from('songs')
      .select()
      .eq('youtube_video_id', songData.youtube_video_id)
      .single();
    existingSong = data;
  }

  let song;
  if (existingSong) {
    // Ya existe — usar el registro existente
    song = existingSong;
  } else {
    // No existe — insertar nuevo
    const { data, error } = await supabase
      .from('songs')
      .insert({
        title: songData.title,
        artist: songData.artist,
        album: songData.album ?? null,
        duration_ms: songData.duration_ms ?? null,
        spotify_track_id: songData.spotify_track_id ?? null,
        youtube_video_id: songData.youtube_video_id ?? null,
        cover_url: songData.cover_url ?? null,
      })
      .select()
      .single();
    if (error) throw error;
    song = data;
  }

  // 2. Agregar a playlist_songs
  const { error: psError } = await supabase
    .from('playlist_songs')
    .upsert({ playlist_id: playlistId, song_id: song.id, added_by: userId });
  if (psError) throw psError;

  // 3. Log activity
  await supabase.from('activity_log').insert({
    playlist_id: playlistId,
    user_id: userId,
    action: 'song_added',
    details: { song_id: song.id, title: song.title, artist: song.artist },
  });

  // 4. Obtener IDs de playlists espejo
  const { data: playlist } = await supabase
    .from('playlists')
    .select('spotify_playlist_id, youtube_playlist_id')
    .eq('id', playlistId)
    .single();

  const spotifyPlaylistId = playlist?.spotify_playlist_id as string | null;
  const youtubePlaylistId = playlist?.youtube_playlist_id as string | null;

  // 5. Resolver IDs
  const [spotifyResolved, youtubeResolved] = await Promise.all([
    spotifyPlaylistId ? _resolveSpotifyId(song, userId) : Promise.resolve(null),
    youtubePlaylistId ? _resolveYoutubeId(song)         : Promise.resolve(null),
  ]);

  // 6. Buscar sugerencias para plataformas sin match
  const suggestions: { platform: string; results: any[] }[] = [];

  if (spotifyPlaylistId && !spotifyResolved) {
    const cleanTitle  = _cleanYoutubeTitle(song.title as string);
    const cleanArtist = _cleanYoutubeArtist(song.artist as string);
    const results     = process.env.NODE_ENV === 'production'
      ? await spotifyService.searchTracksPublic(`${cleanTitle} ${cleanArtist}`)
      : await spotifyService.searchTracks(userId, `${cleanTitle} ${cleanArtist}`);
    suggestions.push({ platform: 'spotify', results: results.slice(0, 3) });
  }

  if (youtubePlaylistId && !youtubeResolved) {
    const results = await youtubeService.searchVideosPublic(
      `${song.title as string} ${song.artist as string}`
    );
    suggestions.push({ platform: 'youtube', results: results.slice(0, 3) });
  }

  // 7. Encolar sync para plataformas con match
  const platformsToSync: SyncPlatform[] = [
    ...(spotifyPlaylistId && spotifyResolved ? ['spotify'] as const : []),
    ...(youtubePlaylistId && youtubeResolved ? ['youtube'] as const : []),
  ];

  if (platformsToSync.length > 0) {
    await enqueueSync(song.id, playlistId, platformsToSync);
  }

  // 8. Devolver resultado con sugerencias si las hay
  return {
    song,
    matchStatus:  suggestions.length > 0 ? 'pending_confirmation' : 'auto',
    suggestions,
  };
};

// ─── HELPERS ───────────────────────────────────────────────────

const _cleanYoutubeTitle = (title: string): string => {
  return title
    .replace(/^[^-]+-\s*/, '')
    // Quitar sufijos comunes de videos de YouTube
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
    .replace(/\s*-\s*Topic$/i, '')  // quitar " - Topic" de canales de YouTube
    .replace(/VEVO$/i, '')           // quitar "VEVO" 
    .replace(/Official$/i, '')       // quitar "Official"
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

    if (match.autoMatch && match.best) {
      await saveMapping(song as Song, match.best, false);
      await supabase.from('songs').update({ spotify_track_id: match.best.id }).eq('id', song.id);
      song.spotify_track_id = match.best.id;
      logger.info(`[Sync] ✓ Spotify match: "${match.best.title}"`);
      return match.best.id;
    }

    // No hay match automático — devolver sugerencias
    logger.warn(`[Sync] No confident Spotify match, returning suggestions`);
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
    const results = await youtubeService.searchVideosPublic(
      `${song.title as string} ${song.artist as string}`
    );
    const match = rankCandidates(
      song as Song,
      results.map((r: any) => ({ ...r, platform: 'youtube' as SyncPlatform }))
    );

    if (match.autoMatch && match.best) {
      await saveMapping(song as Song, match.best, false);
      await supabase.from('songs').update({ youtube_video_id: match.best.id }).eq('id', song.id);
      song.youtube_video_id = match.best.id;
      logger.info(`[Sync] ✓ YouTube match: "${match.best.title}"`);
      return match.best.id;
    }

    logger.warn(`[Sync] No confident YouTube match, returning suggestions`);
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
  const query = `${song.title} ${song.artist}`;
  let candidates: SongCandidate[] = [];

  try {
    if (song.spotify_track_id) {
      const results = await youtubeService.searchVideos(userId, query);
      candidates = results.map((r) => ({ ...r, platform: 'youtube' as SyncPlatform }));
    } else if (song.youtube_video_id) {
      const results = await spotifyService.searchTracks(userId, query);
      candidates = results.map((r) => ({ ...r, platform: 'spotify' as SyncPlatform }));
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
    match_score: match.score ?? 0,
  };

  if (match.platform === 'youtube') {
    mappingData.spotify_track_id = song.spotify_track_id;
    mappingData.youtube_video_id = match.id;
    await supabase
      .from('songs')
      .update({ youtube_video_id: match.id })
      .eq('id', song.id);
  } else {
    mappingData.youtube_video_id = song.youtube_video_id;
    mappingData.spotify_track_id = match.id;
    await supabase
      .from('songs')
      .update({ spotify_track_id: match.id })
      .eq('id', song.id);
  }

  await supabase.from('song_mappings').upsert(mappingData);
};

// ─── ENQUEUE SYNC ──────────────────────────────────────────────

export const enqueueSync = async (
  songId: string,
  playlistId: string,
  platforms: SyncPlatform[]
): Promise<void> => {
  const rows = platforms.map((platform) => ({
    song_id: songId,
    playlist_id: playlistId,
    platform,
    status: 'pending',
  }));
  await supabase.from('sync_queue').insert(rows);
};

// ─── PROCESS QUEUE (called by scheduler) ──────────────────────

export const processQueue = async (): Promise<void> => {
  const { data: items } = await supabase
    .from('sync_queue')
    .select(`
      *,
      songs(*),
      playlists(owner_id, spotify_playlist_id, youtube_playlist_id)
    `)
    .eq('status', 'pending')
    .lte('retry_count', 3)
    .limit(20);

  if (!items?.length) {
    logger.debug('[Queue] No pending items');
    return;
  }

  logger.info(`[Queue] Processing ${items.length} items`);

  for (const item of items) {
    logger.info(`[Queue] Item: platform=${item.platform as string}, song="${item.songs?.title as string}", spotifyTrackId=${item.songs?.spotify_track_id as string}, spotifyPlaylistId=${item.playlists?.spotify_playlist_id as string}`);
    await supabase
      .from('sync_queue')
      .update({ status: 'processing' })
      .eq('id', item.id);

    try {
      const ownerId = item.playlists?.owner_id as string;
      const spotifyPlaylistId = item.playlists?.spotify_playlist_id as string | null;
      const youtubePlaylistId = item.playlists?.youtube_playlist_id as string | null;

      if (item.platform === 'spotify') {
        if (!spotifyPlaylistId) {
          throw new Error('No Spotify playlist ID — playlist was not created on Spotify');
        }
        const spotifyTrackId = item.songs?.spotify_track_id as string | null;
        if (!spotifyTrackId) {
          throw new Error('No Spotify track ID for this song');
        }
        await spotifyService.addTrackToPlaylist(ownerId, spotifyPlaylistId, spotifyTrackId);
        logger.info(`[Sync] ✓ Spotify ← "${item.songs?.title}" added to playlist`);

      } else if (item.platform === 'youtube') {
        if (!youtubePlaylistId) {
          throw new Error('No YouTube playlist ID — playlist was not created on YouTube');
        }
        const youtubeVideoId = item.songs?.youtube_video_id as string | null;
        if (!youtubeVideoId) {
          throw new Error('No YouTube video ID for this song');
        }
        await youtubeService.addVideoToPlaylist(ownerId, youtubePlaylistId, youtubeVideoId);
        logger.info(`[Sync] ✓ YouTube ← "${item.songs?.title}" added to playlist`);
      }

      await supabase
        .from('sync_queue')
        .update({ status: 'done', updated_at: new Date().toISOString() })
        .eq('id', item.id);

    } catch (err) {
      const newRetry = (item.retry_count as number) + 1;
      const isFinal = newRetry >= 3;

      await supabase.from('sync_queue').update({
        status: isFinal ? 'failed' : 'pending',
        retry_count: newRetry,
        error_message: (err as Error).message,
        updated_at: new Date().toISOString(),
      }).eq('id', item.id);

      if (isFinal) {
        logger.error(`[Sync] ✗ Permanently failed item ${item.id}: ${(err as Error).message}`);
        await supabase.from('song_conflicts').insert({
          song_id: item.song_id,
          playlist_id: item.playlist_id,
          platform: item.platform,
          conflict_type: 'not_available',
        });
      }
    }
  }
};