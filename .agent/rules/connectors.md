---
globs: src/connectors/**/*.ts
description: >
  Activated when building or modifying connector classes for
  Salesforce, HubSpot, Outreach, or Clearbit.
---

# Connector Rules

## The Connector Interface

Every connector must implement this. No exceptions.

```typescript
interface Connector<TConfig> {
  readonly name: ConnectorName
  readonly version: string
  connect(config: TConfig): Promise<void>
  healthCheck(): Promise<ConnectorHealth>
  disconnect(): Promise<void>
}

type ConnectorHealth = {
  ok: boolean
  latencyMs: number
  lastChecked: Date
  error?: string
}

type ConnectorName = 'salesforce' | 'hubspot' | 'outreach' | 'clearbit'
```

## ConnectorError — The Only Allowed Error Type

Never throw raw `Error` from a connector. Always throw `ConnectorError`.

```typescript
// CORRECT
throw new ConnectorError(
  'salesforce',             // source: ConnectorName
  'LEAD_UPDATE_FAILED',     // code: SCREAMING_SNAKE_CASE
  400,                      // statusCode: HTTP status from external system
  rawResponseBody,          // raw: full response body, never undefined
  'Failed to update lead owner in Salesforce'  // human-readable message
)

// WRONG
throw new Error('Salesforce failed')

// WRONG — missing raw response
throw new ConnectorError('salesforce', 'FAILED', 400, undefined, 'msg')
```

## Retry Policy

Apply to every external API call:

```typescript
const RETRY_CONFIG = {
  maxAttempts: 3,
  backoff: [1000, 2000, 4000],  // ms, exponential
  retryOn: [429, 503],           // also retry on network errors
  noRetryOn: [400, 401, 403, 404]
}
```

Do not retry on 400 (bad request — our fault), 401/403 (auth — won't fix itself),
or 404 (not found — retrying won't create it).

## Idempotency Keys on Write Operations

Every method that writes to an external system must accept an idempotency key:

```typescript
// CORRECT
async assignLeadOwner(
  leadId: string,
  ownerId: string,
  idempotencyKey: string   // required on all write methods
): Promise<void>

// WRONG — no idempotency key
async assignLeadOwner(leadId: string, ownerId: string): Promise<void>
```

The idempotency key is logged before execution. If the call fails and retries,
the external system uses the key to deduplicate.

## File Structure Per Connector

```
src/connectors/{name}/
  {name}.connector.ts    ← main class implementing Connector<TConfig>
  {name}.types.ts        ← Salesforce/HubSpot/etc specific types
  {name}.errors.ts       ← error codes as const enum
  __tests__/
    {name}.connector.test.ts
```

## Connector Method Requirements

**Salesforce:**
```typescript
getLeadById(id: string): Promise<SalesforceLead>
createLead(data: CreateLeadInput, idempotencyKey: string): Promise<SalesforceLead>
updateLead(id: string, data: Partial<SalesforceLead>, idempotencyKey: string): Promise<void>
assignLeadOwner(leadId: string, ownerId: string, idempotencyKey: string): Promise<void>
createTask(leadId: string, task: CreateTaskInput, idempotencyKey: string): Promise<SalesforceTask>
getUsers(filter?: UserFilter): Promise<SalesforceUser[]>
```

**HubSpot:**
```typescript
getContactByEmail(email: string): Promise<HubSpotContact | null>
updateContact(id: string, data: Partial<HubSpotContact>, idempotencyKey: string): Promise<void>
updateLifecycleStage(contactId: string, stage: string, idempotencyKey: string): Promise<void>
verifyWebhookSignature(payload: string, signature: string, secret: string): boolean
// Note: verifyWebhookSignature is synchronous — it is a crypto operation, not async
```

**Outreach:**
```typescript
getProspectByEmail(email: string): Promise<OutreachProspect | null>
createProspect(data: CreateProspectInput, idempotencyKey: string): Promise<OutreachProspect>
enrollInSequence(prospectId: string, sequenceId: string, idempotencyKey: string): Promise<void>
getActiveSequences(prospectId: string): Promise<OutreachSequence[]>
createTask(prospectId: string, task: CreateTaskInput, idempotencyKey: string): Promise<OutreachTask>
```

**Clearbit:**
```typescript
enrichByEmail(email: string): Promise<ClearbitPerson | null>
enrichByDomain(domain: string): Promise<ClearbitCompany | null>
// Returns null (not throws) when no enrichment data exists for the email/domain
```

## Environment Variables

```
Salesforce:  SF_INSTANCE_URL, SF_CLIENT_ID, SF_CLIENT_SECRET, SF_SANDBOX=true
HubSpot:     HUBSPOT_API_KEY, HUBSPOT_WEBHOOK_SECRET
Outreach:    OUTREACH_API_KEY
Clearbit:    CLEARBIT_API_KEY
```

Read from process.env. Never hardcode. Never commit credentials.

## Testing Rules

- Tests run against real sandbox credentials (from env vars)
- Do NOT mock the external API responses in unit tests
- Test files live in src/connectors/{name}/__tests__/
- Every public method must have at minimum one passing test
- Test the null/not-found case for all read methods
- Test that ConnectorError is thrown (not raw Error) on failure
- Test that verifyWebhookSignature correctly rejects invalid signatures
