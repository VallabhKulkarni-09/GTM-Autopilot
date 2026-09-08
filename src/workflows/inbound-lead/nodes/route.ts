import { randomUUID } from 'crypto'
import { WorkflowState } from '../state.js'
import { executeAction } from '../../../actions/executor.js'
import { validateAction } from '../../../actions/validator.js'
import { writeEvent } from '../../../events/event-log.js'
import { buildDecisionSnapshot } from '../../../evidence/context-builder.js'
import { RoutingAgent } from '../../../agents/routing/index.js'
import type { RoutingInput } from '../../../agents/routing/types.js'
import type { ProposedAction } from '../../../actions/types.js'

import { getDb } from '../../../db/client.js'

export async function route(state: WorkflowState): Promise<Partial<WorkflowState>> {
  const decisionSnapshot = await buildDecisionSnapshot(state as any)

  try {
    const territoryPolicyRules = (decisionSnapshot.policies ?? []).filter(
      (p: any) => p.rule_type === 'territory'
    )
    const { data: routingStateRow } = await getDb()
      .from('routing_state')
      .select('*')
      .eq('organization_id', state.organizationId)
      .limit(1)
      .single()

    // Default SDR team available for assignment
    const availableOwners = [
      { Id: '0055e000001SDR1', Name: 'Alex Rivera (SDR)', Email: 'alex.rivera@company.com', IsActive: true },
      { Id: '0055e000001SDR2', Name: 'Jordan Chen (SDR)', Email: 'jordan.chen@company.com', IsActive: true },
      { Id: '0055e000001SDR3', Name: 'Taylor Vance (SDR)', Email: 'taylor.vance@company.com', IsActive: true },
    ]

    const routingInput: RoutingInput = {
      lead: state.lead,
      company: state.company ?? null,
      qualificationResult: state.qualificationResult as any,
      availableOwners,
      ownerWorkloads: decisionSnapshot.ownerWorkloads ?? {},
      territoryPolicyRules,
      routingState: routingStateRow ?? ({ counter: 0 } as any),
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
