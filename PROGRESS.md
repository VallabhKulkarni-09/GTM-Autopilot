# GTM Autopilot — Build Progress

> This file is updated after every session.
> It is the handoff document between sessions.
> Any LLM or agent reading this must treat it as current state.

---

## How to Use This File

**At the start of every session:**
Read this file completely before doing anything.
The "Current State" and "Next Tasks" sections define what to work on.

**At the end of every session:**
Update this file with exactly what was built, what passed review,
what is blocked, and what comes next.

---

## Current State

```
Status:        PLANNING COMPLETE — NOT STARTED
Last updated:  [DATE OF FIRST SESSION]
Last session:  Setup session — no code written yet
Active branch: none
```

---

## Dependency Map

Use this to understand what can be built in parallel and what must wait.

```
[ ] Schema + Migrations
        │
        ├──→ [ ] Domain types (generated from schema)
        │
        └──→ [ ] Repositories (need tables)
                        │
                        └──→ [ ] Tenant middleware (needs organizations table)
                                        │
                        ┌──────────────┼──────────────────┐
                        │              │                   │
                        ▼              ▼                   ▼
                [ ] SF connector  [ ] HS connector  [ ] Event system
                [ ] Outreach      [ ] Clearbit
                  connector         connector
                        │              │                   │
                        └──────────────┼───────────────────┘
                                       ▼
                              [ ] Webhook receiver
                                       │
                                       ▼
                              [ ] BullMQ queue + workers
                                       │
                              ┌────────┼────────┐
                              ▼        ▼        ▼
                      [ ] Qual    [ ] Route  [ ] Policy
                        Agent       Agent    Engine
                              │        │
                              └────────┘
                                   │
                                   ▼
                         [ ] Action executor
                                   │
                                   ▼
                         [ ] SLA timer job
                                   │
                                   ▼
                         [ ] Full play E2E test
                                   │
                                   ▼
                         [ ] Dashboard
```

---

## What Has Been Built

### Session 1 — [DATE]
*No sessions completed yet. Update this after first session.*

---

## What Passed Review

*Nothing yet.*

---

## What Is Blocked

*Nothing yet.*

---

## Next Tasks

These are the first things to build. They can all run in parallel.

### Task 1: Schema + Migrations
**Agent:** `schema-builder`
**Depends on:** nothing
**Branch:** `feat/schema`

Build all 13 migration files in /db/migrations/ in order:
```
001_organizations.sql
002_leads.sql
003_companies.sql
004_external_identity.sql
005_evidence.sql
006_policy_rules.sql
007_action_risk_registry.sql
008_play_instance.sql
009_event_log.sql
010_action_execution_state.sql
011_connector_config.sql
012_routing_state.sql
013_rls_policies.sql
```
Run all migrations in Supabase via MCP.
Generate TypeScript types → /src/domain/db-types.ts.
Confirm every table has organization_id.
Confirm event_log has NO updated_at.
Confirm decision_snapshot is JSONB NOT NULL on event_log.

**Done when:** All 13 migrations run successfully. TypeScript types generated.

---

### Task 2: Salesforce Connector
**Agent:** `salesforce-connector`
**Depends on:** domain types from Task 1
**Branch:** `feat/connector-salesforce`

Build /src/connectors/salesforce/ with all 6 methods.
Tests run against SF sandbox. All methods covered.

**Done when:** All tests pass with real sandbox credentials.

---

### Task 3: HubSpot Connector
**Agent:** `hubspot-connector`
**Depends on:** domain types from Task 1
**Branch:** `feat/connector-hubspot`

Build /src/connectors/hubspot/ with all 4 methods including webhook HMAC verification.
verifyWebhookSignature is synchronous (not async).

**Done when:** All tests pass. HMAC verification correctly rejects invalid signatures.

---

### Task 4: Outreach Connector
**Agent:** `outreach-connector`
**Depends on:** domain types from Task 1
**Branch:** `feat/connector-outreach`

Build /src/connectors/outreach/ with all 5 methods.

**Done when:** All tests pass with real sandbox credentials.

---

### Task 5: Clearbit Connector
**Agent:** `clearbit-connector`
**Depends on:** domain types from Task 1
**Branch:** `feat/connector-clearbit`

Build /src/connectors/clearbit/ with enrichByEmail and enrichByDomain.
Both methods return null (not throw) when no data is found.

**Done when:** Both methods tested. Null return on not-found verified.

---

## Review Checklist

When reviewing any agent output, check these before approving:

**Schema:**
- [ ] organization_id present on every table
- [ ] event_log has NO updated_at column
- [ ] decision_snapshot is JSONB NOT NULL on event_log
- [ ] RLS policies created in 013_rls_policies.sql
- [ ] All migrations ran successfully in Supabase

**Connectors:**
- [ ] Every write method has an idempotencyKey parameter
- [ ] Every catch block throws ConnectorError (not raw Error)
- [ ] ConnectorError includes: source, code, statusCode, raw
- [ ] Tests run against real sandbox (not mocked)
- [ ] Retry logic correctly configured (retry 429/503, not 400/401/403/404)

**Agents:**
- [ ] Returns ProposedAction (not direct connector call)
- [ ] reason_codes are SCREAMING_SNAKE_CASE and specific
- [ ] decision_risk_score: 0.0 for v1 rule-based agents
- [ ] raw_confidence: 1.0 for v1 rule-based agents
- [ ] Minimum 10 evaluation cases present and passing
- [ ] Handles null company gracefully (enrichment may fail)

**API:**
- [ ] organization_id extracted from JWT (not from request body)
- [ ] Webhook handler returns 200 within 200ms
- [ ] No synchronous processing in webhook handler
- [ ] Input validated with Fastify schema

**Events:**
- [ ] Three events per action: proposed, started, succeeded/failed
- [ ] No UPDATE statements on event_log
- [ ] decision_snapshot populated on every event write

**Security:**
- [ ] Cross-tenant isolation tests written
- [ ] All 5 cross-tenant scenarios tested
- [ ] All tests return 404 (not 403) on cross-tenant access

---

## Known Decisions

These decisions are final. Do not revisit without flagging first.

| Decision | Reason |
|---|---|
| Provider IDs in external_identity table, not on leads | Vendor-independent canonical model |
| event_log is immutable (three separate events) | True audit trail, enables replay |
| SLA deadline = form_submitted_at + policy_minutes | Prospect clock, not system clock |
| Round-robin via routing_state table | Deterministic, not random, survives restarts |
| Rule-based agents in MVP (no LLM) | Reliability over cleverness. LLM in v2 after golden dataset exists. |
| Fastify over Express | Performance + TypeScript + schema validation |
| pgvector over Pinecone | No separate DB until semantic search is proven necessary |

---

## Environment Variables Required

```
# Database
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
SUPABASE_ANON_KEY=

# Salesforce
SF_INSTANCE_URL=
SF_CLIENT_ID=
SF_CLIENT_SECRET=
SF_SANDBOX=true

# HubSpot
HUBSPOT_API_KEY=
HUBSPOT_WEBHOOK_SECRET=

# Outreach
OUTREACH_API_KEY=

# Clearbit
CLEARBIT_API_KEY=

# Queue
REDIS_URL=

# Slack (for escalation notifications)
SLACK_WEBHOOK_URL=
SLACK_ESCALATION_CHANNEL=

# App
JWT_SECRET=
API_URL=
NODE_ENV=development
```

---

## Session Log

| Session | Date | What Was Built | What Passed Review | Blockers |
|---------|------|---------------|-------------------|----------|
| 0 | [DATE] | Planning only. All MD files created. | — | — |

---

*Update this file at the end of every session.*
*The next session starts by reading this file.*
