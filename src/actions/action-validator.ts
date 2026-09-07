import { ProposedAction, ValidationResult } from './types.js'
import { policyEngine } from '../policies/index.js'

export async function validateAction(
  action: ProposedAction,
  organizationId: string
): Promise<ValidationResult> {
  return await policyEngine.validateProposedAction(action, organizationId)
}
