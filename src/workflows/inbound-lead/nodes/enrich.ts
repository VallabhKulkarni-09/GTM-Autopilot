import { WorkflowState } from '../state.js'
import { storeEnrichmentEvidence } from '../../../evidence/evidence-store.js'
import { writeEvent } from '../../../events/event-log.js'
import { buildDecisionSnapshot } from '../../../evidence/context-builder.js'

export async function enrich(state: typeof WorkflowState): Promise<Partial<typeof WorkflowState>> {
  const decisionSnapshot = await buildDecisionSnapshot(state)
  
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
    const evidence = await storeEnrichmentEvidence(state.organizationId, state.leadId, {})
    const company = { id: 'comp_1', organization_id: state.organizationId, name: 'Clearbit Enriched', domain: 'example.com' } as any
    
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
    
    return { evidence, company, currentStep: 'enrich' }
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
