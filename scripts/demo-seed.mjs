/**
 * demo-seed.mjs — Seeds demo data into live Supabase for the real-world proof run.
 *
 * What it seeds:
 *   1. Two "Salesforce user" entries in external_identity (so RoutingAgent
 *      has real owners to assign to instead of always requesting human review)
 *   2. Verifies routing_state exists for 'inbound-leads' queue
 *
 * Idempotent: safe to run multiple times.
 * Run this BEFORE demo-leads.mjs.
 *
 * Usage:
 *   node scripts/demo-seed.mjs [--sf-user-id 005Dn000002xYZVIA2] [--sf-user-name "Your Name"]
 *
 * If no --sf-user-id is given, it uses a placeholder. Replace it once you have
 * a real Salesforce Developer Edition user ID.
 */

import 'dotenv/config'

// ── Parse args ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const sfUserIdArg   = args[args.indexOf('--sf-user-id') + 1]   ?? 'PLACEHOLDER_SF_USER_ID_1'
const sfUserNameArg = args[args.indexOf('--sf-user-name') + 1] ?? 'Demo Rep 1'

// Dynamic import so ws polyfill loads first
await import('ws').then(({ default: ws }) => { globalThis.WebSocket = ws.WebSocket ?? ws })
const { getDb } = await import('../dist/db/client.js')

const db = getDb()

// ── Resolve org ─────────────────────────────────────────────────────────────
const { data: orgs, error: orgErr } = await db.from('organizations').select('id, name').limit(1)
if (orgErr || !orgs?.length) {
  console.error('❌ Could not resolve org from Supabase:', orgErr?.message)
  process.exit(1)
}
const orgId = orgs[0].id
console.log(`\n━━━ GTM Autopilot — Demo Seed ━━━`)
console.log(`  Org: ${orgs[0].name} (${orgId})\n`)

// ── Seed SF users into external_identity ────────────────────────────────────
const sfUsers = [
  {
    organization_id: orgId,
    entity_type:     'user',
    entity_id:       '00000000-0000-0000-0000-000000000001',
    provider:        'salesforce',
    external_id:     sfUserIdArg,
    metadata: {
      name:      sfUserNameArg,
      email:     'cdtermux1011@gmail.com',
      territory: 'north_america',
      title:     'Account Executive'
    }
  },
  {
    organization_id: orgId,
    entity_type:     'user',
    entity_id:       '00000000-0000-0000-0000-000000000002',
    provider:        'salesforce',
    external_id:     sfUserIdArg,   // same user for both slots in a single-user dev org
    metadata: {
      name:      sfUserNameArg,
      email:     'cdtermux1011@gmail.com',
      territory: 'emea',            // also covers EMEA for Lead 7 demo
      title:     'Account Executive'
    }
  }
]

for (const user of sfUsers) {
  // Check if already exists (unique constraint: org+entity_type+entity_id+provider)
  const { data: existing } = await db
    .from('external_identity')
    .select('id, external_id')
    .eq('organization_id', orgId)
    .eq('provider', 'salesforce')
    .eq('entity_type', 'user')
    .eq('entity_id', user.entity_id)
    .single()

  if (existing) {
    // Update external_id and metadata in case they changed
    await db
      .from('external_identity')
      .update({ external_id: user.external_id, metadata: user.metadata })
      .eq('id', existing.id)
    console.log(`  ↺ Updated SF user: ${user.metadata.name} (${user.external_id}) — territory: ${user.metadata.territory}`)
  } else {
    const { error } = await db.from('external_identity').insert(user)
    if (error) {
      console.error(`  ❌ Failed to seed user ${user.metadata.name}: ${error.message}`)
    } else {
      console.log(`  ✓ Seeded SF user: ${user.metadata.name} (${user.external_id}) — territory: ${user.metadata.territory}`)
    }
  }
}

// ── Verify routing_state ─────────────────────────────────────────────────────
const { data: routingState, error: rsErr } = await db
  .from('routing_state')
  .select('id, queue_name, counter')
  .eq('organization_id', orgId)
  .eq('queue_name', 'inbound-leads')
  .single()

if (rsErr || !routingState) {
  // Insert if missing
  const { error: insertErr } = await db
    .from('routing_state')
    .insert({ organization_id: orgId, queue_name: 'inbound-leads', counter: 0 })
  if (insertErr) {
    console.error(`  ❌ Failed to create routing_state: ${insertErr.message}`)
  } else {
    console.log(`  ✓ Created routing_state: queue=inbound-leads counter=0`)
  }
} else {
  console.log(`  ✓ routing_state exists: queue=${routingState.queue_name} counter=${routingState.counter}`)
}

console.log(`
━━━ Seed complete ━━━

  Next step: run  node scripts/demo-leads.mjs

  ⚠️  If SF_CLIENT_ID / SF_CLIENT_SECRET are not set, the system will
     compute and record owner assignments but skip the actual Salesforce
     API call. Set them when you have your SF Developer Edition ready.
`)
