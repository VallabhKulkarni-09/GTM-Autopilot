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
