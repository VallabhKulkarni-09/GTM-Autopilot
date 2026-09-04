/**
 * server.ts — Starts the Fastify server.
 * Imports buildApp() from app.ts. Never imported by tests.
 */

import 'dotenv/config'
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
