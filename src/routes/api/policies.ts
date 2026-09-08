/**
 * policies.ts — GET /api/policies, PUT /api/policies/:id
 *
 * Returns organization-scoped policy rules.
 * Tenant middleware (on /api/*) guarantees organizationId is a verified UUID.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { getDb } from '../../db/client.js'

export async function policyRoutes(app: FastifyInstance) {
  // ── GET /api/policies ──────────────────────────────────────────────────────
  app.get('/', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          page:      { type: 'integer', minimum: 1, default: 1 },
          limit:     { type: 'integer', minimum: 1, maximum: 100, default: 50 },
          rule_type: { type: 'string' },
          is_active: { type: 'boolean' },
        },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { organizationId } = request.tenantContext
    const { page = 1, limit = 50, rule_type, is_active } = request.query as any

    const from = (page - 1) * limit
    let query = getDb()
      .from('policy_rules')
      .select('id, rule_type, name, description, priority, is_active, created_at, updated_at', { count: 'exact' })
      .eq('organization_id', organizationId)
      .order('priority', { ascending: true })
      .range(from, from + limit - 1)

    if (rule_type) query = (query as any).eq('rule_type', rule_type)
    if (is_active !== undefined) query = (query as any).eq('is_active', is_active)

    const { data, count, error } = await (query as any)
    if (error) {
      return reply.status(500).send({
        error: 'POLICY_FETCH_FAILED',
        message: 'Failed to load policy rules',
        requestId: request.id,
      })
    }

    return reply.send({
      data: data ?? [],
      total: count ?? 0,
      page,
      limit,
    })
  })

  // ── PUT /api/policies/:id ──────────────────────────────────────────────────
  app.put('/:id', {
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', format: 'uuid' } },
      },
      body: {
        type: 'object',
        properties: {
          is_active:   { type: 'boolean' },
          priority:    { type: 'integer', minimum: 1 },
          name:        { type: 'string', maxLength: 255 },
          description: { type: 'string' },
        },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { organizationId } = request.tenantContext
    const { id } = request.params as { id: string }
    const body = request.body as Record<string, unknown>

    // Only allow whitelisted fields to be updated
    const allowedFields = ['is_active', 'priority', 'name', 'description']
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
    for (const field of allowedFields) {
      if (body[field] !== undefined) updates[field] = body[field]
    }

    const { data, error } = await getDb()
      .from('policy_rules')
      .update(updates)
      .eq('id', id)
      .eq('organization_id', organizationId)   // cross-tenant safety
      .select('id, rule_type, name, description, priority, is_active, updated_at')
      .single()

    if (error || !data) {
      return reply.status(404).send({
        error: 'POLICY_NOT_FOUND',
        message: `Policy rule ${id} not found in this organization`,
        requestId: request.id,
      })
    }

    return reply.send(data)
  })
}
