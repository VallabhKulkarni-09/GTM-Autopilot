/**
 * nodes/account-match.ts
 * Checks whether the inbound lead's email domain matches an existing Salesforce Account.
 *
 * Decision tree:
 *   Open Opportunity found  → sets routingResult to bypass SDR, route to AE directly
 *   Existing Account only   → sets routingResult to route to Account Owner
 *   No match                → falls through to QualificationAgent
 *
 * This node runs AFTER enrichment so we have the company domain, and BEFORE
 * qualification so an active enterprise deal is never sent through the SDR scoring path.
 */

import { WorkflowState } from '../state.js'
import { SalesforceConnector } from '../../../connectors/salesforce/salesforce.connector.js'
import { writeEvent } from '../../../events/event-log.js'
import { buildDecisionSnapshot } from '../../../evidence/context-builder.js'
import { getDb } from '../../../db/client.js'

async function loadSalesforceConfig(organizationId: string) {
  const { data } = await getDb()
    .from('connector_config')
    .select('config')
    .eq('organization_id', organizationId)
    .eq('connector_name', 'salesforce')
    .single()
  return data?.config as any ?? null
}

export async function accountMatch(state: WorkflowState): Promise<Partial<WorkflowState>> {
  const decisionSnapshot = await buildDecisionSnapshot(state as any)

  try {
    // Extract company domain from state (set by enrich node) or from email
    const domain =
      (state.company as any)?.domain ??
      state.lead.email.split('@')[1]?.toLowerCase().trim()

    if (!domain) {
      // No domain → cannot match → fall through to qualification
      return { currentStep: 'account_match' }
    }

    // Load Salesforce credentials for this org
    const sfConfig = await loadSalesforceConfig(state.organizationId)
    if (!sfConfig) {
      // No SF connector configured → skip account matching
      return { currentStep: 'account_match' }
    }

    const sf = new SalesforceConnector()
    await sf.connect(sfConfig)

    const idempotencyKey = `${state.organizationId}:${state.workflowRunId}:account_match:${domain}`
    const match = await sf.matchAccountByDomain(domain, idempotencyKey)

    if (!match) {
      // Net-new account → proceed to qualification
      await writeEvent({
        organizationId: state.organizationId,
        workflowRunId:  state.workflowRunId,
        playInstanceId: state.playInstanceId,
        leadId:         state.leadId,
        eventType:      'account_match_no_match',
        actorType:      'system',
        decisionSnapshot,
        eventStatus:    'success',
      })
      return { currentStep: 'account_match' }
    }

    // Determine routing target: open opportunity owner wins over account owner
    const ownerId   = match.openOpportunityOwnerId ?? match.accountOwnerId
    const ownerName = match.openOpportunityOwnerName ?? match.accountOwnerName
    const hasOpenDeal = !!match.openOpportunityId
    const reasonCode  = hasOpenDeal ? 'EXISTING_ACTIVE_DEAL' : 'EXISTING_ACCOUNT_OWNER'

    await writeEvent({
      organizationId: state.organizationId,
      workflowRunId:  state.workflowRunId,
      playInstanceId: state.playInstanceId,
      leadId:         state.leadId,
      eventType:      'account_match_found',
      actorType:      'system',
      decisionSnapshot: {
        ...decisionSnapshot,
        matchedAccountId:   match.accountId,
        matchedOpportunityId: match.openOpportunityId,
        routedOwnerId:      ownerId,
      } as any,
      eventStatus: 'success',
    })

    // Build a synthetic routingResult so the graph edges can check it
    const routingResult = {
      type:             'assign_owner',
      parameters: {
        recommended_owner_id:   ownerId,
        recommended_owner_name: ownerName,
        queue_name:             hasOpenDeal ? 'enterprise-ae' : 'account-owner',
        reason_codes:           [reasonCode],
      },
      decisionRiskScore: 0.0,
      rawConfidence:     1.0,
      // Signal to graph that this bypasses qualification
      _bypassQualification: true,
    }

    return {
      currentStep:   'account_match',
      routingResult: routingResult as any,
    }

  } catch (err: any) {
    // Account match failure is non-fatal — log and fall through to normal pipeline
    console.error(`[account-match] Failed for lead ${state.leadId}:`, err?.message ?? err)
    await writeEvent({
      organizationId: state.organizationId,
      workflowRunId:  state.workflowRunId,
      playInstanceId: state.playInstanceId,
      leadId:         state.leadId,
      eventType:      'account_match_error',
      actorType:      'system',
      decisionSnapshot,
      eventStatus:    'skipped',
      errorMessage:   err?.message,
    })
    return { currentStep: 'account_match' }
  }
}
