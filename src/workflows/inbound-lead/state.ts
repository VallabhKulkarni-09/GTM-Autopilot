import { Lead, Company, Evidence } from '../../domain/db-types.js'
import { ProposedAction } from '../../agents/types.js'

export type WorkflowState = {
  organizationId: string
  workflowRunId: string
  leadId: string
  playInstanceId: string
  lead: Lead
  company: Company | null
  evidence: Evidence[]
  qualificationResult: ProposedAction | null
  routingResult: ProposedAction | null
  currentStep: string
  error: string | null
}
