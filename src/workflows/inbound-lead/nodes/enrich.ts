/**
 * enrich.ts — Clearbit enrichment node.
 *
 * Three distinct outcomes, each with a distinct event_type:
 *
 *   enrichment_succeeded  — Clearbit returned data AND evidence rows were written to DB.
 *                           decision_snapshot built AFTER rows are stored → evidenceIds is non-empty.
 *
 *   enrichment_skipped    — Clearbit returned null (no match for this email).
 *                           Legitimate result, not a failure. No evidence rows written.
 *                           Logged so the audit trail is explicit: "checked, found nothing."
 *
 *   enrichment_failed     — API call threw (bad key, network error, unexpected response).
 *                           The error message is captured in decision_snapshot.
 *                           Qualification continues on whatever data is already in DB.
 *
 * The pre-enrichment snapshot (for enrichment_requested) is built before the Clearbit
 * call. The post-enrichment snapshot (for enrichment_succeeded) is rebuilt AFTER rows are
 * stored so evidenceIds reflects the actual evidence written. This is the key invariant:
 * the snapshot on enrichment_succeeded must have a non-empty evidenceIds if any rows
 * were written.
 *
 * Silent null is NOT acceptable — every outcome is logged with a reason.
 */

import { getDb } from '../../../db/client.js'
import { WorkflowState } from '../state.js'
import { storeEnrichmentEvidence } from '../../../evidence/evidence-store.js'
import { ClearbitConnector } from '../../../connectors/clearbit/clearbit.connector.js'
import { writeEvent } from '../../../events/event-log.js'
import { buildDecisionSnapshot } from '../../../evidence/context-builder.js'

export async function enrich(state: WorkflowState): Promise<Partial<WorkflowState>> {
  // Pre-enrichment snapshot — used for enrichment_requested only.
  // At this point evidenceIds will be [] because no evidence exists yet.
  const preSnapshot = await buildDecisionSnapshot(state as any)

  await writeEvent({
    organizationId: state.organizationId,
    workflowRunId:  state.workflowRunId,
    playInstanceId: state.playInstanceId,
    leadId:         state.leadId,
    eventType:      'enrichment_requested',
    actorType:      'system',
    decisionSnapshot: preSnapshot,
    eventStatus:    'success',
  })

  // ── Step 1: Call Clearbit. Separate try/catch from null check. ───────────────
  let enrichResult: Awaited<ReturnType<ClearbitConnector['enrichByEmail']>> | null = null
  let enrichError: Error | null = null

  try {
    const clearbit = new ClearbitConnector()
    await clearbit.connect({ apiKey: process.env.CLEARBIT_API_KEY ?? '' })
    enrichResult = await clearbit.enrichByEmail(state.lead.email)
    // enrichResult is null when Clearbit has no record for this email — not an error.
  } catch (e: any) {
    enrichError = e
  }

  // ── Step 2: If API threw, log enrichment_failed and degrade gracefully. ──────
  if (enrichError) {
    console.warn(
      `[enrich] Clearbit API call failed for ${state.lead.email}: ${enrichError.message}. ` +
      `Enrichment source: clearbit. Continuing with existing DB data.`
    )
    await writeEvent({
      organizationId:   state.organizationId,
      workflowRunId:    state.workflowRunId,
      playInstanceId:   state.playInstanceId,
      leadId:           state.leadId,
      eventType:        'enrichment_failed',
      actorType:        'system',
      decisionSnapshot: {
        ...preSnapshot,
        // Attach error so the audit trail explains why enrichment failed
        enrichmentError: enrichError.message,
        enrichmentSource: 'clearbit',
      } as any,
      eventStatus:  'failed',
      errorMessage: enrichError.message,
    })

    return { currentStep: 'enrich', ...(await loadExistingCompany(state)) }
  }

  // ── Step 3: Clearbit returned null — legitimate no-match. Log distinctly. ────
  if (!enrichResult) {
    console.info(
      `[enrich] Clearbit returned no match for ${state.lead.email}. ` +
      `This is a legitimate result (email not in Clearbit database). ` +
      `Evidence table will remain empty for this lead. Logging enrichment_skipped.`
    )
    await writeEvent({
      organizationId:   state.organizationId,
      workflowRunId:    state.workflowRunId,
      playInstanceId:   state.playInstanceId,
      leadId:           state.leadId,
      eventType:        'enrichment_skipped',
      actorType:        'system',
      decisionSnapshot: {
        ...preSnapshot,
        enrichmentSource: 'clearbit',
        enrichmentSkipReason: 'no_match',
        enrichmentSkipDetail: `Clearbit has no record for email: ${state.lead.email}`,
      } as any,
      eventStatus: 'skipped',
    })

    return { currentStep: 'enrich', ...(await loadExistingCompany(state)) }
  }

  // ── Step 4: Clearbit returned data. Upsert company, store evidence rows. ─────
  const db = getDb()
  let companyId: string | null = null

  if (enrichResult.company) {
    const c = enrichResult.company
    const { data: companyRow } = await db
      .from('companies')
      .upsert({
        organization_id: state.organizationId,
        name:            c.name ?? null,
        domain:          c.domain ?? null,
        industry:        c.category?.industry ?? null,
        employee_count:  c.metrics?.employees ?? null,
        employee_range:  c.metrics?.employeesRange ?? null,
        annual_revenue:  c.metrics?.annualRevenue ?? null,
        country:         c.geo?.country ?? null,
        state:           c.geo?.stateCode ?? null,
        city:            c.geo?.city ?? null,
      }, { onConflict: 'organization_id,domain', ignoreDuplicates: false })
      .select('id')
      .single()
    companyId = (companyRow as any)?.id ?? null

    if (companyId) {
      await db
        .from('leads')
        .update({ company_id: companyId })
        .eq('id', state.leadId)
        .eq('organization_id', state.organizationId)
    }
  }

  // storeEnrichmentEvidence now throws loudly on unexpected failure (see evidence-store.ts).
  // It will also warn if called with null inputs — but we've already guarded above.
  const evidence = await storeEnrichmentEvidence(
    state.organizationId,
    state.leadId,
    companyId,
    enrichResult,
    enrichResult.company ?? null,
    'clearbit',
  )

  console.info(
    `[enrich] Clearbit enrichment complete for ${state.lead.email}: ` +
    `stored ${evidence.length} evidence rows (ids: ${evidence.map((e: any) => e.id).join(', ') || 'none'}).`
  )

  // ── Step 5: Rebuild snapshot AFTER evidence rows are stored. ─────────────────
  // This is the invariant: enrichment_succeeded must have non-empty evidenceIds
  // when rows were actually written. Using the pre-snapshot here would always
  // show evidenceIds: [] regardless of what was stored.
  const postSnapshot = await buildDecisionSnapshot(state as any)

  if (evidence.length > 0 && postSnapshot.evidenceIds.length === 0) {
    // This would indicate a bug in context-builder or a timing issue — log loudly.
    console.error(
      `[enrich] BUG: ${evidence.length} evidence rows written but postSnapshot.evidenceIds is still empty. ` +
      `Lead ${state.leadId}, org ${state.organizationId}. Check evidence table RLS and context-builder query.`
    )
  }

  await writeEvent({
    organizationId:   state.organizationId,
    workflowRunId:    state.workflowRunId,
    playInstanceId:   state.playInstanceId,
    leadId:           state.leadId,
    eventType:        'enrichment_succeeded',
    actorType:        'system',
    decisionSnapshot: {
      ...postSnapshot,
      enrichmentSource:  'clearbit',
      enrichmentRowsWritten: evidence.length,
    } as any,
    eventStatus: 'success',
  })

  // Build Company-shaped state object from Clearbit data
  const company = enrichResult.company
    ? {
        id:              companyId ?? '',
        organization_id: state.organizationId,
        name:            enrichResult.company.name ?? null,
        domain:          enrichResult.company.domain ?? null,
        industry:        enrichResult.company.category?.industry ?? null,
        sub_industry:    enrichResult.company.category?.subIndustry ?? null,
        employee_count:  enrichResult.company.metrics?.employees ?? null,
        employee_range:  enrichResult.company.metrics?.employeesRange ?? null,
        annual_revenue:  enrichResult.company.metrics?.annualRevenue ?? null,
        country:         enrichResult.company.geo?.country ?? null,
        state:           enrichResult.company.geo?.stateCode ?? null,
        city:            enrichResult.company.geo?.city ?? null,
        founded_year:    enrichResult.company.foundedYear ?? null,
        tech_stack:      enrichResult.company.tech ?? null,
        funding_stage:   null,
        raw_clearbit:    enrichResult.company as unknown as Record<string, unknown>,
        created_at:      new Date().toISOString(),
        updated_at:      new Date().toISOString(),
      }
    : null

  return { evidence: evidence as any[], company: company as any, currentStep: 'enrich' }
}

// ── Helper: load company from DB if lead already has company_id ───────────────
// Used in both degraded paths (failed + no-match) to give QualificationAgent
// whatever data already exists instead of forcing it to run completely blind.

async function loadExistingCompany(state: WorkflowState): Promise<{ company: any } | {}> {
  if (!state.lead?.company_id) return {}
  const { data } = await getDb()
    .from('companies')
    .select('*')
    .eq('id', state.lead.company_id)
    .eq('organization_id', state.organizationId)
    .single()
  return data ? { company: data } : {}
}
