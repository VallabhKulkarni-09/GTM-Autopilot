---
globs: src/queue/**/*.ts
description: >
  Activated when building BullMQ workers, job definitions,
  or the SLA timer job.
---

# Queue Rules

## Queue Names — Fixed Set

```typescript
const QUEUES = {
  INBOUND_LEAD:    'inbound-lead-processing',
  ADVANCE_STEP:    'advance-play-step',
  ESCALATE:        'escalate-play',
  SLA_TIMER:       'sla-timer',          // repeatable job
} as const
```

Never create ad-hoc queue names. Always use this constant.

## Job Priority

```
Priority 1 (highest): escalation jobs
Priority 2:           inbound lead processing
Priority 3:           advance play step
Priority 4:           follow-up checks
```

## BullMQ Worker Configuration

```typescript
const workerConfig = {
  concurrency: 5,          // conservative for MVP
  maxStalledCount: 3,
  stalledInterval: 30000,  // 30 seconds
}

const jobDefaultOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 1000             // 1s, 2s, 4s
  },
  removeOnComplete: { count: 1000 },
  removeOnFail: { count: 5000 }
}
```

## The SLA Timer Job — The Heartbeat

This is the most critical job in the system. It runs every 2 minutes.

```typescript
// Repeatable job configuration
await queue.add(
  'sla-timer',
  {},
  {
    repeat: { every: 2 * 60 * 1000 },  // every 2 minutes
    jobId: 'sla-timer-repeatable',
    priority: 1
  }
)
```

The SLA timer job logic (in order, no deviations):

```typescript
async function slaTimerJob(organizationIds: string[]) {
  for (const orgId of organizationIds) {

    // 1. Find plays where SLA deadline has passed and first touch has NOT happened
    const breachedPlays = await playInstanceRepo.findSlaBreached(orgId)
    // Query: WHERE first_touch_deadline < NOW()
    //          AND first_touch_at IS NULL
    //          AND status = 'running'
    //          AND sla_breached = FALSE
    //          AND organization_id = orgId

    for (const play of breachedPlays) {
      // 2. Write sla_breached event FIRST (before marking)
      await eventLog.write({
        eventType: 'sla_breached',
        organizationId: orgId,
        playInstanceId: play.id,
        leadId: play.lead_id,
        actorType: 'sla_timer',
        eventStatus: 'success',
        decision_snapshot: await buildDecisionSnapshot(orgId, play.lead_id)
      })

      // 3. Mark play as breached
      await playInstanceRepo.markSlaBreached(play.id)

      // 4. Enqueue escalation at highest priority
      await escalateQueue.add(
        'escalate-play',
        { playId: play.id, organizationId: orgId },
        { priority: 1 }
      )
    }

    // 5. Find plays where next follow-up is due
    const dueFollowUps = await playInstanceRepo.findDueFollowUps(orgId)
    for (const play of dueFollowUps) {
      await advanceQueue.add('advance-play-step', { playId: play.id })
    }
  }
}
```

## SLA Deadline — The Non-Negotiable Rule

```typescript
// CORRECT — always uses form_submitted_at
const slaDeadline = new Date(
  lead.form_submitted_at.getTime() + (policy.sla_minutes * 60 * 1000)
)

// WRONG — these are all incorrect
const slaDeadline = new Date(playInstance.created_at.getTime() + ...)
const slaDeadline = new Date(Date.now() + ...)
const slaDeadline = new Date(job.processedOn + ...)
```

The SLA clock starts the moment the prospect submitted the form.
Queue processing delay is irrelevant. System time is irrelevant.

## Worker Files

```
src/queue/
  setup.ts             ← initialize Redis connection, all queues, all workers
  workers/
    inbound-lead.worker.ts    ← processes HubSpot form submissions
    advance-step.worker.ts    ← advances play to next step
    escalate.worker.ts        ← handles escalation flow
  jobs/
    sla-timer.ts              ← the 2-minute heartbeat
```

## Error Handling in Workers

Workers must catch all errors and handle them explicitly:

```typescript
worker.on('failed', async (job, error) => {
  await eventLog.write({
    eventType: 'action_execution_failed',
    ...context,
    errorCode: error instanceof ConnectorError ? error.code : 'WORKER_ERROR',
    errorMessage: error.message,
    errorRaw: error instanceof ConnectorError ? error.raw : undefined,
    eventStatus: 'failed'
  })

  // If max retries exceeded, mark play as failed
  if (job.attemptsMade >= job.opts.attempts) {
    await playInstanceRepo.markFailed(job.data.playId, error.message)
  }
})
```

Never let a worker failure go unlogged. The event_log must always know what happened.
