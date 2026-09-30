/**
 * first-touch.ts — Sequence enrollment node.
 *
 * Mirrors the pattern in route.ts for Salesforce:
 *   1. Build Outreach connector from env vars (null-safe — skips if absent)
 *   2. Find-or-create the Outreach prospect by email
 *   3. Resolve sequence ID from OUTREACH_SEQUENCE_ID env var
 *   4. Call executeAction with real parameters (outreach_prospect_id + sequence_id)
 *
 * Degrades gracefully: if OUTREACH_* vars are not set, the action runs without
 * a connector and the executor logs a warning + marks play 'completed' anyway.
 */

import { randomUUID } from 'crypto'
import { WorkflowState } from '../state.js'
import { executeAction } from '../../../actions/executor.js'
import { writeEvent } from '../../../events/event-log.js'
import { buildDecisionSnapshot } from '../../../evidence/context-builder.js'
import { OutreachConnector } from '../../../connectors/outreach/outreach.connector.js'
import type { ProposedAction } from '../../../actions/types.js'
import type { ConnectorRegistry } from '../../../actions/action-executor.js'

export async function firstTouch(state: WorkflowState): Promise<Partial<WorkflowState>> {
  const decisionSnapshot = await buildDecisionSnapshot(state as any)

  try {
    // ── 1. Build Outreach connector (null-safe — degrade if not configured) ───
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
      console.warn('[first-touch] One or more OUTREACH_* env vars missing — sequence enrollment will be skipped')
    }

    // ── 2. Resolve Outreach prospect ID (find-or-create by email) ────────────
    let outreachProspectId: string | undefined
    const sequenceId = process.env.OUTREACH_SEQUENCE_ID

    if (outreachConnector && state.lead?.email) {
      try {
        const existing = await outreachConnector.getProspectByEmail(state.lead.email)

        if (existing) {
          outreachProspectId = existing.id
          console.log(`[first-touch] Found existing Outreach prospect: ${outreachProspectId}`)
        } else {
          // Create prospect
          const idempKey = `${state.organizationId}:${state.workflowRunId}:create_prospect`
          const created = await outreachConnector.createProspect(
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
        // Non-fatal: log and continue without Outreach prospect ID
        // The executor will skip enrollment and log a warning
        console.warn(`[first-touch] Failed to resolve Outreach prospect for ${state.lead.email}: ${err}`)
        outreachProspectId = undefined
      }
    }

    // ── 3. Build connector registry ──────────────────────────────────────────
    const connectors: Partial<ConnectorRegistry> = outreachConnector
      ? { outreach: outreachConnector as any }
      : {}

    // ── 4. Build and execute action ──────────────────────────────────────────
    const action: ProposedAction = {
      actionId:          randomUUID(),
      type:              'start_sequence',
      target:            { leadId: state.leadId, organizationId: state.organizationId },
      rationale:         { reasonCodes: [], evidenceIds: [] },
      decisionRiskScore: 0.0,
      rawConfidence:     1.0,
      parameters: {
        // Both will be undefined if Outreach isn't configured — executor degrades gracefully
        outreach_prospect_id: outreachProspectId ?? '',
        sequence_id:          sequenceId ?? '',
      },
      idempotencyKey: `${state.organizationId}:${state.workflowRunId}:start_sequence`,
      constraints:    { requiredPolicyIds: [] },
    }

    await executeAction(
      action,
      connectors as any,
      state.organizationId,
      state.workflowRunId,
      state.playInstanceId,
      decisionSnapshot
    )

    return { currentStep: 'first_touch' }
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
