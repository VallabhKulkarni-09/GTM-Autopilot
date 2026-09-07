/**
 * leads.ts — GET /api/leads, GET /api/leads/:id, GET /api/leads/:id/timeline
 * All routes require tenantContextMiddleware (applied at app.ts level).
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { createClient } from '@supabase/supabase-js'
import { getLeadTimeline } from '../../repositories/event-log.repository.js'

function getClient() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!)
}

export async function leadRoutes(app: FastifyInstance) {
  // ── GET /api/leads ─────────────────────────────────────────────────────────
  app.get(
    '/',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            page:  { type: 'integer', minimum: 1, default: 1 },
            limit: { type: 'integer', minimum: 1, maximum: 50, default: 50 },
            stage: { type: 'string', enum: ['new', 'routing', 'in_sequence', 'meeting_booked', 'nurture', 'lost'] },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { organizationId } = request.tenantContext
      const { page = 1, limit = 50, stage } = request.query as any

      let query = getClient()
        .from('leads')
        .select('id, email, first_name, last_name, title, stage, form_submitted_at, source, created_at')
        .eq('organization_id', organizationId)
        .order('form_submitted_at', { ascending: false })
        .range((page - 1) * limit, page * limit - 1)

      if (stage) query = query.eq('stage', stage)

      const { data, error } = await query
      if (error) {
        return reply.status(500).send({ error: 'QUERY_FAILED', message: 'Failed to list leads', requestId: request.id })
      }

      return reply.send({ data: data ?? [], page, limit })
    }
  )

  // ── GET /api/leads/:id ─────────────────────────────────────────────────────
  app.get(
    '/:id',
    {
      schema: {
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { organizationId } = request.tenantContext
      const { id } = request.params as { id: string }

      const { data, error } = await getClient()
        .from('leads')
        .select('id, email, first_name, last_name, title, stage, phone, form_submitted_at, source, created_at')
        .eq('organization_id', organizationId)
        .eq('id', id)
        .single()

      // Cross-tenant: 404, not 403 — never confirm resource exists
      if (error || !data) return reply.status(404).send({ error: 'NOT_FOUND', message: 'Lead not found', requestId: request.id })

      // Attach current play instance state
      const { data: play } = await getClient()
        .from('play_instance')
        .select('id, status, current_step, sla_breached, first_touch_at, first_touch_deadline')
        .eq('organization_id', organizationId)
        .eq('lead_id', id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single()

      return reply.send({ lead: data, currentPlay: play ?? null })
    }
  )

  // ── GET /api/leads/:id/timeline ────────────────────────────────────────────
  app.get(
    '/:id/timeline',
    {
      schema: {
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { organizationId } = request.tenantContext
      const { id } = request.params as { id: string }

      // Verify the lead belongs to this org — return 404 if not (cross-tenant isolation)
      const { data: lead, error: leadErr } = await getClient()
        .from('leads')
        .select('id')
        .eq('organization_id', organizationId)
        .eq('id', id)
        .single()

      if (leadErr || !lead) return reply.status(404).send({ error: 'NOT_FOUND', message: 'Lead not found', requestId: request.id })

      const timeline = await getLeadTimeline(organizationId, id)
      return reply.send({ leadId: id, events: timeline })
    }
  )
}
