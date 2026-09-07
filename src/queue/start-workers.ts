/**
 * start-workers.ts
 * Entry point that starts all BullMQ workers.
 * Import this once at server startup (in server.ts) or run standalone.
 */

import './workers/inbound-lead.worker.js'
import './workers/escalate.worker.js'
import { registerSlaTimer } from './setup.js'
import { runSlaTimer } from './jobs/sla-timer.js'
import { Worker } from 'bullmq'
import { redisConnection } from './setup.js'

// SLA timer worker — processes the repeatable 'sla-check' job
const slaWorker = new Worker(
  'sla-timer',
  async (_job) => {
    const orgIds = (process.env.ACTIVE_ORG_IDS ?? '').split(',').filter(Boolean)
    await runSlaTimer(orgIds)
  },
  { connection: redisConnection, concurrency: 1 }
)

// Register repeatable SLA timer job
registerSlaTimer().then(() => {
  console.log('[workers] SLA timer registered')
}).catch(console.error)

console.log('[workers] All BullMQ workers started')

export { slaWorker }
