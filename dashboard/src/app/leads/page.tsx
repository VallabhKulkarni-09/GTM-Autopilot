import { apiFetch } from '@/lib/api'
import { getServerToken } from '@/lib/auth'
import { Lead, PaginatedLeads } from '@/types/api'
import { Badge } from '@/components/ui/badge'
import Link from 'next/link'
import { LeadsFilter } from './leads-filter'
import { ChevronRight, Zap, AlertTriangle } from 'lucide-react'

export const dynamic = 'force-dynamic'

// Stage pill config
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
  const colors = [
    'bg-blue-500', 'bg-violet-500', 'bg-emerald-500',
    'bg-amber-500', 'bg-rose-500', 'bg-cyan-500',
  ]
  let h = 0
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h)
  return colors[Math.abs(h) % colors.length]
}

function getInitials(name: string): string {
  return name.split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase()
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1)  return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)  return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

function TouchTimeBadge({ minutes }: { minutes: number | null }) {
  if (minutes === null) return <span className="text-gray-300">—</span>
  if (minutes <= 5)  return (
    <span className="inline-flex items-center gap-1 text-emerald-600 font-semibold tabular-nums text-sm">
      <Zap className="w-3 h-3" strokeWidth={3} />{minutes} min
    </span>
  )
  if (minutes <= 15) return <span className="text-blue-600 font-medium tabular-nums text-sm">{minutes} min</span>
  return (
    <span className="inline-flex items-center gap-1 text-red-500 font-medium tabular-nums text-sm">
      <AlertTriangle className="w-3 h-3" strokeWidth={2.5} />{minutes} min
    </span>
  )
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const params = await searchParams
  const page = Number(params.page || '1')
  const stage = typeof params.stage === 'string' ? params.stage : undefined
  const dateRange = typeof params.dateRange === 'string' ? params.dateRange : undefined

  let data: PaginatedLeads

  try {
    const token = getServerToken()
    const query = new URLSearchParams({ page: page.toString(), limit: '50' })
    if (stage) query.set('stage', stage)
    if (dateRange) query.set('dateRange', dateRange)

    const res = await apiFetch(`/api/leads?${query.toString()}`, token)
    if (!res.ok) throw new Error('Failed to fetch')
    data = await res.json()
  } catch {
    data = {
      data: [
        { id: '1', company: 'Acme Corp', name: 'John Doe', title: 'CEO', stage: 'new', timeToFirstTouchMin: null, assignedTo: null, formSubmittedAt: new Date().toISOString() },
        { id: '2', company: 'Globex', name: 'Jane Smith', title: 'VP Sales', stage: 'meeting_booked', timeToFirstTouchMin: 12, assignedTo: 'Alice', formSubmittedAt: new Date(Date.now() - 86400000).toISOString() },
      ],
      total: 2, page: 1, limit: 50,
    }
  }

  const stageParam = stage || 'all'
  const dateParam = dateRange || 'all'

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Leads</h1>
          <p className="text-sm text-gray-400 mt-0.5">{data.total} leads total</p>
        </div>
      </div>

      <LeadsFilter />

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {/* Table head */}
        <div className="grid grid-cols-[2fr_1.5fr_1fr_1fr_1fr_auto] px-5 py-3 bg-gray-50 border-b border-gray-100 text-xs font-semibold uppercase tracking-wider text-gray-400">
          <div>Lead</div>
          <div>Title</div>
          <div>Stage</div>
          <div>First Touch</div>
          <div>Assigned To</div>
          <div className="w-8" />
        </div>

        {data.data.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center text-gray-400">
            <div className="text-sm font-medium mb-1">No leads match this filter</div>
            <div className="text-xs">Try a different stage or date range</div>
          </div>
        ) : (
          data.data.map(lead => {
            const stageConf = STAGE_CONFIG[lead.stage] || { label: lead.stage, className: 'bg-gray-100 text-gray-600' }
            const displayName = lead.name || lead.email || 'Unknown'
            const company = lead.company || (lead as any).email?.split('@')[1] || '—'

            return (
              <Link
                key={lead.id}
                href={`/leads/${lead.id}`}
                className="grid grid-cols-[2fr_1.5fr_1fr_1fr_1fr_auto] px-5 py-4 items-center border-b border-gray-50 last:border-0 hover:bg-blue-50/30 transition-colors group"
              >
                {/* Lead — avatar + name + company */}
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-8 h-8 rounded-full ${getAvatarColor(displayName)} flex-shrink-0 flex items-center justify-center`}>
                    <span className="text-xs font-bold text-white">{getInitials(displayName)}</span>
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-gray-900 truncate">{displayName}</div>
                    <div className="text-xs text-gray-400 truncate">{company}</div>
                  </div>
                </div>

                {/* Title */}
                <div className="text-sm text-gray-600 truncate pr-4">{lead.title || '—'}</div>

                {/* Stage */}
                <div>
                  <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold ${stageConf.className}`}>
                    {stageConf.label}
                  </span>
                </div>

                {/* First touch */}
                <div>
                  <TouchTimeBadge minutes={lead.timeToFirstTouchMin} />
                </div>

                {/* Assigned to */}
                <div className="flex items-center gap-2">
                  {lead.assignedTo ? (
                    <>
                      <div className={`w-6 h-6 rounded-full ${getAvatarColor(lead.assignedTo)} flex-shrink-0 flex items-center justify-center`}>
                        <span className="text-[9px] font-bold text-white">{getInitials(lead.assignedTo)}</span>
                      </div>
                      <span className="text-sm text-gray-600 truncate">{lead.assignedTo}</span>
                    </>
                  ) : (
                    <span className="text-xs text-gray-300 italic">Unassigned</span>
                  )}
                </div>

                {/* Arrow */}
                <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-blue-400 transition-colors" />
              </Link>
            )
          })
        )}
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between text-sm">
        <div className="text-gray-400">
          Showing {Math.min((page - 1) * data.limit + 1, data.total)}–{Math.min(page * data.limit, data.total)} of {data.total}
        </div>
        <div className="flex gap-2">
          {page > 1 && (
            <Link
              href={`/leads?page=${page - 1}${stage ? `&stage=${stage}` : ''}${dateRange ? `&dateRange=${dateRange}` : ''}`}
              className="px-4 py-2 rounded-xl border border-gray-200 bg-white text-gray-700 text-sm hover:border-blue-300 hover:text-blue-700 transition-colors"
            >
              ← Previous
            </Link>
          )}
          {page * data.limit < data.total && (
            <Link
              href={`/leads?page=${page + 1}${stage ? `&stage=${stage}` : ''}${dateRange ? `&dateRange=${dateRange}` : ''}`}
              className="px-4 py-2 rounded-xl border border-gray-200 bg-white text-gray-700 text-sm hover:border-blue-300 hover:text-blue-700 transition-colors"
            >
              Next →
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}
