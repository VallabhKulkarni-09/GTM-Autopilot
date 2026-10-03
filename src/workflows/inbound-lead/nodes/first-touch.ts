/**
 * first-touch.ts — Sequence/Cadence enrollment node.
 *
 * Connector priority: if BOTH Outreach and Salesloft are configured, Salesloft
 * takes precedence. Only one enrollment connector is used per run.
 * This is an explicit design choice — a single org uses one SEP.
 *
 * Outreach path:
 *   1. Build OutreachConnector from env vars (null-safe)
 *   2. Find-or-create the Outreach Prospect by email
 *   3. Resolve sequence ID from OUTREACH_SEQUENCE_ID env var
 *   4. executeAction with outreach_prospect_id + sequence_id
 *
 * Salesloft path:
 *   1. Build SalesloftConnector from env vars (null-safe)
 *   2. Find-or-create the Salesloft Person by email
 *   3. Resolve cadence ID from SALESLOFT_CADENCE_ID env var
 *   4. executeAction with salesloft_person_id + cadence_id
 *
 * Degrades gracefully if neither connector is configured.
 */

import { randomUUID } from 'crypto'
import { WorkflowState } from '../state.js'
import { executeAction } from '../../../actions/executor.js'
import { writeEvent } from '../../../events/event-log.js'
import { buildDecisionSnapshot } from '../../../evidence/context-builder.js'
import { OutreachConnector } from '../../../connectors/outreach/outreach.connector.js'
import { SalesloftConnector } from '../../../connectors/salesloft/salesloft.connector.js'
import type { ProposedAction } from '../../../actions/types.js'
import type { ConnectorRegistry } from '../../../actions/action-executor.js'

export async function firstTouch(state: WorkflowState): Promise<Partial<WorkflowState>> {
  const decisionSnapshot = await buildDecisionSnapshot(state as any)

  try {
    // ── Determine which SEP connector to use (Salesloft > Outreach) ───────────
    const slClientId     = process.env.SALESLOFT_CLIENT_ID
    const slClientSecret = process.env.SALESLOFT_CLIENT_SECRET
    const slAccessToken  = process.env.SALESLOFT_ACCESS_TOKEN
    const slRefreshToken = process.env.SALESLOFT_REFRESH_TOKEN
    const slCadenceId    = process.env.SALESLOFT_CADENCE_ID

    const useSalesloft = !!(slClientId && slClientSecret && slAccessToken && slRefreshToken && slCadenceId)

    if (useSalesloft) {
      return await runSalesloftEnrollment(state, decisionSnapshot, {
        clientId: slClientId!, clientSecret: slClientSecret!,
        accessToken: slAccessToken!, refreshToken: slRefreshToken!,
        cadenceId: slCadenceId!,
      })
    }

    return await runOutreachEnrollment(state, decisionSnapshot)

  } catch (e: any) {
    await writeEvent({
      organizationId: state.organizationId,
      workflowRunId:  state.workflowRunId,
      playInstanceId: state.playInstanceId,
      leadId:         state.leadId,
      eventType:      'action_execution_failed',
      actorType:      'system',
      decisionSnapshot,
      eventStatus:    'failed',
      errorMessage:   e.message,
    })
    throw e
  }
}

// ── Outreach enrollment path ─────────────────────────────────────────────────

async function runOutreachEnrollment(state: WorkflowState, decisionSnapshot: any): Promise<Partial<WorkflowState>> {
  let outreachConnector: OutreachConnector | null = null
  const clientId     = process.env.OUTREACH_CLIENT_ID
  const clientSecret = process.env.OUTREACH_CLIENT_SECRET
  const accessToken  = process.env.OUTREACH_ACCESS_TOKEN
  const refreshToken = process.env.OUTREACH_REFRESH_TOKEN
  const mailboxId    = process.env.OUTREACH_MAILBOX_ID

  if (clientId && clientSecret && accessToken && refreshToken && mailboxId) {
    try {
      outreachConnector = new OutreachConnector()
      await outreachConnector.connect({ clientId, clientSecret, accessToken, refreshToken, mailboxId })
    } catch (connErr) {
      console.warn(`[first-touch] Outreach connect failed — proceeding without enrollment: ${(connErr as Error).message}`)
      outreachConnector = null
    }
  } else {
    console.warn('[first-touch] OUTREACH_* env vars not fully set — sequence enrollment will be skipped')
  }

  let outreachProspectId: string | undefined
  const sequenceId = process.env.OUTREACH_SEQUENCE_ID

  if (outreachConnector && state.lead?.email) {
    try {
      const existing = await outreachConnector.getProspectByEmail(state.lead.email)
      if (existing) {
        outreachProspectId = existing.id
        console.log(`[first-touch] Found existing Outreach prospect: ${outreachProspectId}`)
      } else {
        const idempKey = `${state.organizationId}:${state.workflowRunId}:create_prospect`
        const created  = await outreachConnector.createProspect(
          {
            email:     state.lead.email,
            firstName: state.lead.first_name ?? undefined,
            lastName:  state.lead.last_name ?? undefined,
            title:     state.lead.title ?? undefined,
          },
          idempKey
        )
        outreachProspectId = created.id
        console.log(`[first-touch] Created Outreach prospect: ${outreachProspectId}`)
      }
    } catch (err) {
      console.warn(`[first-touch] Failed to resolve Outreach prospect for ${state.lead.email}: ${err}`)
      outreachProspectId = undefined
    }
  }

  const connectors: Partial<ConnectorRegistry> = outreachConnector
    ? { outreach: outreachConnector as any }
    : {}

  const action: ProposedAction = {
    actionId:          randomUUID(),
    type:              'start_sequence',
    target:            { leadId: state.leadId, organizationId: state.organizationId },
    rationale:         { reasonCodes: [], evidenceIds: [] },
    decisionRiskScore: 0.0,
    rawConfidence:     1.0,
    parameters: {
      outreach_prospect_id: outreachProspectId ?? '',
      sequence_id:          sequenceId ?? '',
    },
    idempotencyKey: `${state.organizationId}:${state.workflowRunId}:start_sequence`,
    constraints:    { requiredPolicyIds: [] },
  }

  await executeAction(action, connectors as any, state.organizationId, state.workflowRunId, state.playInstanceId, decisionSnapshot)
  return { currentStep: 'first_touch' }
}

// ── Salesloft enrollment path ────────────────────────────────────────────────

async function runSalesloftEnrollment(
  state: WorkflowState,
  decisionSnapshot: any,
  config: { clientId: string; clientSecret: string; accessToken: string; refreshToken: string; cadenceId: string }
): Promise<Partial<WorkflowState>> {
  let salesloftConnector: SalesloftConnector | null = null

  try {
    salesloftConnector = new SalesloftConnector()
    await salesloftConnector.connect({
      clientId:     config.clientId,
      clientSecret: config.clientSecret,
      accessToken:  config.accessToken,
      refreshToken: config.refreshToken,
    })
  } catch (connErr) {
    console.warn(`[first-touch] Salesloft connect failed — skipping enrollment: ${(connErr as Error).message}`)
    salesloftConnector = null
  }

  let salesloftPersonId: number | undefined

  if (salesloftConnector && state.lead?.email) {
    try {
      const existing = await salesloftConnector.getPersonByEmail(state.lead.email)
      if (existing) {
        salesloftPersonId = existing.id
        console.log(`[first-touch] Found existing Salesloft person: ${salesloftPersonId}`)
      } else {
        const idempKey = `${state.organizationId}:${state.workflowRunId}:create_person`
        const created  = await salesloftConnector.createPerson(
          {
            email_address: state.lead.email,
            first_name:    state.lead.first_name ?? undefined,
            last_name:     state.lead.last_name ?? undefined,
            title:         state.lead.title ?? undefined,
          },
          idempKey
        )
        salesloftPersonId = created.id
        console.log(`[first-touch] Created Salesloft person: ${salesloftPersonId}`)
      }
    } catch (err) {
      console.warn(`[first-touch] Failed to resolve Salesloft person for ${state.lead.email}: ${err}`)
      salesloftPersonId = undefined
    }
  }

  const connectors: Partial<ConnectorRegistry> = salesloftConnector
    ? { salesloft: salesloftConnector as any }
    : {}

  const action: ProposedAction = {
    actionId:          randomUUID(),
    type:              'start_sequence',
    target:            { leadId: state.leadId, organizationId: state.organizationId },
    rationale:         { reasonCodes: [], evidenceIds: [] },
    decisionRiskScore: 0.0,
    rawConfidence:     1.0,
    parameters: {
      salesloft_person_id: salesloftPersonId !== undefined ? String(salesloftPersonId) : '',
      cadence_id:          config.cadenceId,
    },
    idempotencyKey: `${state.organizationId}:${state.workflowRunId}:start_sequence`,
    constraints:    { requiredPolicyIds: [] },
  }

  await executeAction(action, connectors as any, state.organizationId, state.workflowRunId, state.playInstanceId, decisionSnapshot)
  return { currentStep: 'first_touch' }
}
