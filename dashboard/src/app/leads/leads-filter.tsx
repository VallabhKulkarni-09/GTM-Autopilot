'use client'

import { useRouter, useSearchParams } from 'next/navigation'

const STAGE_OPTIONS = [
  { value: 'all',            label: 'All' },
  { value: 'new',            label: 'New' },
  { value: 'routing',        label: 'Routing' },
  { value: 'in_sequence',    label: 'In Sequence' },
  { value: 'meeting_booked', label: 'Meeting Booked' },
  { value: 'nurture',        label: 'Nurture' },
  { value: 'lost',           label: 'Lost' },
]

const DATE_OPTIONS = [
  { value: 'all', label: 'All time' },
  { value: '7d',  label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
]

export function LeadsFilter() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const stage = searchParams.get('stage') || 'all'
  const dateRange = searchParams.get('dateRange') || 'all'

  const updateFilter = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString())
    if (value === 'all') {
      params.delete(key)
    } else {
      params.set(key, value)
    }
    params.set('page', '1')
    router.push(`/leads?${params.toString()}`)
  }

  return (
    <div className="flex flex-wrap items-center gap-6 mb-6">
      {/* Stage pill filters */}
      <div className="flex flex-wrap items-center gap-1.5">
        {STAGE_OPTIONS.map(opt => (
          <button
            key={opt.value}
            onClick={() => updateFilter('stage', opt.value)}
            className={`
              px-3 py-1.5 rounded-full text-xs font-semibold transition-all duration-100
              ${stage === opt.value
                ? 'bg-blue-600 text-white shadow-sm'
                : 'bg-white border border-gray-200 text-gray-600 hover:border-blue-300 hover:text-blue-700'
              }
            `}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Divider */}
      <div className="w-px h-5 bg-gray-200 hidden sm:block" />

      {/* Date range pills */}
      <div className="flex items-center gap-1.5">
        {DATE_OPTIONS.map(opt => (
          <button
            key={opt.value}
            onClick={() => updateFilter('dateRange', opt.value)}
            className={`
              px-3 py-1.5 rounded-full text-xs font-semibold transition-all duration-100
              ${dateRange === opt.value
                ? 'bg-gray-900 text-white shadow-sm'
                : 'bg-white border border-gray-200 text-gray-600 hover:border-gray-400 hover:text-gray-900'
              }
            `}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  )
}
