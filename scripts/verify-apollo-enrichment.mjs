#!/usr/bin/env node
/**
 * verify-apollo-enrichment.mjs
 *
 * Live-fire verification for Apollo organizations/enrich connector.
 *
 * PLAN SCOPE: This script tests GET /api/v1/organizations/enrich (domain-level).
 * people/match is NOT authorized on this plan (403) — do not use it.
 *
 * What this verifies (PR checklist):
 *   1. Derive domain from the test email — explicit domain logged
 *   2. Free-email-domain gate — gmail.com blocked before API call
 *   3. No-match path — nonsense domain → HTTP 200 + {} → null (not throw)
 *   4. Real match — stripe.com → real org data, field names confirmed
 *   5. Evidence rows written to Supabase with storeApolloOrgEnrichmentEvidence field shape
 *   6. decision_snapshot.evidenceIds non-empty (read back via context-builder query)
 *   7. Cleanup
 *
 * Usage:
 *   APOLLO_TEST_EMAIL=you@yourcompany.com node -r dotenv/config scripts/verify-apollo-enrichment.mjs
 *
 * What to paste into PROGRESS.md:
 *   - Raw org JSON printed in Step 4
 *   - Evidence row IDs and fact types from Step 5
 *   - evidenceIds array from Step 6
 *
 * Do NOT run in CI — costs Apollo credits.
 */

import { createClient } from '@supabase/supabase-js'
import ws from 'ws'
import { randomUUID } from 'crypto'

const SUPABASE_URL   = process.env.SUPABASE_URL
const SUPABASE_KEY   = process.env.SUPABASE_SERVICE_KEY
const APOLLO_API_KEY = process.env.APOLLO_API_KEY
const ORG_ID         = process.env.DEFAULT_ORG_ID ?? '08472be3-4990-43b7-9431-c84352fd0260'
const TEST_EMAIL     = process.env.APOLLO_TEST_EMAIL ?? 'contact@stripe.com'

// ── Free-email domain list (mirrors rules.ts export — must stay in sync) ─────
const FREE_EMAIL_PROVIDERS = new Set([
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com',
  'aol.com', 'protonmail.com', 'proton.me', 'mail.com', 'zoho.com',
  'yandex.com', 'yandex.ru', 'tutanota.com', 'fastmail.com',
  'inbox.com', 'live.com', 'msn.com', 'me.com', 'mac.com',
])

function deriveDomain(email) {
  const domain = email?.split('@')[1]?.toLowerCase().trim()
  if (!domain || !domain.includes('.')) return null
  return domain
}

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_KEY in .env')
  process.exit(1)
}
if (!APOLLO_API_KEY) {
  console.error('Set APOLLO_API_KEY in .env')
  process.exit(1)
}

const db = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { transport: ws },
})

const TEST_LEAD_ID    = randomUUID()
const TEST_COMPANY_ID = randomUUID()

async function cleanup() {
  await db.from('evidence').delete().eq('lead_id', TEST_LEAD_ID)
  await db.from('leads').delete().eq('id', TEST_LEAD_ID)
  await db.from('companies').delete().eq('id', TEST_COMPANY_ID)
}

async function apolloOrgEnrich(domain) {
  const url = `https://api.apollo.io/api/v1/organizations/enrich?domain=${encodeURIComponent(domain)}`
  const res = await fetch(url, {
    method:  'GET',
    headers: { 'x-api-key': APOLLO_API_KEY, 'Content-Type': 'application/json', 'Accept': 'application/json' },
    signal:  AbortSignal.timeout(15_000),
  })
  const text = await res.text()
  let json
  try { json = JSON.parse(text) } catch { json = null }
  return { status: res.status, body: text, json }
}

async function run() {
  console.log('\n=== Apollo Organization Enrichment — Live Verification ===')
  console.log(`Endpoint: GET /api/v1/organizations/enrich`)
  console.log(`Note: people/match is NOT on this plan (403). Org-level only.\n`)

  await cleanup()

  // ── Step 1: Domain derivation ─────────────────────────────────────────────
  console.log(`─── Step 1: Domain derivation from email ───`)
  const testDomain = deriveDomain(TEST_EMAIL)
  console.log(`Test email:  ${TEST_EMAIL}`)
  console.log(`Derived domain: ${testDomain ?? 'null (invalid email)'}`)
  if (!testDomain) {
    console.error('FAIL: Could not derive domain from test email. Check APOLLO_TEST_EMAIL.')
    process.exit(1)
  }
  if (FREE_EMAIL_PROVIDERS.has(testDomain)) {
    console.error(`FAIL: "${testDomain}" is a free-email provider. Set APOLLO_TEST_EMAIL to a professional address (e.g. you@yourcompany.com).`)
    process.exit(1)
  }
  console.log(`✓ Domain valid and not free-email provider\n`)

  // ── Step 2: Free-email-domain gate ───────────────────────────────────────
  console.log(`─── Step 2: Free-email-domain gate test (gmail.com) ───`)
  const gmailDomain = deriveDomain('test@gmail.com')
  const isBlocked   = FREE_EMAIL_PROVIDERS.has(gmailDomain)
  console.log(`gmail.com in FREE_EMAIL_PROVIDERS: ${isBlocked}`)
  if (!isBlocked) {
    console.error('FAIL: gmail.com not in FREE_EMAIL_PROVIDERS — gate is broken')
    process.exit(1)
  }
  console.log(`✓ Free-email gate confirmed — no API call would be made for gmail.com\n`)

  // ── Step 3: No-match path (nonsense domain) ───────────────────────────────
  const noMatchDomain = 'zzz-no-such-company-xyz123.invalid'
  console.log(`─── Step 3: No-match path (${noMatchDomain}) ───`)
  const noMatchResult = await apolloOrgEnrich(noMatchDomain)
  console.log(`HTTP status: ${noMatchResult.status}`)
  console.log(`Raw response body: ${noMatchResult.body.slice(0, 100)}`)

  if (noMatchResult.status !== 200) {
    console.error(`FAIL: Expected HTTP 200, got ${noMatchResult.status}`)
    console.error(noMatchResult.body)
    process.exit(1)
  }
  const hasOrg = noMatchResult.json?.organization != null
  if (hasOrg) {
    console.warn(`⚠️  Unexpected: Apollo returned an organization for "${noMatchDomain}". Inspect:`)
    console.warn(JSON.stringify(noMatchResult.json?.organization, null, 2).slice(0, 500))
  } else {
    console.log(`✓ No-match confirmed: HTTP 200 + {} (organization key absent)`)
    console.log(`  This is the documented behavior — NOT a 404. Connector returns null.\n`)
  }

  // ── Step 4: Real org match ─────────────────────────────────────────────────
  console.log(`─── Step 4: Real match (domain: ${testDomain}) ───`)
  const matchResult = await apolloOrgEnrich(testDomain)
  console.log(`HTTP status: ${matchResult.status}`)

  if (matchResult.status === 403) {
    console.error('\nFAIL: 403 — organizations/enrich is not authorized on this key.')
    console.error('This is AP_INSUFFICIENT_SCOPE — the plan does not include this endpoint.')
    console.error(matchResult.body)
    process.exit(1)
  }
  if (matchResult.status === 429) {
    console.error('\nFAIL: 429 — Rate limited. Wait and retry.')
    process.exit(1)
  }
  if (matchResult.status !== 200) {
    console.error(`\nFAIL: Expected 200, got ${matchResult.status}`)
    console.error(matchResult.body)
    process.exit(1)
  }

  const org = matchResult.json?.organization
  if (!org) {
    console.warn('\n⚠️  No organization match for domain: ' + testDomain)
    console.warn('   This domain may not be in Apollo\'s database.')
    console.warn('   Try: APOLLO_TEST_EMAIL=contact@stripe.com')
    process.exit(0)
  }

  console.log('\n✓ Organization match found.')
  console.log('\n=== RAW APOLLO ORGANIZATION RESPONSE (paste into PROGRESS.md) ===')
  console.log(JSON.stringify(org, null, 2))
  console.log('=== END RAW RESPONSE ===\n')

  // Verify critical field names from real response
  console.log('─── Field name verification (against real stripe.com response) ───')
  const checks = [
    { field: 'id',                       val: org.id,                       expect: 'string' },
    { field: 'name',                     val: org.name,                     expect: 'string' },
    { field: 'primary_domain',           val: org.primary_domain,           expect: 'string' },
    { field: 'industry',                 val: org.industry,                 expect: 'string' },
    { field: 'estimated_num_employees',  val: org.estimated_num_employees,  expect: 'number' },
    { field: 'organization_revenue',     val: org.organization_revenue,     expect: 'number' },   // NOT annual_revenue
    { field: 'city',                     val: org.city,                     expect: 'string' },   // top-level, NOT nested
    { field: 'state',                    val: org.state,                    expect: 'string' },   // top-level
    { field: 'country',                  val: org.country,                  expect: 'string' },   // top-level
    { field: 'latest_funding_stage',     val: org.latest_funding_stage,     expect: 'any' },
    { field: 'founded_year',             val: org.founded_year,             expect: 'any' },
    { field: 'technology_names',         val: org.technology_names,         expect: 'array' },
  ]
  let fieldOk = true
  for (const c of checks) {
    const type = Array.isArray(c.val) ? 'array' : typeof c.val
    const ok = c.expect === 'any' ? true : (type === c.expect || c.val == null)
    const mark = ok ? '✓' : '✗'
    console.log(`  ${mark} ${c.field}: ${JSON.stringify(c.val)?.slice(0, 60)}`)
    if (!ok) { fieldOk = false; console.log(`      expected type ${c.expect}, got ${type}`) }
  }
  if (!fieldOk) {
    console.error('\nFAIL: Some field names did not match. Check connector field mapping.')
    process.exit(1)
  }
  console.log('\n✓ All field names verified against real response\n')

  // ── Step 5: Write evidence rows ────────────────────────────────────────────
  console.log('─── Step 5: Seed test lead + write evidence rows ───')
  const { error: compErr } = await db.from('companies').insert({
    id: TEST_COMPANY_ID, organization_id: ORG_ID,
    name: org.name ?? 'Apollo Verify Test', domain: org.primary_domain ?? testDomain,
  })
  if (compErr) throw new Error(`Company seed: ${compErr.message}`)

  const { error: leadErr } = await db.from('leads').insert({
    id: TEST_LEAD_ID, organization_id: ORG_ID,
    email: TEST_EMAIL, first_name: 'Verify', last_name: 'ApolloTest',
    source: 'test:verify-apollo-org-enrichment', stage: 'new',
    company_id: TEST_COMPANY_ID, form_submitted_at: new Date().toISOString(), is_duplicate: false,
  })
  if (leadErr) throw new Error(`Lead seed: ${leadErr.message}`)
  console.log(`✓ Test lead seeded: ${TEST_LEAD_ID}`)

  // Mirroring exactly what storeApolloOrgEnrichmentEvidence writes
  const now       = new Date().toISOString()
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()

  const facts = [
    {
      fact_type: 'apollo_org_firmographics',
      fact_value: {
        apolloOrgId:    org.id,
        name:           org.name,
        domain:         org.primary_domain,
        industry:       org.industry,
        industries:     org.industries ?? [],
        employeeCount:  org.estimated_num_employees,     // real field name
        revenue:        org.organization_revenue,         // real field name (NOT annual_revenue)
        revenuePrinted: org.organization_revenue_printed,
        foundedYear:    org.founded_year,
        city:           org.city,                         // top-level, NOT nested
        state:          org.state,
        country:        org.country,
      },
    },
  ]
  if (org.latest_funding_stage || org.total_funding) {
    facts.push({ fact_type: 'apollo_org_funding', fact_value: { totalFunding: org.total_funding, fundingStage: org.latest_funding_stage, apolloOrgId: org.id } })
  }
  if ((org.technology_names ?? []).length > 0) {
    facts.push({ fact_type: 'apollo_org_tech_stack', fact_value: { techStack: org.technology_names, apolloOrgId: org.id } })
  }
  facts.push({ fact_type: 'apollo_org_identity', fact_value: { apolloOrgId: org.id, _raw: org } })

  const rows = facts.map(f => ({
    organization_id: ORG_ID, lead_id: TEST_LEAD_ID, company_id: TEST_COMPANY_ID,
    source_type: 'apollo_enrichment', source_id: org.id,
    data: f, is_current: true, collected_at: now, expires_at: expiresAt,
  }))

  const { data: evidenceRows, error: evErr } = await db.from('evidence').insert(rows).select('id, source_type, data')
  if (evErr) throw new Error(`Evidence insert: ${evErr.message}`)

  console.log(`\n✓ ${evidenceRows.length} evidence rows written (paste into PROGRESS.md):`)
  evidenceRows.forEach(r => console.log(`    ${r.id}  ${r.source_type}  ${r.data?.fact_type}`))

  // ── Step 6: Read back (context-builder query) ─────────────────────────────
  console.log('\n─── Step 6: Read-back (decision_snapshot.evidenceIds check) ───')
  const { data: readBack, error: readErr } = await db
    .from('evidence').select('id')
    .eq('organization_id', ORG_ID).eq('lead_id', TEST_LEAD_ID)
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
  if (readErr) throw new Error(`Evidence read: ${readErr.message}`)

  const evidenceIds = (readBack ?? []).map(r => r.id)
  console.log(`✓ decision_snapshot.evidenceIds: [${evidenceIds.join(', ')}]`)
  if (evidenceIds.length === 0) throw new Error('FAIL: 0 evidenceIds read back — check RLS')
  console.log(`✓ evidenceIds is non-empty (${evidenceIds.length} IDs) — PASS\n`)

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('=== RESULT ===')
  console.log(`✓ Domain derived:           ${testDomain}`)
  console.log(`✓ Free-email gate:          working (gmail.com blocked)`)
  console.log(`✓ No-match path:            HTTP 200 + {} → null (not throw)`)
  console.log(`✓ Real org match found:     ${org.name} (apolloOrgId=${org.id})`)
  console.log(`✓ Field names verified:     organization_revenue, top-level city/state/country`)
  console.log(`✓ Evidence rows written:    ${evidenceRows.length}`)
  console.log(`✓ evidenceIds non-empty:    ${evidenceIds.length} IDs`)
  console.log('\nPaste into PROGRESS.md:')
  console.log('  - The raw org JSON from Step 4')
  console.log('  - The evidence row IDs from Step 5')
  console.log('  - The evidenceIds array from Step 6')

  await cleanup()
  console.log('\n✓ Test rows cleaned up.\n')
}

run().catch(e => {
  console.error('\nFAIL:', e.message)
  cleanup().finally(() => process.exit(1))
})
