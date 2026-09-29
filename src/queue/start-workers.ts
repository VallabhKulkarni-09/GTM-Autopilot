/**
 * start-workers.ts
 * Entry point that starts all BullMQ workers.
 * Import this once at server startup (in server.ts) or run standalone.
 */

import './workers/inbound-lead.worker.js'
import './workers/escalate.worker.js'
import {
  registerSlaTimer,
  registerOutcomePoller,
  registerOutcomeWindowCloser,
  redisConnection,
  outcomePollerQueue,
  outcomeWindowCloserQueue,
} from './setup.js'
import { runSlaTimer } from './jobs/sla-timer.js'
import { runOutcomeDetectionPoller } from './jobs/outcome-detection-poller.js'
import { runOutcomeWindowCloser } from './jobs/outcome-window-closer.js'
import { Worker } from 'bullmq'

// ── SLA timer worker ──────────────────────────────────────────────────────────
const slaWorker = new Worker(
  'sla-timer',
  async (_job) => {
    const orgIds = (process.env.ACTIVE_ORG_IDS ?? '').split(',').filter(Boolean)
    await runSlaTimer(orgIds)
  },
  { connection: redisConnection, concurrency: 1 }
)

// ── Outcome detection poller worker ──────────────────────────────────────────
const outcomePollerWorker = new Worker(
  'outcome-detection-poller',
  async (_job) => {
    const orgIds = (process.env.ACTIVE_ORG_IDS ?? '').split(',').filter(Boolean)
    await runOutcomeDetectionPoller(orgIds)
  },
  { connection: redisConnection, concurrency: 1 }
)

// ── Outcome window closer worker ──────────────────────────────────────────────
const outcomeWindowCloserWorker = new Worker(
  'outcome-window-closer',
  async (_job) => {
    const orgIds = (process.env.ACTIVE_ORG_IDS ?? '').split(',').filter(Boolean)
    await runOutcomeWindowCloser(orgIds)
  },
  { connection: redisConnection, concurrency: 1 }
)

// ── Register all repeatable jobs ──────────────────────────────────────────────
registerSlaTimer().then(() => {
  console.log('[workers] SLA timer registered')
}).catch(console.error)

registerOutcomePoller().then(() => {
  console.log('[workers] Outcome detection poller registered')
}).catch(console.error)

registerOutcomeWindowCloser().then(() => {
  console.log('[workers] Outcome window closer registered')
}).catch(console.error)

console.log('[workers] All BullMQ workers started')

export { slaWorker, outcomePollerWorker, outcomeWindowCloserWorker }
