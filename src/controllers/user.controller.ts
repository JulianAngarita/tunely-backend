import { Response, NextFunction } from 'express';
import supabase from '../config/supabase';
import { ok, notFound } from '../utils/response';
import { AuthRequest } from '../types';

export const getMe = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('id, name, email, avatar_url, created_at')
      .eq('id', req.user!.id)
      .single();
    if (error || !data) { notFound(res, 'User not found'); return; }
    ok(res, { user: data });
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
    const { data } = await supabase
      .from('activity_log')
      .select(`
        id, action, details, created_at,
        users!user_id(id, name, avatar_url),
        playlists!playlist_id(id, name)
      `)
      .eq('user_id', req.user!.id)
      .order('created_at', { ascending: false })
      .limit(50);
    ok(res, { activity: data ?? [] });
  } catch (err) { next(err); }
};
