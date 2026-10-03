/**
 * connectors.ts — GET /api/connectors + POST /api/connectors/:name/test
 *
 * GET /api/connectors
 *   Returns health status for all configured connectors for the requesting org.
 *   Reads credentials from connector_config (org-scoped) for OAuth connectors.
 *   Falls back to env vars for development.
 *
 * POST /api/connectors/:name/test
 *   Body: connector-specific credential fields
 *   Returns: { ok: boolean, latencyMs: number, error?: string }
 *   For OAuth connectors (outreach, salesloft): tests using stored tokens from connector_config.
 *   For credential connectors (salesforce, hubspot, zoominfo): tests using body fields.
 *   Does NOT persist credentials from test calls — use OAuth flow or save endpoint.
 *
 * POST /api/connectors/:name/save
 *   Body: connector-specific credential fields (for non-OAuth connectors)
 *   Persists credentials to connector_config. For OAuth connectors, use the OAuth flow.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { SalesforceConnector } from '../../connectors/salesforce/salesforce.connector.js'
import { HubSpotConnector }    from '../../connectors/hubspot/hubspot.connector.js'
import { OutreachConnector }   from '../../connectors/outreach/outreach.connector.js'
import { ClearbitConnector }   from '../../connectors/clearbit/clearbit.connector.js'
import { SalesloftConnector }  from '../../connectors/salesloft/salesloft.connector.js'
import { ZoomInfoConnector }   from '../../connectors/zoominfo/zoominfo.connector.js'
import {
  getConnectorConfig,
  upsertConnectorConfig,
  getOAuthTokens,
} from '../../repositories/connector-config.repository.js'

// Valid connector names (matches DB enum)
const CONNECTOR_NAMES = ['salesforce', 'hubspot', 'outreach', 'clearbit', 'salesloft', 'zoominfo'] as const
type ConnectorName = typeof CONNECTOR_NAMES[number]

// OAuth connectors — use stored tokens, not body credentials
const OAUTH_CONNECTORS: ConnectorName[] = ['outreach', 'salesloft']

export async function connectorRoutes(app: FastifyInstance) {

  // ── GET /api/connectors ──────────────────────────────────────────────────
  app.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = (request as any).tenantContext?.organizationId
      ?? process.env.DEFAULT_ORG_ID

    const results = await Promise.allSettled([
      // Salesforce — credentials from env vars (client_credentials flow, no redirect)
      checkConnector('salesforce', new SalesforceConnector(), {
        instanceUrl:  process.env.SF_INSTANCE_URL ?? '',
        clientId:     process.env.SF_CLIENT_ID ?? '',
        clientSecret: process.env.SF_CLIENT_SECRET ?? '',
        sandbox:      process.env.SF_SANDBOX === 'true',
      }),

      // HubSpot — API key from env vars
      checkConnector('hubspot', new HubSpotConnector(), {
        apiKey:        process.env.HUBSPOT_API_KEY ?? '',
        webhookSecret: process.env.HUBSPOT_WEBHOOK_SECRET ?? '',
      }),

      // Outreach — OAuth tokens from connector_config (org-scoped)
      (async () => {
        const tokens = await getOAuthTokens(orgId, 'outreach')
        if (!tokens) return { name: 'outreach', ok: false, error: 'Not connected — visit /api/outreach/oauth/start', latencyMs: 0, lastChecked: new Date() }
        return checkConnector('outreach', new OutreachConnector(), {
          clientId:     process.env.OUTREACH_CLIENT_ID ?? '',
          clientSecret: process.env.OUTREACH_CLIENT_SECRET ?? '',
          accessToken:  tokens.access_token,
          refreshToken: tokens.refresh_token,
          mailboxId:    process.env.OUTREACH_MAILBOX_ID ?? '',
        })
      })(),

      // Clearbit — API key from env vars
      checkConnector('clearbit', new ClearbitConnector(), {
        apiKey: process.env.CLEARBIT_API_KEY ?? '',
      }),

      // Salesloft — OAuth tokens from connector_config (org-scoped)
      (async () => {
        const tokens = await getOAuthTokens(orgId, 'salesloft')
        if (!tokens) return { name: 'salesloft', ok: false, error: 'Not connected — visit /api/salesloft/oauth/start', latencyMs: 0, lastChecked: new Date() }
        return checkConnector('salesloft', new SalesloftConnector(), {
          clientId:     process.env.SALESLOFT_CLIENT_ID ?? '',
          clientSecret: process.env.SALESLOFT_CLIENT_SECRET ?? '',
          accessToken:  tokens.access_token,
          refreshToken: tokens.refresh_token,
        })
      })(),

      // ZoomInfo — credentials from connector_config (username/password)
      (async () => {
        const row = await getConnectorConfig(orgId, 'zoominfo')
        const cfg = row?.config as any
        if (!cfg?.username || !cfg?.password) {
          return { name: 'zoominfo', ok: false, error: 'Not configured — add credentials in Settings', latencyMs: 0, lastChecked: new Date() }
        }
        return checkConnector('zoominfo', new ZoomInfoConnector(), {
          username: cfg.username,
          password: cfg.password,
        })
      })(),
    ])

    const names = ['salesforce', 'hubspot', 'outreach', 'clearbit', 'salesloft', 'zoominfo'] as const
    const statuses = results.map((r, i) => {
      if (r.status === 'fulfilled') return r.value
      return { name: names[i], ok: false, error: String((r as any).reason), latencyMs: 0, lastChecked: new Date() }
    })

    return reply.send(statuses.map(s => ({
      name:        s.name,
      status:      s.ok ? 'healthy' : 'unhealthy' as 'healthy' | 'unhealthy',
      error:       s.ok ? undefined : (s as any).error,
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
            name: { type: 'string', enum: ['salesforce', 'hubspot', 'outreach', 'clearbit', 'salesloft', 'zoominfo'] },
          },
        },
        body: { type: 'object', additionalProperties: true },
      },
    },
    async (
      request: FastifyRequest<{ Params: { name: ConnectorName }; Body: Record<string, string> }>,
      reply: FastifyReply
    ) => {
      const { name } = request.params
      const creds    = request.body
      const orgId    = (request as any).tenantContext?.organizationId ?? process.env.DEFAULT_ORG_ID

      if (!CONNECTOR_NAMES.includes(name)) {
        return reply.status(400).send({ error: 'INVALID_CONNECTOR', message: `Unknown connector: ${name}`, requestId: request.id })
      }

      let result: { name: string; ok: boolean; error?: string; latencyMs: number; lastChecked: Date | string }

      try {
        switch (name) {
          case 'salesforce':
            result = await checkConnector('salesforce', new SalesforceConnector(), {
              instanceUrl:  creds.instanceUrl  ?? '',
              clientId:     creds.clientId     ?? '',
              clientSecret: creds.clientSecret ?? '',
              sandbox:      creds.sandbox === 'true',
            })
            break
          case 'hubspot':
            result = await checkConnector('hubspot', new HubSpotConnector(), {
              apiKey:        creds.apiKey        ?? '',
              webhookSecret: creds.webhookSecret ?? '',
            })
            break
          case 'outreach': {
            // OAuth connector — test using stored tokens; body creds ignored for security
            const tokens = await getOAuthTokens(orgId, 'outreach')
            if (!tokens) {
              return reply.status(400).send({ error: 'NOT_CONNECTED', message: 'Outreach not connected. Complete OAuth flow first.', requestId: request.id })
            }
            result = await checkConnector('outreach', new OutreachConnector(), {
              clientId:     process.env.OUTREACH_CLIENT_ID ?? '',
              clientSecret: process.env.OUTREACH_CLIENT_SECRET ?? '',
              accessToken:  tokens.access_token,
              refreshToken: tokens.refresh_token,
              mailboxId:    process.env.OUTREACH_MAILBOX_ID ?? '',
            })
            break
          }
          case 'clearbit':
            result = await checkConnector('clearbit', new ClearbitConnector(), {
              apiKey: creds.apiKey ?? '',
            })
            break
          case 'salesloft': {
            // OAuth connector — test using stored tokens
            const tokens = await getOAuthTokens(orgId, 'salesloft')
            if (!tokens) {
              return reply.status(400).send({ error: 'NOT_CONNECTED', message: 'Salesloft not connected. Complete OAuth flow first.', requestId: request.id })
            }
            result = await checkConnector('salesloft', new SalesloftConnector(), {
              clientId:     process.env.SALESLOFT_CLIENT_ID ?? '',
              clientSecret: process.env.SALESLOFT_CLIENT_SECRET ?? '',
              accessToken:  tokens.access_token,
              refreshToken: tokens.refresh_token,
            })
            break
          }
          case 'zoominfo':
            result = await checkConnector('zoominfo', new ZoomInfoConnector(), {
              username: creds.username ?? '',
              password: creds.password ?? '',
            })
            break
          default:
            return reply.status(400).send({ error: 'INVALID_CONNECTOR', message: 'Unknown connector', requestId: request.id })
        }
      } catch (err) {
        return reply.status(500).send({ error: 'CONNECTOR_TEST_FAILED', message: String(err), requestId: request.id })
      }

      return reply.send({
        ok:         result.ok,
        latencyMs:  result.latencyMs,
        error:      result.ok ? undefined : (result.error ?? 'Connection failed'),
        lastChecked: typeof result.lastChecked === 'string' ? result.lastChecked : new Date(result.lastChecked).toISOString(),
      })
    }
  )

  // ── POST /api/connectors/:name/save ─────────────────────────────────────
  // Persists non-OAuth connector credentials to connector_config.
  // For OAuth connectors (outreach, salesloft), use the OAuth flow instead.
  app.post(
    '/:name/save',
    {
      schema: {
        params: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string', enum: ['salesforce', 'hubspot', 'clearbit', 'zoominfo'] },
          },
        },
        body: { type: 'object', additionalProperties: true },
      },
    },
    async (
      request: FastifyRequest<{ Params: { name: ConnectorName }; Body: Record<string, string> }>,
      reply: FastifyReply
    ) => {
      const { name } = request.params
      const creds    = request.body
      const orgId    = (request as any).tenantContext?.organizationId ?? process.env.DEFAULT_ORG_ID

      if (OAUTH_CONNECTORS.includes(name)) {
        return reply.status(400).send({
          error: 'USE_OAUTH_FLOW',
          message: `${name} uses OAuth2. Use the Connect button to authenticate.`,
          requestId: request.id,
        })
      }

      let configToSave: Record<string, unknown>
      switch (name) {
        case 'salesforce':
          configToSave = { instanceUrl: creds.instanceUrl, clientId: creds.clientId, clientSecret: creds.clientSecret, sandbox: creds.sandbox === 'true' }
          break
        case 'hubspot':
          configToSave = { apiKey: creds.apiKey, webhookSecret: creds.webhookSecret }
          break
        case 'clearbit':
          configToSave = { apiKey: creds.apiKey }
          break
        case 'zoominfo':
          configToSave = { username: creds.username, password: creds.password }
          break
        default:
          return reply.status(400).send({ error: 'INVALID_CONNECTOR', message: 'Unknown connector', requestId: request.id })
      }

      try {
        await upsertConnectorConfig(orgId, name, configToSave)
        return reply.send({ ok: true })
      } catch (err) {
        return reply.status(500).send({ error: 'SAVE_FAILED', message: String(err), requestId: request.id })
      }
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
