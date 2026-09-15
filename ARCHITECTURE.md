# GTM Autopilot — Technical Architecture

> End-to-end technical reference. How the system actually works, layer by layer.

---

## Table of Contents

1. [What This System Does](#1-what-this-system-does)
2. [High-Level Data Flow](#2-high-level-data-flow)
3. [Tech Stack](#3-tech-stack)
4. [Database Schema](#4-database-schema)
5. [Inbound Entry Point — Webhook Receiver](#5-inbound-entry-point--webhook-receiver)
6. [Queue Layer — BullMQ Workers](#6-queue-layer--bullmq-workers)
7. [LangGraph Workflow — The Core Pipeline](#7-langgraph-workflow--the-core-pipeline)
8. [Agents](#8-agents)
9. [Action Pipeline (Proposed → Validated → Executed)](#9-action-pipeline-proposed--validated--executed)
10. [Event Sourcing — The Audit Layer](#10-event-sourcing--the-audit-layer)
11. [Connectors](#11-connectors)
12. [SLA Timer](#12-sla-timer)
13. [REST API](#13-rest-api)
14. [Dashboard](#14-dashboard)
15. [Security & Multi-Tenancy](#15-security--multi-tenancy)
16. [Key Design Decisions](#16-key-design-decisions)

---

## 1. What This System Does

GTM Autopilot is a **governed decision layer** that sits above your CRM, sales engagement tool, and enrichment provider. It does one thing: takes an inbound lead from HubSpot form submission and — within 15 minutes — enriches it, qualifies it against your ICP, assigns the right owner, and enrolls them in an Outreach sequence. Every decision is logged immutably with a full decision snapshot so any action can be replayed or audited.

It is not a CRM. It is not a sales engagement tool. It is the rules engine and event log that governs them.

**MVP Play (the only one in scope):**
```
HubSpot form fill
  → enrich (Clearbit)
  → qualify (ICP scoring)
  → route (territory + round-robin)
  → enroll in Outreach sequence
  → SLA breach detection every 2 minutes
```

---

## 2. High-Level Data Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           INBOUND LEAD JOURNEY                               │
└─────────────────────────────────────────────────────────────────────────────┘

HubSpot Form Submission
        │
        ▼
POST /webhooks/hubspot
  1. Verify HMAC-SHA256 signature           ← rejects unsigned payloads instantly
  2. Check event idempotency (event_id)     ← prevents duplicate processing
  3. Enqueue BullMQ job                     ← non-blocking
  4. Return HTTP 200 in < 200ms             ← HubSpot sees success immediately
        │
        ▼
BullMQ Job: 'process-inbound-lead'  (Redis-backed queue)
  - Resolve organization from HubSpot portal ID
  - Insert leads row  (canonical lead entity)
  - Insert play_instance row  (tracks this lead's journey)
  - Call runInboundLeadPlay(orgId, payload)
        │
        ▼
LangGraph StateGraph  (directed acyclic graph of async nodes)
        │
        ├── [validate]       dedup check
        │       ├─ dup?  → [mark_duplicate] → END
        │       └─ new?  → [enrich]
        │
        ├── [enrich]         Clearbit enrichment → evidence rows
        │       └────────────→ [account_match]
        │
        ├── [account_match]  Salesforce SOQL — is there an active deal?
        │       ├─ active deal? → [first_touch]  (bypass qualification)
        │       └─ net-new?   → [qualify]
        │
        ├── [qualify]        QualificationAgent v1 → ICP scoring
        │       ├─ not ICP?  → [mark_nurture] → END
        │       └─ ICP fit?  → [route]
        │
        ├── [route]          Load owners from DB → RoutingAgent v1 → assign
        │       ├─ no owners? → [human_review]  (interrupt — waits for operator)
        │       └─ owner found? → executeAction(assign_owner) → [first_touch]
        │
        ├── [first_touch]    executeAction(start_sequence) → Outreach enrollment
        │       └────────────→ [complete]
        │
        └── [complete]       play_instance.status = 'completed' → END

Every node writes immutable event_log rows with a full DecisionSnapshot.

        │
        ▼
SLA Timer (BullMQ repeatable job, every 2 minutes)
  - Query: running plays where first_touch_deadline < NOW() AND first_touch_at IS NULL
  - Write sla_breached event
  - Mark play_instance.sla_breached = true
  - Enqueue escalate-play job → post to Slack
```

---

## 3. Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Runtime | Node.js 20 + TypeScript (strict) | Typed async, ESM, wide ecosystem |
| API server | Fastify | Low-overhead, schema validation built-in |
| Workflow orchestration | LangGraph JS (`@langchain/langgraph`) | Directed graph with interrupt/resume for human-in-the-loop |
| Queue | BullMQ + Redis | Durable, observable job queue with priority and backoff |
| Database | PostgreSQL via Supabase | Managed PG, built-in auth, RLS, PostgREST API |
| Enrichment | Clearbit | Company + person data |
| CRM | Salesforce | Owner assignment + task creation |
| Engagement | Outreach | Sequence enrollment |
| Inbound | HubSpot | Form submission webhook source |
| Frontend | Next.js 15 App Router + shadcn/ui + Tailwind | Dashboard |
| Testing | Vitest | Fast ESM-native unit tests |

---

## 4. Database Schema

All tables carry `organization_id` on every row. No query is ever issued without it. This is enforced at the repository layer and verified by a security test suite.

### Core tables

```sql
organizations          — root tenant; every other table references this
leads                  — canonical lead entity (no provider IDs)
companies              — canonical company entity
external_identity      — maps leads/companies to SF/HubSpot/Outreach IDs
evidence               — enrichment results, CRM facts, intent signals
policy_rules           — territory, SLA, dedup, ICP filter rules (per org)
action_risk_registry   — risk profile per action type (per org)
play_instance          — one per lead going through a play (tracks journey state)
event_log              — IMMUTABLE. Append-only. Source of truth.
action_execution_state — mutable projection derived from event_log
connector_config       — encrypted API credentials per org
routing_state          — round-robin counter per queue (per org)
```

### Key columns on `play_instance`

```sql
id                    UUID PK
organization_id       UUID FK
lead_id               UUID FK
status                play_status  -- running | completed | failed | paused | nurture | duplicate
first_touch_deadline  TIMESTAMPTZ NOT NULL  -- form_submitted_at + policy_minutes (NEVER created_at)
first_touch_at        TIMESTAMPTZ           -- when outreach actually happened
sla_breached          BOOLEAN DEFAULT FALSE
sla_breached_at       TIMESTAMPTZ
pending_approval_since TIMESTAMPTZ          -- set when paused for human review
assigned_owner_id     VARCHAR               -- Salesforce user ID
workflow_run_id       VARCHAR               -- LangGraph run ID for resume
current_step          INTEGER DEFAULT 0
```

### `event_log` — the audit core

```sql
id                UUID PK DEFAULT gen_random_uuid()
organization_id   UUID NOT NULL FK
workflow_run_id   VARCHAR NOT NULL
play_instance_id  UUID NOT NULL FK
lead_id           UUID NOT NULL FK
event_type        event_type_enum NOT NULL    -- dedup_passed, enrichment_succeeded, action_proposed, ...
actor_type        actor_type_enum NOT NULL    -- system | agent | human | sla_timer
event_status      event_status_enum           -- success | failed | skipped
decision_snapshot JSONB NOT NULL              -- NEVER NULL — full context at decision time
idempotency_key   VARCHAR                     -- ${orgId}:${workflowRunId}:${actionId}
proposed_action   JSONB
error_message     TEXT
occurred_at       TIMESTAMPTZ DEFAULT NOW()
-- NO updated_at. Rows are never mutated.
```

### `decision_snapshot` structure (inside every event_log row)

```json
{
  "lead":          { /* full leads row at decision time */ },
  "company":       { /* full companies row, or null */ },
  "policies":      [ /* all active policy_rules for the org */ ],
  "ownerWorkloads": { "sf_user_id": 3, ... },
  "evidenceIds":   [ "uuid1", "uuid2" ],
  "agentName":     "qualification-agent",
  "agentVersion":  "v1.0.0",
  "promptVersion": null,
  "modelName":     null
}
```

This snapshot enables exact replay of any historical decision with the same inputs.

### Migration naming convention

```
db/migrations/
  001_organizations.sql
  002_leads.sql
  ...
  008_play_instance.sql
  009_event_log.sql
  ...
  015_play_instance_pending_approval.sql
```

Applied in order by `db/migrate.js` which tracks which migrations have run in a `schema_migrations` table.

---

## 5. Inbound Entry Point — Webhook Receiver

**File:** `src/routes/webhooks.ts`

```typescript
POST /webhooks/hubspot
```

Processing order — this order is non-negotiable:

1. **HMAC verify first** — `hubspotConnector.verifyWebhookSignature(body, sig, secret)`
   If invalid → `401 INVALID_SIGNATURE`. No DB reads, no processing.

2. **Idempotency check** — `eventLogRepo.existsByExternalId(eventId)`
   If already processed → `200 { status: 'duplicate' }`. Idempotent, safe to retry.

3. **Enqueue job** — `queue.add('process-inbound-lead', { payload })`
   Synchronous queue write to Redis. Completes in < 5ms.

4. **Return 200** — always within 200ms of receiving the request.
   HubSpot has a 200ms timeout; exceeding it causes HubSpot to retry.

The webhook handler does zero business logic. It is a traffic cop.

---

## 6. Queue Layer — BullMQ Workers

**Files:** `src/queue/`, `src/queue/workers/`

### Job: `process-inbound-lead` (inbound-lead.worker.ts)

```
1. resolveOrganizationId(portalId)
     → reads connector_config for the HubSpot portal ID → returns org UUID
2. Extract lead fields from HubSpot payload
3. INSERT into leads (form_submitted_at from payload, never NOW())
4. INSERT into play_instance
     → first_touch_deadline = form_submitted_at + sla_policy_minutes
5. runInboundLeadPlay(orgId, enrichedPayload)
```

Retry policy: 3 attempts with exponential backoff (1s → 5s → 30s). Failed jobs land in the BullMQ dead-letter set for inspection.

### Job: `escalate-play` (escalate.worker.ts)

Triggered by the SLA timer when a play breaches its deadline.
- Reads the play and lead from DB
- Posts a Slack message to the escalation channel
- Writes `escalation_sent` event to event_log
- Slack failure is caught and logged — it never crashes the escalation worker

### Repeatable Job: SLA Timer (`sla-timer.ts`)

Runs every 2 minutes across all active organizations. See section 12.

---

## 7. LangGraph Workflow — The Core Pipeline

**Files:** `src/workflows/inbound-lead/`

### State machine

LangGraph maintains a typed `WorkflowState` object that flows through the graph:

```typescript
type WorkflowState = {
  organizationId:       string
  workflowRunId:        string
  leadId:               string
  playInstanceId:       string
  lead:                 Lead
  company:              Company | null
  evidence:             Evidence[]
  qualificationResult:  ProposedAction | null
  routingResult:        ProposedAction | null
  currentStep:          string
  error:                string | null
}
```

State values are merged at each step using reducer functions — the last non-null value wins.

### Node: `validate`
- Calls `leadRepo.isDuplicate(orgId, email, excludeLeadId)` — checks for existing lead with same email
- Writes `dedup_passed` or `dedup_rejected` event
- Returns `{ lead: { ...lead, is_duplicate: true } }` on dup → graph routes to `mark_duplicate`

### Node: `enrich`
- Calls Clearbit `/person` and `/company` APIs
- Stores results in `evidence` table via `storeEnrichmentEvidence()`
  - `evidence_type = 'clearbit_person'` / `'clearbit_company'`
  - `confidence_score = 0.9`, `expires_at = NOW() + 30 days`
- Writes `enrichment_requested` → `enrichment_succeeded` (or `enrichment_skipped` if no API key)
- Updates lead fields: `company_name`, `company_domain`, `employee_count`, etc.
- Failure here is non-fatal — enrichment is best-effort

### Node: `account_match`
- Issues a Salesforce SOQL query against `Lead` and `Account` objects
- If an active opportunity exists → sets `routingResult._bypassQualification = true`
  and skips straight to `first_touch` (respects the existing sales motion)
- Stores Salesforce IDs in `external_identity` table

### Node: `qualify`
- Runs `QualificationAgent.run(input)` — pure synchronous function, no DB, no API
- Calls `executeAction(qualifyLeadAction, {}, ...)` — runs through the full action pipeline
- Writes `action_proposed` → `action_execution_started` → `action_execution_succeeded`
- On success, updates `leads.is_icp_fit`, `leads.icp_score`, `leads.icp_tier`
- Routes to `mark_nurture` if `is_icp_fit === false`, else to `route`

### Node: `route`
- Loads real data from DB before calling RoutingAgent:
  - `territoryPolicyRules` — from `decisionSnapshot.policies` filtered by `rule_type = 'territory'`
  - `routingState` — current round-robin counter from `routing_state` table
  - `availableOwners` — from `external_identity` where `provider = 'salesforce_user'`
  - `ownerWorkloads` — from `decisionSnapshot.ownerWorkloads` (play counts per owner)
- Runs `RoutingAgent.run(input)` — returns `assign_owner` or `request_human_review`
- If `request_human_review`: calls `executeAction(humanReviewAction)` → `play_instance.status = 'paused'`
  then `interrupt()` — LangGraph suspends. Resumes when human approves via API.
- If `assign_owner`: builds SF connector from env vars (if present), calls `executeAction(assignOwnerAction)`

### Node: `first_touch`
- Calls `executeAction(startSequenceAction, { outreach })` — enrolls prospect in Outreach sequence
- Updates `play_instance.first_touch_at = NOW()`, `status = 'in_sequence'`
- Updates `leads.stage = 'in_sequence'`

### Node: `mark_nurture`
- Calls `executeAction(markNurtureAction)`
- Updates `leads.stage = 'nurture'`, `play_instance.status = 'nurture'`

### Node: `mark_duplicate`
- Updates `leads.is_duplicate = true`, `play_instance.status = 'duplicate'`

### Node: `complete`
- Updates `play_instance.status = 'completed'`
- Writes final `play_completed` event

### Interrupts and human-in-the-loop

LangGraph's `interrupt()` suspends the graph mid-execution. The play's `workflow_run_id`
and `play_instance_id` are stored in the DB. When a human approves via the dashboard:

```
POST /api/plays/:id/approve
  → resumes the suspended graph from the checkpoint
  → graph continues from the route node with the human's routing decision
```

---

## 8. Agents

Both agents are **v1 rule-based** — deterministic, pure functions, no LLM calls, no DB reads.

### QualificationAgent (`src/agents/qualification/`)

**Input:**
```typescript
{
  lead:       Lead
  company:    Company | null
  evidence:   Evidence[]
  policies:   PolicyRule[]   // ICP filters
}
```

**Scoring logic:**

| Signal | Points |
|---|---|
| Employee count 50-5000 | +20 |
| Annual revenue > $5M | +20 |
| Industry in ICP list | +30 |
| Job title is decision-maker | +20 |
| Company domain is corporate (not free email) | +10 |
| Territory matches | Qualifier (pass/fail) |

Score ≥ 50 → `is_icp_fit: true`  
`icp_tier`: 80+ → `tier_1`, 65-79 → `tier_2`, 50-64 → `tier_3`, <50 → `not_icp`

**Free-email gate:** `@gmail.com`, `@yahoo.com`, `@hotmail.com`, etc. → instant `DISQUALIFIED_FREE_EMAIL_PROVIDER`, score 0.

**Output** (`ProposedAction`):
```typescript
{
  type:              'qualify_lead',
  decisionRiskScore: 0.0,   // v1: always deterministic, never risky
  rawConfidence:     1.0,   // v1: always 1.0 (rules, not probabilities)
  parameters: {
    is_icp_fit: boolean,
    icp_score:  number,
    icp_tier:   'tier_1' | 'tier_2' | 'tier_3' | 'not_icp',
    reason_codes: string[]
  }
}
```

### RoutingAgent (`src/agents/routing/`)

**Input:**
```typescript
{
  lead:                 Lead
  company:              Company | null
  qualificationResult:  ProposedAction
  availableOwners:      SalesforceUser[]
  ownerWorkloads:       Record<string, number>   // owner_id → active play count
  territoryPolicyRules: PolicyRule[]
  routingState:         RoutingStateRow           // round-robin counter
}
```

**Routing logic (in priority order):**
1. If `availableOwners` is empty → `request_human_review` (OWNER_LIST_EMPTY)
2. Filter owners by territory match (if territory rules exist)
3. Filter out owners at or above `MAX_OWNER_WORKLOAD` (25 active plays)
4. Round-robin among remaining owners: `ownerIndex = routingState.counter % eligibleOwners.length`
5. No eligible owner after filters → `request_human_review`

**Output** (`ProposedAction`):
```typescript
{
  type: 'assign_owner' | 'request_human_review',
  decisionRiskScore: 0.0,
  rawConfidence:     1.0,
  parameters: {
    recommended_owner_id: string,
    owner_name:           string,
    queue_name:           string,
    reason_codes:         string[]
  }
}
```

---

## 9. Action Pipeline (Proposed → Validated → Executed)

Every state change goes through this pipeline. Agents never call connectors directly.

```
ProposedAction
    │
    ▼
validateAction()           src/actions/validator.ts
  → PolicyValidator: checks policy_rules (territory, SLA, dedup)
  → RiskValidator: checks action_risk_registry (max risk score per action type)
  → returns { approved: boolean, requiresHumanApproval: boolean, rejectionReason? }
    │
    ▼ (if approved)
executeAction()            src/actions/action-executor.ts
  1. Check idempotency: has this key been executed before?
     key = "${orgId}:${workflowRunId}:${actionId}"
     If yes → write action_execution_deduplicated event, return cached result
  2. Write action_execution_started event (with full DecisionSnapshot)
  3. Execute the action (switch on action.type):
     - qualify_lead:         update leads (is_icp_fit, icp_score, icp_tier)
     - assign_owner:         SF assignLeadOwner + createTask (if SF creds present)
     - start_sequence:       Outreach enrollInSequence (if Outreach creds present)
     - request_human_review: update play_instance (status=paused, pending_approval_since)
     - mark_nurture:         update leads + play_instance (status=nurture)
     - mark_duplicate:       update leads + play_instance (status=duplicate)
     - escalate:             post to Slack
  4. Write action_execution_succeeded event
  5. processEvent() — update action_execution_state projection async (fire-and-forget)
```

### Null-safe connector behavior

When SF or Outreach credentials are absent (sandbox, dev environment):
- `assign_owner`: skips the SF API call. Still writes `assigned_owner_id` to `play_instance` and increments the round-robin counter. Intent is always recorded.
- `start_sequence`: skips Outreach enrollment. Still updates `play_instance.status = 'in_sequence'`.

A missing connector is a configuration gap, not a system error. The pipeline never crashes because a credential isn't set.

---

## 10. Event Sourcing — The Audit Layer

**Files:** `src/events/event-log.ts`, `src/events/event-processor.ts`

### Law: event_log is immutable

```sql
-- There is no UPDATE on event_log. Ever.
-- The correct pattern:
INSERT INTO event_log (event_type, ...) VALUES ('action_proposed', ...)
INSERT INTO event_log (event_type, ...) VALUES ('action_execution_started', ...)
INSERT INTO event_log (event_type, ...) VALUES ('action_execution_succeeded', ...)

-- The wrong pattern (never used):
INSERT INTO action_execution_state (status) VALUES ('pending')
UPDATE action_execution_state SET status = 'success' WHERE ...
```

### writeEvent() contract

```typescript
writeEvent({
  organizationId,
  workflowRunId,
  playInstanceId,
  leadId,
  eventType,          // from the event_type enum
  actorType,          // system | agent | human | sla_timer
  eventStatus,        // success | failed | skipped
  decisionSnapshot,   // REQUIRED — never null
  proposedAction?,    // for action_proposed events
  idempotencyKey?,    // for action execution events
  errorMessage?,
}): Promise<EventLogRow>
```

`decisionSnapshot` is never optional. If `buildDecisionSnapshot()` throws (e.g. lead not found), the node fails loudly rather than silently writing an event without context.

### event_processor.ts — mutable projection

After every `writeEvent()`, `processEvent()` is called as fire-and-forget to update `action_execution_state`:

```
action_proposed         → INSERT into action_execution_state (status='proposed')
action_execution_started → UPDATE status='started'
action_execution_succeeded → UPDATE status='succeeded', external_id, external_system
action_execution_failed  → UPDATE status='failed', error_code, error_message
```

`processEvent` never throws. Unknown event types → `console.warn` and no-op.

### Full event sequence for a happy-path lead

```
dedup_passed                 (validate node)
enrichment_requested         (enrich node)
enrichment_succeeded         (enrich node)
action_proposed              (qualify node — QualificationAgent output)
action_execution_started     (qualify node — executing qualify_lead)
action_execution_succeeded   (qualify node — leads updated)
action_proposed              (route node — RoutingAgent output)
action_execution_started     (route node — executing assign_owner)
action_execution_succeeded   (route node — SF updated, task created)
action_proposed              (first_touch node)
action_execution_started     (first_touch node — enrolling in Outreach)
action_execution_succeeded   (first_touch node — enrolled)
play_completed               (complete node)
```

---

## 11. Connectors

**Files:** `src/connectors/`

All connectors implement the `Connector<TConfig>` interface from `src/connectors/base.ts`.

```typescript
interface Connector<TConfig> {
  connect(config: TConfig): Promise<void>
  healthCheck(): Promise<ConnectorHealth>
}
```

**Law:** Connectors throw only `ConnectorError`. Never raw `Error`.

```typescript
type ConnectorError = {
  source:     string          // 'salesforce' | 'hubspot' | ...
  code:       string          // 'SF_AUTH_FAILED' | ...
  statusCode: number
  raw:        unknown         // full provider response
}
```

### Salesforce Connector

Auth: OAuth 2.0 client credentials flow (SF_INSTANCE_URL, SF_CLIENT_ID, SF_CLIENT_SECRET).
Token cached in-memory, refreshed on 401.

Methods:
- `assignLeadOwner(sfLeadId, ownerId, idempotencyKey)` — PATCH Lead.OwnerId
- `createTask(sfLeadId, { subject, description, due_date }, idempotencyKey)` — POST Task
- `soqlQuery<T>(soql)` — generic query used by account_match node
- `createLead(input, idempotencyKey)` — used by worker to push lead to SF
- `getActiveUsers(filter)` — used to populate external_identity

All calls use `AbortSignal.timeout(8000)` — 8s hard timeout.

### HubSpot Connector

- `verifyWebhookSignature(body, signature, secret)` — HMAC-SHA256 comparison. Used in webhook route.
- `getContact(contactId)` — fetch enriched contact data

### Clearbit Connector

- `enrichPerson(email)` — `/person/find?email=` — returns person + company data
- `enrichCompany(domain)` — `/company/find?domain=` — company-only lookup

Results stored in `evidence` table, not on the lead row directly.

### Outreach Connector

- `enrollInSequence(prospectId, sequenceId, idempotencyKey)` — POST /sequenceStates

---

## 12. SLA Timer

**File:** `src/queue/jobs/sla-timer.ts`

Runs as a BullMQ repeatable job every 2 minutes. Called by the worker process on startup.

**Law:** SLA deadline = `form_submitted_at + policy_sla_minutes`. NEVER `created_at + anything`.

`first_touch_deadline` is set at play creation time:
```typescript
first_touch_deadline = new Date(
  new Date(payload.properties.submitted_at).getTime()
  + slaPolicyMinutes * 60 * 1000
).toISOString()
```

### checkBreachedPlays(orgId)

```sql
SELECT id, lead_id, first_touch_deadline, created_at
FROM play_instance
WHERE organization_id = $1
  AND status = 'running'
  AND first_touch_at IS NULL     -- hasn't been touched yet
  AND sla_breached = FALSE
  AND first_touch_deadline < NOW()
```

For each breached play:
1. `writeEvent(sla_breached)`
2. `UPDATE play_instance SET sla_breached = true, sla_breached_at = NOW()`
3. `addJob('escalate-play', { playId, organizationId }, { priority: 1 })`

Priority 1 = highest BullMQ priority. Escalations jump the queue.

---

## 13. REST API

**Files:** `src/routes/api/`

All routes are protected by `tenantContextMiddleware` which:
1. Extracts and verifies the JWT
2. Reads `organization_id` from the verified token payload
3. Attaches `request.tenantContext.organizationId`
4. Returns `401` on missing or invalid tokens

`organization_id` is **never** read from request body, query params, or URL params.

### Route inventory

```
POST /webhooks/hubspot              Receive HubSpot form submissions

GET  /api/leads                     Paginated lead list (filterable by stage)
GET  /api/leads/:id                 Single lead with current state
GET  /api/leads/:id/timeline        Full event_log for a lead (the audit trail)

GET  /api/plays                     List play instances
GET  /api/plays/:id                 Single play instance

GET  /api/metrics/overview          Dashboard summary: counts, SLA rate, speed-to-lead
GET  /api/metrics/speed-to-lead     Distribution data for speed-to-lead chart

GET  /api/policies                  List policy rules
PUT  /api/policies/:id              Update a policy rule (SLA minutes, territory config)

GET  /api/connectors                List connector health statuses
POST /api/connectors/:name/test     Test connector credentials
```

All responses are typed — raw DB rows are never returned. Internal Supabase errors, stack traces, and provider-specific IDs are never exposed.

---

## 14. Dashboard

**Directory:** `dashboard/`  
**Stack:** Next.js 15 App Router + shadcn/ui + Tailwind  
**Deploy target:** Vercel

### Pages

**Overview** (`dashboard/app/dashboard/page.tsx`)
- Total leads this week, ICP hit rate, SLA compliance %, average speed-to-lead
- Speed-to-lead distribution chart (how many leads hit each time bucket)
- Fetches from `GET /api/metrics/overview` and `GET /api/metrics/speed-to-lead`

**Lead List** (`dashboard/app/leads/page.tsx`)
- Paginated, filterable by stage
- Stage filters: new | routing | in_sequence | meeting_booked | nurture | lost
- Fetches from `GET /api/leads`

**Lead Detail + Event Timeline** (`dashboard/app/leads/[id]/page.tsx`)
- Full event_log rendered as a chronological timeline
- Each event shows: type, actor, status, timestamp, decision_snapshot toggle
- The `decision_snapshot` can be expanded to show the full context at that moment
- Fetches from `GET /api/leads/:id/timeline`

**Settings** (`dashboard/app/settings/page.tsx`)
- Connector health status + test connection
- SLA configuration (minutes per policy)
- Territory routing rules
- Fetches from `GET /api/connectors` and `GET /api/policies`

---

## 15. Security & Multi-Tenancy

### Row-level security (RLS)

Every table has RLS policies in migration `013_rls_policies.sql`:

```sql
-- Example: leads table
CREATE POLICY leads_org_isolation ON leads
  USING (organization_id = (current_setting('app.current_org_id'))::uuid);
```

The server uses the Supabase **service role key** (`SUPABASE_SERVICE_KEY`) which bypasses RLS for server-side operations. The dashboard frontend uses the **anon key** with JWT-scoped access.

### Cross-tenant isolation

Every repository function accepts `organizationId` as the first argument and applies it to every query. There is no global query that touches multiple organizations. A cross-tenant security test suite verifies this:

```typescript
// Security test: org A cannot read org B's data
const result = await leadsApi.get('/api/leads', { headers: { org: orgB_token } })
expect(result.body.leads.every(l => l.organization_id === orgB)).toBe(true)
```

### Supabase client singleton

**File:** `src/db/client.ts`

```typescript
export function getDb(): SupabaseClient {
  if (_client) return _client
  _client = createClient(url, key, {
    realtime: { transport: ws }   // Node 20 WebSocket polyfill
  })
  return _client
}
```

One client instance per process. All modules import `getDb()`. No module ever calls `createClient()` directly — this is enforced by code review and tested by the import graph.

---

## 16. Key Design Decisions

### Why event sourcing?

Every action is logged three times: `proposed`, `started`, `succeeded/failed`. This means:
- Any bug in routing or qualification can be replayed with the original inputs
- Historical decisions can be audited with exact context (who, what, why, when)
- The `action_execution_state` table is a derived projection — if it gets corrupted, it can be rebuilt by replaying `event_log`

### Why LangGraph instead of a plain async function?

Three reasons:
1. **Interrupt/resume** — human-in-the-loop routing requires pausing execution mid-graph and resuming later when a human approves. LangGraph's `interrupt()` / checkpoint system handles this cleanly.
2. **Observability** — each node's input/output is automatically traced via LangSmith.
3. **Extensibility** — adding a new node (e.g. intent signal enrichment) is additive, not a rewrite.

### Why BullMQ over direct function call from webhook?

The webhook must return in < 200ms (HubSpot timeout). The full pipeline takes 15-30 seconds (Clearbit, Salesforce, Outreach). Without a queue, HubSpot would mark the webhook as failed and retry. BullMQ provides: durable persistence (Redis), retry with backoff, dead-letter queue, priority ordering for escalations.

### Why rule-based agents in v1?

v1 agents are deterministic pure functions. No LLM latency, no prompt engineering, no hallucination risk. The agent → ProposedAction → PolicyValidator → ActionExecutor pipeline is the same regardless of whether the agent is rule-based or LLM-based. Upgrading to an LLM agent in v2 means replacing only the `agent.run()` call — the governance layer stays identical.

### Why `form_submitted_at` for SLA deadline?

The SLA guarantee is to the customer: "we will reach out within 15 minutes of filling out your form." `created_at` drifts based on queue depth — if a lead sits in BullMQ for 3 minutes, using `created_at` would silently give 12 minutes instead of 15. `form_submitted_at` is immutable from the HubSpot payload and always correct.

---

_Last updated: 2026-09-10 | Commit: b43286f_
