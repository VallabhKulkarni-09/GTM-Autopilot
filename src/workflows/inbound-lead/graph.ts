/**
 * graph.ts — LangGraph StateGraph for the inbound-lead play.
 *
 * Node order:
 *   validate → [mark_duplicate | enrich]
 *   enrich   → account_match
 *   account_match → [first_touch (bypass qual for active deals) | qualify]
 *   qualify  → [mark_nurture | route]
 *   route    → [human_review | first_touch]
 *   first_touch → complete
 */

import { StateGraph, START, END, MemorySaver, interrupt } from '@langchain/langgraph'
import { WorkflowState } from './state.js'
import { validate }      from './nodes/validate.js'
import { enrich }        from './nodes/enrich.js'
import { accountMatch }  from './nodes/account-match.js'
import { qualify }       from './nodes/qualify.js'
import { route }         from './nodes/route.js'
import { firstTouch }    from './nodes/first-touch.js'
import { markDuplicate } from './nodes/mark-duplicate.js'
import { markNurture }   from './nodes/mark-nurture.js'
import { complete }      from './nodes/complete.js'

// ─── Graph State Definition ────────────────────────────────────────────────────

const graphState = {
  organizationId:       { value: (x: string, y: string) => y ?? x },
  workflowRunId:        { value: (x: string, y: string) => y ?? x },
  leadId:               { value: (x: string, y: string) => y ?? x },
  playInstanceId:       { value: (x: string, y: string) => y ?? x },
  lead:                 { value: (x: any, y: any) => y ?? x },
  company:              { value: (x: any, y: any) => y ?? x },
  evidence:             { value: (x: any[], y: any[]) => y ?? x, default: () => [] },
  qualificationResult:  { value: (x: any, y: any) => y ?? x },
  routingResult:        { value: (x: any, y: any) => y ?? x },
  currentStep:          { value: (x: string, y: string) => y ?? x },
  error:                { value: (x: string | null, y: string | null) => y ?? x },
}

// ─── Graph Definition ──────────────────────────────────────────────────────────

const workflow = new StateGraph({ channels: graphState as any })
  .addNode('validate',       validate as any)
  .addNode('mark_duplicate', markDuplicate as any)
  .addNode('enrich',         enrich as any)
  .addNode('account_match',  accountMatch as any)
  .addNode('qualify',        qualify as any)
  .addNode('mark_nurture',   markNurture as any)
  .addNode('route',          route as any)
  .addNode('human_review',   async () => { interrupt('requires_human_approval'); return {} })
  .addNode('first_touch',    firstTouch as any)
  .addNode('complete',       complete as any)

  // validate → mark_duplicate (if dup) | enrich (net-new)
  .addEdge(START, 'validate')
  .addConditionalEdges('validate', (state: any) => {
    return state.lead?.is_duplicate ? 'mark_duplicate' : 'enrich'
  })
  .addEdge('mark_duplicate', END)

  // enrich → account_match (always)
  .addEdge('enrich', 'account_match')

  // account_match → first_touch (bypass: active deal found)
  //              → qualify (net-new or account-only match)
  .addConditionalEdges('account_match', (state: any) => {
    if (state.routingResult?._bypassQualification === true) {
      return 'first_touch'   // active deal: skip SDR qualification entirely
    }
    return 'qualify'
  })

  // qualify → mark_nurture (not ICP) | route (ICP fit)
  .addConditionalEdges('qualify', (state: any) => {
    return state.qualificationResult?.parameters?.is_icp_fit === false
      ? 'mark_nurture'
      : 'route'
  })
  .addEdge('mark_nurture', END)

  // route → human_review | first_touch
  .addConditionalEdges('route', (state: any) => {
    if (state.routingResult?.type === 'request_human_review') return 'human_review'
    return 'first_touch'
  })

  .addEdge('human_review', 'first_touch')
  .addEdge('first_touch',  'complete')
  .addEdge('complete',     END)

const checkpointer = new MemorySaver()
export const app = workflow.compile({ checkpointer })

// ─── Connector Registry ────────────────────────────────────────────────────────

/**
 * createConnectorRegistry — loads real connector instances per org.
 * Connectors are initialized lazily; nodes that need them call this.
 * Currently returns a lightweight registry shape; connectors connect
 * on first use via their own connect() methods inside the nodes.
 */
export function createConnectorRegistry(_organizationId: string) {
  // Connectors are instantiated inside individual nodes (enrich, first-touch)
  // because they need org-specific credentials loaded from connector_config.
  // This registry can be extended to pass pre-connected instances in v2.
  return {}
}

// ─── Entry Point ──────────────────────────────────────────────────────────────

/**
 * runInboundLeadPlay
 *
 * Called by the BullMQ worker after creating the lead and play_instance.
 * The worker passes _leadId, _playInstanceId, and _workflowRunId in the payload
 * so the graph uses real DB UUIDs — never synthetic generated IDs.
 */
export async function runInboundLeadPlay(
  organizationId: string,
  hubspotPayload: any
): Promise<{ playInstanceId: string; status: string }> {
  // Use real IDs created by the worker — never generate new ones here
  const leadId         = hubspotPayload._leadId        as string
  const playInstanceId = hubspotPayload._playInstanceId as string
  const workflowRunId  = hubspotPayload._workflowRunId  as string

  if (!leadId || !playInstanceId || !workflowRunId) {
    throw new Error(
      '[graph] runInboundLeadPlay requires _leadId, _playInstanceId, and _workflowRunId ' +
      'in hubspotPayload. These must be the UUIDs created by inbound-lead.worker.ts.'
    )
  }

  const properties = hubspotPayload.properties ?? {}

  const initialState = {
    organizationId,
    workflowRunId,
    leadId,
    playInstanceId,
    lead: {
      id:              leadId,
      organization_id: organizationId,
      email:           properties.email ?? hubspotPayload.email ?? '',
      first_name:      properties.firstname ?? null,
      last_name:       properties.lastname ?? null,
      title:           properties.jobtitle ?? null,
      phone:           properties.phone ?? null,
      stage:           'new',
      form_submitted_at: hubspotPayload.occurredAt
        ? new Date(hubspotPayload.occurredAt).toISOString()
        : new Date().toISOString(),
      source:          `hubspot:${hubspotPayload.subscriptionType ?? 'form'}`,
      raw_payload:     hubspotPayload,
      is_duplicate:    false,
      is_icp_fit:      null,
      icp_score:       null,
      icp_tier:        null,
      created_at:      new Date().toISOString(),
      updated_at:      new Date().toISOString(),
    },
    company:             null,
    evidence:            [],
    qualificationResult: null,
    routingResult:       null,
    currentStep:         'start',
    error:               null,
  }

  await app.invoke(initialState as any, { configurable: { thread_id: workflowRunId } })

  return { playInstanceId, status: 'running' }
}
