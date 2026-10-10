# ONBOARDING.md — GTM Autopilot

_Written 2026-10-07 from the repo at commit `a32093c` plus its uncommitted working tree. Sources read: `GEMINI.md`, `.agent/rules/*`, `PROGRESS.md`, `progress.md`, `db/migrations/`, `git log`, and the source tree. Where documents and code disagree, the code is trusted and the disagreement is flagged in **⚠ Discrepancy** notes._

**Evidence convention.** "Verified" means there is a real ID, log line or DB row in the project record. "Code complete" means it compiles and mocked tests pass. These are not the same thing (see §6). Anything I could not trace to evidence is labelled *claimed but not independently verified in available records*.

---

## 1. What this product does

When someone fills out a form on a company's website (we currently listen to HubSpot), the system notices within seconds. It looks up who the person's company is (size, industry, country), scores whether they look like the kind of customer the business wants, picks the right salesperson for them (by territory, then fairly by workload), creates the lead and a follow-up task in the CRM (Salesforce), and, when an outreach tool is connected, enrolls them in an email sequence. A timer watches the clock: if nobody has contacted the lead within the allowed window (default 15 minutes, counted from when the *prospect* submitted the form), it escalates, intending a Slack alert. Every step is written down permanently along with exactly what information the decision was based on, so a manager can later ask "why did this lead go to Priya and not Sam?" and get a real answer.

It is for B2B sales teams with inbound leads, where leads go cold if nobody responds fast. The widely cited claim is that odds of qualifying a lead fall steeply after the first few minutes; those statistics are industry folklore as far as this repo is concerned. No figure is sourced anywhere in the codebase, so treat them as motivation, not as something we have proven. We are not a CRM and not a sales-engagement tool; the intended position is the governed decision layer above them.

---

## 2. What's actually running in production

**Hosting (from `PROGRESS.md`, 2026-09-21):**
- Railway project: `gtm-api` (Fastify, `https://gtm-api-production-adc0.up.railway.app`, `/health`), `gtm-worker` (BullMQ), managed Redis. Auto-deploys from `main`.
- Vercel: `gtm-autopilot-dashboard.vercel.app` (Next.js, auto-deploys from `main`).
- Supabase Postgres (the DB). HubSpot webhook points at the Railway URL (portal `247417540`).

**The real flow, with the actual code:**

| # | Step | Where | Status / proof |
|---|---|---|---|
| 1 | HubSpot POSTs an **array** of events to `/webhooks/hubspot` | `src/routes/webhooks.ts` | **Verified live 2026-09-18**: HubSpot's servers hit the endpoint, signature passed, duplicate `eventId` returned `duplicate`. |
| 2 | Signature check, then idempotency check, then enqueue, then 200 | `webhooks.ts`; connector `verifyWebhookSignature` | Verified (same run). Algorithm is `SHA256(secret + body)`, not true HMAC (fix `6adc0b0`). |
| 3 | Worker picks job, fetches the contact by `objectId` from HubSpot API | `src/queue/workers/inbound-lead.worker.ts` | Verified: lead "Yashasvi U <yashasvi@infosys.com>" created from a real webhook. |
| 4 | `runInboundLeadPlay()` (LangGraph) | `src/workflows/inbound-lead/graph.ts` | Verified through step 3's run (11 events, ended `nurture`). |
| 5 | `validate` (dedup), `account-match`, `enrich`, `qualify`, `route`, `first-touch`, `complete` / `mark-nurture` / `mark-duplicate` | `src/workflows/inbound-lead/nodes/*.ts` | Dedup/qualify/route proven on 7 demo scenarios (71 event rows, 0 failures, 2026-09-16). |
| 6 | Enrichment: Clearbit then Apollo **organization** (company-level only) | `nodes/enrich.ts`, `src/evidence/evidence-store.ts` | **Not proven end-to-end in production.** See below. |
| 7 | Qualification (rule-based ICP score + hard gates) | `src/agents/qualification/` | Proven on demo data. Runs on whatever company data exists. |
| 8 | Routing (territory, then round-robin via `routing_state`) | `src/agents/routing/` | Proven on demo data; EMEA lead correctly paused for human review. |
| 9 | Policy + risk validation, then `ActionExecutor` | `src/actions/action-executor.ts` | Proven on demo data. |
| 10 | Salesforce Lead + Task creation | `src/connectors/salesforce/` | **Verified**: SF Tasks `00Tg7000008WLZVEA4`, `00Tg7000008WY6nEAG`, `00Tg7000008WdeLEAS`; SF Leads `00Qg700000HuTWeEAN`, `00Qg700000HuiFuEAJ`, `00Qg700000HwAtFEAV` (org `orgfarm-78e1e3f00b-dev-ed`, 2026-09-17). |
| 11 | Outreach / Salesloft enrollment | `first-touch.ts`, `action-executor.ts` | **Unverified. No live enrollment has ever happened.** Blocked on vendor access. |
| 12 | SLA timer (every 2 min, deadline = `form_submitted_at` + policy) | `src/queue/jobs/sla-timer.ts` | **Verified on Railway**: play `78ee3b29` flipped `sla_breached=true` at 08:04:26Z, `event_log` `7b57d8ac` (commit `6f71391` message). |
| 13 | Escalation to Slack | `src/queue/workers/escalate.worker.ts` | ⚠ **Discrepancy**: `progress.md` says Slack is "NOT wired"; the worker contains a full Slack Block Kit POST gated on `SLACK_WEBHOOK_URL`. No record shows a message ever arriving in Slack. Treat as unverified. |
| 14 | Outcome tracking: poller detects Salesforce meetings, window-closer sets `no_meeting` | `src/queue/jobs/outcome-detection-poller.ts`, `outcome-window-closer.ts` | **Verified**: `outcome_signal` `190bb96e`, play `796f1c5c` → `meeting_booked`, `event_log` `e0aab037`. Autonomous run on Railway recorded in commit `73e8799` message; I did not re-inspect that evidence. |
| 15 | Dashboard (overview, leads, lead timeline, settings) | `dashboard/src/app/*` | Deployed. Reads `/api/*` routes (`src/routes/api/`). Later UI commits (Apple-style polish) are not independently verified on the live Vercel site. |

**Enrichment, precisely (the weakest part of the flow):**
- Oct 3: the `evidence` table had **0 rows** in production; all 16 recorded `enrichment_succeeded` events were false (silent-null bug, see §6). Fixed in `e610a45`.
- Clearbit: no real Clearbit response has ever been observed. `.env` now has `CLEARBIT_API_KEY` set, but no record shows a successful call, and whether that key is on both Railway services is unconfirmed. Clearbit's standalone API may no longer be available to new accounts; check before investing.
- Apollo org enrichment: the real API was called (stripe.com, mphasis.com, no-match, gmail.com). `scripts/verify-apollo-enrichment.mjs` and `scripts/verify-two-source-interaction.mjs` wrote evidence rows to Supabase and read IDs back. **Important caveat:** those scripts re-implement the row-writing logic and (for the two-source test) seed the Clearbit rows synthetically. They did **not** execute `enrich.ts` or run on Railway. ⚠ `PROGRESS.md` calls the connector "production-ready" and the project's own standard says that isn't earned yet. The honest status is *connector verified against the live API; `enrich.ts` Apollo stage not yet run through a real webhook on Railway*.
- Whether `APOLLO_API_KEY` is set on both Railway services: stated in an earlier session; not independently verified.

**⚠ Uncommitted state.** The working tree has **17 modified files and 3 untracked migrations** (`022_oauth_nonce.sql`, `023_reenrollment_policy.sql`, `024_event_type_reenrollment.sql`). They include OAuth nonce hardening, a re-enrollment path in `validate.ts`, and changes to `start-workers.ts`, `sla-timer.ts`, `inbound-lead.worker.ts` and `PROGRESS.md`. None of it is in `main`, so none of it is on Railway. Whether 022–024 were applied to the Supabase DB is unknown. Migration `021` does not exist (numbering gap). Review `git status` and `git diff` before building on anything.

**⚠ Two progress files.** Both `progress.md` (lowercase) and `PROGRESS.md` are tracked. They have diverged: `progress.md` holds the outcome-tracking, SLA/startCommand and Slack/human-review notes; `PROGRESS.md` holds the Salesloft/ZoomInfo/Apollo/silent-null sessions. Neither is complete. Consolidate them.

---

## 3. Architecture principles that must never be violated

From `GEMINI.md` and `.agent/rules/` (`agents, api, connectors, events, frontend, queue, schema, testing`). `GEMINI.md` wins on conflict.

1. **`organization_id` on every table and every query.** Why: this is multi-tenant; one leaked row across orgs is existential. Never read it from request body/query/params, only from the verified JWT (`src/middleware/tenant-context.ts`).
2. **`event_log` is immutable.** Append events; never `UPDATE` them. Three events per action: `action_proposed`, `action_execution_started`, then `action_execution_succeeded` or `_failed`. Why: it is the audit trail and the replay source. `action_execution_state` is the only mutable projection.
3. **`decision_snapshot` JSONB NOT NULL on every event.** Must contain lead, company, policies (with versions), owner workloads, evidence IDs, agent name/version, prompt version, model name. Why: lets you reconstruct exactly why a decision was made. An empty `evidenceIds` that *looks* populated is a lie in the audit trail (see §6).
4. **Pipeline is inviolable:** Agent → ProposedAction → RiskValidator → PolicyValidator → ActionExecutor → Connector. Agents never call connectors. Why: governance (risk and policy checks) sits in that chain; bypassing it removes the product's reason to exist.
5. **Connectors throw only `ConnectorError`** (source, code, statusCode, raw response). Never a raw `Error`/`TypeError`. Why: the executor and pollers classify failures by type; a raw `TypeError: fetch failed` previously broke tests and error isolation.
6. **SLA deadline = `form_submitted_at` + policy minutes.** Not `created_at`, not enqueue time. Why: the SLA is about the prospect's wait, not our queue latency.
7. **Round-robin uses the `routing_state` table.** No randomness, no in-memory counters. Why: must survive restarts and multiple workers.
8. **Idempotency key on every action:** `${organizationId}:${workflowRunId}:${actionId}`, checked before every external API call. Why: BullMQ retries; double CRM tasks and double emails are visible to customers.
9. **Cross-tenant isolation tests must pass before any feature ships.** ⚠ Right now `tests/security/connector-oauth-isolation.test.ts` **fails** because vitest doesn't load `.env` (one failing test in the last full run: 117 passed, 42 skipped, 1 failing). The planned fix (`envFile: '.env'` in `vitest.config.ts`) is not done. Fix this first; shipping with it red breaks this rule.
10. **Build only what is in the task.** Ask before adding features. `api.md` lists the allowed routes; note the OAuth routes (`outreach-oauth.ts`, `salesloft-oauth.ts`) exist outside that list.
11. **Webhook handler:** verify signature first, check idempotency, enqueue, return 200 fast (target <200 ms); never process synchronously.
12. **Never silently default.** E.g. `loadOutcomeDetectionConfig()` throws if config is missing; `storeEnrichmentEvidence(null)` throws. Why: silent defaults are how §6's bugs happened.
13. **Git:** default branch `main`; feature branches merge by PR; identity `VallabhKulkarni-09` / `99166213+VallabhKulkarni-09@users.noreply.github.com` set locally. Never change the default branch.

Three things are never delegated to an agent: schema decisions affecting `event_log`, cross-tenant security tests, and the SLA deadline formula.

---

## 4. Tech stack and version locks

Node.js 20, TypeScript (strict), Fastify 5, LangGraph JS 1.x, BullMQ 6 + ioredis 6 on Redis, PostgreSQL via Supabase, Vitest, Next.js 15 App Router + shadcn/ui + Tailwind (dashboard, separate Vercel deploy), Anthropic Claude via provider abstraction (planned; agents v1 are rule-based with no LLM calls).

| Lock | Where | Why |
|---|---|---|
| **TypeScript 5.8.3** (exact, no caret) | `dashboard/package.json` | Pinned in `1678786` while getting the Vercel build working. Don't loosen it. ⚠ The **root** `package.json` has `^5.9.3`, which contradicts the stated lock; the API and dashboard intentionally differ today. Don't "fix" one to match without a build. |
| **Tailwind 3.4.17** (exact) | `dashboard/package.json` | Fixed Tailwind/shadcn build errors on Vercel (`3a41609`). Tailwind 4 uses a different config model; upgrading is likely to break the shadcn setup. Commit evidence shows the pin; the exact breakage mechanism is not documented. |
| **Next 15 / React 19** | `dashboard/package.json` | `outputFileTracingRoot` must be a top-level option in Next 15 (`1ac2775`). All dashboard pages are `force-dynamic` (`e84f1af`). |
| **`new Redis(url)`, not `{ url }`** | `src/queue/setup.ts` | ioredis silently ignored `{ url: ... }`; every BullMQ job was a no-op (`38f224e`). Single connection source; keep it that way. |
| **Node 20 + `ws` transport for supabase-js realtime** | scripts, `getDb()` | Node 20 has no global WebSocket; scripts pass `realtime: { transport: ws }`. |
| **Env var is `SUPABASE_SERVICE_KEY`** | `.env`, Railway | Not `SUPABASE_SERVICE_ROLE_KEY`. |

Postgres enums need a migration for every new value (see §6, four separate enum bugs). `ALTER TYPE ... ADD VALUE` cannot be rolled back.

---

## 5. The connector layer

All connectors live in `src/connectors/<name>/` (+ `base.ts` retry helper), mirror each other, and throw only `ConnectorError`.

| Connector | Does | Auth | Status | Real-world quirks already discovered |
|---|---|---|---|---|
| **Salesforce** | Create Lead/Task, find owners, poll Events/Leads/Opps | OAuth client creds (`SF_CLIENT_ID/SECRET`, `SF_INSTANCE_URL`) | **Live and proven** (IDs in §2) | `Event.Type` **does not exist** in this org; filter on `Subject` (`f11838f`). Subject is a combobox, so reps typing "Mtg" are silently missed by `IN ('Meeting')`. Record `Id` casing and account-match/find-or-create bugs were fixed during integration. SOQL values go through `escapeSoqlString`. |
| **HubSpot** | Receive form/contact webhooks, fetch contact by ID | Private-app token + webhook secret | **Live and proven** (2026-09-18) | Payload is an **array** of events (`c6f36d2`). Signature is `SHA256(secret + body)` (v1-style), not HMAC. Real webhooks carry only `objectId`; you must call `getContactById`. `HUBSPOT_API_KEY` must belong to the **same portal** as the webhook (`247417540`); the developer test portal (`247417606`) caused 404s. Worker now skips 404/no-email contacts gracefully. |
| **Apollo** | Organization enrichment by domain | `x-api-key` | **Live API verified; `enrich.ts` stage not yet run on Railway** | Only `GET /api/v1/organizations/enrich` works on this plan. `people/match` returns **403** (`enrichByEmail()` now throws `AP_INSUFFICIENT_SCOPE`). **No match = HTTP 200 + `{}`**, not an error or 404; check `!data.organization`. Revenue is `organization_revenue`; city/state/country are top-level, not nested. Webmail domains also return `{}`. Static confidence 0.82, which is a constant, not a signal. No title/seniority data, so the +10 senior-title ICP signal depends on the form's `lead.title`. |
| **Clearbit** | Person + company enrichment | API key | **Code complete, unverified** | A real response has never been observed. 404 = no match. Old code swallowed its 401 as success (§6). Static confidence 0.9. Standalone availability uncertain. |
| **Outreach** | Sequence enrollment | OAuth2 | **Code complete, blocked on vendor approval** (OAuth app / partner program) | Old callback printed tokens and discarded them; now persisted to `connector_config` (`29de401`). The health route once passed a removed `apiKey` and threw on every call. Nonce-based OAuth start is in the **uncommitted** tree. |
| **Salesloft** | Cadence enrollment | OAuth2 | **Code complete, blocked on app credentials** | Takes precedence over Outreach when `SALESLOFT_*` env vars are all set (explicit policy). |
| **ZoomInfo** | Enrichment | JWT user/pass, 60-min TTL | **Code complete, blocked on sales-gated account**; not wired into `evidence-store` | Network failure used to leak a raw `TypeError`; now wrapped. |
| **Slack** | SLA escalation message | Webhook URL | **Unverified** (see §2 row 13) | Failure must never crash the escalate worker. |

Source-conflict rule today: Clearbit and Apollo are additive; both write evidence rows. "Higher confidence wins" is effectively a hard-coded permanent winner, not conflict resolution. Apollo's *company-row upsert* is skipped when Clearbit already created the company, but Apollo *evidence rows are always written* on a match. Tested only with synthetic Clearbit rows.

---

## 6. ⭐ The single biggest lesson learned

**This codebase has a consistent history of passing every test and type-check while being functionally broken against the real system.** Mocks encode what the author believes the external world does. Every serious bug so far was invisible to mocks and was found only by running against the real thing.

Three examples, all in the project record:

1. **Railway `startCommand` bug: scheduled jobs never ran.** The Railway worker service had a `startCommand` override running `inbound-lead.worker.js`, bypassing `start-workers.js`. The SLA timer, outcome poller and window-closer **never ran on any Railway deployment, not once, since day one.** Tests passed. Types passed. Nobody noticed until the SLA timer was checked live. Fix: `startCommand = node dist/queue/start-workers.js`, set through the Railway API (it is *not* in the repo; the `Dockerfile` CMD runs `server.js`). It was layered on a prior failure: `new Redis({ url })` silently ignored the URL so every BullMQ job was a no-op. The `ACTIVE_ORG_IDS` env var was also unset.
2. **Silent-null enrichment bug: the audit trail lied.** `.catch(() => null)` collapsed "Clearbit returned 401" and "Clearbit found nothing" into one value, `storeEnrichmentEvidence(null, null)` returned `[]`, and the node emitted `enrichment_succeeded`. Reading the live DB showed 16 `enrichment_succeeded` events, **0 evidence rows**, and `evidenceIds: []` on every decision snapshot. Every ICP score ever produced ran on zero enrichment while the log said otherwise. Fix: three explicit outcomes (failed / skipped-with-reason / succeeded), snapshot rebuilt *after* the write, and the store throws on null.
3. **Salesforce `Event.Type` doesn't exist.** The outcome poller's SOQL used a field that doesn't exist in this org; unit tests mocked the response and passed. It would have returned zero meetings forever and looked healthy. A live `describe` found it. The same live session found four missing Postgres enum values, a wrong `external_identity` column name, and the Redis bug (6 bugs; later total counted as 9 with `ACTIVE_ORG_IDS`, `startCommand` and the Redis audit).

Also found live, not by tests: `play_instance.status='in_sequence'` crashing (it's a `LeadStage`, not a `PlayStatus`); HubSpot portal mismatch; HubSpot array payload; HubSpot's non-HMAC signature; Apollo's `{}` no-match and `organization_revenue` naming (the docs said otherwise).

**The hard rule that follows: nothing is "done" until it has run against the real live system it depends on, with real evidence captured (IDs, log lines, DB rows), not inferred from mocks or code review.** "Code complete" counts for nothing toward progress. This applies to your own work without exception. In practice:
- Capture the *real* external response, commit it as a fixture, and build types from it, not from docs prose.
- For any new pipeline step: trigger it through the real entry point, then read back the actual DB rows and `decision_snapshot`.
- Where a step can fail in more than one way, make each way produce a different, loud outcome. Never collapse failure into "nothing".
- Don't self-certify. Paste raw output where someone else can compare it.
- Apply it to this document too: the Apollo "production-ready" claim in `PROGRESS.md` is exactly the kind of rounding-up this rule forbids.

---

## 7. What is NOT built yet

**A. Built but unverified**
- Outreach and Salesloft enrollment: blocked on vendor OAuth app / partner approval. No live enrollment has ever run.
- ZoomInfo: sales-gated; not wired into `evidence-store`.
- Clearbit enrichment end-to-end (needs a real response and confirmed Railway key).
- Apollo stage inside `enrich.ts` via a real webhook on Railway.
- Slack escalation message (code present, never observed arriving).
- Everything in the uncommitted tree: OAuth nonce flow, re-enrollment (90-day default has "no empirical basis" per migration 023), migrations 022–024.

**B. Not started, correctly deferred**
- Cross-customer intelligence ("Stage 4"): impossible before real customers exist.
- LLM-based agents (v1 is rule-based by design).
- Apollo Sequences: an explicit *product decision* (Outreach vs Salesloft vs Apollo) must come first.
- Dynamic per-field source confidence and real conflict resolution (needs two live sources and real data).
- pgvector use (only when SQL can't answer).

**C. Known gaps to fix soon**
- **Failing cross-tenant isolation test** (vitest `.env` loading). Violates Hard Rule 9. Do this first.
- **Dashboard "meetings" metric is misleading.** In `src/routes/api/metrics.ts`, `meetingsBooked` counts plays with `status === 'completed'`, i.e. the workflow finished, not that a meeting happened. `meeting_rate` is the outcome-based number (null until a window closes). Rename or remove the legacy one.
- **Human-approval dead end.** `graph.ts` calls `interrupt('requires_human_approval')`, but there is no approve/reject endpoint or UI, and the checkpointer is `MemorySaver` (in-memory), so paused plays are lost on restart (violates the "never in-memory" spirit of principle 7). Plays like the EMEA lead just sit paused.
- Slack escalation verification (see above).
- Dedup blocks re-engaged leads, so no new outcome window and understated conversion. Re-enrollment work is uncommitted; needs a real case before trusting it.
- `Subject` freeform matching for meetings (needs confirmation of how a real design partner's reps log meetings).
- Reconcile the two progress files, the TS version inconsistency (§4), and commit or discard the uncommitted work.
- Several credentials appeared in earlier chat/session notes; rotate any that were shared outside secrets storage. None are reproduced here.

---

## 8. The honest state of the business

There is **no design partner and no active customer.** Everything was built and exercised against the founder's own sandbox accounts: a Salesforce dev org, HubSpot portal `247417540`, a personal Supabase project, and the founder's own email addresses. The "customers" in the demo data (Acme Corp Sandbox, CloudBase, DataFlow, RetailMega) are fixtures. You are building toward an unvalidated business, not maintaining a product with users.

Implication: **speed beats polish for anything not on the core path**, and the dashboard's visual refinement is already ahead of the validation it rests on. But *correctness against real systems is non-negotiable*, because the first real design partner will expose every untested seam at once, and a wrong audit trail or cross-tenant leak would end the pilot. Spend effort on closing real-world verification gaps and getting a real partner, not on features.

---

## 9. Where to find things

| Path | What's there |
|---|---|
| `GEMINI.md` | The law: hard rules, flow, stack, git config. Read first. |
| `.agent/rules/` | Per-domain rules: `agents`, `api`, `connectors`, `events`, `frontend`, `queue`, `schema`, `testing`. |
| `README.md`, `ARCHITECTURE.md`, `DEMO.md` | Overview, long architecture doc, demo walkthrough. May lag the code. |
| `PROGRESS.md`, `progress.md` | Session history. Two diverged files; the code wins over both. |
| `db/migrations/` | `001`–`020` committed; `021` missing; `022`–`024` untracked. |
| `src/domain/` | Types only (`db-types.ts` holds enum mirrors, which must match the DB). |
| `src/routes/` | `webhooks.ts`, `outreach-oauth.ts`, `salesloft-oauth.ts`; `api/` has `leads`, `metrics`, `policies`, `connectors`. |
| `src/middleware/tenant-context.ts` | JWT → `organizationId`. |
| `src/queue/` | `setup.ts` (the single Redis source), `start-workers.ts` (the real Railway entry), `workers/` (inbound-lead, escalate), `jobs/` (sla-timer, outcome poller, window closer). |
| `src/workflows/inbound-lead/` | `graph.ts`, `state.ts`, `nodes/` (validate, account-match, enrich, qualify, route, first-touch, complete, mark-*). |
| `src/agents/` | `qualification/` (`rules.ts` has ICP scoring and `FREE_EMAIL_PROVIDERS`), `routing/`. |
| `src/policies/` | Policy engine, validators, `outcome-detection.ts`. |
| `src/actions/` | `action-executor.ts` (idempotency, event guarantee), registry, validators. |
| `src/connectors/` | `apollo`, `clearbit`, `hubspot`, `outreach`, `salesforce`, `salesloft`, `zoominfo`, `base.ts`. Tests and fixtures in `__tests__/`. |
| `src/evidence/` | `evidence-store.ts` (Clearbit and Apollo writes), `context-builder.ts` (`DecisionSnapshot`). |
| `src/events/`, `src/repositories/` | Append-only event log; typed, org-scoped SQL (`connector-config.repository.ts`, `lead.repo.ts`, `event-log.repository.ts`). |
| `dashboard/` | Next.js app (`src/app/{dashboard,leads,settings}`), separate Vercel deploy. `UI_UX.md` for design intent. |
| `scripts/` | `demo-*.mjs` (seed/run/verify/cleanup), `verify-apollo-enrichment.mjs`, `verify-two-source-interaction.mjs`, `verify-enrichment-fix.mjs`, Apollo response fixture. Live-fire scripts cost API credits; don't run in CI. |
| `tests/` | `unit`, `integration`, `e2e`, `security` (cross-tenant). Last full run: 117 passed, 42 skipped (live creds/network), 1 failing (isolation, `.env`). |

**First-day checklist:** read `GEMINI.md` and §6; run `git status` and decide what to do with the uncommitted work; fix the vitest `.env` loading so the isolation suite is green; then pick one §7C item and close it *against a real system, with evidence*.
