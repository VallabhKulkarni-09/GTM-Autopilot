/**
 * rules.ts — RoutingAgent v1 routing logic.
 * ZERO LLM calls. Priority order is enforced: territory → filter → workload → round-robin.
 */

import type { PolicyRule, RoutingState } from '../../domain/db-types.js'
import type { SalesforceUser, RoutingInput, RoutingParameters } from './types.js'

const MAX_OWNER_WORKLOAD = 25  // owners at or above this are excluded

type TerritoryMatch = {
  queueName: string
  ownerIds: string[] | null  // null = all owners
}

/**
 * Evaluate territory rules against the lead/company and return
 * the matching queue name + owner filter (if any).
 * Returns null when no territory rule matches.
 */
function evaluateTerritoryRules(
  input: RoutingInput
): TerritoryMatch | null {
  const country = ((input.company?.country ?? (input.lead as any)?.country) ?? '').toUpperCase().trim()

  for (const rule of input.territoryPolicyRules) {
    const cond = rule.condition as any
    if (!cond) continue

    // Simple territory match: condition.field = 'country', operator = 'in'
    if (cond.field === 'country' && cond.operator === 'in') {
      const values = (cond.values ?? []).map((v: string) => v.toUpperCase())
      if (values.includes(country) || values.includes('*')) {
        return {
          queueName: (rule.parameters as any)?.queue_name ?? 'default',
          ownerIds: (rule.parameters as any)?.owner_ids ?? null,
        }
      }
    }

    // Wildcard / catch-all
    if (cond.operator === 'wildcard' || cond.operator === 'all') {
      return {
        queueName: (rule.parameters as any)?.queue_name ?? 'default',
        ownerIds: null,
      }
    }
  }

  return null
}

/**
 * Main routing logic — must be called in this exact priority order.
 */
export function computeRouting(input: RoutingInput): RoutingParameters | null {
  // Step 1: Territory evaluation
  const territory = evaluateTerritoryRules(input)
  if (!territory) {
    return null  // no match → caller returns 'request_human_review'
  }

  const { queueName, ownerIds } = territory

  // Step 2: Filter to owners that match the territory queue
  let eligible = input.availableOwners.filter(o => {
    if (!o.IsActive) return false
    if (ownerIds !== null) return ownerIds.includes(o.Id)
    return true
  })

  // Step 3: Filter out owners at max workload
  eligible = eligible.filter(o => (input.ownerWorkloads[o.Id] ?? 0) < MAX_OWNER_WORKLOAD)

  // Step 4: All at capacity
  if (eligible.length === 0) {
    return null  // caller returns 'request_human_review'
  }

  // Step 5: Sort by workload (ascending)
  eligible.sort((a, b) => (input.ownerWorkloads[a.Id] ?? 0) - (input.ownerWorkloads[b.Id] ?? 0))

  // Step 6: Tie-break with round-robin when multiple have equal minimum workload
  const minLoad = input.ownerWorkloads[eligible[0].Id] ?? 0
  const tied = eligible.filter(o => (input.ownerWorkloads[o.Id] ?? 0) === minLoad)

  const currentIndex = input.routingState.current_index ?? 0
  const roundRobinIndex = currentIndex % tied.length
  const selected = tied[roundRobinIndex]

  const reasonCodes: string[] = [
    `TERRITORY_${queueName.toUpperCase().replace(/-/g, '_')}`,
  ]
  if (tied.length > 1) {
    reasonCodes.push('ROUND_ROBIN_SELECTED')
  } else {
    reasonCodes.push('LOWEST_WORKLOAD_SELECTED')
  }

  return {
    recommended_owner_id: selected.Id,
    recommended_owner_name: selected.Name,
    queue_name: queueName,
    reason_codes: reasonCodes,
    round_robin_index: roundRobinIndex,
  }
}
