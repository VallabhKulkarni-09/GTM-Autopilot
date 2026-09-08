/**
 * src/db/client.ts
 * Shared Supabase client singleton.
 *
 * Use getDb() everywhere instead of calling createClient() directly.
 * This prevents socket exhaustion and connection churn under concurrency.
 *
 * For operations that need a per-request context (e.g. RLS with user JWT),
 * pass the user JWT to createClient() directly — do not use this singleton.
 * The singleton is SERVICE_KEY only and bypasses RLS (for server-side use).
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import ws from 'ws'

let _client: SupabaseClient | undefined

export function getDb(): SupabaseClient {
  if (!_client) {
    const url = process.env.SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_KEY

    if (!url || !key) {
      throw new Error(
        '[db/client] SUPABASE_URL and SUPABASE_SERVICE_KEY must be set before calling getDb()'
      )
    }

    _client = createClient(url, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
      realtime: {
        transport: ws as any,
      },
    })
  }

  return _client
}

/** For tests: reset the singleton between test runs. */
export function _resetDbClient(): void {
  _client = undefined
}
