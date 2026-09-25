import { apiFetch } from '@/lib/api'
import { getServerToken } from '@/lib/auth'
import { ConnectorHealth, PolicyRule } from '@/types/api'
import { SlaForm } from './sla-form'
import { CheckCircle2, XCircle, Globe, ArrowRight, AlertTriangle } from 'lucide-react'

export const dynamic = 'force-dynamic'

const CONNECTOR_DISPLAY: Record<string, { label: string; description: string; emoji: string }> = {
  hubspot:    { label: 'HubSpot',    description: 'Inbound webhook source',  emoji: '🟠' },
  salesforce: { label: 'Salesforce', description: 'CRM & task creation',     emoji: '🔵' },
  outreach:   { label: 'Outreach',   description: 'Sequence enrollment',     emoji: '🟣' },
  clearbit:   { label: 'Clearbit',   description: 'Lead enrichment',         emoji: '🟡' },
}

export default async function SettingsPage() {
  let connectors: ConnectorHealth[]
  let policies: PolicyRule[]
  const token = getServerToken()

  try {
    const [cr, pr] = await Promise.all([
      apiFetch('/api/connectors', token),
      apiFetch('/api/policies',   token),
    ])
    if (!cr.ok || !pr.ok) throw new Error('Failed')
    connectors = await cr.json()
    policies   = await pr.json()
  } catch (e: any) {
    return (
      <div className="flex flex-col gap-6 animate-fade-in">
        <h1 className="text-[28px] font-bold tracking-tight" style={{ color: 'var(--apple-text-primary)' }}>
          System Health
        </h1>
        <div
          className="rounded-2xl p-5 flex items-start gap-3"
          style={{ background: 'rgba(255,59,48,0.07)', border: '1px solid rgba(255,59,48,0.15)' }}
        >
          <AlertTriangle size={18} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--apple-red)' }} />
          <div>
            <div className="text-[15px] font-semibold" style={{ color: 'var(--apple-red)' }}>Unavailable</div>
            <div className="text-[13px] mt-1" style={{ color: 'var(--apple-text-secondary)' }}>
              {e?.message ?? 'Failed to load settings'}
            </div>
          </div>
        </div>
      </div>
    )
  }

  const slaPolicy      = policies.find(p => p.rule_type === 'sla')
  const territoryRules = policies.filter(p => p.rule_type === 'territory')
  const healthyCount   = connectors.filter(c => c.status === 'healthy').length

  return (
    <div className="flex flex-col gap-7 max-w-2xl animate-fade-in">

      {/* ── Page header ─────────────────────────────────────────── */}
      <div>
        <h1 className="text-[28px] font-bold tracking-tight" style={{ color: 'var(--apple-text-primary)' }}>
          System Health
        </h1>
        <p className="text-[13px] mt-1" style={{ color: 'var(--apple-text-tertiary)' }}>
          {healthyCount}/{connectors.length} connectors healthy · Policies v1
        </p>
      </div>

      {/* ── Connectors — iOS Inset Grouped List ─────────────────── */}
      <section>
        <div
          className="text-[11px] font-semibold uppercase tracking-[0.07em] mb-2 px-1"
          style={{ color: 'var(--apple-text-tertiary)' }}
        >
          Connectors
        </div>

        {/* Inset group wrapper */}
        <div className="apple-inset-group">
          {connectors.map((conn, i) => {
            const display = CONNECTOR_DISPLAY[conn.name] ?? { label: conn.name, description: '', emoji: '⚪' }
            const isOk    = conn.status === 'healthy'
            return (
              <div
                key={conn.name}
                className="apple-inset-row"
                style={{
                  borderRadius:
                    i === 0 && connectors.length === 1 ? '10px'
                    : i === 0 ? '10px 10px 0 0'
                    : i === connectors.length - 1 ? '0 0 10px 10px'
                    : '0',
                }}
              >
                {/* Icon area */}
                <div
                  className="w-9 h-9 rounded-[10px] flex items-center justify-center flex-shrink-0 text-[18px]"
                  style={{
                    background: isOk ? 'rgba(52,199,89,0.10)' : 'rgba(255,59,48,0.08)',
                    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.5)',
                  }}
                >
                  {display.emoji}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="text-[15px] font-medium" style={{ color: 'var(--apple-text-primary)' }}>
                    {display.label}
                  </div>
                  <div className="text-[12px]" style={{ color: 'var(--apple-text-tertiary)' }}>
                    {display.description}
                  </div>
                </div>

                {/* Status badge */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span
                    className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold"
                    style={
                      isOk
                        ? { background: 'rgba(52,199,89,0.12)', color: 'var(--apple-green)' }
                        : { background: 'rgba(255,59,48,0.10)', color: 'var(--apple-red)' }
                    }
                  >
                    {isOk
                      ? <CheckCircle2 size={10} strokeWidth={2.5} />
                      : <XCircle size={10} strokeWidth={2.5} />}
                    {isOk ? 'Connected' : 'Not configured'}
                  </span>
                  <span className="text-[11px] tabular-nums" style={{ color: 'var(--apple-text-tertiary)' }}>
                    {new Date(conn.lastChecked).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* ── SLA Policy — Inset Grouped ───────────────────────────── */}
      <section>
        <div
          className="text-[11px] font-semibold uppercase tracking-[0.07em] mb-2 px-1"
          style={{ color: 'var(--apple-text-tertiary)' }}
        >
          SLA Policy
        </div>

        <div className="apple-inset-group">
          <div className="apple-inset-row flex-col items-start gap-3" style={{ borderRadius: 10 }}>
            <div>
              <div className="text-[15px] font-medium" style={{ color: 'var(--apple-text-primary)' }}>
                {slaPolicy?.name ?? 'Standard SLA'}
              </div>
              <div className="text-[12px] mt-0.5" style={{ color: 'var(--apple-text-tertiary)' }}>
                Leads must be contacted within this window from the form submission moment.
                Missing this deadline triggers an escalation.
              </div>
            </div>
            {slaPolicy ? (
              <SlaForm ruleId={slaPolicy.id} initialMinutes={slaPolicy.sla_minutes || 15} token={token} />
            ) : (
              <div className="text-[13px] italic" style={{ color: 'var(--apple-text-tertiary)' }}>
                No SLA policy found in database
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── Territory Rules — Inset Grouped ─────────────────────── */}
      <section>
        <div
          className="text-[11px] font-semibold uppercase tracking-[0.07em] mb-2 px-1"
          style={{ color: 'var(--apple-text-tertiary)' }}
        >
          Territory Routing Rules
        </div>

        {territoryRules.length === 0 ? (
          <div className="apple-inset-group">
            <div className="apple-inset-row flex-col items-center py-8 gap-2 text-center" style={{ borderRadius: 10 }}>
              <Globe size={28} strokeWidth={1.25} style={{ color: 'var(--apple-text-tertiary)', opacity: 0.5 }} />
              <div className="text-[13px] font-medium" style={{ color: 'var(--apple-text-secondary)' }}>
                No territory rules configured
              </div>
              <div className="text-[12px]" style={{ color: 'var(--apple-text-tertiary)' }}>
                All qualified leads use round-robin assignment
              </div>
            </div>
          </div>
        ) : (
          <div className="apple-inset-group">
            {territoryRules.map((rule, i) => (
              <div
                key={rule.id}
                className="apple-inset-row"
                style={{
                  borderRadius:
                    i === 0 && territoryRules.length === 1 ? '10px'
                    : i === 0 ? '10px 10px 0 0'
                    : i === territoryRules.length - 1 ? '0 0 10px 10px'
                    : '0',
                }}
              >
                <div
                  className="w-8 h-8 rounded-[8px] flex items-center justify-center flex-shrink-0"
                  style={{ background: 'rgba(88,86,214,0.10)' }}
                >
                  <Globe size={16} strokeWidth={1.75} style={{ color: '#5856D6' }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[15px] font-medium" style={{ color: 'var(--apple-text-primary)' }}>
                    {rule.name}
                  </div>
                  <div className="text-[12px]" style={{ color: 'var(--apple-text-tertiary)' }}>
                    {rule.conditions_summary}
                  </div>
                </div>
                {rule.queue_assigned && (
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <ArrowRight size={12} style={{ color: 'var(--apple-text-tertiary)' }} />
                    <span
                      className="px-2 py-0.5 rounded-md text-[11px] font-mono font-medium"
                      style={{ background: 'rgba(0,0,0,0.05)', color: 'var(--apple-text-secondary)' }}
                    >
                      {rule.queue_assigned}
                    </span>
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
