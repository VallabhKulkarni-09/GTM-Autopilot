/**
 * src/routes/salesloft-oauth.ts
 *
 * OAuth2 setup routes for Salesloft connector.
 * Mirrors the Outreach OAuth route pattern exactly.
 *
 * Routes:
 *   GET /api/salesloft/oauth/start    → redirects to Salesloft authorization URL
 *   GET /api/salesloft/oauth/callback → exchanges code for tokens, stores in DB,
 *                                       redirects to dashboard with ?connected=salesloft
 *
 * Env vars required:
 *   SALESLOFT_CLIENT_ID
 *   SALESLOFT_CLIENT_SECRET
 *   SALESLOFT_REDIRECT_URI (= https://gtm-api-production-adc0.up.railway.app/api/salesloft/oauth/callback)
 *   DASHBOARD_URL
 *
 * ⚠️ CREDENTIAL ACCESS NOTE:
 *   This route is code-complete. Live verification is blocked on obtaining a
 *   Salesloft OAuth app from the Salesloft App Portal (developers.salesloft.com).
 *   Dev credentials (≤10 users) may be self-service. See PROGRESS.md.
 */

import { randomBytes } from 'crypto'
import type { FastifyInstance } from 'fastify'
import { ConnectorError } from '../connectors/base.js'
import { SalesloftErrorCode } from '../connectors/salesloft/salesloft.errors.js'
import type { SalesloftTokenResponse } from '../connectors/salesloft/salesloft.types.js'
import { storeOAuthTokens } from '../repositories/connector-config.repository.js'

const SL_AUTHORIZE_URL = 'https://accounts.salesloft.com/oauth/authorize'
const SL_TOKEN_URL     = 'https://accounts.salesloft.com/oauth/token'

// Salesloft OAuth scopes (verified against Salesloft API docs)
const REQUIRED_SCOPES = [
  'cadences.r',
  'cadences.w',
  'people.r',
  'people.w',
].join(' ')

export async function salesloftOAuthRoutes(app: FastifyInstance): Promise<void> {

  // ── GET /api/salesloft/oauth/start ─────────────────────────────────────────
  app.get<{ Querystring: { org_id?: string } }>(
    '/start',
    async (req, reply) => {
      const clientId    = process.env.SALESLOFT_CLIENT_ID
      const redirectUri = process.env.SALESLOFT_REDIRECT_URI

      if (!clientId || !redirectUri) {
        return reply.status(500).send({
          error: 'SALESLOFT_NOT_CONFIGURED',
          message: 'SALESLOFT_CLIENT_ID and SALESLOFT_REDIRECT_URI must be set in env vars',
        })
      }

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

      return reply.redirect(`${SL_AUTHORIZE_URL}?${params.toString()}`)
    }
  )

  // ── GET /api/salesloft/oauth/callback ──────────────────────────────────────
  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    '/callback',
    async (req, reply) => {
      const dashboardUrl = process.env.DASHBOARD_URL ?? 'https://gtm-autopilot-dashboard.vercel.app'
      const { code, state, error } = req.query

      if (error) {
        return reply.redirect(`${dashboardUrl}/settings?error=salesloft_denied`)
      }
      if (!code || !state) {
        return reply.redirect(`${dashboardUrl}/settings?error=salesloft_missing_code`)
      }

      const [orgId] = state.split(':')
      if (!orgId) {
        return reply.redirect(`${dashboardUrl}/settings?error=salesloft_invalid_state`)
      }

      const clientId     = process.env.SALESLOFT_CLIENT_ID
      const clientSecret = process.env.SALESLOFT_CLIENT_SECRET
      const redirectUri  = process.env.SALESLOFT_REDIRECT_URI

      if (!clientId || !clientSecret || !redirectUri) {
        return reply.redirect(`${dashboardUrl}/settings?error=salesloft_not_configured`)
      }

      let tokens: SalesloftTokenResponse
      try {
        const res = await fetch(SL_TOKEN_URL, {
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
            'salesloft', SalesloftErrorCode.AUTH_FAILED, res.status, raw,
            'Salesloft token exchange failed'
          )
        }
        tokens = await res.json() as SalesloftTokenResponse
      } catch (err) {
        req.log.error({ err }, '[salesloft-oauth] Token exchange failed')
        return reply.redirect(`${dashboardUrl}/settings?error=salesloft_token_exchange_failed`)
      }

      // Persist tokens to connector_config (org-scoped)
      try {
        await storeOAuthTokens(orgId, 'salesloft', {
          access_token:  tokens.access_token,
          refresh_token: tokens.refresh_token,
          expires_at:    Date.now() + (tokens.expires_in ?? 7200) * 1000,
          scope:         tokens.scope,
        })
      } catch (err) {
        req.log.error({ err }, '[salesloft-oauth] Failed to persist tokens to connector_config')
        return reply.redirect(`${dashboardUrl}/settings?error=salesloft_token_storage_failed`)
      }

      req.log.info({ orgId }, '[salesloft-oauth] Tokens stored successfully for org')
      return reply.redirect(`${dashboardUrl}/settings?connected=salesloft`)
    }
  )
}
