/**
 * apollo.connector.ts
 * Apollo.io enrichment connector implementing Connector<ApolloConfig>.
 *
 * Auth: API key in x-api-key header (NOT Bearer). Single key per org, stored in
 *       connector_config.credentials_vault_key, scoped to organizationId.
 *
 * Endpoint: POST https://api.apollo.io/api/v1/people/match
 *
 * THREE-WAY OUTCOME DISTINCTION (non-negotiable — mirrors the fix in enrich.ts):
 *   1. Network / API error        → throw ConnectorError (AP_ENRICH_FAILED)
 *   2. HTTP 200 but match_confidence === 'none' → return null (caller logs enrichment_skipped)
 *   3. HTTP 200 with real data    → return ApolloPersonMatch
 *
 * The 'none' case is NOT an error. Apollo returns HTTP 200 with a sparse person object
 * when it cannot find a match. If the caller conflates this with an error, or silently
 * returns [] when match_confidence='none', it reproduces the exact Clearbit silent-null
 * bug fixed in evidence-store.ts this session. Do not add .catch(() => null) here.
 *
 * Part B (Sequences) is NOT implemented here. Apollo's Sequences API could replace or
 * supplement Outreach/Salesloft, but that's a product decision outside this PR.
 * See PROGRESS.md for the follow-up note.
 *
 * Confidence score: APOLLO_ENRICHMENT_CONFIDENCE = 0.85 (static, not dynamic).
 * Named and exported so callers can reference the constant explicitly.
 * See PROGRESS.md for the honest statement about this being static, not field-level scoring.
 */

import { Connector, ConnectorError, ConnectorHealth, withRetry } from '../base.js'
import { ApolloErrorCode } from './apollo.errors.js'
import type {
  ApolloConfig,
  ApolloEnrichOptions,
  ApolloPersonMatch,
  ApolloPeopleMatchResponse,
  ApolloRawPerson,
} from './apollo.types.js'

const APOLLO_BASE = 'https://api.apollo.io/api/v1'

/**
 * Static confidence score for Apollo enrichment results.
 *
 * This is NOT dynamic / field-level scoring.
 * It is a named static constant: 0.85.
 * Rationale for 0.85 (not 1.0):
 *   - Apollo has high coverage (240M+ contacts) but data freshness varies
 *   - match_confidence 'medium' / 'low' results may be stale or approximate
 *   - We do not yet vary this per-result based on match_confidence
 *   - Stated plainly: if both Apollo and ZoomInfo have data, Apollo "wins"
 *     because 0.85 > 0.9 is wrong — the value must be set relative to ZoomInfo's
 *     when that is wired. For now this is a placeholder that will need tuning
 *     once both sources are live simultaneously.
 *
 * See PROGRESS.md: "Apollo confidence score: 0.85 — static, not dynamic"
 */
export const APOLLO_ENRICHMENT_CONFIDENCE = 0.85

// ── Connector ─────────────────────────────────────────────────────────────────

export class ApolloConnector implements Connector<ApolloConfig> {
  readonly name    = 'apollo' as const
  readonly version = '1.0.0'

  private config: ApolloConfig | null = null

  async connect(config: ApolloConfig): Promise<void> {
    this.config = { ...config }
  }

  async disconnect(): Promise<void> {
    this.config = null
  }

  async healthCheck(): Promise<ConnectorHealth> {
    const start = Date.now()
    try {
      // Lightweight health check: send a known-bad email that will never match.
      // A 200 response (even with match_confidence='none') proves the key is valid.
      // A 401 means the key is wrong. A 429 means we're rate-limited (still "healthy" key).
      const res = await this.rawMatch({ email: 'healthcheck-probe@apollo-connector-test.invalid' }, {})
      // If we got here without throwing, the key works
      const ok = res !== null || true   // null = no match, still means auth succeeded
      return { ok: true, latencyMs: Date.now() - start, lastChecked: new Date() }
    } catch (err: any) {
      return {
        ok:         false,
        latencyMs:  Date.now() - start,
        lastChecked: new Date(),
        error:      err?.message ?? String(err),
      }
    }
  }

  // ── Public Methods ──────────────────────────────────────────────────────────

  /**
   * Enriches a person by email.
   *
   * THREE-WAY OUTCOME (not two-way):
   *   → throws ConnectorError     : API/network error (auth failure, 5xx, timeout)
   *   → returns null              : HTTP 200 but match_confidence === 'none' (no Apollo record)
   *   → returns ApolloPersonMatch : HTTP 200 with a real match (confidence high/medium/low)
   *
   * NEVER conflate the null return with an error. The caller must:
   *   - On throw  → log enrichment_failed, capture error in snapshot
   *   - On null   → log enrichment_skipped with reason 'no_match'
   *   - On match  → store evidence, log enrichment_succeeded
   *
   * match_confidence='low' is still a match — Apollo returned data, just with lower certainty.
   * We store it and let the qualification agent use or discount it based on the score.
   */
  async enrichByEmail(
    email: string,
    options: ApolloEnrichOptions = {}
  ): Promise<ApolloPersonMatch | null> {
    return withRetry(this.name, ApolloErrorCode.ENRICH_FAILED, async () => {
      const raw = await this.rawMatch({ email }, options)
      if (!raw) return null   // match_confidence === 'none'
      return this.mapToPersonMatch(raw)
    })
  }

  // ── Private Helpers ─────────────────────────────────────────────────────────

  /**
   * Makes the raw POST /people/match call.
   * Returns:
   *   - null    : HTTP 200 but match_confidence === 'none' (no Apollo record)
   *   - raw     : HTTP 200 with a real person object
   * Throws ConnectorError on any non-200, network failure, or missing person in response.
   *
   * Note: POST body params, not query params. Apollo accepts both but body is more reliable
   * for large payloads and avoids URL encoding issues with emails.
   */
  private async rawMatch(
    params: { email?: string; first_name?: string; last_name?: string; domain?: string },
    options: ApolloEnrichOptions
  ): Promise<ApolloRawPerson | null> {
    this.assertConnected()

    const body: Record<string, unknown> = { ...params }
    if (options.revealPersonalEmails) body.reveal_personal_emails = true
    if (options.revealPhoneNumber)    body.reveal_phone_number    = true
    if (options.runWaterfallEmail)    body.run_waterfall_email    = true

    let res: Response
    try {
      res = await fetch(`${APOLLO_BASE}/people/match`, {
        method:  'POST',
        headers: {
          'x-api-key':    this.config!.apiKey,
          'Content-Type': 'application/json',
          'Accept':       'application/json',
        },
        body:   JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      })
    } catch (err: any) {
      // Network-level failure (ECONNREFUSED, AbortError, etc.) — wrap as ConnectorError
      throw new ConnectorError(
        this.name, ApolloErrorCode.NETWORK_ERROR, 0, String(err),
        `Apollo people/match network error: ${err?.message ?? String(err)}`
      )
    }

    // Auth errors — do not retry
    if (res.status === 401 || res.status === 403) {
      const raw = await res.text()
      throw new ConnectorError(
        this.name, ApolloErrorCode.AUTH_FAILED, res.status, raw,
        `Apollo API authentication failed (status ${res.status}). Check APOLLO_API_KEY.`
      )
    }

    if (!res.ok) {
      const raw = await res.text()
      throw new ConnectorError(
        this.name, ApolloErrorCode.ENRICH_FAILED, res.status, raw,
        `Apollo people/match failed with status ${res.status}`
      )
    }

    const data = await res.json() as ApolloPeopleMatchResponse

    // Apollo returns HTTP 200 even when there's no match.
    // The signal is match_confidence === 'none'.
    // A missing person object or match_confidence='none' both mean: no record found.
    if (!data.person || data.person.match_confidence === 'none') {
      return null
    }

    return data.person
  }

  /**
   * Maps the raw Apollo person response to ApolloPersonMatch.
   * Only maps fields we actually read from the real response — no assumed fields.
   * The full _raw object is preserved so evidence rows have the complete payload.
   */
  private mapToPersonMatch(raw: ApolloRawPerson): ApolloPersonMatch {
    const org = raw.organization ?? null

    return {
      apolloId:    raw.id,
      email:       raw.email        ?? null,
      firstName:   raw.first_name   ?? null,
      lastName:    raw.last_name    ?? null,
      fullName:    raw.name         ?? null,
      title:       raw.title        ?? null,
      linkedinUrl: raw.linkedin_url ?? null,
      location: {
        city:    raw.city    ?? null,
        state:   raw.state   ?? null,
        country: raw.country ?? null,
      },
      matchConfidence: raw.match_confidence,
      company: org ? {
        apolloOrgId:   org.id             ?? null,
        name:          org.name           ?? null,
        domain:        org.primary_domain ?? null,
        industry:      org.industry       ?? null,
        employeeCount: org.estimated_num_employees ?? null,
        annualRevenue: org.annual_revenue          ?? null,
        fundingStage:  org.latest_funding_stage    ?? null,
        country:       org.country                 ?? null,
      } : null,
      _raw: raw,
    }
  }

  private headers(): Record<string, string> {
    return {
      'x-api-key':    this.config!.apiKey,
      'Content-Type': 'application/json',
      'Accept':       'application/json',
    }
  }

  private assertConnected(): void {
    if (!this.config) {
      throw new ConnectorError(
        this.name, ApolloErrorCode.NOT_CONNECTED, 401, null,
        'ApolloConnector: call connect() before any API operation'
      )
    }
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Creates and connects an ApolloConnector from environment variables.
 * Returns null when APOLLO_API_KEY is not set, so callers can skip Apollo gracefully.
 *
 * NEVER throw when the key is missing — missing key = connector not configured,
 * not an error. The enrichment node checks for null and skips Apollo if absent.
 */
export function createApolloConnector(): ApolloConnector | null {
  const apiKey = process.env.APOLLO_API_KEY
  if (!apiKey) return null

  const connector = new ApolloConnector()
  connector.connect({ apiKey })
  return connector
}
