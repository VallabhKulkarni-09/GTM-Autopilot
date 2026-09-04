/**
 * routing.types.ts
 * Input/output types for RoutingAgent v1.
 */

import type { Lead, Company, PolicyRule, RoutingState } from '../../domain/db-types.js'
import type { ProposedAction } from '../qualification/types.js'

export type SalesforceUser = {
  Id: string
  Name: string
  Email: string
  IsActive: boolean
}

export type RoutingInput = {
  lead: Lead
  company: Company | null
  qualificationResult: ProposedAction
  availableOwners: SalesforceUser[]
  ownerWorkloads: Record<string, number>   // { [sfUserId]: activePlayCount }
  territoryPolicyRules: PolicyRule[]        // rule_type = 'territory'
  routingState: RoutingState
}

export type RoutingParameters = {
  recommended_owner_id: string
  recommended_owner_name: string
  queue_name: string
  reason_codes: string[]
  round_robin_index?: number  // index used, for ActionExecutor to persist
}
