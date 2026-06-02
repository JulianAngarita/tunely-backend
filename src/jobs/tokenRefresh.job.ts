import cron from 'node-cron';
import axios from 'axios';
import supabase from '../config/supabase';
import { env } from '../config/env';
import { encrypt, decrypt } from '../utils/crypto';
import logger from '../utils/logger';

interface TokenResponse {
  access_token: string;
  expires_in: number;
}

/**
 * Refresca tokens OAuth que expiran en los próximos 10 minutos.
 * Se ejecuta cada 5 minutos.
 */
export const startTokenRefreshJob = (): void => {
  cron.schedule('*/5 * * * *', async () => {
    logger.debug('[Job] Running token refresh...');

    try {
      const soon = new Date(Date.now() + 10 * 60 * 1000).toISOString();

      const { data: accounts } = await supabase
        .from('connected_accounts')
        .select('id, user_id, provider, refresh_token')
        .lte('expires_at', soon);

      if (!accounts?.length) return;

      for (const account of accounts) {
        try {
          let newToken: TokenResponse | null = null;

          if (account.provider === 'spotify') {
            const basicAuth = Buffer.from(
              `${env.spotify.clientId}:${env.spotify.clientSecret}`
            ).toString('base64');

            const res = await axios.post<TokenResponse>(
              'https://accounts.spotify.com/api/token',
              new URLSearchParams({
                grant_type:    'refresh_token',
                refresh_token: decrypt(account.refresh_token as string),
              }),
              {
                headers: {
                  'Content-Type': 'application/x-www-form-urlencoded',
                  Authorization: `Basic ${basicAuth}`,
                },
              }
            );
            newToken = res.data;

          } else if (account.provider === 'google') {
            const res = await axios.post<TokenResponse>(
              'https://oauth2.googleapis.com/token',
              {
                client_id:     env.google.clientId,
                client_secret: env.google.clientSecret,
                refresh_token: decrypt(account.refresh_token as string),
                grant_type:    'refresh_token',
              }
            );
            newToken = res.data;
          }

          if (newToken) {
            const expires_at = new Date(
              Date.now() + newToken.expires_in * 1000
            ).toISOString();

            await supabase
              .from('connected_accounts')
              .update({
                access_token: encrypt(newToken.access_token),
                expires_at,
                updated_at: new Date().toISOString(),
              })
              .eq('id', account.id);

            logger.debug(`[Job] Token refreshed: account ${account.id as string} (${account.provider as string})`);
          }
        } catch (err) {
          logger.warn(
            `[Job] Failed to refresh token for account ${account.id as string}: ${(err as Error).message}`
          );
          // TODO: notificar al usuario que debe reautenticar
        }
      }
    } catch (err) {
      logger.error('[Job] Token refresh job failed:', err);
    }
  });

  logger.info('[Job] Token refresh scheduled (every 5 min)');
};
