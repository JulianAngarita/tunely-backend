import cron from 'node-cron';
import { processQueue } from '../services/sync.service';
import logger from '../utils/logger';


export const startSyncQueueJob = (): void => {
  cron.schedule('*/2 * * * *', async () => {
    logger.debug('[Job] Running sync queue...');
    try {
      await processQueue();
    } catch (err) {
      logger.error('[Job] Sync queue failed:', err);
    }
  });
  logger.info('[Job] Sync queue scheduled (every 2 min)');
};
