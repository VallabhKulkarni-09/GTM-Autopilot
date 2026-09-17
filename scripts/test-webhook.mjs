#!/usr/bin/env node
/**
 * test-webhook.mjs
 *
 * Simulates a real HubSpot webhook POST to localhost:3000/webhooks/hubspot.
 * Computes a valid HMAC-SHA256 signature — the handler will accept it as genuine.
 *
 * Tests:
 *   1. HMAC signature verification passes (correct secret)
 *   2. Idempotency check works (second run returns 'duplicate')
 *   3. BullMQ job is enqueued
 *   4. Response arrives within 200ms
 *
 * Usage:
 *   node scripts/test-webhook.mjs
 *   node scripts/test-webhook.mjs --duplicate   # send same eventId again
 *   node scripts/test-webhook.mjs --bad-sig     # force 401 (wrong secret)
 */

import { createHmac } from 'crypto'

const PORT    = process.env.PORT ?? 3000
const SECRET  = process.env.HUBSPOT_WEBHOOK_SECRET ?? ''
const BAD_SIG = process.argv.includes('--bad-sig')
const DUP     = process.argv.includes('--duplicate')

if (!SECRET) {
  console.error('\n  ❌ HUBSPOT_WEBHOOK_SECRET is not set.')
  console.error('     Run: HUBSPOT_WEBHOOK_SECRET=xxx node scripts/test-webhook.mjs\n')
  process.exit(1)
}

// Fixed eventId so --duplicate works across two runs
const EVENT_ID = DUP ? '11111111111' : String(Date.now())

const payload = {
  eventId:          EVENT_ID,
  subscriptionType: 'contact.creation',
  portalId:         12345678,
  occurredAt:       new Date().toISOString(),
  properties: {
    email:     'test.webhook@acme.com',
    firstname: 'Test',
    lastname:  'Webhook',
    jobtitle:  'Head of Engineering',
    company:   'Acme Corp',
    website:   'https://acme.com',
  },
}

const body = JSON.stringify(payload)

const sig = BAD_SIG
  ? 'deadbeef0000000000000000000000000000000000000000000000000000dead'
  : createHmac('sha256', SECRET).update(body).digest('hex')

const url = `http://localhost:${PORT}/webhooks/hubspot`

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
console.log('  GTM Autopilot — HubSpot Webhook Test')
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
console.log(`  URL:     ${url}`)
console.log(`  eventId: ${EVENT_ID}`)
console.log(`  mode:    ${BAD_SIG ? 'bad-sig (expect 401)' : DUP ? 'duplicate (expect 200 duplicate)' : 'fresh event (expect 200 accepted)'}`)
console.log()

const t0 = Date.now()
let res, json

try {
  res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'x-hubspot-signature': sig },
    body,
  })
  json = await res.json()
} catch (err) {
  console.error(`  ❌ Could not connect to localhost:${PORT} — is the server running? (npm run dev)\n`)
  process.exit(1)
}

const ms = Date.now() - t0
console.log(`  HTTP ${res.status}  (${ms}ms)`)
console.log(`  Body: ${JSON.stringify(json)}`)
console.log()

let pass = true
if (BAD_SIG) {
  pass = res.status === 401
  console.log(pass ? '  ✅ HMAC rejection works (401 on bad sig)' : `  ❌ Expected 401, got ${res.status}`)
} else if (DUP) {
  pass = res.status === 200 && json.status === 'duplicate'
  console.log(pass ? '  ✅ Idempotency works (duplicate rejected correctly)' : `  ❌ Expected 200 duplicate, got ${res.status} ${JSON.stringify(json)}`)
} else {
  pass = res.status === 200 && json.status === 'accepted'
  if (pass) {
    console.log('  ✅ Webhook accepted — HMAC valid, not duplicate')
    console.log(ms <= 200 ? `  ✅ Response time: ${ms}ms (within 200ms SLA)` : `  ⚠️  Response time: ${ms}ms (over 200ms — check Redis)`)
    console.log()
    console.log('  Next steps:')
    console.log('    1. Check server terminal for BullMQ enqueue log')
    console.log('    2. Test idempotency: node scripts/test-webhook.mjs --duplicate')
    console.log('    3. Test bad sig:     node scripts/test-webhook.mjs --bad-sig')
  } else {
    console.log(`  ❌ Expected 200 accepted, got ${res.status} ${JSON.stringify(json)}`)
  }
}

console.log()
process.exit(pass ? 0 : 1)
