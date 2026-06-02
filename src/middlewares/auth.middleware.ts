import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { unauthorized, forbidden } from '../utils/response';
import { AuthRequest, JwtPayload, MemberRole } from '../types';

export const authenticate = (req: AuthRequest, res: Response, next: NextFunction): void => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    unauthorized(res, 'Token missing');
    return;
  }
  const token = header.split(' ')[1];
  try {
    const payload = jwt.verify(token, env.jwt.secret) as JwtPayload;
    req.user = payload;
    next();
  } catch {
    unauthorized(res, 'Invalid or expired token');
  }
};

export const requireRole = (...roles: MemberRole[]) =>
  (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.membership) {
      forbidden(res, 'No membership found for this playlist');
      return;
    }
    if (!roles.includes(req.membership.role)) {
      forbidden(res, `Required role: ${roles.join(' or ')}`);
      return;
    }
    next();
  };
