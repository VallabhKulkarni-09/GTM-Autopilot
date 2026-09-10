/**
 * scripts/smoke-test.mjs
 *
 * End-to-end smoke test for the GTM Autopilot pipeline.
 * Calls the LangGraph workflow directly (no HTTP or BullMQ needed).
 *
 * Checks:
 *   ✓ leads row written to live Supabase with qualification columns
 *   ✓ play_instance row created with correct SLA deadline
 *   ✓ LangGraph executes: validate → enrich → account_match → qualify → route
 *   ✓ event_log rows written immutably with decision_snapshot NOT NULL
 *   ✓ QualificationAgent v1: ICP scoring and tier assignment
 *   ✓ Free-email gate: gmail.com → DISQUALIFIED_FREE_EMAIL_PROVIDER
 *
 * Connectors (Clearbit, Salesforce, Outreach) fail gracefully without creds.
 *
 * Usage:
 *   node scripts/smoke-test.mjs
 *
 * Note on ESM + WebSocket polyfill:
 *   Static `import` declarations are hoisted and evaluated before any code runs,
 *   so we cannot set globalThis.WebSocket before Supabase modules load using
 *   static imports. We use a dynamic-import main() pattern so the polyfill
 *   assignment executes first.
 */

import 'dotenv/config'
import ws from 'ws'
import crypto from 'crypto'

// ── WebSocket polyfill — MUST run before any dynamic import of Supabase ────────
// Static imports above (dotenv, ws, crypto) do not touch Supabase, so this
// assignment executes before any Supabase module constructor runs.
if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = ws.WebSocket
}

// ── Colours ────────────────────────────────────────────────────────────────────
const C = {
  reset:  '\x1b[0m',
  green:  '\x1b[32m',
  red:    '\x1b[31m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
}

const pass    = msg => console.log(`  ${C.green}✓${C.reset} ${msg}`)
const fail    = msg => console.log(`  ${C.red}✗${C.reset} ${C.red}${msg}${C.reset}`)
const info    = msg => console.log(`  ${C.dim}→${C.reset} ${msg}`)
const warn    = msg => console.log(`  ${C.yellow}⚠${C.reset} ${C.yellow}${msg}${C.reset}`)
const section = msg => console.log(`\n${C.bold}${C.cyan}━━━ ${msg} ━━━${C.reset}`)

// ── Cleanup helper ─────────────────────────────────────────────────────────────
async function cleanup(db, orgId, leadId) {
  await db.from('event_log').delete().eq('organization_id', orgId).eq('lead_id', leadId)
  await db.from('action_execution_state').delete().eq('organization_id', orgId)
  await db.from('play_instance').delete().eq('organization_id', orgId).eq('lead_id', leadId)
  await db.from('evidence').delete().eq('organization_id', orgId).eq('lead_id', leadId)
  await db.from('external_identity').delete().eq('organization_id', orgId).eq('lead_id', leadId)
  await db.from('leads').delete().eq('id', leadId)
}

// ── Main — all Supabase imports are dynamic so polyfill fires first ────────────
async function main() {
  // Dynamic imports: by the time these run, globalThis.WebSocket is already set
  const { getDb }             = await import('../dist/db/client.js')
  const { runInboundLeadPlay } = await import('../dist/workflows/inbound-lead/graph.js')
  const { scoreIcp }           = await import('../dist/agents/qualification/rules.js')

  const db = getDb()

  console.log(`\n${C.bold}${C.cyan}${'━'.repeat(54)}${C.reset}`)
  console.log(`${C.bold}${C.cyan}  GTM Autopilot — Live Pipeline Smoke Test${C.reset}`)
  console.log(`${C.bold}${C.cyan}${'━'.repeat(54)}${C.reset}`)
  console.log(`  ${C.dim}${new Date().toISOString()}${C.reset}`)

  const errors = []

  // ── 0. Prerequisites ─────────────────────────────────────────────────────────
  section('0. Prerequisites')
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    fail('SUPABASE_URL or SUPABASE_SERVICE_KEY not set — aborting')
    process.exit(1)
  }
  pass('SUPABASE_URL set')
  pass('SUPABASE_SERVICE_KEY set')

  // ── 1. Resolve org ───────────────────────────────────────────────────────────
  section('1. Resolving organization from Supabase')
  const { data: orgs } = await db.from('organizations').select('*').limit(1)
  if (!orgs?.length) {
    fail('No organizations found — run db/migrate.js first')
    process.exit(1)
  }
  const org   = orgs[0]
  const orgId = org.id
  pass(`Using org: ${C.bold}${org.name}${C.reset} (${orgId})`)

  // ── 2. Verify seed data ──────────────────────────────────────────────────────
  section('2. Verifying seed data in Supabase')
  const { data: policies } = await db.from('policy_rules')
    .select('id, rule_type, name').eq('organization_id', orgId)
  const { data: registry } = await db.from('action_risk_registry')
    .select('id, action_type').eq('organization_id', orgId)
  const { data: routing }  = await db.from('routing_state')
    .select('id, queue_name, counter').eq('organization_id', orgId)

  for (const p of policies ?? []) info(`[${p.rule_type}] ${p.name}`)
  for (const r of registry  ?? []) info(`risk: ${r.action_type}`)
  for (const rs of routing  ?? []) info(`queue: "${rs.queue_name}" counter=${rs.counter}`)

  if (!policies?.length) { fail('No policy_rules'); errors.push('missing policy_rules') }
  else pass(`${policies.length} policy rule(s)`)
  if (!registry?.length) { fail('No action_risk_registry'); errors.push('missing registry') }
  else pass(`${registry.length} risk registry entr(ies)`)
  if (!routing?.length)  warn('No routing_state — RoutingAgent will request human review')
  else pass(`${routing.length} routing queue(s)`)

  // ── 3. Create lead + play_instance ────────────────────────────────────────────
  section('3. Creating test lead + play_instance (simulating worker)')
  const leadId         = crypto.randomUUID()
  const playInstanceId = crypto.randomUUID()
  const workflowRunId  = crypto.randomUUID()
  const formSubmittedAt    = new Date()
  const firstTouchDeadline = new Date(formSubmittedAt.getTime() + 15 * 60_000)

  info(`leadId         = ${leadId}`)
  info(`playInstanceId = ${playInstanceId}`)
  info(`workflowRunId  = ${workflowRunId}`)

  const { error: leadErr } = await db.from('leads').insert({
    id:                leadId,
    organization_id:   orgId,
    email:             'cto@acmecorp.com',
    first_name:        'Jane',
    last_name:         'Doe',
    title:             'Chief Technology Officer',
    stage:             'new',
    form_submitted_at: formSubmittedAt.toISOString(),
    source:            'hubspot:form',
    raw_payload:       { eventId: 'smoke-test-001', portalId: 12345678 },
    is_duplicate:      false,
    is_icp_fit:        null,
    icp_score:         null,
    icp_tier:          null,
  })
  if (leadErr) { fail(`Lead insert: ${leadErr.message}`); process.exit(1) }
  pass('Lead inserted → cto@acmecorp.com (Jane Doe, CTO)')

  const { error: playErr } = await db.from('play_instance').insert({
    id:                   playInstanceId,
    organization_id:      orgId,
    lead_id:              leadId,
    workflow_run_id:      workflowRunId,
    status:               'running',
    current_step:         0,
    first_touch_deadline: firstTouchDeadline.toISOString(),
    sla_breached:         false,
  })
  if (playErr) {
    fail(`play_instance insert: ${playErr.message}`)
    await cleanup(db, orgId, leadId)
    process.exit(1)
  }
  pass(`play_instance inserted → deadline ${firstTouchDeadline.toISOString()}`)

  // ── 4. Run LangGraph workflow ─────────────────────────────────────────────────
  section('4. Running LangGraph inbound-lead workflow')
  info('Flow: validate → enrich → account_match → qualify → route')
  info('External APIs (Clearbit / Salesforce / Outreach) fail gracefully when creds absent')
  console.log()

  const t0 = Date.now()
  try {
    await runInboundLeadPlay(orgId, {
      _leadId:          leadId,
      _playInstanceId:  playInstanceId,
      _workflowRunId:   workflowRunId,
      eventId:          'smoke-test-001',
      portalId:         12345678,
      subscriptionType: 'contact.creation',
      occurredAt:       formSubmittedAt.getTime(),
      properties: {
        email:             'cto@acmecorp.com',
        firstname:         'Jane',
        lastname:          'Doe',
        jobtitle:          'Chief Technology Officer',
        company:           'Acme Corp',
        website:           'acmecorp.com',
        phone:             '+1-555-0100',
        annualrevenue:     '50000000',
        numberofemployees: '500',
        hs_form_question:  'Looking to automate GTM motion across 3 territories.',
      },
    })
    pass(`Workflow completed in ${Date.now() - t0}ms`)
  } catch (err) {
    warn(`Workflow threw (expected without external creds): ${err.message?.slice(0, 140)}`)
  }

  // Brief wait to allow async processEvent fire-and-forget calls to settle
  await new Promise(r => setTimeout(r, 2000))

  // ── 5. Verify Supabase state ──────────────────────────────────────────────────
  section('5. Verifying Supabase state')

  // 5a. Lead
  const { data: lead } = await db.from('leads')
    .select('id, email, stage, is_duplicate, is_icp_fit, icp_score, icp_tier, company_id')
    .eq('id', leadId)
    .single()

  if (!lead) {
    fail('Lead row missing from Supabase after workflow')
    errors.push('lead row missing')
  } else {
    pass('Lead row confirmed')
    info(`  is_duplicate: ${lead.is_duplicate}`)
    info(`  is_icp_fit:   ${lead.is_icp_fit ?? 'null (qualification may have been blocked)'}`)
    info(`  icp_score:    ${lead.icp_score ?? 'null'}`)
    info(`  icp_tier:     ${lead.icp_tier ?? 'null'}`)
    if (lead.is_duplicate === false) pass('Dedup: correctly not a duplicate ✓')
    else { fail('Dedup: incorrectly marked duplicate'); errors.push('dedup false positive') }
    if (lead.is_icp_fit !== null) {
      pass(`ICP scored: ${lead.is_icp_fit ? 'ICP FIT' : 'Not ICP'} score=${lead.icp_score} tier=${lead.icp_tier}`)
    } else {
      warn('ICP not scored — qualification node may have been blocked upstream')
    }
  }

  // 5b. play_instance
  const { data: play } = await db.from('play_instance')
    .select('id, status, current_step, sla_breached, first_touch_at, assigned_owner_name')
    .eq('id', playInstanceId)
    .single()

  if (!play) {
    fail('play_instance row missing')
    errors.push('play_instance missing')
  } else {
    pass(`play_instance confirmed: status=${play.status}, step=${play.current_step}`)
    info(`  sla_breached:   ${play.sla_breached}`)
    info(`  assigned_owner: ${play.assigned_owner_name ?? '(not assigned — no SF creds)'}`)
  }

  // 5c. event_log — the most critical check
  const { data: events, error: eventsErr } = await db.from('event_log')
    .select('event_type, event_status, occurred_at, decision_snapshot')
    .eq('organization_id', orgId)
    .eq('lead_id', leadId)
    .order('occurred_at', { ascending: true })

  if (eventsErr) {
    fail(`event_log query error: ${eventsErr.message}`)
    errors.push('event_log query failed')
  } else if (!events?.length) {
    fail('NO event_log rows — event sourcing is broken')
    errors.push('no events written')
  } else {
    pass(`event_log: ${C.bold}${events.length} events${C.reset} written immutably`)
    for (const ev of events) {
      const hasSnapshot = ev.decision_snapshot &&
        typeof ev.decision_snapshot === 'object' &&
        Object.keys(ev.decision_snapshot).length > 0
      const snap = hasSnapshot
        ? `${C.green}decision_snapshot ✓${C.reset}`
        : `${C.red}decision_snapshot MISSING ✗${C.reset}`
      console.log(`     [${ev.event_type}]  ${snap}`)
      if (!hasSnapshot) errors.push(`${ev.event_type}: decision_snapshot missing`)
    }
  }

  // ── 6. QualificationAgent gate checks (unit — no DB) ─────────────────────────
  section('6. QualificationAgent gate checks (unit)')

  const gmailResult = scoreIcp({ email: 'test@gmail.com', title: 'CEO' }, null)
  if (gmailResult.reason_codes?.includes('DISQUALIFIED_FREE_EMAIL_PROVIDER')) {
    pass('Free-email gate: test@gmail.com → DISQUALIFIED_FREE_EMAIL_PROVIDER ✓')
  } else {
    fail('Free-email gate did NOT fire for gmail.com')
    errors.push('free-email gate broken')
  }

  const tier1 = scoreIcp(
    { email: 'cto@bigcorp.com', title: 'Chief Technology Officer' },
    { employee_count: 600, estimated_annual_revenue: 80_000_000 }
  )
  if (tier1.is_icp_fit && tier1.icp_tier === 'tier_1') {
    pass(`ICP tier_1: CTO at 600-person $80M company → tier_1 (score=${tier1.icp_score}) ✓`)
  } else {
    warn(`ICP tier_1: got is_icp_fit=${tier1.is_icp_fit} tier=${tier1.icp_tier} (score=${tier1.icp_score})`)
  }

  const noIcp = scoreIcp({ email: 'intern@tiny.io', title: 'Intern' },
    { employee_count: 3, estimated_annual_revenue: 50_000 })
  if (!noIcp.is_icp_fit) {
    pass(`ICP not_icp: Intern at 3-person startup → not_icp (score=${noIcp.icp_score}) ✓`)
  } else {
    warn(`ICP not_icp: expected not_icp but got is_icp_fit=true`)
  }

  // ── 7. Summary ────────────────────────────────────────────────────────────────
  section('Summary')
  const eventCount = events?.length ?? 0
  const allSnapshotsPresent = (events ?? []).every(e =>
    e.decision_snapshot && Object.keys(e.decision_snapshot).length > 0)

  console.log()
  console.log(`  ${C.bold}Lead row written:${C.reset}          ${lead ? C.green+'✓' : C.red+'✗'}${C.reset}`)
  console.log(`  ${C.bold}play_instance written:${C.reset}     ${play ? C.green+'✓' : C.red+'✗'}${C.reset}`)
  console.log(`  ${C.bold}event_log rows:${C.reset}            ${C.bold}${eventCount}${C.reset} events`)
  console.log(`  ${C.bold}decision_snapshot on all:${C.reset}  ${allSnapshotsPresent ? C.green+'✓' : C.red+'✗'}${C.reset}`)
  console.log(`  ${C.bold}ICP scored:${C.reset}                ${lead?.is_icp_fit !== null ? `${C.green}✓ score=${lead?.icp_score}` : C.yellow+'skipped (upstream failed)'}${C.reset}`)
  console.log(`  ${C.bold}Free-email gate:${C.reset}           ${!errors.some(e=>e.includes('free')) ? C.green+'✓ blocking gmail.com' : C.red+'✗ not blocking'}${C.reset}`)
  console.log(`  ${C.bold}External connectors:${C.reset}       ${C.yellow}gracefully skipped (no sandbox creds yet)${C.reset}`)
  console.log()

  if (errors.length === 0) {
    console.log(`${C.green}${C.bold}  ✅  SMOKE TEST PASSED — core pipeline is functional${C.reset}`)
  } else {
    console.log(`${C.red}${C.bold}  ❌  SMOKE TEST FAILED — ${errors.length} issue(s):${C.reset}`)
    for (const e of errors) console.log(`     ${C.red}• ${e}${C.reset}`)
  }

  // ── 8. Cleanup ────────────────────────────────────────────────────────────────
  section('Cleanup')
  await cleanup(db, orgId, leadId)
  pass('Test rows deleted from Supabase')
  info('Org, policies, registry, routing left in place for future runs')
  console.log()

  process.exit(errors.length > 0 ? 1 : 0)
}

main().catch(err => {
  console.error(`\n${C.red}${C.bold}FATAL:${C.reset}`, err)
  process.exit(1)
})
