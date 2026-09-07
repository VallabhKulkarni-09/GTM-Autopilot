/**
 * action-executor.test.ts
 * Unit tests for executeAction().
 * Mocks: Supabase client, connectors, writeEvent
 * Does NOT mock: business logic in action-executor itself
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { executeAction } from '../action-executor.js'
import type { ProposedAction, ConnectorRegistry, DecisionSnapshot } from '../types.js'

// ─── Mock Supabase ────────────────────────────────────────────────────────────

const mockSelect = vi.fn()
const mockUpdate = vi.fn()
const mockSingle = vi.fn()

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      select: mockSelect,
      update: mockUpdate,
      eq: () => ({ eq: () => ({ eq: () => ({ count: 0, error: null }), single: mockSingle, select: mockSelect }) }),
    }),
  }),
}))

// ─── Mock writeEvent ──────────────────────────────────────────────────────────

const mockWriteEvent = vi.fn().mockResolvedValue({ id: 'evt_1' })
vi.mock('../../events/event-log.js', () => ({
  writeEvent: (...args: unknown[]) => mockWriteEvent(...args),
}))

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ORG_ID = 'org_1'
const WF_ID = 'wf_1'
const PLAY_ID = 'play_1'
const LEAD_ID = 'lead_1'
const IDEM_KEY = `${ORG_ID}:${WF_ID}:action_1`

const snapshot: DecisionSnapshot = {
  lead: { id: LEAD_ID } as any,
  company: null,
  policies: [],
  ownerWorkloads: {},
  evidenceIds: [],
  agentName: 'test',
  agentVersion: '1.0.0',
  promptVersion: null,
  modelName: null,
}

function makeAction(type: string, parameters: Record<string, unknown> = {}): ProposedAction {
  return {
    actionId: 'action_1',
    type: type as any,
    target: { leadId: LEAD_ID, organizationId: ORG_ID },
    rationale: { reasonCodes: [], evidenceIds: [] },
    decisionRiskScore: 0.0,
    rawConfidence: 1.0,
    parameters,
    idempotencyKey: IDEM_KEY,
    constraints: { requiredPolicyIds: [] },
  }
}

const mockSalesforce = {
  assignLeadOwner: vi.fn().mockResolvedValue(undefined),
  createTask: vi.fn().mockResolvedValue({ Id: 'sf_task_1' }),
}
const mockOutreach = {
  enrollInSequence: vi.fn().mockResolvedValue(undefined),
}
const connectors: ConnectorRegistry = {
  salesforce: mockSalesforce,
  outreach: mockOutreach,
  hubspot: {},
  clearbit: {},
} as any

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('executeAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // By default: idempotency check returns not-found
    mockSelect.mockReturnValue({
      eq: () => ({ eq: () => ({ count: 0, error: null }) }),
      count: 0,
      error: null,
    })
    mockUpdate.mockReturnValue({
      eq: () => ({ eq: () => ({ error: null, data: null }) }),
      error: null,
    })
    mockSingle.mockResolvedValue({ data: null, error: { message: 'not found' } })
  })

  it('qualify_lead: updates lead, emits started + succeeded events', async () => {
    const action = makeAction('qualify_lead', {
      is_icp_fit: true,
      icp_score: 75,
      icp_tier: 'tier_1',
    })

    const result = await executeAction(action, connectors, ORG_ID, WF_ID, PLAY_ID, snapshot)

    expect(result.success).toBe(true)
    expect(result.output).toMatchObject({ is_icp_fit: true, icp_score: 75, icp_tier: 'tier_1' })

    const eventTypes = mockWriteEvent.mock.calls.map((c) => c[0].eventType)
    expect(eventTypes).toContain('action_execution_started')
    expect(eventTypes).toContain('action_execution_succeeded')
    expect(eventTypes).not.toContain('action_execution_failed')
  })

  it('assign_owner: calls SF assignLeadOwner + createTask, updates routing_state', async () => {
    // Mock routing_state lookup for increment
    mockSingle.mockResolvedValueOnce({ data: { id: 'rs_1', counter: 2 }, error: null })

    const action = makeAction('assign_owner', {
      recommended_owner_id: 'sf_owner_1',
      queue_name: 'na_smb',
      sf_lead_id: 'sf_lead_1',
    })

    const result = await executeAction(action, connectors, ORG_ID, WF_ID, PLAY_ID, snapshot)

    expect(result.success).toBe(true)
    expect(result.externalSystem).toBe('salesforce')
    expect(mockSalesforce.assignLeadOwner).toHaveBeenCalledWith('sf_lead_1', 'sf_owner_1', IDEM_KEY)
    expect(mockSalesforce.createTask).toHaveBeenCalledWith(
      'sf_lead_1',
      expect.objectContaining({ subject: 'Call within 15 minutes' }),
      `${IDEM_KEY}:task`
    )
  })

  it('idempotency hit: emits deduplicated event, returns cached result', async () => {
    // Simulate idempotency key already exists
    mockSelect.mockReturnValueOnce({
      eq: () => ({ eq: () => ({ count: 1, error: null }) }),
      count: 1,
      error: null,
    })

    const action = makeAction('qualify_lead', { is_icp_fit: true, icp_score: 80, icp_tier: 'tier_1' })
    const result = await executeAction(action, connectors, ORG_ID, WF_ID, PLAY_ID, snapshot)

    expect(result.success).toBe(true)
    expect(result.output).toMatchObject({ deduplicated: true })
    const eventTypes = mockWriteEvent.mock.calls.map((c) => c[0].eventType)
    expect(eventTypes).toContain('action_execution_deduplicated')
    // Should NOT emit started/succeeded since it was deduplicated
    expect(eventTypes).not.toContain('action_execution_started')
  })

  it('ConnectorError: emits failed event, re-throws', async () => {
    const { ConnectorError } = await import('../types.js')
    mockSalesforce.assignLeadOwner.mockRejectedValueOnce(
      new ConnectorError('salesforce', 'ASSIGN_FAILED', 500, { raw: true }, 'SF assign failed')
    )

    const action = makeAction('assign_owner', {
      recommended_owner_id: 'sf_owner_1',
      queue_name: 'na_smb',
      sf_lead_id: 'sf_lead_1',
    })

    await expect(
      executeAction(action, connectors, ORG_ID, WF_ID, PLAY_ID, snapshot)
    ).rejects.toThrow('SF assign failed')

    const eventTypes = mockWriteEvent.mock.calls.map((c) => c[0].eventType)
    expect(eventTypes).toContain('action_execution_failed')
  })

  it('event_log write happens even when connector throws (try/finally)', async () => {
    mockSalesforce.assignLeadOwner.mockRejectedValueOnce(new Error('Network timeout'))

    const action = makeAction('assign_owner', {
      recommended_owner_id: 'sf_owner_1',
      queue_name: 'na_smb',
      sf_lead_id: 'sf_lead_1',
    })

    try {
      await executeAction(action, connectors, ORG_ID, WF_ID, PLAY_ID, snapshot)
    } catch {
      // expected
    }

    const eventTypes = mockWriteEvent.mock.calls.map((c) => c[0].eventType)
    // started was written before connector call
    expect(eventTypes).toContain('action_execution_started')
    // failed must be written even after throw
    expect(eventTypes).toContain('action_execution_failed')
  })
})
