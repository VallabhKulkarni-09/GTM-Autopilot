'use client'

import { useState } from 'react'
import { CheckCircle2, XCircle, Loader2, ChevronDown, ChevronUp, Eye, EyeOff } from 'lucide-react'

// ── Field definitions per connector ──────────────────────────────────────────
interface FieldDef {
  key: string
  label: string
  placeholder: string
  secret: boolean   // renders as password input
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
  outreach: [
    { key: 'apiKey', label: 'API Key', placeholder: 'your-outreach-api-key', secret: true },
  ],
  clearbit: [
    { key: 'apiKey', label: 'API Key', placeholder: 'sk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', secret: true },
  ],
}

type TestStatus = 'idle' | 'testing' | 'ok' | 'error'

interface Props {
  connectorName: string
  token: string
}

function SecretInput({
  value, onChange, placeholder, disabled,
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
  disabled?: boolean
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
        {show
          ? <EyeOff size={13} style={{ color: 'var(--apple-text-primary)' }} />
          : <Eye    size={13} style={{ color: 'var(--apple-text-primary)' }} />}
      </button>
    </div>
  )
}

export function ConnectorCredentialsForm({ connectorName, token }: Props) {
  const fields = CONNECTOR_FIELDS[connectorName] ?? []
  const [open,   setOpen]   = useState(false)
  const [values, setValues] = useState<Record<string, string>>({})
  const [status, setStatus] = useState<TestStatus>('idle')
  const [errMsg, setErrMsg] = useState('')

  const setValue = (key: string, val: string) =>
    setValues(prev => ({ ...prev, [key]: val }))

  const handleTest = async () => {
    setStatus('testing')
    setErrMsg('')
    try {
      const res = await fetch(`/api/connectors/${connectorName}/test`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(values),
      })
      const data = await res.json()
      if (res.ok && data.ok) {
        setStatus('ok')
        // Reset to idle after 4s
        setTimeout(() => setStatus('idle'), 4000)
      } else {
        setStatus('error')
        setErrMsg(data.error ?? data.message ?? 'Connection failed')
      }
    } catch (err) {
      setStatus('error')
      setErrMsg('Network error — check API server')
    }
  }

  const hasRequiredValues = fields
    .filter(f => !f.optional)
    .every(f => (values[f.key] ?? '').trim().length > 0)

  return (
    <div>
      {/* Expand/collapse trigger */}
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 text-[13px] font-medium transition-colors duration-150 apple-focus outline-none rounded-md px-1 -ml-1"
        style={{ color: open ? 'var(--apple-blue)' : 'var(--apple-text-secondary)' }}
      >
        {open
          ? <ChevronUp size={13} strokeWidth={2.5} />
          : <ChevronDown size={13} strokeWidth={2.5} />}
        {open ? 'Hide credentials' : 'Enter credentials'}
      </button>

      {/* Form body */}
      {open && (
        <div className="mt-3 space-y-3">
          {fields.map(field => (
            <div key={field.key}>
              <label
                className="block text-[11px] font-semibold mb-1"
                style={{ color: 'var(--apple-text-tertiary)' }}
              >
                {field.label}
                {field.optional && (
                  <span className="ml-1 font-normal" style={{ color: 'var(--apple-text-tertiary)', opacity: 0.6 }}>
                    (optional)
                  </span>
                )}
              </label>

              {field.secret ? (
                <SecretInput
                  value={values[field.key] ?? ''}
                  onChange={v => setValue(field.key, v)}
                  placeholder={field.placeholder}
                  disabled={status === 'testing'}
                />
              ) : (
                <input
                  type="text"
                  value={values[field.key] ?? ''}
                  onChange={e => setValue(field.key, e.target.value)}
                  placeholder={field.placeholder}
                  disabled={status === 'testing'}
                  className="w-full rounded-[8px] px-3 py-2 text-[13px] outline-none transition-all duration-150 disabled:opacity-50"
                  style={{
                    background: 'rgba(255,255,255,0.85)',
                    border: '1px solid rgba(0,0,0,0.12)',
                    color: 'var(--apple-text-primary)',
                  }}
                  onFocus={e => (e.currentTarget.style.border = '1px solid var(--apple-blue)', e.currentTarget.style.boxShadow = '0 0 0 3px rgba(0,122,255,0.12)')}
                  onBlur={e  => (e.currentTarget.style.border = '1px solid rgba(0,0,0,0.12)',  e.currentTarget.style.boxShadow = 'none')}
                />
              )}
            </div>
          ))}

          {/* Action row */}
          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={handleTest}
              disabled={!hasRequiredValues || status === 'testing'}
              className="flex items-center gap-1.5 px-4 py-[7px] rounded-[8px] text-[13px] font-semibold transition-all duration-150 active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed apple-focus outline-none"
              style={{
                background: 'var(--apple-blue)',
                color: '#fff',
                boxShadow: '0 1px 3px rgba(0,122,255,0.3), inset 0 1px 0 rgba(255,255,255,0.2)',
              }}
            >
              {status === 'testing' ? (
                <><Loader2 size={13} className="animate-spin" />Testing…</>
              ) : (
                'Test Connection'
              )}
            </button>

            {/* Result badge */}
            {status === 'ok' && (
              <span
                className="flex items-center gap-1.5 text-[12px] font-semibold animate-fade-in"
                style={{ color: 'var(--apple-green)' }}
              >
                <CheckCircle2 size={14} strokeWidth={2.5} />
                Connected
              </span>
            )}
            {status === 'error' && (
              <span
                className="flex items-center gap-1.5 text-[12px] font-semibold animate-fade-in"
                style={{ color: 'var(--apple-red)' }}
              >
                <XCircle size={14} strokeWidth={2.5} />
                {errMsg || 'Failed'}
              </span>
            )}
          </div>

          {/* Persistence note */}
          <p className="text-[11px]" style={{ color: 'var(--apple-text-tertiary)' }}>
            Credentials are validated live and not stored. To persist them, add to your Railway environment variables.
          </p>
        </div>
      )}
    </div>
  )
}
