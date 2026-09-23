# GTM Autopilot

> **Governed decision infrastructure for inbound GTM.** Every lead qualified, routed, and enrolled in a sales sequence — within 15 minutes of form submission. Every decision logged immutably.

[![Railway](https://img.shields.io/badge/API-Railway-blueviolet)](https://gtm-api-production-adc0.up.railway.app/health)
[![Vercel](https://img.shields.io/badge/Dashboard-Vercel-black)](https://gtm-autopilot-dashboard.vercel.app)
[![Tests](https://img.shields.io/badge/tests-75%20passing-brightgreen)](#testing)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](https://www.typescriptlang.org/)

---

## What It Does

GTM Autopilot replaces the manual, inconsistent work of SDR triage. When a prospect submits a form:

1. **Webhook received** from HubSpot — HMAC-verified, idempotent
2. **Enriched** via Clearbit — company size, industry, region, intent signals
3. **Qualified** by the QualificationAgent — ICP score, tier, reason codes
4. **Validated** by PolicyEngine — SLA rules, territory rules, dedup
5. **Routed** by the RoutingAgent — round-robin across owners, territory-aware
6. **Executed** — Salesforce owner assignment + task creation, Outreach sequence enrollment
7. **Monitored** — SLA timer runs every 2 min, Slack escalation on breach
8. **Logged** — every decision is an immutable event with full decision snapshot for replay

All of this happens in **under 15 minutes**, enforced by policy.

---

## Production URLs

| Service | URL |
|---|---|
| API (Railway) | `https://gtm-api-production-adc0.up.railway.app` |
| Dashboard (Vercel) | `https://gtm-autopilot-dashboard.vercel.app` |
| HubSpot Webhook | `https://gtm-api-production-adc0.up.railway.app/webhooks/hubspot` |

---

## Architecture

```
HubSpot webhook
    ↓ HMAC verify + idempotency check
    ↓ BullMQ job enqueued  (<200ms response)
    ↓
  [gtm-worker — Railway]
    ↓ Clearbit enrichment → evidence rows
    ↓ QualificationAgent v1 → ProposedAction
    ↓ PolicyValidator → approved?
    ↓ RoutingAgent v1 → ProposedAction
    ↓ PolicyValidator + RiskValidator → approved?
    ↓ ActionExecutor
        ├─ Salesforce (assign owner + create task)
        └─ Outreach (enroll in sequence)
    ↓ SLA timer → breach? → Slack escalation
    ↓
  event_log (immutable, append-only)
```

### Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20 + TypeScript (strict) |
| API | Fastify |
| Workflow | LangGraph JS |
| Queue | BullMQ + Redis |
| Database | PostgreSQL via Supabase |
| Frontend | Next.js 15 App Router + shadcn/ui + Tailwind |
| LLM (future) | Anthropic Claude via provider abstraction |
| Observability | OpenTelemetry + LangSmith |
| Deploy API | Railway (auto-deploy from `main`) |
| Deploy UI | Vercel (auto-deploy from `main`) |

---

## Key Design Decisions

### Immutable Event Log
Every action produces three events: `action_proposed` → `action_execution_started` → `action_execution_succeeded|failed`. No UPDATE statements on `event_log`. The `action_execution_state` table is a mutable projection — the event log is the source of truth.

### Decision Snapshot
Every event carries a `decision_snapshot` JSONB column with the full context at decision time: lead data, company data, policies (with versions), owner workloads, evidence IDs, agent name, agent version, model name. This enables **exact replay** of any historical decision.

### Agent → Validator → Executor Pipeline
Agents never call connectors directly. The invariant:
```
Agent → ProposedAction → RiskValidator → PolicyValidator → ActionExecutor → Connector
```
Every decision is auditable, reversible, and simulatable before it reaches a real external system.

### SLA from `form_submitted_at`
SLA deadline = `form_submitted_at + policy_minutes`. Never `created_at`, never queue enqueue time. A lead that sat in queue for 10 minutes still only has 5 minutes left on a 15-minute SLA.

### Cross-Tenant Isolation
Every table has `organization_id`. Every repository query is scoped to the verified `organization_id` from the JWT. `organization_id` is never read from the request body — always from the verified token.

---

## Repository Structure

```
src/
├── domain/         # Types only, zero external dependencies
├── agents/         # QualificationAgent + RoutingAgent (v1: rule-based)
├── workflows/      # LangGraph graph + nodes
├── policies/       # Policy engine + validators
├── actions/        # Registry, risk-validator, policy-validator, executor
├── connectors/     # Salesforce, HubSpot, Outreach, Clearbit
├── state/          # state-store.ts — single mutation entry point
├── evidence/       # Evidence store + context builder
├── events/         # Event log (append-only) + event processor
├── queue/          # BullMQ workers + SLA timer job
├── routes/         # Fastify webhooks + API routes
├── repositories/   # Typed SQL, always organization-scoped
├── middleware/     # tenant-context.ts
└── observability/  # OpenTelemetry tracing
dashboard/          # Next.js 15 App Router (Vercel deploy)
db/migrations/      # Numbered SQL migration files (001–016)
tests/              # Unit, integration, e2e, security
```

---

## Getting Started

### Prerequisites

- Node.js 20+
- Docker (for local Redis)
- Supabase project
- HubSpot Private App (`contacts.read` + webhooks scope)
- Salesforce Connected App (OAuth2)

### Local Setup

```bash
git clone https://github.com/VallabhKulkarni-09/GTM-Autopilot.git
cd GTM-Autopilot
npm install
cp .env.example .env   # fill in your credentials
```

Start Redis:
```bash
docker run -d --name gtm-redis -p 6379:6379 redis:7-alpine
```

Apply migrations in Supabase SQL editor (in order: `db/migrations/001_*.sql` → `016_*.sql`).

Build and run:
```bash
npm run build
npm run dev            # API server on :3001
npm run worker:dev     # BullMQ inbound-lead worker
```

Dashboard:
```bash
cd dashboard
npm install
npm run dev            # Dashboard on :3000
```

### Environment Variables

| Variable | Description |
|---|---|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Service role key (not anon) |
| `SUPABASE_ANON_KEY` | Anon key |
| `HUBSPOT_API_KEY` | HubSpot Private App token (`pat-na2-...`) |
| `HUBSPOT_WEBHOOK_SECRET` | HubSpot client secret for SHA256 signature verification |
| `SF_CLIENT_ID` | Salesforce connected app client ID |
| `SF_CLIENT_SECRET` | Salesforce connected app secret |
| `SF_INSTANCE_URL` | Salesforce instance URL |
| `SF_SANDBOX` | `true` for sandbox orgs |
| `CLEARBIT_API_KEY` | Clearbit API key (optional — degrades gracefully without it) |
| `OUTREACH_API_KEY` | Outreach API key (optional) |
| `JWT_SECRET` | 128-char hex secret for tenant JWT signing |
| `DEFAULT_ORG_ID` | UUID of the default organization |
| `REDIS_URL` | Redis connection string |

---

## Testing

```bash
npm test              # 75 passing tests (Vitest)
npm run test:coverage # Coverage report
```

Test categories:
- **Unit** — agents, validators, policy engine, event log, state machine
- **Integration** — webhook chain end-to-end, Salesforce connector, HubSpot connector
- **Security** — cross-tenant isolation (tenant A cannot access tenant B's data)

---

## API Reference

All `/api/*` routes require `Authorization: Bearer <JWT>` with a valid `organization_id` claim.

| Method | Route | Description |
|---|---|---|
| `POST` | `/webhooks/hubspot` | Receive HubSpot contact creation events |
| `GET` | `/api/leads` | List leads — paginated, filterable by `stage` |
| `GET` | `/api/leads/:id` | Lead detail + current play state |
| `GET` | `/api/leads/:id/timeline` | Full immutable event log for a lead |
| `GET` | `/api/metrics/overview` | KPI summary (active plays, SLA %, meetings booked) |
| `GET` | `/api/metrics/speed-to-lead` | Distribution buckets + per-SDR breakdown |
| `GET` | `/api/policies` | List policy rules |
| `PUT` | `/api/policies/:id` | Update a policy rule (SLA minutes, priority) |
| `GET` | `/api/connectors` | Health status of all 4 connectors |
| `POST` | `/api/connectors/:name/test` | Test connector credentials live |
| `GET` | `/health` | Service health check (no auth required) |

---

## Deployment

### Automatic (on push to `main`)

Both Railway (API + Worker) and Vercel (Dashboard) auto-deploy from `main`.

### Manual Redeploy

```bash
# API / Worker
RAILWAY_API_TOKEN=<token> railway up \
  --service <service-id> \
  --environment production \
  --detach

# Dashboard
vercel deploy ./dashboard --prod --token <token>
```

### Railway Services

| Service | Purpose | Start Command |
|---|---|---|
| `gtm-api` | Fastify API server | `node dist/server.js` |
| `gtm-worker` | BullMQ inbound-lead worker | `node dist/queue/workers/inbound-lead.worker.js` |
| `Redis` | Managed Railway Redis | — |

---

## Contributing

1. Branch from `main`
2. All tests must pass: `npm test`
3. Cross-tenant isolation tests must pass before any data-access change ships
4. Open PR → squash merge to `main`

Git identity:
```bash
git config --local user.name "VallabhKulkarni-09"
git config --local user.email "99166213+VallabhKulkarni-09@users.noreply.github.com"
```

---

## License

Private — All rights reserved.
