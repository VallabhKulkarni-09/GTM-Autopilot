/**
 * escalate.worker.ts — Handles escalation flow.
 * Sends Slack notification. Never crashes if Slack fails.
 */

import { Worker } from 'bullmq'
import { getDb } from '../../db/client.js'
import { writeEvent } from '../../events/event-log.js'
import { redisConnection } from '../setup.js'


export const escalateWorker = new Worker(
  'escalate-play',
  async (job) => {
    const { playId, organizationId } = job.data

    // ── Load play + lead ───────────────────────────────────────────────────
    const { data: play } = await getDb()
      .from('play_instance')
      .select('id, lead_id, status, sla_breached_at')
      .eq('id', playId)
      .eq('organization_id', organizationId)
      .single()

    if (!play) {
      console.error(`[escalate-worker] Play ${playId} not found for org ${organizationId}`)
      return
    }

    const { data: lead } = await getDb()
      .from('leads')
      .select('id, email, first_name, last_name, stage')
      .eq('id', play.lead_id)
      .eq('organization_id', organizationId)
      .single()

    // ── Load escalation policy ─────────────────────────────────────────────
    const { data: escalationPolicies } = await getDb()
      .from('policy_rules')
      .select('parameters')
      .eq('organization_id', organizationId)
      .eq('rule_type', 'escalation')
      .eq('is_active', true)
      .limit(1)

    const slackChannel = (escalationPolicies?.[0]?.parameters as any)?.slack_channel ?? '#sla-escalations'

    // ── Send Slack Block Kit notification (never crash on Slack failure) ──────
    let slackSent = false
    try {
      const slackUrl = process.env.SLACK_WEBHOOK_URL
      if (slackUrl) {
        const leadName    = [lead?.first_name, lead?.last_name].filter(Boolean).join(' ') || lead?.email || play.lead_id
        const leadTitle   = (lead as any)?.title ? ` — ${(lead as any).title}` : ''
        const company     = (lead as any)?.company ?? ''
        const assigneeName = (play as any)?.assigned_owner_name ?? 'Unassigned'
        const elapsedMin  = play.sla_breached_at
          ? Math.round((Date.now() - new Date(play.sla_breached_at).getTime()) / 60_000)
          : 0

        const blocks = [
          {
            type: 'header',
            text: { type: 'plain_text', text: '⏰ Lead Uncontacted — SLA Breached', emoji: true },
          },
          {
            type: 'section',
            fields: [
              { type: 'mrkdwn', text: `*Lead:*\n${leadName}${leadTitle}${company ? ` @ ${company}` : ''}` },
              { type: 'mrkdwn', text: `*Assigned to:*\n${assigneeName}` },
              { type: 'mrkdwn', text: `*Elapsed since breach:*\n${elapsedMin}m` },
              { type: 'mrkdwn', text: `*Play ID:*\n\`${playId}\`` },
            ],
          },
          { type: 'divider' },
          {
            type: 'section',
            text: { type: 'mrkdwn', text: '*Re-route this lead now:*' },
          },
          {
            type: 'actions',
            elements: [
              {
                type: 'button',
                text: { type: 'plain_text', text: '🔄 Pass to Next Rep', emoji: true },
                style: 'primary',
                action_id: 'reroute_next_rep',
                value: playId,
              },
              {
                type: 'button',
                text: { type: 'plain_text', text: '📞 Escalate to AE', emoji: true },
                style: 'danger',
                action_id: 'escalate_to_ae',
                value: playId,
              },
              {
                type: 'button',
                text: { type: 'plain_text', text: '✅ Mark Contacted', emoji: true },
                action_id: 'mark_contacted',
                value: playId,
              },
            ],
          },
        ]

        const res = await fetch(slackUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ channel: slackChannel, blocks, text: `⏰ SLA Breach — ${leadName} is uncontacted` }),
          signal: AbortSignal.timeout(8_000),
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
      eventStatus:     slackSent ? 'success' : 'failed',
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
