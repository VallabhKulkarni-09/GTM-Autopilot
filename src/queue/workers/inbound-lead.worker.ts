/**
 * inbound-lead.worker.ts — Processes HubSpot form submission payloads.
 * Creates lead + play_instance records, emits webhook_received, runs LangGraph play.
 *
 * CRITICAL RULES:
 * - organization_id must be a valid UUID — never use portalId directly
 * - play_instance.current_step is INTEGER (not string)
 * - play_instance.first_touch_deadline = form_submitted_at + sla_minutes (never created_at)
 */

import { Worker } from 'bullmq'
import { getDb } from '../../db/client.js'
import { writeEvent } from '../../events/event-log.js'
import { redisConnection } from '../setup.js'
import { runInboundLeadPlay } from '../../workflows/inbound-lead/graph.js'

const DEFAULT_SLA_MINUTES = 15

/**
 * Resolve HubSpot portalId → organization UUID.
 * Looks up the org by matching portalId stored in connector_config.
 * Falls back to DEFAULT_ORG_ID if set and is a valid UUID.
 */
async function resolveOrganizationId(portalId: number | string | undefined): Promise<string> {
  const db = getDb()

  if (portalId) {
    const { data } = await db
      .from('connector_config')
      .select('organization_id')
      .eq('connector_name', 'hubspot')
      .contains('config', { portal_id: String(portalId) })
      .limit(1)
      .single()

    if (data?.organization_id) return data.organization_id
  }

  // Fallback: DEFAULT_ORG_ID must be a valid UUID
  const fallback = process.env.DEFAULT_ORG_ID
  if (!fallback || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(fallback)) {
    throw new Error(
      `[inbound-lead-worker] Cannot resolve organization UUID from portalId=${portalId}. ` +
      `Set DEFAULT_ORG_ID env var to a valid UUID or configure connector_config.hubspot.portal_id.`
    )
  }

  return fallback
}

/**
 * Load SLA minutes from the organization's active SLA policy rule.
 * Defaults to DEFAULT_SLA_MINUTES (15) if no rule found.
 */
async function loadSlaMins(organizationId: string): Promise<number> {
  const db = getDb()
  const { data } = await db
    .from('policy_rules')
    .select('actions')
    .eq('organization_id', organizationId)
    .eq('rule_type', 'sla')
    .eq('is_active', true)
    .order('priority', { ascending: true })
    .limit(1)
    .single()

  const slaMinutes = (data?.actions as any)?.sla_minutes
  return typeof slaMinutes === 'number' && slaMinutes > 0 ? slaMinutes : DEFAULT_SLA_MINUTES
}

export const inboundLeadWorker = new Worker(
  'inbound-lead-processing',
  async (job) => {
    const { payload, idempotencyKey } = job.data
    const workflowRunId = job.id!

    try {
      // ── Resolve organization UUID from HubSpot portalId ──────────────────────
      const orgId = await resolveOrganizationId(payload.portalId)
      const db = getDb()

      // ── Parse form submission timestamp ──────────────────────────────────────
      const formSubmittedAt = payload.occurredAt
        ? new Date(payload.occurredAt).toISOString()
        : new Date().toISOString()

      // ── Load SLA minutes for this org ────────────────────────────────────────
      const slaMinutes = await loadSlaMins(orgId)
      const firstTouchDeadline = new Date(
        new Date(formSubmittedAt).getTime() + slaMinutes * 60_000
      ).toISOString()

      // ── Create lead record ────────────────────────────────────────────────────
      const properties = payload.properties ?? {}
      const { data: lead, error: leadErr } = await db
        .from('leads')
        .insert({
          organization_id:  orgId,
          email:            properties.email ?? payload.email,
          first_name:       properties.firstname ?? null,
          last_name:        properties.lastname ?? null,
          title:            properties.jobtitle ?? null,
          phone:            properties.phone ?? null,
          source:           `hubspot:${payload.subscriptionType ?? 'form'}`,
          stage:            'new',
          form_submitted_at: formSubmittedAt,
          raw_payload:      payload,
          // Qualification fields start null — set by QualificationAgent
          is_duplicate:     false,
          is_icp_fit:       null,
          icp_score:        null,
          icp_tier:         null,
        })
        .select('id')
        .single()

      if (leadErr) throw new Error(`Failed to create lead: ${leadErr.message}`)

      // ── Create play_instance ─────────────────────────────────────────────────
      const { data: play, error: playErr } = await db
        .from('play_instance')
        .insert({
          organization_id:    orgId,
          lead_id:            lead.id,
          status:             'running',
          current_step:       0,                // INTEGER — not a string
          workflow_run_id:    workflowRunId,
          // SLA deadline: form_submitted_at + sla_minutes (NEVER created_at)
          first_touch_deadline: firstTouchDeadline,
        })
        .select('id')
        .single()

      if (playErr) throw new Error(`Failed to create play_instance: ${playErr.message}`)

      // ── Emit webhook_received event ──────────────────────────────────────────
      await writeEvent({
        organizationId:   orgId,
        workflowRunId,
        playInstanceId:   play.id,
        leadId:           lead.id,
        eventType:        'webhook_received',
        actorType:        'webhook',
        idempotencyKey,
        eventStatus:      'success',
        decisionSnapshot: {
          lead:         { id: lead.id } as any,
          company:      null,
          policies:     [],
          ownerWorkloads: {},
          evidenceIds:  [],
          agentName:    'inbound-lead-worker',
          agentVersion: '1.0.0',
          promptVersion: null,
          modelName:    null,
        },
      })

      // ── Run the inbound-lead play via LangGraph ──────────────────────────────
      // Pass the real DB IDs so the graph does NOT generate synthetic ones
      const result = await runInboundLeadPlay(orgId, {
        ...payload,
        _leadId:          lead.id,
        _playInstanceId:  play.id,
        _workflowRunId:   workflowRunId,
      })

      if (result.status === 'completed' || result.status === 'running') {
        console.log(`[inbound-lead-worker] Play ${result.playInstanceId} status: ${result.status}`)
      } else {
        console.error(`[inbound-lead-worker] Play ended with status: ${result.status}`)
      }

    } catch (err) {
      console.error(`[inbound-lead-worker] Job ${job.id} failed: ${err}`)
      throw err  // BullMQ retries
    }
  },
  { connection: redisConnection, concurrency: 5 }
)
