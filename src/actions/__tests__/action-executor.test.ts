import { describe, it, expect, vi, beforeEach } from 'vitest'
import { executeAction, actionExecutionStateRepo, leadRepo, playInstanceRepo, routingStateRepo } from '../action-executor.js'
import * as eventLog from '../../events/event-log.js'
import { ProposedAction } from '../types.js'
import { DecisionSnapshot } from '../../domain/db-types.js'

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: vi.fn(),
    rpc: vi.fn()
  }))
}))

describe('Action Executor', () => {
  const mockWriteEvent = vi.spyOn(eventLog, 'writeEvent').mockResolvedValue({} as any)
  const mockExistsByIdempotencyKey = vi.spyOn(actionExecutionStateRepo, 'existsByIdempotencyKey')
  const mockUpdateLead = vi.spyOn(leadRepo, 'updateLead').mockResolvedValue(undefined)
  const mockUpdatePlayInstance = vi.spyOn(playInstanceRepo, 'updatePlayInstance').mockResolvedValue(undefined)
  const mockIncrementCurrentIndex = vi.spyOn(routingStateRepo, 'incrementCurrentIndex').mockResolvedValue(undefined)

  const connectors = {
    salesforce: {
      assignLeadOwner: vi.fn(),
      createTask: vi.fn(),
    },
    hubspot: {},
    outreach: {
      enrollInSequence: vi.fn(),
    },
    clearbit: {}
  }

  const decisionSnapshot: DecisionSnapshot = {
    lead: {} as any,
    company: null,
    policies: [],
    ownerWorkloads: {},
    evidenceIds: [],
    agentName: 'test',
    agentVersion: '1.0',
    promptVersion: null,
    modelName: null
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockExistsByIdempotencyKey.mockResolvedValue(false)
  })

  it('qualify_lead updates lead and emits started + succeeded events', async () => {
    const action: ProposedAction = {
      actionId: '1',
      type: 'qualify_lead',
      target: { leadId: 'lead-1', organizationId: 'org-1' },
      rationale: { reasonCodes: [], evidenceIds: [] },
      decisionRiskScore: 0,
      rawConfidence: 1,
      parameters: { is_icp_fit: true, icp_score: 90, icp_tier: 'A' },
      idempotencyKey: 'idemp-1',
      constraints: { requiredPolicyIds: [] }
    }

    const result = await executeAction(action, connectors, 'org-1', 'run-1', decisionSnapshot)

    expect(result.success).toBe(true)
    expect(mockUpdateLead).toHaveBeenCalledWith('lead-1', {
      is_icp_fit: true,
      icp_score: 90,
      icp_tier: 'A'
    })
    
    expect(mockWriteEvent).toHaveBeenCalledTimes(2)
    expect(mockWriteEvent).toHaveBeenNthCalledWith(1, expect.objectContaining({ eventType: 'action_execution_started' }))
    expect(mockWriteEvent).toHaveBeenNthCalledWith(2, expect.objectContaining({ eventType: 'action_execution_succeeded' }))
  })

  it('assign_owner calls SF assignLeadOwner + createTask, updates routing_state', async () => {
    const action: ProposedAction = {
      actionId: '2',
      type: 'assign_owner',
      target: { leadId: 'lead-2', organizationId: 'org-1' },
      rationale: { reasonCodes: [], evidenceIds: [] },
      decisionRiskScore: 0,
      rawConfidence: 1,
      parameters: { recommended_owner_id: 'owner-1', queue_name: 'q1' },
      idempotencyKey: 'idemp-2',
      constraints: { requiredPolicyIds: [] }
    }

    const result = await executeAction(action, connectors, 'org-1', 'run-1', decisionSnapshot)

    expect(result.success).toBe(true)
    expect(connectors.salesforce.assignLeadOwner).toHaveBeenCalledWith('lead-2', 'owner-1', 'idemp-2')
    expect(connectors.salesforce.createTask).toHaveBeenCalledWith('lead-2', expect.objectContaining({ subject: 'Call within 15 minutes' }), 'idemp-2')
    expect(mockUpdatePlayInstance).toHaveBeenCalledWith('lead-2', { assigned_owner_id: 'owner-1' })
    expect(mockIncrementCurrentIndex).toHaveBeenCalledWith('org-1')
  })

  it('idempotency hit emits deduplicated event, returns cached result', async () => {
    mockExistsByIdempotencyKey.mockResolvedValue(true)

    const action: ProposedAction = {
      actionId: '3',
      type: 'mark_nurture',
      target: { leadId: 'lead-3', organizationId: 'org-1' },
      rationale: { reasonCodes: [], evidenceIds: [] },
      decisionRiskScore: 0,
      rawConfidence: 1,
      parameters: {},
      idempotencyKey: 'idemp-3',
      constraints: { requiredPolicyIds: [] }
    }

    const result = await executeAction(action, connectors, 'org-1', 'run-1', decisionSnapshot)

    expect(result.success).toBe(true)
    expect(result.output).toEqual({ deduplicated: true })
    expect(mockWriteEvent).toHaveBeenCalledTimes(1)
    expect(mockWriteEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'action_execution_deduplicated' }))
    
    // Logic should be skipped
    expect(mockUpdateLead).not.toHaveBeenCalled()
  })

  it('ConnectorError emits failed event, re-throws', async () => {
    const action: ProposedAction = {
      actionId: '4',
      type: 'assign_owner',
      target: { leadId: 'lead-4', organizationId: 'org-1' },
      rationale: { reasonCodes: [], evidenceIds: [] },
      decisionRiskScore: 0,
      rawConfidence: 1,
      parameters: { recommended_owner_id: 'owner-2' },
      idempotencyKey: 'idemp-4',
      constraints: { requiredPolicyIds: [] }
    }

    const mockError = new Error('SF failed');
    (mockError as any).code = 'SF_ERR'
    connectors.salesforce.assignLeadOwner.mockRejectedValueOnce(mockError)

    await expect(executeAction(action, connectors, 'org-1', 'run-1', decisionSnapshot)).rejects.toThrow('SF failed')

    expect(mockWriteEvent).toHaveBeenCalledTimes(2)
    expect(mockWriteEvent).toHaveBeenNthCalledWith(1, expect.objectContaining({ eventType: 'action_execution_started' }))
    expect(mockWriteEvent).toHaveBeenNthCalledWith(2, expect.objectContaining({ eventType: 'action_execution_failed', errorCode: 'SF_ERR' }))
  })
})
