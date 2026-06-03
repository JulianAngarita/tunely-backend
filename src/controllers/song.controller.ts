import { Response, NextFunction } from 'express';
import supabase from '../config/supabase';
import * as spotifyService from '../services/spotify.service';
import * as youtubeService from '../services/youtube.service';
import { ok } from '../utils/response';
import { AuthRequest } from '../types';

/**
 * Búsqueda unificada — busca en Spotify y YouTube simultáneamente
 * y devuelve los resultados combinados.
 */
export const search = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { q } = req.query as { q: string };
    if (!q) { ok(res, { spotify: [], youtube: [] }); return; }

    const [spotifyResults, youtubeResults] = await Promise.allSettled([
      spotifyService.searchTracks(req.user!.id, q),  // ← token del usuario
      youtubeService.searchVideosPublic(q),            // ← API Key pública
    ]);

    ok(res, {
      spotify: spotifyResults.status === 'fulfilled' ? spotifyResults.value : [],
      youtube: youtubeResults.status === 'fulfilled' ? youtubeResults.value : [],
    });
  } catch (err) { next(err); }
};

/**
 * Canciones de una playlist específica
 */
export const getPlaylistSongs = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { data } = await supabase
      .from('playlist_songs')
      .select(`
        id, position, added_at,
        songs(id, title, artist, album, duration_ms, availability_status,
              spotify_track_id, youtube_video_id),
        users!added_by(id, name, avatar_url)
      `)
      .eq('playlist_id', req.params.playlistId)
      .order('position', { ascending: true });

    ok(res, { songs: data ?? [] });
  } catch (err) { next(err); }
};

/**
 * Eliminar canción de una playlist
 */
export const removeSong = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { playlistId, songId } = req.params;

    await supabase
      .from('playlist_songs')
      .delete()
      .eq('playlist_id', playlistId)
      .eq('song_id', songId);

    await supabase.from('activity_log').insert({
      playlist_id: playlistId,
      user_id:     req.user!.id,
      action:      'song_removed',
      details:     { song_id: songId },
    });

    ok(res, {}, 'Song removed');
  } catch (err) { next(err); }
};

/**
 * Conflictos de una playlist (canciones no encontradas en alguna plataforma)
 */
export const getConflicts = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { data } = await supabase
      .from('song_conflicts')
      .select(`
        id, platform, conflict_type, resolved, created_at,
        songs(id, title, artist)
      `)
      .eq('playlist_id', req.params.playlistId)
      .eq('resolved', false)
      .order('created_at', { ascending: false });

    ok(res, { conflicts: data ?? [] });
  } catch (err) { next(err); }
};
