import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Server-only Supabase client (spec D3 / §2.1). Uses SUPABASE_SERVICE_KEY, which must NEVER
 * reach the client bundle — the `server-only` import above makes importing this from a Client
 * Component a build error (TU11).
 *
 * Returns null when credentials are absent (e.g. build with no env / local dev without creds)
 * so callers can render the §6.6 graceful "data unavailable" state instead of crashing.
 */
let cached: SupabaseClient | null | undefined;

export function getSupabase(): SupabaseClient | null {
  if (cached !== undefined) return cached;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    cached = null;
    return cached;
  }
  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
