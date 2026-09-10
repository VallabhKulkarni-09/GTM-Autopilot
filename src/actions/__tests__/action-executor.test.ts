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

let idempotencyExists = false  // flip this to simulate a hit
const mockSingle = vi.fn()

/**
 * Thenable proxy chain. Every method returns another chain.
 * When awaited, resolves with the current mockDbResult.
 * Special case: .single() calls the mockSingle fn.
 */
let mockDbResult: unknown = { data: [], error: null, count: 0 }

function buildChain(): any {
  const chain: any = {
    then(resolve: (v: unknown) => unknown) {
      return Promise.resolve(mockDbResult).then(resolve)
    },
    catch(reject: (e: unknown) => unknown) {
      return Promise.resolve(mockDbResult).catch(reject)
    },
    single: mockSingle,
  }
  return new Proxy(chain, {
    get(target, prop: string) {
      if (prop in target) return target[prop]
      return (..._args: unknown[]) => buildChain()
    },
  })
}

vi.mock('../../db/client.js', () => ({
  getDb: () => ({
    from: (table: string) => ({
      select: (..._args: unknown[]) => {
        // For idempotency check on action_execution_state table
        if (table === 'action_execution_state') {
          const count = idempotencyExists ? 1 : 0
          return buildChainWith({ count, data: [], error: null })
        }
        return buildChain()
      },
      update: () => buildChain(),
      insert: () => buildChain(),
    }),
  }),
  _resetDbClient: vi.fn(),
}))

function buildChainWith(result: unknown): any {
  const chain: any = {
    then(resolve: (v: unknown) => unknown) {
      return Promise.resolve(result).then(resolve)
    },
    catch(reject: (e: unknown) => unknown) {
      return Promise.resolve(result).catch(reject)
    },
    single: mockSingle,
  }
  return new Proxy(chain, {
    get(target, prop: string) {
      if (prop in target) return target[prop]
      return (..._args: unknown[]) => buildChainWith(result)
    },
  })
}

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
    idempotencyExists = false
    mockDbResult = { data: [], error: null, count: 0 }
    mockSingle.mockResolvedValue({ data: null, error: { message: 'not found' } })
    mockWriteEvent.mockResolvedValue({ id: 'evt_1' })
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
      expect.objectContaining({ due_date: expect.any(String) }),
      `${IDEM_KEY}:task`
    )
  })

  it('idempotency hit: emits deduplicated event, returns cached result', async () => {
    idempotencyExists = true  // simulate key already exists

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
