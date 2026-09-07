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
