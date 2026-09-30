# GTM Autopilot — Progress Log

> **Last updated:** 2026-09-30
> **Conversation ID:** `737b230b-5cbd-42d9-8430-08fc44197d62`
> **Prior session:** `108376a4-3a76-49d3-b43b-018d42e7d6f5`

---

## Current State at a Glance

| Layer | Status | Notes |
|---|---|---|
| API (Railway) | ✅ Live | `https://gtm-api-production-adc0.up.railway.app` |
| Worker (Railway) | ✅ Live | `start-workers.js` — all 3 workers + 3 repeatable jobs now active |
| Dashboard (Vercel) | ✅ Live | `https://gtm-autopilot-dashboard.vercel.app` |
| Webhook → Queue | ✅ Proven E2E | HubSpot → HMAC verify → BullMQ → worker |
| Qualification | ✅ Live | Rule-based, goes to nurture (no Clearbit key) |
| Routing | ✅ Live | Round-robin from DB, nurture fallback |
| Salesforce | ✅ Live | Owner assign + task creation working |
| Outreach | 🔧 Awaiting credentials | Connector rewritten (OAuth2 + mailbox fix). First-touch wired. Needs OUTREACH_CLIENT_ID/SECRET/ACCESS_TOKEN/REFRESH_TOKEN/MAILBOX_ID/SEQUENCE_ID in Railway env vars, then live-fire test. |
| Clearbit | ⚠️ No key | Enrichment returns minimal data → ICP score 0 |
| SLA Timer | ✅ Railway confirmed | Breach detected + `sla_breached` event written on Railway (`actor_type=sla_timer`). Slack escalation NOT wired yet. |
| Human-in-loop | ⚠️ Partial | `interrupt()` in graph, no approve/reject UI |
| Outcome Tracking | ✅ Fully proven on Railway | All 3 jobs confirmed autonomous: outcome-poller (`08:13:28Z`), sla-timer (`08:04:26Z`), window-closer (`08:40:35Z`). Logic ✅ + scheduler ✅ + together on Railway ✅. |

---

## Infrastructure & Credentials

### Railway
| Key | Value |
|---|---|
| API Token | *(Railway project settings — do not commit)* |
| gtm-api Service ID | `358b98b8-2170-4506-bf4c-3edadf730d02` |
| gtm-worker Service ID | `816200b4-40c8-41c5-8ea4-124718c13efa` |
| API URL | `https://gtm-api-production-adc0.up.railway.app` |

**Redeploy (when GitHub auto-deploy doesn't fire):**
```bash
RAILWAY_API_TOKEN=<from Railway dashboard> railway up \
  --service 358b98b8-2170-4506-bf4c-3edadf730d02 \
  --environment production --detach
```

### Vercel
| Key | Value |
|---|---|
| Token | *(Vercel account settings — do not commit)* |
| Project ID | `prj_SiL90Yn2RCGPfUy6hxiuBYjjgRSJ` |
| Dashboard URL | `https://gtm-autopilot-dashboard.vercel.app` |

> ⚠️ **Alias note:** Vercel project had no production alias configured — production alias must be manually assigned via API after each deploy. Fixed by assigning `gtm-autopilot-dashboard.vercel.app` via `POST /v2/deployments/:url/aliases`.

### Supabase
| Key | Value |
|---|---|
| URL | `https://urdhebsbnjbtdnookwmk.supabase.co` |
| Service key env var | `SUPABASE_SERVICE_KEY` (NOT `SUPABASE_SERVICE_ROLE_KEY`) |

### Auth
| Key | Value |
|---|---|
| Dashboard JWT | *(stored in Railway + Vercel env vars as `DASHBOARD_JWT` — do not commit)* |
| Expiry | 2027-09-18 — regenerate before then |

### HubSpot
| Key | Value |
|---|---|
| Portal ID | `247417540` |
| API Key env var | `HUBSPOT_API_KEY` in Railway — do not commit value |
| Webhook Secret env var | `HUBSPOT_WEBHOOK_SECRET` in Railway — do not commit value |
| Webhook URL | `https://gtm-api-production-adc0.up.railway.app/webhooks/hubspot` ✅ |

### Git Identity (locked)
```bash
git config --local user.name "VallabhKulkarni-09"
git config --local user.email "99166213+VallabhKulkarni-09@users.noreply.github.com"
```

---

## What Has Been Built (Chronological)

### Phase 1 — Backend Core (pre-2026-09-18)
- ✅ 17 DB migrations (001–017): organizations, leads, companies, external_identity, evidence, policy_rules, action_risk_registry, play_instance, event_log, action_execution_state, connector_config, routing_state, RLS policies, qualification columns, pending_approval, external_identity user type, account_match event type
- ✅ Domain types (`src/domain/`)
- ✅ Repositories — typed SQL, always org-scoped
- ✅ Tenant context middleware — JWT → `organizationId` on every `/api/*` route
- ✅ All 4 connectors: HubSpot, Salesforce, Outreach, Clearbit
- ✅ Evidence store + context builder
- ✅ Event log (append-only, immutable)
- ✅ QualificationAgent v1 (rule-based: ICP scoring, tier classification)
- ✅ RoutingAgent v1 (territory match → round-robin from `routing_state` table)
- ✅ PolicyValidator + RiskValidator
- ✅ ActionExecutor (idempotency key, ConnectorError contract)
- ✅ LangGraph workflow graph (`src/workflows/`)
- ✅ BullMQ + Redis queue setup
- ✅ SLA timer (detects breaches, escalation Slack message NOT yet wired)
- ✅ `POST /webhooks/hubspot` — HMAC verify, idempotency check, enqueue to BullMQ
- ✅ All API routes: leads, metrics, connectors, policies

### Phase 2 — Production Deployment (2026-09-18)
- ✅ Railway deployment: gtm-api + gtm-worker as separate containers
- ✅ Vercel deployment: dashboard auto-deploys from `main`
- ✅ HubSpot webhook chain fully proven end-to-end (live form fill → DB → events)
- ✅ Real leads processed: `Dhrithi K`, `Vineeth H`, 20+ leads total in DB
- ✅ Salesforce tasks created for 3 leads

### Phase 3 — Dashboard Build (2026-09-20–24)
- ✅ Next.js 15 App Router dashboard (`dashboard/`)
- ✅ 4 pages: Overview `/dashboard`, Leads `/leads`, Lead Detail `/leads/:id`, Settings `/settings`
- ✅ `SidebarNav` component with active state
- ✅ `LeadsFilter` — stage + date range filter pills
- ✅ `SdrTable` — per-rep performance table
- ✅ `SlaForm` — editable SLA minutes, saves via `PUT /api/policies/:id`
- ✅ All TypeScript types aligned with API response shapes
- ✅ `TouchTimeBadge`, relative timestamps, deterministic avatar colors
- ✅ API response envelope unwrapping fixed (`{ lead: {...} }` shape)
- ✅ Timeline mapping: `occurred_at → timestamp`, `actor_type → actor`, reason codes
- ✅ `SpeedToLeadDistribution.total` type bug fixed
- ✅ Tailwind v3.4.17 pinned (v4 breaks shadcn `@apply`)
- ✅ TypeScript 5.8.3 pinned (TS 7 breaks Next.js 15)
- ✅ `next/font/google` replaced with system font stack for offline sandbox builds

### Phase 4 — Apple HIG UI Transformation (2026-09-25)
**Commit `4ea3744` — 13 files, 1,441 insertions, 657 deletions**

#### Design System
- ✅ `tailwind.config.ts` — Apple System Colors (`#007AFF`, `#34C759`, `#FF3B30`, `#FF9500`, `#AF52DE`), HIG type scale (34/28/22/20/17/16/15/13/12/11px), glass shadow tokens, `shimmer`/`pulse-ring`/`fade-in` keyframes, spring easing `cubic-bezier(0.25,0.1,0.25,1)`
- ✅ `globals.css` — Full Apple material system:
  - `--apple-bg-desktop: rgba(242,242,247,1)` — macOS desktop tint
  - `--apple-bg-sidebar: rgba(228,228,235,0.72)` — Finder sidebar vibrancy
  - `--apple-surface-elevated: rgba(255,255,255,0.72)` — glassmorphic card
  - Text opacity scale: `0.85 / 0.50 / 0.28 / 0.18`
  - `--apple-separator: rgba(0,0,0,0.08)` — hairline separators
  - `.apple-card` — `backdrop-blur(20px)` + inner white highlight (`inset 0 1px 0 rgba(255,255,255,0.65)`)
  - `.apple-widget` — hover lift (`translateY(-2px)`) with spring easing
  - `.apple-inset-group` / `.apple-inset-row` — iOS Settings style
  - `.finder-row` — macOS Finder list rows
  - `.apple-shimmer` — gradient skeleton
  - `@media (prefers-reduced-motion)` — all transforms disabled for accessibility

#### shadcn Primitives Reskinned
- ✅ `button.tsx` — `active:scale-[0.97]` spring press, Apple Blue with inset highlight shadow, glass outline, `rounded-[10px]`
- ✅ `card.tsx` — uses `.apple-card` class, `animate-fade-in` on mount
- ✅ `badge.tsx` — translucent tinted backgrounds (`rgba(0,122,255,0.12)` blue, `rgba(255,59,48,0.12)` red), success/warning variants
- ✅ `table.tsx` — Finder hairline separators, Apple blue hover tint, 11px caption headers

#### Pages
- ✅ **Sidebar** — `backdrop-blur(24px)` Finder vibrancy, gradient app icon (blue→purple `#007AFF→#5856D6`), translucent active pill with inner highlight, pulsing green glow ring
- ✅ **Dashboard** — Glass widget KPI cards with ghost icon watermarks (large blurred background icon), gradient progress bars with per-bucket tinted tracks
- ✅ **SDR Table** — Finder list view, avatar inner white ring (`box-shadow: 0 0 0 2px rgba(255,255,255,0.85)`), gradient progress bars (green/blue/amber by pct)
- ✅ **Leads Filter** — iOS segmented control pills: active has inset shadow (`box-shadow: 0 1px 4px rgba(0,122,255,0.4), inset 0 1px 0 rgba(255,255,255,0.2)`), inactive has glass background
- ✅ **Leads Page** — Glass card table, translucent capsule stage badges, `ChevronRight` slides 4px right on hover (`transition-transform duration-300`)
- ✅ **Lead Detail** — Apple Health-style timeline:
  - Gradient track (`transparent → 8% → 92% → transparent`)
  - Glassmorphic event bubbles (`background: rgba(255,255,255,0.60)`, `backdrop-blur(12px)`)
  - Pulsing live ring on last event (`animate-pulse-ring`)
  - Gradient text on high ICP scores (`background-image: linear-gradient(...)`)
  - Inspector panel (ICP Score, What Happens Next, Timeline Summary)
- ✅ **Settings** — iOS inset grouped lists, emoji icon tiles, translucent status badges

### Phase 5 — Connector Credentials Panel (2026-09-28)
**Commit `0c1142a` — 3 files, 396 insertions**

#### API
- ✅ `POST /api/connectors/:name/test` — validates user-supplied credentials live via `connector.connect()` + `healthCheck()`, returns `{ ok, latencyMs, error }`
- Connector name validated against enum: `salesforce | hubspot | outreach | clearbit`
- No DB persistence (Vault integration is post-MVP); test-only

#### Dashboard — `ConnectorCredentialsForm`
- ✅ Accordion per connector — collapsed by default ("Enter credentials" toggle)
- ✅ Per-connector field definitions:
  - HubSpot: Private App Token (secret), Webhook Secret (secret)
  - Salesforce: Instance URL, Client ID, Client Secret (secret), Sandbox (optional)
  - Outreach: API Key (secret)
  - Clearbit: API Key (secret)
- ✅ Password toggle (Eye/EyeOff) on all secret fields
- ✅ Apple HIG input with focus ring (`0 0 0 3px rgba(0,122,255,0.12)`)
- ✅ "Test Connection" button disabled until all required fields filled
- ✅ Animated result: green ✓ Connected / red ✗ error message with `animate-fade-in`
- ✅ Auto-resets to idle after 4s on success
- ✅ Persistence note: honest that credentials aren't stored, points to Railway env vars

### UI/UX Documentation
- ✅ `dashboard/UI_UX.md` — comprehensive LLM-readable doc: design tokens, all pages, all components, data contracts, helper functions, UX decisions, file structure, extension rules

---

### Phase 6 — Outcome Tracking: Meeting Detection via SF Event Polling (2026-09-29)

Commit `79510d1` — 17 files, 1,653 insertions, 22 deletions.

#### What was built

**Migration 018** — `outcome_signal` table (append-only, RLS, `UNIQUE(org, play, external_event_id)`) + 5 new `play_instance` columns.

**Policy loader** — `src/policies/outcome-detection.ts` — `OutcomeDetectionConfig`, `OutcomeDetectionConfigMissingError`, `loadOutcomeDetectionConfig()`. Config in `policy_rules.conditions` JSONB. Never silently defaults.

**SF connector** — `src/connectors/salesforce/events.ts` — `queryMeetingEvents`, `queryLeadStatus`, `queryOpportunityStage`, `queryCustomCheckbox`. SOQL injection safe (`escapeSoqlString`). SF scope errors → `ConnectorError(SF_EVENT_OBJECT_NOT_ACCESSIBLE)`. `SalesforceEvent` type added.

**Two new BullMQ jobs:**
- `outcome-detection-poller` — `OUTCOME_POLL_INTERVAL_MS` (default 10 min). Polls SF Events per org. Primary signals flip `outcome_status`; supportive signals are informational only. Fully idempotent on re-poll.
- `outcome-window-closer` — `OUTCOME_WINDOW_CLOSE_INTERVAL_MS` (default 1 hr). THE ONLY job that sets `no_meeting`. Writes event FIRST then updates `play_instance`.

**Worker integration** — `inbound-lead.worker.ts` now loads `attribution_window_days` at play creation and persists it to `play_instance`. Poller reads this value — never re-reads from policy after play start.

**API** — `GET /api/leads/:id` now returns 5 outcome fields. `GET /api/metrics/overview` adds `meeting_rate` (null when no windows closed yet).

**Dashboard types** — `OutcomeStatus`, `PlayState` interface, `meeting_rate` in `OverviewMetrics`, outcome `EventType` values.

**Tests** — 17 passing: policy loader (5), detection poller (7), window closer (5). Zero TypeScript errors.

#### One-time activation needed
Run `db/migrations/018_outcome_tracking.sql` in Supabase SQL editor. Then seed a `policy_rules` row:
```sql
INSERT INTO policy_rules (organization_id, rule_type, name, conditions, is_active, priority)
VALUES (
  '<your-org-id>',
  'outcome_detection',
  'Default Outcome Detection',
  '{
    "primary_meeting_types": ["Meeting", "Discovery Call"],
    "attribution_window_days": 14,
    "supportive_lead_statuses": ["Meeting Booked"],
    "supportive_checkbox_field": null,
    "supportive_opportunity_stage_keywords": []
  }',
  true,
  1
);
```
Also set env vars on Railway worker: `OUTCOME_POLL_INTERVAL_MS`, `OUTCOME_WINDOW_CLOSE_INTERVAL_MS` (optional — defaults to 10min / 1hr).

---

## Commit History (this project)

```
79510d1  feat: Outcome Tracking — Meeting Detection via Salesforce Event Polling
0c1142a  feat(settings): connector credentials panel with live test
4ea3744  feat(dashboard): Apple HIG transformation — glass materials, spring physics, iOS/macOS native feel
5483cb6  feat(dashboard): Apple-inspired UI polish for RevOps + SDR views
1ac2775  fix(dashboard): move outputFileTracingRoot to top-level for Next.js 15
342b3bd  docs: add professional README with architecture, setup, and API reference
e11adf2  fix(dashboard/types): make Lead.company optional, add Lead.email optional
0ba0ccb  fix(dashboard): unwrap lead API envelope and map timeline to TimelineEvent shape
66bb576  fix(api): align connectors and policies responses with dashboard types
6a3a15a  fix(metrics): align speed-to-lead response shape with SpeedToLeadDistribution type
04d5577  docs(progress): production deployment complete (Railway + Vercel)
e84f2af  fix(dashboard): add force-dynamic to all auth pages + Vercel env vars
```

---

## Known Issues / Gotchas

| Issue | Status | Notes |
|---|---|---|
| Railway GitHub auto-deploy sometimes doesn't fire | ⚠️ Workaround | Use `railway up --service <uuid>` manually |
| Vercel production alias not auto-assigned | ⚠️ Fixed once | Must assign via API or Vercel dashboard |
| `SUPABASE_SERVICE_KEY` not `SUPABASE_SERVICE_ROLE_KEY` | ✅ Documented | Env var name matters exactly |
| Clearbit no key → all leads → nurture | ✅ Expected behavior | Not a bug |
| SDR table empty | ✅ Expected | No leads routed to owners (no Clearbit = ICP score 0) |
| SLA timer detects breaches but Slack not wired | ⚠️ Backlog | Timer runs every 2 min, escalation message TODO |
| Human-in-loop approve/reject | ⚠️ Partial | `interrupt()` in graph, no API endpoint or UI |
| `next/font/google` fails in offline sandbox | ✅ Fixed | System font stack in local builds; Vercel fetches Inter fine |
| GitHub shows failed deployment badges | ⚠️ Cosmetic | Railway/Vercel GitHub app config issue, services are healthy |
| **Outcome Tracking — Event.Type → Subject fix** | ✅ Fixed `f11838f` | `Event.Type` does not exist in this org (INVALID_FIELD, confirmed by live SF describe). Would have silently returned zero detections. Fixed: SOQL now filters on `Subject IN (...)`. Policy config `primaryMeetingTypes` = Subject values. Seed with `'Meeting'`. |
| **Outcome Tracking — ConnectorError isolation validated** | ✅ Validated pattern | The `INVALID_FIELD` error hit `SF_SCOPE_ERROR_CODES` detection in `soqlFetch`, threw `ConnectorError(SF_EVENT_OBJECT_NOT_ACCESSIBLE)`, and was caught per-org in the poller — loud, typed, non-crashing. Error isolation pattern works under a real failure condition, not just in mocks. Evidence the per-org try/catch earns its keep. |
| **Outcome Tracking — Subject combobox vs. locked picklist** | ⚠️ Watch item | SF combobox = picklist suggestions + freeform text allowed. A rep can type "Mtg", "meeting w/ prospect", etc. — exact-match `IN ('Meeting')` would miss silently. Same failure mode as Event.Type mismatch but one level down. Confirm with design partner whether Subject is enforced-only or freeform in practice before trusting conversion numbers long-term. Not a blocker for testing. |
| **Outcome Tracking — dedup blocks re-engaged leads** | ⚠️ Known limitation | A lead who re-submits a form is deduped before `play_instance` is created — no new outcome tracking window. Understates conversion if re-engagement is common. **Product decision — do not resolve without a real re-engagement case.** Review before second design partner. |
| **Outcome Tracking — poller live-fire ✅ PROVEN on Railway** | ✅ Confirmed autonomous | (1) Local run: `outcome_signal` `190bb96e`, play `meeting_booked`, `event_log` `e0aab037`. (2) Railway autonomous: reset to `no_outcome_yet`, poller fired on its own 60s schedule, wrote `outcome_signal` `43370a1f` + `event_log` `daf813e3` at `08:13:28Z` — no manual trigger. Logic ✅ + scheduler ✅ + together on Railway ✅. |
| **Redis connection bug — all BullMQ jobs were no-ops** | ✅ Fixed `38f224e` | `{ url: '...' }` is silently ignored by ioredis — it connects to `localhost:6379` instead. Fixed to `new Redis(url, { maxRetriesPerRequest: null })`. This means the SLA timer was also never actually detecting breaches on Railway — needs re-verification after fix deploys. |
| **SLA timer — Railway confirmed ✅** | ✅ Proven `08:04:26Z` | Play `78ee3b29` flipped `sla_breached=true` on Railway within seconds of correct deployment. `event_log` row `7b57d8ac` written (`actor_type=sla_timer`). Detection pipeline end-to-end proven. Escalation enqueue (`addJob`) runs on Railway Redis — not verifiable locally (no local Redis). |
| **Railway startCommand wrong — ALL scheduled jobs were dead** | ✅ Fixed via API | Worker was configured with `startCommand: node dist/queue/workers/inbound-lead.worker.js` — an override that bypassed the Dockerfile CMD entirely. The SLA timer, outcome poller, and outcome window closer were never instantiated on Railway — not once, on any deployment. Fixed to `node dist/queue/start-workers.js` via Railway API. |
| **Redis audit — single source, all clean** | ✅ Confirmed | All 6 Queues and 3 Workers import `redisConnection` from `setup.ts`. No file creates its own Redis connection. The `38f224e` fix (`new Redis(url, { maxRetriesPerRequest: null })`) covers 100% of BullMQ usage by definition. |
| **Window-closer — Railway confirmed ✅** | ✅ Proven `08:40:35Z` | Set `attribution_window_days=0` on `da963e42` (test.webhook@acme.com). Window-closer fired autonomously on Railway 60s schedule. Play flipped to `no_meeting`. `event_log` `351581cf` written (`outcome_window_closed`, `outcome_poller`). No-op check: `796f1c5c` (meeting_booked) untouched (0 window_closed events). Outcome Tracking FULLY proven. |
| **Outreach bug 1 — static API key assumption** | ✅ Fixed `29de401` | `OutreachConfig = { apiKey }` was wrong — Outreach has no static API keys. Requires OAuth2. Replaced with `{ clientId, clientSecret, accessToken, refreshToken, mailboxId }`. |
| **Outreach bug 2 — missing mailbox in sequenceStates** | ✅ Fixed `29de401` | `enrollInSequence` was missing the required `mailbox` relationship. Outreach returns 422 without it. Added `mailboxId` from config. Returns `OutreachSequenceState` (id captured as evidence). |
| **Outreach bug 3 — first-touch passed empty parameters** | ✅ Fixed `29de401` | `first-touch.ts` was passing `parameters: {}` and `connectors: {} as any` — executor always skipped enrollment. Rewritten to create OutreachConnector inline, find-or-create prospect by email, pass `outreach_prospect_id` + `sequence_id` to `executeAction`. Mirrors `route.ts` SF pattern. |
| **Outreach — awaiting live-fire test** | 🔧 Next step | Code complete + TSC clean. Needs: OUTREACH_CLIENT_ID, OUTREACH_CLIENT_SECRET set in Railway → OAuth flow via `/api/outreach/oauth/start` → OUTREACH_ACCESS_TOKEN, OUTREACH_REFRESH_TOKEN, OUTREACH_MAILBOX_ID, OUTREACH_SEQUENCE_ID set → HubSpot form submit → confirm prospect enrolled in Outreach UI. |

---

## What's Left to Build

### Outcome Tracking — Steps to prove it works (preconditions for counting it as done)
- [ ] **Get actual SF Event.Type value** — ask design partner: what string does their calendar integration write when a meeting is booked? Get it from a real Event row in their org (`SELECT Type FROM Event LIMIT 10`), not from a conversation. A typo'd config is a silent false-negative.
- [ ] **Seed `outcome_detection` policy row** — with real values from step above. SQL template in Phase 6 section above.
- [ ] **Deploy updated worker to Railway** — migration is live; worker needs a redeploy to pick up the new repeatable jobs (`railway up --service 816200b4-40c8-41c5-8ea4-124718c13efa`)
- [ ] **Create one test SF Event manually** — linked to a lead that exists in the system; `Type` must match the seeded config
- [ ] **Watch Railway worker logs for one full poll cycle** — either `outcome_status = 'meeting_booked'` appears, or a `ConnectorError` tells you exactly what's wrong. Do not move on until you've seen actual output.

### Near-term
- [ ] **Slack escalation on SLA breach** — SLA timer already detects; just wire the Slack message
- [ ] **Human-in-loop UI** — approve/reject endpoint + Settings or Lead Detail UI
- [ ] **Clearbit API key** — enables real enrichment → real ICP scores → real routing
- [ ] **Outreach API key** — enables sequence enrollment
- [ ] **Vercel production alias automation** — set permanent domain in Vercel project settings
- [ ] **Playwright E2E tests** — dashboard user flows

### Medium-term
- [ ] QualificationAgent v2 — Claude LLM reasoning (currently rule-based)
- [ ] RoutingAgent v2 — factor in rep skills, close rates, deal size
- [ ] Simulation engine — replay historical leads through new rules/agents
- [ ] Webhook sources beyond HubSpot (Salesforce forms, Typeform, Webflow)
- [ ] Multi-org onboarding (currently hardcoded to single org UUID)
- [ ] Supabase Vault integration for credential persistence in Settings panel

### Long-term (full agentic vision)
- [ ] PlaybookAgent — decides which play to run per lead
- [ ] ResearchAgent — autonomous enrichment from news, LinkedIn, funding signals
- [ ] CoachingAgent — post-call transcript scoring
- [ ] Policy Studio UI — drag-and-drop policy builder
- [ ] Simulation/replay engine with A/B comparison
- [ ] CEO plain-language Q&A interface ("What's our speed-to-lead this quarter?")
- [ ] SOC 2 Type I audit certification

---

## Architecture Rules (non-negotiable, from GEMINI.md)

1. `organization_id` on every table and every query — NEVER from request body, always from JWT
2. `event_log` is immutable — append-only, never UPDATE
3. `decision_snapshot` JSONB NOT NULL on every event_log row — enables exact replay
4. Agent pipeline: `Agent → ProposedAction → RiskValidator → PolicyValidator → ActionExecutor → Connector`
5. Agents NEVER call connectors directly
6. `ConnectorError` is the only error type from connectors
7. SLA deadline = `form_submitted_at + policy_minutes` — NEVER `created_at`
8. Round-robin uses `routing_state` table — never random, never in-memory
9. Idempotency key: `${organizationId}:${workflowRunId}:${actionId}` — checked before every external call
10. Cross-tenant isolation tests must pass before any feature ships

---

## Tech Stack (Pinned Versions)

```
Runtime:      Node.js 20 + TypeScript 5.8.3 (strict)
API:          Fastify
Workflow:     LangGraph JS
Queue:        BullMQ + Redis
Database:     PostgreSQL via Supabase (17 migrations)
Frontend:     Next.js 15 App Router + shadcn/ui + Tailwind v3.4.17
LLM:          Anthropic Claude (wired in workflow, agents still rule-based v1)
Deploy API:   Railway
Deploy UI:    Vercel
```

> ⚠️ **Version locks — DO NOT upgrade:**
> - Tailwind must stay `3.4.17` — v4 breaks shadcn `@apply` directives
> - TypeScript must stay `5.8.3` — TS 7 incompatible with Next.js 15

---

## Key Files Quick Reference

| File | Purpose |
|---|---|
| `src/app.ts` | Fastify app factory — all route registrations |
| `src/routes/api/connectors.ts` | `GET /api/connectors` + `POST /api/connectors/:name/test` |
| `src/routes/api/leads.ts` | `/leads`, `/leads/:id`, `/leads/:id/timeline` |
| `src/routes/api/metrics.ts` | `/overview`, `/speed-to-lead` |
| `src/routes/api/policies.ts` | `GET /api/policies`, `PUT /api/policies/:id` |
| `src/routes/webhooks.ts` | `POST /webhooks/hubspot` — HMAC + idempotency + enqueue |
| `src/agents/qualification/` | QualificationAgent v1 |
| `src/agents/routing/` | RoutingAgent v1 |
| `src/queue/workers/` | BullMQ inbound-lead worker |
| `src/events/event-log.ts` | Append-only event log writer |
| `src/middleware/tenant-context.ts` | JWT → organizationId |
| `dashboard/src/app/dashboard/page.tsx` | RevOps overview — KPI widgets + chart |
| `dashboard/src/app/dashboard/sdr-table.tsx` | Per-SDR performance table |
| `dashboard/src/app/leads/page.tsx` | Leads list with filter |
| `dashboard/src/app/leads/[id]/page.tsx` | Lead detail + timeline |
| `dashboard/src/app/settings/page.tsx` | System Health — connectors + policies |
| `dashboard/src/app/settings/connector-credentials-form.tsx` | Credential entry + live test |
| `dashboard/src/app/settings/sla-form.tsx` | SLA minutes editor |
| `dashboard/src/components/sidebar-nav.tsx` | macOS Finder-style sidebar |
| `dashboard/src/components/ui/` | Reskinned shadcn primitives (button, card, badge, table) |
| `dashboard/src/types/api.ts` | All TypeScript API response types |
| `dashboard/UI_UX.md` | Complete UI/UX documentation for LLMs |
| `db/migrations/001–017` | All database migrations |
| `GEMINI.md` | Master rules — read before any change |
| `.agent/rules/api.md` | API-specific rules |

---

## How to Test

```bash
# Health check
curl https://gtm-api-production-adc0.up.railway.app/health

# List leads (set JWT from Railway/Vercel env vars)
JWT="<your DASHBOARD_JWT>"
curl "https://gtm-api-production-adc0.up.railway.app/api/leads?limit=5" \
  -H "Authorization: Bearer $JWT"

# Test a connector credential
curl -X POST "https://gtm-api-production-adc0.up.railway.app/api/connectors/clearbit/test" \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"apiKey":"sk_your_key_here"}'

# Trigger end-to-end: create a HubSpot contact in portal 247417540
# → appears in dashboard within ~30s at https://gtm-autopilot-dashboard.vercel.app/leads
```
