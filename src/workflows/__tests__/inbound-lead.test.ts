import { describe, it, expect, vi, beforeEach } from 'vitest'
import { app } from '../inbound-lead/graph.js'
import { leadRepo } from '../../repositories/lead.repo.js'

vi.mock('../../events/event-log.js', () => ({
  writeEvent: vi.fn().mockResolvedValue({})
}))

vi.mock('../../actions/executor.js', () => ({
  executeAction: vi.fn().mockResolvedValue({})
}))

vi.mock('../../actions/validator.js', () => ({
  validateAction: vi.fn().mockImplementation((res: any) => {
    if (res.type === 'request_human_review') return { approved: false, requiresHumanApproval: true }
    return { approved: true, requiresHumanApproval: false }
  })
}))

vi.mock('../../evidence/context-builder.js', () => ({
  buildDecisionSnapshot: vi.fn().mockResolvedValue({
    lead: { id: 'lead_1' },
    company: null,
    policies: [],
    ownerWorkloads: {},
    evidenceIds: [],
    agentName: 'system',
    agentVersion: 'v1.0.0',
    promptVersion: null,
    modelName: null
  })
}))

vi.mock('../../repositories/lead.repo.js', () => ({
  leadRepo: {
    isDuplicate: vi.fn().mockResolvedValue(false)
  }
}))

vi.mock('../../agents/qualification/index.js', () => ({
  QualificationAgent: class {
    name = 'qualification-agent'
    version = 'v1.0.0'
    async execute(input: any) {
      return {
        type: 'qualify_lead',
        parameters: { is_icp_fit: input.lead.is_icp_fit ?? true }
      }
    }
  }
}))

vi.mock('../../agents/routing/index.js', () => ({
  RoutingAgent: class {
    name = 'routing-agent'
    version = 'v1.0.0'
    async execute(input: any) {
      if (input.lead.requires_human_approval) {
        return { type: 'request_human_review' }
      }
      return { type: 'assign_owner' }
    }
  }
}))

describe('inbound-lead workflow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(leadRepo.isDuplicate).mockResolvedValue(false)
  })

  it('runs happy path', async () => {
    const initialState = {
      organizationId: 'org_1',
      workflowRunId: 'wr_1',
      leadId: 'lead_1',
      playInstanceId: 'play_1',
      lead: { id: 'lead_1', organization_id: 'org_1', email: 'test@example.com' },
    }
    const result = await app.invoke(initialState, { configurable: { thread_id: 'wr_1' } })
    expect(result.currentStep).toBe('complete')
  })

  it('not ICP path', async () => {
    const initialState = {
      organizationId: 'org_1',
      workflowRunId: 'wr_2',
      leadId: 'lead_2',
      playInstanceId: 'play_2',
      lead: { id: 'lead_2', organization_id: 'org_1', email: 'test@example.com', is_icp_fit: false },
    }
    const result = await app.invoke(initialState, { configurable: { thread_id: 'wr_2' } })
    expect(result.currentStep).toBe('mark_nurture')
  })

  it('duplicate path', async () => {
    vi.mocked(leadRepo.isDuplicate).mockResolvedValue(true)
    const initialState = {
      organizationId: 'org_1',
      workflowRunId: 'wr_3',
      leadId: 'lead_3',
      playInstanceId: 'play_3',
      lead: { id: 'lead_3', organization_id: 'org_1', email: 'test@example.com' },
    }
    const result = await app.invoke(initialState, { configurable: { thread_id: 'wr_3' } })
    expect(result.currentStep).toBe('mark_duplicate')
  })

  it('human review path', async () => {
    const initialState = {
      organizationId: 'org_1',
      workflowRunId: 'wr_4',
      leadId: 'lead_4',
      playInstanceId: 'play_4',
      lead: { id: 'lead_4', organization_id: 'org_1', email: 'test@example.com', requires_human_approval: true },
    }
    const result = await app.invoke(initialState, { configurable: { thread_id: 'wr_4' } })
    expect(result.currentStep).toBe('route')
    const state = await app.getState({ configurable: { thread_id: 'wr_4' } })
    expect(state.next).toEqual(['human_review'])
  })
})
