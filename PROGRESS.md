# PROGRESS.md — GTM Autopilot

> Append-only log. Each session adds a block. Never edit past entries.

---

## Session 1 — Schema + Types (Completed)

**Goal:** Deploy all 13 tables to Supabase, generate TypeScript types.

**Completed:**
- ✅ Applied all 13 table migrations to Supabase (organizations → routing_state)
- ✅ All tables include organization_id (Rule #1)
- ✅ event_log verified immutable in schema (no UPDATE/DELETE triggers)
- ✅ Generated `src/domain/db-types.ts` from live schema
- ✅ Merged to main

---

## Session 2 — Connectors + Infrastructure (Completed)

**Goal:** Build 4 connectors, tenant middleware, event system.

**Completed — 6 branches built and merged to main:**

| Branch | Files | Tests |
|--------|-------|-------|
| `feat/connector-salesforce` | salesforce.connector.ts, types, errors | 9 tests (credential-gated) |
| `feat/connector-hubspot` | hubspot.connector.ts, types, errors | 12 tests (5 skipped) |
| `feat/connector-outreach` | outreach.connector.ts, types, errors | 7 tests (credential-gated) |
| `feat/connector-clearbit` | clearbit.connector.ts, types, errors | 9 tests (4 skipped) |
| `feat/tenant-middleware` | tenant-context.ts, types.ts | 11 security tests |
| `feat/event-system` | event-log.ts, event-processor.ts, event.types.ts, repository | 10 unit tests |

**Key contracts enforced:**
- Every connector: `ConnectorError` only, `withRetry` on 429/503, `idempotencyKey` param
- HubSpot: `verifyWebhookSignature` is **sync** (crypto.createHmac)
- Clearbit: returns `null` on 404/202, throws `ConnectorError` only on 5xx
- Tenant middleware: `organization_id` from JWT only — never body/query/params
- Event log: throws before DB write if `decisionSnapshot` is null
- Cross-tenant: all 11 security tests return 404 (not 403)

---

## Session 3 — Agent Layer (In Progress)

**Goal:** Build 5 service layers — Qualification, Routing, Policy Engine, Webhook Receiver, SLA Timer.

**Status: 5 branches built and pushed — awaiting PR review + merge**

| Branch | Files | Tests | Status |
|--------|-------|-------|--------|
| `feat/qualification-agent` | qualification/index.ts, rules.ts, types.ts | 10 unit tests ✅ | Pushed |
| `feat/routing-agent` | routing/index.ts, rules.ts, types.ts | 10 unit tests ✅ | Pushed |
| `feat/policy-engine` | policy-engine.ts, validators.ts, types.ts | 8 unit tests ✅ | Pushed |
| `feat/webhook-receiver` | app.ts, server.ts, routes/webhooks.ts, routes/api/* | (integration) | Pushed |
| `feat/sla-timer` | queue/setup.ts, jobs/sla-timer.ts, workers/* | (integration) | Pushed |

**Test Results (current main + all merged):**
```
Test Files: 7 passed | 2 skipped (9)
Tests:      61 passed | 25 skipped (86)
Skipped:    credential-gated (Salesforce, Outreach live tests)
```

**Key contracts enforced:**
- QualificationAgent: score 0–100, tier_1/tier_2/not_icp, reason_codes[]
- RoutingAgent: territory → workload (max 25) → round-robin via routing_state
- PolicyEngine: 9 operators (in/not_in/eq/neq/gte/lte/contains/and/or)
- Webhook: HMAC first → idempotency → BullMQ → 200 within 200ms
- SLA timer: form_submitted_at deadline ALWAYS (detects + skips created_at-based deadlines)
- Escalation: Slack fails → event still written (never crash on Slack)

---

## What's Left

```
⬜ PR review + merge (5 branches above)
⬜ Action executor (Salesforce assign + Outreach enroll)
⬜ LangGraph workflow (connects agent pipeline)
⬜ Evidence store + context builder
⬜ Dashboard (Next.js 15)
⬜ End-to-end play test
```

---

## Environment Variables Required

```
# Connectors (skip tests until added)
SF_CLIENT_ID, SF_CLIENT_SECRET, SF_INSTANCE_URL, SF_SANDBOX
HUBSPOT_API_KEY, HUBSPOT_WEBHOOK_SECRET
OUTREACH_API_KEY
CLEARBIT_API_KEY

# Infrastructure (required to run)
JWT_SECRET                  # min 32 chars
REDIS_URL                   # BullMQ
SUPABASE_URL
SUPABASE_SERVICE_KEY

# Escalation
SLACK_WEBHOOK_URL           # optional — Slack notification on SLA breach
DEFAULT_ORG_ID              # fallback org for HubSpot webhooks without portalId
```
