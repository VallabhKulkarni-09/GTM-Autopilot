/**
 * server.ts — Starts the Fastify server.
 * Imports buildApp() from app.ts. Never imported by tests.
 */

import 'dotenv/config'
import './queue/start-workers.js'
import { buildApp } from './app.js'

const PORT = Number(process.env.PORT ?? 3000)
const HOST = process.env.HOST ?? '0.0.0.0'

const app = buildApp()

app.listen({ port: PORT, host: HOST }, (err, address) => {
  if (err) {
    app.log.error(err)
    process.exit(1)
  }
  app.log.info(`GTM Autopilot API running at ${address}`)
})

async function gracefulShutdown(signal: string): Promise<void> {
  app.log.info(`[server] ${signal} received — starting graceful shutdown`)
  try {
    await app.close()
    app.log.info('[server] Fastify closed cleanly')
    process.exit(0)
  } catch (err) {
    app.log.error({ err }, '[server] Error during shutdown')
    process.exit(1)
  }
}

process.on('SIGTERM', () => { void gracefulShutdown('SIGTERM') })
process.on('SIGINT',  () => { void gracefulShutdown('SIGINT') })
