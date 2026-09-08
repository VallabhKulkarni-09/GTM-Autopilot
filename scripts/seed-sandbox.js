/**
 * scripts/seed-sandbox.js
 * Seeds the live Supabase database with a Sandbox organization, SLA rule,
 * action risk registry, and routing queue counter.
 */

import { getDb } from '../dist/db/client.js'
import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const envPath = path.join(__dirname, '..', '.env')

async function seed() {
  const db = getDb()

  console.log('Seeding sandbox organization...')

  // 1. Organization
  let { data: org, error: orgErr } = await db
    .from('organizations')
    .select('id, name, slug')
    .eq('slug', 'acme-sandbox')
    .single()

  if (!org) {
    const { data: newOrg, error: insertErr } = await db
      .from('organizations')
      .insert({
        name: 'Acme Corp (Sandbox)',
        slug: 'acme-sandbox',
        domain: 'acme.com',
        is_active: true,
      })
      .select('id, name, slug')
      .single()

    if (insertErr) throw new Error(`Failed to create org: ${insertErr.message}`)
    org = newOrg
  }

  console.log(`✓ Organization active: ${org.name} (${org.id})`)

  // 2. SLA Policy Rule
  const { data: existingSla } = await db
    .from('policy_rules')
    .select('id')
    .eq('organization_id', org.id)
    .eq('rule_type', 'sla')
    .limit(1)

  if (!existingSla || existingSla.length === 0) {
    await db.from('policy_rules').insert({
      organization_id: org.id,
      rule_type: 'sla',
      name: 'Standard 15m Inbound SLA',
      description: 'First touch deadline within 15 minutes of form submission',
      priority: 1,
      conditions: {},
      actions: { sla_minutes: 15 },
      is_active: true,
    })
    console.log('✓ Created 15m SLA policy rule')
  } else {
    console.log('✓ SLA policy rule already exists')
  }

  // 3. Action Risk Registry
  const actions = [
    { action_type: 'qualify_lead', risk_level: 'low', max_risk_score: 1.0, requires_human_review: false },
    { action_type: 'assign_owner', risk_level: 'low', max_risk_score: 1.0, requires_human_review: false },
    { action_type: 'start_sequence', risk_level: 'low', max_risk_score: 1.0, requires_human_review: false },
    { action_type: 'mark_duplicate', risk_level: 'low', max_risk_score: 1.0, requires_human_review: false },
    { action_type: 'mark_nurture', risk_level: 'low', max_risk_score: 1.0, requires_human_review: false },
    { action_type: 'request_human_review', risk_level: 'low', max_risk_score: 1.0, requires_human_review: false },
    { action_type: 'escalate', risk_level: 'high', max_risk_score: 0.8, requires_human_review: true },
  ]

  for (const a of actions) {
    await db.from('action_risk_registry').upsert({
      organization_id: org.id,
      ...a,
    }, { onConflict: 'organization_id,action_type' })
  }
  console.log(`✓ Action risk registry populated (${actions.length} action types)`)

  // 4. Routing State Counter
  await db.from('routing_state').upsert({
    organization_id: org.id,
    queue_name: 'inbound-leads',
    counter: 0,
  }, { onConflict: 'organization_id,queue_name' })
  console.log('✓ Routing state initialized')

  // 5. Update DEFAULT_ORG_ID in .env if not set or different
  let envContent = fs.readFileSync(envPath, 'utf8')
  if (envContent.includes('DEFAULT_ORG_ID=')) {
    envContent = envContent.replace(/DEFAULT_ORG_ID=.*/, `DEFAULT_ORG_ID=${org.id}`)
  } else {
    envContent += `\nDEFAULT_ORG_ID=${org.id}\n`
  }
  fs.writeFileSync(envPath, envContent, 'utf8')
  console.log(`✓ Updated DEFAULT_ORG_ID=${org.id} in .env`)

  console.log('\n✅ Sandbox seeding complete!')
}

seed().catch(err => {
  console.error('❌ Seeding failed:', err)
  process.exit(1)
})
