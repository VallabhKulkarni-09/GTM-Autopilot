/**
 * action-executor.ts
 * The ONLY place in the system that calls connectors.
 * No other file may call a connector directly.
 *
 * Pipeline (executeAction):
 *   1. Check idempotency — deduplicate if already executed
 *   2. Emit action_execution_started
 *   3. Execute action (connector call or DB mutation)
 *   4. Emit action_execution_succeeded (or action_execution_failed)
 *
 * CRITICAL: Steps 2 and 4 are ALWAYS written to event_log.
 * Use try/finally to guarantee this even when step 3 throws.
 */

import { createClient } from '@supabase/supabase-js'
import { writeEvent } from '../events/event-log.js'
import type { ProposedAction, ActionExecutionResult, ConnectorError, DecisionSnapshot } from './types.js'
import type { ConnectorName } from '../domain/db-types.js'

// ─── Connector registry type ──────────────────────────────────────────────────

export type ConnectorRegistry = {
  salesforce: {
    assignLeadOwner(leadId: string, ownerId: string, idempotencyKey: string): Promise<void>
    createTask(leadId: string, task: { subject: string; due_date: string }, idempotencyKey: string): Promise<{ Id: string }>
  }
  hubspot: unknown
  outreach: {
    enrollInSequence(prospectId: string, sequenceId: string, idempotencyKey: string): Promise<void>
  }
  clearbit: unknown
}

// ─── Supabase client ──────────────────────────────────────────────────────────

function getClient() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!)
}

// ─── Idempotency check ────────────────────────────────────────────────────────

async function existsByIdempotencyKey(key: string): Promise<boolean> {
  const { count, error } = await getClient()
    .from('action_execution_state')
    .select('id', { count: 'exact', head: true })
    .eq('idempotency_key', key)
  if (error) return false
  return (count ?? 0) > 0
}

// ─── Repository helpers ───────────────────────────────────────────────────────

async function updateLead(
  leadId: string,
  organizationId: string,
  data: Record<string, unknown>
): Promise<void> {
  const { error } = await getClient()
    .from('leads')
    .update(data)
    .eq('id', leadId)
    .eq('organization_id', organizationId)
  if (error) throw new Error(`[action-executor] updateLead failed: ${error.message}`)
}

async function updatePlayInstance(
  playInstanceId: string,
  organizationId: string,
  data: Record<string, unknown>
): Promise<void> {
  const { error } = await getClient()
    .from('play_instance')
    .update(data)
    .eq('id', playInstanceId)
    .eq('organization_id', organizationId)
  if (error) throw new Error(`[action-executor] updatePlayInstance failed: ${error.message}`)
}

async function incrementRoutingStateIndex(
  organizationId: string,
  queueName: string
): Promise<void> {
  // Increment counter in routing_state for the queue (round-robin advance)
  const { data } = await getClient()
    .from('routing_state')
    .select('id, counter')
    .eq('organization_id', organizationId)
    .eq('queue_name', queueName)
    .single()
  if (!data) return

  await getClient()
    .from('routing_state')
    .update({ counter: (data.counter ?? 0) + 1 })
    .eq('id', data.id)
    .eq('organization_id', organizationId)
}

// ─── Main executor ────────────────────────────────────────────────────────────

export async function executeAction(
  action: ProposedAction,
  connectors: ConnectorRegistry,
  organizationId: string,
  workflowRunId: string,
  playInstanceId: string,
  decisionSnapshot: DecisionSnapshot
): Promise<ActionExecutionResult> {
  const key = action.idempotencyKey

  // ── 1. Idempotency check ───────────────────────────────────────────────────
  const alreadyDone = await existsByIdempotencyKey(key)
  if (alreadyDone) {
    await writeEvent({
      organizationId,
      workflowRunId,
      playInstanceId,
      leadId: action.target.leadId,
      eventType: 'action_execution_deduplicated',
      actorType: 'system',
      idempotencyKey: key,
      eventStatus: 'skipped',
      decisionSnapshot,
    })
    return { success: true, output: { deduplicated: true } }
  }

  // ── 2. Emit action_execution_started ──────────────────────────────────────
  await writeEvent({
    organizationId,
    workflowRunId,
    playInstanceId,
    leadId: action.target.leadId,
    eventType: 'action_execution_started',
    actorType: 'system',
    idempotencyKey: key,
    eventStatus: 'success',
    decisionSnapshot,
    proposedAction: action as unknown as Record<string, unknown>,
  })

  let result: ActionExecutionResult = { success: false }

  // ── 3. Execute (try/finally guarantees event is written in step 4/5) ──────
  try {
    switch (action.type) {
      // ── qualify_lead ───────────────────────────────────────────────────────
      case 'qualify_lead': {
        const { is_icp_fit, icp_score, icp_tier } = action.parameters as {
          is_icp_fit: boolean; icp_score: number; icp_tier: string
        }
        await updateLead(action.target.leadId, organizationId, {
          is_icp_fit,
          icp_score,
          icp_tier,
          stage: is_icp_fit ? 'routing' : 'nurture',
        })
        result = { success: true, output: { is_icp_fit, icp_score, icp_tier } }
        break
      }

      // ── assign_owner ───────────────────────────────────────────────────────
      case 'assign_owner': {
        const { recommended_owner_id, queue_name, sf_lead_id } = action.parameters as {
          recommended_owner_id: string; queue_name: string; sf_lead_id?: string
        }
        const sfLeadId = sf_lead_id ?? action.target.leadId

        // Assign owner in Salesforce
        await connectors.salesforce.assignLeadOwner(sfLeadId, recommended_owner_id, key)

        // Create call task due in 15 minutes
        const dueDate = new Date(Date.now() + 15 * 60 * 1000).toISOString()
        const task = await connectors.salesforce.createTask(
          sfLeadId,
          { subject: 'Call within 15 minutes', due_date: dueDate },
          `${key}:task`
        )

        // Update play instance
        await updatePlayInstance(playInstanceId, organizationId, {
          assigned_owner_id: recommended_owner_id,
          status: 'running',
        })

        // Advance round-robin counter
        await incrementRoutingStateIndex(organizationId, queue_name)

        result = {
          success: true,
          externalSystem: 'salesforce' as ConnectorName,
          externalId: task.Id,
          output: { owner_id: recommended_owner_id, task_id: task.Id },
        }
        break
      }

      // ── start_sequence ─────────────────────────────────────────────────────
      case 'start_sequence': {
        const { outreach_prospect_id, sequence_id } = action.parameters as {
          outreach_prospect_id: string; sequence_id: string
        }
        await connectors.outreach.enrollInSequence(outreach_prospect_id, sequence_id, key)
        await updatePlayInstance(playInstanceId, organizationId, {
          first_touch_at: new Date().toISOString(),
          status: 'in_sequence',
        })
        await updateLead(action.target.leadId, organizationId, { stage: 'in_sequence' })
        result = {
          success: true,
          externalSystem: 'outreach' as ConnectorName,
          externalId: outreach_prospect_id,
          output: { sequence_id },
        }
        break
      }

      // ── mark_nurture ───────────────────────────────────────────────────────
      case 'mark_nurture': {
        await updateLead(action.target.leadId, organizationId, { stage: 'nurture' })
        await updatePlayInstance(playInstanceId, organizationId, { status: 'nurture' })
        result = { success: true, output: { stage: 'nurture' } }
        break
      }

      // ── mark_duplicate ─────────────────────────────────────────────────────
      case 'mark_duplicate': {
        await updateLead(action.target.leadId, organizationId, { is_duplicate: true })
        await updatePlayInstance(playInstanceId, organizationId, { status: 'completed' })
        result = { success: true, output: { is_duplicate: true } }
        break
      }

      // ── request_human_review ───────────────────────────────────────────────
      case 'request_human_review': {
        await updatePlayInstance(playInstanceId, organizationId, {
          status: 'paused',
          pending_approval_since: new Date().toISOString(),
        })
        result = { success: true, output: { status: 'pending_human' } }
        break
      }

      // ── escalate ───────────────────────────────────────────────────────────
      case 'escalate': {
        // Already handled by escalate.worker.ts via BullMQ
        await updatePlayInstance(playInstanceId, organizationId, { status: 'failed' })
        result = { success: true, output: { status: 'escalated' } }
        break
      }

      default: {
        throw new Error(`[action-executor] Unknown action type: ${(action as any).type}`)
      }
    }

    // ── 4. Emit action_execution_succeeded ───────────────────────────────────
    await writeEvent({
      organizationId,
      workflowRunId,
      playInstanceId,
      leadId: action.target.leadId,
      eventType: 'action_execution_succeeded',
      actorType: 'system',
      idempotencyKey: key,
      eventStatus: 'success',
      externalSystem: result.externalSystem,
      externalId: result.externalId,
      decisionSnapshot,
    })

    return result
  } catch (err) {
    // ── 5. Emit action_execution_failed (always, even if step 3 threw) ──────
    const connErr = err as any
    await writeEvent({
      organizationId,
      workflowRunId,
      playInstanceId,
      leadId: action.target.leadId,
      eventType: 'action_execution_failed',
      actorType: 'system',
      idempotencyKey: key,
      eventStatus: 'failed',
      errorCode: connErr?.code ?? 'UNKNOWN_ERROR',
      errorMessage: connErr?.message ?? 'Unknown error',
      errorRaw: connErr?.raw,
      decisionSnapshot,
    })
    throw err
  }
}
