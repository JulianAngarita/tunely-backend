import axios from 'axios';
import supabase from '../config/supabase';
import env from '../config/env';
import { encrypt, decrypt } from '../utils/crypto';
import { TrackCandidate } from '../types';
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

  return access_token;
};

export const searchTracks = async (userId: string, query: string, limit = 5): Promise<TrackCandidate[]> => {
  const token = await getValidToken(userId);
  const res = await axios.get<{ tracks: { items: SpotifyTrack[] } }>(
    'https://api.spotify.com/v1/search',
    { params: { q: query, type: 'track', limit }, headers: { Authorization: `Bearer ${token}` } }
  );
  return res.data.tracks.items.map((t) => ({
    id:          t.id,
    title:       t.name,
    artist:      t.artists.map((a) => a.name).join(', '),
    album:       t.album.name,
    duration_ms: t.duration_ms,
    popularity:  t.popularity,
    cover_url:   t.album.images[0]?.url,
    platform:    'spotify' as const,
  }));
};

export const addTrackToPlaylist = async (userId: string, spotifyPlaylistId: string, trackId: string): Promise<void> => {
  const token = await getValidToken(userId);
  await axios.post(
    `https://api.spotify.com/v1/playlists/${spotifyPlaylistId}/tracks`,
    { uris: [`spotify:track:${trackId}`] },
    { headers: { Authorization: `Bearer ${token}` } }
  );
};

export const createPlaylist = async (userId: string, name: string, description = ''): Promise<string> => {
  const token = await getValidToken(userId);
  const meRes = await axios.get<{ id: string }>('https://api.spotify.com/v1/me', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const res = await axios.post<{ id: string }>(
    `https://api.spotify.com/v1/users/${meRes.data.id}/playlists`,
    { name, description, public: false },
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return res.data.id;
};
