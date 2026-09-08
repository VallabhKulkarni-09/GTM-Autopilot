import { apiFetch } from '@/lib/api'
import { getServerToken } from '@/lib/auth'
import { OverviewMetrics, SpeedToLeadDistribution } from '@/types/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { SdrTable } from './sdr-table'

export default async function DashboardPage() {
  let overview: OverviewMetrics
  let distribution: SpeedToLeadDistribution
  let apiError: string | null = null

  try {
    const token = getServerToken()
    const [overviewRes, distRes] = await Promise.all([
      apiFetch('/api/metrics/overview', token),
      apiFetch('/api/metrics/speed-to-lead', token)
    ])

    if (!overviewRes.ok || !distRes.ok) {
      throw new Error(`API error: overview=${overviewRes.status} dist=${distRes.status}`)
    }

    overview = await overviewRes.json()
    distribution = await distRes.json()
  } catch (error: any) {
    apiError = error?.message ?? 'Failed to load dashboard data'
    return (
      <div className="p-8">
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-red-800">
          <h2 className="font-semibold text-lg mb-2">⚠️ Dashboard Unavailable</h2>
          <p className="text-sm">{apiError}</p>
          <p className="text-xs mt-2 text-red-600">Check API server health and network connectivity.</p>
        </div>
      </div>
    )
  }

  const delta = overview.currentPeriod.meetingsBooked - overview.priorPeriod.meetingsBooked;
  const pctChange = overview.priorPeriod.meetingsBooked > 0
    ? Math.round((delta / overview.priorPeriod.meetingsBooked) * 100)
    : 0;

  return (
    <div className="space-y-8">
      {/* Primary Metric according to frontend.md */}
      <div className="text-center py-12 bg-white rounded-xl shadow-sm border">
        <h1 className="text-sm font-semibold text-gray-500 tracking-wider uppercase mb-4">Incremental Meeting Conversion</h1>
        <div className="text-5xl font-bold mb-6">
          {overview.currentPeriod.meetingsBooked} meetings
        </div>
        <div className="text-gray-600 space-y-1">
          <p>This period: {overview.currentPeriod.meetingsBooked} meetings from {overview.currentPeriod.totalQualified} qualified leads</p>
          <p>Prior period: {overview.priorPeriod.meetingsBooked} meetings from {overview.priorPeriod.totalQualified} qualified leads</p>
          <p className="font-medium text-emerald-600 mt-2">Δ: +{delta} meetings (+{pctChange}%)</p>
        </div>
      </div>

      <div className="text-center py-8">
        <h2 className="text-4xl font-bold">{overview.currentPeriod.touchedUnder15MinPct}% leads touched within 15 minutes</h2>
        <p className="text-gray-500 mt-2">vs {overview.priorPeriod.touchedUnder15MinPct}% prior period (+{overview.currentPeriod.touchedUnder15MinPct - overview.priorPeriod.touchedUnder15MinPct}pp)</p>
      </div>

      <div className="grid grid-cols-3 gap-6">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-gray-500">Avg Time to First Touch</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{overview.currentPeriod.avgFirstTouchMin} min</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-gray-500">SLA Breaches (30d)</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold text-red-600">{overview.currentPeriod.slaBreaches}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-gray-500">Active Plays</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{overview.currentPeriod.activePlays}</div></CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Speed-to-Lead Distribution</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-4">
            {Object.entries(distribution.buckets).map(([key, data]) => (
              <div key={key} className="flex items-center space-x-4">
                <div className="w-24 text-sm text-gray-500">{key.replace('under', '< ').replace('over', '> ')} min</div>
                <div className="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
                  <div className="bg-blue-600 h-full rounded-full" style={{ width: `${data.pct}%` }} />
                </div>
                <div className="w-16 text-right text-sm font-medium">{data.count} ({data.pct}%)</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Per-SDR Performance</CardTitle></CardHeader>
        <CardContent>
          <SdrTable stats={distribution.sdrStats} />
        </CardContent>
      </Card>
    </div>
  )
}
