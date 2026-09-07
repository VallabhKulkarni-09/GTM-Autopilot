export type LeadStage = 'new' | 'enriching' | 'routing' | 'in_sequence' | 'meeting_booked' | 'nurture' | 'lost'

export interface OverviewMetrics {
  currentPeriod: {
    touchedUnder15MinPct: number;
    avgFirstTouchMin: number;
    slaBreaches: number;
    activePlays: number;
    meetingsBooked: number;
    totalQualified: number;
  };
  priorPeriod: {
    touchedUnder15MinPct: number;
    meetingsBooked: number;
    totalQualified: number;
  };
}

export interface SpeedToLeadDistribution {
  buckets: {
    under5: { count: number; pct: number };
    under15: { count: number; pct: number };
    under30: { count: number; pct: number };
    under60: { count: number; pct: number };
    over60: { count: number; pct: number };
  };
  sdrStats: {
    name: string;
    medianFirstTouchMin: number;
    under15MinPct: number;
    meetingsBooked: number;
  }[];
}

export interface Lead {
  id: string;
  company: string;
  name: string;
  title: string;
  stage: LeadStage;
  timeToFirstTouchMin: number | null;
  assignedTo: string | null;
  formSubmittedAt: string;
}

export interface PaginatedLeads {
  data: Lead[];
  total: number;
  page: number;
  limit: number;
}

export type EventType = 
  | 'webhook_received'
  | 'enrichment_requested'
  | 'enrichment_succeeded'
  | 'enrichment_failed'
  | 'dedup_passed'
  | 'dedup_rejected'
  | 'action_proposed'
  | 'policy_validated'
  | 'policy_rejected'
  | 'action_execution_started'
  | 'action_execution_succeeded'
  | 'action_execution_failed'
  | 'sla_breached'
  | 'escalation_triggered'
  | 'escalation_sent'
  | 'human_review_requested'
  | 'human_approved'
  | 'human_rejected'
  | 'play_completed'
  | 'play_marked_nurture'
  | 'play_marked_duplicate';

export interface TimelineEvent {
  id: string;
  timestamp: string;
  event_type: EventType;
  actor: string;
  decision_risk_score?: number;
  reason_codes?: string[];
  policy_name?: string;
  policy_passed?: boolean;
  error_code?: string;
  external_confirmation?: string;
}

export interface ConnectorHealth {
  name: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  lastChecked: string;
}

export interface PolicyRule {
  id: string;
  rule_type: string;
  name: string;
  conditions_summary: string;
  queue_assigned?: string;
  sla_minutes?: number;
}
