import { describe, it, expect, vi, beforeEach } from 'vitest'
import { storeEnrichmentEvidence, getLeadEvidence } from '../evidence-store.js'
import { buildDecisionSnapshot } from '../context-builder.js'
import type { ClearbitPerson, ClearbitCompany } from '../../connectors/clearbit/clearbit.types.js'

// Mock Supabase
let mockData: any = {}
let mockError: any = null

const createMockChain = () => {
  const chain = {
    insert: vi.fn(() => chain),
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    or: vi.fn(() => chain),
    order: vi.fn(() => chain),
    single: vi.fn(() => {
      return Promise.resolve({ data: mockData, error: mockError })
    }),
    then: (resolve: any) => {
      resolve({ data: mockData, error: mockError })
    }
  }
  return chain
}

const mockFrom = vi.fn((table: string) => {
  if (table === 'leads') {
    mockData = { id: 'lead-1', company_id: 'comp-1' }
  } else if (table === 'companies') {
    mockData = { id: 'comp-1' }
  } else if (table === 'policy_rules') {
    mockData = [{ id: 'pol-1' }]
  } else if (table === 'play_instance') {
    mockData = [{ assigned_owner_id: 'owner-1' }, { assigned_owner_id: 'owner-1' }]
  } else if (table === 'evidence') {
    mockData = [{ id: 'ev-1', expires_at: new Date(Date.now() + 100000).toISOString() }, { id: 'ev-2' }]
  }
  return createMockChain()
})

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: mockFrom
  })
}))

describe('Evidence Store & Context Builder', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockData = null
    mockError = null
    process.env.SUPABASE_URL = 'http://localhost'
    process.env.SUPABASE_SERVICE_KEY = 'test-key'
  })

  describe('storeEnrichmentEvidence', () => {
    it('returns [] without crashing when person and company are null', async () => {
      const result = await storeEnrichmentEvidence('org-1', 'lead-1', 'comp-1', null, null)
      expect(result).toEqual([])
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

      mockData = [{ id: 'e-1' }]

      await storeEnrichmentEvidence('org-1', 'lead-1', 'comp-1', mockPerson as ClearbitPerson, mockCompany as ClearbitCompany)
      
      const chain = mockFrom.mock.results[0].value
      expect(chain.insert).toHaveBeenCalledTimes(1)
      const insertedRows = chain.insert.mock.calls[0][0]
      expect(insertedRows).toHaveLength(10) // 4 from person + 6 from company
    })

    it('sets expires_at to approximately NOW() + 30 days', async () => {
      const mockPerson: Partial<ClearbitPerson> = {
        id: 'cp-1',
        location: 'San Francisco' // 1 fact
      }
      
      mockData = []
      const before = new Date().getTime()
      await storeEnrichmentEvidence('org-1', 'lead-1', null, mockPerson as ClearbitPerson, null)
      const chain = mockFrom.mock.results[0].value
      
      const insertedRows = chain.insert.mock.calls[0][0]
      const expiresAt = new Date(insertedRows[0].expires_at).getTime()
      
      const expectedTarget = before + 30 * 24 * 60 * 60 * 1000
      expect(Math.abs(expiresAt - expectedTarget)).toBeLessThan(1000) // within 1 second
    })
  })

  describe('getLeadEvidence', () => {
    it('filters out expired evidence (or condition is correctly formed)', async () => {
      mockData = []
      await getLeadEvidence('org-1', 'lead-1')
      const chain = mockFrom.mock.results[0].value
      expect(chain.or).toHaveBeenCalled()
      const orArg = chain.or.mock.calls[0][0]
      expect(orArg).toContain('expires_at.is.null')
      expect(orArg).toContain('expires_at.gt.')
    })
  })

  describe('buildDecisionSnapshot', () => {
    it('throws if lead does not exist', async () => {
      // Create a mock from function that sets mockError when 'leads' is requested
      mockFrom.mockImplementationOnce((table: string) => {
        if (table === 'leads') {
          mockError = { message: 'Not found' }
          mockData = null
        }
        return createMockChain()
      })
      
      await expect(buildDecisionSnapshot({
        organizationId: 'org-1',
        leadId: 'lead-1',
        workflowRunId: 'wr-1',
        agentName: 'AgentA',
        agentVersion: 'v1'
      })).rejects.toThrow('Lead not found: lead-1')
    })

    it('includes all required fields', async () => {
      // By default the mockFrom sets up the correct data for all tables
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
