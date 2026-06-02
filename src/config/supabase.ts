import { createClient } from '@supabase/supabase-js';
import { env } from './env';
import ws from 'ws';

const supabase = createClient(
  env.supabase.url,
  env.supabase.serviceRoleKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    realtime: {
      transport: ws as never,
    },
  }
);

export default supabase;