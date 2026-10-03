/**
 * evidence-store.ts
 * Writes enrichment results as evidence rows.
 *
 * Design contract:
 * - NEVER returns [] silently when inputs are null. Callers must guard before calling.
 *   If called with null inputs, this function throws so the bug is visible immediately.
 * - Throws on DB write failure — never swallows errors.
 * - Returns the rows that were actually written (not just a count).
 * - Each logical fact becomes a separate row for granular querying.
 *
 * Evidence rows:
 *   source_type: 'clearbit_person' | 'clearbit_company' (Clearbit)
 *                'zoominfo_enrichment' (ZoomInfo — future)
 *   expires_at:  NOW() + 30 days (Clearbit data stales after ~30 days)
 *   is_current:  true on insert
 *
 * Callers are responsible for distinguishing:
 *   null return from enrichment provider = no match (log enrichment_skipped)
 *   throw from enrichment provider       = API failure (log enrichment_failed)
 * This function only handles the "data exists, write it" case.
 */

import { getDb } from '../db/client.js'
import type { ClearbitPerson, ClearbitCompany } from '../connectors/clearbit/clearbit.types.js'
import type { Evidence } from '../domain/db-types.js'

function thirtyDaysFromNow(): string {
  return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
}

// ─── Fact extraction ──────────────────────────────────────────────────────────

type EvidenceFact = {
  source_type: 'clearbit_person' | 'clearbit_company'
  data: Record<string, unknown>
}

function extractPersonFacts(person: ClearbitPerson): EvidenceFact[] {
  const facts: EvidenceFact[] = []

  if (person.employment?.title) {
    facts.push({ source_type: 'clearbit_person', data: { fact_type: 'employment_title', fact_value: person.employment.title } })
  }
  if (person.employment?.seniority) {
    facts.push({ source_type: 'clearbit_person', data: { fact_type: 'employment_seniority', fact_value: person.employment.seniority } })
  }
  if (person.employment?.role) {
    facts.push({ source_type: 'clearbit_person', data: { fact_type: 'employment_role', fact_value: person.employment.role } })
  }
  if (person.location) {
    facts.push({ source_type: 'clearbit_person', data: { fact_type: 'person_location', fact_value: person.location } })
  }

  return facts
}

function extractCompanyFacts(company: ClearbitCompany): EvidenceFact[] {
  const facts: EvidenceFact[] = []

  const metrics = (company as any).metrics
  if (metrics?.employees != null) {
    facts.push({ source_type: 'clearbit_company', data: { fact_type: 'company_employee_count', fact_value: metrics.employees } })
  }
  if (company.category?.industry) {
    facts.push({ source_type: 'clearbit_company', data: { fact_type: 'company_industry', fact_value: company.category.industry } })
  }
  if (metrics?.estimatedAnnualRevenue != null) {
    facts.push({ source_type: 'clearbit_company', data: { fact_type: 'company_annual_revenue', fact_value: metrics.estimatedAnnualRevenue } })
  }
  const geo = (company as any).geo
  if (geo?.country) {
    facts.push({ source_type: 'clearbit_company', data: { fact_type: 'company_country', fact_value: geo.country } })
  }
  if ((company as any).type) {
    facts.push({ source_type: 'clearbit_company', data: { fact_type: 'company_type', fact_value: (company as any).type } })
  }
  if (company.tags?.length) {
    facts.push({ source_type: 'clearbit_company', data: { fact_type: 'company_tags', fact_value: company.tags } })
  }

  return facts
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Stores Clearbit enrichment results as evidence rows.
 *
 * REQUIRES at least one of clearbitPerson or clearbitCompany to be non-null.
 * Throws if both are null — callers must guard this condition before calling.
 * The null case has a specific meaning (no enrichment match) and must be logged
 * by the caller using enrichment_skipped, not silently ignored here.
 *
 * @param source - string label for logging, e.g. 'clearbit'
 */
export async function storeEnrichmentEvidence(
  organizationId: string,
  leadId: string,
  companyId: string | null,
  clearbitPerson: ClearbitPerson | null,
  clearbitCompany: ClearbitCompany | null,
  source: string = 'clearbit',
): Promise<Evidence[]> {
  // Guard: caller must not call this with null inputs.
  // If you're here with both null, you have a bug in the caller —
  // the null case is "no match found" and should have been handled upstream.
  if (!clearbitPerson && !clearbitCompany) {
    throw new Error(
      `[evidence-store] storeEnrichmentEvidence called with both clearbitPerson=null and clearbitCompany=null ` +
      `(source=${source}, lead=${leadId}, org=${organizationId}). ` +
      `This indicates the caller did not check the enrichment result before calling store. ` +
      `Null enrichment results (no-match) must be logged as enrichment_skipped by the caller, ` +
      `not passed through to evidence storage.`
    )
  }

  const now      = new Date().toISOString()
  const expiresAt = thirtyDaysFromNow()

  const allFacts: EvidenceFact[] = [
    ...(clearbitPerson  ? extractPersonFacts(clearbitPerson)   : []),
    ...(clearbitCompany ? extractCompanyFacts(clearbitCompany) : []),
  ]

  if (allFacts.length === 0) {
    // Data was returned but no facts could be extracted (all fields null).
    // This is a degraded-but-valid result: log and return empty, but do NOT throw.
    console.warn(
      `[evidence-store] Enrichment data received from ${source} for lead ${leadId} but ` +
      `no extractable facts found (all tracked fields are null). ` +
      `0 evidence rows written. Check whether the enrichment response has useful fields.`
    )
    return []
  }

  const rows = allFacts.map((fact) => ({
    organization_id: organizationId,
    lead_id:         leadId,
    company_id:      companyId,
    source_type:     fact.source_type,
    source_id:       clearbitPerson?.id ?? clearbitCompany?.id ?? null,
    data:            fact.data,
    is_current:      true,
    collected_at:    now,
    expires_at:      expiresAt,
  }))

  const { data, error } = await getDb()
    .from('evidence')
    .insert(rows)
    .select()

  if (error) throw new Error(`[evidence-store] storeEnrichmentEvidence DB write failed (source=${source}): ${error.message}`)

  console.info(
    `[evidence-store] Wrote ${(data ?? []).length} evidence rows for lead ${leadId} from ${source} ` +
    `(ids: ${(data ?? []).map((r: any) => r.id).join(', ')}).`
  )

  return (data ?? []) as Evidence[]
}

export async function getLeadEvidence(
  organizationId: string,
  leadId: string
): Promise<Evidence[]> {
  const { data, error } = await getDb()
    .from('evidence')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('lead_id', leadId)
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .order('collected_at', { ascending: false })

  if (error) throw new Error(`[evidence-store] getLeadEvidence failed: ${error.message}`)
  return (data ?? []) as Evidence[]
}
