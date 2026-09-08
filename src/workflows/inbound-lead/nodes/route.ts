import { randomUUID } from 'crypto'
import { WorkflowState } from '../state.js'
import { executeAction } from '../../../actions/executor.js'
import { validateAction } from '../../../actions/validator.js'
import { writeEvent } from '../../../events/event-log.js'
import { buildDecisionSnapshot } from '../../../evidence/context-builder.js'
import { RoutingAgent } from '../../../agents/routing/index.js'
import type { RoutingInput } from '../../../agents/routing/types.js'
import type { ProposedAction } from '../../../actions/types.js'

export async function route(state: WorkflowState): Promise<Partial<WorkflowState>> {
  const decisionSnapshot = await buildDecisionSnapshot(state as any)

  try {
    const routingInput: RoutingInput = {
      lead: state.lead,
      company: state.company ?? null,
      qualificationResult: state.qualificationResult as any,
      availableOwners: [], // TODO: load from SF
      ownerWorkloads: {},  // TODO: load from SF
      territoryPolicyRules: [], // TODO: load from DB
      routingState: {} as any, // TODO: load from DB
    }
    const agent = new RoutingAgent()
    const routingResult = agent.run(routingInput)

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

    const { approved, requiresHumanApproval } = await validateAction(routingResult as any, state.organizationId)

    if (requiresHumanApproval) {
      const humanReviewAction: ProposedAction = {
        actionId: randomUUID(),
        type: 'request_human_review',
        target: { leadId: state.leadId, organizationId: state.organizationId },
        rationale: {
          reasonCodes: (routingResult.parameters?.reason_codes as string[]) ?? [],
          evidenceIds: [],
        },
        decisionRiskScore: routingResult.decisionRiskScore ?? 0.0,
        rawConfidence: routingResult.rawConfidence ?? 1.0,
        parameters: routingResult.parameters ?? {},
        idempotencyKey: `${state.organizationId}:${state.workflowRunId}:request_human_review`,
        constraints: { requiredPolicyIds: [] },
      }
      await executeAction(humanReviewAction, {} as any, state.organizationId, state.workflowRunId, state.playInstanceId, decisionSnapshot)
      return { routingResult: { ...routingResult, type: 'request_human_review' } as any, currentStep: 'route' }
    }

    if (approved) {
      const assignOwnerAction: ProposedAction = {
        actionId: randomUUID(),
        type: 'assign_owner',
        target: { leadId: state.leadId, organizationId: state.organizationId },
        rationale: {
          reasonCodes: (routingResult.parameters?.reason_codes as string[]) ?? [],
          evidenceIds: [],
        },
        decisionRiskScore: routingResult.decisionRiskScore ?? 0.0,
        rawConfidence: routingResult.rawConfidence ?? 1.0,
        parameters: routingResult.parameters ?? {},
        idempotencyKey: `${state.organizationId}:${state.workflowRunId}:assign_owner`,
        constraints: { requiredPolicyIds: [] },
      }
      await executeAction(assignOwnerAction, {} as any, state.organizationId, state.workflowRunId, state.playInstanceId, decisionSnapshot)
    }

    return { routingResult: routingResult as any, currentStep: 'route' }
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
