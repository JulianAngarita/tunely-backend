import { Router, Request, Response } from 'express';
import authRoutes     from './auth.routes';
import userRoutes     from './user.routes';
import playlistRoutes from './playlist.routes';
import songRoutes     from './song.routes';

const router = Router();

router.use('/auth',      authRoutes);
router.use('/users',     userRoutes);
router.use('/playlists', playlistRoutes);
router.use('/songs',     songRoutes);

router.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'tunely-api', timestamp: new Date().toISOString() });
});

export default router;
