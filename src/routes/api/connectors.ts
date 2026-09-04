/**
 * connectors.ts — GET /api/connectors
 * Returns health status for all 4 connectors.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { SalesforceConnector } from '../../connectors/salesforce/salesforce.connector.js'
import { HubSpotConnector } from '../../connectors/hubspot/hubspot.connector.js'
import { OutreachConnector } from '../../connectors/outreach/outreach.connector.js'
import { ClearbitConnector } from '../../connectors/clearbit/clearbit.connector.js'

export async function connectorRoutes(app: FastifyInstance) {
  app.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const results = await Promise.allSettled([
      checkConnector('salesforce', new SalesforceConnector(), {
        instanceUrl: process.env.SF_INSTANCE_URL!,
        clientId: process.env.SF_CLIENT_ID!,
        clientSecret: process.env.SF_CLIENT_SECRET!,
        sandbox: process.env.SF_SANDBOX === 'true',
      }),
      checkConnector('hubspot', new HubSpotConnector(), {
        apiKey: process.env.HUBSPOT_API_KEY!,
        webhookSecret: process.env.HUBSPOT_WEBHOOK_SECRET!,
      }),
      checkConnector('outreach', new OutreachConnector(), {
        apiKey: process.env.OUTREACH_API_KEY!,
      }),
      checkConnector('clearbit', new ClearbitConnector(), {
        apiKey: process.env.CLEARBIT_API_KEY!,
      }),
    ])

    const statuses = results.map((r, i) => {
      const names = ['salesforce', 'hubspot', 'outreach', 'clearbit']
      if (r.status === 'fulfilled') return r.value
      return { name: names[i], ok: false, error: String((r as any).reason), latencyMs: 0, lastChecked: new Date() }
    })

    return reply.send({ connectors: statuses })
  })
}

async function checkConnector(name: string, connector: any, config: any) {
  try {
    await connector.connect(config)
    const health = await connector.healthCheck()
    return { name, ...health }
  } catch (err) {
    return { name, ok: false, error: String(err), latencyMs: 0, lastChecked: new Date() }
  }
}
