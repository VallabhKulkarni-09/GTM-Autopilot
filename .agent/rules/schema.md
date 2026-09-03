---
globs: db/migrations/**/*.sql, src/repositories/**/*.ts, src/domain/**/*.ts
description: >
  Activated when working on database migrations, repository queries,
  or domain type definitions.
---

# Schema Rules

## Migration Files

Every migration file must follow this structure:

```sql
-- Migration: NNN_description.sql
-- Description: what this migration does
-- Rollback: see bottom of file

-- FORWARD MIGRATION
[CREATE TABLE / ALTER TABLE / CREATE INDEX statements]

-- ROLLBACK
-- DROP TABLE IF EXISTS ...
-- DROP INDEX IF EXISTS ...
```

Naming convention: `001_organizations.sql`, `002_leads.sql`, etc.
Never skip numbers. Never reorder. Sequential always.

## Mandatory on Every Table

```sql
organization_id UUID NOT NULL REFERENCES organizations(id)
created_at      TIMESTAMPTZ DEFAULT NOW()
```

Mutable tables also need:
```sql
updated_at      TIMESTAMPTZ DEFAULT NOW()
```

Immutable tables (event_log) must NOT have updated_at.

## Index Naming Convention

```
idx_{table}_{column}
idx_{table}_{col1}_{col2}
```

Create indexes immediately after the CREATE TABLE statement.
Never in a separate migration unless adding to an existing table.

## The event_log Table — Special Rules

- NO updated_at column. Ever.
- decision_snapshot JSONB NOT NULL. Always. Never nullable.
- No UPDATE statements on event_log in any migration or repository.
- No DELETE statements on event_log in any migration or repository.
- The only allowed operation is INSERT.

## The decision_snapshot Field

Every event_log INSERT must populate decision_snapshot with:

```typescript
{
  lead: Lead,                          // full Lead object at moment of event
  company: Company | null,             // full Company object
  policies: PolicyRule[],              // active policies with version numbers
  ownerWorkloads: Record<string, number>, // active leads per SDR at this moment
  evidenceIds: string[],               // evidence rows used in this decision
  agentName: string,                   // e.g. 'qualification-agent'
  agentVersion: string,                // e.g. 'v1.0.0'
  promptVersion: string | null,        // null for rule-based agents
  modelName: string | null             // null for rule-based agents
}
```

This field is what enables simulation and replay. It is sacred.

## Repository Rules

Every repository function must:

```typescript
// CORRECT
async getLeadById(organizationId: string, id: string): Promise<Lead> {
  return db.query(
    'SELECT * FROM leads WHERE organization_id = $1 AND id = $2',
    [organizationId, id]
  )
}

// WRONG — missing organization_id scope
async getLeadById(id: string): Promise<Lead> {
  return db.query('SELECT * FROM leads WHERE id = $1', [id])
}
```

Rules:
- Every query includes WHERE organization_id = $1 as the first condition
- No raw SQL strings as parameters (SQL injection prevention)
- All parameters are typed. No `any`.
- Return types are explicit. No inferred `any`.
- Repository functions never contain business logic. Queries only.

## external_identity Table — Why It Exists

Never add provider-specific ID columns to the leads or companies tables.
Salesforce ID, HubSpot ID, Outreach ID, Clearbit ID all live in external_identity.

```sql
-- CORRECT: look up Salesforce ID
SELECT external_id FROM external_identity
WHERE organization_id = $1
  AND entity_type = 'lead'
  AND entity_id = $2
  AND provider = 'salesforce'

-- WRONG: add salesforce_lead_id to leads table
ALTER TABLE leads ADD COLUMN salesforce_lead_id VARCHAR(255);
```

This keeps the canonical model vendor-independent.

## TypeScript Types from Schema

After running migrations, generate TypeScript types:
- Save to /src/domain/db-types.ts
- These are the source of truth for all entity shapes
- Never manually define a type that should come from the schema
