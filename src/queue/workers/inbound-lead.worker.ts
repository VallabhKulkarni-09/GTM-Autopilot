/**
 * inbound-lead.worker.ts — Processes HubSpot form submission payloads.
 * Creates lead + company records, emits webhook_received event, enqueues enrichment.
 */

import { Worker } from 'bullmq'
import { createClient } from '@supabase/supabase-js'
import { writeEvent } from '../../events/event-log.js'
import { addJob, redisConnection } from '../setup.js'

function getClient() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!)
}

export const inboundLeadWorker = new Worker(
  'inbound-lead-processing',
  async (job) => {
    const { payload, idempotencyKey } = job.data
    const orgId = payload.portalId ? String(payload.portalId) : process.env.DEFAULT_ORG_ID!
    const workflowRunId = job.id!

    try {
      // ── Create lead record ─────────────────────────────────────────────────
      const properties = payload.properties ?? {}
      const { data: lead, error: leadErr } = await getClient()
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
          form_submitted_at: payload.occurredAt ? new Date(payload.occurredAt).toISOString() : new Date().toISOString(),
          raw_payload:      payload,
        })
        .select('id')
        .single()

      if (leadErr) throw new Error(`Failed to create lead: ${leadErr.message}`)

      // ── Create play_instance ───────────────────────────────────────────────
      const { data: play, error: playErr } = await getClient()
        .from('play_instance')
        .insert({
          organization_id: orgId,
          lead_id:         lead.id,
          status:          'running',
          current_step:    'enrichment',
          // SLA deadline uses form_submitted_at — ALWAYS
          form_submitted_at: payload.occurredAt ? new Date(payload.occurredAt).toISOString() : new Date().toISOString(),
        })
        .select('id')
        .single()

      if (playErr) throw new Error(`Failed to create play_instance: ${playErr.message}`)

      // ── Emit webhook_received event ────────────────────────────────────────
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
          lead: { id: lead.id } as any,
          company: null,
          policies: [],
          ownerWorkloads: {},
          evidenceIds: [],
          agentName: 'inbound-lead-worker',
          agentVersion: '1.0.0',
          promptVersion: null,
          modelName: null,
        },
      })

      // ── Enqueue enrichment ─────────────────────────────────────────────────
      await addJob('advance-play-step', {
        playId: play.id,
        leadId: lead.id,
        organizationId: orgId,
        step: 'enrich',
      })

    } catch (err) {
      // Emit failure event — never crash the worker silently
      console.error(`[inbound-lead-worker] Job ${job.id} failed: ${err}`)
      throw err  // BullMQ will retry based on backoff config
    }
  },
  { connection: redisConnection, concurrency: 5 }
)
