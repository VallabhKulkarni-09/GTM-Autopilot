import type { Metadata } from 'next'
import './globals.css'
import { SidebarNav } from '@/components/sidebar-nav'

export const metadata: Metadata = {
  title: 'GTM Autopilot',
  description: 'GTM Decision Infrastructure',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased bg-[#F9FAFB] text-[#1C1C1E] min-h-screen" style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif" }}>
        <div className="flex min-h-screen">
          {/* Left sidebar */}
          <SidebarNav />

          {/* Main content */}
          <main className="flex-1 ml-60 p-8 max-w-[calc(100vw-240px)]">
            <div className="max-w-6xl mx-auto">
              {children}
            </div>
          </main>
        </div>
      </body>
    </html>
  )
}
