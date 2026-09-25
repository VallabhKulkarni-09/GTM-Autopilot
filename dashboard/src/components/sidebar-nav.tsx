'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Users, Settings, Zap } from 'lucide-react'

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Overview',  icon: LayoutDashboard },
  { href: '/leads',     label: 'Leads',     icon: Users },
  { href: '/settings',  label: 'Settings',  icon: Settings },
]

export function SidebarNav() {
  const pathname = usePathname()

  return (
    <aside className="fixed left-0 top-0 h-screen w-60 bg-white border-r border-gray-100 flex flex-col z-40">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-gray-100">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center">
            <Zap className="w-4 h-4 text-white" strokeWidth={2.5} />
          </div>
          <div>
            <div className="text-sm font-semibold text-gray-900 leading-none">GTM Autopilot</div>
            <div className="text-[10px] text-gray-400 mt-0.5 uppercase tracking-wider">Decision Layer</div>
          </div>
        </div>
      </div>

      {/* Nav links */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const isActive = pathname === href || pathname.startsWith(href + '/')
          return (
            <Link
              key={href}
              href={href}
              className={`
                flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors duration-100
                ${isActive
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                }
              `}
            >
              <Icon
                className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-blue-600' : 'text-gray-400'}`}
                strokeWidth={isActive ? 2.5 : 2}
              />
              {label}
              {isActive && (
                <div className="ml-auto w-1 h-4 rounded-full bg-blue-600" />
              )}
            </Link>
          )
        })}
      </nav>

      {/* Bottom status */}
      <div className="px-5 py-4 border-t border-gray-100">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-xs text-gray-500">System operational</span>
        </div>
      </div>
    </aside>
  )
}
