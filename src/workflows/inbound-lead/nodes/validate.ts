import { WorkflowState } from '../state.js'
import { leadRepo } from '../../../repositories/lead.repo.js'
import { writeEvent } from '../../../events/event-log.js'
import { buildDecisionSnapshot } from '../../../evidence/context-builder.js'

export async function validate(state: WorkflowState): Promise<Partial<WorkflowState>> {
  const isDup = await leadRepo.isDuplicate(state.organizationId, state.lead.email)
  const decisionSnapshot = await buildDecisionSnapshot(state as any)
  
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
