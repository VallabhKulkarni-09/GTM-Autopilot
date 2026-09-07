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
  
  await app.invoke(initialState as any, { configurable: { thread_id: workflowRunId } })
  
  return { playInstanceId, status: 'running' }
}
