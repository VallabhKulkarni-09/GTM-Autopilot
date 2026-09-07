# GTM Autopilot — PROGRESS.md
_Last updated: 2026-09-07_

---

## Current State

```
✅ Schema (migrations 001–013)
✅ Domain types (src/domain/db-types.ts)
✅ 4 connectors: Salesforce, HubSpot, Outreach, Clearbit
✅ Tenant context middleware
✅ Event system (event-log + event-processor)
✅ Qualification agent v1 (rule-based, 10 tests)
✅ Routing agent v1 (rule-based, 10 tests)
✅ Policy engine (9 operators, risk registry, validators)
✅ Webhook receiver (HMAC → idempotency → BullMQ → 200ms)
✅ SLA timer + escalation worker
✅ Action executor (idempotency, try/finally event guarantee, 5 tests)
✅ Evidence store (Clearbit → evidence rows, 30-day expiry, 5 tests)
✅ Context builder (DecisionSnapshot assembly, 2 tests)
✅ LangGraph inbound-lead workflow (4 paths tested)
✅ Dashboard (Next.js 15, 4 pages: overview / leads / lead detail / settings)
```

**Test suite: 75 passing | 0 failing | 25 skipped (live credentials)**

---

## What Was Built This Session

### Wave 3 — PR Reviews + Merges (all APPROVED ✅)
| PR | Key findings |
|---|---|
| `feat/qualification-agent` | All 9 checks pass — null-safe, exact 0.0/1.0 risk/confidence, SCREAMING_SNAKE_CASE |
| `feat/routing-agent` | Territory-first ordering correct, `>= 25` cap (not `> 25`), no-match → `request_human_review` |
| `feat/policy-engine` | All 9 operators, recursive and/or, loads from DB table (not hardcoded) |
| `feat/webhook-receiver` | HMAC first, idempotency via eventId, duplicate → 200 no-enqueue, tenant middleware `/api/*` only |
| `feat/sla-timer` | `form_submitted_at` verified, event before DB update, escalation priority 1, Slack failure doesn't crash |

### Wave 4 — 4 Parallel Builds (all complete ✅)
| Agent | Branch | Files | Tests |
|---|---|---|---|
| action-executor | `feat/action-executor` | `action-executor.ts`, `action-registry.ts`, `action-validator.ts`, `types.ts` | 5/5 pass |
| evidence-store | `feat/evidence-store` | `evidence-store.ts`, `context-builder.ts` | 5/5 pass |
| langgraph-workflow | `feat/langgraph-workflow` | `graph.ts`, `state.ts`, 8 nodes | 4/4 pass |
| dashboard | `feat/dashboard` | 4 pages (overview, leads, lead detail, settings) | TS clean |

---

## Architecture Now (complete)

```
HubSpot webhook
    ↓ HMAC verify + idempotency (webhooks.ts)
    ↓ BullMQ enqueue (inbound-lead.worker.ts)
    ↓
LangGraph: runInboundLeadPlay()
    ↓
[validate]  → dedup check via leadRepo
    ↓
[enrich]    → Clearbit → storeEnrichmentEvidence()
    ↓
[qualify]   → QualificationAgent v1 → ActionExecutor (qualify_lead)
    ↓
[route]     → RoutingAgent v1 → validateAction → ActionExecutor (assign_owner)
    ↓
[first_touch] → ActionExecutor (start_sequence → Outreach)
    ↓
[complete]  → play_instance.status = 'running'
    ↓
SLA timer (every 2 min) → breach? → escalate → Slack

Every step → writeEvent() with DecisionSnapshot (immutable event_log)
```

---

## Files Added This Session

```
src/actions/
  action-executor.ts      — full pipeline with try/finally event guarantee
  action-registry.ts      — ActionType → human label map (for dashboard)
  action-validator.ts     — thin wrapper around policy validators
  action-executor.ts      — executor re-export alias
  validator.ts            — validator re-export alias
  types.ts                — ProposedAction, ActionExecutionResult, ConnectorError

src/evidence/
  evidence-store.ts       — Clearbit → evidence rows (0.9 confidence, 30-day expiry)
  context-builder.ts      — DecisionSnapshot assembly (throws if lead not found)

src/repositories/
  lead.repo.ts            — leadRepo with isDuplicate, getByEmail, update, list

src/agents/
  qualification/index.ts  — QualificationAgent v1 (run + execute alias)
  routing/index.ts        — RoutingAgent v1 (run + execute alias)

src/workflows/inbound-lead/
  state.ts                — WorkflowState type
  graph.ts                — LangGraph StateGraph, runInboundLeadPlay()
  nodes/validate.ts       — dedup check
  nodes/enrich.ts         — Clearbit enrichment
  nodes/qualify.ts        — QualificationAgent execution
  nodes/route.ts          — RoutingAgent + validateAction + executeAction
  nodes/first-touch.ts    — Outreach enrollment
  nodes/mark-duplicate.ts — duplicate terminal state
  nodes/mark-nurture.ts   — nurture terminal state
  nodes/complete.ts       — play complete

dashboard/app/
  dashboard/page.tsx      — overview metrics + speed-to-lead chart
  leads/page.tsx          — paginated lead list with stage filters
  leads/[id]/page.tsx     — event timeline (the audit trail view)
  settings/page.tsx       — connector health + SLA config + routing rules
```

---

## What Remains

```
[ ] End-to-end play test
      — Wire up inbound-lead.worker.ts to call runInboundLeadPlay()
      — Set real env vars (SUPABASE_URL, HUBSPOT_*, SALESFORCE_*, OUTREACH_*, CLEARBIT_*)
      — Submit one real HubSpot form → watch the play run

[ ] Production deploy
      — Railway: deploy Fastify API + BullMQ workers
      — Vercel: deploy dashboard/ (set NEXT_PUBLIC_API_URL + DASHBOARD_JWT)
      — Verify /api/metrics/overview returns real data

[ ] Design partner sandbox goes live
```

---

## Test Count History
| Session | Tests |
|---|---|
| After wave 1+2 merge | 33 passing |
| After wave 3 merge (5 PRs) | 61 passing |
| After wave 4 merge | **75 passing** |
