/**
 * lead.repo.ts
 * Repository functions for the leads table.
 * All queries are organization-scoped (no exceptions).
 */

import { getDb } from '../db/client.js'
import type { Lead, UpdateLead } from '../domain/db-types.js'

export const leadRepo = {
  async getById(organizationId: string, leadId: string): Promise<Lead | null> {
    const { data, error } = await getDb()
      .from('leads')
      .select('*')
      .eq('id', leadId)
      .eq('organization_id', organizationId)
      .single()
    if (error || !data) return null
    return data as Lead
  },

  async getByEmail(organizationId: string, email: string): Promise<Lead | null> {
    const { data, error } = await getDb()
      .from('leads')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('email', email)
      .limit(1)
      .single()
    if (error || !data) return null
    return data as Lead
  },

  /**
   * Returns true if another non-duplicate lead with the same email already exists
   * in this org. Pass excludeLeadId to prevent a freshly-inserted lead from
   * matching itself.
   */
  async isDuplicate(organizationId: string, email: string, excludeLeadId?: string): Promise<boolean> {
    let query = getDb()
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .eq('email', email)
      .eq('is_duplicate', false)
    if (excludeLeadId) {
      query = (query as any).neq('id', excludeLeadId)
    }
    const { count, error } = await (query as any)
    if (error) return false
    return (count ?? 0) > 0
  },

  async update(organizationId: string, leadId: string, data: UpdateLead): Promise<void> {
    const { error } = await getDb()
      .from('leads')
      .update(data)
      .eq('id', leadId)
      .eq('organization_id', organizationId)
    if (error) throw new Error(`[lead-repo] update failed: ${error.message}`)
  },

  async list(organizationId: string, opts: {
    page?: number
    limit?: number
    stage?: string
  } = {}): Promise<{ data: Lead[]; total: number }> {
    const { page = 1, limit = 50, stage } = opts
    const from = (page - 1) * limit

    let query = getDb()
      .from('leads')
      .select('*', { count: 'exact' })
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false })
      .range(from, from + limit - 1)

    if (stage) query = (query as any).eq('stage', stage)

    const { data, count, error } = await (query as any)
    if (error) throw new Error(`[lead-repo] list failed: ${error.message}`)
    return { data: (data ?? []) as Lead[], total: count ?? 0 }
  },
}
