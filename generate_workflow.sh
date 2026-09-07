#!/bin/bash
mkdir -p src/workflows/inbound-lead/nodes
mkdir -p src/workflows/__tests__
mkdir -p src/agents/qualification src/agents/routing src/policies

cat << 'FILE' > src/workflows/inbound-lead/state.ts
import { Lead, Company, Evidence } from '../../domain/db-types.js'
import { ProposedAction } from '../../agents/types.js'

export type WorkflowState = {
  organizationId: string
  workflowRunId: string
  leadId: string
  playInstanceId: string
  lead: Lead
  company: Company | null
  evidence: Evidence[]
  qualificationResult: ProposedAction | null
  routingResult: ProposedAction | null
  currentStep: string
  error: string | null
}
FILE

cat << 'FILE' > src/workflows/inbound-lead/nodes/validate.ts
import { WorkflowState } from '../state.js'
import { leadRepo } from '../../../repositories/lead.repo.js'
import { writeEvent } from '../../../events/event-log.js'
import { buildDecisionSnapshot } from '../../../evidence/context-builder.js'

export async function validate(state: typeof WorkflowState): Promise<Partial<typeof WorkflowState>> {
  const isDup = await leadRepo.isDuplicate(state.organizationId, state.lead.email)
  const decisionSnapshot = await buildDecisionSnapshot(state)
  
  if (isDup) {
    const updatedLead = { ...state.lead, is_duplicate: true } as any
    await writeEvent({
      organizationId: state.organizationId,
      workflowRunId: state.workflowRunId,
      playInstanceId: state.playInstanceId,
      leadId: state.leadId,
      eventType: 'dedup_rejected',
      actorType: 'system',
      decisionSnapshot,
      eventStatus: 'success'
    })
    return { currentStep: 'validate', lead: updatedLead }
  }
  
  await writeEvent({
    organizationId: state.organizationId,
    workflowRunId: state.workflowRunId,
    playInstanceId: state.playInstanceId,
    leadId: state.leadId,
    eventType: 'dedup_passed',
    actorType: 'system',
    decisionSnapshot,
    eventStatus: 'success'
  })
  
  return { currentStep: 'validate', lead: state.lead }
}
FILE

cat << 'FILE' > src/workflows/inbound-lead/nodes/enrich.ts
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
FILE

cat << 'FILE' > src/workflows/inbound-lead/nodes/qualify.ts
import { WorkflowState } from '../state.js'
import { executeAction } from '../../../actions/executor.js'
import { writeEvent } from '../../../events/event-log.js'
import { buildDecisionSnapshot } from '../../../evidence/context-builder.js'
import { QualificationAgent } from '../../../agents/qualification/index.js'

export async function qualify(state: typeof WorkflowState): Promise<Partial<typeof WorkflowState>> {
  const decisionSnapshot = await buildDecisionSnapshot(state)
  
  try {
    const agent = new QualificationAgent()
    const qualificationResult = await agent.execute({
      lead: state.lead,
      company: state.company,
      evidence: state.evidence,
      policies: []
    }, {
      organizationId: state.organizationId,
      workflowRunId: state.workflowRunId,
      evidence: state.evidence,
      policies: []
    })
    
    await writeEvent({
      organizationId: state.organizationId,
      workflowRunId: state.workflowRunId,
      playInstanceId: state.playInstanceId,
      leadId: state.leadId,
      eventType: 'action_proposed',
      actorType: 'agent',
      actorId: agent.name,
      agentVersion: agent.version,
      proposedAction: qualificationResult as any,
      decisionSnapshot,
      eventStatus: 'success'
    })
    
    await executeAction({ type: 'qualify_lead' })
    
    return { qualificationResult, currentStep: 'qualify' }
  } catch (e: any) {
    await writeEvent({
      organizationId: state.organizationId,
      workflowRunId: state.workflowRunId,
      playInstanceId: state.playInstanceId,
      leadId: state.leadId,
      eventType: 'action_execution_failed',
      actorType: 'system',
      decisionSnapshot,
      eventStatus: 'failed',
      errorMessage: e.message
    })
    throw e
  }
}
FILE

cat << 'FILE' > src/workflows/inbound-lead/nodes/route.ts
import { WorkflowState } from '../state.js'
import { executeAction } from '../../../actions/executor.js'
import { validateAction } from '../../../actions/validator.js'
import { writeEvent } from '../../../events/event-log.js'
import { buildDecisionSnapshot } from '../../../evidence/context-builder.js'
import { RoutingAgent } from '../../../agents/routing/index.js'

export async function route(state: typeof WorkflowState): Promise<Partial<typeof WorkflowState>> {
  const decisionSnapshot = await buildDecisionSnapshot(state)
  
  try {
    const agent = new RoutingAgent()
    const routingResult = await agent.execute({
      lead: state.lead,
      qualificationResult: state.qualificationResult,
      availableOwners: [],
      ownerWorkloads: {},
      territoryRules: [],
      routingState: {} as any
    }, {
      organizationId: state.organizationId,
      workflowRunId: state.workflowRunId,
      evidence: state.evidence,
      policies: []
    })
    
    await writeEvent({
      organizationId: state.organizationId,
      workflowRunId: state.workflowRunId,
      playInstanceId: state.playInstanceId,
      leadId: state.leadId,
      eventType: 'action_proposed',
      actorType: 'agent',
      actorId: agent.name,
      agentVersion: agent.version,
      proposedAction: routingResult as any,
      decisionSnapshot,
      eventStatus: 'success'
    })
    
    const { approved, requiresHumanApproval } = await validateAction(routingResult)
    
    if (requiresHumanApproval) {
      await executeAction({ type: 'request_human_review' })
      return { routingResult: { ...routingResult, type: 'request_human_review' }, currentStep: 'route' }
    }
    
    if (approved) {
      await executeAction({ type: 'assign_owner' })
    }
    
    return { routingResult, currentStep: 'route' }
  } catch (e: any) {
    await writeEvent({
      organizationId: state.organizationId,
      workflowRunId: state.workflowRunId,
      playInstanceId: state.playInstanceId,
      leadId: state.leadId,
      eventType: 'action_execution_failed',
      actorType: 'system',
      decisionSnapshot,
      eventStatus: 'failed',
      errorMessage: e.message
    })
    throw e
  }
}
FILE

cat << 'FILE' > src/workflows/inbound-lead/nodes/first-touch.ts
import { WorkflowState } from '../state.js'
import { executeAction } from '../../../actions/executor.js'
import { writeEvent } from '../../../events/event-log.js'
import { buildDecisionSnapshot } from '../../../evidence/context-builder.js'

export async function firstTouch(state: typeof WorkflowState): Promise<Partial<typeof WorkflowState>> {
  const decisionSnapshot = await buildDecisionSnapshot(state)
  try {
    await executeAction({ type: 'start_sequence' })
    return { currentStep: 'first_touch' }
  } catch (e: any) {
    await writeEvent({
      organizationId: state.organizationId,
      workflowRunId: state.workflowRunId,
      playInstanceId: state.playInstanceId,
      leadId: state.leadId,
      eventType: 'action_execution_failed',
      actorType: 'system',
      decisionSnapshot,
      eventStatus: 'failed',
      errorMessage: e.message
    })
    throw e
  }
}
FILE

cat << 'FILE' > src/workflows/inbound-lead/nodes/mark-duplicate.ts
import { WorkflowState } from '../state.js'
import { executeAction } from '../../../actions/executor.js'
import { writeEvent } from '../../../events/event-log.js'
import { buildDecisionSnapshot } from '../../../evidence/context-builder.js'

export async function markDuplicate(state: typeof WorkflowState): Promise<Partial<typeof WorkflowState>> {
  const decisionSnapshot = await buildDecisionSnapshot(state)
  try {
    await executeAction({ type: 'mark_duplicate' })
    await writeEvent({
      organizationId: state.organizationId,
      workflowRunId: state.workflowRunId,
      playInstanceId: state.playInstanceId,
      leadId: state.leadId,
      eventType: 'play_marked_duplicate',
      actorType: 'system',
      decisionSnapshot,
      eventStatus: 'success'
    })
    return { currentStep: 'mark_duplicate' }
  } catch (e: any) {
    await writeEvent({
      organizationId: state.organizationId,
      workflowRunId: state.workflowRunId,
      playInstanceId: state.playInstanceId,
      leadId: state.leadId,
      eventType: 'action_execution_failed',
      actorType: 'system',
      decisionSnapshot,
      eventStatus: 'failed',
      errorMessage: e.message
    })
    throw e
  }
}
FILE

cat << 'FILE' > src/workflows/inbound-lead/nodes/mark-nurture.ts
import { WorkflowState } from '../state.js'
import { executeAction } from '../../../actions/executor.js'
import { writeEvent } from '../../../events/event-log.js'
import { buildDecisionSnapshot } from '../../../evidence/context-builder.js'

export async function markNurture(state: typeof WorkflowState): Promise<Partial<typeof WorkflowState>> {
  const decisionSnapshot = await buildDecisionSnapshot(state)
  try {
    await executeAction({ type: 'mark_nurture' })
    await writeEvent({
      organizationId: state.organizationId,
      workflowRunId: state.workflowRunId,
      playInstanceId: state.playInstanceId,
      leadId: state.leadId,
      eventType: 'play_marked_nurture',
      actorType: 'system',
      decisionSnapshot,
      eventStatus: 'success'
    })
    return { currentStep: 'mark_nurture' }
  } catch (e: any) {
    await writeEvent({
      organizationId: state.organizationId,
      workflowRunId: state.workflowRunId,
      playInstanceId: state.playInstanceId,
      leadId: state.leadId,
      eventType: 'action_execution_failed',
      actorType: 'system',
      decisionSnapshot,
      eventStatus: 'failed',
      errorMessage: e.message
    })
    throw e
  }
}
FILE

cat << 'FILE' > src/workflows/inbound-lead/nodes/complete.ts
import { WorkflowState } from '../state.js'
import { writeEvent } from '../../../events/event-log.js'
import { buildDecisionSnapshot } from '../../../evidence/context-builder.js'

export async function complete(state: typeof WorkflowState): Promise<Partial<typeof WorkflowState>> {
  const decisionSnapshot = await buildDecisionSnapshot(state)
  try {
    // Updates play_instance.status = 'running' -> assume done in event log processing
    await writeEvent({
      organizationId: state.organizationId,
      workflowRunId: state.workflowRunId,
      playInstanceId: state.playInstanceId,
      leadId: state.leadId,
      eventType: 'play_completed',
      actorType: 'system',
      decisionSnapshot,
      eventStatus: 'success'
    })
    return { currentStep: 'complete' }
  } catch (e: any) {
    await writeEvent({
      organizationId: state.organizationId,
      workflowRunId: state.workflowRunId,
      playInstanceId: state.playInstanceId,
      leadId: state.leadId,
      eventType: 'action_execution_failed',
      actorType: 'system',
      decisionSnapshot,
      eventStatus: 'failed',
      errorMessage: e.message
    })
    throw e
  }
}
FILE

