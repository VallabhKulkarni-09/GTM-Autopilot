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
  { value: '7d',  label: '7 days' },
  { value: '30d', label: '30 days' },
]

// iOS Segmented Control pill
function Pill({
  active,
  label,
  onClick,
  accentBlue = true,
}: {
  active: boolean
  label: string
  onClick: () => void
  accentBlue?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className="px-3 py-[5px] rounded-full text-[12px] font-semibold leading-none transition-all duration-200 ease-[cubic-bezier(0.25,0.1,0.25,1)] apple-button-press apple-focus outline-none"
      style={
        active
          ? {
              background: accentBlue ? 'var(--apple-blue)' : 'rgba(0,0,0,0.75)',
              color: '#fff',
              boxShadow: accentBlue
                ? '0 1px 4px rgba(0,122,255,0.4), inset 0 1px 0 rgba(255,255,255,0.2)'
                : '0 1px 4px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.1)',
            }
          : {
              background: 'rgba(255,255,255,0.65)',
              color: 'var(--apple-text-secondary)',
              border: '1px solid rgba(0,0,0,0.08)',
            }
      }
    >
      {label}
    </button>
  )
}

export function LeadsFilter() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const stage     = searchParams.get('stage')     || 'all'
  const dateRange = searchParams.get('dateRange') || 'all'

  const update = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString())
    value === 'all' ? params.delete(key) : params.set(key, value)
    params.set('page', '1')
    router.push(`/leads?${params.toString()}`)
  }

  return (
    <div className="flex flex-wrap items-center gap-5 mb-6">
      {/* Stage pills */}
      <div className="flex flex-wrap items-center gap-1.5">
        {STAGE_OPTIONS.map(opt => (
          <Pill
            key={opt.value}
            active={stage === opt.value}
            label={opt.label}
            onClick={() => update('stage', opt.value)}
            accentBlue
          />
        ))}
      </div>

      {/* Hairline divider */}
      <div className="w-px h-5 hidden sm:block" style={{ background: 'var(--apple-separator)' }} />

      {/* Date range pills */}
      <div className="flex items-center gap-1.5">
        {DATE_OPTIONS.map(opt => (
          <Pill
            key={opt.value}
            active={dateRange === opt.value}
            label={opt.label}
            onClick={() => update('dateRange', opt.value)}
            accentBlue={false}
          />
        ))}
      </div>
    </div>
  )
}
