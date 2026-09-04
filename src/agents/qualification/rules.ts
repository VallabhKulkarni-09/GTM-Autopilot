/**
 * rules.ts — QualificationAgent v1 ICP scoring formula.
 * ZERO LLM calls. ZERO external API calls. Pure deterministic logic.
 *
 * Score formula (additive, max 100):
 *   company_size 100–1000:      +30
 *   company_size 50–99:         +15
 *   company_size 1001+:         +20
 *   industry = SaaS/Software/Technology: +25
 *   country in ICP_REGIONS:     +20
 *   source form = demo/trial:   +15
 *   title = senior seniority:   +10
 *
 * Tier thresholds:
 *   score >= 70 → tier_1, is_icp_fit=true
 *   score 45–69 → tier_2, is_icp_fit=true
 *   score < 45  → not_icp, is_icp_fit=false
 */

import type { Lead, Company } from '../../domain/db-types.js'
import type { IcpTier, QualificationParameters } from './types.js'

const ICP_INDUSTRIES = ['saas', 'software', 'technology']
const ICP_REGIONS = ['US', 'CA', 'GB', 'DE', 'AU', 'NL']
const SENIOR_TITLE_KEYWORDS = ['vp', 'vice president', 'director', 'head', 'chief', 'cto', 'ceo', 'coo', 'cfo', 'founder']
const HIGH_INTENT_KEYWORDS = ['demo', 'trial']

function normalise(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().trim()
}

function matchesAny(haystack: string, needles: string[]): boolean {
  return needles.some(n => haystack.includes(n))
}

export function scoreIcp(lead: Lead, company: Company | null): QualificationParameters {
  let score = 0
  const reason_codes: string[] = []

  // ── Company size ────────────────────────────────────────────────────────────
  const size = company?.employee_count ?? null
  if (size !== null) {
    if (size >= 100 && size <= 1000) {
      score += 30
      reason_codes.push('ICP_COMPANY_SIZE_IN_RANGE')
    } else if (size >= 50 && size < 100) {
      score += 15
      reason_codes.push('ICP_COMPANY_SIZE_NEAR_RANGE')
    } else if (size > 1000) {
      score += 20
      reason_codes.push('ICP_COMPANY_SIZE_LARGE')
    } else {
      reason_codes.push('NOT_ICP_TOO_SMALL')
    }
  } else {
    reason_codes.push('ENRICHMENT_MISSING_COMPANY_SIZE')
  }

  // ── Industry ────────────────────────────────────────────────────────────────
  const industry = normalise(company?.industry)
  if (industry && matchesAny(industry, ICP_INDUSTRIES)) {
    score += 25
    reason_codes.push('ICP_INDUSTRY_SAAS')
  } else if (industry) {
    reason_codes.push('NOT_ICP_INDUSTRY_MISMATCH')
  } else {
    reason_codes.push('ENRICHMENT_MISSING_INDUSTRY')
  }

  // ── Region ──────────────────────────────────────────────────────────────────
  const country = (company?.country ?? (lead as any)?.country ?? '').toUpperCase().trim()
  if (country && ICP_REGIONS.includes(country)) {
    score += 20
    reason_codes.push(country === 'US' || country === 'CA' ? 'ICP_REGION_NA' : 'ICP_REGION_EMEA_APAC')
  } else if (country) {
    reason_codes.push('NOT_ICP_REGION_EXCLUDED')
  } else {
    reason_codes.push('ENRICHMENT_MISSING_REGION')
  }

  // ── High-intent form ────────────────────────────────────────────────────────
  const source = normalise(lead.source)
  if (matchesAny(source, HIGH_INTENT_KEYWORDS)) {
    score += 15
    reason_codes.push('ICP_HIGH_INTENT_FORM')
  }

  // ── Senior title ────────────────────────────────────────────────────────────
  const title = normalise(lead.title)
  if (title && matchesAny(title, SENIOR_TITLE_KEYWORDS)) {
    score += 10
    reason_codes.push('ICP_SENIOR_TITLE')
  }

  // ── Enrichment completely missing ───────────────────────────────────────────
  if (!company && !lead.title && !lead.source) {
    reason_codes.push('ENRICHMENT_MISSING_ALL_FIELDS')
  }

  // ── Tier calculation ────────────────────────────────────────────────────────
  const clampedScore = Math.min(100, Math.max(0, score))
  let icp_tier: IcpTier
  if (clampedScore >= 70) {
    icp_tier = 'tier_1'
  } else if (clampedScore >= 45) {
    icp_tier = 'tier_2'
  } else {
    icp_tier = 'not_icp'
    if (!reason_codes.some(c => c.startsWith('NOT_ICP'))) {
      reason_codes.push('NOT_ICP_SCORE_TOO_LOW')
    }
  }

  return {
    is_icp_fit: icp_tier !== 'not_icp',
    icp_score: clampedScore,
    icp_tier,
    reason_codes,
  }
}
