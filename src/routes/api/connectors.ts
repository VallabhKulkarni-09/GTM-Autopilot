/**
 * connectors.ts — GET /api/connectors + POST /api/connectors/:name/test
 *
 * POST /api/connectors/:name/test
 *   Body: connector-specific credential fields (see CONNECTOR_FIELDS below)
 *   Returns: { ok: boolean, latencyMs: number, error?: string }
 *   Does NOT persist credentials — validates them live against the connector.
 *   Persistence (Supabase Vault) is a post-MVP feature.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { SalesforceConnector } from '../../connectors/salesforce/salesforce.connector.js'
import { HubSpotConnector }    from '../../connectors/hubspot/hubspot.connector.js'
import { OutreachConnector }   from '../../connectors/outreach/outreach.connector.js'
import { ClearbitConnector }   from '../../connectors/clearbit/clearbit.connector.js'

// Valid connector names (matches DB enum)
const CONNECTOR_NAMES = ['salesforce', 'hubspot', 'outreach', 'clearbit'] as const
type ConnectorName = typeof CONNECTOR_NAMES[number]

export async function connectorRoutes(app: FastifyInstance) {

  // ── GET /api/connectors ──────────────────────────────────────────────────
  app.get('/', async (_request: FastifyRequest, reply: FastifyReply) => {
    const results = await Promise.allSettled([
      checkConnector('salesforce', new SalesforceConnector(), {
        instanceUrl:  process.env.SF_INSTANCE_URL!,
        clientId:     process.env.SF_CLIENT_ID!,
        clientSecret: process.env.SF_CLIENT_SECRET!,
        sandbox:      process.env.SF_SANDBOX === 'true',
      }),
      checkConnector('hubspot', new HubSpotConnector(), {
        apiKey:        process.env.HUBSPOT_API_KEY!,
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
      const names = ['salesforce', 'hubspot', 'outreach', 'clearbit'] as const
      if (r.status === 'fulfilled') return r.value
      return { name: names[i], ok: false, error: String((r as any).reason), latencyMs: 0, lastChecked: new Date() }
    })

    return reply.send(statuses.map(s => ({
      name:        s.name,
      status:      s.ok ? 'healthy' : 'unhealthy' as 'healthy' | 'unhealthy',
      lastChecked: typeof s.lastChecked === 'string' ? s.lastChecked : new Date(s.lastChecked).toISOString(),
    })))
  })

  // ── POST /api/connectors/:name/test ─────────────────────────────────────
  app.post(
    '/:name/test',
    {
      schema: {
        params: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string', enum: ['salesforce', 'hubspot', 'outreach', 'clearbit'] },
          },
        },
        body: {
          type: 'object',
          additionalProperties: true, // each connector has different fields
        },
      },
    },
    async (
      request: FastifyRequest<{
        Params: { name: ConnectorName }
        Body: Record<string, string>
      }>,
      reply: FastifyReply
    ) => {
      const { name } = request.params
      const creds    = request.body

      if (!CONNECTOR_NAMES.includes(name)) {
        return reply.status(400).send({
          error: 'INVALID_CONNECTOR',
          message: `Unknown connector: ${name}`,
          requestId: request.id,
        })
      }

      let result: { name: string; ok: boolean; error?: string; latencyMs: number; lastChecked: Date | string }

      try {
        switch (name) {
          case 'salesforce':
            result = await checkConnector('salesforce', new SalesforceConnector(), {
              instanceUrl:  creds.instanceUrl  || '',
              clientId:     creds.clientId     || '',
              clientSecret: creds.clientSecret || '',
              sandbox:      creds.sandbox === 'true',
            })
            break
          case 'hubspot':
            result = await checkConnector('hubspot', new HubSpotConnector(), {
              apiKey:        creds.apiKey        || '',
              webhookSecret: creds.webhookSecret || '',
            })
            break
          case 'outreach':
            result = await checkConnector('outreach', new OutreachConnector(), {
              apiKey: creds.apiKey || '',
            })
            break
          case 'clearbit':
            result = await checkConnector('clearbit', new ClearbitConnector(), {
              apiKey: creds.apiKey || '',
            })
            break
          default:
            return reply.status(400).send({ error: 'INVALID_CONNECTOR', message: 'Unknown connector', requestId: request.id })
        }
      } catch (err) {
        return reply.status(500).send({
          error: 'CONNECTOR_TEST_FAILED',
          message: String(err),
          requestId: request.id,
        })
      }

      return reply.send({
        ok:         result.ok,
        latencyMs:  result.latencyMs,
        error:      result.ok ? undefined : (result.error ?? 'Connection failed'),
        lastChecked: typeof result.lastChecked === 'string' ? result.lastChecked : new Date(result.lastChecked).toISOString(),
      })
    }
  )
}

// ── Shared health-check helper ────────────────────────────────────────────────
async function checkConnector(name: string, connector: any, config: any) {
  try {
    await connector.connect(config)
    const health = await connector.healthCheck()
    return { name, ...health }
  } catch (err) {
    return { name, ok: false, error: String(err), latencyMs: 0, lastChecked: new Date() }
  }
}
