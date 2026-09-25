import { apiFetch } from '@/lib/api'
import { getServerToken } from '@/lib/auth'
import { ConnectorHealth, PolicyRule } from '@/types/api'
import { SlaForm } from './sla-form'
import { CheckCircle2, XCircle, AlertTriangle, Globe, ArrowRight } from 'lucide-react'

export const dynamic = 'force-dynamic'

const CONNECTOR_DISPLAY: Record<string, { label: string; description: string }> = {
  hubspot:    { label: 'HubSpot',    description: 'Inbound webhook source' },
  salesforce: { label: 'Salesforce', description: 'CRM & task creation' },
  outreach:   { label: 'Outreach',   description: 'Sequence enrollment' },
  clearbit:   { label: 'Clearbit',   description: 'Lead enrichment' },
}

export default async function SettingsPage() {
  let connectors: ConnectorHealth[]
  let policies: PolicyRule[]
  const token = getServerToken()

  try {
    const [connRes, polRes] = await Promise.all([
      apiFetch('/api/connectors', token),
      apiFetch('/api/policies', token),
    ])
    if (!connRes.ok || !polRes.ok) throw new Error('Failed to fetch')
    connectors = await connRes.json()
    policies = await polRes.json()
  } catch (error: any) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-bold text-gray-900">System Health</h1>
        <div className="rounded-2xl border border-red-100 bg-red-50 p-6 text-red-800 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 mt-0.5 flex-shrink-0" />
          <div>
            <div className="font-semibold mb-1">Settings Unavailable</div>
            <div className="text-sm">{error?.message ?? 'Failed to load settings'}</div>
          </div>
        </div>
      </div>
    )
  }

  const slaPolicy = policies.find(p => p.rule_type === 'sla')
  const territoryRules = policies.filter(p => p.rule_type === 'territory')

  const healthyCount = connectors.filter(c => c.status === 'healthy').length
  const totalCount = connectors.length

  return (
    <div className="flex flex-col gap-8 max-w-3xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">System Health</h1>
        <p className="text-sm text-gray-400 mt-0.5">
          {healthyCount}/{totalCount} connectors healthy · Policies v1
        </p>
      </div>

      {/* Connectors */}
      <section>
        <div className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">Connectors</div>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          {connectors.map((conn, i) => {
            const display = CONNECTOR_DISPLAY[conn.name] ?? { label: conn.name, description: '' }
            const isHealthy = conn.status === 'healthy'
            return (
              <div
                key={conn.name}
                className={`flex items-center gap-4 px-5 py-4 ${i < connectors.length - 1 ? 'border-b border-gray-50' : ''}`}
              >
                {/* Status dot */}
                <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${isHealthy ? 'bg-emerald-500' : 'bg-red-400'}`} />

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-gray-900">{display.label}</div>
                  <div className="text-xs text-gray-400">{display.description}</div>
                </div>

                {/* Status badge */}
                <div className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${
                  isHealthy ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'
                }`}>
                  {isHealthy
                    ? <CheckCircle2 className="w-3 h-3" />
                    : <XCircle className="w-3 h-3" />
                  }
                  {isHealthy ? 'Connected' : 'Not configured'}
                </div>

                {/* Last checked */}
                <div className="text-xs text-gray-300 tabular-nums flex-shrink-0 w-20 text-right">
                  {new Date(conn.lastChecked).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* SLA Policy */}
      <section>
        <div className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">SLA Policy</div>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-start justify-between mb-4">
            <div>
              <div className="text-sm font-semibold text-gray-900">{slaPolicy?.name ?? 'Standard SLA'}</div>
              <div className="text-xs text-gray-400 mt-0.5">
                Leads must be contacted within the window below from the moment the form is submitted.
                Missing this deadline triggers an escalation.
              </div>
            </div>
          </div>
          {slaPolicy ? (
            <SlaForm ruleId={slaPolicy.id} initialMinutes={slaPolicy.sla_minutes || 15} token={token} />
          ) : (
            <div className="text-sm text-gray-400 italic">No SLA policy found in database</div>
          )}
        </div>
      </section>

      {/* Territory Routing Rules */}
      <section>
        <div className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">Territory Routing Rules</div>
        {territoryRules.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 text-center">
            <Globe className="w-8 h-8 text-gray-200 mx-auto mb-3" />
            <div className="text-sm font-medium text-gray-500">No territory rules configured</div>
            <div className="text-xs text-gray-400 mt-1">All qualified leads will use round-robin assignment</div>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            {territoryRules.map((rule, i) => (
              <div
                key={rule.id}
                className={`flex items-center gap-4 px-5 py-4 ${i < territoryRules.length - 1 ? 'border-b border-gray-50' : ''}`}
              >
                <div className="w-8 h-8 rounded-xl bg-violet-50 flex items-center justify-center flex-shrink-0">
                  <Globe className="w-4 h-4 text-violet-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-gray-900">{rule.name}</div>
                  <div className="text-xs text-gray-400 mt-0.5">{rule.conditions_summary}</div>
                </div>
                {rule.queue_assigned && (
                  <div className="flex items-center gap-1.5 text-xs text-gray-500 flex-shrink-0">
                    <ArrowRight className="w-3 h-3" />
                    <span className="px-2 py-0.5 rounded-md bg-gray-100 font-mono text-gray-700">{rule.queue_assigned}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
