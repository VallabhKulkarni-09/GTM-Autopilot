import { getDb } from '../../../db/client.js'
import { WorkflowState } from '../state.js'
import { storeEnrichmentEvidence } from '../../../evidence/evidence-store.js'
import { ClearbitConnector } from '../../../connectors/clearbit/clearbit.connector.js'
import { writeEvent } from '../../../events/event-log.js'
import { buildDecisionSnapshot } from '../../../evidence/context-builder.js'

function getClient() {
  return getDb()
}

export async function enrich(state: WorkflowState): Promise<Partial<WorkflowState>> {
  const decisionSnapshot = await buildDecisionSnapshot(state as any)

  await writeEvent({
    organizationId: state.organizationId,
    workflowRunId: state.workflowRunId,
    playInstanceId: state.playInstanceId,
    leadId: state.leadId,
    eventType: 'enrichment_requested',
    actorType: 'system',
    decisionSnapshot,
    eventStatus: 'success'
  })

  try {
    const clearbit = new ClearbitConnector()
    await clearbit.connect({ apiKey: process.env.CLEARBIT_API_KEY ?? '' })

    // enrichByEmail returns ClearbitPerson | null (with .company: ClearbitCompany | null)
    const enrichResult = await clearbit.enrichByEmail(state.lead.email).catch(() => null)

    const db = getClient()
    let companyId: string | null = null

    if (enrichResult?.company) {
      const c = enrichResult.company
      // Upsert company by domain
      const { data: companyRow } = await db
        .from('companies')
        .upsert({
          organization_id: state.organizationId,
          name: c.name ?? null,
          domain: c.domain ?? null,
          industry: c.category?.industry ?? null,
          employee_count: c.metrics?.employees ?? null,
          employee_range: c.metrics?.employeesRange ?? null,
          annual_revenue: c.metrics?.annualRevenue ?? null,
          country: c.geo?.country ?? null,
          state: c.geo?.stateCode ?? null,
          city: c.geo?.city ?? null,
        }, { onConflict: 'organization_id,domain', ignoreDuplicates: false })
        .select('id')
        .single()
      companyId = (companyRow as any)?.id ?? null

      // Update lead with company_id
      if (companyId) {
        await db
          .from('leads')
          .update({ company_id: companyId })
          .eq('id', state.leadId)
          .eq('organization_id', state.organizationId)
      }
    }

    // Store structured evidence rows using the evidence-store
    const evidence = await storeEnrichmentEvidence(
      state.organizationId,
      state.leadId,
      companyId,
      enrichResult ?? null,
      enrichResult?.company ?? null
    )

    // Build a Company-shaped object for state from Clearbit data
    let company = enrichResult?.company
      ? {
          id: companyId ?? '',
          organization_id: state.organizationId,
          name: enrichResult.company.name ?? null,
          domain: enrichResult.company.domain ?? null,
          industry: enrichResult.company.category?.industry ?? null,
          sub_industry: enrichResult.company.category?.subIndustry ?? null,
          employee_count: enrichResult.company.metrics?.employees ?? null,
          employee_range: enrichResult.company.metrics?.employeesRange ?? null,
          annual_revenue: enrichResult.company.metrics?.annualRevenue ?? null,
          country: enrichResult.company.geo?.country ?? null,
          state: enrichResult.company.geo?.stateCode ?? null,
          city: enrichResult.company.geo?.city ?? null,
          founded_year: enrichResult.company.foundedYear ?? null,
          tech_stack: enrichResult.company.tech ?? null,
          funding_stage: null,
          raw_clearbit: enrichResult.company as unknown as Record<string, unknown>,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }
      : null

    // If Clearbit didn't return a company, look up existing company by domain in DB
    if (!company) {
      const emailDomain = state.lead.email?.split('@')[1]
      if (emailDomain) {
        const { data: existingComp } = await db
          .from('companies')
          .select('*')
          .eq('organization_id', state.organizationId)
          .eq('domain', emailDomain)
          .limit(1)
          .single()
        if (existingComp) {
          company = existingComp as any
        }
      }
    }

    await writeEvent({
      organizationId: state.organizationId,
      workflowRunId: state.workflowRunId,
      playInstanceId: state.playInstanceId,
      leadId: state.leadId,
      eventType: 'enrichment_succeeded',
      actorType: 'system',
      decisionSnapshot,
      eventStatus: 'success'
    })

    return { evidence: evidence as any[], company: company as any, currentStep: 'enrich' }
  } catch (e) {
    await writeEvent({
      organizationId: state.organizationId,
      workflowRunId: state.workflowRunId,
      playInstanceId: state.playInstanceId,
      leadId: state.leadId,
      eventType: 'enrichment_skipped',
      actorType: 'system',
      decisionSnapshot,
      eventStatus: 'skipped'
    })
    return { currentStep: 'enrich' }
  }
}
