---
globs: dashboard/**/*.tsx, dashboard/**/*.ts
description: >
  Activated when building the Next.js dashboard — any page,
  component, or data fetching layer.
---

# Frontend Rules

## Three Views Only — MVP

Build exactly these three. Nothing else.

```
/dashboard           → Overview metrics
/leads               → Lead list with filters
/leads/[id]          → Lead event timeline (the audit trail view)
/settings            → Connector health + SLA config + routing rules
```

If a feature is not in one of these four routes, do not build it.
No additional pages. No additional tabs. No modals for unplanned features.

## The Primary Metric — Must Be Prominent

On /dashboard, the incremental meeting conversion must be the headline number.
Not buried in a table. Not a small card. The first thing the eye sees.

```
INCREMENTAL MEETING CONVERSION

This period: 22 meetings from 100 qualified leads
Prior period: 15 meetings from 100 qualified leads
Δ: +7 meetings (+47%)
```

Below this: operational metrics (% touched <15 min, avg first touch, SLA breaches).

## The Lead Event Timeline — The Most Important View

/leads/[id] is the most critical page in the product.
It must answer "what happened to this lead and why?" in under 1 minute.

Every event_log row renders as a timeline entry showing:

```
[timestamp] [event_type in plain English] [actor]
[decision_risk_score if agent event]
[reason_codes in plain English if agent event]
[policy name + decision if policy event]
[result: ✓ Success / ✗ Failed / ⚠ Skipped]
[external system confirmation if applicable]
```

Plain English labels for event types (map these, don't show raw event_type):
```typescript
const EVENT_LABELS: Record<EventType, string> = {
  'webhook_received':              'Form submission received',
  'enrichment_requested':          'Enrichment started',
  'enrichment_succeeded':          'Enrichment complete',
  'enrichment_failed':             'Enrichment failed',
  'dedup_passed':                  'Duplicate check passed',
  'dedup_rejected':                'Duplicate detected — play stopped',
  'action_proposed':               'Agent decision made',
  'policy_validated':              'Policy check passed',
  'policy_rejected':               'Policy check failed',
  'action_execution_started':      'Action started',
  'action_execution_succeeded':    'Action completed',
  'action_execution_failed':       'Action failed',
  'sla_breached':                  '⚠ SLA deadline missed',
  'escalation_triggered':          'Escalation triggered',
  'escalation_sent':               'Manager notified',
  'human_review_requested':        'Human review required',
  'human_approved':                'Approved by human',
  'human_rejected':                'Rejected by human',
  'play_completed':                'Play completed',
  'play_marked_nurture':           'Moved to nurture',
}
```

## Data Fetching Rules

```typescript
// CORRECT: Server component fetches from Fastify API
async function LeadTimeline({ leadId }: { leadId: string }) {
  const timeline = await fetch(
    `${process.env.API_URL}/api/leads/${leadId}/timeline`,
    { headers: { Authorization: `Bearer ${await getServerToken()}` } }
  )
  // render timeline
}

// WRONG: fetching from Supabase directly
import { createClient } from '@supabase/supabase-js'
const { data } = await supabase.from('event_log').select('*')
```

Never query Supabase directly from the frontend. Always go through the Fastify API.

## Component Rules

- Use shadcn/ui components as the base for everything
- No custom CSS files — Tailwind utility classes only
- No animation libraries — keep it fast in MVP
- No client-side state management library — React useState is sufficient for MVP
- No additional npm packages without explicit approval

## Settings Page

Display only (no editing in MVP unless specified):
- Connector health: green/amber/red dot + last checked time per connector
- SLA configuration: current values (editable via simple number inputs)
- Routing rules: displayed as readable cards
- Escalation recipients: current values

## Performance Rules

- Every page uses Next.js server components by default
- Client components ('use client') only when interactivity requires it
- No page should take more than 2 seconds to load on a normal connection
- Lead list must be paginated (50 per page, with load more)
- Lead timeline must render even for leads with 100+ events

## What Not to Build

```
✗ Real-time WebSocket updates (polling is fine for MVP)
✗ Export to CSV (dashboard only for now)
✗ User management UI
✗ Billing/plan UI
✗ Notification preferences
✗ Dark mode
✗ Mobile responsive layout (desktop only for MVP)
✗ Charts beyond the speed-to-lead distribution bar chart
```
