---
globs: tests/**/*.ts, src/**/__tests__/**/*.ts, src/**/evaluation/**/*.ts
description: >
  Activated when writing any test — unit, integration, E2E, security,
  or agent evaluation.
---

# Testing Rules

## Test Types and Their Scope

```
tests/unit/          → every service function, every policy rule evaluation
tests/integration/   → full play end-to-end with connector mocks
tests/e2e/           → dashboard views via Playwright (real browser)
tests/security/      → cross-tenant isolation (required before any feature ships)
src/**/evaluation/   → agent evaluation against golden dataset
```

## Security Tests — Required Before Any Feature Ships

These tests are non-negotiable. They must exist and pass.
Write these yourself. Do not delegate to another agent.

```typescript
// tests/security/cross-tenant.test.ts

describe('Cross-tenant isolation', () => {
  it('Tenant A token cannot retrieve Tenant B leads', async () => {
    const tenantBLead = await createLead(tenantB.orgId)
    const response = await api
      .withToken(tenantA.token)
      .get(`/api/leads/${tenantBLead.id}`)
    expect(response.status).toBe(404)  // not 403 — do not confirm the resource exists
  })

  it('Tenant A token cannot retrieve Tenant B event log', async () => { ... })
  it('Tenant A token cannot retrieve Tenant B play instances', async () => { ... })
  it('Tenant A token cannot modify Tenant B policy rules', async () => { ... })
  it('Tenant A token cannot read Tenant B connector config', async () => { ... })
})
```

Return 404 (not 403) on cross-tenant access. Never confirm that a resource exists
to a tenant who should not know about it.

## Integration Test Pattern

```typescript
// tests/integration/inbound-play.test.ts

describe('High-intent inbound play', () => {
  it('processes a form submission end-to-end', async () => {
    // 1. Setup: seed organization, policies, routing_state
    const org = await seedOrganization()
    await seedPolicyRules(org.id)
    await seedRoutingState(org.id)

    // 2. Mock connectors at the connector boundary only
    // Real database, real BullMQ, real policy engine
    const sfMock = mockSalesforceConnector({
      assignLeadOwner: jest.fn().mockResolvedValue(undefined),
      createTask: jest.fn().mockResolvedValue({ id: 'sf_task_001' })
    })
    const outreachMock = mockOutreachConnector({
      enrollInSequence: jest.fn().mockResolvedValue(undefined)
    })

    // 3. Trigger webhook
    await api.post('/webhooks/hubspot').send(sampleFormPayload)

    // 4. Wait for play to complete (poll play_instance status)
    const play = await waitForPlayStatus(org.id, leadEmail, 'running')

    // 5. Assert event_log has expected events in order
    const events = await getLeadTimeline(org.id, play.lead_id)
    expect(events.map(e => e.event_type)).toEqual([
      'webhook_received',
      'idempotency_check_passed',
      'enrichment_requested',
      'enrichment_succeeded',
      'action_proposed',        // qualification
      'action_execution_succeeded',
      'action_proposed',        // routing
      'policy_validated',
      'action_execution_started',
      'action_execution_succeeded',
      'action_proposed',        // sequence enrollment
      'action_execution_started',
      'action_execution_succeeded',
    ])

    // 6. Assert external systems were called correctly
    expect(sfMock.assignLeadOwner).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.stringContaining(org.id)  // idempotency key includes orgId
    )
    expect(outreachMock.enrollInSequence).toHaveBeenCalledOnce()

    // 7. Assert decision_snapshot is populated on every event
    events.forEach(event => {
      expect(event.decision_snapshot).not.toBeNull()
      expect(event.decision_snapshot).toHaveProperty('lead')
      expect(event.decision_snapshot).toHaveProperty('policies')
    })
  })
})
```

## Agent Evaluation Tests

```typescript
// src/agents/qualification/evaluation/runner.ts

import { cases } from './cases'
import { QualificationAgent } from '../index'

describe('QualificationAgent v1 — evaluation', () => {
  const agent = new QualificationAgent()

  cases.forEach(c => {
    it(`Case ${c.id}: ${c.description}`, async () => {
      const result = await agent.execute(c.input, mockContext)

      // Assert action type
      expect(result.type).toBe(c.expected.actionType)

      // Assert reason codes present
      c.expected.reasonCodesPresent.forEach(code => {
        expect(result.rationale.reasonCodes).toContain(code)
      })

      // Assert reason codes absent
      c.expected.reasonCodesAbsent.forEach(code => {
        expect(result.rationale.reasonCodes).not.toContain(code)
      })

      // Assert ICP fit if specified
      if (c.expected.isIcpFit !== undefined) {
        expect(result.parameters.is_icp_fit).toBe(c.expected.isIcpFit)
      }
    })
  })
})
```

## Unit Test Rules

```typescript
// Every service function gets at minimum:
// 1. Happy path test
// 2. Error case test (what happens when it fails)
// 3. Edge case (null input, empty array, missing field)

// PolicyEngine unit test example
describe('PolicyEngine', () => {
  it('evaluates territory rule correctly for US company', async () => {
    const rule = buildTerritoryRule({ values: ['US', 'CA'] })
    const lead = buildLead({ company_country: 'US' })
    const result = await policyEngine.evaluate(rule, lead)
    expect(result.passed).toBe(true)
    expect(result.reason).toContain('US')
  })

  it('rejects lead from excluded region', async () => {
    const rule = buildTerritoryRule({ values: ['US', 'CA'] })
    const lead = buildLead({ company_country: 'DE' })
    const result = await policyEngine.evaluate(rule, lead)
    expect(result.passed).toBe(false)
  })
})
```

## What Must Never Be Mocked

- The database (use real test schema in Supabase)
- The policy engine (use real policy evaluation)
- The event_log write (must verify events are actually written)
- The routing_state (must verify round-robin counter is updated)

## What May Be Mocked

- External connector API calls (Salesforce, HubSpot, Outreach, Clearbit)
- Slack notifications
- LLM API calls (in future, when agents use LLM)
