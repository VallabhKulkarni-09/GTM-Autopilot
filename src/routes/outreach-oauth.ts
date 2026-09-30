/**
 * src/routes/outreach-oauth.ts
 *
 * Setup utility for bootstrapping Outreach OAuth2 credentials.
 *
 * Routes (NOT protected by tenantContextMiddleware — they are setup-only):
 *
 *   GET /api/outreach/oauth/start
 *     Redirects the browser to Outreach's authorization URL.
 *     Use this once to start the OAuth dance.
 *
 *   GET /api/outreach/oauth/callback
 *     Outreach redirects here with ?code=... after authorization.
 *     Exchanges the code for access_token + refresh_token and returns
 *     them as JSON. Copy these values into Railway env vars:
 *       OUTREACH_ACCESS_TOKEN
 *       OUTREACH_REFRESH_TOKEN
 *
 * Security note: These routes are dev-only setup utilities. They do not
 * store tokens themselves — they print them for manual copy to env vars.
 * Do NOT expose these routes in production without authentication guards.
 *
 * Env vars required at startup:
 *   OUTREACH_CLIENT_ID
 *   OUTREACH_CLIENT_SECRET
 *   OUTREACH_REDIRECT_URI (= https://gtm-api-production-adc0.up.railway.app/api/outreach/oauth/callback)
 */

import type { FastifyInstance } from 'fastify'
import { ConnectorError } from '../connectors/base.js'
import { OutreachErrorCode } from '../connectors/outreach/outreach.errors.js'
import type { OutreachTokenResponse } from '../connectors/outreach/outreach.types.js'

const OR_AUTHORIZE_URL = 'https://api.outreach.io/oauth/authorize'
const OR_TOKEN_URL     = 'https://api.outreach.io/oauth/token'

const REQUIRED_SCOPES = [
  'prospects.all',
  'sequences.all',
  'sequenceStates.all',
  'accounts.all',
  'mailboxes.read',
].join(' ')

export async function outreachOAuthRoutes(app: FastifyInstance): Promise<void> {
  // ── GET /api/outreach/oauth/start ──────────────────────────────────────────
  // Redirects browser to Outreach authorization page.
  app.get('/start', async (_req, reply) => {
    const clientId    = process.env.OUTREACH_CLIENT_ID
    const redirectUri = process.env.OUTREACH_REDIRECT_URI

    if (!clientId || !redirectUri) {
      return reply.status(500).send({
        error: 'OUTREACH_NOT_CONFIGURED',
        message: 'OUTREACH_CLIENT_ID and OUTREACH_REDIRECT_URI must be set in env vars',
      })
    }

    const params = new URLSearchParams({
      client_id:     clientId,
      redirect_uri:  redirectUri,
      response_type: 'code',
      scope:         REQUIRED_SCOPES,
    })

    return reply.redirect(`${OR_AUTHORIZE_URL}?${params.toString()}`)
  })

  // ── GET /api/outreach/oauth/callback ───────────────────────────────────────
  // Outreach redirects here after user authorization.
  // Exchanges ?code for tokens and returns them as JSON.
  app.get<{ Querystring: { code?: string; error?: string } }>(
    '/callback',
    async (req, reply) => {
      const { code, error } = req.query

      if (error) {
        return reply.status(400).send({
          error: 'OUTREACH_AUTH_DENIED',
          message: `Outreach authorization denied: ${error}`,
        })
      }

      if (!code) {
        return reply.status(400).send({
          error: 'MISSING_CODE',
          message: 'No authorization code in callback query params',
        })
      }

      const clientId     = process.env.OUTREACH_CLIENT_ID
      const clientSecret = process.env.OUTREACH_CLIENT_SECRET
      const redirectUri  = process.env.OUTREACH_REDIRECT_URI

      if (!clientId || !clientSecret || !redirectUri) {
        return reply.status(500).send({
          error: 'OUTREACH_NOT_CONFIGURED',
          message: 'OUTREACH_CLIENT_ID, OUTREACH_CLIENT_SECRET, and OUTREACH_REDIRECT_URI must be set',
        })
      }

      let tokens: OutreachTokenResponse
      try {
        const res = await fetch(OR_TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id:     clientId,
            client_secret: clientSecret,
            redirect_uri:  redirectUri,
            grant_type:    'authorization_code',
            code,
          }).toString(),
        })

        if (!res.ok) {
          const raw = await res.text()
          throw new ConnectorError(
            'outreach', OutreachErrorCode.AUTH_FAILED, res.status, raw,
            'Outreach token exchange failed'
          )
        }

        tokens = await res.json() as OutreachTokenResponse
      } catch (err) {
        req.log.error({ err }, '[outreach-oauth] Token exchange failed')
        return reply.status(502).send({
          error:   'TOKEN_EXCHANGE_FAILED',
          message: err instanceof ConnectorError ? err.message : String(err),
        })
      }

      // Return tokens as JSON — copy these into Railway env vars manually.
      // Never store tokens here — Railway env vars are the secret store for MVP.
      return reply.status(200).send({
        message: 'OAuth success. Copy these values into Railway env vars.',
        instructions: {
          OUTREACH_ACCESS_TOKEN:  tokens.access_token,
          OUTREACH_REFRESH_TOKEN: tokens.refresh_token,
          expires_in_seconds:     tokens.expires_in,
          scope:                  tokens.scope,
        },
      })
    }
  )
}
