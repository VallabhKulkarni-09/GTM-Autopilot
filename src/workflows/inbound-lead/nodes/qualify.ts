import { WorkflowState } from '../state.js'
import { executeAction } from '../../../actions/executor.js'
import { writeEvent } from '../../../events/event-log.js'
import { buildDecisionSnapshot } from '../../../evidence/context-builder.js'
import { QualificationAgent } from '../../../agents/qualification/index.js'

export async function qualify(state: WorkflowState): Promise<Partial<WorkflowState>> {
  const decisionSnapshot = await buildDecisionSnapshot(state as any)
  
  try {
    const agent = new QualificationAgent()
    const qualificationResult = await (agent.execute as any)({
      lead: state.lead,
      company: state.company,
      enrichmentEvidence: state.evidence,
      icpPolicyRules: []
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
    
    await (executeAction as any)({ type: 'qualify_lead' })
    
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
