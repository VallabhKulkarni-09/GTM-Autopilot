/**
 * hubspot.connector.ts
 * HubSpot connector implementing Connector<HubSpotConfig>.
 * Credentials: HUBSPOT_API_KEY, HUBSPOT_WEBHOOK_SECRET
 */

import { createHmac, timingSafeEqual } from 'crypto'
import { Connector, ConnectorError, ConnectorHealth, withRetry } from '../base.js'
import { HubSpotErrorCode } from './hubspot.errors.js'
import type { HubSpotConfig, HubSpotContact, HubSpotSearchResponse } from './hubspot.types.js'

const HS_BASE = 'https://api.hubapi.com'

export class HubSpotConnector implements Connector<HubSpotConfig> {
  readonly name = 'hubspot' as const
  readonly version = '1.0.0'
  private config: HubSpotConfig | null = null

  async connect(config: HubSpotConfig): Promise<void> { this.config = config }
  async disconnect(): Promise<void> { this.config = null }

  async healthCheck(): Promise<ConnectorHealth> {
    const start = Date.now()
    try {
      const res = await fetch(`${HS_BASE}/crm/v3/objects/contacts?limit=1`, { headers: this.headers() })
      if (!res.ok) throw new Error(`Status ${res.status}`)
      return { ok: true, latencyMs: Date.now() - start, lastChecked: new Date() }
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - start, lastChecked: new Date(), error: String(err) }
    }
  }

  /** Returns null (not throws) when contact is not found (404). */
  async getContactByEmail(email: string): Promise<HubSpotContact | null> {
    return withRetry(this.name, HubSpotErrorCode.CONTACT_SEARCH_FAILED, async () => {
      this.assertConnected()
      const res = await fetch(`${HS_BASE}/crm/v3/objects/contacts/search`, {
        method: 'POST',
        headers: { ...this.headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: email }] }],
          properties: ['email','firstname','lastname','jobtitle','phone','company','lifecyclestage','hs_lead_status'],
          limit: 1,
        }),
      })
      if (!res.ok) {
        const raw = await res.text()
        throw new ConnectorError(this.name, HubSpotErrorCode.CONTACT_SEARCH_FAILED, res.status, raw, `HubSpot search failed for ${email}`)
      }
      const data = await res.json() as HubSpotSearchResponse
      return data.total === 0 ? null : data.results[0]
    })
  }

  async updateContact(id: string, data: Partial<HubSpotContact>, idempotencyKey: string): Promise<void> {
    await withRetry(this.name, HubSpotErrorCode.CONTACT_UPDATE_FAILED, async () => {
      this.assertConnected()
      const res = await fetch(`${HS_BASE}/crm/v3/objects/contacts/${id}`, {
        method: 'PATCH',
        headers: { ...this.headers(), 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({ properties: data.properties ?? {} }),
      })
      if (res.status === 404) throw new ConnectorError(this.name, HubSpotErrorCode.CONTACT_NOT_FOUND, 404, '', `Contact ${id} not found`)
      if (!res.ok) {
        const raw = await res.text()
        throw new ConnectorError(this.name, HubSpotErrorCode.CONTACT_UPDATE_FAILED, res.status, raw, `Failed to update contact ${id}`)
      }
    })
  }

  async updateLifecycleStage(contactId: string, stage: string, idempotencyKey: string): Promise<void> {
    await withRetry(this.name, HubSpotErrorCode.LIFECYCLE_STAGE_UPDATE_FAILED, async () => {
      this.assertConnected()
      const res = await fetch(`${HS_BASE}/crm/v3/objects/contacts/${contactId}`, {
        method: 'PATCH',
        headers: { ...this.headers(), 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({ properties: { lifecyclestage: stage } }),
      })
      if (res.status === 404) throw new ConnectorError(this.name, HubSpotErrorCode.CONTACT_NOT_FOUND, 404, '', `Contact ${contactId} not found`)
      if (!res.ok) {
        const raw = await res.text()
        throw new ConnectorError(this.name, HubSpotErrorCode.LIFECYCLE_STAGE_UPDATE_FAILED, res.status, raw, `Failed to update lifecycle stage for ${contactId}`)
      }
    })
  }

  /**
   * SYNCHRONOUS. Pure crypto — never async, never calls HubSpot API.
   * Returns true if HMAC-SHA256 of payload matches signature.
   */
  verifyWebhookSignature(payload: string, signature: string, secret: string): boolean {
    if (!payload || !signature || !secret) return false
    try {
      const expected = createHmac('sha256', secret).update(payload).digest('hex')
      const sigBuf = Buffer.from(signature, 'hex')
      const expBuf = Buffer.from(expected, 'hex')
      if (sigBuf.length !== expBuf.length) return false
      return timingSafeEqual(sigBuf, expBuf)
    } catch { return false }
  }

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.config!.apiKey}`, 'Content-Type': 'application/json' }
  }

  private assertConnected(): void {
    if (!this.config) throw new ConnectorError(this.name, HubSpotErrorCode.AUTH_FAILED, 401, null, 'Call connect() first')
  }
}

export function createHubSpotConnector(): HubSpotConnector {
  const c = new HubSpotConnector()
  c.connect({ apiKey: process.env.HUBSPOT_API_KEY!, webhookSecret: process.env.HUBSPOT_WEBHOOK_SECRET! })
  return c
}
