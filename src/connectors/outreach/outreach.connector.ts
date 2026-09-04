/**
 * outreach.connector.ts
 * Outreach connector implementing Connector<OutreachConfig>.
 * Credentials: OUTREACH_API_KEY
 */

import { Connector, ConnectorError, ConnectorHealth, withRetry } from '../base.js'
import { OutreachErrorCode } from './outreach.errors.js'
import type {
  OutreachConfig, OutreachProspect, OutreachSequence, OutreachTask,
  CreateProspectInput, CreateTaskInput,
  OutreachApiResponse, OutreachApiListResponse,
} from './outreach.types.js'

const OR_BASE = 'https://api.outreach.io/api/v2'

export class OutreachConnector implements Connector<OutreachConfig> {
  readonly name = 'outreach' as const
  readonly version = '1.0.0'
  private config: OutreachConfig | null = null

  async connect(config: OutreachConfig): Promise<void> { this.config = config }
  async disconnect(): Promise<void> { this.config = null }

  async healthCheck(): Promise<ConnectorHealth> {
    const start = Date.now()
    try {
      const res = await fetch(`${OR_BASE}/sequences?page[size]=1`, { headers: this.headers() })
      if (!res.ok) throw new Error(`Status ${res.status}`)
      return { ok: true, latencyMs: Date.now() - start, lastChecked: new Date() }
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - start, lastChecked: new Date(), error: String(err) }
    }
  }

  /** Returns null (not throws) when prospect not found. */
  async getProspectByEmail(email: string): Promise<OutreachProspect | null> {
    return withRetry(this.name, OutreachErrorCode.PROSPECT_SEARCH_FAILED, async () => {
      this.assertConnected()
      const res = await fetch(`${OR_BASE}/prospects?filter[emails]=${encodeURIComponent(email)}&page[size]=1`, {
        headers: this.headers(),
      })
      if (!res.ok) {
        const raw = await res.text()
        throw new ConnectorError(this.name, OutreachErrorCode.PROSPECT_SEARCH_FAILED, res.status, raw, `Outreach prospect search failed for ${email}`)
      }
      const data = await res.json() as OutreachApiListResponse<OutreachProspect>
      return data.data.length === 0 ? null : data.data[0]
    })
  }

  async createProspect(input: CreateProspectInput, idempotencyKey: string): Promise<OutreachProspect> {
    return withRetry(this.name, OutreachErrorCode.PROSPECT_CREATE_FAILED, async () => {
      this.assertConnected()
      const body = {
        data: {
          type: 'prospect',
          attributes: {
            emails: [input.email],
            firstName: input.firstName,
            lastName: input.lastName,
            title: input.title,
            phoneNumbers: input.phone ? [input.phone] : [],
            tags: [`idempotency:${idempotencyKey}`],
          },
          relationships: input.ownerId ? {
            owner: { data: { type: 'user', id: input.ownerId } },
          } : undefined,
        },
      }
      const res = await fetch(`${OR_BASE}/prospects`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const raw = await res.text()
        throw new ConnectorError(this.name, OutreachErrorCode.PROSPECT_CREATE_FAILED, res.status, raw, 'Failed to create Outreach prospect')
      }
      const data = await res.json() as OutreachApiResponse<OutreachProspect>
      return data.data
    })
  }

  async enrollInSequence(prospectId: string, sequenceId: string, idempotencyKey: string): Promise<void> {
    await withRetry(this.name, OutreachErrorCode.SEQUENCE_ENROLL_FAILED, async () => {
      this.assertConnected()
      const body = {
        data: {
          type: 'sequenceState',
          attributes: { state: 'active', tags: [`idempotency:${idempotencyKey}`] },
          relationships: {
            prospect: { data: { type: 'prospect', id: prospectId } },
            sequence: { data: { type: 'sequence', id: sequenceId } },
          },
        },
      }
      const res = await fetch(`${OR_BASE}/sequenceStates`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const raw = await res.text()
        throw new ConnectorError(this.name, OutreachErrorCode.SEQUENCE_ENROLL_FAILED, res.status, raw, `Failed to enroll prospect ${prospectId} in sequence ${sequenceId}`)
      }
    })
  }

  async getActiveSequences(prospectId: string): Promise<OutreachSequence[]> {
    return withRetry(this.name, OutreachErrorCode.SEQUENCE_LIST_FAILED, async () => {
      this.assertConnected()
      const res = await fetch(`${OR_BASE}/sequenceStates?filter[prospect][id]=${prospectId}&filter[state]=active`, {
        headers: this.headers(),
      })
      if (!res.ok) {
        const raw = await res.text()
        throw new ConnectorError(this.name, OutreachErrorCode.SEQUENCE_LIST_FAILED, res.status, raw, `Failed to get sequences for prospect ${prospectId}`)
      }
      const data = await res.json() as OutreachApiListResponse<OutreachSequence>
      return data.data
    })
  }

  async createTask(prospectId: string, task: CreateTaskInput, idempotencyKey: string): Promise<OutreachTask> {
    return withRetry(this.name, OutreachErrorCode.TASK_CREATE_FAILED, async () => {
      this.assertConnected()
      const body = {
        data: {
          type: 'task',
          attributes: {
            subject: task.subject,
            taskType: task.taskType ?? 'action',
            dueAt: task.dueAt,
            tags: [`idempotency:${idempotencyKey}`],
          },
          relationships: {
            prospect: { data: { type: 'prospect', id: prospectId } },
          },
        },
      }
      const res = await fetch(`${OR_BASE}/tasks`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const raw = await res.text()
        throw new ConnectorError(this.name, OutreachErrorCode.TASK_CREATE_FAILED, res.status, raw, `Failed to create task for prospect ${prospectId}`)
      }
      const data = await res.json() as OutreachApiResponse<OutreachTask>
      return data.data
    })
  }

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.config!.apiKey}`, 'Content-Type': 'application/vnd.api+json' }
  }
  private assertConnected(): void {
    if (!this.config) throw new ConnectorError(this.name, OutreachErrorCode.AUTH_FAILED, 401, null, 'Call connect() first')
  }
}

export function createOutreachConnector(): OutreachConnector {
  const c = new OutreachConnector()
  c.connect({ apiKey: process.env.OUTREACH_API_KEY! })
  return c
}
