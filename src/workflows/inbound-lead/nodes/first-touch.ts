import { randomUUID } from 'crypto'
import { WorkflowState } from '../state.js'
import { executeAction } from '../../../actions/executor.js'
import { writeEvent } from '../../../events/event-log.js'
import { buildDecisionSnapshot } from '../../../evidence/context-builder.js'
import type { ProposedAction } from '../../../actions/types.js'

export async function firstTouch(state: WorkflowState): Promise<Partial<WorkflowState>> {
  const decisionSnapshot = await buildDecisionSnapshot(state as any)
  try {
    const action: ProposedAction = {
      actionId: randomUUID(),
      type: 'start_sequence',
      target: { leadId: state.leadId, organizationId: state.organizationId },
      rationale: { reasonCodes: [], evidenceIds: [] },
      decisionRiskScore: 0.0,
      rawConfidence: 1.0,
      parameters: {},
      idempotencyKey: `${state.organizationId}:${state.workflowRunId}:start_sequence`,
      constraints: { requiredPolicyIds: [] },
    }
    await executeAction(action, {} as any, state.organizationId, state.workflowRunId, state.playInstanceId, decisionSnapshot)
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
