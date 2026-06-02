import { Response, NextFunction } from 'express';
import * as playlistService from '../services/playlist.service';
import { ok, created, notFound } from '../utils/response';
import { AuthRequest } from '../types';

export const create = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const playlist = await playlistService.create({
      ...req.body as object,
      ownerId: req.user!.id,
    });
    created(res, { playlist });
  } catch (err) { next(err); }
};

export const getOne = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const playlist = await playlistService.getById(req.params.id, req.user!.id);
    if (!playlist) { notFound(res); return; }
    ok(res, { playlist });
  } catch (err) { next(err); }
};

export const update = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const playlist = await playlistService.update(req.params.id, req.body as object);
    ok(res, { playlist });
  } catch (err) { next(err); }
};

export const remove = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    await playlistService.remove(req.params.id);
    ok(res, {}, 'Playlist deleted');
  } catch (err) { next(err); }
};

export const getMyPlaylists = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const playlists = await playlistService.getUserPlaylists(req.user!.id);
    ok(res, { playlists });
  } catch (err) { next(err); }
};

export const join = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { inviteCode } = req.body as { inviteCode: string };
    const playlist = await playlistService.joinByCode(inviteCode, req.user!.id);
    ok(res, { playlist }, 'Joined playlist');
  } catch (err) { next(err); }
};

export const updateRole = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { role } = req.body as { role: string };
    await playlistService.updateMemberRole(req.params.id, req.params.userId, role);
    ok(res, {}, 'Role updated');
  } catch (err) { next(err); }
};

export const removeMember = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    await playlistService.removeMember(req.params.id, req.params.userId);
    ok(res, {}, 'Member removed');
  } catch (err) { next(err); }
};
