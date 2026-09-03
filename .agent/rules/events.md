---
globs: src/events/**/*.ts
description: >
  Activated when building the event log, event processor,
  or any code that reads from or writes to event_log.
---

# Event System Rules

## The Core Pattern: Event Sourcing

The event_log is the source of truth. It is immutable.
Current state is derived from the event stream by the event-processor.

```
event_log (immutable — source of truth)
    ↓
event-processor.ts (reads events, derives current state)
    ↓
action_execution_state (mutable projection — for fast queries)
```

Dashboards and APIs query action_execution_state.
Never query event_log for current status.
The event_log is for audit, replay, and simulation only.

## Event Types — Complete List

```typescript
type EventType =
  // Ingestion
  | 'webhook_received'
  | 'idempotency_check_passed'
  | 'idempotency_check_failed'

  // Enrichment
  | 'enrichment_requested'
  | 'enrichment_succeeded'
  | 'enrichment_failed'
  | 'enrichment_skipped'

  // Deduplication
  | 'dedup_passed'
  | 'dedup_rejected'

  // Agent decisions
  | 'action_proposed'
  | 'action_risk_assessed'
  | 'policy_validated'
  | 'policy_rejected'

  // Execution
  | 'action_execution_started'
  | 'action_execution_succeeded'
  | 'action_execution_failed'
  | 'action_execution_deduplicated'  // idempotency hit — not re-executed

  // SLA
  | 'sla_checked'
  | 'sla_breached'
  | 'escalation_triggered'
  | 'escalation_sent'

  // Human in the loop
  | 'human_review_requested'
  | 'human_approved'
  | 'human_rejected'

  // Play lifecycle
  | 'play_completed'
  | 'play_failed'
  | 'play_paused'
  | 'play_resumed'
  | 'play_marked_nurture'
  | 'play_marked_duplicate'
```

## Writing Events — The Correct Pattern

```typescript
// WRONG: write pending, then update
await db.insert('event_log', { status: 'pending', ...data })
await db.update('event_log', id, { status: 'success' })  // FORBIDDEN

// CORRECT: write a new event for each state transition
await eventLog.write({
  eventType: 'action_execution_started',
  ...context
})
// ... execute the action ...
await eventLog.write({
  eventType: 'action_execution_succeeded',
  ...context,
  output: result
})
```

Three events per action execution, always:
1. `action_proposed` — when the agent returns a ProposedAction
2. `action_execution_started` — when ActionExecutor begins the call
3. `action_execution_succeeded` OR `action_execution_failed`

## The decision_snapshot Field — Never Optional

Every event_log.write() call must include decision_snapshot.
This is enforced at the TypeScript type level — it is not optional.

```typescript
type WriteEventInput = {
  organizationId: string
  workflowRunId: string
  playInstanceId: string
  leadId: string
  eventType: EventType
  actorType: ActorType
  actorId?: string
  agentVersion?: string
  modelProvider?: string
  modelName?: string
  promptVersion?: string
  decision_snapshot: DecisionSnapshot  // NOT OPTIONAL. Never undefined. Never null.
  proposedAction?: ProposedAction
  candidateActions?: ProposedAction[]
  policyRuleId?: string
  policyName?: string
  policyPassed?: boolean
  policyDecision?: Record<string, unknown>
  externalSystem?: ConnectorName
  externalId?: string
  idempotencyKey?: string
  eventStatus: EventStatus
  errorCode?: string
  errorMessage?: string
  errorRaw?: unknown
  durationMs?: number
}
```

## The event-processor.ts

This file reads from event_log and maintains action_execution_state.

It must handle each event type and update the projection accordingly:

```typescript
async function processEvent(event: EventLogRow): Promise<void> {
  switch (event.event_type) {
    case 'action_proposed':
      await actionExecutionStateRepo.upsert({
        idempotencyKey: event.idempotency_key,
        status: 'proposed',
        proposedAt: event.occurred_at,
        ...
      })
      break

    case 'action_execution_started':
      await actionExecutionStateRepo.update(event.idempotency_key, {
        status: 'started',
        startedAt: event.occurred_at
      })
      break

    case 'action_execution_succeeded':
      await actionExecutionStateRepo.update(event.idempotency_key, {
        status: 'succeeded',
        completedAt: event.occurred_at,
        externalId: event.external_id
      })
      break

    case 'action_execution_failed':
      await actionExecutionStateRepo.update(event.idempotency_key, {
        status: 'failed',
        completedAt: event.occurred_at,
        errorCode: event.error_code
      })
      break

    // ... handle all other event types
  }
}
```

## Reading Events for the Lead Timeline

The lead timeline view queries event_log directly (not the projection).
It returns events in chronological order for a specific lead.

```typescript
// This is the ONLY read query allowed on event_log from application code
async getLeadTimeline(
  organizationId: string,
  leadId: string
): Promise<EventLogRow[]> {
  return db.query(
    `SELECT * FROM event_log
     WHERE organization_id = $1 AND lead_id = $2
     ORDER BY occurred_at ASC`,
    [organizationId, leadId]
  )
}
```

All other queries go to action_execution_state, play_instance, or lead tables.
