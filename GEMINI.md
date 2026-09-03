# GEMINI.md — GTM Autopilot

> Every agent reads this file before doing anything.
> This is the law. Scoped rule files in .agent/rules/ add detail per domain.
> When rules conflict, this file wins.

---

## What We Are Building

GTM Decision Infrastructure. One canonical play for MVP:

> HubSpot form fill → enrich → qualify → route → Outreach sequence.
> Within 15 minutes. Every action logged as immutable events.

We are not a CRM. We are not a sales engagement tool.
We are the governed decision layer above all of them.

---

## The Product in One Flow

```
HubSpot webhook
    ↓
Verify HMAC + idempotency check
    ↓
Create lead + play_instance
    ↓
Enrich via Clearbit → store as evidence rows
    ↓
QualificationAgent v1 → ProposedAction
    ↓
PolicyValidator → approved?
    ↓
RoutingAgent v1 → ProposedAction
    ↓
PolicyValidator + RiskValidator → approved?
    ↓
ActionExecutor → Salesforce (assign owner + task) + Outreach (enroll sequence)
    ↓
SLA timer runs every 2 min → breach? → escalate → Slack
    ↓
event_log records everything. Immutably.
```

---

## Hard Rules — Non-Negotiable

**1. organization_id on every table and every query.**
No exceptions. Added in migration 001. Never retrofitted.

**2. event_log is immutable.**
Write events, never update them. Three event types per action:
- `action_proposed`
- `action_execution_started`
- `action_execution_succeeded` or `action_execution_failed`
NEVER: `INSERT status=pending` then `UPDATE status=success`

**3. decision_snapshot JSONB NOT NULL on every event_log row.**
Contains: lead, company, policies (with versions), owner workloads,
evidence IDs, agent name, agent version, prompt version, model name.
This enables exact replay and simulation. Never optional. Never null.

**4. The agent pipeline is inviolable.**
Agent → ProposedAction → RiskValidator → PolicyValidator → ActionExecutor → Connector
Agents NEVER call connectors directly. No exceptions.

**5. ConnectorError is the only error type from connectors.**
Always includes: source, code, statusCode, raw response.
Never throw raw Error from a connector.

**6. SLA deadline = form_submitted_at + policy_minutes.**
NOT created_at. NOT queue enqueue time. ALWAYS form_submitted_at.

**7. Round-robin uses routing_state table.**
Never random. Never in-memory. Persistent counter in DB.

**8. Idempotency key on every action execution.**
Format: `${organizationId}:${workflowRunId}:${actionId}`
ActionExecutor checks this before every external API call.

**9. Cross-tenant isolation tests must pass before any feature ships.**
A cross-tenant data leak is existential.

**10. Build only what is in scope.**
If it is not in the current task prompt, do not build it.
Do not add features that seem helpful. Ask first.

---

## Tech Stack

```
Runtime:      Node.js 20 + TypeScript (strict mode)
API:          Fastify
Workflow:     LangGraph JS
Queue:        BullMQ + Redis
Database:     PostgreSQL via Supabase
Secrets:      Supabase Vault
Frontend:     Next.js 15 App Router + shadcn/ui + Tailwind
LLM:          Anthropic Claude (runtime agents, via provider abstraction)
Vector:       pgvector (only when structured SQL cannot answer the question)
Observability:OpenTelemetry + LangSmith
Testing:      Vitest + Playwright
Deploy API:   Railway
Deploy UI:    Vercel
```

---

## Folder Structure

```
src/domain        → types only, zero dependencies
src/agents        → qualification + routing (v1: rule-based)
src/workflows     → LangGraph graph + nodes
src/policies      → policy engine + validators
src/actions       → registry, risk-validator, policy-validator, executor
src/connectors    → salesforce, hubspot, outreach, clearbit
src/state         → state-store.ts (single mutation entry point)
src/evidence      → evidence-store + context-builder
src/events        → event-log (append-only) + event-processor
src/queue         → BullMQ workers + SLA timer job
src/routes        → Fastify webhooks + API
src/repositories  → typed SQL, always organization-scoped
src/middleware    → tenant-context.ts
src/observability → tracing
src/evaluation   → golden datasets + runners
dashboard/        → Next.js app (separate Vercel deploy)
db/migrations/    → numbered SQL files
tests/            → unit, integration, e2e, security
```

---

## Data Model — Key Tables

```
organizations         → every other table references this
leads                 → canonical lead entity (no provider IDs here)
companies             → canonical company entity
external_identity     → maps leads/companies to Salesforce/HubSpot/Outreach IDs
evidence              → enrichment results, CRM facts, intent signals
policy_rules          → territory, SLA, dedup, ICP filter rules
action_risk_registry  → risk profile per action type
play_instance         → one per lead going through a play
event_log             → immutable. append-only. source of truth.
action_execution_state→ mutable projection derived from event_log
connector_config      → encrypted API credentials per org
routing_state         → round-robin counters per queue
```

---

## Agents in MVP

Both are rule-based (v1). No LLM calls in MVP agents.

**QualificationAgent v1**
Input: lead, company, enrichment evidence, ICP policy rules
Output: ProposedAction { type: 'qualify_lead', is_icp_fit, icp_score, icp_tier, reason_codes }
decision_risk_score: 0.0, raw_confidence: 1.0

**RoutingAgent v1**
Input: lead, qualification result, available owners, workloads, territory rules, routing_state
Output: ProposedAction { type: 'assign_owner', owner_id, owner_name, queue_name, reason_codes }
decision_risk_score: 0.0, raw_confidence: 1.0

---

## Three Things Never Delegated to Agents

1. Schema decisions that affect event_log structure
2. Cross-tenant security tests
3. SLA deadline formula (always form_submitted_at, never created_at)

---

## Dependency Order

Schema → Domain types → Repositories → Tenant middleware
→ Connectors (parallel) → Event system → Webhook receiver
→ Queue → Qualification agent → Routing agent
→ Policy engine → Action executor → SLA timer
→ Full play end-to-end → Dashboard
