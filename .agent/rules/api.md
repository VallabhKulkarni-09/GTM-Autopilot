---
trigger: always_on
description: >
globs: src/routes/**/*.ts, src/middleware/**/*.ts
---

# API Rules

## Tenant Context Middleware — The Most Important Middleware

Every route must go through this middleware. No exceptions.

```typescript
// CORRECT — organization_id comes from the verified JWT
fastify.addHook('preHandler', tenantContextMiddleware)

// WRONG — trusting organization_id from the request body
const orgId = request.body.organizationId
```

The middleware:
1. Extracts and verifies the JWT
2. Extracts organization_id from the verified token
3. Attaches organizationId to request.tenantContext
4. Rejects requests with missing or invalid organization_id with 401

Never read organization_id from request.body, request.query, or request.params.

## Webhook Routes — The Critical Rules

The webhook handler must:
1. Verify HMAC signature FIRST, before any other processing
2. Check idempotency (has this event_id been processed before?)
3. Enqueue a BullMQ job
4. Return HTTP 200 within 200ms

```typescript
// CORRECT
fastify.post('/webhooks/hubspot', async (request, reply) => {
  // 1. Verify signature
  const isValid = hubspotConnector.verifyWebhookSignature(
    JSON.stringify(request.body),
    request.headers['x-hubspot-signature'],
    process.env.HUBSPOT_WEBHOOK_SECRET
  )
  if (!isValid) return reply.status(401).send({ error: 'INVALID_SIGNATURE' })

  // 2. Check idempotency
  const eventId = request.body.eventId
  const alreadyProcessed = await eventLogRepo.existsByExternalId(eventId)
  if (alreadyProcessed) return reply.status(200).send({ status: 'duplicate' })

  // 3. Enqueue immediately
  await queue.add('process-inbound-lead', { payload: request.body })

  // 4. Return 200 immediately — do NOT process synchronously
  return reply.status(200).send({ status: 'accepted' })
})

// WRONG — synchronous processing in webhook handler
fastify.post('/webhooks/hubspot', async (request, reply) => {
  await enrichLead(request.body)      // blocks response
  await routeLead(request.body)       // blocks response
  return reply.status(200).send()
})
```

## API Routes — Standard Rules

```typescript
// Response type — always typed, never raw DB rows
type LeadResponse = {
  id: string
  email: string
  stage: string
  // ... selected fields only
}

// Error response — always this shape
type ErrorResponse = {
  error: string    // machine-readable code (SCREAMING_SNAKE_CASE)
  message: string  // human-readable explanation
  requestId: string
}
```

Never expose:
- Raw database rows (select only what the UI needs)
- Internal Supabase/Postgres error messages
- Stack traces in any environment
- Provider-specific IDs directly (return our internal UUIDs)

## Route List for MVP

```
POST /webhooks/hubspot              → receive HubSpot form submissions

GET  /api/leads                     → list leads (paginated, filterable)
GET  /api/leads/:id                 → single lead with current state
GET  /api/leads/:id/timeline        → full event_log for a lead

GET  /api/plays                     → list play instances
GET  /api/plays/:id                 → single play instance

GET  /api/metrics/overview          → dashboard summary numbers
GET  /api/metrics/speed-to-lead     → distribution data for chart

GET  /api/policies                  → list policy rules
PUT  /api/policies/:id              → update a policy rule

GET  /api/connectors                → list connector health statuses
POST /api/connectors/:name/test     → test connector credentials
```

Build only these routes. No others.

## Input Validation

Use Fastify's built-in schema validation for every route:

```typescript
fastify.get('/api/leads', {
  schema: {
    querystring: {
      type: 'object',
      properties: {
        page: { type: 'integer', minimum: 1, default: 1 },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
        stage: { type: 'string', enum: ['new', 'routing', 'in_sequence', 'meeting_booked', 'nurture', 'lost'] }
      }
    }
  }
}, handler)
```

Never trust unvalidated input. Never pass raw query params to SQL.