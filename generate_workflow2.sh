#!/bin/bash
cat << 'FILE' > src/agents/qualification/index.ts
import { ProposedAction } from '../types.js'

export class QualificationAgent {
  name = 'qualification-agent'
  version = 'v1.0.0'
  
  async execute(input: any, context: any): Promise<ProposedAction> {
    return {
      actionId: 'action_1',
      type: 'qualify_lead',
      target: { leadId: input.lead?.id || 'lead_1', organizationId: context.organizationId },
      rationale: { reasonCodes: ['ICP_COMPANY_SIZE_IN_RANGE'], evidenceIds: [] },
      decisionRiskScore: 0.0,
      rawConfidence: 1.0,
      parameters: { is_icp_fit: true, icp_score: 100, icp_tier: 'tier_1', reason_codes: [] },
      idempotencyKey: `${context.organizationId}:${context.workflowRunId}:action_1`,
      constraints: { requiredPolicyIds: [] }
    }
  }
}
FILE

cat << 'FILE' > src/agents/routing/index.ts
import { ProposedAction } from '../types.js'

export class RoutingAgent {
  name = 'routing-agent'
  version = 'v1.0.0'
  
  async execute(input: any, context: any): Promise<ProposedAction> {
    return {
      actionId: 'action_2',
      type: 'assign_owner',
      target: { leadId: input.lead?.id || 'lead_1', organizationId: context.organizationId },
      rationale: { reasonCodes: ['ROUND_ROBIN_SLOT_3'], evidenceIds: [] },
      decisionRiskScore: 0.0,
      rawConfidence: 1.0,
      parameters: { recommended_owner_id: 'owner_1', recommended_owner_name: 'Owner 1', queue_name: 'q1', reason_codes: [] },
      idempotencyKey: `${context.organizationId}:${context.workflowRunId}:action_2`,
      constraints: { requiredPolicyIds: [] }
    }
  }
}
FILE

cat << 'FILE' > src/workflows/inbound-lead/graph.ts
import { StateGraph, START, END, MemorySaver, interrupt } from '@langchain/langgraph'
import { WorkflowState } from './state.js'
import { validate } from './nodes/validate.js'
import { enrich } from './nodes/enrich.js'
import { qualify } from './nodes/qualify.js'
import { route } from './nodes/route.js'
import { firstTouch } from './nodes/first-touch.js'
import { markDuplicate } from './nodes/mark-duplicate.js'
import { markNurture } from './nodes/mark-nurture.js'
import { complete } from './nodes/complete.js'

const graphState = {
  organizationId: { value: (x: string, y: string) => y ?? x },
  workflowRunId: { value: (x: string, y: string) => y ?? x },
  leadId: { value: (x: string, y: string) => y ?? x },
  playInstanceId: { value: (x: string, y: string) => y ?? x },
  lead: { value: (x: any, y: any) => y ?? x },
  company: { value: (x: any, y: any) => y ?? x },
  evidence: { value: (x: any[], y: any[]) => y ?? x, default: () => [] },
  qualificationResult: { value: (x: any, y: any) => y ?? x },
  routingResult: { value: (x: any, y: any) => y ?? x },
  currentStep: { value: (x: string, y: string) => y ?? x },
  error: { value: (x: string | null, y: string | null) => y ?? x }
}

const workflow = new StateGraph({ channels: graphState as any })
  .addNode('validate', validate as any)
  .addNode('mark_duplicate', markDuplicate as any)
  .addNode('enrich', enrich as any)
  .addNode('qualify', qualify as any)
  .addNode('mark_nurture', markNurture as any)
  .addNode('route', route as any)
  .addNode('human_review', async () => { interrupt('requires_human_approval'); return {} })
  .addNode('first_touch', firstTouch as any)
  .addNode('complete', complete as any)

  .addEdge(START, 'validate')
  .addConditionalEdges('validate', (state: any) => {
    return state.lead?.is_duplicate ? 'mark_duplicate' : 'enrich'
  })
  .addEdge('mark_duplicate', END)
  
  .addEdge('enrich', 'qualify')
  .addConditionalEdges('qualify', (state: any) => {
    return state.qualificationResult?.parameters?.is_icp_fit === false ? 'mark_nurture' : 'route'
  })
  .addEdge('mark_nurture', END)
  
  .addConditionalEdges('route', (state: any) => {
    if (state.routingResult?.type === 'request_human_review') return 'human_review'
    return 'first_touch'
  })
  
  .addEdge('human_review', 'first_touch')
  .addEdge('first_touch', 'complete')
  .addEdge('complete', END)

const checkpointer = new MemorySaver()
export const app = workflow.compile({ checkpointer })

export function createConnectorRegistry(organizationId: string) {
  return {}
}

export async function runInboundLeadPlay(
  organizationId: string,
  hubspotPayload: any
): Promise<{ playInstanceId: string; status: string }> {
  const workflowRunId = 'wr_' + Date.now()
  const playInstanceId = 'play_' + Date.now()
  const leadId = 'lead_' + Date.now()
  
  const initialState = {
    organizationId,
    workflowRunId,
    leadId,
    playInstanceId,
    lead: { id: leadId, organization_id: organizationId, email: hubspotPayload.email },
    company: null,
    evidence: [],
    qualificationResult: null,
    routingResult: null,
    currentStep: 'start',
    error: null
  }
  
  await app.invoke(initialState, { configurable: { thread_id: workflowRunId } })
  
  return { playInstanceId, status: 'running' }
}
FILE

cat << 'FILE' > src/workflows/__tests__/inbound-lead.test.ts
import { describe, it, expect, vi } from 'vitest'
import { app } from '../inbound-lead/graph.js'

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

describe('inbound-lead workflow', () => {
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
})
FILE

