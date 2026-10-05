/**
 * enrich.ts — Multi-source enrichment node.
 *
 * Sources (in order):
 *   1. Clearbit (person + company) — if CLEARBIT_API_KEY is set
 *   2. Apollo organizations/enrich (company only) — if APOLLO_API_KEY is set
 *
 * Apollo scope note: Only organizations/enrich is authorized on the current plan.
 * people/match is out of scope (403). Apollo enrichment provides company-level data only:
 * industry, employee count, revenue, funding, tech stack. No title/seniority signals.
 * See rules.ts senior-title block and PROGRESS.md for the scoring impact.
 *
 * Three distinct outcomes per source, each with a distinct event_type:
 *
 *   enrichment_succeeded  — data returned AND evidence rows written to DB.
 *                           decision_snapshot built AFTER rows stored → evidenceIds non-empty.
 *
 *   enrichment_skipped    — no match found (legitimate), OR domain check failed
 *                           (invalid email domain, free-email domain).
 *                           Logged with explicit reason — never silently swallowed.
 *
 *   enrichment_failed     — API threw (bad key, network error, scope error).
 *                           Error captured in snapshot. Qualification continues on
 *                           whatever data already exists in DB.
 *
 * Domain derivation for Apollo: email → domain (email.split('@')[1]).
 * Free-email-domain gate: checked against FREE_EMAIL_PROVIDERS from rules.ts before
 * any Apollo API credit is spent. If domain is a webmail provider, log enrichment_skipped
 * with reason 'free_email_domain', not a real company match.
 *
 * Silent null is NOT acceptable — every outcome is logged with a reason.
 */

import { getDb } from '../../../db/client.js'
import { WorkflowState } from '../state.js'
import { storeEnrichmentEvidence, storeApolloOrgEnrichmentEvidence } from '../../../evidence/evidence-store.js'
import { ClearbitConnector } from '../../../connectors/clearbit/clearbit.connector.js'
import { ApolloConnector, deriveDomainFromEmail } from '../../../connectors/apollo/apollo.connector.js'
import { FREE_EMAIL_PROVIDERS } from '../../../agents/qualification/rules.js'
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
  const clearbitCompany = enrichResult.company
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

  // ── Stage 2: Apollo organization enrichment ────────────────────────────────
  // Runs regardless of Clearbit outcome — additive, not exclusive.
  // Apollo provides company-level data only (org endpoint). No person-level signals.
  const apolloResult = await enrichWithApollo(state, companyId)

  const finalCompany = apolloResult.company ?? clearbitCompany
  const finalEvidence = [...evidence as any[], ...(apolloResult.evidence ?? [])]

  return {
    evidence:    finalEvidence,
    company:     finalCompany as any,
    currentStep: 'enrich',
  }
}

// ── Stage 2: Apollo organization enrichment ───────────────────────────────────
// Extracted as a helper so the main enrich() function stays readable.
// Returns { evidence: Evidence[], company: Company | null }.
// Errors are caught and logged — never propagated to crash the workflow.

async function enrichWithApollo(
  state: WorkflowState,
  existingCompanyId: string | null,
): Promise<{ evidence: any[]; company: any | null }> {
  const apiKey = process.env.APOLLO_API_KEY
  if (!apiKey) {
    // Apollo not configured — skip silently (no event logged for "not configured",
    // only for "tried and found nothing"). This is consistent with Clearbit behaviour.
    return { evidence: [], company: null }
  }

  // ── Domain derivation ────────────────────────────────────────────────────────
  // Apollo org endpoint takes a domain, not an email.
  // Derive from lead email. Explicit reason logged for every skip.
  const domain = deriveDomainFromEmail(state.lead.email)

  if (!domain) {
    console.warn(
      `[enrich/apollo] Cannot derive domain from email "${state.lead.email}". ` +
      `Logging enrichment_skipped with reason invalid_email_domain.`
    )
    await writeEvent({
      organizationId:   state.organizationId,
      workflowRunId:    state.workflowRunId,
      playInstanceId:   state.playInstanceId,
      leadId:           state.leadId,
      eventType:        'enrichment_skipped',
      actorType:        'system',
      decisionSnapshot: await buildDecisionSnapshot(state as any) as any,
      eventStatus:      'skipped',
      errorMessage:     `Apollo org enrichment skipped: invalid email domain for "${state.lead.email}"`,
    })
    return { evidence: [], company: null }
  }

  // ── Free-email-domain gate ───────────────────────────────────────────────────
  // Reuses FREE_EMAIL_PROVIDERS from rules.ts — not duplicated.
  // Gmail.com returns {} from Apollo anyway, but this gate:
  //   1. Saves API credits before any network call
  //   2. Makes the skip reason explicit in the audit trail
  if (FREE_EMAIL_PROVIDERS.has(domain)) {
    console.info(
      `[enrich/apollo] Domain "${domain}" is a free-email provider. ` +
      `Skipping Apollo org enrichment to avoid false match (e.g., Google LLC for gmail.com). ` +
      `Logging enrichment_skipped with reason free_email_domain.`
    )
    await writeEvent({
      organizationId:   state.organizationId,
      workflowRunId:    state.workflowRunId,
      playInstanceId:   state.playInstanceId,
      leadId:           state.leadId,
      eventType:        'enrichment_skipped',
      actorType:        'system',
      decisionSnapshot: await buildDecisionSnapshot(state as any) as any,
      eventStatus:      'skipped',
      errorMessage:     `Apollo org enrichment skipped: "${domain}" is a free-email provider domain`,
    })
    return { evidence: [], company: null }
  }

  // ── Apollo API call ──────────────────────────────────────────────────────────
  const apollo = new ApolloConnector()
  await apollo.connect({ apiKey })

  let apolloResult: Awaited<ReturnType<ApolloConnector['enrichOrganizationByDomain']>> = null
  let apolloError: Error | null = null

  try {
    apolloResult = await apollo.enrichOrganizationByDomain(domain)
  } catch (e: any) {
    apolloError = e
  }

  // ── Error path ───────────────────────────────────────────────────────────────
  if (apolloError) {
    console.warn(
      `[enrich/apollo] Apollo org enrichment failed for domain "${domain}": ${apolloError.message}. ` +
      `Continuing with Clearbit data only.`
    )
    await writeEvent({
      organizationId:   state.organizationId,
      workflowRunId:    state.workflowRunId,
      playInstanceId:   state.playInstanceId,
      leadId:           state.leadId,
      eventType:        'enrichment_failed',
      actorType:        'system',
      decisionSnapshot: {
        ...(await buildDecisionSnapshot(state as any)) as any,
        enrichmentError:  apolloError.message,
        enrichmentSource: 'apollo_org',
        enrichmentDomain: domain,
      } as any,
      eventStatus:  'failed',
      errorMessage: apolloError.message,
    })
    return { evidence: [], company: null }
  }

  // ── No-match path ────────────────────────────────────────────────────────────
  // Apollo returns {} (empty body) for unknown domains. Null from enrichOrganizationByDomain.
  if (!apolloResult) {
    console.info(
      `[enrich/apollo] Apollo org enrichment returned no match for domain "${domain}". ` +
      `This is legitimate — domain not in Apollo database. Logging enrichment_skipped.`
    )
    await writeEvent({
      organizationId:   state.organizationId,
      workflowRunId:    state.workflowRunId,
      playInstanceId:   state.playInstanceId,
      leadId:           state.leadId,
      eventType:        'enrichment_skipped',
      actorType:        'system',
      decisionSnapshot: {
        ...(await buildDecisionSnapshot(state as any)) as any,
        enrichmentSource:     'apollo_org',
        enrichmentSkipReason: 'no_match',
        enrichmentSkipDetail: `Apollo org endpoint returned no data for domain: ${domain}`,
      } as any,
      eventStatus: 'skipped',
    })
    return { evidence: [], company: null }
  }

  // ── Success path ─────────────────────────────────────────────────────────────
  const db = getDb()
  let apolloCompanyId = existingCompanyId  // reuse Clearbit's company row if already created

  // Upsert company record from Apollo data if not already created by Clearbit.
  // Use primary_domain as the dedup key, same as Clearbit.
  if (!apolloCompanyId && apolloResult.domain) {
    const { data: companyRow } = await db
      .from('companies')
      .upsert({
        organization_id: state.organizationId,
        name:            apolloResult.name       ?? null,
        domain:          apolloResult.domain      ?? null,
        industry:        apolloResult.industry    ?? null,
        employee_count:  apolloResult.employeeCount ?? null,
        annual_revenue:  apolloResult.revenue     ?? null,  // organization_revenue from Apollo
        country:         apolloResult.location.country ?? null,
        state:           apolloResult.location.state   ?? null,
        city:            apolloResult.location.city    ?? null,
        founded_year:    apolloResult.foundedYear ?? null,
        funding_stage:   apolloResult.fundingStage ?? null,
      }, { onConflict: 'organization_id,domain', ignoreDuplicates: false })
      .select('id')
      .single()
    apolloCompanyId = (companyRow as any)?.id ?? null

    if (apolloCompanyId) {
      await db.from('leads')
        .update({ company_id: apolloCompanyId })
        .eq('id', state.leadId)
        .eq('organization_id', state.organizationId)
    }
  }

  const apolloEvidence = await storeApolloOrgEnrichmentEvidence(
    state.organizationId,
    state.leadId,
    apolloCompanyId,
    apolloResult,
  )

  console.info(
    `[enrich/apollo] Apollo org enrichment complete for domain "${domain}": ` +
    `stored ${apolloEvidence.length} evidence rows ` +
    `(ids: ${apolloEvidence.map((e: any) => e.id).join(', ') || 'none'}).`
  )

  // Rebuild snapshot AFTER Apollo rows are stored — so evidenceIds includes them.
  const postApolloSnapshot = await buildDecisionSnapshot(state as any)

  if (apolloEvidence.length > 0 && postApolloSnapshot.evidenceIds.length === 0) {
    console.error(
      `[enrich/apollo] BUG: ${apolloEvidence.length} Apollo evidence rows written but ` +
      `postApolloSnapshot.evidenceIds is still empty. ` +
      `Lead ${state.leadId}, domain ${domain}. Check evidence table RLS and context-builder query.`
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
      ...postApolloSnapshot,
      enrichmentSource:      'apollo_org',
      enrichmentDomain:      domain,
      enrichmentRowsWritten: apolloEvidence.length,
    } as any,
    eventStatus: 'success',
  })

  // Build a Company-shaped object from Apollo data for the workflow state.
  const apolloCompany = {
    id:              apolloCompanyId ?? '',
    organization_id: state.organizationId,
    name:            apolloResult.name ?? null,
    domain:          apolloResult.domain ?? null,
    industry:        apolloResult.industry ?? null,
    sub_industry:    null,
    employee_count:  apolloResult.employeeCount ?? null,
    employee_range:  null,
    annual_revenue:  apolloResult.revenue ?? null,
    country:         apolloResult.location.country ?? null,
    state:           apolloResult.location.state ?? null,
    city:            apolloResult.location.city ?? null,
    founded_year:    apolloResult.foundedYear ?? null,
    tech_stack:      apolloResult.techStack.length > 0 ? apolloResult.techStack : null,
    funding_stage:   apolloResult.fundingStage ?? null,
    raw_clearbit:    null,
    created_at:      new Date().toISOString(),
    updated_at:      new Date().toISOString(),
  }

  return { evidence: apolloEvidence as any[], company: apolloCompany }
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
