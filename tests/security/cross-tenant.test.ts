/**
 * cross-tenant.test.ts
 * Security tests — cross-tenant isolation.
 *
 * All cross-tenant access must return 404 (not 403).
 * Never confirm to a tenant that a resource exists outside their org.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import Fastify, { FastifyInstance } from 'fastify'
import { createHmac } from 'crypto'
import { tenantContextMiddleware } from '../../src/middleware/tenant-context.js'

// ─── Test JWT factory ─────────────────────────────────────────────────────────

const JWT_SECRET = 'test-secret-minimum-32-characters-long!!'
process.env.JWT_SECRET = JWT_SECRET

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const body = Buffer.from(JSON.stringify({ ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')
  const sig = createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url')
  return `${header}.${body}.${sig}`
}

const tokenA = makeJwt({ organization_id: 'org-tenant-a' })
const tokenB = makeJwt({ organization_id: 'org-tenant-b' })
const invalidToken = 'eyJhbGciOiJIUzI1NiJ9.invalid.payload'

// ─── Test server setup ────────────────────────────────────────────────────────

let app: FastifyInstance

beforeAll(async () => {
  app = Fastify({ logger: false })
  app.addHook('preHandler', tenantContextMiddleware)

  // Simulated routes that enforce org isolation
  app.get('/api/leads/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    // Simulate: if the lead belongs to a different org, return 404
    if (id.startsWith('org-b-lead') && req.tenantContext.organizationId !== 'org-tenant-b') return reply.status(404).send({ error: 'NOT_FOUND' })
    if (id.startsWith('org-a-lead') && req.tenantContext.organizationId !== 'org-tenant-a') return reply.status(404).send({ error: 'NOT_FOUND' })
    return reply.send({ id, organizationId: req.tenantContext.organizationId })
  })

  app.get('/api/plays/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    if (id.startsWith('org-b-play') && req.tenantContext.organizationId !== 'org-tenant-b') return reply.status(404).send({ error: 'NOT_FOUND' })
    if (id.startsWith('org-a-play') && req.tenantContext.organizationId !== 'org-tenant-a') return reply.status(404).send({ error: 'NOT_FOUND' })
    return reply.send({ id })
  })

  app.get('/api/leads/:id/timeline', async (req, reply) => {
    const { id } = req.params as { id: string }
    if (id.startsWith('org-b-lead') && req.tenantContext.organizationId !== 'org-tenant-b') return reply.status(404).send({ error: 'NOT_FOUND' })
    return reply.send([])
  })

  app.put('/api/policies/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    if (id.startsWith('org-b-policy') && req.tenantContext.organizationId !== 'org-tenant-b') return reply.status(404).send({ error: 'NOT_FOUND' })
    return reply.send({ id })
  })

  app.get('/api/connectors', async (req, reply) => {
    // Connectors are scoped — this just validates the org claim
    if (!req.tenantContext.organizationId) return reply.status(401).send({ error: 'NO_ORG' })
    return reply.send([])
  })

  await app.ready()
})

// ─── Auth tests ───────────────────────────────────────────────────────────────

describe('Tenant Middleware — auth enforcement', () => {
  it('rejects request with no Authorization header → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/leads/any-lead' })
    expect(res.statusCode).toBe(401)
    expect(res.json().error).toBe('MISSING_TOKEN')
  })

  it('rejects request with invalid JWT → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/leads/any-lead', headers: { Authorization: `Bearer ${invalidToken}` } })
    expect(res.statusCode).toBe(401)
    expect(res.json().error).toBe('INVALID_TOKEN')
  })

  it('rejects token with no organization_id claim → 401', async () => {
    const tokenNoOrg = makeJwt({ sub: 'user-123' })  // no organization_id
    const res = await app.inject({ method: 'GET', url: '/api/leads/any-lead', headers: { Authorization: `Bearer ${tokenNoOrg}` } })
    expect(res.statusCode).toBe(401)
    expect(res.json().error).toBe('MISSING_ORG_ID')
  })
})

// ─── Cross-tenant isolation tests ─────────────────────────────────────────────

describe('Cross-tenant isolation — all must return 404, not 403', () => {
  it('Tenant A token cannot retrieve Tenant B lead → 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/leads/org-b-lead-123', headers: { Authorization: `Bearer ${tokenA}` } })
    expect(res.statusCode).toBe(404)
  })

  it('Tenant B token cannot retrieve Tenant A lead → 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/leads/org-a-lead-123', headers: { Authorization: `Bearer ${tokenB}` } })
    expect(res.statusCode).toBe(404)
  })

  it('Tenant A token cannot retrieve Tenant B play instance → 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/plays/org-b-play-456', headers: { Authorization: `Bearer ${tokenA}` } })
    expect(res.statusCode).toBe(404)
  })

  it('Tenant A token cannot retrieve Tenant B event log entries → 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/leads/org-b-lead-123/timeline', headers: { Authorization: `Bearer ${tokenA}` } })
    expect(res.statusCode).toBe(404)
  })

  it('Tenant A token cannot modify Tenant B policy rules → 404', async () => {
    const res = await app.inject({ method: 'PUT', url: '/api/policies/org-b-policy-789', headers: { Authorization: `Bearer ${tokenA}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'hack' }) })
    expect(res.statusCode).toBe(404)
  })

  it('Tenant A token can access its own lead → 200', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/leads/org-a-lead-123', headers: { Authorization: `Bearer ${tokenA}` } })
    expect(res.statusCode).toBe(200)
    expect(res.json().organizationId).toBe('org-tenant-a')
  })

  it('Tenant B token can access its own lead → 200', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/leads/org-b-lead-123', headers: { Authorization: `Bearer ${tokenB}` } })
    expect(res.statusCode).toBe(200)
  })

  it('Tenant A can access connectors list with valid token → 200', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/connectors', headers: { Authorization: `Bearer ${tokenA}` } })
    expect(res.statusCode).toBe(200)
  })
})
