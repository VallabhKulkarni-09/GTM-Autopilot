import { randomUUID } from 'crypto'
import { WorkflowState } from '../state.js'
import { executeAction } from '../../../actions/executor.js'
import { writeEvent } from '../../../events/event-log.js'
import { buildDecisionSnapshot } from '../../../evidence/context-builder.js'
import { QualificationAgent } from '../../../agents/qualification/index.js'
import type { QualificationInput } from '../../../agents/qualification/types.js'
import type { ProposedAction } from '../../../actions/types.js'

export async function qualify(state: WorkflowState): Promise<Partial<WorkflowState>> {
  const decisionSnapshot = await buildDecisionSnapshot(state as any)

  try {
    const input: QualificationInput = {
      lead: state.lead,
      company: state.company ?? null,
      enrichmentEvidence: state.evidence,
      icpPolicyRules: [], // TODO: load from DB
    }
    const agent = new QualificationAgent()
    const qualificationResult = agent.run(input)

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

    const action: ProposedAction = {
      actionId: randomUUID(),
      type: 'qualify_lead',
      target: { leadId: state.leadId, organizationId: state.organizationId },
      rationale: {
        reasonCodes: (qualificationResult.parameters?.reason_codes as string[]) ?? [],
        evidenceIds: state.evidence.map((e: any) => e.id ?? '').filter(Boolean),
      },
      decisionRiskScore: qualificationResult.decisionRiskScore ?? 0.0,
      rawConfidence: qualificationResult.rawConfidence ?? 1.0,
      parameters: qualificationResult.parameters ?? {},
      idempotencyKey: `${state.organizationId}:${state.workflowRunId}:qualify_lead`,
      constraints: { requiredPolicyIds: [] },
    }

    await executeAction(action, {} as any, state.organizationId, state.workflowRunId, state.playInstanceId, decisionSnapshot)

    return { qualificationResult: qualificationResult as any, currentStep: 'qualify' }
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
