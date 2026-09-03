---
globs: src/agents/**/*.ts
description: >
  Activated when building or modifying agent implementations
  (qualification, routing, or any future agent).
---

# Agent Rules

## The Agent Interface

Every agent implements this. The interface is identical for rule-based v1
and LLM-powered v2. Upgrading from v1 to v2 must not change the workflow graph.

```typescript
interface Agent<TInput, TOutput extends ProposedAction> {
  readonly name: string      // e.g. 'qualification-agent'
  readonly version: string   // e.g. 'v1.0.0'
  execute(
    input: TInput,
    context: AgentContext
  ): Promise<TOutput>
}

type AgentContext = {
  organizationId: string
  workflowRunId: string
  evidence: Evidence[]
  policies: PolicyRule[]
  // Everything the agent is permitted to access.
  // Nothing outside this context may influence the decision.
}
```

## ProposedAction — What Every Agent Returns

```typescript
type ProposedAction = {
  actionId: string                      // UUID
  type: ActionType
  target: {
    leadId: string
    organizationId: string
  }
  rationale: {
    reasonCodes: string[]               // SCREAMING_SNAKE_CASE. Machine-readable. NOT prose.
    evidenceIds: string[]               // References to evidence table row IDs
  }
  decisionRiskScore: number             // 0.0 to 1.0
  rawConfidence: number                 // 0.0 to 1.0
  parameters: Record<string, unknown>   // Action-specific payload
  idempotencyKey: string               // organizationId:workflowRunId:actionId
  constraints: {
    requiredPolicyIds: string[]
  }
}
```

## Reason Codes

- Format: SCREAMING_SNAKE_CASE
- Must be specific and descriptive
- Never generic

```
CORRECT:
  ICP_COMPANY_SIZE_IN_RANGE
  NA_SMB_TERRITORY_MATCH
  ROUND_ROBIN_SLOT_3
  ENRICHMENT_MISSING_COMPANY_SIZE
  DUPLICATE_ACTIVE_SEQUENCE_EXISTS

WRONG:
  RULE_MATCH
  SYSTEM_DECISION
  OK
  PASSED
```

## v1 Agents Are Rule-Based — No LLM Calls

```typescript
// CORRECT for v1
return {
  ...proposedAction,
  decisionRiskScore: 0.0,   // deterministic = minimum risk
  rawConfidence: 1.0         // deterministic = maximum confidence
}

// WRONG for v1 — no LLM in MVP agents
const response = await anthropic.messages.create({ ... })
```

## What Agents Must Never Do

- Call a connector directly
- Query the database directly
- Mutate state directly
- Make HTTP requests directly
- Access anything outside the AgentContext parameter
- Return more than one ProposedAction

## File Structure Per Agent

```
src/agents/{name}/
  index.ts           ← implements Agent<TInput, TOutput>
  rules.ts           ← v1: the rule-based scoring/evaluation logic
  types.ts           ← input/output types specific to this agent
  evaluation/
    cases.ts         ← EvaluationCase[] (minimum 10 before agent ships)
    runner.ts        ← evaluation test runner
```

## QualificationAgent v1 — Specific Rules

Input must include:
- lead: Lead
- company: Company | null
- enrichment evidence rows (from evidence table, source_type = 'clearbit')
- icp policy rules (rule_type = 'icp_filter')

Output parameters must include:
```typescript
{
  is_icp_fit: boolean
  icp_score: number      // 0–100, computed from rule-based formula
  icp_tier: 'tier_1' | 'tier_2' | 'not_icp'
  reason_codes: string[]
}
```

Must handle gracefully (not crash) when:
- company is null (no enrichment returned)
- company_size is null (missing field)
- company_industry is null
- evidence array is empty

## RoutingAgent v1 — Specific Rules

Input must include:
- lead: Lead
- qualificationResult: QualificationDecision
- availableOwners: SalesforceUser[]
- ownerWorkloads: Record<string, number>  ← active leads per owner right now
- territoryRules: PolicyRule[]
- routingState: RoutingState              ← current round-robin counters

Round-robin counter must be READ from routingState (from DB).
Never implement round-robin with Math.random() or in-memory state.

Output parameters must include:
```typescript
{
  recommended_owner_id: string
  recommended_owner_name: string
  queue_name: string
  reason_codes: string[]
}
```

## Evaluation Cases — Required Before Agent Ships

Every agent must have at minimum 10 evaluation cases covering:

For QualificationAgent:
1. Perfect ICP match — all fields present, high score
2. Partial ICP match — some fields missing, medium score
3. Not ICP — company too small
4. Not ICP — wrong industry
5. Not ICP — wrong region
6. No enrichment data — company is null, handle gracefully
7. Missing company_size only — should not crash
8. Edge: startup with 5 employees
9. Edge: enterprise with 50,000 employees
10. Duplicate: email already has active play

For RoutingAgent:
1. Clear territory match — single queue, available owner
2. Round-robin — multiple owners in same queue
3. Workload balancing — assign to least-loaded owner
4. No available owners — escalate
5. Territory ambiguity — HQ country ≠ contact country
6. All owners at max workload
7. Single owner in queue
8. New queue with no routing history
9. Owner on PTO (marked unavailable in input)
10. Lead from unsupported region

## EvaluationCase Type

```typescript
type EvaluationCase = {
  id: string
  description: string
  tags: string[]

  input: {
    lead: Partial<Lead>
    company: Partial<Company> | null
    enrichmentEvidence: Partial<Evidence>[]
    ownerWorkloads?: Record<string, number>
    policies: PolicyRule[]
  }

  expected: {
    actionType: ActionType
    reasonCodesPresent: string[]
    reasonCodesAbsent: string[]
    isIcpFit?: boolean
    recommendedOwnerId?: string
    minIcpScore?: number
    maxIcpScore?: number
  }
}
```
