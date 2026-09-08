/**
 * evidence-store.ts
 * Writes enrichment results as evidence rows.
 * Returns empty array if both Clearbit inputs are null — never throws on null.
 *
 * Each fact from Clearbit becomes a separate row:
 *   source_type: 'clearbit_person' | 'clearbit_company'
 *   expires_at:  NOW() + 30 days (Clearbit data stales after ~30 days)
 *   is_current:  true on insert
 */

import { getDb } from '../db/client.js'
import type { ClearbitPerson, ClearbitCompany } from '../connectors/clearbit/clearbit.types.js'
import type { Evidence } from '../domain/db-types.js'

function getClient() {
  return getDb()
}

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

export async function storeEnrichmentEvidence(
  organizationId: string,
  leadId: string,
  companyId: string | null,
  clearbitPerson: ClearbitPerson | null,
  clearbitCompany: ClearbitCompany | null
): Promise<Evidence[]> {
  // Never throws on null input — Clearbit returns null when no data exists
  if (!clearbitPerson && !clearbitCompany) return []

  const now = new Date().toISOString()
  const expiresAt = thirtyDaysFromNow()

  const allFacts: EvidenceFact[] = [
    ...(clearbitPerson ? extractPersonFacts(clearbitPerson) : []),
    ...(clearbitCompany ? extractCompanyFacts(clearbitCompany) : []),
  ]

  if (allFacts.length === 0) return []

  const rows = allFacts.map((fact) => ({
    organization_id: organizationId,
    lead_id: leadId,
    company_id: companyId,
    source_type: fact.source_type,
    source_id: clearbitPerson?.id ?? clearbitCompany?.id ?? null,
    data: fact.data,
    is_current: true,
    collected_at: now,
    expires_at: expiresAt,
  }))

  const { data, error } = await getClient()
    .from('evidence')
    .insert(rows)
    .select()

  if (error) throw new Error(`[evidence-store] storeEnrichmentEvidence failed: ${error.message}`)
  return (data ?? []) as Evidence[]
}

export async function getLeadEvidence(
  organizationId: string,
  leadId: string
): Promise<Evidence[]> {
  const { data, error } = await getClient()
    .from('evidence')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('lead_id', leadId)
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .order('collected_at', { ascending: false })

  if (error) throw new Error(`[evidence-store] getLeadEvidence failed: ${error.message}`)
  return (data ?? []) as Evidence[]
}
