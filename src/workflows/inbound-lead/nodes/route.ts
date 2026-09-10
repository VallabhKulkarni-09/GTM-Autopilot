import { randomUUID } from 'crypto'
import { WorkflowState } from '../state.js'
import { getDb } from '../../../db/client.js'
import { executeAction } from '../../../actions/executor.js'
import { validateAction } from '../../../actions/validator.js'
import { writeEvent } from '../../../events/event-log.js'
import { buildDecisionSnapshot } from '../../../evidence/context-builder.js'
import { RoutingAgent } from '../../../agents/routing/index.js'
import { SalesforceConnector } from '../../../connectors/salesforce/salesforce.connector.js'
import type { RoutingInput } from '../../../agents/routing/types.js'
import type { ProposedAction } from '../../../actions/types.js'
import type { ConnectorRegistry } from '../../../actions/action-executor.js'

export async function route(state: WorkflowState): Promise<Partial<WorkflowState>> {
  const decisionSnapshot = await buildDecisionSnapshot(state as any)

  try {
    // ── 1. Load territory policy rules from snapshot (already fetched) ─────────
    const territoryPolicyRules = (decisionSnapshot.policies ?? []).filter(
      (p: any) => p.rule_type === 'territory'
    )

    // ── 2. Load routing_state for the inbound-leads queue ────────────────────
    const { data: routingStateRow } = await getDb()
      .from('routing_state')
      .select('id, queue_name, counter, updated_at')
      .eq('organization_id', state.organizationId)
      .eq('queue_name', 'inbound-leads')
      .single()

    const routingState = routingStateRow ?? { id: '', queue_name: 'inbound-leads', counter: 0, updated_at: new Date().toISOString() }

    // ── 3. Load available owners from external_identity (SF users) ────────────
    const { data: sfIdentities } = await getDb()
      .from('external_identity')
      .select('external_id, metadata')
      .eq('organization_id', state.organizationId)
      .eq('provider', 'salesforce_user')

    const availableOwners = (sfIdentities ?? []).map((u: any) => ({
      Id:       u.external_id as string,
      Name:     (u.metadata?.name as string) ?? 'Sales Rep',
      Email:    (u.metadata?.email as string) ?? '',
      IsActive: true,
    }))

    // ── 4. Run RoutingAgent ───────────────────────────────────────────────────
    const routingInput: RoutingInput = {
      lead:                state.lead,
      company:             state.company ?? null,
      qualificationResult: state.qualificationResult as any,
      availableOwners,
      ownerWorkloads:      decisionSnapshot.ownerWorkloads,
      territoryPolicyRules,
      routingState:        routingState as any,
    }
    const agent = new RoutingAgent()
    const routingResult = agent.run(routingInput)

    await writeEvent({
      organizationId: state.organizationId,
      workflowRunId:  state.workflowRunId,
      playInstanceId: state.playInstanceId,
      leadId:         state.leadId,
      eventType:      'action_proposed',
      actorType:      'agent',
      actorId:        agent.name,
      agentVersion:   agent.version,
      proposedAction: routingResult as any,
      decisionSnapshot,
      eventStatus:    'success',
    })

    const { approved, requiresHumanApproval } = await validateAction(routingResult as any, state.organizationId)

    // ── 5a. Human review path ─────────────────────────────────────────────────
    if (requiresHumanApproval || routingResult.type === 'request_human_review') {
      const humanReviewAction: ProposedAction = {
        actionId:          randomUUID(),
        type:              'request_human_review',
        target:            { leadId: state.leadId, organizationId: state.organizationId },
        rationale:         { reasonCodes: (routingResult.parameters?.reason_codes as string[]) ?? [], evidenceIds: [] },
        decisionRiskScore: routingResult.decisionRiskScore ?? 0.0,
        rawConfidence:     routingResult.rawConfidence ?? 1.0,
        parameters:        routingResult.parameters ?? {},
        idempotencyKey:    `${state.organizationId}:${state.workflowRunId}:request_human_review`,
        constraints:       { requiredPolicyIds: [] },
      }
      await executeAction(humanReviewAction, {} as any, state.organizationId, state.workflowRunId, state.playInstanceId, decisionSnapshot)
      return { routingResult: { ...routingResult, type: 'request_human_review' } as any, currentStep: 'route' }
    }

    // ── 5b. Owner assignment path ─────────────────────────────────────────────
    if (approved && routingResult.type === 'assign_owner') {
      // Build SF connector — connect only when credentials are available.
      // Null-safe: action-executor skips the SF API call when connector is absent.
      let sfConnector: SalesforceConnector | null = null
      const sfInstanceUrl = process.env.SF_INSTANCE_URL
      const sfClientId    = process.env.SF_CLIENT_ID
      const sfClientSecret = process.env.SF_CLIENT_SECRET

      if (sfInstanceUrl && sfClientId && sfClientSecret) {
        try {
          sfConnector = new SalesforceConnector()
          await sfConnector.connect({
            instanceUrl:  sfInstanceUrl,
            clientId:     sfClientId,
            clientSecret: sfClientSecret,
            sandbox:      process.env.SF_SANDBOX === 'true',
          })
        } catch (connErr) {
          console.warn(`[route] SF connect failed — proceeding without SF: ${(connErr as Error).message}`)
          sfConnector = null
        }
      }

      const connectors: Partial<ConnectorRegistry> = sfConnector ? { salesforce: sfConnector as any } : {}

      const assignOwnerAction: ProposedAction = {
        actionId:          randomUUID(),
        type:              'assign_owner',
        target:            { leadId: state.leadId, organizationId: state.organizationId },
        rationale:         { reasonCodes: (routingResult.parameters?.reason_codes as string[]) ?? [], evidenceIds: [] },
        decisionRiskScore: routingResult.decisionRiskScore ?? 0.0,
        rawConfidence:     routingResult.rawConfidence ?? 1.0,
        parameters:        routingResult.parameters ?? {},
        idempotencyKey:    `${state.organizationId}:${state.workflowRunId}:assign_owner`,
        constraints:       { requiredPolicyIds: [] },
      }
      await executeAction(assignOwnerAction, connectors as any, state.organizationId, state.workflowRunId, state.playInstanceId, decisionSnapshot)
    }

    return { routingResult: routingResult as any, currentStep: 'route' }
  } catch (e: any) {
    await writeEvent({
      organizationId: state.organizationId,
      workflowRunId:  state.workflowRunId,
      playInstanceId: state.playInstanceId,
      leadId:         state.leadId,
      eventType:      'action_execution_failed',
      actorType:      'system',
      decisionSnapshot,
      eventStatus:    'failed',
      errorMessage:   e.message,
    })
    throw e
  }
}
