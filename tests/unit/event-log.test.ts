/**
 * event-log.test.ts
 * Unit tests for event-log.ts (writeEvent) and event-processor.ts (processEvent).
 * Uses mocked Supabase client — no live DB needed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { WriteEventInput, EventLogRow } from '../../events/event.types.js'
import type { DecisionSnapshot } from '../../domain/db-types.js'

// ─── Mock supabase-js ─────────────────────────────────────────────────────────

const mockInsert = vi.fn()
const mockSelect = vi.fn()
const mockSingle = vi.fn()
const mockUpdate = vi.fn()
const mockEq = vi.fn()
const mockUpsert = vi.fn()

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      insert: mockInsert.mockReturnValue({
        select: mockSelect.mockReturnValue({
          single: mockSingle,
        }),
      }),
      update: mockUpdate.mockReturnValue({
        eq: mockEq.mockReturnValue({ eq: mockEq }),
      }),
      upsert: mockUpsert,
      select: vi.fn().mockReturnValue({
        eq: mockEq.mockReturnValue({ eq: mockEq }),
        order: vi.fn().mockResolvedValue({ data: [], error: null }),
      }),
    }),
  }),
}))

process.env.SUPABASE_URL = 'https://test.supabase.co'
process.env.SUPABASE_SERVICE_KEY = 'test-service-key'

// ─── Fixture ──────────────────────────────────────────────────────────────────

const makeSnapshot = (): DecisionSnapshot => ({
  lead: { id: 'lead-1', organization_id: 'org-1', email: 'test@example.com', stage: 'new', form_submitted_at: new Date().toISOString(), source: 'hubspot', first_name: null, last_name: null, title: null, phone: null, company_id: null, raw_payload: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
  company: null,
  policies: [],
  ownerWorkloads: {},
  evidenceIds: [],
  agentName: 'qualification-agent',
  agentVersion: '1.0.0',
  promptVersion: null,
  modelName: null,
})

const makeInput = (overrides: Partial<WriteEventInput> = {}): WriteEventInput => ({
  organizationId:   'org-1',
  workflowRunId:    'run-1',
  playInstanceId:   'play-1',
  leadId:           'lead-1',
  eventType:        'action_proposed',
  actorType:        'agent',
  decisionSnapshot: makeSnapshot(),
  eventStatus:      'success',
  ...overrides,
})

const makeRow = (input: WriteEventInput): EventLogRow => ({
  id: 'event-1',
  organization_id: input.organizationId,
  workflow_run_id: input.workflowRunId,
  play_instance_id: input.playInstanceId,
  lead_id: input.leadId,
  event_type: input.eventType,
  actor_type: input.actorType,
  actor_id: null, agent_version: null, model_provider: null, model_name: null,
  prompt_version: null, proposed_action: null, candidate_actions: null,
  policy_rule_id: null, policy_name: null, policy_passed: null, policy_decision: null,
  external_system: null, external_id: null, idempotency_key: null,
  event_status: input.eventStatus, error_code: null, error_message: null, error_raw: null,
  duration_ms: null, occurred_at: new Date().toISOString(), created_at: new Date().toISOString(),
  decision_snapshot: input.decisionSnapshot,
})

// ─── writeEvent tests ─────────────────────────────────────────────────────────

describe('writeEvent', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('throws immediately if decisionSnapshot is missing (null)', async () => {
    const { writeEvent } = await import('../../events/event-log.js')
    const input = makeInput({ decisionSnapshot: null as any })
    await expect(writeEvent(input)).rejects.toThrow('decisionSnapshot')
  })

  it('throws immediately if decisionSnapshot is undefined', async () => {
    const { writeEvent } = await import('../../events/event-log.js')
    const input = makeInput()
    delete (input as any).decisionSnapshot
    await expect(writeEvent(input)).rejects.toThrow('decisionSnapshot')
  })

  it('inserts exactly one row when called with valid input', async () => {
    const { writeEvent } = await import('../../events/event-log.js')
    const input = makeInput()
    mockSingle.mockResolvedValue({ data: makeRow(input), error: null })

    const result = await writeEvent(input)
    expect(mockInsert).toHaveBeenCalledTimes(1)
    expect(result.event_type).toBe('action_proposed')
    expect(result.decision_snapshot).toBeDefined()
  })

  it('throws if DB insert returns an error', async () => {
    const { writeEvent } = await import('../../events/event-log.js')
    mockSingle.mockResolvedValue({ data: null, error: { message: 'DB error', code: '42P01' } })
    await expect(writeEvent(makeInput())).rejects.toThrow('DB error')
  })

  it('does NOT call update (append-only guard)', async () => {
    const { writeEvent } = await import('../../events/event-log.js')
    mockSingle.mockResolvedValue({ data: makeRow(makeInput()), error: null })
    await writeEvent(makeInput())
    expect(mockUpdate).not.toHaveBeenCalled()
  })
})

// ─── processEvent tests ───────────────────────────────────────────────────────

describe('processEvent', () => {
  beforeEach(() => { vi.clearAllMocks() })

  const makeEvent = (overrides: Partial<EventLogRow> = {}): EventLogRow => ({
    ...makeRow(makeInput()),
    idempotency_key: 'org-1:run-1:action-1',
    ...overrides,
  })

  it('upserts action_execution_state on action_proposed', async () => {
    const { processEvent } = await import('../../events/event-processor.js')
    mockUpsert.mockResolvedValue({ error: null })
    await processEvent(makeEvent({ event_type: 'action_proposed' }))
    expect(mockUpsert).toHaveBeenCalledTimes(1)
  })

  it('updates status to started on action_execution_started', async () => {
    const { processEvent } = await import('../../events/event-processor.js')
    mockEq.mockReturnValue({ eq: mockEq.mockResolvedValue({ error: null }) })
    mockUpdate.mockReturnValue({ eq: mockEq })
    await processEvent(makeEvent({ event_type: 'action_execution_started' }))
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'started' }))
  })

  it('updates status to succeeded on action_execution_succeeded', async () => {
    const { processEvent } = await import('../../events/event-processor.js')
    mockUpdate.mockReturnValue({ eq: mockEq })
    mockEq.mockReturnValue({ eq: mockEq.mockResolvedValue({ error: null }) })
    await processEvent(makeEvent({ event_type: 'action_execution_succeeded' }))
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'succeeded' }))
  })

  it('handles unknown event type gracefully (no throw)', async () => {
    const { processEvent } = await import('../../events/event-processor.js')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(
      processEvent(makeEvent({ event_type: 'totally_unknown_type' as any }))
    ).resolves.not.toThrow()
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Unknown event type'))
    warnSpy.mockRestore()
  })

  it('does nothing (no DB call) for non-execution event types', async () => {
    const { processEvent } = await import('../../events/event-processor.js')
    await processEvent(makeEvent({ event_type: 'webhook_received', idempotency_key: null }))
    expect(mockUpdate).not.toHaveBeenCalled()
    expect(mockUpsert).not.toHaveBeenCalled()
  })
})
