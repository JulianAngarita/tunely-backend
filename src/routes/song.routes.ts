import { Router } from 'express';
import * as ctrl from '../controllers/song.controller';
import { authenticate } from '../middlewares/auth.middleware';

const router = Router();
router.use(authenticate);

// Búsqueda unificada: GET /api/songs/search?q=blinding+lights
router.get('/search', ctrl.search);

export default router;
