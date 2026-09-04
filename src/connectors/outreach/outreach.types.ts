/**
 * outreach.types.ts
 * Outreach-specific types for the GTM Autopilot connector.
 */

// ─── Outreach Config ──────────────────────────────────────────────────────────

export type OutreachConfig = {
  apiKey: string  // OUTREACH_API_KEY
}

// ─── Outreach Entities ────────────────────────────────────────────────────────

export type OutreachProspect = {
  id: string
  type: 'prospect'
  attributes: {
    emails: string[]
    firstName: string | null
    lastName: string | null
    title: string | null
    phoneNumbers: string[]
    createdAt: string
    updatedAt: string
  }
  relationships: {
    owner?: { data: { id: string; type: 'user' } | null }
  }
}

export type OutreachSequence = {
  id: string
  type: 'sequence'
  attributes: {
    name: string
    enabled: boolean
    currentState: string
    daysInState: number
  }
}

export type OutreachTask = {
  id: string
  type: 'task'
  attributes: {
    subject: string
    dueAt: string | null
    completedAt: string | null
    state: string
    taskType: string
    createdAt: string
  }
}

// ─── Input Types ──────────────────────────────────────────────────────────────

export type CreateProspectInput = {
  email: string
  firstName?: string
  lastName?: string
  title?: string
  phone?: string
  ownerId?: string
}

export type CreateTaskInput = {
  subject: string
  taskType?: string
  dueAt?: string   // ISO 8601
}

// ─── Outreach API Response Types ──────────────────────────────────────────────

export type OutreachApiResponse<T> = {
  data: T
  meta?: Record<string, unknown>
}

export type OutreachApiListResponse<T> = {
  data: T[]
  meta?: { count: number; nextPageLink?: string }
}

export type OutreachErrorResponse = {
  errors: Array<{
    id: string
    title: string
    detail: string
    status: string
  }>
}
