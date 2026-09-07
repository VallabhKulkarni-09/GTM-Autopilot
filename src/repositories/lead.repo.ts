/**
 * lead.repo.ts
 * Repository functions for the leads table.
 * All queries are organization-scoped (no exceptions).
 */

import { createClient } from '@supabase/supabase-js'
import type { Lead, UpdateLead } from '../domain/db-types.js'

function getClient() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!)
}

export const leadRepo = {
  async getById(organizationId: string, leadId: string): Promise<Lead | null> {
    const { data, error } = await getClient()
      .from('leads')
      .select('*')
      .eq('id', leadId)
      .eq('organization_id', organizationId)
      .single()
    if (error || !data) return null
    return data as Lead
  },

  async getByEmail(organizationId: string, email: string): Promise<Lead | null> {
    const { data, error } = await getClient()
      .from('leads')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('email', email)
      .limit(1)
      .single()
    if (error || !data) return null
    return data as Lead
  },

  async isDuplicate(organizationId: string, email: string): Promise<boolean> {
    const { count, error } = await getClient()
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .eq('email', email)
      .eq('is_duplicate', false)
    if (error) return false
    return (count ?? 0) > 0
  },

  async update(organizationId: string, leadId: string, data: UpdateLead): Promise<void> {
    const { error } = await getClient()
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

    let query = getClient()
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
