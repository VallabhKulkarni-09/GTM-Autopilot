import { apiFetch } from '@/lib/api'
import { getServerToken } from '@/lib/auth'
import { Lead, TimelineEvent } from '@/types/api'
import Link from 'next/link'
import { ArrowLeft, CheckCircle2, XCircle, Info, Zap, AlertTriangle, User, ExternalLink } from 'lucide-react'

export const dynamic = 'force-dynamic'

// ── Event config ─────────────────────────────────────────────────────────────
const EVENT_CONFIG: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  webhook_received:           { label: 'Form submission received',   color: '#007AFF', icon: Info },
  enrichment_requested:       { label: 'Enrichment started',         color: '#5AC8FA', icon: Info },
  enrichment_succeeded:       { label: 'Enrichment complete',        color: '#007AFF', icon: CheckCircle2 },
  enrichment_failed:          { label: 'Enrichment failed',          color: '#FF9500', icon: AlertTriangle },
  enrichment_skipped:         { label: 'Enrichment skipped',         color: '#8E8E93', icon: Info },
  dedup_passed:               { label: 'Not a duplicate',            color: '#34C759', icon: CheckCircle2 },
  dedup_rejected:             { label: 'Duplicate detected',         color: '#FF3B30', icon: XCircle },
  action_proposed:            { label: 'Agent decision',             color: '#AF52DE', icon: Zap },
  action_execution_started:   { label: 'Action started',             color: '#5AC8FA', icon: Info },
  action_execution_succeeded: { label: 'Action completed',           color: '#34C759', icon: CheckCircle2 },
  action_execution_failed:    { label: 'Action failed',              color: '#FF3B30', icon: XCircle },
  sla_breached:               { label: 'SLA deadline missed',        color: '#FF3B30', icon: AlertTriangle },
  play_completed:             { label: 'Play completed',             color: '#34C759', icon: CheckCircle2 },
  play_marked_nurture:        { label: 'Moved to nurture',           color: '#FF9500', icon: Info },
  play_marked_duplicate:      { label: 'Marked as duplicate',        color: '#8E8E93', icon: XCircle },
  human_review_requested:     { label: 'Paused for human review',    color: '#FF9500', icon: User },
  human_approved:             { label: 'Approved by reviewer',       color: '#34C759', icon: CheckCircle2 },
}
function getEventConf(type: string) {
  return EVENT_CONFIG[type] ?? { label: type.replace(/_/g, ' '), color: '#8E8E93', icon: Info }
}

// ── Reason code humanisation ──────────────────────────────────────────────────
const REASON_LABELS: Record<string, string> = {
  ENRICHMENT_MISSING_COMPANY_SIZE:        'Missing: company size',
  ENRICHMENT_MISSING_INDUSTRY:            'Missing: industry',
  ENRICHMENT_MISSING_REGION:              'Missing: region',
  NOT_ICP_SCORE_TOO_LOW:                  'ICP score too low',
  NOT_ICP_FIT:                            'Not an ICP fit',
  DISQUALIFIED_FREE_EMAIL_PROVIDER:       'Free email domain',
  DISQUALIFIED_TOO_SMALL:                 'Company too small',
  TERRITORY_MATCH:                        'Territory match',
  ROUND_ROBIN_SELECTED:                   'Round-robin assignment',
  OWNER_LIST_EMPTY:                       'No owners available',
  NO_TERRITORY_MATCH_OR_ALL_AT_CAPACITY:  'No owner in territory',
}
const humanReason = (c: string) => REASON_LABELS[c] ?? c.toLowerCase().replace(/_/g, ' ')

// ── Stage config ──────────────────────────────────────────────────────────────
const STAGE_CONFIG: Record<string, { label: string; bg: string; color: string }> = {
  new:            { label: 'New',            bg: 'rgba(142,142,147,0.12)', color: '#8E8E93' },
  enriching:      { label: 'Enriching',      bg: 'rgba(0,122,255,0.10)',   color: '#007AFF' },
  routing:        { label: 'Routing',        bg: 'rgba(88,86,214,0.10)',   color: '#5856D6' },
  in_sequence:    { label: 'In Sequence',    bg: 'rgba(52,199,89,0.10)',   color: '#34C759' },
  meeting_booked: { label: 'Meeting Booked', bg: 'rgba(52,199,89,0.15)',   color: '#30A851' },
  nurture:        { label: 'Nurture',        bg: 'rgba(255,149,0,0.10)',   color: '#FF9500' },
  lost:           { label: 'Lost',           bg: 'rgba(255,59,48,0.10)',   color: '#FF3B30' },
}

function getAvatarColor(n: string) {
  const c = ['#007AFF','#5856D6','#34C759','#FF9500','#FF3B30','#32ADE6','#AF52DE']
  let h = 0; for (let i = 0; i < n.length; i++) h = n.charCodeAt(i) + ((h << 5) - h)
  return c[Math.abs(h) % c.length]
}
function getInitials(n: string) { return n.split(' ').slice(0, 2).map(x => x[0]).join('').toUpperCase() }

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1)  return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}
function timeDiff(a: string, b: string): string {
  const d = Math.abs(new Date(b).getTime() - new Date(a).getTime())
  if (d < 1000)  return '< 1s later'
  if (d < 60000) return `${Math.round(d / 1000)}s later`
  return `${Math.round(d / 60000)}m later`
}

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let lead: Lead
  let timeline: TimelineEvent[]

  try {
    const token = getServerToken()
    const [lr, tr] = await Promise.all([
      apiFetch(`/api/leads/${id}`, token),
      apiFetch(`/api/leads/${id}/timeline`, token),
    ])
    if (!lr.ok || !tr.ok) throw new Error('Failed')
    const { lead: l } = await lr.json()
    lead = l
    const raw: any[] = await tr.json()
    timeline = raw.map(e => ({
      id: e.id, timestamp: e.occurred_at, event_type: e.event_type,
      actor: e.actor_type === 'webhook' ? 'HubSpot' : e.actor_type === 'agent' ? (e.actor_id ?? 'Agent') : (e.actor_type ?? 'System'),
      reason_codes: e.proposed_action?.rationale?.reasonCodes,
      policy_name: e.policy_name, policy_passed: e.policy_passed,
      error_code: e.error_code,
      external_confirmation: e.external_id ? `${e.external_system}: ${e.external_id}` : undefined,
    }))
  } catch {
    lead = { id, company: 'Acme Corp', name: 'John Doe', title: 'CEO', stage: 'in_sequence', timeToFirstTouchMin: 12, assignedTo: 'Alice', formSubmittedAt: new Date(Date.now()-3600000).toISOString() }
    timeline = [
      { id:'1', timestamp: new Date(Date.now()-3600000).toISOString(), event_type:'webhook_received',           actor:'HubSpot' },
      { id:'2', timestamp: new Date(Date.now()-3590000).toISOString(), event_type:'dedup_passed',               actor:'System' },
      { id:'3', timestamp: new Date(Date.now()-3585000).toISOString(), event_type:'enrichment_succeeded',       actor:'Clearbit' },
      { id:'4', timestamp: new Date(Date.now()-3580000).toISOString(), event_type:'action_proposed',            actor:'QualificationAgent', reason_codes:['TERRITORY_MATCH'] },
      { id:'5', timestamp: new Date(Date.now()-3570000).toISOString(), event_type:'action_execution_succeeded', actor:'System', external_confirmation:'salesforce: SF123' },
    ]
  }

  const sorted = [...timeline].sort((a, b) => +new Date(a.timestamp) - +new Date(b.timestamp))
  const stageConf  = STAGE_CONFIG[lead.stage] ?? { label: lead.stage, bg: 'rgba(0,0,0,0.06)', color: '#8E8E93' }
  const displayName = lead.name || (lead as any).email || 'Unknown'
  const icpScore = (lead as any).icpScore ?? null

  return (
    <div className="flex flex-col gap-5 animate-fade-in">

      {/* Back */}
      <Link
        href="/leads"
        className="inline-flex items-center gap-1.5 text-[13px] font-medium w-fit transition-opacity duration-150 hover:opacity-70 apple-focus outline-none"
        style={{ color: 'var(--apple-blue)' }}
      >
        <ArrowLeft size={14} strokeWidth={2.5} />
        Leads
      </Link>

      {/* ── Two-column layout ─────────────────────────────────────── */}
      <div className="flex flex-col lg:flex-row gap-5 items-start">

        {/* ── Left: Lead card + Timeline ── */}
        <div className="flex-1 min-w-0 flex flex-col gap-4">

          {/* Lead header */}
          <div className="apple-card p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-4">
                <div
                  className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0"
                  style={{
                    background: getAvatarColor(displayName),
                    boxShadow: '0 0 0 3px rgba(255,255,255,0.9), 0 4px 12px rgba(0,0,0,0.12)',
                  }}
                >
                  <span className="text-[20px] font-bold text-white">{getInitials(displayName)}</span>
                </div>
                <div>
                  <h1 className="text-[20px] font-bold tracking-tight" style={{ color: 'var(--apple-text-primary)' }}>
                    {displayName}
                  </h1>
                  <div className="text-[13px] mt-0.5" style={{ color: 'var(--apple-text-secondary)' }}>
                    {lead.title || '—'}
                  </div>
                  {(lead as any).email && (
                    <div className="text-[12px] mt-0.5" style={{ color: 'var(--apple-text-tertiary)' }}>
                      {(lead as any).email}
                    </div>
                  )}
                </div>
              </div>
              <span
                className="px-2.5 py-1 rounded-full text-[11px] font-semibold flex-shrink-0"
                style={{ background: stageConf.bg, color: stageConf.color }}
              >
                {stageConf.label}
              </span>
            </div>

            {/* Stats */}
            <div
              className="grid grid-cols-3 gap-4 mt-5 pt-5"
              style={{ borderTop: '1px solid var(--apple-separator)' }}
            >
              {[
                { label: 'Submitted',   value: relativeTime(lead.formSubmittedAt), color: 'var(--apple-text-primary)' },
                {
                  label: 'First Touch',
                  value: lead.timeToFirstTouchMin !== null ? `${lead.timeToFirstTouchMin} min` : '—',
                  color: lead.timeToFirstTouchMin !== null
                    ? (lead.timeToFirstTouchMin <= 15 ? 'var(--apple-green)' : 'var(--apple-red)')
                    : 'var(--apple-text-tertiary)',
                },
                { label: 'Assigned To', value: lead.assignedTo || '—', color: 'var(--apple-text-primary)' },
              ].map(s => (
                <div key={s.label}>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.07em] mb-1" style={{ color: 'var(--apple-text-tertiary)' }}>
                    {s.label}
                  </div>
                  <div className="text-[13px] font-semibold tabular-nums" style={{ color: s.color }}>
                    {s.value}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Apple Health–style Timeline ── */}
          <div className="apple-card p-6">
            <div
              className="text-[11px] font-semibold uppercase tracking-[0.07em] mb-6"
              style={{ color: 'var(--apple-text-tertiary)' }}
            >
              Decision Timeline
            </div>

            <div className="relative">
              {/* Gradient vertical track — fades at top and bottom */}
              <div
                className="absolute left-[15px] top-0 bottom-0 w-px"
                style={{
                  background: 'linear-gradient(to bottom, transparent 0%, var(--apple-text-tertiary) 8%, var(--apple-text-tertiary) 92%, transparent 100%)',
                  opacity: 0.25,
                }}
              />

              <div className="space-y-1">
                {sorted.map((ev, idx) => {
                  const conf = getEventConf(ev.event_type)
                  const Icon = conf.icon
                  const isLast = idx === sorted.length - 1
                  const prevTs = idx > 0 ? sorted[idx - 1].timestamp : null

                  return (
                    <div key={ev.id} className="relative flex gap-4 pb-3">
                      {/* ── Dot ── */}
                      <div className="relative z-10 flex-shrink-0 mt-0.5">
                        {isLast ? (
                          // Last event — "live" pulsing ring
                          <div className="relative w-[30px] h-[30px] flex items-center justify-center">
                            {/* Outer pulsing ring */}
                            <div
                              className="absolute inset-[-5px] rounded-full animate-pulse-ring"
                              style={{ background: conf.color, opacity: 0.25 }}
                            />
                            {/* Inner dot */}
                            <div
                              className="w-[30px] h-[30px] rounded-full flex items-center justify-center"
                              style={{
                                background: conf.color,
                                border: '2px solid rgba(255,255,255,0.9)',
                                boxShadow: `0 2px 8px ${conf.color}44`,
                              }}
                            >
                              <Icon size={13} strokeWidth={2.5} color="white" />
                            </div>
                          </div>
                        ) : (
                          <div
                            className="w-[30px] h-[30px] rounded-full flex items-center justify-center"
                            style={{
                              background: conf.color,
                              border: '2px solid rgba(255,255,255,0.9)',
                              boxShadow: `0 1px 4px ${conf.color}33`,
                            }}
                          >
                            <Icon size={13} strokeWidth={2.5} color="white" />
                          </div>
                        )}
                      </div>

                      {/* ── Glassmorphic bubble ── */}
                      <div
                        className="flex-1 min-w-0 rounded-xl p-3.5"
                        style={{
                          background: isLast
                            ? `rgba(${hexToRgb(conf.color)}, 0.07)`
                            : 'rgba(255,255,255,0.60)',
                          backdropFilter: 'blur(12px)',
                          WebkitBackdropFilter: 'blur(12px)',
                          border: isLast
                            ? `1px solid rgba(${hexToRgb(conf.color)}, 0.2)`
                            : '1px solid rgba(255,255,255,0.45)',
                          boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
                        }}
                      >
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <div className="text-[13px] font-semibold" style={{ color: 'var(--apple-text-primary)' }}>
                            {conf.label}
                          </div>
                          <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
                            <time className="text-[10px] tabular-nums" style={{ color: 'var(--apple-text-tertiary)' }}>
                              {new Date(ev.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                            </time>
                            {prevTs && (
                              <span className="text-[10px] tabular-nums" style={{ color: 'var(--apple-text-tertiary)', opacity: 0.6 }}>
                                {timeDiff(prevTs, ev.timestamp)}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="text-[11px] mb-2" style={{ color: 'var(--apple-text-tertiary)' }}>
                          {ev.actor}
                        </div>

                        {/* Reason codes */}
                        {ev.reason_codes && ev.reason_codes.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            {ev.reason_codes.map(code => (
                              <span
                                key={code}
                                className="px-2 py-[3px] rounded-md text-[11px] font-medium"
                                style={{
                                  background: 'rgba(255,255,255,0.75)',
                                  border: '1px solid rgba(0,0,0,0.08)',
                                  color: 'var(--apple-text-secondary)',
                                }}
                              >
                                {humanReason(code)}
                              </span>
                            ))}
                          </div>
                        )}

                        {/* Policy */}
                        {ev.policy_name && (
                          <div className="mt-2 text-[11px] flex items-center gap-1.5" style={{ color: 'var(--apple-text-secondary)' }}>
                            {ev.policy_passed
                              ? <CheckCircle2 size={11} style={{ color: 'var(--apple-green)' }} />
                              : <XCircle size={11} style={{ color: 'var(--apple-red)' }} />}
                            {ev.policy_name}
                          </div>
                        )}

                        {/* Error */}
                        {ev.error_code && (
                          <div className="mt-2 text-[11px] flex items-center gap-1.5" style={{ color: 'var(--apple-red)' }}>
                            <AlertTriangle size={11} strokeWidth={2.5} />
                            {ev.error_code}
                          </div>
                        )}

                        {/* External confirmation */}
                        {ev.external_confirmation && (
                          <div className="mt-2 text-[11px] flex items-center gap-1.5" style={{ color: 'var(--apple-blue)' }}>
                            <ExternalLink size={11} />
                            {ev.external_confirmation}
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

        {/* ── Right: Inspector Panel ── */}
        <div className="w-full lg:w-[260px] flex-shrink-0 flex flex-col gap-3">

          {/* ICP Score */}
          <div className="apple-card p-5">
            <div className="text-[10px] font-semibold uppercase tracking-[0.07em] mb-3" style={{ color: 'var(--apple-text-tertiary)' }}>
              ICP Score
            </div>
            {icpScore === null ? (
              <div className="text-[13px] italic" style={{ color: 'var(--apple-text-tertiary)' }}>Not scored yet</div>
            ) : (
              <div className="flex items-end gap-3">
                <div
                  className="text-[48px] font-bold tabular-nums leading-none tracking-tight"
                  style={{
                    // Gradient text when score is high
                    ...(icpScore >= 70
                      ? { backgroundImage: 'linear-gradient(to bottom, #34C759, #30A851)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }
                      : icpScore >= 45
                        ? { color: 'var(--apple-blue)' }
                        : { color: 'var(--apple-text-tertiary)' }),
                  }}
                >
                  {icpScore}
                </div>
                <div className="pb-1">
                  <div className="text-[12px] font-semibold" style={{ color: 'var(--apple-text-secondary)' }}>
                    {icpScore >= 70 ? 'Tier 1' : icpScore >= 45 ? 'Tier 2' : 'Not ICP'}
                  </div>
                  <div className="text-[11px]" style={{ color: 'var(--apple-text-tertiary)' }}>out of 100</div>
                </div>
              </div>
            )}
          </div>

          {/* What Happens Next */}
          <div className="apple-card p-5">
            <div className="text-[10px] font-semibold uppercase tracking-[0.07em] mb-3" style={{ color: 'var(--apple-text-tertiary)' }}>
              What Happens Next
            </div>
            {(() => {
              const next: Record<string, { label: string; desc: string; color: string }> = {
                new:            { label: 'Waiting for enrichment',  desc: 'Will be enriched and qualified automatically.', color: 'var(--apple-blue)' },
                enriching:      { label: 'Enriching…',             desc: 'Clearbit is fetching company data.',            color: 'var(--apple-blue)' },
                routing:        { label: 'Routing to rep',          desc: 'RoutingAgent selecting best available SDR.',    color: '#5856D6' },
                in_sequence:    { label: 'Rep to make contact',     desc: `${lead.assignedTo || 'Rep'} should reach out within the SLA window.`, color: 'var(--apple-green)' },
                meeting_booked: { label: 'Meeting booked ✓',        desc: 'Lead converted. AE runs discovery.',            color: 'var(--apple-green)' },
                nurture:        { label: 'In nurture sequence',     desc: 'Did not meet ICP criteria. Receiving content.', color: 'var(--apple-orange)' },
                lost:           { label: 'No further action',       desc: 'Lead marked lost.',                             color: 'var(--apple-text-tertiary)' },
              }
              const n = next[lead.stage]
              return n ? (
                <>
                  <div className="text-[13px] font-semibold" style={{ color: n.color }}>{n.label}</div>
                  <div className="text-[12px] mt-1" style={{ color: 'var(--apple-text-tertiary)' }}>{n.desc}</div>
                </>
              ) : null
            })()}
          </div>

          {/* Timeline Summary */}
          <div className="apple-card p-5">
            <div className="text-[10px] font-semibold uppercase tracking-[0.07em] mb-3" style={{ color: 'var(--apple-text-tertiary)' }}>
              Timeline Summary
            </div>
            <div className="space-y-2">
              {[
                { label: 'Total events', value: sorted.length, danger: false },
                { label: 'Failures', value: sorted.filter(e => e.event_type.includes('failed')).length, danger: true },
              ].map(r => (
                <div key={r.label} className="flex justify-between">
                  <span className="text-[12px]" style={{ color: 'var(--apple-text-tertiary)' }}>{r.label}</span>
                  <span
                    className="text-[12px] font-semibold tabular-nums"
                    style={{ color: r.danger && r.value > 0 ? 'var(--apple-red)' : 'var(--apple-text-primary)' }}
                  >
                    {r.value}
                  </span>
                </div>
              ))}
              {sorted.length >= 2 && (
                <div className="flex justify-between">
                  <span className="text-[12px]" style={{ color: 'var(--apple-text-tertiary)' }}>Total duration</span>
                  <span className="text-[12px] font-semibold tabular-nums" style={{ color: 'var(--apple-text-primary)' }}>
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

// Helper — convert hex color to r,g,b for rgba()
function hexToRgb(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `${r},${g},${b}`
}
