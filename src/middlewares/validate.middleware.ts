import { Response, NextFunction, RequestHandler } from 'express';
import Joi from 'joi';
import { badRequest } from '../utils/response';
import { AuthRequest } from '../types';

export const validate = (schema: Joi.ObjectSchema): RequestHandler =>
  (req: AuthRequest, res: Response, next: NextFunction): void => {
    const { error } = schema.validate(req.body, { abortEarly: false });
    if (error) {
      const details = error.details.map((d) => d.message);
      badRequest(res, 'Validation error', details);
      return;
    }
    next();
  };
