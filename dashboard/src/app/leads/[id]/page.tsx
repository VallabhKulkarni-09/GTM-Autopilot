import { apiFetch } from '@/lib/api'
import { getServerToken } from '@/lib/auth'
import { Lead, TimelineEvent } from '@/types/api'
import Link from 'next/link'
import { ArrowLeft, Clock, User, Zap, AlertTriangle, CheckCircle2, XCircle, Info, ExternalLink } from 'lucide-react'

export const dynamic = 'force-dynamic'

// ── Event config ────────────────────────────────────────────────────────────

const EVENT_CONFIG: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  webhook_received:           { label: 'Form submission received',   color: 'bg-blue-500',    icon: Info },
  enrichment_requested:       { label: 'Enrichment started',         color: 'bg-blue-400',    icon: Info },
  enrichment_succeeded:       { label: 'Enrichment complete',        color: 'bg-blue-500',    icon: CheckCircle2 },
  enrichment_failed:          { label: 'Enrichment failed',          color: 'bg-amber-400',   icon: AlertTriangle },
  enrichment_skipped:         { label: 'Enrichment skipped',         color: 'bg-gray-300',    icon: Info },
  dedup_passed:               { label: 'Not a duplicate',            color: 'bg-emerald-500', icon: CheckCircle2 },
  dedup_rejected:             { label: 'Duplicate detected',         color: 'bg-red-500',     icon: XCircle },
  action_proposed:            { label: 'Agent decision',             color: 'bg-violet-500',  icon: Zap },
  action_execution_started:   { label: 'Action started',             color: 'bg-blue-400',    icon: Info },
  action_execution_succeeded: { label: 'Action completed',           color: 'bg-emerald-500', icon: CheckCircle2 },
  action_execution_failed:    { label: 'Action failed',              color: 'bg-red-500',     icon: XCircle },
  sla_breached:               { label: 'SLA deadline missed',        color: 'bg-red-600',     icon: AlertTriangle },
  play_completed:             { label: 'Play completed',             color: 'bg-emerald-600', icon: CheckCircle2 },
  play_marked_nurture:        { label: 'Moved to nurture',           color: 'bg-amber-500',   icon: Info },
  play_marked_duplicate:      { label: 'Marked as duplicate',        color: 'bg-gray-400',    icon: XCircle },
  human_review_requested:     { label: 'Paused for human review',    color: 'bg-amber-500',   icon: User },
  human_approved:             { label: 'Approved by reviewer',       color: 'bg-emerald-500', icon: CheckCircle2 },
}

function getEventConfig(type: string) {
  return EVENT_CONFIG[type] ?? { label: type.replace(/_/g, ' '), color: 'bg-gray-400', icon: Info }
}

// ── Human-readable reason codes ──────────────────────────────────────────────

const REASON_LABELS: Record<string, string> = {
  ENRICHMENT_MISSING_COMPANY_SIZE:    'Missing: company size',
  ENRICHMENT_MISSING_INDUSTRY:        'Missing: industry',
  ENRICHMENT_MISSING_REGION:          'Missing: region',
  NOT_ICP_SCORE_TOO_LOW:              'ICP score too low',
  NOT_ICP_FIT:                        'Not an ICP fit',
  DISQUALIFIED_FREE_EMAIL_PROVIDER:   'Free email domain',
  DISQUALIFIED_TOO_SMALL:             'Company too small',
  TERRITORY_MATCH:                    'Territory match',
  ROUND_ROBIN_SELECTED:               'Round-robin assignment',
  OWNER_LIST_EMPTY:                   'No owners available',
  NO_TERRITORY_MATCH_OR_ALL_AT_CAPACITY: 'No owner available for territory',
}

function humanReason(code: string): string {
  return REASON_LABELS[code] ?? code.toLowerCase().replace(/_/g, ' ')
}

// ── Stage config ─────────────────────────────────────────────────────────────

const STAGE_CONFIG: Record<string, { label: string; className: string }> = {
  new:            { label: 'New',            className: 'bg-gray-100 text-gray-600' },
  enriching:      { label: 'Enriching',      className: 'bg-blue-50 text-blue-700' },
  routing:        { label: 'Routing',        className: 'bg-violet-50 text-violet-700' },
  in_sequence:    { label: 'In Sequence',    className: 'bg-emerald-50 text-emerald-700' },
  meeting_booked: { label: 'Meeting Booked', className: 'bg-teal-50 text-teal-700' },
  nurture:        { label: 'Nurture',        className: 'bg-amber-50 text-amber-700' },
  lost:           { label: 'Lost',           className: 'bg-red-50 text-red-600' },
}

function getAvatarColor(name: string): string {
  const colors = ['bg-blue-500', 'bg-violet-500', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500']
  let h = 0
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h)
  return colors[Math.abs(h) % colors.length]
}
function getInitials(name: string) {
  return name.split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase()
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1)  return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)  return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function timeDiff(a: string, b: string): string {
  const diff = Math.abs(new Date(b).getTime() - new Date(a).getTime())
  if (diff < 1000) return '< 1s later'
  if (diff < 60000) return `${Math.round(diff / 1000)}s later`
  return `${Math.round(diff / 60000)}m later`
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let lead: Lead
  let timeline: TimelineEvent[]

  try {
    const token = getServerToken()
    const [leadRes, timelineRes] = await Promise.all([
      apiFetch(`/api/leads/${id}`, token),
      apiFetch(`/api/leads/${id}/timeline`, token),
    ])

    if (!leadRes.ok || !timelineRes.ok) throw new Error('Failed to fetch')

    const { lead: leadData } = await leadRes.json()
    lead = leadData

    const rawTimeline: any[] = await timelineRes.json()
    timeline = rawTimeline.map(e => ({
      id: e.id,
      timestamp: e.occurred_at,
      event_type: e.event_type,
      actor: e.actor_type === 'webhook'
        ? 'HubSpot'
        : e.actor_type === 'agent'
          ? (e.actor_id ?? 'Agent')
          : (e.actor_type ?? 'System'),
      decision_risk_score: e.proposed_action?.decisionRiskScore ?? undefined,
      reason_codes: e.proposed_action?.rationale?.reasonCodes ?? undefined,
      policy_name: e.policy_name ?? undefined,
      policy_passed: e.policy_passed ?? undefined,
      error_code: e.error_code ?? undefined,
      external_confirmation: e.external_id
        ? `${e.external_system}: ${e.external_id}`
        : undefined,
    }))
  } catch {
    lead = {
      id, company: 'Acme Corp', name: 'John Doe', title: 'CEO',
      stage: 'in_sequence', timeToFirstTouchMin: 12, assignedTo: 'Alice',
      formSubmittedAt: new Date(Date.now() - 3600000).toISOString(),
    }
    timeline = [
      { id: '1', timestamp: new Date(Date.now() - 3600000).toISOString(), event_type: 'webhook_received', actor: 'HubSpot' },
      { id: '2', timestamp: new Date(Date.now() - 3590000).toISOString(), event_type: 'dedup_passed', actor: 'System' },
      { id: '3', timestamp: new Date(Date.now() - 3585000).toISOString(), event_type: 'enrichment_succeeded', actor: 'Clearbit' },
      { id: '4', timestamp: new Date(Date.now() - 3580000).toISOString(), event_type: 'action_proposed', actor: 'QualificationAgent', reason_codes: ['TERRITORY_MATCH'] },
      { id: '5', timestamp: new Date(Date.now() - 3570000).toISOString(), event_type: 'action_execution_succeeded', actor: 'System', external_confirmation: 'salesforce: SF123' },
    ]
  }

  const sorted = [...timeline].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
  const stageConf = STAGE_CONFIG[lead.stage] || { label: lead.stage, className: 'bg-gray-100 text-gray-600' }
  const displayName = lead.name || (lead as any).email || 'Unknown'

  return (
    <div className="flex flex-col gap-6">
      {/* Back */}
      <Link href="/leads" className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-700 transition-colors w-fit">
        <ArrowLeft className="w-4 h-4" />
        Leads
      </Link>

      {/* Two-column layout on wide screens */}
      <div className="flex flex-col lg:flex-row gap-6 items-start">

        {/* ── Left: Lead header + Timeline (60%) ── */}
        <div className="flex-1 min-w-0 flex flex-col gap-6">

          {/* Lead header card */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className={`w-14 h-14 rounded-2xl ${getAvatarColor(displayName)} flex items-center justify-center flex-shrink-0`}>
                  <span className="text-xl font-bold text-white">{getInitials(displayName)}</span>
                </div>
                <div>
                  <h1 className="text-xl font-bold text-gray-900">{displayName}</h1>
                  <div className="text-sm text-gray-500 mt-0.5">{lead.title || '—'}</div>
                  {(lead as any).email && (
                    <div className="text-xs text-gray-400 mt-0.5">{(lead as any).email}</div>
                  )}
                </div>
              </div>
              <span className={`px-3 py-1 rounded-full text-xs font-semibold flex-shrink-0 ${stageConf.className}`}>
                {stageConf.label}
              </span>
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-3 gap-4 mt-5 pt-5 border-t border-gray-50">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Submitted</div>
                <div className="text-sm font-medium text-gray-900 mt-0.5">{relativeTime(lead.formSubmittedAt)}</div>
              </div>
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">First Touch</div>
                <div className={`text-sm font-medium mt-0.5 ${lead.timeToFirstTouchMin !== null && lead.timeToFirstTouchMin <= 15 ? 'text-emerald-600' : lead.timeToFirstTouchMin !== null ? 'text-red-500' : 'text-gray-400'}`}>
                  {lead.timeToFirstTouchMin !== null ? `${lead.timeToFirstTouchMin} min` : '—'}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Assigned To</div>
                <div className="text-sm font-medium text-gray-900 mt-0.5">{lead.assignedTo || '—'}</div>
              </div>
            </div>
          </div>

          {/* Timeline */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-400 mb-6">Decision Timeline</h2>

            <div className="relative">
              {/* Vertical line */}
              <div className="absolute left-[15px] top-0 bottom-0 w-px bg-gray-100" />

              <div className="space-y-1">
                {sorted.map((event, index) => {
                  const conf = getEventConfig(event.event_type)
                  const IconComponent = conf.icon
                  const isLast = index === sorted.length - 1
                  const prevTimestamp = index > 0 ? sorted[index - 1].timestamp : null

                  return (
                    <div key={event.id} className="relative flex gap-4 pb-4">
                      {/* Dot */}
                      <div className={`relative z-10 w-[30px] h-[30px] rounded-full ${conf.color} flex items-center justify-center flex-shrink-0 mt-0.5`}>
                        <IconComponent className="w-3.5 h-3.5 text-white" strokeWidth={2.5} />
                      </div>

                      {/* Content */}
                      <div className={`flex-1 min-w-0 bg-gray-50 rounded-xl p-3.5 ${isLast ? 'border border-blue-100 bg-blue-50/50' : ''}`}>
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <div className="text-sm font-semibold text-gray-900 leading-snug">{conf.label}</div>
                          <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
                            <time className="text-[10px] text-gray-400 tabular-nums">
                              {new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                            </time>
                            {prevTimestamp && (
                              <span className="text-[10px] text-gray-300 tabular-nums">{timeDiff(prevTimestamp, event.timestamp)}</span>
                            )}
                          </div>
                        </div>

                        <div className="text-xs text-gray-400 mb-2">{event.actor}</div>

                        {/* Reason codes */}
                        {event.reason_codes && event.reason_codes.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            {event.reason_codes.map(code => (
                              <span key={code} className="px-2 py-0.5 rounded-md bg-white border border-gray-200 text-xs text-gray-600 font-medium">
                                {humanReason(code)}
                              </span>
                            ))}
                          </div>
                        )}

                        {/* Policy */}
                        {event.policy_name && (
                          <div className="mt-2 text-xs flex items-center gap-1.5">
                            {event.policy_passed
                              ? <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                              : <XCircle className="w-3 h-3 text-red-500" />
                            }
                            <span className="text-gray-600">{event.policy_name}</span>
                          </div>
                        )}

                        {/* Error */}
                        {event.error_code && (
                          <div className="mt-2 text-xs text-red-600 flex items-center gap-1.5">
                            <AlertTriangle className="w-3 h-3" />
                            {event.error_code}
                          </div>
                        )}

                        {/* External confirmation */}
                        {event.external_confirmation && (
                          <div className="mt-2 flex items-center gap-1.5 text-xs text-blue-600">
                            <ExternalLink className="w-3 h-3" />
                            {event.external_confirmation}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>

        {/* ── Right: Context panel (40%) ── */}
        <div className="w-full lg:w-72 flex-shrink-0 flex flex-col gap-4">

          {/* ICP Score card */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-3">ICP Score</div>
            {(() => {
              const score = (lead as any).icpScore ?? null
              const tier = (lead as any).icpTier ?? null
              if (score === null) {
                return <div className="text-sm text-gray-400 italic">Not scored yet</div>
              }
              const color = score >= 70 ? 'text-emerald-600' : score >= 45 ? 'text-blue-600' : 'text-gray-400'
              const tierLabel = tier === 'tier_1' ? 'Tier 1' : tier === 'tier_2' ? 'Tier 2' : tier === 'tier_3' ? 'Tier 3' : 'Not ICP'
              return (
                <div className="flex items-end gap-3">
                  <div className={`text-5xl font-bold tabular-nums leading-none ${color}`}>{score}</div>
                  <div>
                    <div className="text-xs font-semibold text-gray-500">{tierLabel}</div>
                    <div className="text-[10px] text-gray-400">out of 100</div>
                  </div>
                </div>
              )
            })()}
          </div>

          {/* What happens next */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-3">What Happens Next</div>
            {(() => {
              const nextSteps: Record<string, { label: string; desc: string; color: string }> = {
                new:            { label: 'Waiting for enrichment',   desc: 'Lead will be enriched and qualified automatically.',          color: 'text-blue-600' },
                enriching:      { label: 'Enriching...',             desc: 'Clearbit is fetching company data.',                          color: 'text-blue-600' },
                routing:        { label: 'Routing to rep',           desc: 'RoutingAgent is selecting the best available SDR.',           color: 'text-violet-600' },
                in_sequence:    { label: 'Rep to make contact',      desc: `${lead.assignedTo || 'The assigned rep'} should reach out within the SLA window.`, color: 'text-emerald-600' },
                meeting_booked: { label: 'Meeting booked ✓',         desc: 'Lead converted. AE to run discovery.',                        color: 'text-teal-600' },
                nurture:        { label: 'In nurture sequence',      desc: 'Lead did not meet ICP criteria. Receiving nurture content.',  color: 'text-amber-600' },
                lost:           { label: 'No further action',        desc: 'Lead marked lost.',                                          color: 'text-gray-500' },
              }
              const next = nextSteps[lead.stage]
              if (!next) return <div className="text-sm text-gray-400">Unknown stage</div>
              return (
                <>
                  <div className={`text-sm font-semibold ${next.color}`}>{next.label}</div>
                  <div className="text-xs text-gray-400 mt-1">{next.desc}</div>
                </>
              )
            })()}
          </div>

          {/* Timeline summary */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-3">Timeline Summary</div>
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs">
                <span className="text-gray-400">Total events</span>
                <span className="font-semibold text-gray-900 tabular-nums">{sorted.length}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-400">Failures</span>
                <span className={`font-semibold tabular-nums ${sorted.filter(e => e.event_type.includes('failed')).length > 0 ? 'text-red-600' : 'text-gray-900'}`}>
                  {sorted.filter(e => e.event_type.includes('failed')).length}
                </span>
              </div>
              {sorted.length >= 2 && (
                <div className="flex justify-between text-xs">
                  <span className="text-gray-400">Total duration</span>
                  <span className="font-semibold text-gray-900 tabular-nums">
                    {timeDiff(sorted[0].timestamp, sorted[sorted.length - 1].timestamp)}
                  </span>
                </div>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
