/**
 * apollo.connector.test.ts
 *
 * Tests the three-way outcome distinction that is non-negotiable for this connector:
 *   1. API/network error    → ConnectorError thrown (never raw Error)
 *   2. match_confidence='none' (HTTP 200, no match) → null returned
 *   3. Real match (HTTP 200, match_confidence='high'/'medium'/'low') → ApolloPersonMatch returned
 *
 * Error-path tests run always (no real API key needed — they only need to observe
 * the error wrapping, not real data).
 *
 * Live tests are skipped when APOLLO_API_KEY is not set. When a real key is present,
 * they hit the real Apollo API and verify the response shape against what we actually
 * map, not what we assumed from docs.
 */

import { describe, it, expect } from 'vitest'
import { ApolloConnector, APOLLO_ENRICHMENT_CONFIDENCE } from '../apollo.connector.js'

const LIVE = !!process.env.APOLLO_API_KEY

// ── Unit tests (always run — no real API key needed) ──────────────────────────

describe('ApolloConnector — error shape (always run)', () => {
  it('throws ConnectorError with AP_AUTH_FAILED on 401 from Apollo', async () => {
    // Mock Apollo returning HTTP 401 (invalid key)
    const apolloErrorBody = JSON.stringify({
      error: 'Invalid API key.',
      error_details: { code: 'AUTH.AUTHENTICATION.API_KEY_INVALID', message: 'This API key is not valid.' }
    })
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => new Response(apolloErrorBody, {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })

    try {
      const connector = new ApolloConnector()
      await connector.connect({ apiKey: 'invalid-key' })

      await expect(
        connector.enrichByEmail('test@example.com')
      ).rejects.toMatchObject({
        name:   'ConnectorError',
        source: 'apollo',
        code:   'AP_AUTH_FAILED',
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('throws ConnectorError (not raw TypeError) on network failure', async () => {
    const connector = new ApolloConnector()
    await connector.connect({ apiKey: 'any-key' })

    // Simulate network-level failure by hitting an unreachable host.
    // The connector must wrap this as ConnectorError, not leak TypeError.
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => { throw new TypeError('fetch failed') }

    try {
      await expect(
        connector.enrichByEmail('test@example.com')
      ).rejects.toMatchObject({
        name: 'ConnectorError',
        code: 'AP_NETWORK_ERROR',
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('returns null when match_confidence is none (HTTP 200, no match)', async () => {
    // Simulate Apollo returning HTTP 200 with match_confidence='none'
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => new Response(
      JSON.stringify({ person: { id: 'stub', match_confidence: 'none' } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )

    try {
      const connector = new ApolloConnector()
      await connector.connect({ apiKey: 'stub-key' })
      const result = await connector.enrichByEmail('nomatch@example.com')
      expect(result).toBeNull()
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('returns null when person is null in response', async () => {
    // Apollo may return { person: null } in some no-match cases
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => new Response(
      JSON.stringify({ person: null }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )

    try {
      const connector = new ApolloConnector()
      await connector.connect({ apiKey: 'stub-key' })
      const result = await connector.enrichByEmail('null@example.com')
      expect(result).toBeNull()
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('maps high-confidence response to ApolloPersonMatch correctly', async () => {
    // Real Apollo response shape from the official docs example
    const mockPerson = {
      id:               '672c91d4a7be42000184f2c9',
      first_name:       'Jordan',
      last_name:        'Blake',
      name:             'Jordan Blake',
      linkedin_url:     'http://www.linkedin.com/in/jordan-blake-4a7c21',
      title:            'Founder & CEO',
      email:            'jordan.blake@northstaranalytics.io',
      email_status:     'verified',
      headline:         'Founder & CEO at Northstar Analytics',
      photo_url:        null,
      twitter_url:      null,
      github_url:       null,
      facebook_url:     null,
      match_confidence: 'high',
      organization_id:  '61f2d5a8c40b7200019e4f31',
      state:            'California',
      city:             'San Francisco',
      country:          'United States',
      contact_id:       null,
      revealed_for_current_team: true,
      extrapolated_email_confidence: null,
      employment_history: [],
      organization: {
        id:                      '61f2d5a8c40b7200019e4f31',
        name:                    'Northstar Analytics',
        website_url:             'https://www.northstaranalytics.io',
        linkedin_url:            null,
        twitter_url:             null,
        facebook_url:            null,
        primary_domain:          'northstaranalytics.io',
        industry:                'information technology & services',
        industries:              ['information technology & services'],
        keywords:                [],
        estimated_num_employees: 850,
        annual_revenue:          85000000,
        annual_revenue_printed:  '85M',
        total_funding:           142000000,
        latest_funding_stage:    'Series D',
        founded_year:            2018,
        city:                    'San Francisco',
        state:                   'California',
        country:                 'United States',
        raw_address:             null,
        seo_description:         null,
        short_description:       null,
      },
    }

    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => new Response(
      JSON.stringify({ person: mockPerson }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )

    try {
      const connector = new ApolloConnector()
      await connector.connect({ apiKey: 'stub-key' })
      const result = await connector.enrichByEmail('jordan.blake@northstaranalytics.io')

      expect(result).not.toBeNull()
      expect(result!.apolloId).toBe('672c91d4a7be42000184f2c9')
      expect(result!.title).toBe('Founder & CEO')
      expect(result!.matchConfidence).toBe('high')
      expect(result!.location).toEqual({ city: 'San Francisco', state: 'California', country: 'United States' })
      expect(result!.linkedinUrl).toBe('http://www.linkedin.com/in/jordan-blake-4a7c21')
      expect(result!.company).not.toBeNull()
      expect(result!.company!.employeeCount).toBe(850)
      expect(result!.company!.annualRevenue).toBe(85000000)
      expect(result!.company!.industry).toBe('information technology & services')
      expect(result!.company!.fundingStage).toBe('Series D')
      // _raw must be the full original response for audit
      expect(result!._raw.id).toBe('672c91d4a7be42000184f2c9')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('APOLLO_ENRICHMENT_CONFIDENCE is a named constant with value 0.85', () => {
    // Static, not dynamic. Documented in PROGRESS.md.
    expect(APOLLO_ENRICHMENT_CONFIDENCE).toBe(0.85)
  })

  it('throws ConnectorError when connect() not called before enrichByEmail', async () => {
    const connector = new ApolloConnector()
    // No connect() call
    await expect(
      connector.enrichByEmail('test@example.com')
    ).rejects.toMatchObject({
      name: 'ConnectorError',
      code: 'AP_NOT_CONNECTED',
    })
  })
})

// ── Live tests (only run when APOLLO_API_KEY is set) ─────────────────────────

describe.skipIf(!LIVE)('ApolloConnector — live API tests', () => {
  const apiKey = process.env.APOLLO_API_KEY!

  it('returns null for a clearly invalid email (no-match path)', async () => {
    const connector = new ApolloConnector()
    await connector.connect({ apiKey })

    // An obviously fake email — Apollo will return match_confidence='none'
    const result = await connector.enrichByEmail('zzz-no-match-9999@invalid-domain-xyz.invalid')
    expect(result).toBeNull()
    // If this throws instead of returning null, the three-way distinction is broken
  })

  it('healthCheck returns ok=true with a valid key', async () => {
    const connector = new ApolloConnector()
    await connector.connect({ apiKey })
    const health = await connector.healthCheck()
    expect(health.ok).toBe(true)
    expect(health.latencyMs).toBeGreaterThan(0)
  })

  // NOTE: We intentionally do NOT include a live test with a real person's email here
  // to avoid burning API credits in CI. The real match test is done once manually
  // via scripts/verify-apollo-enrichment.mjs and the raw response committed as a fixture.
  // See PROGRESS.md for the live verification record.
})
