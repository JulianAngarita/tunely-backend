import { Response, NextFunction } from 'express';
import supabase from '../config/supabase';
import { ok, notFound } from '../utils/response';
import { AuthRequest } from '../types';

export const getMe = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user!.id;

    // 1. Datos del usuario
    const { data: user, error } = await supabase
      .from('users')
      .select('id, name, email, avatar_url, created_at, preferred_platform')
      .eq('id', userId)
      .single();

    if (error || !user) { notFound(res, 'User not found'); return; }

    // 2. Playlists del usuario para la subquery de colaboradores
    const { data: userPlaylists } = await supabase
      .from('playlist_members')
      .select('playlist_id')
      .eq('user_id', userId);

    const playlistIds = (userPlaylists ?? []).map((r) => r.playlist_id as string);

    // 3. Stats en paralelo
    const [playlistsRes, songsRes, collaboratorsRes] = await Promise.all([
      supabase
        .from('playlist_members')
        .select('*', { count: 'exact', head: true })  // ← head: true
        .eq('user_id', userId),

      supabase
        .from('playlist_songs')
        .select('*', { count: 'exact', head: true })  // ← head: true
        .eq('added_by', userId),

      playlistIds.length > 0
        ? supabase
          .from('playlist_members')
          .select('user_id')
          .in('playlist_id', playlistIds)
          .neq('user_id', userId)
        : Promise.resolve({ data: [] }),
    ]);

    const uniqueCollaborators = new Set(
      (collaboratorsRes.data ?? []).map((r) => r.user_id as string)
    ).size;

    ok(res, {
      user: {
        ...user,
        preferredPlatform: user.preferred_platform,
        playlistCount: playlistsRes.count ?? 0,
        songsAdded: songsRes.count ?? 0,
        collaborators: uniqueCollaborators,
      },
    });
  } catch (err) { next(err); }
};

export const getMyAccounts = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { data } = await supabase
      .from('connected_accounts')
      .select('provider, provider_user_id, expires_at, created_at')
      .eq('user_id', req.user!.id);
    ok(res, { accounts: data ?? [] });
  } catch (err) { next(err); }
};

export const getActivity = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user!.id;

    // Obtener IDs de playlists donde el usuario es miembro
    const { data: memberships } = await supabase
      .from('playlist_members')
      .select('playlist_id')
      .eq('user_id', userId);

    const playlistIds = (memberships ?? []).map((m) => m.playlist_id as string);

    if (!playlistIds.length) {
      ok(res, { activity: [] });
      return;
    }

    // Obtener actividad de todas esas playlists
    const { data, error } = await supabase
      .from('activity_log')
      .select(`
        id, action, details, created_at, user_id, playlist_id,
        users(id, name, avatar_url),
        playlists(id, name)
      `)
      .in('playlist_id', playlistIds)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw error;

    ok(res, { activity: data ?? [] });
  } catch (err) { next(err); }
};
