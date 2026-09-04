/**
 * index.ts — RoutingAgent v1
 * Rule-based. Zero LLM calls.
 * When no territory matches or all owners at capacity → returns 'request_human_review'.
 */

import { computeRouting } from './rules.js'
import type { RoutingInput, ProposedAction } from '../qualification/types.js'

export class RoutingAgent {
  readonly name = 'routing-agent'
  readonly version = '1.0.0'

  run(input: import('./types.js').RoutingInput): ProposedAction {
    const result = computeRouting(input)

    // No territory match OR all owners at capacity → escalate to human
    if (!result) {
      return {
        type: 'request_human_review',
        parameters: {
          queue_name: 'unassigned',
          reason_codes: input.availableOwners.length === 0
            ? ['OWNER_LIST_EMPTY']
            : ['NO_TERRITORY_MATCH_OR_ALL_AT_CAPACITY'],
        },
        decisionRiskScore: 0.0,
        rawConfidence: 1.0,
      }
    }

    return {
      type: 'assign_owner',
      parameters: result,
      decisionRiskScore: 0.0,
      rawConfidence: 1.0,
    }
  }
}

export const routingAgent = new RoutingAgent()
