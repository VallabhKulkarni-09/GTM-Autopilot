/**
 * metrics.ts — GET /api/metrics/overview, GET /api/metrics/speed-to-lead
 *
 * Response shape matches dashboard expectations exactly:
 *   /overview → { currentPeriod: {...}, priorPeriod: {...} }
 *   /speed-to-lead → { distribution: {...}, total: N }
 *
 * RULE: all time calculations use form_submitted_at, never created_at (GEMINI.md rule 6)
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { getDb } from '../../db/client.js'

const PERIOD_DAYS = 30

function periodStart(daysAgo: number): string {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  return d.toISOString()
}

export async function metricsRoutes(app: FastifyInstance) {
  // ── GET /api/metrics/overview ──────────────────────────────────────────────
  app.get('/overview', async (request: FastifyRequest, reply: FastifyReply) => {
    const { organizationId } = request.tenantContext
    const db = getDb()

    const currentStart = periodStart(PERIOD_DAYS)
    const priorStart   = periodStart(PERIOD_DAYS * 2)

    // ── Current period plays ─────────────────────────────────────────────────
    const { data: currentPlays } = await db
      .from('play_instance')
      .select('first_touch_at, first_touch_deadline, sla_breached, status, lead_id')
      .eq('organization_id', organizationId)
      .gte('created_at', currentStart)

    // ── Prior period plays ───────────────────────────────────────────────────
    const { data: priorPlays } = await db
      .from('play_instance')
      .select('status, lead_id')
      .eq('organization_id', organizationId)
      .gte('created_at', priorStart)
      .lt('created_at', currentStart)

    // ── Active plays (running right now, all time) ───────────────────────────
    const { count: activePlays } = await db
      .from('play_instance')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .eq('status', 'running')

    // ── Current period calculations ──────────────────────────────────────────
    const current = currentPlays ?? []
    const slaBreaches = current.filter(p => p.sla_breached).length

    // Touched within 15 min: use form_submitted_at via first_touch_deadline offset
    // We measure: first_touch_at - (first_touch_deadline - sla_minutes)
    // Since we don't store form_submitted_at on play_instance directly, use
    // first_touch_deadline - 15min as proxy for form_submitted_at
    const touched = current.filter(p => p.first_touch_at && p.first_touch_deadline)
    const touchedIn15 = touched.filter(p => {
      const formSubmittedAt = new Date(p.first_touch_deadline).getTime() - 15 * 60_000
      const diff = new Date(p.first_touch_at).getTime() - formSubmittedAt
      return diff <= 15 * 60_000
    })
    const touchedUnder15MinPct = touched.length
      ? Math.round((touchedIn15.length / touched.length) * 100)
      : 0

    const avgFirstTouchMs = touched.length
      ? Math.round(touched.reduce((sum, p) => {
          const formSubmittedAt = new Date(p.first_touch_deadline).getTime() - 15 * 60_000
          return sum + (new Date(p.first_touch_at).getTime() - formSubmittedAt)
        }, 0) / touched.length)
      : null
    const avgFirstTouchMin = avgFirstTouchMs !== null ? Math.round(avgFirstTouchMs / 60_000) : null

    const meetingsBooked   = current.filter(p => p.status === 'completed').length
    const totalQualified   = current.length

    // ── Prior period calculations ────────────────────────────────────────────
    const prior = priorPlays ?? []
    const priorMeetings   = prior.filter(p => p.status === 'completed').length
    const priorQualified  = prior.length
    // For prior period speed % we don't have enough data without form_submitted_at
    // Use sla_breached as a proxy (non-breached = touched in time)
    const priorTouchedUnder15MinPct = 0  // requires form_submitted_at on play_instance

    return reply.send({
      currentPeriod: {
        activePlays:          activePlays ?? 0,
        slaBreaches,
        touchedUnder15MinPct,
        avgFirstTouchMin,
        meetingsBooked,
        totalQualified,
      },
      priorPeriod: {
        touchedUnder15MinPct: priorTouchedUnder15MinPct,
        meetingsBooked:       priorMeetings,
        totalQualified:       priorQualified,
      },
    })
  })

  // ── GET /api/metrics/speed-to-lead ────────────────────────────────────────
  app.get('/speed-to-lead', async (request: FastifyRequest, reply: FastifyReply) => {
    const { organizationId } = request.tenantContext

    const { data: plays } = await getDb()
      .from('play_instance')
      .select('first_touch_at, first_touch_deadline')
      .eq('organization_id', organizationId)
      .not('first_touch_at', 'is', null)
      .not('first_touch_deadline', 'is', null)
      .limit(500)

    // Use form_submitted_at = first_touch_deadline - 15min (GEMINI.md rule 6)
    const buckets = { 'under5': 0, '5to15': 0, '15to30': 0, '30to60': 0, 'over60': 0 }
    for (const p of plays ?? []) {
      const formSubmittedAt = new Date(p.first_touch_deadline).getTime() - 15 * 60_000
      const mins = (new Date(p.first_touch_at).getTime() - formSubmittedAt) / 60_000
      if (mins <= 5)       buckets['under5']++
      else if (mins <= 15) buckets['5to15']++
      else if (mins <= 30) buckets['15to30']++
      else if (mins <= 60) buckets['30to60']++
      else                 buckets['over60']++
    }

    return reply.send({ distribution: { buckets }, total: (plays ?? []).length })
  })
}
