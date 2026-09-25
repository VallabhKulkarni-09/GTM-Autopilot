import { apiFetch } from '@/lib/api'
import { getServerToken } from '@/lib/auth'
import { OverviewMetrics, SpeedToLeadDistribution } from '@/types/api'
import { SdrTable } from './sdr-table'
import { AlertTriangle, Clock, Play, CheckCircle2 } from 'lucide-react'

export const dynamic = 'force-dynamic'

// Bucket config — color → fast (emerald) to slow (red)
const BUCKETS: Record<string, { label: string; gradient: string; track: string }> = {
  under5:  { label: 'Under 5 min', gradient: 'linear-gradient(90deg,#34C759,#30d158)', track: '#34C75920' },
  under15: { label: '5 – 15 min',  gradient: 'linear-gradient(90deg,#007AFF,#409CFF)', track: '#007AFF20' },
  under30: { label: '15 – 30 min', gradient: 'linear-gradient(90deg,#FF9500,#FFB340)', track: '#FF950020' },
  under60: { label: '30 – 60 min', gradient: 'linear-gradient(90deg,#FF6B00,#FF9500)', track: '#FF6B0020' },
  over60:  { label: 'Over 1 hour', gradient: 'linear-gradient(90deg,#FF3B30,#FF6961)', track: '#FF3B3020' },
}

// ── KPI Widget ───────────────────────────────────────────────────────────────
function KpiWidget({
  label,
  value,
  sub,
  icon: Icon,
  iconColor,
  iconBg,
  isDanger = false,
}: {
  label: string
  value: string | number
  sub?: string
  icon: React.ElementType
  iconColor: string
  iconBg: string
  isDanger?: boolean
}) {
  const numericVal = Number(value.toString().replace('%', ''))

  return (
    <div className="apple-widget p-5 flex flex-col gap-3 relative overflow-hidden">
      {/* Ghost icon watermark — depth affordance */}
      <div
        className="absolute -right-3 -bottom-3 opacity-[0.04] pointer-events-none"
        aria-hidden
      >
        <Icon size={80} strokeWidth={1.5} />
      </div>

      {/* Header row */}
      <div className="flex items-center justify-between relative z-10">
        <span
          className="text-[11px] font-semibold uppercase tracking-[0.07em]"
          style={{ color: 'var(--apple-text-tertiary)' }}
        >
          {label}
        </span>
        <div
          className="w-8 h-8 rounded-[10px] flex items-center justify-center"
          style={{ background: iconBg }}
        >
          <Icon size={16} strokeWidth={2.5} style={{ color: iconColor }} />
        </div>
      </div>

      {/* Value */}
      <div
        className="text-[36px] font-bold tabular-nums leading-none tracking-tight relative z-10"
        style={{
          color: isDanger && numericVal > 0 ? 'var(--apple-red)' : 'var(--apple-text-primary)',
        }}
      >
        {value}
      </div>

      {/* Sub-label */}
      {sub && (
        <div
          className="text-[13px] leading-snug relative z-10"
          style={{ color: 'var(--apple-text-secondary)' }}
        >
          {sub}
        </div>
      )}
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default async function DashboardPage() {
  let overview: OverviewMetrics
  let distribution: SpeedToLeadDistribution

  try {
    const token = getServerToken()
    const [overviewRes, distRes] = await Promise.all([
      apiFetch('/api/metrics/overview', token),
      apiFetch('/api/metrics/speed-to-lead', token),
    ])
    if (!overviewRes.ok || !distRes.ok) throw new Error('API error')
    overview = await overviewRes.json()
    distribution = await distRes.json()
  } catch (error: any) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-[28px] font-bold tracking-tight" style={{ color: 'var(--apple-text-primary)' }}>
          Operations Overview
        </h1>
        <div
          className="rounded-2xl p-5 flex items-start gap-3"
          style={{ background: 'rgba(255,59,48,0.08)', border: '1px solid rgba(255,59,48,0.2)' }}
        >
          <AlertTriangle size={18} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--apple-red)' }} />
          <div>
            <div className="text-[15px] font-semibold" style={{ color: 'var(--apple-red)' }}>
              Dashboard Unavailable
            </div>
            <div className="text-[13px] mt-1" style={{ color: 'var(--apple-text-secondary)' }}>
              {error?.message ?? 'Failed to load metrics'}. Check API server health.
            </div>
          </div>
        </div>
      </div>
    )
  }

  const cp = overview.currentPeriod
  const pp = overview.priorPeriod
  const qualifiedDelta = cp.totalQualified - pp.totalQualified
  const speedDelta     = cp.touchedUnder15MinPct - pp.touchedUnder15MinPct

  return (
    <div className="flex flex-col gap-7 animate-fade-in">

      {/* ── Page Header ──────────────────────────────────────────── */}
      <div>
        <h1
          className="text-[28px] font-bold tracking-tight leading-tight"
          style={{ color: 'var(--apple-text-primary)' }}
        >
          Operations Overview
        </h1>
        <p className="text-[13px] mt-1" style={{ color: 'var(--apple-text-tertiary)' }}>
          Last 30 days · refreshes on load
        </p>
      </div>

      {/* ── KPI Widget Strip ─────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiWidget
          label="Leads Qualified"
          value={cp.totalQualified}
          sub={`${qualifiedDelta >= 0 ? '+' : ''}${qualifiedDelta} vs prior period`}
          icon={CheckCircle2}
          iconColor="var(--apple-green)"
          iconBg="rgba(52,199,89,0.12)"
        />
        <KpiWidget
          label="Touched < 15 min"
          value={`${cp.touchedUnder15MinPct}%`}
          sub={`${speedDelta >= 0 ? '+' : ''}${speedDelta}pp vs prior period`}
          icon={Clock}
          iconColor="var(--apple-blue)"
          iconBg="rgba(0,122,255,0.10)"
        />
        <KpiWidget
          label="SLA Breaches"
          value={cp.slaBreaches}
          sub="Leads that missed the deadline"
          icon={AlertTriangle}
          iconColor="var(--apple-red)"
          iconBg="rgba(255,59,48,0.10)"
          isDanger
        />
        <KpiWidget
          label="Active Plays"
          value={cp.activePlays}
          sub="Currently in pipeline"
          icon={Play}
          iconColor="var(--apple-purple)"
          iconBg="rgba(175,82,222,0.10)"
        />
      </div>

      {/* ── Speed-to-Lead Distribution ───────────────────────────── */}
      <div className="apple-card p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2
              className="text-[17px] font-semibold tracking-tight"
              style={{ color: 'var(--apple-text-primary)' }}
            >
              Speed-to-Lead Distribution
            </h2>
            <p className="text-[13px] mt-0.5" style={{ color: 'var(--apple-text-tertiary)' }}>
              {distribution.total} leads with recorded first touch
            </p>
          </div>
          {/* SLA target pill */}
          <div
            className="flex items-center gap-1.5 px-3 py-[5px] rounded-full text-[11px] font-semibold"
            style={{
              background: 'rgba(255,149,0,0.10)',
              color: 'var(--apple-orange)',
            }}
          >
            <div className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--apple-orange)' }} />
            SLA target: 15 min
          </div>
        </div>

        {/* Bars or empty state */}
        {distribution.total === 0 ? (
          <div className="flex flex-col items-center justify-center py-10" style={{ color: 'var(--apple-text-tertiary)' }}>
            <Clock size={32} strokeWidth={1} className="mb-3 opacity-40" />
            <div className="text-[15px] font-medium">No first-touch data yet</div>
            <div className="text-[13px] mt-1">Data appears once leads are routed and touched by a rep</div>
          </div>
        ) : (
          <div className="space-y-3">
            {Object.entries(distribution.buckets).map(([key, data]) => {
              const bucket = BUCKETS[key]
              return (
                <div key={key} className="flex items-center gap-4">
                  {/* Label */}
                  <div
                    className="w-24 text-[12px] font-medium flex-shrink-0"
                    style={{ color: 'var(--apple-text-secondary)' }}
                  >
                    {bucket.label}
                  </div>

                  {/* Track + filled bar */}
                  <div
                    className="flex-1 h-2 rounded-full overflow-hidden"
                    style={{ background: bucket.track }}
                  >
                    <div
                      className="h-full rounded-full transition-all duration-700 ease-[cubic-bezier(0.25,0.1,0.25,1)]"
                      style={{
                        width: `${Math.max(data.pct, data.count > 0 ? 2 : 0)}%`,
                        background: bucket.gradient,
                        boxShadow: `0 1px 3px rgba(0,0,0,0.15)`,
                      }}
                    />
                  </div>

                  {/* Count + pct */}
                  <div
                    className="w-20 text-right text-[12px] font-semibold tabular-nums flex-shrink-0"
                    style={{ color: 'var(--apple-text-primary)' }}
                  >
                    {data.count}
                    <span className="font-normal ml-1" style={{ color: 'var(--apple-text-tertiary)' }}>
                      ({data.pct}%)
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Per-SDR Performance ──────────────────────────────────── */}
      <div className="apple-card p-6">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2
              className="text-[17px] font-semibold tracking-tight"
              style={{ color: 'var(--apple-text-primary)' }}
            >
              Per-SDR Performance
            </h2>
            <p className="text-[13px] mt-0.5" style={{ color: 'var(--apple-text-tertiary)' }}>
              Sorted by response rate
            </p>
          </div>
        </div>
        <SdrTable stats={distribution.sdrStats} />
      </div>

    </div>
  )
}
