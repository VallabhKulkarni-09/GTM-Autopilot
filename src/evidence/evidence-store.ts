import { createClient } from '@supabase/supabase-js'
import type { Evidence, InsertEvidence } from '../domain/db-types.js'
import type { ClearbitPerson, ClearbitCompany } from '../connectors/clearbit/clearbit.types.js'

function getClient() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY must be set')
  return createClient(url, key)
}

export async function storeEnrichmentEvidence(
  organizationId: string,
  leadId: string,
  companyId: string | null,
  clearbitPerson: ClearbitPerson | null,
  clearbitCompany: ClearbitCompany | null
): Promise<Evidence[]> {
  if (!clearbitPerson && !clearbitCompany) {
    return []
  }

  const now = new Date()
  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)

  const rows: InsertEvidence[] = []

  if (clearbitPerson) {
    const personFacts = [
      { type: 'employment_title', value: clearbitPerson.employment?.title },
      { type: 'employment_seniority', value: clearbitPerson.employment?.seniority },
      { type: 'employment_role', value: clearbitPerson.employment?.role },
      { type: 'person_location', value: clearbitPerson.location },
    ]

    for (const fact of personFacts) {
      if (fact.value !== undefined && fact.value !== null) {
        rows.push({
          organization_id: organizationId,
          lead_id: leadId,
          company_id: companyId,
          source_type: 'clearbit_person',
          source_id: clearbitPerson.id,
          data: { fact_type: fact.type, fact_value: fact.value, confidence: 0.9 },
          is_current: true,
          collected_at: now.toISOString(),
          expires_at: expiresAt.toISOString(),
        })
      }
    }
  }

  if (clearbitCompany) {
    const companyFacts = [
      { type: 'company_employee_count', value: clearbitCompany.metrics?.employees },
      { type: 'company_industry', value: clearbitCompany.category?.industry },
      { type: 'company_annual_revenue', value: clearbitCompany.metrics?.estimatedAnnualRevenue ?? clearbitCompany.metrics?.annualRevenue },
      { type: 'company_country', value: clearbitCompany.geo?.country },
      { type: 'company_type', value: clearbitCompany.type },
      { type: 'company_tags', value: clearbitCompany.tags },
    ]

    for (const fact of companyFacts) {
      if (fact.value !== undefined && fact.value !== null) {
        rows.push({
          organization_id: organizationId,
          lead_id: leadId,
          company_id: companyId,
          source_type: 'clearbit_company',
          source_id: clearbitCompany.id,
          data: { fact_type: fact.type, fact_value: fact.value, confidence: 0.9 },
          is_current: true,
          collected_at: now.toISOString(),
          expires_at: expiresAt.toISOString(),
        })
      }
    }
  }

  if (rows.length === 0) {
    return []
  }

  const supabase = getClient()
  const { data, error } = await supabase
    .from('evidence')
    .insert(rows)
    .select()

  if (error) {
    throw new Error(`Failed to insert evidence: ${error.message}`)
  }

  return (data ?? []) as Evidence[]
}

export async function getLeadEvidence(
  organizationId: string,
  leadId: string
): Promise<Evidence[]> {
  const supabase = getClient()
  const now = new Date().toISOString()

  const { data, error } = await supabase
    .from('evidence')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('lead_id', leadId)
    .or(`expires_at.is.null,expires_at.gt.${now}`)
    .order('collected_at', { ascending: false })

  if (error) {
    throw new Error(`Failed to get lead evidence: ${error.message}`)
  }

  return (data ?? []) as Evidence[]
}
