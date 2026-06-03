import { Router } from 'express';
import * as ctrl from '../controllers/user.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { Response, NextFunction } from 'express';
import supabase from '../config/supabase';
import { ok } from '../utils/response';
import { AuthRequest } from '../types';

const router = Router();
router.use(authenticate);

router.get('/me',           ctrl.getMe);
router.get('/me/accounts',  ctrl.getMyAccounts);
router.get('/me/activity',  ctrl.getActivity);

router.delete('/me', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;

    await supabase.from('connected_accounts').delete().eq('user_id', userId);
    await supabase.from('activity_log').delete().eq('user_id', userId);
    await supabase.from('playlist_members').delete().eq('user_id', userId);
    await supabase.from('users').delete().eq('id', userId);

    ok(res, {}, 'Account deleted');
  } catch (err) { next(err); }
});

export default router;
