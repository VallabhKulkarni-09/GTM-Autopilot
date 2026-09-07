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

  run(input: QualificationInput): ProposedAction {
    const params = scoreIcp(input.lead, input.company)

    return {
      type: 'qualify_lead',
      parameters: params,
      decisionRiskScore: 0.0,   // rule-based = deterministic = no risk
      rawConfidence: 1.0,
    }
  }
}

export const qualificationAgent = new QualificationAgent()
