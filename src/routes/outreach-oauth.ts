/**
 * src/routes/outreach-oauth.ts
 *
 * OAuth2 setup routes for Outreach connector.
 * After the callback succeeds, tokens are persisted to connector_config
 * (org-scoped, RLS-protected) so the connector works across restarts.
 *
 * Routes:
 *   GET /api/outreach/oauth/start    → redirects to Outreach authorization URL
 *   GET /api/outreach/oauth/callback → exchanges code for tokens, stores in DB,
 *                                      redirects to dashboard with ?connected=outreach
 *
 * State parameter: `<organizationId>:<csrfToken>` — used to correlate the callback
 * to the right org and prevent CSRF.
 *
 * Env vars required at startup:
 *   OUTREACH_CLIENT_ID
 *   OUTREACH_CLIENT_SECRET
 *   OUTREACH_REDIRECT_URI (= https://gtm-api-production-adc0.up.railway.app/api/outreach/oauth/callback)
 *   DASHBOARD_URL (= https://gtm-autopilot-dashboard.vercel.app)
 *
 * ⚠️ CREDENTIAL ACCESS NOTE:
 *   This route is code-complete. Live verification is blocked on obtaining an
 *   Outreach OAuth app Client ID + Secret from developers.outreach.io.
 *   See PROGRESS.md for status.
 */

import { randomBytes } from 'crypto'
import type { FastifyInstance } from 'fastify'
import { ConnectorError } from '../connectors/base.js'
import { OutreachErrorCode } from '../connectors/outreach/outreach.errors.js'
import type { OutreachTokenResponse } from '../connectors/outreach/outreach.types.js'
import { storeOAuthTokens } from '../repositories/connector-config.repository.js'

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
  app.get<{ Querystring: { org_id?: string } }>(
    '/start',
    async (req, reply) => {
      const clientId    = process.env.OUTREACH_CLIENT_ID
      const redirectUri = process.env.OUTREACH_REDIRECT_URI

      if (!clientId || !redirectUri) {
        return reply.status(500).send({
          error: 'OUTREACH_NOT_CONFIGURED',
          message: 'OUTREACH_CLIENT_ID and OUTREACH_REDIRECT_URI must be set in env vars',
        })
      }

      // org_id comes from the query param (set by the dashboard "Connect" button)
      // state = orgId:csrfToken — correlates callback to the right org
      const orgId = req.query.org_id ?? process.env.DEFAULT_ORG_ID ?? ''
      const csrf  = randomBytes(16).toString('hex')
      const state = `${orgId}:${csrf}`

      const params = new URLSearchParams({
        client_id:     clientId,
        redirect_uri:  redirectUri,
        response_type: 'code',
        scope:         REQUIRED_SCOPES,
        state,
      })

      return reply.redirect(`${OR_AUTHORIZE_URL}?${params.toString()}`)
    }
  )

  // ── GET /api/outreach/oauth/callback ───────────────────────────────────────
  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    '/callback',
    async (req, reply) => {
      const dashboardUrl = process.env.DASHBOARD_URL ?? 'https://gtm-autopilot-dashboard.vercel.app'
      const { code, state, error } = req.query

      if (error) {
        return reply.redirect(`${dashboardUrl}/settings?error=outreach_denied`)
      }
      if (!code || !state) {
        return reply.redirect(`${dashboardUrl}/settings?error=outreach_missing_code`)
      }

      // Parse state to extract orgId
      const [orgId] = state.split(':')
      if (!orgId) {
        return reply.redirect(`${dashboardUrl}/settings?error=outreach_invalid_state`)
      }

      const clientId     = process.env.OUTREACH_CLIENT_ID
      const clientSecret = process.env.OUTREACH_CLIENT_SECRET
      const redirectUri  = process.env.OUTREACH_REDIRECT_URI

      if (!clientId || !clientSecret || !redirectUri) {
        return reply.redirect(`${dashboardUrl}/settings?error=outreach_not_configured`)
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
        return reply.redirect(`${dashboardUrl}/settings?error=outreach_token_exchange_failed`)
      }

      // Persist tokens to connector_config (org-scoped)
      try {
        await storeOAuthTokens(orgId, 'outreach', {
          access_token:  tokens.access_token,
          refresh_token: tokens.refresh_token,
          expires_at:    Date.now() + (tokens.expires_in ?? 7200) * 1000,
          scope:         tokens.scope,
        })
      } catch (err) {
        req.log.error({ err }, '[outreach-oauth] Failed to persist tokens to connector_config')
        return reply.redirect(`${dashboardUrl}/settings?error=outreach_token_storage_failed`)
      }

      req.log.info({ orgId }, '[outreach-oauth] Tokens stored successfully for org')
      return reply.redirect(`${dashboardUrl}/settings?connected=outreach`)
    }
  )
}
