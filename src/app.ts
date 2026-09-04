/**
 * app.ts — Fastify application factory.
 * Exported, NOT started here. server.ts does the listen() call.
 *
 * Middleware:
 *   - /api/* routes: tenantContextMiddleware (JWT required)
 *   - /webhooks/*: HMAC only, no JWT
 */

import Fastify from 'fastify'
import { tenantContextMiddleware } from './middleware/tenant-context.js'
import { webhookRoutes } from './routes/webhooks.js'
import { leadRoutes } from './routes/api/leads.js'
import { metricsRoutes } from './routes/api/metrics.js'
import { connectorRoutes } from './routes/api/connectors.js'

export function buildApp() {
  const app = Fastify({
    logger: true,
    requestIdHeader: 'x-request-id',
    genReqId: () => crypto.randomUUID(),
  })

  // ─── Tenant middleware — API routes only ───────────────────────────────────
  app.addHook('preHandler', async (request, reply) => {
    if (request.routeOptions?.url?.startsWith('/api/')) {
      return tenantContextMiddleware(request, reply)
    }
  })

  // ─── Routes ────────────────────────────────────────────────────────────────
  app.register(webhookRoutes, { prefix: '/webhooks' })
  app.register(leadRoutes,    { prefix: '/api/leads' })
  app.register(metricsRoutes, { prefix: '/api/metrics' })
  app.register(connectorRoutes, { prefix: '/api/connectors' })

  return app
}
