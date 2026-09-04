/**
 * tenant-context.ts
 * Fastify preHandler hook — runs on every route.
 *
 * Rules:
 * 1. Extract Bearer token from Authorization header
 * 2. Verify JWT using JWT_SECRET
 * 3. Extract organizationId from verified payload
 * 4. Attach to request.tenantContext = { organizationId }
 * 5. Reject with 401 if token missing, invalid, or organizationId absent
 *
 * NEVER read organizationId from request.body, request.query, or request.params.
 */

import type { FastifyRequest, FastifyReply } from 'fastify'
import { createHmac, timingSafeEqual } from 'crypto'
import './types.js'  // import for side-effect: augments FastifyRequest

// ─── Minimal JWT verification (no external dependencies) ─────────────────────
// Uses HS256 (HMAC-SHA256) — the only algorithm accepted in GTM Autopilot.

type JwtPayload = {
  organization_id?: string
  organizationId?: string
  sub?: string
  exp?: number
  iat?: number
  [key: string]: unknown
}

function verifyJwt(token: string, secret: string): JwtPayload {
  const parts = token.split('.')
  if (parts.length !== 3) throw new Error('Invalid JWT structure')

  const [header64, payload64, signature64] = parts

  // Verify signature
  const signingInput = `${header64}.${payload64}`
  const expected = createHmac('sha256', secret)
    .update(signingInput)
    .digest('base64url')

  const sigBuf = Buffer.from(signature64, 'base64url')
  const expBuf = Buffer.from(expected, 'base64url')

  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    throw new Error('JWT signature verification failed')
  }

  // Decode payload
  const payloadJson = Buffer.from(payload64, 'base64url').toString('utf8')
  const payload = JSON.parse(payloadJson) as JwtPayload

  // Check expiry
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('JWT has expired')
  }

  return payload
}

// ─── Middleware ───────────────────────────────────────────────────────────────

export async function tenantContextMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const authHeader = request.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return reply.status(401).send({ error: 'MISSING_TOKEN', message: 'Authorization header with Bearer token is required', requestId: request.id })
  }

  const token = authHeader.slice(7)
  const secret = process.env.JWT_SECRET
  if (!secret) {
    request.log.error('JWT_SECRET is not set — cannot verify tenant tokens')
    return reply.status(401).send({ error: 'AUTH_NOT_CONFIGURED', message: 'Authentication is not configured', requestId: request.id })
  }

  let payload: JwtPayload
  try {
    payload = verifyJwt(token, secret)
  } catch {
    return reply.status(401).send({ error: 'INVALID_TOKEN', message: 'Token is invalid or expired', requestId: request.id })
  }

  // Support both naming conventions for the claim
  const organizationId = (payload.organization_id ?? payload.organizationId) as string | undefined
  if (!organizationId || typeof organizationId !== 'string') {
    return reply.status(401).send({ error: 'MISSING_ORG_ID', message: 'Token does not contain a valid organization_id claim', requestId: request.id })
  }

  request.tenantContext = { organizationId }
}
