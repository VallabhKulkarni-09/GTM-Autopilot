/**
 * setup.ts — BullMQ queue definitions and Redis connection.
 * Exports queue instances, addJob helper, and the SLA timer registration.
 */

import { Queue, QueueEvents, Worker } from 'bullmq'

// ─── Redis connection ─────────────────────────────────────────────────────────

export const redisConnection = {
  url: process.env.REDIS_URL ?? 'redis://localhost:6379',
}

// ─── Queue definitions ────────────────────────────────────────────────────────

export const inboundLeadQueue = new Queue('inbound-lead-processing', { connection: redisConnection })
export const advancePlayQueue  = new Queue('advance-play-step',       { connection: redisConnection })
export const escalateQueue     = new Queue('escalate-play',           { connection: redisConnection })
export const slaTimerQueue     = new Queue('sla-timer',               { connection: redisConnection })

// ─── addJob helper ────────────────────────────────────────────────────────────

export async function addJob(
  queueName: 'inbound-lead-processing' | 'advance-play-step' | 'escalate-play' | 'sla-timer',
  data: Record<string, unknown>,
  options?: { priority?: number }
): Promise<void> {
  const queues: Record<string, Queue> = {
    'inbound-lead-processing': inboundLeadQueue,
    'advance-play-step': advancePlayQueue,
    'escalate-play': escalateQueue,
    'sla-timer': slaTimerQueue,
  }

  const queue = queues[queueName]
  if (!queue) throw new Error(`Unknown queue: ${queueName}`)

  await queue.add(queueName, data, {
    removeOnComplete: 1000,
    removeOnFail:     500,
    priority:         options?.priority,
    attempts:         3,
    backoff: {
      type:  'exponential',
      delay: 1_000,   // 1s → 2s → 4s between retries
    },
  })
}

// ─── SLA timer repeatable job ─────────────────────────────────────────────────
// Runs every 2 minutes. Called once at startup.

export async function registerSlaTimer(): Promise<void> {
  // BullMQ v5+: use upsertJobScheduler for repeatable jobs
  await slaTimerQueue.upsertJobScheduler(
    'sla-check',
    { every: 2 * 60 * 1000 },
    {
      name: 'sla-check',
      data: { trigger: 'scheduled' },
      opts: {
        removeOnComplete: 10,
        removeOnFail: 50,
      },
    }
  )
}
