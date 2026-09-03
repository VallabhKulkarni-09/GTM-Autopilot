/**
 * db-types.ts
 * TypeScript types generated from the GTM Autopilot database schema.
 * Source: db/migrations/001–013
 *
 * These are the canonical entity shapes used across the entire application.
 * Never manually define a type that should come from the schema.
 * Re-generate this file whenever migrations change.
 */

// ─── Enums ────────────────────────────────────────────────────────────────────

export type LeadStage =
  | 'new'
  | 'enriching'
  | 'routing'
  | 'in_sequence'
  | 'meeting_booked'
  | 'nurture'
  | 'lost'

export type ExternalProvider =
  | 'salesforce'
  | 'hubspot'
  | 'outreach'
  | 'clearbit'

export type ExternalEntityType = 'lead' | 'company'

export type EvidenceSourceType =
  | 'clearbit_person'
  | 'clearbit_company'
  | 'hubspot_contact'
  | 'salesforce_lead'
  | 'salesforce_contact'
  | 'intent_signal'
  | 'manual'

export type PolicyRuleType =
  | 'icp_filter'
  | 'territory'
  | 'sla'
  | 'dedup'
  | 'routing'

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical'

export type PlayStatus =
  | 'running'
  | 'completed'
  | 'failed'
  | 'paused'
  | 'nurture'
  | 'duplicate'

export type EventType =
  // Ingestion
  | 'webhook_received'
  | 'idempotency_check_passed'
  | 'idempotency_check_failed'
  // Enrichment
  | 'enrichment_requested'
  | 'enrichment_succeeded'
  | 'enrichment_failed'
  | 'enrichment_skipped'
  // Deduplication
  | 'dedup_passed'
  | 'dedup_rejected'
  // Agent decisions
  | 'action_proposed'
  | 'action_risk_assessed'
  | 'policy_validated'
  | 'policy_rejected'
  // Execution
  | 'action_execution_started'
  | 'action_execution_succeeded'
  | 'action_execution_failed'
  | 'action_execution_deduplicated'
  // SLA
  | 'sla_checked'
  | 'sla_breached'
  | 'escalation_triggered'
  | 'escalation_sent'
  // Human in the loop
  | 'human_review_requested'
  | 'human_approved'
  | 'human_rejected'
  // Play lifecycle
  | 'play_completed'
  | 'play_failed'
  | 'play_paused'
  | 'play_resumed'
  | 'play_marked_nurture'
  | 'play_marked_duplicate'

export type ActorType = 'agent' | 'human' | 'system' | 'sla_timer' | 'webhook'

export type EventStatus = 'success' | 'failed' | 'skipped'

export type ActionExecutionStatus =
  | 'proposed'
  | 'started'
  | 'succeeded'
  | 'failed'
  | 'deduplicated'

export type ConnectorName = 'salesforce' | 'hubspot' | 'outreach' | 'clearbit'

export type ConnectorHealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unknown'

// ─── Table Row Types ──────────────────────────────────────────────────────────

export type Organization = {
  id: string
  name: string
  slug: string
  domain: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export type Lead = {
  id: string
  organization_id: string
  email: string
  first_name: string | null
  last_name: string | null
  title: string | null
  phone: string | null
  company_id: string | null
  stage: LeadStage
  form_submitted_at: string       // ISO timestamp — SLA clock starts here
  source: string
  raw_payload: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

export type Company = {
  id: string
  organization_id: string
  name: string | null
  domain: string | null
  industry: string | null
  sub_industry: string | null
  employee_count: number | null
  employee_range: string | null
  annual_revenue: number | null   // USD cents
  country: string | null
  state: string | null
  city: string | null
  founded_year: number | null
  tech_stack: string[] | null
  funding_stage: string | null
  raw_clearbit: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

export type ExternalIdentity = {
  id: string
  organization_id: string
  entity_type: ExternalEntityType
  entity_id: string
  provider: ExternalProvider
  external_id: string
  metadata: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

export type Evidence = {
  id: string
  organization_id: string
  lead_id: string | null
  company_id: string | null
  source_type: EvidenceSourceType
  source_id: string | null
  data: Record<string, unknown>
  is_current: boolean
  collected_at: string
  expires_at: string | null
  created_at: string
  updated_at: string
}

export type PolicyRule = {
  id: string
  organization_id: string
  rule_type: PolicyRuleType
  name: string
  description: string | null
  version: number
  is_active: boolean
  priority: number
  conditions: Record<string, unknown>
  actions: Record<string, unknown> | null
  effective_from: string
  effective_until: string | null
  created_at: string
  updated_at: string
}

export type ActionRiskRegistry = {
  id: string
  organization_id: string
  action_type: string
  risk_level: RiskLevel
  max_risk_score: number          // 0.000 – 1.000
  requires_human_review: boolean
  required_policy_ids: string[] | null
  description: string | null
  created_at: string
  updated_at: string
}

export type PlayInstance = {
  id: string
  organization_id: string
  lead_id: string
  play_type: string
  status: PlayStatus
  workflow_run_id: string | null
  current_step: number
  first_touch_deadline: string    // form_submitted_at + sla_minutes
  first_touch_at: string | null
  sla_breached: boolean
  sla_breached_at: string | null
  assigned_owner_id: string | null
  assigned_owner_name: string | null
  sequence_id: string | null
  enrolled_at: string | null
  failure_reason: string | null
  created_at: string
  updated_at: string
}

/**
 * The decision_snapshot is stored on EVERY event_log row.
 * It captures the full state at the moment of the decision,
 * enabling exact replay and simulation.
 */
export type DecisionSnapshot = {
  lead: Lead
  company: Company | null
  policies: PolicyRule[]
  ownerWorkloads: Record<string, number>  // owner_id → active lead count
  evidenceIds: string[]
  agentName: string
  agentVersion: string
  promptVersion: string | null            // null for rule-based agents
  modelName: string | null                // null for rule-based agents
}

export type EventLog = {
  id: string
  organization_id: string
  workflow_run_id: string | null
  play_instance_id: string | null
  lead_id: string | null
  event_type: EventType
  actor_type: ActorType
  actor_id: string | null
  agent_version: string | null
  model_provider: string | null
  model_name: string | null
  prompt_version: string | null
  decision_snapshot: DecisionSnapshot     // NEVER null
  proposed_action: Record<string, unknown> | null
  candidate_actions: Record<string, unknown>[] | null
  policy_rule_id: string | null
  policy_name: string | null
  policy_passed: boolean | null
  policy_decision: Record<string, unknown> | null
  external_system: string | null
  external_id: string | null
  idempotency_key: string | null
  event_status: EventStatus
  error_code: string | null
  error_message: string | null
  error_raw: Record<string, unknown> | null
  duration_ms: number | null
  occurred_at: string
  created_at: string
  // NO updated_at — this table is immutable
}

export type ActionExecutionState = {
  id: string
  organization_id: string
  idempotency_key: string
  play_instance_id: string | null
  lead_id: string | null
  action_type: string
  status: ActionExecutionStatus
  proposed_at: string | null
  started_at: string | null
  completed_at: string | null
  external_system: string | null
  external_id: string | null
  error_code: string | null
  error_message: string | null
  agent_name: string | null
  agent_version: string | null
  created_at: string
  updated_at: string
}

export type ConnectorConfig = {
  id: string
  organization_id: string
  connector_name: ConnectorName
  is_active: boolean
  credentials_vault_key: string
  config: Record<string, unknown> | null
  last_health_check_at: string | null
  health_status: ConnectorHealthStatus
  health_latency_ms: number | null
  health_error: string | null
  created_at: string
  updated_at: string
}

export type RoutingState = {
  id: string
  organization_id: string
  queue_name: string
  counter: number
  last_assigned_owner_id: string | null
  last_assigned_at: string | null
  created_at: string
  updated_at: string
}

// ─── Insert Types (omit DB-generated fields) ─────────────────────────────────

export type InsertOrganization = Omit<Organization, 'id' | 'created_at' | 'updated_at'>
export type InsertLead = Omit<Lead, 'id' | 'created_at' | 'updated_at'>
export type InsertCompany = Omit<Company, 'id' | 'created_at' | 'updated_at'>
export type InsertExternalIdentity = Omit<ExternalIdentity, 'id' | 'created_at' | 'updated_at'>
export type InsertEvidence = Omit<Evidence, 'id' | 'created_at' | 'updated_at'>
export type InsertPolicyRule = Omit<PolicyRule, 'id' | 'created_at' | 'updated_at'>
export type InsertActionRiskRegistry = Omit<ActionRiskRegistry, 'id' | 'created_at' | 'updated_at'>
export type InsertPlayInstance = Omit<PlayInstance, 'id' | 'created_at' | 'updated_at'>
export type InsertEventLog = Omit<EventLog, 'id' | 'occurred_at' | 'created_at'>   // no updated_at to omit
export type InsertActionExecutionState = Omit<ActionExecutionState, 'id' | 'created_at' | 'updated_at'>
export type InsertConnectorConfig = Omit<ConnectorConfig, 'id' | 'created_at' | 'updated_at'>
export type InsertRoutingState = Omit<RoutingState, 'id' | 'created_at' | 'updated_at'>

// ─── Update Types (all fields optional except ID) ────────────────────────────

export type UpdateLead = Partial<Omit<Lead, 'id' | 'organization_id' | 'created_at'>>
export type UpdateCompany = Partial<Omit<Company, 'id' | 'organization_id' | 'created_at'>>
export type UpdatePlayInstance = Partial<Omit<PlayInstance, 'id' | 'organization_id' | 'lead_id' | 'created_at'>>
export type UpdateActionExecutionState = Partial<Omit<ActionExecutionState, 'id' | 'organization_id' | 'idempotency_key' | 'created_at'>>
export type UpdateConnectorConfig = Partial<Omit<ConnectorConfig, 'id' | 'organization_id' | 'connector_name' | 'created_at'>>
export type UpdateRoutingState = Partial<Omit<RoutingState, 'id' | 'organization_id' | 'queue_name' | 'created_at'>>
