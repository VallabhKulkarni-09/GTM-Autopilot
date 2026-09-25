'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Users, Settings, Zap } from 'lucide-react'

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { href: '/leads',     label: 'Leads',    icon: Users },
  { href: '/settings',  label: 'Settings', icon: Settings },
]

export function SidebarNav() {
  const pathname = usePathname()

  return (
    <aside
      className="fixed left-0 top-0 h-screen w-60 z-40 flex flex-col"
      style={{
        background: 'var(--apple-bg-sidebar)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        borderRight: '1px solid rgba(0,0,0,0.08)',
      }}
    >
      {/* ── Logo ──────────────────────────────────────────── */}
      <div
        className="px-5 py-[18px]"
        style={{ borderBottom: '1px solid var(--apple-separator)' }}
      >
        <div className="flex items-center gap-3">
          {/* App icon — gradient rounded square */}
          <div
            className="w-8 h-8 rounded-[8px] flex items-center justify-center flex-shrink-0"
            style={{
              background: 'linear-gradient(145deg, #007AFF 0%, #5856D6 100%)',
              boxShadow: '0 2px 8px rgba(0,122,255,0.4), inset 0 1px 0 rgba(255,255,255,0.3)',
            }}
          >
            <Zap className="w-4 h-4 text-white" strokeWidth={2.5} />
          </div>
          <div>
            <div className="text-[13px] font-semibold leading-none tracking-tight"
              style={{ color: 'var(--apple-text-primary)' }}>
              GTM Autopilot
            </div>
            <div className="text-[10px] mt-0.5 uppercase tracking-widest"
              style={{ color: 'var(--apple-text-tertiary)' }}>
              Decision Layer
            </div>
          </div>
        </div>
      </div>

      {/* ── Navigation ────────────────────────────────────── */}
      <nav className="flex-1 px-2.5 py-3 space-y-0.5">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const isActive = pathname === href || pathname.startsWith(href + '/')
          return (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-2.5 px-3 py-[7px] rounded-[8px] transition-all duration-150 ease-[cubic-bezier(0.25,0.1,0.25,1)] apple-focus outline-none"
              style={
                isActive
                  ? {
                      background: 'rgba(0,0,0,0.09)',
                      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.5), 0 1px 2px rgba(0,0,0,0.04)',
                    }
                  : {}
              }
              onMouseEnter={e => {
                if (!isActive) (e.currentTarget as HTMLElement).style.background = 'rgba(0,0,0,0.05)'
              }}
              onMouseLeave={e => {
                if (!isActive) (e.currentTarget as HTMLElement).style.background = ''
              }}
            >
              <Icon
                className="w-4 h-4 flex-shrink-0 transition-colors duration-150"
                strokeWidth={isActive ? 2.5 : 1.75}
                style={{ color: isActive ? 'var(--apple-blue)' : 'var(--apple-text-secondary)' }}
              />
              <span
                className="text-[13px] font-medium leading-none"
                style={{ color: isActive ? 'var(--apple-text-primary)' : 'var(--apple-text-secondary)' }}
              >
                {label}
              </span>
            </Link>
          )
        })}
      </nav>

      {/* ── System Status ─────────────────────────────────── */}
      <div
        className="px-5 py-4"
        style={{ borderTop: '1px solid var(--apple-separator)' }}
      >
        <div className="flex items-center gap-2">
          {/* Pulsing green dot with glow ring */}
          <div className="relative flex-shrink-0">
            <div
              className="w-2 h-2 rounded-full"
              style={{ background: 'var(--apple-green)' }}
            />
            {/* Outer pulsing ring */}
            <div
              className="absolute inset-[-4px] rounded-full animate-pulse-ring"
              style={{ background: 'var(--apple-green)', opacity: 0.3 }}
            />
          </div>
          <span className="text-[11px]" style={{ color: 'var(--apple-text-tertiary)' }}>
            System operational
          </span>
        </div>
      </div>
    </aside>
  )
}
