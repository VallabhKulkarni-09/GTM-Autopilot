import 'dotenv/config'
import ws from 'ws'
import crypto from 'crypto'

if (!globalThis.WebSocket) globalThis.WebSocket = ws.WebSocket

const { getDb }               = await import('/home/vallabh/Documents/gtm-autopilot/dist/db/client.js')
const { runInboundLeadPlay }  = await import('/home/vallabh/Documents/gtm-autopilot/dist/workflows/inbound-lead/graph.js')

const ORG = '08472be3-4990-43b7-9431-c84352fd0260'
const db  = getDb()

const leadId = crypto.randomUUID()
const piId   = crypto.randomUUID()
const workflowRunId = crypto.randomUUID()
const now = new Date()

await db.from('leads').insert({
  id: leadId, organization_id: ORG, email: 'debugworkflow@test.com',
  first_name: 'Debug', last_name: 'Test', title: 'CTO',
  stage: 'new', form_submitted_at: now.toISOString(), source: 'test',
  raw_payload: {}, is_duplicate: false, is_icp_fit: null, icp_score: null, icp_tier: null
})

await db.from('play_instance').insert({
  id: piId, organization_id: ORG, lead_id: leadId,
  workflow_run_id: workflowRunId, status: 'running', current_step: 0,
  first_touch_deadline: new Date(now.getTime() + 15*60*1000).toISOString(), sla_breached: false
})

console.log('Running workflow with leadId:', leadId)
try {
  await runInboundLeadPlay(ORG, {
    _leadId: leadId, _playInstanceId: piId, _workflowRunId: workflowRunId,
    occurredAt: now.getTime(),
    properties: {
      email: 'debugworkflow@test.com', firstname: 'Debug', lastname: 'Test',
      jobtitle: 'CTO', company: 'TestCo', annualrevenue: '5000000', numberofemployees: '50'
    }
  })
  console.log('Workflow completed successfully')
} catch (e) {
  console.error('Workflow threw:', e.message)
}

// Check events
const { data: events } = await db.from('event_log')
  .select('event_type, event_status')
  .eq('organization_id', ORG)
  .eq('lead_id', leadId)

console.log('Events written:', events?.length ?? 0)
for (const ev of events ?? []) {
  console.log(' -', ev.event_type, ev.event_status)
}

// Check lead
const { data: lead } = await db.from('leads').select('is_icp_fit, icp_score, stage').eq('id', leadId).single()
console.log('Lead state:', JSON.stringify(lead))

// Cleanup
await db.from('event_log').delete().eq('organization_id', ORG).eq('lead_id', leadId)
await db.from('play_instance').delete().eq('id', piId)
await db.from('leads').delete().eq('id', leadId)
console.log('Cleaned up')
