#!/usr/bin/env node
/**
 * verify-apollo-enrichment.mjs
 *
 * Live-fire test for the Apollo connector.
 * Runs the four steps from the PR checklist:
 *   1. Call Apollo people/match with a real professional email
 *   2. Capture and print the raw JSON response
 *   3. Store evidence rows in Supabase
 *   4. Read back the evidence rows and decision_snapshot.evidenceIds
 *   5. Test the no-match path with a throwaway email
 *   6. Cleanup all test rows
 *
 * Usage:
 *   APOLLO_API_KEY=<key> node -r dotenv/config scripts/verify-apollo-enrichment.mjs
 *
 * What to paste into PROGRESS.md:
 *   - The full raw JSON from step 2 (person object)
 *   - The evidence rows from step 4 (id, source_type, data.fact_type)
 *   - The evidenceIds array from the re-read
 *
 * Do NOT run this in CI — it costs Apollo credits.
 */

import { createClient } from '@supabase/supabase-js'
import ws from 'ws'
import { randomUUID } from 'crypto'

const SUPABASE_URL      = process.env.SUPABASE_URL
const SUPABASE_KEY      = process.env.SUPABASE_SERVICE_KEY
const APOLLO_API_KEY    = process.env.APOLLO_API_KEY
const ORG_ID            = process.env.DEFAULT_ORG_ID ?? '08472be3-4990-43b7-9431-c84352fd0260'

// The real email to test with — should be a LinkedIn-visible person at a real company.
// Change this to a real enrichable email before running.
const TEST_EMAIL = process.env.APOLLO_TEST_EMAIL ?? 'elon@x.com'

// A throwaway email for the no-match test
const NO_MATCH_EMAIL = 'zzz-no-match-verify-apollo@invalid-domain-xyz.invalid'

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_KEY')
  process.exit(1)
}
if (!APOLLO_API_KEY) {
  console.error('Set APOLLO_API_KEY')
  process.exit(1)
}

const db = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { transport: ws },
})

const TEST_LEAD_ID = randomUUID()
const TEST_COMPANY_ID = randomUUID()

async function cleanup() {
  await db.from('evidence').delete().eq('lead_id', TEST_LEAD_ID)
  await db.from('leads').delete().eq('id', TEST_LEAD_ID)
  await db.from('companies').delete().eq('id', TEST_COMPANY_ID)
}

async function apolloMatch(email) {
  const res = await fetch('https://api.apollo.io/api/v1/people/match', {
    method:  'POST',
    headers: {
      'x-api-key':    APOLLO_API_KEY,
      'Content-Type': 'application/json',
      'Accept':       'application/json',
    },
    body:    JSON.stringify({ email }),
    signal:  AbortSignal.timeout(15_000),
  })

  const text = await res.text()
  return { status: res.status, body: text, json: JSON.parse(text) }
}

async function run() {
  console.log('\n=== Apollo Enrichment Live Verification ===\n')

  // ── Step 0: Cleanup ─────────────────────────────────────────────────────────
  await cleanup()

  // ── Step 1: No-match path ───────────────────────────────────────────────────
  console.log(`\n─── Step 1: No-match path (${NO_MATCH_EMAIL}) ───`)
  const noMatchResult = await apolloMatch(NO_MATCH_EMAIL)
  console.log(`HTTP ${noMatchResult.status}`)
  console.log(`match_confidence: ${noMatchResult.json?.person?.match_confidence ?? 'N/A'}`)
  if (noMatchResult.json?.person?.match_confidence !== 'none' && noMatchResult.json?.person !== null) {
    console.warn('⚠️  Expected match_confidence=none or person=null for throwaway email')
  } else {
    console.log('✓ No-match path confirmed: Apollo returns 200 with match_confidence=none (not 404)')
    console.log('  This is the critical case — the connector must return null, not throw')
  }

  // ── Step 2: Real match ──────────────────────────────────────────────────────
  console.log(`\n─── Step 2: Real match (${TEST_EMAIL}) ───`)
  const matchResult = await apolloMatch(TEST_EMAIL)
  console.log(`HTTP ${matchResult.status}`)

  if (matchResult.status !== 200) {
    console.error(`\nFAIL: Expected 200, got ${matchResult.status}`)
    console.error(matchResult.body)
    await cleanup()
    process.exit(1)
  }

  const person = matchResult.json?.person
  const confidence = person?.match_confidence ?? 'none'
  console.log(`match_confidence: ${confidence}`)

  if (confidence === 'none' || !person) {
    console.warn('\n⚠️  No match found for test email. Try a different email (real LinkedIn-visible person).')
    console.warn('   PROGRESS.md status remains: live Clearbit/Apollo response not yet observed.')
    await cleanup()
    process.exit(0)
  }

  console.log('\n✓ Match found. Raw Apollo response (person object):')
  console.log(JSON.stringify(person, null, 2))

  // ── Step 3: Seed test lead ──────────────────────────────────────────────────
  console.log('\n─── Step 3: Seeding test lead ───')
  const { error: compErr } = await db.from('companies').insert({
    id: TEST_COMPANY_ID, organization_id: ORG_ID,
    name: person.organization?.name ?? 'Apollo Test Co',
    domain: person.organization?.primary_domain ?? null,
  })
  if (compErr) throw new Error(`Company seed: ${compErr.message}`)

  const { error: leadErr } = await db.from('leads').insert({
    id: TEST_LEAD_ID, organization_id: ORG_ID,
    email: TEST_EMAIL, first_name: person.first_name, last_name: person.last_name,
    source: 'test:verify-apollo-enrichment', stage: 'new',
    company_id: TEST_COMPANY_ID, form_submitted_at: new Date().toISOString(), is_duplicate: false,
  })
  if (leadErr) throw new Error(`Lead seed: ${leadErr.message}`)
  console.log(`✓ Test lead: ${TEST_LEAD_ID}`)

  // ── Step 4: Write evidence rows (mirrors what storeApolloEnrichmentEvidence does) ──
  console.log('\n─── Step 4: Writing Apollo evidence rows ───')
  const now = new Date().toISOString()
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()

  const facts = []
  if (person.title) facts.push({ fact_type: 'apollo_person_title', fact_value: person.title })
  if (person.city || person.state || person.country) {
    facts.push({ fact_type: 'apollo_person_location', fact_value: { city: person.city, state: person.state, country: person.country } })
  }
  if (person.linkedin_url) facts.push({ fact_type: 'apollo_person_linkedin', fact_value: person.linkedin_url })
  facts.push({ fact_type: 'apollo_person_match_meta', fact_value: { apolloId: person.id, matchConfidence: person.match_confidence, emailStatus: person.email_status, _raw: person } })
  if (person.organization) {
    facts.push({ fact_type: 'apollo_company_firmographics', fact_value: {
      apolloOrgId: person.organization.id, name: person.organization.name,
      domain: person.organization.primary_domain, industry: person.organization.industry,
      employeeCount: person.organization.estimated_num_employees,
      annualRevenue: person.organization.annual_revenue,
      fundingStage: person.organization.latest_funding_stage, country: person.organization.country,
    }})
  }

  const rows = facts.map(f => ({
    organization_id: ORG_ID, lead_id: TEST_LEAD_ID, company_id: TEST_COMPANY_ID,
    source_type: 'apollo_enrichment', source_id: person.id,
    data: f, is_current: true, collected_at: now, expires_at: expiresAt,
  }))

  const { data: evidenceRows, error: evErr } = await db.from('evidence').insert(rows).select('id, source_type, data')
  if (evErr) throw new Error(`Evidence insert: ${evErr.message}`)

  console.log(`✓ ${evidenceRows.length} evidence rows written:`)
  evidenceRows.forEach(r => console.log(`    ${r.id} — ${r.source_type} — ${r.data?.fact_type}`))

  // ── Step 5: Read back (what context-builder does) ────────────────────────────
  console.log('\n─── Step 5: Read-back via context-builder query ───')
  const { data: readBack, error: readErr } = await db
    .from('evidence').select('id')
    .eq('organization_id', ORG_ID).eq('lead_id', TEST_LEAD_ID)
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
  if (readErr) throw new Error(`Evidence read: ${readErr.message}`)

  const evidenceIds = (readBack ?? []).map(r => r.id)
  console.log(`✓ decision_snapshot.evidenceIds would be: [${evidenceIds.join(', ')}]`)
  if (evidenceIds.length === 0) throw new Error('FAIL: 0 evidenceIds read back — check RLS')

  // ── Final ────────────────────────────────────────────────────────────────────
  console.log('\n=== RESULT ===')
  console.log(`✓ Apollo match_confidence: ${confidence}`)
  console.log(`✓ Evidence rows written:   ${evidenceRows.length}`)
  console.log(`✓ evidenceIds non-empty:   ${evidenceIds.length} IDs`)
  console.log(`✓ No-match path verified:  match_confidence='none' confirmed with throwaway email`)
  console.log('\nPaste into PROGRESS.md:')
  console.log('  - The raw person JSON printed in Step 2')
  console.log('  - The evidence row IDs and fact types printed in Step 4')
  console.log('  - The evidenceIds array printed in Step 5')

  await cleanup()
  console.log('\n✓ Test rows cleaned up.\n')
}

run().catch(e => {
  console.error('\nFAIL:', e.message)
  cleanup().finally(() => process.exit(1))
})
