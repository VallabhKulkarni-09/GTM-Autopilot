<<<<<<< HEAD
=======
<<<<<<< HEAD
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
=======
>>>>>>> feat/langgraph-workflow
/**
 * index.ts — QualificationAgent v1
 * Rule-based. Zero LLM calls. Zero external API calls.
 * decision_risk_score: 0.0, raw_confidence: 1.0
 */

import { scoreIcp } from './rules.js'
import type { QualificationInput, ProposedAction } from './types.js'

export class QualificationAgent {
  readonly name = 'qualification-agent'
  readonly version = '1.0.0'

  /** Primary API — used by the rule-based v1 pipeline */
  run(input: QualificationInput): ProposedAction {
    const params = scoreIcp(input.lead, input.company)

    return {
      type: 'qualify_lead',
      parameters: params,
      decisionRiskScore: 0.0,   // rule-based = deterministic = no risk
      rawConfidence: 1.0,
    }
  }

  /** Async execute() alias — compatible with LangGraph node interface */
  async execute(input: QualificationInput, _context?: any): Promise<ProposedAction> {
    return this.run(input)
  }
}

export const qualificationAgent = new QualificationAgent()
<<<<<<< HEAD
=======
>>>>>>> feat/qualification-agent
>>>>>>> feat/langgraph-workflow
