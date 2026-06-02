import winston from 'winston';
import { env } from '../config/env';

const logger = winston.createLogger({
  level: env.nodeEnv === 'production' ? 'info' : 'debug',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    env.nodeEnv === 'production'
      ? winston.format.json()
      : winston.format.printf(({ timestamp, level, message, stack }) => {
          return `${timestamp} [${level.toUpperCase()}] ${(stack as string) || (message as string)}`;
        })
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
  ],
});

export default logger;
