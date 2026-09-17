/**
 * webhooks.ts — POST /webhooks/hubspot
 *
 * Rules (non-negotiable):
 * 1. Verify HMAC signature FIRST — 401 if invalid
 * 2. Check idempotency — 200 { status: 'duplicate' } if seen before
 * 3. Enqueue BullMQ job
 * 4. Return 200 { status: 'accepted' } — must complete within 200ms
 * NEVER process synchronously in the webhook handler.
 *
 * NOTE: HubSpot sends an array of event objects, not a single object.
 * Real payload shape: [{ eventId, subscriptionType, portalId, objectId, ... }]
 * eventId is a number in real HubSpot payloads.
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
      schema: {
        // HubSpot sends an array of event objects
        body: {
          type: 'array',
          items: {
            type: 'object',
            required: ['eventId'],
            properties: {
              eventId:          { type: 'number' },
              subscriptionType: { type: 'string' },
              portalId:         { type: 'number' },
              objectId:         { type: 'number' },   // HubSpot contact ID
              occurredAt:       { type: 'number' },   // epoch ms
              attemptNumber:    { type: 'number' },
              changeSource:     { type: 'string' },
              properties:       { type: 'object' },   // present in some subscription types
            },
          },
          minItems: 1,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      // ── 1. Verify HMAC signature ───────────────────────────────────────────
      // HubSpot signs the raw body string
      const sig = request.headers['x-hubspot-signature'] as string
      const payload = JSON.stringify(request.body)
      const secret = process.env.HUBSPOT_WEBHOOK_SECRET ?? ''

      const isValid = hubspot.verifyWebhookSignature(payload, sig, secret)
      if (!isValid) {
        return reply.status(401).send({ error: 'INVALID_SIGNATURE', message: 'HMAC signature verification failed', requestId: request.id })
      }

      // ── 2 & 3. Idempotency + enqueue — one job per event in the batch ──────
      const events = request.body as any[]
      const results: Array<{ eventId: string; status: 'accepted' | 'duplicate' }> = []

      for (const event of events) {
        const eventId = String(event.eventId)
        const idempotencyKey = `hubspot:webhook:${eventId}`

        const alreadyProcessed = await existsByIdempotencyKey(idempotencyKey)
        if (alreadyProcessed) {
          results.push({ eventId, status: 'duplicate' })
          continue
        }

        await addJob('inbound-lead-processing', {
          payload: event,
          idempotencyKey,
          receivedAt: new Date().toISOString(),
        })

        results.push({ eventId, status: 'accepted' })
      }

      // ── 4. Return 200 immediately ──────────────────────────────────────────
      const accepted = results.filter(r => r.status === 'accepted').map(r => r.eventId)
      const duplicates = results.filter(r => r.status === 'duplicate').map(r => r.eventId)

      return reply.status(200).send({
        status: accepted.length > 0 ? 'accepted' : 'duplicate',
        accepted,
        duplicates,
      })
    }
  )
}
