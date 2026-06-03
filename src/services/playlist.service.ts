import supabase from '../config/supabase';
import { MemberRole, Playlist, PlaylistMember } from '../types';
import * as youtubeService from './youtube.service';
import * as spotifyService from './spotify.service';
interface CreatePlaylistInput {
  name: string;
  description?: string;
  isPublic?: boolean;
  coverUrl?: string;
  ownerId: string;
  coverGradientIndex?: number;  // ← nuevo
}

export const create = async (input: CreatePlaylistInput): Promise<Playlist> => {
  // Crear en BD
  const { data: playlist, error } = await supabase
  .from('playlists')
  .insert({
    name: input.name,
    description: input.description,
    is_public: input.isPublic ?? false,
    cover_url: input.coverUrl,
    owner_id: input.ownerId,
    cover_gradient_index: input.coverGradientIndex ?? 0,
  }).select().single();

  if (error || !playlist) throw error ?? new Error('Failed to create playlist');

  await supabase.from('playlist_members').insert({
    playlist_id: playlist.id, user_id: input.ownerId, role: 'owner',
  });

  // Verificar cuentas conectadas
  const { data: accounts } = await supabase
    .from('connected_accounts')
    .select('provider')
    .eq('user_id', input.ownerId);

  const providers = accounts?.map((a) => a.provider) ?? [];

  // Crear en Spotify si está conectado
  if (providers.includes('spotify')) {
    try {
      const spotifyPlaylistId = await spotifyService.createPlaylist(
        input.ownerId, input.name, input.description ?? '',
      );
      await supabase
        .from('playlists')
        .update({ spotify_playlist_id: spotifyPlaylistId })
        .eq('id', playlist.id);
    } catch (err) {
      console.warn(`Could not create Spotify playlist: ${(err as Error).message}`);
      // No falla — la playlist en BD ya fue creada
    }
  }

  // Crear en YouTube si está conectado
  if (providers.includes('google')) {
    try {
      const youtubePlaylistId = await youtubeService.createPlaylist(
        input.ownerId, input.name, input.description ?? '',
      );
      await supabase
        .from('playlists')
        .update({ youtube_playlist_id: youtubePlaylistId })
        .eq('id', playlist.id);
    } catch (err) {
      console.warn(`Could not create YouTube playlist: ${(err as Error).message}`);
    }
  }

  return playlist as Playlist;
};

export const getById = async (playlistId: string): Promise<Playlist | null> => {
  const { data, error } = await supabase
    .from('playlists')
    .select(`
      *,
      playlist_members(user_id, role, users(id, name, avatar_url)),
      playlist_songs(
        position, added_at,
        songs(id, title, artist, album, duration_ms, availability_status,
              spotify_track_id, youtube_video_id, cover_url),
        users!added_by(id, name, avatar_url)
      )
    `)
    .eq('id', playlistId)
    .single();

  if (error) return null;
  return data as Playlist;
};

export const update = async (playlistId: string, fields: Partial<Playlist>): Promise<Playlist> => {
  const allowed: (keyof Playlist)[] = ['name', 'description', 'is_public', 'cover_url'];
  const updates = Object.fromEntries(
    Object.entries(fields).filter(([k]) => allowed.includes(k as keyof Playlist))
  );
  updates['updated_at'] = new Date().toISOString();

  const { data, error } = await supabase
    .from('playlists')
    .update(updates)
    .eq('id', playlistId)
    .select()
    .single();

  if (error || !data) throw error ?? new Error('Failed to update playlist');
  return data as Playlist;
};

export const remove = async (playlistId: string): Promise<void> => {
  const { error } = await supabase.from('playlists').delete().eq('id', playlistId);
  if (error) throw error;
};

export const getUserPlaylists = async (userId: string) => {
  const { data, error } = await supabase
    .from('playlist_members')
    .select('role, playlists(*)')
    .eq('user_id', userId);
  if (error) throw error;
  return data ?? [];
};

export const getMembership = async (playlistId: string, userId: string): Promise<PlaylistMember | null> => {
  const { data } = await supabase
    .from('playlist_members')
    .select('playlist_id, user_id, role, joined_at')
    .eq('playlist_id', playlistId)
    .eq('user_id', userId)
    .single();
  return data as PlaylistMember | null;
};

export const joinByCode = async (inviteCode: string, userId: string): Promise<Playlist> => {
  const { data: playlist, error } = await supabase
    .from('playlists')
    .select('id')
    .eq('invite_code', inviteCode)
    .single();

  if (error || !playlist) throw Object.assign(new Error('Invalid invite code'), { status: 404 });

  await supabase.from('playlist_members').upsert(
    { playlist_id: playlist.id, user_id: userId, role: 'member' },
    { onConflict: 'playlist_id,user_id' }
  );

  return playlist as Playlist;
};

export const updateMemberRole = async (playlistId: string, targetUserId: string, role: MemberRole): Promise<void> => {
  const { error } = await supabase
    .from('playlist_members')
    .update({ role })
    .eq('playlist_id', playlistId)
    .eq('user_id', targetUserId);
  if (error) throw error;
};

export const removeMember = async (playlistId: string, targetUserId: string): Promise<void> => {
  const { error } = await supabase
    .from('playlist_members')
    .delete()
    .eq('playlist_id', playlistId)
    .eq('user_id', targetUserId);
  if (error) throw error;
};
