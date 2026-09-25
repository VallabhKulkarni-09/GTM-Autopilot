'use client'

import { useState } from 'react'
import { ChevronUp, ChevronDown, Users } from 'lucide-react'
import { SpeedToLeadDistribution } from '@/types/api'

function getAvatarColor(name: string): string {
  const colors = [
    'bg-blue-500', 'bg-violet-500', 'bg-emerald-500',
    'bg-amber-500', 'bg-rose-500', 'bg-cyan-500', 'bg-fuchsia-500',
  ]
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  return colors[Math.abs(hash) % colors.length]
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map(n => n[0])
    .join('')
    .toUpperCase()
}

export function SdrTable({ stats }: { stats: SpeedToLeadDistribution['sdrStats'] }) {
  const [sortDesc, setSortDesc] = useState(true)

  const sorted = [...stats].sort((a, b) =>
    sortDesc ? b.under15MinPct - a.under15MinPct : a.under15MinPct - b.under15MinPct
  )

  if (stats.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="w-12 h-12 rounded-2xl bg-gray-100 flex items-center justify-center mb-3">
          <Users className="w-6 h-6 text-gray-300" />
        </div>
        <div className="text-sm font-medium text-gray-500">No SDR data yet</div>
        <div className="text-xs text-gray-400 mt-1 max-w-xs">
          This table populates once leads are qualified and routed to a sales rep. 
          Set up a Clearbit key and seed owners to see data here.
        </div>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-xl border border-gray-100">
      {/* Table header */}
      <div className="grid grid-cols-4 px-4 py-3 bg-gray-50 border-b border-gray-100">
        <div className="text-xs font-semibold uppercase tracking-wider text-gray-400">Rep</div>
        <div className="text-xs font-semibold uppercase tracking-wider text-gray-400">Median Touch</div>
        <button
          className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-gray-500 hover:text-gray-900 transition-colors"
          onClick={() => setSortDesc(!sortDesc)}
        >
          % Under 15 min
          {sortDesc ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
        </button>
        <div className="text-xs font-semibold uppercase tracking-wider text-gray-400 text-right">Meetings</div>
      </div>

      {/* Rows */}
      {sorted.map((sdr, i) => {
        const avatarColor = getAvatarColor(sdr.name)
        const initials = getInitials(sdr.name)
        const isTop = i === 0 && sortDesc

        return (
          <div
            key={sdr.name}
            className={`grid grid-cols-4 px-4 py-3.5 items-center border-b border-gray-50 last:border-0 ${isTop ? 'bg-blue-50/40' : 'hover:bg-gray-50'} transition-colors`}
          >
            {/* Rep */}
            <div className="flex items-center gap-3">
              <div className={`w-8 h-8 rounded-full ${avatarColor} flex items-center justify-center flex-shrink-0`}>
                <span className="text-xs font-bold text-white">{initials}</span>
              </div>
              <div>
                <div className="text-sm font-medium text-gray-900">{sdr.name}</div>
                {isTop && <div className="text-[10px] text-blue-600 font-medium">Top performer</div>}
              </div>
            </div>

            {/* Median */}
            <div className="text-sm tabular-nums text-gray-700 font-medium">
              {sdr.medianFirstTouchMin} min
            </div>

            {/* Progress + % */}
            <div className="flex items-center gap-3 pr-4">
              <div className="flex-1 bg-gray-100 rounded-full h-1.5 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    sdr.under15MinPct >= 80 ? 'bg-emerald-500' :
                    sdr.under15MinPct >= 50 ? 'bg-blue-500' : 'bg-amber-400'
                  }`}
                  style={{ width: `${sdr.under15MinPct}%` }}
                />
              </div>
              <span className="text-sm font-semibold tabular-nums text-gray-700 w-10 text-right flex-shrink-0">
                {sdr.under15MinPct}%
              </span>
            </div>

            {/* Meetings */}
            <div className="text-sm font-semibold tabular-nums text-gray-900 text-right">
              {sdr.meetingsBooked}
            </div>
          </div>
        )
      })}
    </div>
  )
}
