import { createClient } from '@supabase/supabase-js'
import type { DecisionSnapshot, Lead, Company, PolicyRule } from '../domain/db-types.js'

function getClient() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY must be set')
  return createClient(url, key)
}

export async function buildDecisionSnapshot(
  params: {
    organizationId: string
    leadId: string
    workflowRunId: string
    agentName: string
    agentVersion: string
    promptVersion?: string | null
    modelName?: string | null
  }
): Promise<DecisionSnapshot> {
  const {
    organizationId,
    leadId,
    agentName,
    agentVersion,
    promptVersion = null,
    modelName = null
  } = params

  const supabase = getClient()

  // Fetch lead
  const { data: lead, error: leadError } = await supabase
    .from('leads')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('id', leadId)
    .single()

  if (leadError || !lead) {
    throw new Error(`Lead not found: ${leadId}`)
  }

  // Fetch company
  let company: Company | null = null
  if (lead.company_id) {
    const { data: companyData } = await supabase
      .from('companies')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('id', lead.company_id)
      .single()
    company = (companyData as Company) ?? null
  }

  // Fetch policies
  const { data: policiesData } = await supabase
    .from('policy_rules')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('is_active', true)

  const policies = (policiesData ?? []) as PolicyRule[]

  // Fetch ownerWorkloads
  const { data: workloadsData } = await supabase
    .from('play_instance')
    .select('assigned_owner_id')
    .eq('organization_id', organizationId)
    .eq('status', 'running')

  const ownerWorkloads: Record<string, number> = {}
  if (workloadsData) {
    for (const row of workloadsData) {
      if (row.assigned_owner_id) {
        ownerWorkloads[row.assigned_owner_id] = (ownerWorkloads[row.assigned_owner_id] || 0) + 1
      }
    }
  }

  // Fetch evidenceIds
  const now = new Date().toISOString()
  const { data: evidenceData } = await supabase
    .from('evidence')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('lead_id', leadId)
    .or(`expires_at.is.null,expires_at.gt.${now}`)

  const evidenceIds = (evidenceData ?? []).map(row => row.id)

  return {
    lead: lead as Lead,
    company,
    policies,
    ownerWorkloads,
    evidenceIds,
    agentName,
    agentVersion,
    promptVersion,
    modelName
  }
}
