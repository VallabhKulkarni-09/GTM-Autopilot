import { apiFetch } from '@/lib/api'
import { getServerToken } from '@/lib/auth'
import { OverviewMetrics, SpeedToLeadDistribution } from '@/types/api'
import { SdrTable } from './sdr-table'
import { AlertTriangle, Clock, Play, CheckCircle2 } from 'lucide-react'

export const dynamic = 'force-dynamic'

// Human-friendly bucket labels
const BUCKET_LABELS: Record<string, { label: string; color: string }> = {
  under5:  { label: 'Under 5 min',   color: 'bg-emerald-500' },
  under15: { label: '5 – 15 min',    color: 'bg-blue-500' },
  under30: { label: '15 – 30 min',   color: 'bg-amber-400' },
  under60: { label: '30 – 60 min',   color: 'bg-orange-500' },
  over60:  { label: 'Over 1 hour',   color: 'bg-red-500' },
}

function KpiCard({
  label,
  value,
  sub,
  icon: Icon,
  danger = false,
}: {
  label: string
  value: string | number
  sub?: string
  icon: React.ElementType
  danger?: boolean
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-widest text-gray-400">{label}</span>
        <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${danger ? 'bg-red-50' : 'bg-blue-50'}`}>
          <Icon className={`w-4 h-4 ${danger ? 'text-red-500' : 'text-blue-600'}`} strokeWidth={2.5} />
        </div>
      </div>
      <div className={`text-4xl font-bold tabular-nums leading-none ${danger && Number(value) > 0 ? 'text-red-600' : 'text-gray-900'}`}>
        {value}
      </div>
      {sub && <div className="text-xs text-gray-400">{sub}</div>}
    </div>
  )
}

export default async function DashboardPage() {
  let overview: OverviewMetrics
  let distribution: SpeedToLeadDistribution
  let apiError: string | null = null

  try {
    const token = getServerToken()
    const [overviewRes, distRes] = await Promise.all([
      apiFetch('/api/metrics/overview', token),
      apiFetch('/api/metrics/speed-to-lead', token),
    ])

    if (!overviewRes.ok || !distRes.ok) {
      throw new Error(`API error: overview=${overviewRes.status} dist=${distRes.status}`)
    }

    overview = await overviewRes.json()
    distribution = await distRes.json()
  } catch (error: any) {
    apiError = error?.message ?? 'Failed to load dashboard data'
    return (
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">Operations Overview</h1>
        </div>
        <div className="rounded-2xl border border-red-100 bg-red-50 p-6 text-red-800 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 mt-0.5 flex-shrink-0" />
          <div>
            <div className="font-semibold mb-1">Dashboard Unavailable</div>
            <div className="text-sm text-red-700">{apiError}</div>
            <div className="text-xs mt-2 text-red-500">Check API server health and network connectivity.</div>
          </div>
        </div>
      </div>
    )
  }

  const cp = overview.currentPeriod
  const pp = overview.priorPeriod

  const meetingDelta = cp.meetingsBooked - pp.meetingsBooked
  const qualifiedDelta = cp.totalQualified - pp.totalQualified
  const speedDelta = cp.touchedUnder15MinPct - pp.touchedUnder15MinPct

  return (
    <div className="flex flex-col gap-8">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Operations Overview</h1>
          <p className="text-sm text-gray-400 mt-0.5">Last 30 days · refreshes on load</p>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Leads Qualified"
          value={cp.totalQualified}
          sub={`${qualifiedDelta >= 0 ? '+' : ''}${qualifiedDelta} vs prior period`}
          icon={CheckCircle2}
        />
        <KpiCard
          label="Touched < 15 min"
          value={`${cp.touchedUnder15MinPct}%`}
          sub={`${speedDelta >= 0 ? '+' : ''}${speedDelta}pp vs prior period`}
          icon={Clock}
        />
        <KpiCard
          label="SLA Breaches"
          value={cp.slaBreaches}
          sub="Leads that missed the deadline"
          icon={AlertTriangle}
          danger
        />
        <KpiCard
          label="Active Plays"
          value={cp.activePlays}
          sub="Currently in pipeline"
          icon={Play}
        />
      </div>

      {/* Speed-to-Lead Distribution */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Speed-to-Lead Distribution</h2>
            <p className="text-xs text-gray-400 mt-0.5">{distribution.total} leads with recorded first touch</p>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-amber-600 bg-amber-50 px-2.5 py-1 rounded-full font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            SLA target: 15 min
          </div>
        </div>

        {distribution.total === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-gray-400">
            <Clock className="w-8 h-8 mb-3 opacity-30" />
            <div className="text-sm font-medium">No first-touch data yet</div>
            <div className="text-xs mt-1">Data appears once leads are routed and touched by a rep</div>
          </div>
        ) : (
          <div className="space-y-3">
            {Object.entries(distribution.buckets).map(([key, data]) => {
              const bucket = BUCKET_LABELS[key]
              return (
                <div key={key} className="flex items-center gap-4">
                  <div className="w-28 text-xs text-gray-500 font-medium flex-shrink-0">{bucket.label}</div>
                  <div className="flex-1 bg-gray-100 rounded-full h-2.5 overflow-hidden">
                    <div
                      className={`${bucket.color} h-full rounded-full transition-all duration-500`}
                      style={{ width: `${Math.max(data.pct, data.count > 0 ? 2 : 0)}%` }}
                    />
                  </div>
                  <div className="w-20 text-right text-xs font-semibold text-gray-700 tabular-nums flex-shrink-0">
                    {data.count} <span className="font-normal text-gray-400">({data.pct}%)</span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Per-SDR Performance */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Per-SDR Performance</h2>
            <p className="text-xs text-gray-400 mt-0.5">Sorted by response rate</p>
          </div>
        </div>
        <SdrTable stats={distribution.sdrStats} />
      </div>
    </div>
  )
}
