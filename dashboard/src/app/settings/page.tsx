import { apiFetch } from '@/lib/api'
import { getServerToken } from '@/lib/auth'
import { ConnectorHealth, PolicyRule } from '@/types/api'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { SlaForm } from './sla-form'

const STATUS_COLORS: Record<string, string> = {
  healthy: 'bg-emerald-500',
  degraded: 'bg-amber-500',
  unhealthy: 'bg-red-500'
}

export default async function SettingsPage() {
  let connectors: ConnectorHealth[]
  let policies: PolicyRule[]
  const token = getServerToken()
  
  try {
    const [connRes, polRes] = await Promise.all([
      apiFetch('/api/connectors', token),
      apiFetch('/api/policies', token)
    ])
    
    if (!connRes.ok || !polRes.ok) throw new Error('Failed to fetch')
    
    connectors = await connRes.json()
    policies = await polRes.json()
  } catch (error) {
    // Mock data
    connectors = [
      { name: 'Salesforce', status: 'healthy', lastChecked: new Date().toISOString() },
      { name: 'HubSpot', status: 'healthy', lastChecked: new Date().toISOString() },
      { name: 'Outreach', status: 'degraded', lastChecked: new Date(Date.now() - 300000).toISOString() },
      { name: 'Clearbit', status: 'healthy', lastChecked: new Date().toISOString() },
    ]
    policies = [
      { id: '1', rule_type: 'sla', name: 'Standard SLA', conditions_summary: 'All leads', sla_minutes: 15 },
      { id: '2', rule_type: 'territory', name: 'US West', conditions_summary: 'State in (CA, OR, WA, NV)', queue_assigned: 'us_west_sdr' },
      { id: '3', rule_type: 'territory', name: 'EMEA', conditions_summary: 'Country in (UK, FR, DE)', queue_assigned: 'emea_sdr' },
      { id: '4', rule_type: 'escalation', name: 'Manager Alert', conditions_summary: 'SLA Breached', queue_assigned: 'manager_slack_channel' }
    ]
  }

  const slaPolicy = policies.find(p => p.rule_type === 'sla')
  const territoryRules = policies.filter(p => p.rule_type === 'territory')
  const escalationPolicy = policies.find(p => p.rule_type === 'escalation')

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      <h1 className="text-3xl font-bold">Settings</h1>

      <section>
        <h2 className="text-xl font-bold mb-4">Connector Health</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {connectors.map(conn => (
            <Card key={conn.name}>
              <CardContent className="pt-6">
                <div className="flex items-center space-x-2 mb-2">
                  <div className={`w-3 h-3 rounded-full ${STATUS_COLORS[conn.status] || 'bg-gray-400'}`}></div>
                  <div className="font-bold">{conn.name}</div>
                </div>
                <div className="text-xs text-gray-500">
                  Last checked: {new Date(conn.lastChecked).toLocaleTimeString()}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-xl font-bold mb-4">SLA Configuration</h2>
        <Card>
          <CardContent className="pt-6">
            {slaPolicy ? (
              <SlaForm ruleId={slaPolicy.id} initialMinutes={slaPolicy.sla_minutes || 15} token={token} />
            ) : (
              <div className="text-gray-500">No SLA policy found</div>
            )}
          </CardContent>
        </Card>
      </section>

      <section>
        <h2 className="text-xl font-bold mb-4">Routing Rules</h2>
        <div className="space-y-4">
          {territoryRules.map(rule => (
            <Card key={rule.id}>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg">{rule.name}</CardTitle>
                <CardDescription>{rule.conditions_summary}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center">
                  <span className="text-sm text-gray-500 mr-2">Routes to queue:</span>
                  <Badge variant="outline">{rule.queue_assigned}</Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-xl font-bold mb-4">Escalation</h2>
        <Card>
          <CardContent className="pt-6">
            {escalationPolicy ? (
              <div>
                <h3 className="font-bold mb-1">{escalationPolicy.name}</h3>
                <p className="text-sm text-gray-600 mb-2">{escalationPolicy.conditions_summary}</p>
                <div className="flex items-center mt-2">
                  <span className="text-sm text-gray-500 mr-2">Escalates to:</span>
                  <Badge variant="outline">{escalationPolicy.queue_assigned}</Badge>
                </div>
              </div>
            ) : (
              <div className="text-gray-500">No escalation policy found</div>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  )
}
