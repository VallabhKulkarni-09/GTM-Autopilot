import { ActionType } from './action-registry.js'

export type ProposedAction = {
  actionId: string
  type: ActionType
  target: { leadId: string; organizationId: string }
  rationale: { reasonCodes: string[]; evidenceIds: string[] }
  decisionRiskScore: number
  rawConfidence: number
  parameters: Record<string, any>
  idempotencyKey: string
  constraints: { requiredPolicyIds: string[] }
}

export type ValidationResult = {
  isValid: boolean
  rejectedBy?: string[]
  reasons?: string[]
}
