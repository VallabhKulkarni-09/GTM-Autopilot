/**
 * webhooks.ts — POST /webhooks/hubspot
 *
 * Rules (non-negotiable):
 * 1. Verify HMAC signature FIRST — 401 if invalid
 * 2. Check idempotency — 200 { status: 'duplicate' } if seen before
 * 3. Enqueue BullMQ job
 * 4. Return 200 { status: 'accepted' } — must complete within 200ms
 * NEVER process synchronously in the webhook handler.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { HubSpotConnector } from '../connectors/hubspot/hubspot.connector.js'
import { existsByIdempotencyKey } from '../repositories/event-log.repository.js'
import { addJob } from '../queue/setup.js'

const hubspot = new HubSpotConnector()
// Connect lazily — connector.connect() is called at startup in server.ts

export async function webhookRoutes(app: FastifyInstance) {
  app.post(
    '/hubspot',
    {
      config: { rawBody: true },
      schema: {
        body: {
          type: 'object',
          required: ['eventId'],
          properties: {
            eventId:          { type: 'string' },
            subscriptionType: { type: 'string' },
            portalId:         { type: 'number' },
            properties:       { type: 'object' },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      // ── 1. Verify HMAC signature ───────────────────────────────────────────
      const sig = request.headers['x-hubspot-signature'] as string
      const payload = JSON.stringify(request.body)
      const secret = process.env.HUBSPOT_WEBHOOK_SECRET ?? ''

      const isValid = hubspot.verifyWebhookSignature(payload, sig, secret)
      if (!isValid) {
        return reply.status(401).send({ error: 'INVALID_SIGNATURE', message: 'HMAC signature verification failed', requestId: request.id })
      }

      // ── 2. Idempotency check ───────────────────────────────────────────────
      const body = request.body as any
      const eventId = String(body.eventId)
      const idempotencyKey = `hubspot:webhook:${eventId}`

      const alreadyProcessed = await existsByIdempotencyKey(idempotencyKey)
      if (alreadyProcessed) {
        return reply.status(200).send({ status: 'duplicate', eventId })
      }

      // ── 3. Enqueue BullMQ job ──────────────────────────────────────────────
      await addJob('inbound-lead-processing', {
        payload: body,
        idempotencyKey,
        receivedAt: new Date().toISOString(),
      })

      // ── 4. Return 200 immediately ──────────────────────────────────────────
      return reply.status(200).send({ status: 'accepted', eventId })
    }
  )
}
