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
