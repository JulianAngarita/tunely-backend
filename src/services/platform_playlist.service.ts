import supabase from '../config/supabase';
import * as spotifyService from './spotify.service';
import * as youtubeService from './youtube.service';
import logger from '../utils/logger';

/**
 * Crea las playlists espejo en las plataformas conectadas del usuario
 * y las registra en member_platform_playlists.
 */
export const createMemberPlatformPlaylists = async (
  playlistId: string,
  userId: string,
  playlistName: string,
  playlistDescription = ''
): Promise<void> => {
  // Obtener cuentas conectadas del usuario
  const { data: accounts } = await supabase
    .from('connected_accounts')
    .select('provider')
    .eq('user_id', userId);

  const providers = accounts?.map((a) => a.provider as string) ?? [];

  await Promise.all([
    providers.includes('spotify')
      ? _createSpotifyMirror(playlistId, userId, playlistName, playlistDescription)
      : Promise.resolve(),
    providers.includes('google')
      ? _createYoutubeMirror(playlistId, userId, playlistName, playlistDescription)
      : Promise.resolve(),
  ]);
};

const _createSpotifyMirror = async (
  playlistId: string,
  userId: string,
  name: string,
  description: string
): Promise<void> => {
  try {
    // Verificar si ya existe
    const { data: existing } = await supabase
      .from('member_platform_playlists')
      .select('id')
      .eq('playlist_id', playlistId)
      .eq('user_id',     userId)
      .eq('provider',    'spotify')
      .single();

    if (existing) {
      logger.debug(`[Platform] Spotify mirror already exists for user ${userId}`);
      return;
    }

    const spotifyPlaylistId = await spotifyService.createPlaylist(
      userId, name, description
    );

    await supabase.from('member_platform_playlists').insert({
      playlist_id:          playlistId,
      user_id:              userId,
      provider:             'spotify',
      platform_playlist_id: spotifyPlaylistId,
    });

    logger.info(`[Platform] ✓ Spotify mirror created for user ${userId}: ${spotifyPlaylistId}`);
  } catch (err) {
    logger.warn(`[Platform] Could not create Spotify mirror for user ${userId}: ${(err as Error).message}`);
  }
};

const _createYoutubeMirror = async (
  playlistId: string,
  userId: string,
  name: string,
  description: string
): Promise<void> => {
  try {
    const { data: existing } = await supabase
      .from('member_platform_playlists')
      .select('id')
      .eq('playlist_id', playlistId)
      .eq('user_id',     userId)
      .eq('provider',    'google')
      .single();

    if (existing) {
      logger.debug(`[Platform] YouTube mirror already exists for user ${userId}`);
      return;
    }

    const youtubePlaylistId = await youtubeService.createPlaylist(
      userId, name, description
    );

    await supabase.from('member_platform_playlists').insert({
      playlist_id:          playlistId,
      user_id:              userId,
      provider:             'google',
      platform_playlist_id: youtubePlaylistId,
    });

    logger.info(`[Platform] ✓ YouTube mirror created for user ${userId}: ${youtubePlaylistId}`);
  } catch (err) {
    logger.warn(`[Platform] Could not create YouTube mirror for user ${userId}: ${(err as Error).message}`);
  }
};

/**
 * Obtiene todas las playlists espejo de una playlist tunely
 * agrupadas por usuario y plataforma.
 */
export const getMemberPlatformPlaylists = async (
  playlistId: string
): Promise<{ userId: string; provider: string; platformPlaylistId: string }[]> => {
  const { data } = await supabase
    .from('member_platform_playlists')
    .select('user_id, provider, platform_playlist_id')
    .eq('playlist_id', playlistId);

  return (data ?? []).map((row) => ({
    userId:             row.user_id           as string,
    provider:           row.provider          as string,
    platformPlaylistId: row.platform_playlist_id as string,
  }));
};
