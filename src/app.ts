/**
 * app.ts — Fastify application factory.
 * Exported, NOT started here. server.ts does the listen() call.
 *
 * Middleware:
 *   - /api/* routes: tenantContextMiddleware (JWT required)
 *   - /webhooks/*: HMAC only, no JWT, no rate-limit (drop nothing)
 *
 * Security:
 *   - @fastify/helmet: sets security headers on all responses
 *   - @fastify/rate-limit: 100 req/min per IP on /api/* only
 */

import Fastify from 'fastify'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import { tenantContextMiddleware } from './middleware/tenant-context.js'
import { webhookRoutes }   from './routes/webhooks.js'
import { leadRoutes }      from './routes/api/leads.js'
import { metricsRoutes }   from './routes/api/metrics.js'
import { connectorRoutes } from './routes/api/connectors.js'
import { policyRoutes }    from './routes/api/policies.js'

export function buildApp() {
  const app = Fastify({
    logger: true,
    requestIdHeader: 'x-request-id',
    genReqId: () => crypto.randomUUID(),
  })

  // ─── Security headers (all routes) ────────────────────────────────────────
  void app.register(helmet, { global: true })

  // ─── Rate limiting — API routes only (webhooks exempt) ────────────────────
  void app.register(rateLimit, {
    global: false,           // must be enabled per-route or per-plugin
    max: 100,
    timeWindow: '1 minute',
    skipOnError: true,
    keyGenerator: (request) => request.ip,
  })

  // ─── Tenant middleware — API routes only ───────────────────────────────────
  app.addHook('preHandler', async (request, reply) => {
    if (request.routeOptions?.url?.startsWith('/api/')) {
      return tenantContextMiddleware(request, reply)
    }
  })

  // ─── Routes ────────────────────────────────────────────────────────────────
  // Webhooks: no rate-limit, no tenant middleware (HMAC only)
  app.register(webhookRoutes,   { prefix: '/webhooks' })

  // API routes: tenant middleware applied, rate-limited
  app.register(leadRoutes,      { prefix: '/api/leads' })
  app.register(metricsRoutes,   { prefix: '/api/metrics' })
  app.register(connectorRoutes, { prefix: '/api/connectors' })
  app.register(policyRoutes,    { prefix: '/api/policies' })

  return app
}
