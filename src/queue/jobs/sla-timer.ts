/**
 * sla-timer.ts — 2-minute SLA heartbeat job.
 *
 * Logic:
 * 1. Find plays where sla_breached = FALSE and first_touch_deadline < NOW()
 * 2. Write sla_breached event, update play_instance, enqueue escalation
 * 3. Find plays with due follow-ups (next_action_at < NOW())
 * 4. Enqueue advance-play-step for each
 *
 * SLA deadline MUST use form_submitted_at, not created_at.
 * Plays where the deadline was miscalculated (created_at-based) are SKIPPED with WARNING.
 */

import { createClient } from '@supabase/supabase-js'
import { writeEvent } from '../events/event-log.js'
import { addJob } from './setup.js'

function getClient() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!)
}

export async function runSlaTimer(organizationIds: string[]): Promise<void> {
  for (const orgId of organizationIds) {
    await checkBreachedPlays(orgId)
    await checkDueFollowUps(orgId)
  }
}

async function checkBreachedPlays(orgId: string): Promise<void> {
  const { data: breached, error } = await getClient()
    .from('play_instance')
    .select('id, lead_id, first_touch_deadline, sla_minutes, created_at')
    .eq('organization_id', orgId)
    .eq('status', 'running')
    .is('first_touch_at', null)
    .eq('sla_breached', false)
    .lt('first_touch_deadline', new Date().toISOString())

  if (error) {
    console.error(`[sla-timer] Failed to query breached plays for org ${orgId}: ${error.message}`)
    return
  }

  for (const play of breached ?? []) {
    // ── SLA deadline verification ────────────────────────────────────────────
    // Detect if deadline was miscalculated from created_at instead of form_submitted_at
    // by comparing: first_touch_deadline - sla_minutes vs created_at
    // If too close to created_at (within 1 second), this is a misconfigured play.
    if (play.sla_minutes && play.created_at) {
      const deadlineMs = new Date(play.first_touch_deadline).getTime()
      const slaMs = (play.sla_minutes ?? 15) * 60 * 1000
      const impliedStart = deadlineMs - slaMs
      const createdMs = new Date(play.created_at).getTime()

      // If impliedStart ≈ created_at (within 5 seconds) → misconfigured
      if (Math.abs(impliedStart - createdMs) < 5000) {
        console.warn(`[sla-timer] SKIPPING play ${play.id} — SLA deadline appears to be calculated from created_at, not form_submitted_at. Fix the play creation logic.`)
        continue
      }
    }

    // ── 1. Write sla_breached event ──────────────────────────────────────────
    try {
      await writeEvent({
        organizationId:   orgId,
        workflowRunId:    play.id,
        playInstanceId:   play.id,
        leadId:           play.lead_id,
        eventType:        'sla_breached',
        actorType:        'sla_timer',
        eventStatus:      'success',
        decisionSnapshot: {
          lead: { id: play.lead_id } as any,
          company: null,
          policies: [],
          ownerWorkloads: {},
          evidenceIds: [],
          agentName: 'sla-timer',
          agentVersion: '1.0.0',
          promptVersion: null,
          modelName: null,
        },
      })
    } catch (err) {
      console.error(`[sla-timer] Failed to write sla_breached event for play ${play.id}: ${err}`)
    }

    // ── 2. Mark play as breached ─────────────────────────────────────────────
    await getClient()
      .from('play_instance')
      .update({ sla_breached: true, sla_breached_at: new Date().toISOString() })
      .eq('id', play.id)
      .eq('organization_id', orgId)

    // ── 3. Enqueue escalation at priority 1 ───────────────────────────────────
    await addJob('escalate-play', { playId: play.id, organizationId: orgId }, { priority: 1 })
  }
}

async function checkDueFollowUps(orgId: string): Promise<void> {
  const { data: due, error } = await getClient()
    .from('play_instance')
    .select('id, lead_id, current_step')
    .eq('organization_id', orgId)
    .eq('status', 'running')
    .like('current_step', 'follow_up%')
    .lt('next_action_at', new Date().toISOString())

  if (error) {
    console.error(`[sla-timer] Failed to query due follow-ups for org ${orgId}: ${error.message}`)
    return
  }

  for (const play of due ?? []) {
    await addJob('advance-play-step', { playId: play.id, organizationId: orgId })
  }
}
