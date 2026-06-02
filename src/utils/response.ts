import { Response } from 'express';

export const ok = (res: Response, data: object = {}, message = 'OK', status = 200): Response =>
  res.status(status).json({ success: true, message, data });

export const created = (res: Response, data: object = {}, message = 'Created'): Response =>
  ok(res, data, message, 201);

export const error = (res: Response, message = 'Internal server error', status = 500, details?: string[]): Response =>
  res.status(status).json({ success: false, message, ...(details && { details }) });

export const notFound    = (res: Response, message = 'Not found')    => error(res, message, 404);
export const unauthorized= (res: Response, message = 'Unauthorized') => error(res, message, 401);
export const forbidden   = (res: Response, message = 'Forbidden')    => error(res, message, 403);
export const badRequest  = (res: Response, message = 'Bad request', details?: string[]) =>
  error(res, message, 400, details);
