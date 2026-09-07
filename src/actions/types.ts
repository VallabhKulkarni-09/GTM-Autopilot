/**
 * types.ts — Shared types for the action layer.
 * ProposedAction extends the minimal type from qualification/types.ts with
 * the full fields required by the ActionExecutor (actionId, target, etc).
 */

import type { ConnectorName, DecisionSnapshot, RiskLevel, ActionRiskRegistry } from '../domain/db-types.js'

export type { ConnectorName, DecisionSnapshot }

export type ActionType =
  | 'qualify_lead'
  | 'assign_owner'
  | 'start_sequence'
  | 'mark_nurture'
  | 'mark_duplicate'
  | 'request_human_review'
  | 'escalate'

export type ProposedAction = {
  actionId: string                      // UUID
  type: ActionType
  target: {
    leadId: string
    organizationId: string
  }
  rationale: {
    reasonCodes: string[]               // SCREAMING_SNAKE_CASE
    evidenceIds: string[]
  }
  decisionRiskScore: number             // 0.0 – 1.0
  rawConfidence: number                 // 0.0 – 1.0
  parameters: Record<string, unknown>
  idempotencyKey: string               // organizationId:workflowRunId:actionId
  constraints: {
    requiredPolicyIds: string[]
  }
}

export type ActionExecutionResult = {
  success: boolean
  externalSystem?: ConnectorName
  externalId?: string
  output?: Record<string, unknown>
  error?: ConnectorError
}

export class ConnectorError extends Error {
  constructor(
    public readonly source: ConnectorName,
    public readonly code: string,
    public readonly statusCode: number,
    public readonly raw: unknown,
    message: string
  ) {
    super(message)
    this.name = 'ConnectorError'
  }
}

export type ValidationResult = {
  approved: boolean
  riskLevel: RiskLevel | 'unknown'
  requiresHumanApproval: boolean
  appliedRegistryEntry: ActionRiskRegistry | null
  reason: string
}
