/**
 * escalate.worker.ts — Handles escalation flow.
 * Sends Slack notification. Never crashes if Slack fails.
 */

import { Worker } from 'bullmq'
import { createClient } from '@supabase/supabase-js'
import { writeEvent } from '../../events/event-log.js'
import { redisConnection } from '../setup.js'

function getClient() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!)
}

export const escalateWorker = new Worker(
  'escalate-play',
  async (job) => {
    const { playId, organizationId } = job.data

    // ── Load play + lead ───────────────────────────────────────────────────
    const { data: play } = await getClient()
      .from('play_instance')
      .select('id, lead_id, status, sla_breached_at')
      .eq('id', playId)
      .eq('organization_id', organizationId)
      .single()

    if (!play) {
      console.error(`[escalate-worker] Play ${playId} not found for org ${organizationId}`)
      return
    }

    const { data: lead } = await getClient()
      .from('leads')
      .select('id, email, first_name, last_name, stage')
      .eq('id', play.lead_id)
      .eq('organization_id', organizationId)
      .single()

    // ── Load escalation policy ─────────────────────────────────────────────
    const { data: escalationPolicies } = await getClient()
      .from('policy_rules')
      .select('parameters')
      .eq('organization_id', organizationId)
      .eq('rule_type', 'escalation')
      .eq('is_active', true)
      .limit(1)

    const slackChannel = (escalationPolicies?.[0]?.parameters as any)?.slack_channel ?? '#sla-escalations'

    // ── Send Slack notification (never crash on Slack failure) ─────────────
    let slackSent = false
    try {
      const slackUrl = process.env.SLACK_WEBHOOK_URL
      if (slackUrl) {
        const res = await fetch(slackUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            channel: slackChannel,
            text: `🚨 *SLA Breach* — Lead \`${lead?.email ?? play.lead_id}\` exceeded the first-touch deadline.\nPlay: \`${playId}\` | Org: \`${organizationId}\`\nBreached at: ${play.sla_breached_at ?? 'unknown'}`,
          }),
        })
        slackSent = res.ok
        if (!res.ok) console.error(`[escalate-worker] Slack responded ${res.status} for play ${playId}`)
      }
    } catch (err) {
      // Log but do NOT throw — escalation event must still be written
      console.error(`[escalate-worker] Slack notification failed for play ${playId}: ${err}`)
    }

    // ── Emit escalation_sent event (always, even if Slack failed) ─────────
    await writeEvent({
      organizationId,
      workflowRunId:   playId,
      playInstanceId:  playId,
      leadId:          play.lead_id,
      eventType:       'escalation_sent',
      actorType:       'sla_timer',
      eventStatus:     slackSent ? 'success' : 'failure',
      errorCode:       !slackSent ? 'SLACK_SEND_FAILED' : undefined,
      errorMessage:    !slackSent ? 'Slack webhook returned non-200' : undefined,
      decisionSnapshot: {
        lead: lead as any ?? { id: play.lead_id } as any,
        company: null,
        policies: [],
        ownerWorkloads: {},
        evidenceIds: [],
        agentName: 'escalate-worker',
        agentVersion: '1.0.0',
        promptVersion: null,
        modelName: null,
      },
    })
  },
  { connection: redisConnection, concurrency: 10 }
)
