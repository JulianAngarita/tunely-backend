import { Router } from 'express';
import * as ctrl from '../controllers/user.controller';
import { authenticate } from '../middlewares/auth.middleware';

const router = Router();
router.use(authenticate);

router.get('/me',           ctrl.getMe);
router.get('/me/accounts',  ctrl.getMyAccounts);
router.get('/me/activity',  ctrl.getActivity);

export default router;
