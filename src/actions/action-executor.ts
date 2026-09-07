import { createClient } from '@supabase/supabase-js'
import { writeEvent } from '../events/event-log.js'
import { DecisionSnapshot, ConnectorName } from '../domain/db-types.js'
import { ProposedAction } from './types.js'

export type ConnectorRegistry = {
  salesforce: any
  hubspot: any
  outreach: any
  clearbit: any
}

export type ActionExecutionResult = {
  success: boolean
  externalSystem?: ConnectorName
  externalId?: string
  output?: Record<string, unknown>
  error?: any
}

// Ensure supabase client is instantiated properly for DB operations
const supabase = createClient(
  process.env.SUPABASE_URL || 'http://localhost:54321', 
  process.env.SUPABASE_SERVICE_KEY || 'anon'
)

export const actionExecutionStateRepo = {
  async existsByIdempotencyKey(key: string): Promise<boolean> {
    const { count } = await supabase.from('action_execution_state')
      .select('id', { count: 'exact', head: true })
      .eq('idempotency_key', key)
    return (count ?? 0) > 0
  }
}

export const leadRepo = {
  async updateLead(id: string, updates: any) {
    await supabase.from('leads').update(updates).eq('id', id)
  }
}

export const playInstanceRepo = {
  async updatePlayInstance(leadId: string, updates: any) {
    await supabase.from('play_instance').update(updates).eq('lead_id', leadId)
  }
}

export const routingStateRepo = {
  async incrementCurrentIndex(orgId: string) {
    // Dummy implementation for now, assuming RPC or simple update
    await supabase.rpc('increment_routing_index', { org_id: orgId })
  }
}

export async function executeAction(
  action: ProposedAction,
  connectors: ConnectorRegistry,
  organizationId: string,
  workflowRunId: string,
  decisionSnapshot: DecisionSnapshot
): Promise<ActionExecutionResult> {
  const { idempotencyKey, type, target: { leadId } } = action
  // Default playInstanceId for writeEvent
  const playInstanceId = 'default-play-id' 

  const exists = await actionExecutionStateRepo.existsByIdempotencyKey(idempotencyKey)
  if (exists) {
    await writeEvent({
      organizationId,
      workflowRunId,
      playInstanceId,
      leadId,
      eventType: 'action_execution_deduplicated',
      actorType: 'agent',
      decisionSnapshot,
      idempotencyKey,
      eventStatus: 'success',
    })
    return { success: true, output: { deduplicated: true } }
  }

  await writeEvent({
    organizationId,
    workflowRunId,
    playInstanceId,
    leadId,
    eventType: 'action_execution_started',
    actorType: 'agent',
    decisionSnapshot,
    idempotencyKey,
    proposedAction: action,
    eventStatus: 'success',
  })

  let externalSystem: ConnectorName | undefined = undefined
  let externalId: string | undefined = undefined
  let output: Record<string, unknown> | undefined = undefined

  try {
    switch (type) {
      case 'qualify_lead':
        await leadRepo.updateLead(leadId, {
          is_icp_fit: action.parameters?.is_icp_fit,
          icp_score: action.parameters?.icp_score,
          icp_tier: action.parameters?.icp_tier,
        })
        break

      case 'assign_owner':
        await connectors.salesforce.assignLeadOwner(
          leadId, 
          action.parameters?.recommended_owner_id, 
          idempotencyKey
        )
        const due_date = new Date(Date.now() + 15 * 60000).toISOString()
        await connectors.salesforce.createTask(
          leadId, 
          { subject: 'Call within 15 minutes', due_date }, 
          idempotencyKey
        )
        await playInstanceRepo.updatePlayInstance(leadId, {
          assigned_owner_id: action.parameters?.recommended_owner_id
        })
        await routingStateRepo.incrementCurrentIndex(organizationId)
        externalSystem = 'salesforce'
        break

      case 'start_sequence':
        await connectors.outreach.enrollInSequence(
          leadId, 
          action.parameters?.sequence_id, 
          idempotencyKey
        )
        await playInstanceRepo.updatePlayInstance(leadId, {
          first_touch_at: new Date().toISOString()
        })
        externalSystem = 'outreach'
        break

      case 'mark_nurture':
        await leadRepo.updateLead(leadId, { stage: 'nurture' })
        await playInstanceRepo.updatePlayInstance(leadId, { status: 'nurture' })
        break

      case 'mark_duplicate':
        await leadRepo.updateLead(leadId, { is_duplicate: true })
        await playInstanceRepo.updatePlayInstance(leadId, { status: 'completed' })
        break

      case 'request_human_review':
        await playInstanceRepo.updatePlayInstance(leadId, {
          status: 'pending_human',
          pending_approval_since: new Date().toISOString()
        })
        break

      case 'escalate':
        await playInstanceRepo.updatePlayInstance(leadId, {
          status: 'escalated'
        })
        break
    }

    output = { success: true }

    await writeEvent({
      organizationId,
      workflowRunId,
      playInstanceId,
      leadId,
      eventType: 'action_execution_succeeded',
      actorType: 'agent',
      decisionSnapshot,
      idempotencyKey,
      externalSystem,
      externalId,
      eventStatus: 'success',
      proposedAction: action,
    })

    return { success: true, externalSystem, externalId, output }
  } catch (error: any) {
    await writeEvent({
      organizationId,
      workflowRunId,
      playInstanceId,
      leadId,
      eventType: 'action_execution_failed',
      actorType: 'agent',
      decisionSnapshot,
      idempotencyKey,
      eventStatus: 'failed',
      errorCode: error.code || 'UNKNOWN_ERROR',
      errorMessage: error.message,
      errorRaw: error,
      proposedAction: action,
    })
    
    throw error
  }
}
