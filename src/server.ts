import express, { Application } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';

import { env } from './config/env';
import logger from './utils/logger';
import routes from './routes/index';
import { errorHandler, notFoundHandler } from './middlewares/error.middleware';
import { startSyncQueueJob } from './jobs/syncQueue.job';
import { startTokenRefreshJob } from './jobs/tokenRefresh.job';

const app: Application = express();

app.use(helmet());
app.use(cors({
  origin: env.frontendUrl,
  credentials: true,
}));
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message:  { success: false, message: 'Too many requests, please try again later.' },
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan(env.nodeEnv === 'production' ? 'combined' : 'dev'));
app.use(cors({
  origin: '*', // temporal para debug
  credentials: true,
}));
app.use('/api', routes);

app.use(notFoundHandler);
app.use(errorHandler);

app.listen(env.port, '0.0.0.0', () => {
  logger.info(`🎵 Tunely API running on port ${env.port} [${env.nodeEnv}]`);
  startSyncQueueJob();
  startTokenRefreshJob();
});

export default app;
