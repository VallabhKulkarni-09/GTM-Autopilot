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
