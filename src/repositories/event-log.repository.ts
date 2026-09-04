/**
 * event-log.repository.ts
 * Repository functions for event_log and action_execution_state.
 *
 * event_log: write-only (writeEvent) + one read (getLeadTimeline)
 * action_execution_state: upsert + update (via event-processor)
 */

import { createClient } from '@supabase/supabase-js'
import { writeEvent } from '../events/event-log.js'
import type { WriteEventInput, EventLogRow } from '../events/event.types.js'

function getClient() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!)
}

// Re-export writeEvent as the canonical repository method
export { writeEvent }

/**
 * The ONLY read query allowed on event_log from application code.
 * Returns events ORDER BY occurred_at ASC.
 */
export async function getLeadTimeline(
  organizationId: string,
  leadId: string
): Promise<EventLogRow[]> {
  const { data, error } = await getClient()
    .from('event_log')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('lead_id', leadId)
    .order('occurred_at', { ascending: true })

  if (error) throw new Error(`[event-log-repo] getLeadTimeline failed: ${error.message}`)
  return (data ?? []) as EventLogRow[]
}

/**
 * Checks if an event with this idempotency key already exists.
 * Used by the webhook handler for deduplication.
 */
export async function existsByIdempotencyKey(key: string): Promise<boolean> {
  const { count, error } = await getClient()
    .from('event_log')
    .select('id', { count: 'exact', head: true })
    .eq('idempotency_key', key)

  if (error) throw new Error(`[event-log-repo] existsByIdempotencyKey failed: ${error.message}`)
  return (count ?? 0) > 0
}
