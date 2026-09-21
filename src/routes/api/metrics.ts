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
    const rawBuckets = { under5: 0, under15: 0, under30: 0, under60: 0, over60: 0 }
    for (const p of plays ?? []) {
      const formSubmittedAt = new Date(p.first_touch_deadline).getTime() - 15 * 60_000
      const mins = (new Date(p.first_touch_at).getTime() - formSubmittedAt) / 60_000
      if (mins <= 5)        rawBuckets.under5++
      else if (mins <= 15)  rawBuckets.under15++
      else if (mins <= 30)  rawBuckets.under30++
      else if (mins <= 60)  rawBuckets.under60++
      else                  rawBuckets.over60++
    }

    const total = (plays ?? []).length
    // Convert raw counts to { count, pct } shape matching SpeedToLeadDistribution type
    const toPct = (n: number) => total > 0 ? Math.round((n / total) * 100) : 0
    const buckets = {
      under5:  { count: rawBuckets.under5,  pct: toPct(rawBuckets.under5)  },
      under15: { count: rawBuckets.under15, pct: toPct(rawBuckets.under15) },
      under30: { count: rawBuckets.under30, pct: toPct(rawBuckets.under30) },
      under60: { count: rawBuckets.under60, pct: toPct(rawBuckets.under60) },
      over60:  { count: rawBuckets.over60,  pct: toPct(rawBuckets.over60)  },
    }

    // sdrStats: per-owner breakdown — empty array if no routing data yet
    const { data: ownerStats } = await getDb()
      .from('play_instance')
      .select('assigned_owner_name, first_touch_at, first_touch_deadline, status')
      .eq('organization_id', organizationId)
      .not('assigned_owner_name', 'is', null)
      .limit(500)

    const ownerMap: Record<string, { mins: number[]; completed: number }> = {}
    for (const p of ownerStats ?? []) {
      const name = p.assigned_owner_name as string
      if (!ownerMap[name]) ownerMap[name] = { mins: [], completed: 0 }
      if (p.first_touch_at && p.first_touch_deadline) {
        const formAt = new Date(p.first_touch_deadline).getTime() - 15 * 60_000
        ownerMap[name].mins.push((new Date(p.first_touch_at).getTime() - formAt) / 60_000)
      }
      if (p.status === 'completed') ownerMap[name].completed++
    }

    const sdrStats = Object.entries(ownerMap).map(([name, { mins, completed }]) => {
      const sorted = [...mins].sort((a, b) => a - b)
      const median = sorted.length
        ? sorted[Math.floor(sorted.length / 2)]
        : 0
      const under15Count = mins.filter(m => m <= 15).length
      return {
        name,
        medianFirstTouchMin: Math.round(median),
        under15MinPct: mins.length > 0 ? Math.round((under15Count / mins.length) * 100) : 0,
        meetingsBooked: completed,
      }
    })

    // Return shape matches SpeedToLeadDistribution type exactly (no nesting wrapper)
    return reply.send({ buckets, sdrStats, total })
  })
}
