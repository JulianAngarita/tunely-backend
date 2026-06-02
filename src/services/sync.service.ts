import supabase from '../config/supabase';
import * as spotifyService from './spotify.service';
import * as youtubeService from './youtube.service';
import { rankCandidates, AUTO_MATCH_THRESHOLD } from './matching.service';
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
  // 1. Upsert song
  const { data: song, error: songError } = await supabase
    .from('songs')
    .upsert(
      {
        title:            songData.title,
        artist:           songData.artist,
        album:            songData.album ?? null,
        duration_ms:      songData.duration_ms ?? null,
        spotify_track_id: songData.spotify_track_id ?? null,
        youtube_video_id: songData.youtube_video_id ?? null,
      },
      { onConflict: 'spotify_track_id' }
    )
    .select()
    .single();

  if (songError) throw songError;

  // 2. Insert into playlist_songs
  const { error: psError } = await supabase
    .from('playlist_songs')
    .upsert({ playlist_id: playlistId, song_id: song.id, added_by: userId });
  if (psError) throw psError;

  // 3. Log activity
  await supabase.from('activity_log').insert({
    playlist_id: playlistId,
    user_id:     userId,
    action:      'song_added',
    details:     { song_id: song.id, title: song.title, artist: song.artist },
  });

  // 4. Check existing mapping
  const { data: mapping } = await supabase
    .from('song_mappings')
    .select('*')
    .or(
      `spotify_track_id.eq.${song.spotify_track_id ?? 'null'},` +
      `youtube_video_id.eq.${song.youtube_video_id ?? 'null'}`
    )
    .single();

  if (mapping) {
    await enqueueSync(song.id, playlistId, ['spotify', 'youtube']);
    return { song, matchStatus: 'auto', mapping };
  }

  // 5. Run matching engine
  const matchResult = await findMatch(song as Song, userId);

  if (matchResult.autoMatch && matchResult.best) {
    await saveMapping(song as Song, matchResult.best, false);
    await enqueueSync(song.id, playlistId, ['spotify', 'youtube']);
    return { song, matchStatus: 'auto', match: matchResult.best };
  }

  return {
    song,
    matchStatus:  'pending_confirmation',
    suggestions:  matchResult.suggestions,
  };
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
    match_score:       match.score ?? 0,
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
    song_id:    songId,
    playlist_id: playlistId,
    platform,
    status:     'pending',
  }));
  await supabase.from('sync_queue').insert(rows);
};

// ─── PROCESS QUEUE (called by scheduler) ──────────────────────

export const processQueue = async (): Promise<void> => {
  const { data: items } = await supabase
    .from('sync_queue')
    .select('*, songs(*), playlists(owner_id)')
    .eq('status', 'pending')
    .lte('retry_count', 3)
    .limit(20);

  if (!items?.length) return;

  for (const item of items) {
    await supabase
      .from('sync_queue')
      .update({ status: 'processing' })
      .eq('id', item.id);

    try {
      const ownerId = item.playlists?.owner_id as string;

      if (item.platform === 'spotify' && item.songs?.spotify_track_id) {
        // TODO: obtener o crear playlist espejo en Spotify y agregar track
        logger.info(`[Sync] Spotify ← song ${item.song_id}`);
      } else if (item.platform === 'youtube' && item.songs?.youtube_video_id) {
        // TODO: obtener o crear playlist espejo en YouTube y agregar video
        logger.info(`[Sync] YouTube ← song ${item.song_id}`);
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
        logger.error(`[Sync] Permanently failed item ${item.id}: ${(err as Error).message}`);
        // Registrar conflicto
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
