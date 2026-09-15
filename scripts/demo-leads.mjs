/**
 * demo-leads.mjs — Runs 7 realistic lead scenarios through the production workflow.
 *
 * No Clearbit needed: company data is seeded directly on the lead + company rows.
 * No Outreach needed: system gracefully skips sequence enrollment.
 * Salesforce: if SF creds set → owner assignment + task creation in SF.
 *             if not set → assignment recorded in DB, SF call skipped.
 *
 * Each scenario exercises a different code path:
 *   1. Happy path — tier_1 ICP, gets assigned to rep 1
 *   2. Happy path — tier_2 ICP, gets assigned to rep 2 (round-robin)
 *   3. Not ICP — company too small → auto-nurture
 *   4. Free email gate — gmail.com → instant disqualify
 *   5. Duplicate — same email as Lead 1 → caught before CRM
 *   6. SLA breach — backdated form_submitted_at → SLA timer will fire
 *   7. Human review — EMEA territory, only EMEA rep available (no NA rep left after round-robin)
 *
 * Usage:
 *   node scripts/demo-leads.mjs [--keep]
 *   --keep: don't delete test rows after the run (useful for dashboard demo)
 */

import 'dotenv/config'
import { randomUUID } from 'crypto'

const KEEP = process.argv.includes('--keep')

// ── Polyfill + dynamic imports ───────────────────────────────────────────────
await import('ws').then(({ default: ws }) => { globalThis.WebSocket = ws.WebSocket ?? ws })
const { getDb }                = await import('../dist/db/client.js')
const { runInboundLeadPlay }   = await import('../dist/workflows/inbound-lead/graph.js')

const db  = getDb()
const ORG_ID = process.env.DEFAULT_ORG_ID ?? (
  await db.from('organizations').select('id').limit(1).single()
    .then(r => r.data?.id)
)

if (!ORG_ID) { console.error('❌ No org found'); process.exit(1) }

console.log(`\n${'━'.repeat(58)}`)
console.log(`  GTM Autopilot — Real-World Demo Run`)
console.log(`  Org: ${ORG_ID}`)
console.log(`${'━'.repeat(58)}\n`)

// ── Helper: insert a lead + company row directly (no Clearbit needed) ────────
async function seedLead({ firstName, lastName, email, title, source = 'demo_request',
  company, submittedMinsAgo = 1 }) {

  const leadId    = randomUUID()
  const companyId = randomUUID()
  const now       = new Date()
  const submittedAt = new Date(now.getTime() - submittedMinsAgo * 60 * 1000).toISOString()

  // Insert company row (provides enrichment data to QualificationAgent)
  if (company) {
    await db.from('companies').insert({
      id:              companyId,
      organization_id: ORG_ID,
      name:            company.name,
      domain:          company.domain,
      industry:        company.industry,
      employee_count:  company.employeeCount,
      country:         company.country ?? 'US',
      annual_revenue:  company.annualRevenue ?? null,
    })
  }

  // Insert lead row
  await db.from('leads').insert({
    id:               leadId,
    organization_id:  ORG_ID,
    email,
    first_name:       firstName,
    last_name:        lastName,
    title,
    company_id:       company ? companyId : null,
    stage:            'new',
    form_submitted_at: submittedAt,
    source,
    is_duplicate:     false,
    is_icp_fit:       null,
    icp_score:        null,
    icp_tier:         null,
    raw_payload: {
      firstName, lastName, email, title,
      company: company?.name,
      website: company?.domain ? `https://${company.domain}` : null,
    }
  })

  // Insert play_instance (SLA deadline = form_submitted_at + 15 min)
  const playInstanceId = randomUUID()
  const workflowRunId  = randomUUID()
  const deadline = new Date(new Date(submittedAt).getTime() + 15 * 60 * 1000).toISOString()

  await db.from('play_instance').insert({
    id:                   playInstanceId,
    organization_id:      ORG_ID,
    lead_id:              leadId,
    play_type:            'high_intent_inbound',
    status:               'running',
    workflow_run_id:      workflowRunId,
    first_touch_deadline: deadline,
    sla_breached:         false,
  })

  return { leadId, companyId, playInstanceId, workflowRunId, submittedAt }
}

// ── Run one scenario ─────────────────────────────────────────────────────────
const created = [] // track for cleanup

async function runScenario(num, label, leadData, expectedOutcome) {
  console.log(`\n  Lead ${num}: ${label}`)
  console.log(`  ${'─'.repeat(52)}`)
  console.log(`  Email: ${leadData.email}`)
  if (leadData.company) {
    console.log(`  Company: ${leadData.company.name} (${leadData.company.employeeCount} employees, ${leadData.company.industry}, ${leadData.company.country ?? 'US'})`)
  }
  console.log(`  Title: ${leadData.title ?? '(none)'}`)
  console.log(`  Expected: ${expectedOutcome}`)
  console.log()

  const start = Date.now()

  try {
    const { leadId, companyId, playInstanceId, workflowRunId, submittedAt }
      = await seedLead(leadData)

    created.push({ leadId, companyId, playInstanceId })

    // Load company from DB so workflow state has it (simulates what worker does)
    const { data: companyRow } = leadData.company
      ? await db.from('companies').select('*').eq('id', companyId).single()
      : { data: null }

    // Load lead from DB
    const { data: leadRow } = await db.from('leads').select('*').eq('id', leadId).single()


    // runInboundLeadPlay(orgId, hubspotPayload) — the payload carries the pre-created IDs
    // and lead fields under properties (mirrors what the BullMQ worker passes)
    const hubspotPayload = {
      _leadId:         leadId,
      _playInstanceId: playInstanceId,
      _workflowRunId:  workflowRunId,
      occurredAt:      submittedAt,
      subscriptionType: 'form.submitted',
      properties: {
        email:      leadData.email,
        firstname:  leadData.firstName,
        lastname:   leadData.lastName,
        jobtitle:   leadData.title ?? '',
        company:    leadData.company?.name ?? '',
        website:    leadData.company?.domain ? `https://${leadData.company.domain}` : '',
        // Embed company data so the enrich node (when Clearbit absent) has something
        // to work with — QualificationAgent reads from state.company
        _preloadedCompany: companyRow ?? null,
      }
    }

    await runInboundLeadPlay(ORG_ID, hubspotPayload)
    const elapsed = ((Date.now() - start) / 1000).toFixed(1)

    // Read back final state
    const { data: finalLead }    = await db.from('leads').select('is_icp_fit,icp_score,icp_tier,stage').eq('id', leadId).single()
    const { data: finalPlay }    = await db.from('play_instance').select('status,assigned_owner_id,assigned_owner_name,sla_breached,pending_approval_since').eq('id', playInstanceId).single()
    const { data: events }       = await db.from('event_log').select('event_type,event_status').eq('play_instance_id', playInstanceId).order('occurred_at')
    const { data: execState }    = await db.from('action_execution_state').select('action_type,status,external_system,output').eq('play_instance_id', playInstanceId)

    const failedEvents = (events ?? []).filter(e => e.event_status === 'failed')

    console.log(`  ✓ ICP: score=${finalLead?.icp_score ?? 'n/a'} tier=${finalLead?.icp_tier ?? 'n/a'} fit=${finalLead?.is_icp_fit}`)
    console.log(`  ✓ Stage: ${finalLead?.stage}`)
    console.log(`  ✓ Play status: ${finalPlay?.status}`)
    if (finalPlay?.assigned_owner_name) {
      console.log(`  ✓ Assigned to: ${finalPlay.assigned_owner_name}`)
    }
    if (finalPlay?.pending_approval_since) {
      console.log(`  ✓ Pending human review since: ${finalPlay.pending_approval_since}`)
    }
    if (finalPlay?.sla_breached) {
      console.log(`  ✓ SLA breached: YES`)
    }

    const sfExec = (execState ?? []).find(e => e.action_type === 'assign_owner')
    if (sfExec) {
      const sfSynced = sfExec.output?.sf_synced
      console.log(`  ✓ SF sync: ${sfSynced ? '✅ synced' : '⚠️  skipped (no SF creds — recorded in DB)'}`)
    }

    console.log(`  ✓ Events: ${events?.length ?? 0} immutable rows | Failures: ${failedEvents.length}`)
    console.log(`  ✓ Time: ${elapsed}s`)

    if (failedEvents.length > 0) {
      console.log(`  ⚠️  Failed events: ${failedEvents.map(e => e.event_type).join(', ')}`)
    }

  } catch (err) {
    console.log(`  ❌ ERROR: ${err.message}`)
  }
}

// ═══════════════════════════════════════════════════════════════════
//  THE 7 SCENARIOS
// ═══════════════════════════════════════════════════════════════════

// 1. Enterprise CTO — tier_1, happy path, assigned to rep 1
await runScenario(1,
  'Sarah Chen — Enterprise CTO (Happy Path, Tier 1)',
  {
    firstName: 'Sarah', lastName: 'Chen', email: 'sarah.chen@cloudbase.io',
    title: 'Chief Technology Officer',
    source: 'demo_request',
    company: { name: 'CloudBase Inc', domain: 'cloudbase.io', industry: 'SaaS', employeeCount: 800, country: 'US' }
  },
  'tier_1 ICP → assigned to Rep 1 (SF task created if creds set)'
)

// 2. VP Sales, mid-market — tier_2, round-robin to rep 2
await runScenario(2,
  'Marcus Webb — VP Sales, Mid-Market (Happy Path, Tier 2)',
  {
    firstName: 'Marcus', lastName: 'Webb', email: 'marcus.webb@dataflow.com',
    title: 'VP of Sales',
    source: 'demo_request',
    company: { name: 'DataFlow Systems', domain: 'dataflow.com', industry: 'Technology', employeeCount: 250, country: 'US' }
  },
  'tier_2 ICP → assigned to Rep 2 via round-robin'
)

// 3. Startup founder, 8 employees — not_icp, auto-nurture
await runScenario(3,
  'Priya Nair — Startup Founder (Too Small → Nurture)',
  {
    firstName: 'Priya', lastName: 'Nair', email: 'priya@tinystartup.io',
    title: 'Founder & CEO',
    source: 'demo_request',
    company: { name: 'TinyStartup', domain: 'tinystartup.io', industry: 'Technology', employeeCount: 8, country: 'US' }
  },
  'not_icp (too small) → auto-nurture, no rep time wasted'
)

// 4. Free email — instant gate rejection
await runScenario(4,
  'Anonymous — Free Email Address (Instant Gate)',
  {
    firstName: 'Test', lastName: 'User', email: 'testuser123@gmail.com',
    title: null,
    source: 'demo_request',
    company: null
  },
  'DISQUALIFIED_FREE_EMAIL_PROVIDER → nurture, score=0'
)

// 5. Duplicate — same email as Lead 1
await runScenario(5,
  'Sarah Chen — DUPLICATE submission (same email as Lead 1)',
  {
    firstName: 'Sarah', lastName: 'Chen', email: 'sarah.chen@cloudbase.io',
    title: 'CTO',
    source: 'demo_request',
    company: { name: 'CloudBase Inc', domain: 'cloudbase.io', industry: 'SaaS', employeeCount: 800, country: 'US' }
  },
  'is_duplicate=true → play_instance.status=duplicate, CRM untouched'
)

// 6. SLA breach — backdated 20 min ago (SLA timer will catch this)
await runScenario(6,
  'Alex Torres — ICP Lead (SLA Breach in Progress)',
  {
    firstName: 'Alex', lastName: 'Torres', email: 'alex.torres@retailmega.com',
    title: 'Director of Operations',
    source: 'demo_request',
    submittedMinsAgo: 22,  // 22 min ago → already past 15 min SLA
    company: { name: 'RetailMega Corp', domain: 'retailmega.com', industry: 'SaaS', employeeCount: 5000, country: 'US' }
  },
  'tier_2 ICP → assigned, but first_touch_deadline already passed → SLA timer will breach'
)

// 7. Human review — EMEA lead, no EMEA owner free (territory mismatch for all NA owners)
await runScenario(7,
  'Jamie Park — EMEA Lead (Human Review Required)',
  {
    firstName: 'Jamie', lastName: 'Park', email: 'jamie.park@scalesaas.co.uk',
    title: 'Head of Growth',
    source: 'demo_request',
    company: { name: 'ScaleSaaS Ltd', domain: 'scalesaas.co.uk', industry: 'SaaS', employeeCount: 400, country: 'GB' }
  },
  'ICP fit but country=GB, no EMEA territory owner available → request_human_review'
)

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${'━'.repeat(58)}`)
console.log(`  Demo run complete. Run  node scripts/demo-verify.mjs  for`)
console.log(`  the full proof report.`)
if (KEEP) {
  console.log(`  --keep flag set: demo rows left in Supabase for dashboard.`)
} else {
  console.log(`\n  Cleaning up demo rows from Supabase...`)
  for (const { leadId, companyId, playInstanceId } of created) {
    await db.from('event_log').delete().eq('play_instance_id', playInstanceId)
    await db.from('action_execution_state').delete().eq('play_instance_id', playInstanceId)
    await db.from('play_instance').delete().eq('id', playInstanceId)
    await db.from('leads').delete().eq('id', leadId)
    if (companyId) await db.from('companies').delete().eq('id', companyId)
  }
  console.log(`  ✓ Cleaned up ${created.length} demo leads.`)
  console.log(`  Tip: use  --keep  to leave rows in DB for dashboard viewing.`)
}
console.log(`${'━'.repeat(58)}\n`)
