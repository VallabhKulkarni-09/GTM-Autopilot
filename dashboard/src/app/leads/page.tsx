import { apiFetch } from '@/lib/api'
import { getServerToken } from '@/lib/auth'
import { Lead, PaginatedLeads } from '@/types/api'
import Link from 'next/link'
import { LeadsFilter } from './leads-filter'
import { ChevronRight, Zap, AlertTriangle } from 'lucide-react'

export const dynamic = 'force-dynamic'

// ── Stage badge config ────────────────────────────────────────────────────────
const STAGE_CONFIG: Record<string, { label: string; bg: string; color: string }> = {
  new:            { label: 'New',            bg: 'rgba(142,142,147,0.12)', color: '#8E8E93' },
  enriching:      { label: 'Enriching',      bg: 'rgba(0,122,255,0.10)',   color: '#007AFF' },
  routing:        { label: 'Routing',        bg: 'rgba(88,86,214,0.10)',   color: '#5856D6' },
  in_sequence:    { label: 'In Sequence',    bg: 'rgba(52,199,89,0.10)',   color: '#34C759' },
  meeting_booked: { label: 'Meeting Booked', bg: 'rgba(52,199,89,0.15)',   color: '#30A851' },
  nurture:        { label: 'Nurture',        bg: 'rgba(255,149,0,0.10)',   color: '#FF9500' },
  lost:           { label: 'Lost',           bg: 'rgba(255,59,48,0.10)',   color: '#FF3B30' },
}

function getAvatarColor(name: string): string {
  const colors = ['#007AFF','#5856D6','#34C759','#FF9500','#FF3B30','#32ADE6','#AF52DE']
  let h = 0
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h)
  return colors[Math.abs(h) % colors.length]
}

function getInitials(name: string): string {
  return name.split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase()
}

// ── First-touch badge — Apple status capsule ──────────────────────────────────
function TouchBadge({ minutes }: { minutes: number | null }) {
  if (minutes === null) return <span style={{ color: 'var(--apple-text-tertiary)' }}>—</span>

  if (minutes <= 5) return (
    <span
      className="inline-flex items-center gap-1 px-2 py-[3px] rounded-full text-[11px] font-semibold"
      style={{ background: 'rgba(52,199,89,0.12)', color: 'var(--apple-green)' }}
    >
      <Zap size={10} strokeWidth={3} />
      {minutes} min
    </span>
  )
  if (minutes <= 15) return (
    <span
      className="inline-flex items-center px-2 py-[3px] rounded-full text-[11px] font-semibold tabular-nums"
      style={{ background: 'rgba(0,122,255,0.10)', color: 'var(--apple-blue)' }}
    >
      {minutes} min
    </span>
  )
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-[3px] rounded-full text-[11px] font-semibold"
      style={{ background: 'rgba(255,59,48,0.10)', color: 'var(--apple-red)' }}
    >
      <AlertTriangle size={10} strokeWidth={2.5} />
      {minutes} min
    </span>
  )
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const params    = await searchParams
  const page      = Number(params.page || '1')
  const stage     = typeof params.stage     === 'string' ? params.stage     : undefined
  const dateRange = typeof params.dateRange === 'string' ? params.dateRange : undefined

  let data: PaginatedLeads

  try {
    const token = getServerToken()
    const qs = new URLSearchParams({ page: page.toString(), limit: '50' })
    if (stage)     qs.set('stage', stage)
    if (dateRange) qs.set('dateRange', dateRange)
    const res = await apiFetch(`/api/leads?${qs.toString()}`, token)
    if (!res.ok) throw new Error('Failed to fetch')
    data = await res.json()
  } catch {
    data = {
      data: [
        { id: '1', company: 'Acme Corp',  name: 'John Doe',   title: 'CEO',      stage: 'new',            timeToFirstTouchMin: null, assignedTo: null,    formSubmittedAt: new Date().toISOString() },
        { id: '2', company: 'Globex',     name: 'Jane Smith', title: 'VP Sales', stage: 'meeting_booked', timeToFirstTouchMin: 12,   assignedTo: 'Alice', formSubmittedAt: new Date(Date.now()-86400000).toISOString() },
      ],
      total: 2, page: 1, limit: 50,
    }
  }

  return (
    <div className="flex flex-col gap-5 animate-fade-in">

      {/* Page header */}
      <div>
        <h1 className="text-[28px] font-bold tracking-tight" style={{ color: 'var(--apple-text-primary)' }}>
          Leads
        </h1>
        <p className="text-[13px] mt-1" style={{ color: 'var(--apple-text-tertiary)' }}>
          {data.total} total
        </p>
      </div>

      <LeadsFilter />

      {/* Table */}
      <div className="apple-card overflow-hidden">
        {/* Header */}
        <div
          className="grid grid-cols-[2fr_1.5fr_1fr_1fr_1fr_20px] px-5 py-2.5"
          style={{
            background: 'rgba(0,0,0,0.025)',
            borderBottom: '1px solid var(--apple-separator)',
          }}
        >
          {['Lead','Title','Stage','First Touch','Assigned To',''].map((h, i) => (
            <div
              key={i}
              className={`text-[11px] font-semibold uppercase tracking-[0.07em] ${i === 5 ? '' : ''}`}
              style={{ color: 'var(--apple-text-tertiary)' }}
            >
              {h}
            </div>
          ))}
        </div>

        {/* Empty state */}
        {data.data.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 text-center">
            <div className="text-[15px] font-medium" style={{ color: 'var(--apple-text-secondary)' }}>
              No leads match this filter
            </div>
            <div className="text-[13px] mt-1" style={{ color: 'var(--apple-text-tertiary)' }}>
              Try a different stage or date range
            </div>
          </div>
        ) : (
          data.data.map(lead => {
            const stageConf  = STAGE_CONFIG[lead.stage] ?? { label: lead.stage, bg: 'rgba(0,0,0,0.06)', color: 'rgba(0,0,0,0.5)' }
            const name       = lead.name  || (lead as any).email || 'Unknown'
            const company    = lead.company || (lead as any).email?.split('@')[1] || '—'
            const avatarColor = getAvatarColor(name)

            return (
              <Link
                key={lead.id}
                href={`/leads/${lead.id}`}
                className="grid grid-cols-[2fr_1.5fr_1fr_1fr_1fr_20px] px-5 py-3.5 items-center finder-row group apple-focus outline-none"
              >
                {/* Lead */}
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{
                      background: avatarColor,
                      boxShadow: '0 0 0 2px rgba(255,255,255,0.85)',
                    }}
                  >
                    <span className="text-[10px] font-bold text-white">{getInitials(name)}</span>
                  </div>
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold truncate" style={{ color: 'var(--apple-text-primary)' }}>
                      {name}
                    </div>
                    <div className="text-[11px] truncate" style={{ color: 'var(--apple-text-tertiary)' }}>
                      {company}
                    </div>
                  </div>
                </div>

                {/* Title */}
                <div className="text-[13px] truncate pr-4" style={{ color: 'var(--apple-text-secondary)' }}>
                  {lead.title || '—'}
                </div>

                {/* Stage badge */}
                <div>
                  <span
                    className="inline-block px-2.5 py-[3px] rounded-full text-[11px] font-semibold"
                    style={{ background: stageConf.bg, color: stageConf.color }}
                  >
                    {stageConf.label}
                  </span>
                </div>

                {/* First touch */}
                <div><TouchBadge minutes={lead.timeToFirstTouchMin} /></div>

                {/* Assigned to */}
                <div className="flex items-center gap-2">
                  {lead.assignedTo ? (
                    <>
                      <div
                        className="w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center"
                        style={{
                          background: getAvatarColor(lead.assignedTo),
                          boxShadow: '0 0 0 1.5px rgba(255,255,255,0.85)',
                        }}
                      >
                        <span className="text-[9px] font-bold text-white">{getInitials(lead.assignedTo)}</span>
                      </div>
                      <span className="text-[13px] truncate" style={{ color: 'var(--apple-text-secondary)' }}>
                        {lead.assignedTo}
                      </span>
                    </>
                  ) : (
                    <span className="text-[12px] italic" style={{ color: 'var(--apple-text-tertiary)' }}>
                      Unassigned
                    </span>
                  )}
                </div>

                {/* Chevron — translates right on hover */}
                <ChevronRight
                  size={14}
                  strokeWidth={2}
                  className="transition-transform duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)] group-hover:translate-x-1"
                  style={{ color: 'var(--apple-text-tertiary)' }}
                />
              </Link>
            )
          })
        )}
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <div className="text-[13px]" style={{ color: 'var(--apple-text-tertiary)' }}>
          Showing {Math.min((page - 1) * data.limit + 1, data.total)}–{Math.min(page * data.limit, data.total)} of {data.total}
        </div>
        <div className="flex gap-2">
          {page > 1 && (
            <Link
              href={`/leads?page=${page - 1}${stage ? `&stage=${stage}` : ''}${dateRange ? `&dateRange=${dateRange}` : ''}`}
              className="px-4 py-2 rounded-[10px] text-[13px] font-medium transition-all duration-150 apple-button-press apple-focus outline-none"
              style={{
                background: 'rgba(255,255,255,0.70)',
                border: '1px solid rgba(0,0,0,0.10)',
                color: 'var(--apple-blue)',
                backdropFilter: 'blur(8px)',
              }}
            >
              ← Previous
            </Link>
          )}
          {page * data.limit < data.total && (
            <Link
              href={`/leads?page=${page + 1}${stage ? `&stage=${stage}` : ''}${dateRange ? `&dateRange=${dateRange}` : ''}`}
              className="px-4 py-2 rounded-[10px] text-[13px] font-medium transition-all duration-150 apple-button-press apple-focus outline-none"
              style={{
                background: 'rgba(255,255,255,0.70)',
                border: '1px solid rgba(0,0,0,0.10)',
                color: 'var(--apple-blue)',
                backdropFilter: 'blur(8px)',
              }}
            >
              Next →
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}
