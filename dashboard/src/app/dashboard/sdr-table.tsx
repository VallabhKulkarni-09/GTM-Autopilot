'use client'

import { useState } from 'react'
import { ChevronUp, ChevronDown, Users } from 'lucide-react'
import { SpeedToLeadDistribution } from '@/types/api'

function getAvatarColor(name: string): string {
  const colors = [
    '#007AFF', '#5856D6', '#34C759',
    '#FF9500', '#FF3B30', '#32ADE6', '#AF52DE',
  ]
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  return colors[Math.abs(hash) % colors.length]
}

function getInitials(name: string): string {
  return name.split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase()
}

function BarColor(pct: number): string {
  if (pct >= 80) return 'linear-gradient(90deg,#34C759,#30d158)'
  if (pct >= 50) return 'linear-gradient(90deg,#007AFF,#409CFF)'
  return 'linear-gradient(90deg,#FF9500,#FFB340)'
}

export function SdrTable({ stats }: { stats: SpeedToLeadDistribution['sdrStats'] }) {
  const [sortDesc, setSortDesc] = useState(true)

  const sorted = [...stats].sort((a, b) =>
    sortDesc ? b.under15MinPct - a.under15MinPct : a.under15MinPct - b.under15MinPct
  )

  // ── Empty state ──────────────────────────────────────────────────────────
  if (stats.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div
          className="w-12 h-12 rounded-2xl flex items-center justify-center mb-3"
          style={{ background: 'rgba(0,0,0,0.05)' }}
        >
          <Users size={22} strokeWidth={1.5} style={{ color: 'var(--apple-text-tertiary)' }} />
        </div>
        <div className="text-[15px] font-medium" style={{ color: 'var(--apple-text-secondary)' }}>
          No SDR data yet
        </div>
        <div className="text-[13px] mt-1 max-w-xs" style={{ color: 'var(--apple-text-tertiary)' }}>
          This table populates once leads are qualified and routed to a rep.
          Set up a Clearbit key and seed owners to see data here.
        </div>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-xl" style={{ border: '1px solid var(--apple-separator)' }}>
      {/* Table header */}
      <div
        className="grid grid-cols-4 px-4 py-2.5"
        style={{
          background: 'rgba(0,0,0,0.025)',
          borderBottom: '1px solid var(--apple-separator)',
        }}
      >
        {['Rep', 'Median Touch', '', 'Meetings'].map((col, i) =>
          i === 2 ? (
            <button
              key={i}
              className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.07em] transition-colors duration-150 apple-focus outline-none rounded"
              style={{ color: 'var(--apple-text-tertiary)' }}
              onClick={() => setSortDesc(!sortDesc)}
              onMouseEnter={e => ((e.currentTarget as HTMLElement).style.color = 'var(--apple-text-secondary)')}
              onMouseLeave={e => ((e.currentTarget as HTMLElement).style.color = 'var(--apple-text-tertiary)')}
            >
              % Under 15 min
              {sortDesc
                ? <ChevronDown size={11} strokeWidth={2.5} />
                : <ChevronUp size={11} strokeWidth={2.5} />}
            </button>
          ) : (
            <div
              key={i}
              className={`text-[11px] font-semibold uppercase tracking-[0.07em] ${i === 3 ? 'text-right' : ''}`}
              style={{ color: 'var(--apple-text-tertiary)' }}
            >
              {col}
            </div>
          )
        )}
      </div>

      {/* Rows */}
      {sorted.map((sdr, i) => {
        const color = getAvatarColor(sdr.name)
        const initials = getInitials(sdr.name)
        const isTop = i === 0 && sortDesc
        return (
          <div
            key={sdr.name}
            className="grid grid-cols-4 px-4 py-3 items-center finder-row transition-colors duration-150"
            style={
              isTop
                ? { background: 'rgba(0,122,255,0.05)' }
                : {}
            }
          >
            {/* Rep */}
            <div className="flex items-center gap-2.5">
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                style={{
                  background: color,
                  // Inner white ring — makes avatar pop off translucent bg
                  boxShadow: '0 0 0 2px rgba(255,255,255,0.85)',
                }}
              >
                <span className="text-[11px] font-bold text-white">{initials}</span>
              </div>
              <div>
                <div className="text-[13px] font-semibold" style={{ color: 'var(--apple-text-primary)' }}>
                  {sdr.name}
                </div>
                {isTop && (
                  <div className="text-[10px] font-semibold" style={{ color: 'var(--apple-blue)' }}>
                    Top performer
                  </div>
                )}
              </div>
            </div>

            {/* Median */}
            <div className="text-[13px] font-medium tabular-nums" style={{ color: 'var(--apple-text-secondary)' }}>
              {sdr.medianFirstTouchMin} min
            </div>

            {/* Progress + % */}
            <div className="flex items-center gap-2.5 pr-4">
              <div
                className="flex-1 h-1.5 rounded-full overflow-hidden"
                style={{ background: 'rgba(0,0,0,0.06)' }}
              >
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{
                    width: `${sdr.under15MinPct}%`,
                    background: BarColor(sdr.under15MinPct),
                  }}
                />
              </div>
              <span
                className="text-[13px] font-semibold tabular-nums w-9 text-right flex-shrink-0"
                style={{ color: 'var(--apple-text-primary)' }}
              >
                {sdr.under15MinPct}%
              </span>
            </div>

            {/* Meetings */}
            <div
              className="text-[13px] font-semibold tabular-nums text-right"
              style={{ color: 'var(--apple-text-primary)' }}
            >
              {sdr.meetingsBooked}
            </div>
          </div>
        )
      })}
    </div>
  )
}
