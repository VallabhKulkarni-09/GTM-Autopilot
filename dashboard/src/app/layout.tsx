import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'GTM Autopilot Dashboard',
  description: 'GTM Decision Infrastructure',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="antialiased bg-gray-50 text-gray-900 min-h-screen">
        <nav className="border-b bg-white px-6 py-3 flex items-center space-x-6">
          <div className="font-bold text-lg mr-4">GTM Autopilot</div>
          <a href="/dashboard" className="text-gray-600 hover:text-gray-900">Dashboard</a>
          <a href="/leads" className="text-gray-600 hover:text-gray-900">Leads</a>
          <a href="/settings" className="text-gray-600 hover:text-gray-900">Settings</a>
        </nav>
        <main className="p-8 max-w-7xl mx-auto">
          {children}
        </main>
      </body>
    </html>
  )
}
