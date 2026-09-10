import 'dotenv/config'
import ws from 'ws'
import crypto from 'crypto'

if (!globalThis.WebSocket) globalThis.WebSocket = ws.WebSocket

const { getDb }               = await import('/home/vallabh/Documents/gtm-autopilot/dist/db/client.js')
const { writeEvent }           = await import('/home/vallabh/Documents/gtm-autopilot/dist/events/event-log.js')
const { buildDecisionSnapshot } = await import('/home/vallabh/Documents/gtm-autopilot/dist/evidence/context-builder.js')

const ORG  = process.env.DEFAULT_ORG_ID || '08472be3-4990-43b7-9431-c84352fd0260'
const db   = getDb()
const leadId = crypto.randomUUID()
const piId   = crypto.randomUUID()

console.log('Inserting test lead...')
const { error: le } = await db.from('leads').insert({
  id: leadId, organization_id: ORG, email: 'debug@test.com',
  stage: 'new', form_submitted_at: new Date().toISOString(), source: 'test',
  raw_payload: {}, is_duplicate: false, is_icp_fit: null, icp_score: null, icp_tier: null
})
if (le) { console.error('lead insert error:', le.message); process.exit(1) }

const { error: pe } = await db.from('play_instance').insert({
  id: piId, organization_id: ORG, lead_id: leadId,
  workflow_run_id: 'debug-run', status: 'running', current_step: 0,
  first_touch_deadline: new Date(Date.now() + 15*60*1000).toISOString(), sla_breached: false
})
if (pe) { console.error('play insert error:', pe.message); process.exit(1) }
console.log('Lead and play_instance inserted OK')

const snap = await buildDecisionSnapshot({
  organizationId: ORG, leadId, workflowRunId: 'debug-run',
  agentName: 'debug', agentVersion: '1.0.0'
}).catch(e => { console.error('buildDecisionSnapshot FAILED:', e.message); return null })
console.log('Snapshot built — lead.id:', snap?.lead?.id ?? 'MISSING')

try {
  const ev = await writeEvent({
    organizationId: ORG, workflowRunId: 'debug-run', playInstanceId: piId,
    leadId, eventType: 'dedup_passed', actorType: 'system',
    eventStatus: 'success', decisionSnapshot: snap
  })
  console.log('writeEvent SUCCESS, id:', ev.id)
} catch (e) {
  console.error('writeEvent FAILED:', e.message)
}

await db.from('event_log').delete().eq('organization_id', ORG).eq('lead_id', leadId)
await db.from('play_instance').delete().eq('id', piId)
await db.from('leads').delete().eq('id', leadId)
console.log('Cleaned up')
