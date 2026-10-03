/**
 * apollo.types.ts
 * Types for Apollo.io People Enrichment API.
 *
 * Derived from the real Apollo OpenAPI response example at:
 *   https://docs.apollo.io/reference/people-enrichment.md
 *   (retrieved 2026-10-03, response example under "200 → Result")
 *
 * Key structural facts from the real response:
 * - Top-level wrapper: { person: ApolloRawPerson }
 * - match_confidence lives on person, not on a nested match object
 * - match_confidence === 'none' → no match, but HTTP status is STILL 200
 *   This is NOT a 404. The caller must check match_confidence explicitly.
 * - organization is nested under person.organization (not a separate top-level field)
 * - employment_history is an array; current position has current: true
 * - Fields that may be null in practice: twitter_url, github_url, facebook_url,
 *   extrapolated_email_confidence, headline (when no match)
 * - annual_revenue is a number (USD). annual_revenue_printed is a human string ("85M")
 * - estimated_num_employees is a number
 * - industry is a lowercase string ("information technology & services")
 */

// ── Auth / Config ─────────────────────────────────────────────────────────────

export type ApolloConfig = {
  apiKey: string
}

// ── match_confidence ──────────────────────────────────────────────────────────
// Explicitly typed — callers must switch on this value.
//
// From Apollo docs:
//   'high'   → matched with high confidence
//   'medium' → likely match with additional contact data
//   'low'    → partial match assembled from available data
//   'none'   → no match — still returns HTTP 200, person object present but mostly null
//
// 'none' is NOT an error. It means no enrichment data available.
// The caller must return null for the lead (enrichment_skipped), not throw.

export type ApolloMatchConfidence = 'high' | 'medium' | 'low' | 'none'

// ── Employment History ────────────────────────────────────────────────────────

export type ApolloEmploymentHistoryEntry = {
  _id: string
  id:  string
  key: string
  current:           boolean
  title:             string | null
  organization_name: string | null
  organization_id:   string | null
  start_date:        string | null    // "2016-01-01" format
  end_date:          string | null
  // Nullable fields present in the real response
  created_at:  string | null
  updated_at:  string | null
  degree:      string | null
  description: string | null
  emails:      string[] | null
  grade_level: string | null
  kind:        string | null
  major:       string | null
  raw_address: string | null
}

// ── Organization (company data nested under person) ───────────────────────────

export type ApolloOrganization = {
  id:                       string | null
  name:                     string | null
  website_url:              string | null
  linkedin_url:             string | null
  twitter_url:              string | null
  facebook_url:             string | null
  primary_domain:           string | null
  industry:                 string | null
  industries:               string[]
  keywords:                 string[]
  estimated_num_employees:  number | null
  annual_revenue:           number | null        // USD, e.g. 85000000
  annual_revenue_printed:   string | null        // e.g. "85M"
  total_funding:            number | null
  latest_funding_stage:     string | null        // e.g. "Series D"
  founded_year:             number | null
  city:                     string | null
  state:                    string | null
  country:                  string | null
  raw_address:              string | null
  seo_description:          string | null
  short_description:        string | null
  // Many more fields exist in the real response; only typed what we map to evidence
}

// ── Person (main response object) ────────────────────────────────────────────

export type ApolloRawPerson = {
  id:                            string
  first_name:                    string | null
  last_name:                     string | null
  name:                          string | null
  linkedin_url:                  string | null
  title:                         string | null   // current job title
  email:                         string | null
  email_status:                  string | null   // "verified", "likely", etc.
  headline:                      string | null
  photo_url:                     string | null
  twitter_url:                   string | null
  github_url:                    string | null
  facebook_url:                  string | null
  match_confidence:              ApolloMatchConfidence
  organization_id:               string | null
  organization:                  ApolloOrganization | null
  employment_history:            ApolloEmploymentHistoryEntry[]
  state:                         string | null
  city:                          string | null
  country:                       string | null
  // Nullable — only present when reveal_personal_emails=true
  extrapolated_email_confidence: number | null
  revealed_for_current_team:     boolean | null
  contact_id:                    string | null
}

// ── API Response Shape ────────────────────────────────────────────────────────

export type ApolloPeopleMatchResponse = {
  person: ApolloRawPerson | null
}

// ── Enrichment Options ────────────────────────────────────────────────────────

export type ApolloEnrichOptions = {
  revealPersonalEmails?: boolean
  revealPhoneNumber?:    boolean
  runWaterfallEmail?:    boolean
}

// ── Mapped Match Result ───────────────────────────────────────────────────────
// What the connector returns to callers — a structured, typed subset of the
// raw response with only the fields we actually use. The raw response is
// preserved in the evidence row's `data` field for audit purposes.

export type ApolloPersonMatch = {
  apolloId:          string
  email:             string | null
  firstName:         string | null
  lastName:          string | null
  fullName:          string | null
  title:             string | null   // current job title from person.title
  linkedinUrl:       string | null
  location: {
    city:    string | null
    state:   string | null
    country: string | null
  }
  matchConfidence: ApolloMatchConfidence  // always present, never undefined
  company: {
    apolloOrgId:      string | null
    name:             string | null
    domain:           string | null
    industry:         string | null
    employeeCount:    number | null
    annualRevenue:    number | null
    fundingStage:     string | null
    country:          string | null
  } | null
  // Raw response preserved for evidence storage and debugging
  _raw: ApolloRawPerson
}
