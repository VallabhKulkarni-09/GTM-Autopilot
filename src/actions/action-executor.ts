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

import { getDb } from '../db/client.js'
import { writeEvent } from '../events/event-log.js'
import type { ProposedAction, ActionExecutionResult, ConnectorError, DecisionSnapshot } from './types.js'
import type { ConnectorName } from '../domain/db-types.js'

// ─── Connector registry type ──────────────────────────────────────────────────

export type ConnectorRegistry = {
  salesforce: {
    assignLeadOwner(leadId: string, ownerId: string, idempotencyKey: string): Promise<void>
    createTask(leadId: string, task: { subject: string; description?: string; due_date: string }, idempotencyKey: string): Promise<{ Id: string }>
  }
  hubspot: unknown
  outreach: {
    enrollInSequence(prospectId: string, sequenceId: string, idempotencyKey: string): Promise<void>
  }
  clearbit: unknown
}

// ─── Idempotency check ────────────────────────────────────────────────────────

async function existsByIdempotencyKey(key: string): Promise<boolean> {
  const { count, error } = await getDb()
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
  const { error } = await getDb()
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
  const { error } = await getDb()
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
  const { data } = await getDb()
    .from('routing_state')
    .select('id, counter')
    .eq('organization_id', organizationId)
    .eq('queue_name', queueName)
    .single()
  if (!data) return

  await getDb()
    .from('routing_state')
    .update({ counter: (data.counter ?? 0) + 1 })
    .eq('id', data.id)
    .eq('organization_id', organizationId)
}

// ─── Briefing card builder ────────────────────────────────────────────────────

function buildBriefingCard(
  lead: { first_name?: string | null; last_name?: string | null; title?: string | null; email: string; form_submitted_at: string },
  company: { name?: string | null; employee_count?: number | null; annual_revenue?: number | null; industry?: string | null } | null,
  evidence: Array<{ source_type?: string; data?: Record<string, unknown> }>,
  rawPayload: Record<string, unknown> | null
): string {
  const name = [lead.first_name, lead.last_name].filter(Boolean).join(' ') || lead.email
  const minutesAgo = Math.round((Date.now() - new Date(lead.form_submitted_at).getTime()) / 60000)

  // Extract tech stack from evidence
  const techEvidence = evidence.find(e => e.source_type === 'clearbit_enrichment')
  const techStack: string[] = (techEvidence?.data?.tech as string[] | undefined) ?? []
  const techLine = techStack.length > 0 ? techStack.slice(0, 5).join(', ') : 'Unknown'

  // Extract form comment
  const comment = (rawPayload?.message ?? rawPayload?.comment ?? rawPayload?.use_case ?? '') as string

  // Revenue formatting
  const revenue = company?.annual_revenue
    ? `$${Math.round(company.annual_revenue / 100_000_000) / 10}M ARR`
    : 'Unknown'

  const lines = [
    `📋 INBOUND LEAD BRIEF — Submitted ${minutesAgo}m ago`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `👤 ${name}${lead.title ? ` — ${lead.title}` : ''}`,
    `🏢 ${company?.name ?? 'Unknown'} | ${company?.employee_count ?? '?'} employees | ${revenue} | ${company?.industry ?? 'Unknown'}`,
    `💻 Tech: ${techLine}`,
    ...(comment ? [`💬 Request: "${comment.slice(0, 200)}"`] : []),
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `🎯 Angle: "Since they use ${techStack[0] ?? 'your stack'}, ask how they currently handle lead qualification and routing."`,
  ]

  return lines.join('\n')
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

        let externalId: string | undefined
        const sfAvailable = !!connectors?.salesforce

        if (sfAvailable) {
          // Assign owner in Salesforce
          await connectors.salesforce.assignLeadOwner(sfLeadId, recommended_owner_id, key)

          // Create call task with briefing card, due at the SLA deadline
          const dueDate = (decisionSnapshot as any).firstTouchDeadline
            ?? new Date(Date.now() + 15 * 60 * 1000).toISOString()
          const briefingCard = buildBriefingCard(
            decisionSnapshot.lead,
            decisionSnapshot.company,
            [],
            decisionSnapshot.lead.raw_payload ?? null
          )
          const task = await connectors.salesforce.createTask(
            sfLeadId,
            {
              subject: `Call within SLA — ${decisionSnapshot.lead.first_name ?? ''} ${decisionSnapshot.lead.last_name ?? ''} @ ${decisionSnapshot.company?.name ?? ''}`.trim(),
              description: briefingCard,
              due_date: dueDate,
            },
            `${key}:task`
          )
          externalId = task.Id
        } else {
          // SF connector not configured — record intent without crashing.
          // The assigned_owner_id is still written to play_instance so the
          // dashboard can surface it. An operator can manually action in SF.
          console.warn(`[action-executor] assign_owner: SF connector unavailable for org ${organizationId} — recording owner assignment without SF sync`)
        }

        // Always: update play instance and advance routing counter
        await updatePlayInstance(playInstanceId, organizationId, {
          assigned_owner_id:   recommended_owner_id,
          assigned_owner_name: (action.parameters as any).owner_name ?? null,
          status: 'running',
        })
        await incrementRoutingStateIndex(organizationId, queue_name)

        result = {
          success: true,
          ...(sfAvailable ? { externalSystem: 'salesforce' as ConnectorName, externalId } : {}),
          output: {
            owner_id:              recommended_owner_id,
            sf_synced:             sfAvailable,
            ...(externalId ? { task_id: externalId } : {}),
          },
        }
        break
      }

      // ── start_sequence ─────────────────────────────────────────────────────
      case 'start_sequence': {
        const { outreach_prospect_id, sequence_id } = action.parameters as {
          outreach_prospect_id: string; sequence_id: string
        }

        const outreachAvailable = !!connectors?.outreach
        if (outreachAvailable) {
          await connectors.outreach.enrollInSequence(outreach_prospect_id, sequence_id, key)
        } else {
          console.warn(`[action-executor] start_sequence: Outreach connector unavailable for org ${organizationId} — sequence enrollment skipped`)
        }

        await updatePlayInstance(playInstanceId, organizationId, {
          first_touch_at: new Date().toISOString(),
          status: 'in_sequence',
          ...(outreachAvailable ? { sequence_id } : {}),
          ...(outreachAvailable ? { enrolled_at: new Date().toISOString() } : {}),
        })
        await updateLead(action.target.leadId, organizationId, { stage: 'in_sequence' })
        result = {
          success: true,
          ...(outreachAvailable ? { externalSystem: 'outreach' as ConnectorName, externalId: outreach_prospect_id } : {}),
          output: { sequence_id, outreach_synced: outreachAvailable },
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
