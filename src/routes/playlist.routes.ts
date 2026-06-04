import { Router, Response, NextFunction } from 'express';
import * as ctrl from '../controllers/playlist.controller';
import * as songCtrl from '../controllers/song.controller';
import * as syncCtrl from '../controllers/sync.controller';
import { authenticate, requireRole } from '../middlewares/auth.middleware';
import * as playlistService from '../services/playlist.service';
import { AuthRequest } from '../types';
import { ok } from '../utils/response';
import supabase from '../config/supabase';

const router = Router();
router.use(authenticate);

// Middleware que carga la membresía del usuario en req.membership
const loadMembership = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const membership = await playlistService.getMembership(
      req.params.id,
      req.user!.id
    );
    if (!membership) {
      res.status(403).json({ success: false, message: 'Not a member of this playlist' });
      return;
    }
    req.membership = membership;
    next();
  } catch (err) { next(err); }
};

// ── Playlist CRUD ─────────────────────────────────────────────
router.get('/', ctrl.getMyPlaylists);
router.post('/', ctrl.create);
router.post('/join', ctrl.join);

router.get   ('/:id', loadMembership, ctrl.getOne);
router.put   ('/:id', loadMembership, requireRole('owner', 'admin'), ctrl.update);
router.delete('/:id', loadMembership, requireRole('owner'),          ctrl.remove);

// ── Members ───────────────────────────────────────────────────
router.put   ('/:id/members/:userId/role', loadMembership, requireRole('owner'),          ctrl.updateRole);
router.delete('/:id/members/:userId',      loadMembership, requireRole('owner', 'admin'), ctrl.removeMember);

// ── Songs dentro de una playlist ─────────────────────────────
router.get   ('/:id/songs',           loadMembership, (req, res, next) => {
  req.params.playlistId = req.params.id;
  songCtrl.getPlaylistSongs(req, res, next);
});
router.delete('/:id/songs/:songId',   loadMembership, requireRole('owner', 'admin'), (req, res, next) => {
  req.params.playlistId = req.params.id;
  songCtrl.removeSong(req, res, next);
});
router.get   ('/:id/conflicts',       loadMembership, (req, res, next) => {
  req.params.playlistId = req.params.id;
  songCtrl.getConflicts(req, res, next);
});

// ── Sync ──────────────────────────────────────────────────────
router.post('/:id/songs/add',     loadMembership, (req, res, next) => {
  req.params.playlistId = req.params.id;
  syncCtrl.addSong(req, res, next);
});
router.post('/:id/songs/confirm', loadMembership, (req, res, next) => {
  req.params.playlistId = req.params.id;
  syncCtrl.confirmMatch(req, res, next);
});

router.get('/:id/activity', loadMembership, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { data } = await supabase
      .from('activity_log')
      .select(`
        id, action, details, created_at,
        users!user_id(id, name, avatar_url)
      `)
      .eq('playlist_id', req.params.id)
      .order('created_at', { ascending: false })
      .limit(50);

    ok(res, { activity: data ?? [] });
  } catch (err) { next(err); }
});

router.get('/:id/play', authenticate, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId   = req.user!.id;

    // Obtener plataforma preferida del usuario
    const { data: user } = await supabase
      .from('users')
      .select('preferred_platform')
      .eq('id', userId)
      .single();

    // Obtener playlist espejo del usuario
    const { data: mirror } = await supabase
      .from('member_platform_playlists')
      .select('provider, platform_playlist_id')
      .eq('playlist_id', req.params.id)
      .eq('user_id', userId)
      .eq('provider', user?.preferred_platform === 'youtube' ? 'google' : 'spotify')
      .single();

    if (!mirror) {
      res.status(404).json({ success: false, message: 'No playlist mirror found for this platform' });
      return;
    }

    const url = mirror.provider === 'spotify'
      ? `https://open.spotify.com/playlist/${mirror.platform_playlist_id as string}`
      : `https://music.youtube.com/playlist?list=${mirror.platform_playlist_id as string}`;

    ok(res, { url, platform: mirror.provider });
  } catch (err) { next(err); }
});

export default router;
