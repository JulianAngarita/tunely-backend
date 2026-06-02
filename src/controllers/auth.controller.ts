import { Request, Response, NextFunction } from 'express';
import * as authService from '../services/auth.service';
import { ok, created } from '../utils/response';

export const register = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await authService.register(req.body);
    created(res, result, 'User registered successfully');
  } catch (err) { next(err); }
};

export const login = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await authService.login(req.body);
    ok(res, result, 'Login successful');
  } catch (err) { next(err); }
};

export const refresh = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { refreshToken } = req.body as { refreshToken: string };
    const tokens = authService.refreshAccessToken(refreshToken);
    ok(res, { tokens });
  } catch (err) { next(err); }
};

// ─── SPOTIFY ───────────────────────────────────────────────────

export const spotifyAuthUrl = (req: Request, res: Response): void => {
  // state puede llevar info extra (ej: si viene de settings para vincular cuenta)
  const state = (req.query.state as string) ?? 'login';
  res.redirect(authService.getSpotifyAuthUrl(state));
};

export const spotifyCallback = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { code } = req.query as { code: string };
    const { tokens } = await authService.handleSpotifyCallback(code);

    // Redirigir a la app Flutter con los tokens via deep link
    const deepLink = `tunely://auth/callback?accessToken=${tokens.accessToken}&refreshToken=${tokens.refreshToken}&provider=spotify`;
    res.redirect(deepLink);
  } catch (err) { next(err); }
};

// ─── GOOGLE ────────────────────────────────────────────────────

export const googleAuthUrl = (req: Request, res: Response): void => {
  const state = (req.query.state as string) ?? 'login';
  res.redirect(authService.getGoogleAuthUrl(state));
};

export const googleCallback = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { code } = req.query as { code: string };
    const { tokens } = await authService.handleGoogleCallback(code);

    // Redirigir a la app Flutter con los tokens via deep link
    const deepLink = `tunely://auth/callback?accessToken=${tokens.accessToken}&refreshToken=${tokens.refreshToken}&provider=google`;
    res.redirect(deepLink);
  } catch (err) { next(err); }
};
