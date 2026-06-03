import axios from 'axios';
import supabase from '../config/supabase';
import {env} from '../config/env';
import { encrypt, decrypt } from '../utils/crypto';
import { SongCandidate } from '../types';
import logger from '../utils/logger';

interface SpotifyTokenResponse {
  access_token: string;
  expires_in: number;
}

interface SpotifyTrack {
  id: string;
  name: string;
  artists: { name: string }[];
  album: { name: string; images: { url: string }[] };
  duration_ms: number;
  popularity: number;
}

export const getValidToken = async (userId: string): Promise<string> => {
  const { data: account } = await supabase
    .from('connected_accounts')
    .select('access_token, refresh_token, expires_at')
    .eq('user_id', userId)
    .eq('provider', 'spotify')
    .single();

  if (!account) throw Object.assign(new Error('Spotify account not connected'), { status: 400 });

  const isExpired = new Date(account.expires_at) <= new Date(Date.now() + 60_000);
  if (!isExpired) return decrypt(account.access_token as string);

  logger.debug(`Refreshing Spotify token for user ${userId}`);
  const basicAuth = Buffer.from(`${env.spotify.clientId}:${env.spotify.clientSecret}`).toString('base64');
  const res = await axios.post<SpotifyTokenResponse>(
    'https://accounts.spotify.com/api/token',
    new URLSearchParams({ grant_type: 'refresh_token', refresh_token: decrypt(account.refresh_token as string) }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basicAuth}` } }
  );

  const { access_token, expires_in } = res.data;
  await supabase
    .from('connected_accounts')
    .update({ access_token: encrypt(access_token), expires_at: new Date(Date.now() + expires_in * 1000).toISOString() })
    .eq('user_id', userId)
    .eq('provider', 'spotify');


     // Verificar scopes del token
  try {
    const meRes = await axios.get('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    logger.info(`Spotify user: ${meRes.data.id as string}`);
    
    // Verificar si puede modificar playlists
    const testRes = await axios.get(
      `https://api.spotify.com/v1/me/playlists`,
      { headers: { Authorization: `Bearer ${access_token}` } }
    );
    logger.info(`Can read playlists: true, count: ${testRes.data.total as number}`);
  } catch (err) {
    logger.error(`Token validation failed: ${(err as Error).message}`);
  }
  
  return access_token;
};

export const searchTracks = async (userId: string, query: string, limit = 5): Promise<SongCandidate[]> => {
  const token = await getValidToken(userId);
  const res = await axios.get<{ tracks: { items: SpotifyTrack[] } }>(
    'https://api.spotify.com/v1/search',
    { params: { q: query, type: 'track', limit }, headers: { Authorization: `Bearer ${token}` } }
  );
  return res.data.tracks.items.map((t) => ({
    id: t.id,
    title: t.name,
    artist: t.artists.map((a) => a.name).join(', '),
    album: t.album.name,
    duration_ms:t.duration_ms,
    popularity: t.popularity,
    cover_url: t.album.images[0]?.url,
    platform: 'spotify' as const,
  }));
};

export const addTrackToPlaylist = async (userId: string, spotifyPlaylistId: string, spotifyTrackId: string) => {
  const token = await getValidToken(userId);
  console.log('token: ', token)
  try {
    await axios.post(
      `https://api.spotify.com/v1/playlists/${spotifyPlaylistId}/items`,
      { uris: [`spotify:track:${spotifyTrackId}`] },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    if (axios.isAxiosError(err)) {
      logger.error(`Spotify addTrack error: ${JSON.stringify(err.response?.data)}`);
    }
    throw err;
  }
};
export const createPlaylist = async (userId: string, name: string, description = '') => {
  const token = await getValidToken(userId);
  const res = await axios.post(
    `https://api.spotify.com/v1/me/playlists`, 
    { name, description, public: false },
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
  );
  return res.data.id;
};

// Token de app — no requiere usuario autenticado
export const getAppToken = async (): Promise<string> => {
  const basicAuth = Buffer.from(
    `${env.spotify.clientId}:${env.spotify.clientSecret}`
  ).toString('base64');

  const res = await axios.post<{ access_token: string }>(
    'https://accounts.spotify.com/api/token',
    new URLSearchParams({ grant_type: 'client_credentials' }),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization:  `Basic ${basicAuth}`,
      },
    }
  );
  return res.data.access_token;
};

// Búsqueda sin usuario — usa token de app
export const searchTracksPublic = async (query: string, limit = 5) => {
  const token = await getAppToken();
  const res   = await axios.get('https://api.spotify.com/v1/search', {
    params:  { q: query, type: 'track', limit },
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.data.tracks.items.map((t: any) => ({
    id: t.id,
    title: t.name,
    artist: t.artists.map((a: any) => a.name).join(', '),
    album: t.album.name,
    duration_ms: t.duration_ms,
    popularity: t.popularity,
    cover_url: t.album.images[0]?.url,
  }));
};