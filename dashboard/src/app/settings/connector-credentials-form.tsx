'use client'

import { useState, useEffect } from 'react'
import { CheckCircle2, XCircle, Loader2, ChevronDown, ChevronUp, Eye, EyeOff, ExternalLink } from 'lucide-react'

// ── Which connectors use OAuth2 redirect flow ─────────────────────────────────
// For these: show a "Connect with [Vendor]" button, not raw credential fields.
const OAUTH_CONNECTORS = new Set(['outreach', 'salesloft'])

// ── Credential field definitions for non-OAuth connectors ─────────────────────
interface FieldDef {
  key: string
  label: string
  placeholder: string
  secret: boolean
  optional?: boolean
}

const CONNECTOR_FIELDS: Record<string, FieldDef[]> = {
  hubspot: [
    { key: 'apiKey',        label: 'Private App Token',   placeholder: 'pat-na1-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', secret: true },
    { key: 'webhookSecret', label: 'Webhook Secret',      placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',         secret: true },
  ],
  salesforce: [
    { key: 'instanceUrl',  label: 'Instance URL',   placeholder: 'https://yourorg.salesforce.com',  secret: false },
    { key: 'clientId',     label: 'Client ID',      placeholder: 'Connected App Consumer Key',       secret: false },
    { key: 'clientSecret', label: 'Client Secret',  placeholder: 'Connected App Consumer Secret',    secret: true },
    { key: 'sandbox',      label: 'Sandbox mode',   placeholder: 'true or false',                    secret: false, optional: true },
  ],
  clearbit: [
    { key: 'apiKey', label: 'API Key', placeholder: 'sk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', secret: true },
  ],
  zoominfo: [
    { key: 'username', label: 'Username (email)',   placeholder: 'you@company.com',  secret: false },
    { key: 'password', label: 'Password',           placeholder: '••••••••••••••••', secret: true },
  ],
}

// ── OAuth connector display names ─────────────────────────────────────────────
const OAUTH_DISPLAY: Record<string, { label: string; color: string; startPath: string }> = {
  outreach: {
    label:     'Connect with Outreach',
    color:     '#6C3FCF',
    startPath: '/api/outreach/oauth/start',
  },
  salesloft: {
    label:     'Connect with Salesloft',
    color:     '#00B4D8',
    startPath: '/api/salesloft/oauth/start',
  },
}

type TestStatus = 'idle' | 'testing' | 'saving' | 'ok' | 'save_ok' | 'error'

interface Props {
  connectorName: string
  token: string
  isConnected?: boolean  // pre-determined from URL ?connected=... param
}

// ── SecretInput component ─────────────────────────────────────────────────────
function SecretInput({ value, onChange, placeholder, disabled }: {
  value: string; onChange: (v: string) => void; placeholder: string; disabled?: boolean
}) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="w-full rounded-[8px] px-3 py-2 text-[13px] pr-9 outline-none transition-all duration-150 disabled:opacity-50 focus:ring-2"
        style={{
          background: 'rgba(255,255,255,0.85)',
          border: '1px solid rgba(0,0,0,0.12)',
          color: 'var(--apple-text-primary)',
          fontFamily: show ? 'inherit' : 'monospace',
          caretColor: 'var(--apple-blue)',
        }}
        onFocus={e => (e.currentTarget.style.border = '1px solid var(--apple-blue)', e.currentTarget.style.boxShadow = '0 0 0 3px rgba(0,122,255,0.12)')}
        onBlur={e  => (e.currentTarget.style.border = '1px solid rgba(0,0,0,0.12)',  e.currentTarget.style.boxShadow = 'none')}
      />
      <button
        type="button"
        onClick={() => setShow(s => !s)}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 opacity-40 hover:opacity-70 transition-opacity"
        tabIndex={-1}
      >
        {show ? <EyeOff size={13} /> : <Eye size={13} />}
      </button>
    </div>
  )
}

// ── OAuthConnectorCard — "Connect with Vendor" button ────────────────────────
function OAuthConnectorCard({ connectorName, isConnected }: { connectorName: string; isConnected: boolean }) {
  const oauthCfg = OAUTH_DISPLAY[connectorName]
  if (!oauthCfg) return null

  const apiUrl    = process.env.NEXT_PUBLIC_API_URL ?? ''
  const startHref = `${apiUrl}${oauthCfg.startPath}`

  if (isConnected) {
    return (
      <div className="flex items-center gap-2 text-[13px]">
        <CheckCircle2 size={14} strokeWidth={2.5} style={{ color: 'var(--apple-green)' }} />
        <span style={{ color: 'var(--apple-green)', fontWeight: 600 }}>Connected</span>
        <a
          href={startHref}
          className="text-[12px] ml-2 underline underline-offset-2"
          style={{ color: 'var(--apple-text-tertiary)' }}
        >
          Reconnect
        </a>
      </div>
    )
  }

  return (
    <div>
      <a
        href={startHref}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-[8px] text-[13px] font-semibold text-white transition-all duration-150 active:scale-[0.97]"
        style={{ background: oauthCfg.color, boxShadow: `0 1px 3px ${oauthCfg.color}55` }}
      >
        {oauthCfg.label}
        <ExternalLink size={12} />
      </a>
      <p className="text-[11px] mt-2" style={{ color: 'var(--apple-text-tertiary)' }}>
        You will be redirected to {connectorName.charAt(0).toUpperCase() + connectorName.slice(1)} to authorize access.
        Your credentials are never stored in GTM Autopilot — only short-lived OAuth tokens, scoped to your org.
      </p>
    </div>
  )
}

// ── CredentialConnectorForm — input fields + Test + Save ──────────────────────
export function ConnectorCredentialsForm({ connectorName, token, isConnected = false }: Props) {
  // OAuth connectors: show OAuth button only
  if (OAUTH_CONNECTORS.has(connectorName)) {
    return (
      <OAuthConnectorCard connectorName={connectorName} isConnected={isConnected} />
    )
  }

  const fields = CONNECTOR_FIELDS[connectorName] ?? []
  const [open,   setOpen]   = useState(false)
  const [values, setValues] = useState<Record<string, string>>({})
  const [status, setStatus] = useState<TestStatus>('idle')
  const [errMsg, setErrMsg] = useState('')

  const setValue = (key: string, val: string) =>
    setValues(prev => ({ ...prev, [key]: val }))

  const hasRequiredValues = fields
    .filter(f => !f.optional)
    .every(f => (values[f.key] ?? '').trim().length > 0)

  const handleTest = async () => {
    setStatus('testing')
    setErrMsg('')
    try {
      const res = await fetch(`/api/connectors/${connectorName}/test`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify(values),
      })
      const data = await res.json()
      if (res.ok && data.ok) {
        setStatus('ok')
        setTimeout(() => setStatus('idle'), 4000)
      } else {
        setStatus('error')
        setErrMsg(data.error ?? data.message ?? 'Connection failed')
      }
    } catch {
      setStatus('error')
      setErrMsg('Network error — check API server')
    }
  }

  const handleSave = async () => {
    setStatus('saving')
    setErrMsg('')
    try {
      const res = await fetch(`/api/connectors/${connectorName}/save`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify(values),
      })
      const data = await res.json()
      if (res.ok && data.ok) {
        setStatus('save_ok')
        setTimeout(() => setStatus('idle'), 4000)
      } else {
        setStatus('error')
        setErrMsg(data.message ?? 'Save failed')
      }
    } catch {
      setStatus('error')
      setErrMsg('Network error — check API server')
    }
  }

  const isBusy = status === 'testing' || status === 'saving'

  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 text-[13px] font-medium transition-colors duration-150 apple-focus outline-none rounded-md px-1 -ml-1"
        style={{ color: open ? 'var(--apple-blue)' : 'var(--apple-text-secondary)' }}
      >
        {open ? <ChevronUp size={13} strokeWidth={2.5} /> : <ChevronDown size={13} strokeWidth={2.5} />}
        {open ? 'Hide credentials' : 'Enter credentials'}
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          {fields.map(field => (
            <div key={field.key}>
              <label className="block text-[11px] font-semibold mb-1" style={{ color: 'var(--apple-text-tertiary)' }}>
                {field.label}
                {field.optional && (
                  <span className="ml-1 font-normal" style={{ color: 'var(--apple-text-tertiary)', opacity: 0.6 }}>(optional)</span>
                )}
              </label>
              {field.secret ? (
                <SecretInput
                  value={values[field.key] ?? ''}
                  onChange={v => setValue(field.key, v)}
                  placeholder={field.placeholder}
                  disabled={isBusy}
                />
              ) : (
                <input
                  type="text"
                  value={values[field.key] ?? ''}
                  onChange={e => setValue(field.key, e.target.value)}
                  placeholder={field.placeholder}
                  disabled={isBusy}
                  className="w-full rounded-[8px] px-3 py-2 text-[13px] outline-none transition-all duration-150 disabled:opacity-50"
                  style={{ background: 'rgba(255,255,255,0.85)', border: '1px solid rgba(0,0,0,0.12)', color: 'var(--apple-text-primary)' }}
                  onFocus={e => (e.currentTarget.style.border = '1px solid var(--apple-blue)', e.currentTarget.style.boxShadow = '0 0 0 3px rgba(0,122,255,0.12)')}
                  onBlur={e  => (e.currentTarget.style.border = '1px solid rgba(0,0,0,0.12)',  e.currentTarget.style.boxShadow = 'none')}
                />
              )}
            </div>
          ))}

          <div className="flex items-center gap-3 pt-1 flex-wrap">
            {/* Test button */}
            <button
              onClick={handleTest}
              disabled={!hasRequiredValues || isBusy}
              className="flex items-center gap-1.5 px-4 py-[7px] rounded-[8px] text-[13px] font-semibold transition-all duration-150 active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed apple-focus outline-none"
              style={{ background: 'rgba(0,0,0,0.07)', color: 'var(--apple-text-primary)' }}
            >
              {status === 'testing' ? <><Loader2 size={13} className="animate-spin" />Testing…</> : 'Test Connection'}
            </button>

            {/* Save button */}
            <button
              onClick={handleSave}
              disabled={!hasRequiredValues || isBusy}
              className="flex items-center gap-1.5 px-4 py-[7px] rounded-[8px] text-[13px] font-semibold transition-all duration-150 active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed apple-focus outline-none"
              style={{ background: 'var(--apple-blue)', color: '#fff', boxShadow: '0 1px 3px rgba(0,122,255,0.3), inset 0 1px 0 rgba(255,255,255,0.2)' }}
            >
              {status === 'saving' ? <><Loader2 size={13} className="animate-spin" />Saving…</> : 'Save'}
            </button>

            {/* Status badges */}
            {status === 'ok' && (
              <span className="flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: 'var(--apple-green)' }}>
                <CheckCircle2 size={14} strokeWidth={2.5} /> Connected
              </span>
            )}
            {status === 'save_ok' && (
              <span className="flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: 'var(--apple-green)' }}>
                <CheckCircle2 size={14} strokeWidth={2.5} /> Saved
              </span>
            )}
            {status === 'error' && (
              <span className="flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: 'var(--apple-red)' }}>
                <XCircle size={14} strokeWidth={2.5} /> {errMsg || 'Failed'}
              </span>
            )}
          </div>

          <p className="text-[11px]" style={{ color: 'var(--apple-text-tertiary)' }}>
            Credentials are encrypted and stored per your organization. They are never shared across tenants.
          </p>
        </div>
      )}
    </div>
  )
}
