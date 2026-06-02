import { Router } from 'express';
import Joi from 'joi';
import * as ctrl from '../controllers/auth.controller';
import { validate } from '../middlewares/validate.middleware';

const router = Router();

// ── Email/password (opcional) ─────────────────────────────────
const registerSchema = Joi.object({
  name:     Joi.string().min(2).max(50).required(),
  email:    Joi.string().email().required(),
  password: Joi.string().min(8).required(),
});
const loginSchema = Joi.object({
  email:    Joi.string().email().required(),
  password: Joi.string().required(),
});

router.post('/register', validate(registerSchema), ctrl.register);
router.post('/login',    validate(loginSchema),    ctrl.login);
router.post('/refresh',  ctrl.refresh);

// ── OAuth — no requieren JWT, crean usuario automáticamente ───
router.get('/spotify',          ctrl.spotifyAuthUrl);
router.get('/spotify/callback', ctrl.spotifyCallback);
router.get('/google',           ctrl.googleAuthUrl);
router.get('/google/callback',  ctrl.googleCallback);

export default router;
