/**
 * metrics.ts — GET /api/metrics/overview, GET /api/metrics/speed-to-lead
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { createClient } from '@supabase/supabase-js'

function getClient() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!)
}

export async function metricsRoutes(app: FastifyInstance) {
  // ── GET /api/metrics/overview ──────────────────────────────────────────────
  app.get('/overview', async (request: FastifyRequest, reply: FastifyReply) => {
    const { organizationId } = request.tenantContext

    // Active plays
    const { count: activePlays } = await getClient()
      .from('play_instance')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .eq('status', 'running')

    // SLA breaches
    const { count: slaBreaches } = await getClient()
      .from('play_instance')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .eq('sla_breached', true)

    // % touched within 15 min
    const { data: plays } = await getClient()
      .from('play_instance')
      .select('first_touch_at, created_at, lead_id')
      .eq('organization_id', organizationId)
      .not('first_touch_at', 'is', null)

    const touchedIn15 = (plays ?? []).filter(p => {
      const diff = new Date(p.first_touch_at).getTime() - new Date(p.created_at).getTime()
      return diff <= 15 * 60 * 1000
    }).length
    const touchedPct = plays?.length ? Math.round((touchedIn15 / plays.length) * 100) : 0

    // Avg first touch (ms)
    const avgMs = plays?.length
      ? Math.round((plays ?? []).reduce((sum, p) => {
          return sum + (new Date(p.first_touch_at).getTime() - new Date(p.created_at).getTime())
        }, 0) / plays.length)
      : null

    return reply.send({
      activePlays: activePlays ?? 0,
      slaBreaches: slaBreaches ?? 0,
      touchedIn15MinPct: touchedPct,
      avgFirstTouchMs: avgMs,
    })
  })

  // ── GET /api/metrics/speed-to-lead ────────────────────────────────────────
  app.get('/speed-to-lead', async (request: FastifyRequest, reply: FastifyReply) => {
    const { organizationId } = request.tenantContext

    const { data: plays } = await getClient()
      .from('play_instance')
      .select('first_touch_at, created_at')
      .eq('organization_id', organizationId)
      .not('first_touch_at', 'is', null)
      .limit(500)

    const buckets = { '0-5m': 0, '5-15m': 0, '15-30m': 0, '30-60m': 0, '60m+': 0 }
    for (const p of plays ?? []) {
      const mins = (new Date(p.first_touch_at).getTime() - new Date(p.created_at).getTime()) / 60000
      if (mins <= 5) buckets['0-5m']++
      else if (mins <= 15) buckets['5-15m']++
      else if (mins <= 30) buckets['15-30m']++
      else if (mins <= 60) buckets['30-60m']++
      else buckets['60m+']++
    }

    return reply.send({ distribution: buckets, total: (plays ?? []).length })
  })
}
