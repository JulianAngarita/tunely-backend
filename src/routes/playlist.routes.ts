import { Router, Response, NextFunction } from 'express';
import * as ctrl from '../controllers/playlist.controller';
import * as songCtrl from '../controllers/song.controller';
import * as syncCtrl from '../controllers/sync.controller';
import { authenticate, requireRole } from '../middlewares/auth.middleware';
import * as playlistService from '../services/playlist.service';
import { AuthRequest } from '../types';

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

export default router;
