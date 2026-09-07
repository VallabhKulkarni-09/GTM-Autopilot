import { describe, it, expect, vi, beforeEach } from 'vitest'
import { storeEnrichmentEvidence, getLeadEvidence } from '../evidence-store.js'
import { buildDecisionSnapshot } from '../context-builder.js'
import type { ClearbitPerson, ClearbitCompany } from '../../connectors/clearbit/clearbit.types.js'

// Mock Supabase
const mockInsert = vi.fn()
const mockSelect = vi.fn()
const mockEq = vi.fn()
const mockOr = vi.fn()
const mockOrder = vi.fn()
const mockSingle = vi.fn()

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: vi.fn(() => ({
      insert: mockInsert,
      select: mockSelect,
      eq: mockEq,
      or: mockOr,
      order: mockOrder,
    }))
  })
}))

describe('Evidence Store & Context Builder', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.SUPABASE_URL = 'http://localhost'
    process.env.SUPABASE_SERVICE_KEY = 'test-key'
    
    // Default chain for select
    mockSelect.mockReturnValue({ eq: mockEq })
    mockEq.mockReturnValue({ eq: mockEq, or: mockOr, single: mockSingle, order: mockOrder })
    mockOr.mockReturnValue({ order: mockOrder })
    mockOrder.mockReturnValue({ data: [], error: null })
  })

  describe('storeEnrichmentEvidence', () => {
    it('returns [] without crashing when person and company are null', async () => {
      const result = await storeEnrichmentEvidence('org-1', 'lead-1', 'comp-1', null, null)
      expect(result).toEqual([])
      expect(mockInsert).not.toHaveBeenCalled()
    })

    it('creates correct number of evidence rows from Clearbit response', async () => {
      const mockPerson: Partial<ClearbitPerson> = {
        id: 'cp-1',
        employment: { title: 'CEO', seniority: 'executive', role: 'leadership', domain: null, name: null, subRole: null },
        location: 'San Francisco'
      }
      const mockCompany: Partial<ClearbitCompany> = {
        id: 'cc-1',
        metrics: { employees: 100, estimatedAnnualRevenue: '1000000', alexaUsRank: null, alexaGlobalRank: null, marketCap: null, raised: null, annualRevenue: null, employeesRange: null, fiscalYearEnd: null },
        category: { industry: 'Software', sector: null, industryGroup: null, subIndustry: null, sicCode: null, naicsCode: null },
        geo: { country: 'US', streetNumber: null, streetName: null, subPremise: null, city: null, postalCode: null, state: null, stateCode: null, countryCode: null, lat: null, lng: null },
        type: 'private',
        tags: ['saas']
      }

      mockInsert.mockReturnValue({ select: vi.fn().mockResolvedValue({ data: [{ id: 'e-1' }], error: null }) })

      await storeEnrichmentEvidence('org-1', 'lead-1', 'comp-1', mockPerson as ClearbitPerson, mockCompany as ClearbitCompany)
      
      expect(mockInsert).toHaveBeenCalledTimes(1)
      const insertedRows = mockInsert.mock.calls[0][0]
      expect(insertedRows).toHaveLength(10) // 4 from person + 6 from company
    })

    it('sets expires_at to approximately NOW() + 30 days', async () => {
      const mockPerson: Partial<ClearbitPerson> = {
        id: 'cp-1',
        location: 'San Francisco' // 1 fact
      }
      
      mockInsert.mockReturnValue({ select: vi.fn().mockResolvedValue({ data: [], error: null }) })
      const before = new Date().getTime()
      await storeEnrichmentEvidence('org-1', 'lead-1', null, mockPerson as ClearbitPerson, null)
      const after = new Date().getTime()
      
      const insertedRows = mockInsert.mock.calls[0][0]
      const expiresAt = new Date(insertedRows[0].expires_at).getTime()
      
      const expectedTarget = before + 30 * 24 * 60 * 60 * 1000
      expect(Math.abs(expiresAt - expectedTarget)).toBeLessThan(1000) // within 1 second
    })
  })

  describe('getLeadEvidence', () => {
    it('filters out expired evidence (or condition is correctly formed)', async () => {
      await getLeadEvidence('org-1', 'lead-1')
      expect(mockOr).toHaveBeenCalled()
      const orArg = mockOr.mock.calls[0][0]
      expect(orArg).toContain('expires_at.is.null')
      expect(orArg).toContain('expires_at.gt.')
    })
  })

  describe('buildDecisionSnapshot', () => {
    it('throws if lead does not exist', async () => {
      mockSingle.mockResolvedValueOnce({ data: null, error: { message: 'Not found' } })
      
      await expect(buildDecisionSnapshot({
        organizationId: 'org-1',
        leadId: 'lead-1',
        workflowRunId: 'wr-1',
        agentName: 'AgentA',
        agentVersion: 'v1'
      })).rejects.toThrow('Lead not found: lead-1')
    })

    it('includes all required fields', async () => {
      // lead
      mockSingle.mockResolvedValueOnce({ data: { id: 'lead-1', company_id: 'comp-1' }, error: null })
      // company
      mockSingle.mockResolvedValueOnce({ data: { id: 'comp-1' }, error: null })
      
      // policies
      mockEq.mockReturnValueOnce({ data: [{ id: 'pol-1' }], error: null })
      
      // ownerWorkloads (status='running')
      mockEq.mockReturnValueOnce({ data: [{ assigned_owner_id: 'owner-1' }, { assigned_owner_id: 'owner-1' }], error: null })
      
      // evidenceIds
      mockOr.mockReturnValueOnce({ data: [{ id: 'ev-1' }, { id: 'ev-2' }], error: null })

      const snapshot = await buildDecisionSnapshot({
        organizationId: 'org-1',
        leadId: 'lead-1',
        workflowRunId: 'wr-1',
        agentName: 'AgentA',
        agentVersion: 'v1',
        promptVersion: 'p1',
        modelName: 'm1'
      })

      expect(snapshot.lead.id).toBe('lead-1')
      expect(snapshot.company?.id).toBe('comp-1')
      expect(snapshot.policies).toHaveLength(1)
      expect(snapshot.ownerWorkloads).toEqual({ 'owner-1': 2 })
      expect(snapshot.evidenceIds).toEqual(['ev-1', 'ev-2'])
      expect(snapshot.agentName).toBe('AgentA')
      expect(snapshot.agentVersion).toBe('v1')
      expect(snapshot.promptVersion).toBe('p1')
      expect(snapshot.modelName).toBe('m1')
    })
  })
})
