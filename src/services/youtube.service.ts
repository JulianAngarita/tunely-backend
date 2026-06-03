import axios from 'axios';
import supabase from '../config/supabase';
import {env} from '../config/env';
import { encrypt, decrypt } from '../utils/crypto';
import { SongCandidate } from '../types';
import logger from '../utils/logger';

interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
}

export const getValidToken = async (userId: string): Promise<string> => {
  
  const { data: account } = await supabase
    .from('connected_accounts')
    .select('access_token, refresh_token, expires_at')
    .eq('user_id', userId)
    .eq('provider', 'google')
    .single();

  if (!account) throw Object.assign(new Error('YouTube account not connected'), { status: 400 });

   logger.info(`YouTube token expires_at: ${account.expires_at as string}`);
  logger.info(`YouTube token is expired: ${new Date(account.expires_at as string) <= new Date(Date.now() + 60_000)}`);

  const isExpired = new Date(account.expires_at) <= new Date(Date.now() + 60_000);
  if (!isExpired) return decrypt(account.access_token as string);

  logger.debug(`Refreshing Google token for user ${userId}`);
  const res = await axios.post<GoogleTokenResponse>('https://oauth2.googleapis.com/token', {
    client_id:     env.google.clientId,
    client_secret: env.google.clientSecret,
    refresh_token: decrypt(account.refresh_token as string),
    grant_type:    'refresh_token',
  });

  const { access_token, expires_in } = res.data;
  await supabase
    .from('connected_accounts')
    .update({ access_token: encrypt(access_token), expires_at: new Date(Date.now() + expires_in * 1000).toISOString() })
    .eq('user_id', userId)
    .eq('provider', 'google');

  return access_token;
};

interface YouTubeSearchItem {
  id: { videoId: string };
  snippet: { title: string; channelTitle: string; thumbnails: { medium: { url: string } } };
}

export const searchVideos = async (userId: string, query: string, limit = 5): Promise<SongCandidate[]> => {
  const token = await getValidToken(userId);
  const res = await axios.get<{ items: YouTubeSearchItem[] }>(
    'https://www.googleapis.com/youtube/v3/search',
    {
      params: { part: 'snippet', q: query, type: 'video', videoCategoryId: '10', maxResults: limit },
      headers: { Authorization: `Bearer ${token}` },
    }
  );
  return res.data.items.map((item) => ({
    id:        item.id.videoId,
    title:     item.snippet.title,
    artist:    item.snippet.channelTitle,
    cover_url: item.snippet.thumbnails?.medium?.url,
    platform:  'youtube' as const,
  }));
};

export const addVideoToPlaylist = async (userId: string, youtubePlaylistId: string, videoId: string): Promise<void> => {
  const token = await getValidToken(userId);
  await axios.post(
    'https://www.googleapis.com/youtube/v3/playlistItems?part=snippet',
    { snippet: { playlistId: youtubePlaylistId, resourceId: { kind: 'youtube#video', videoId } } },
    { headers: { Authorization: `Bearer ${token}` } }
  );
};

export const createPlaylist = async (userId: string, name: string, description = '') => {
  const token = await getValidToken(userId);
  logger.info(`YouTube createPlaylist - token preview: ${token.substring(0, 30)}...`);
  try {
    const res = await axios.post(
      'https://www.googleapis.com/youtube/v3/playlists?part=snippet,status',
      { snippet: { title: name, description }, status: { privacyStatus: 'private' } },
      { headers: { Authorization: `Bearer ${token}` } }
    );
    return res.data.id;
  } catch (err) {
    if (axios.isAxiosError(err)) {
      logger.error(`YouTube createPlaylist error: ${JSON.stringify(err.response?.data)}`);
    }
    throw err;
  }
};

// Búsqueda pública con API Key — no requiere usuario autenticado
export const searchVideosPublic = async (query: string, limit = 5) => {
  const res = await axios.get('https://www.googleapis.com/youtube/v3/search', {
    params: {
      part: 'snippet',
      q: query,
      type: 'video',
      videoCategoryId: '10', // Music
      maxResults: limit,
      key: env.google.apiKey,
    },
  });
  return res.data.items.map((item: any) => ({
    id:        item.id.videoId,
    title:     item.snippet.title,
    artist:    item.snippet.channelTitle,
    cover_url: item.snippet.thumbnails?.medium?.url,
  }));
};