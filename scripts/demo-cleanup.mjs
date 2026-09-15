import 'dotenv/config'
await import('ws').then(({default:ws})=>{globalThis.WebSocket=ws.WebSocket??ws})
const { getDb } = await import('../dist/db/client.js')
const db = getDb()

const DEMO_EMAILS = [
  'sarah.chen@cloudbase.io', 'marcus.webb@dataflow.com', 'priya@tinystartup.io',
  'testuser123@gmail.com', 'alex.torres@retailmega.com', 'jamie.park@scalesaas.co.uk'
]

const { data: orgs } = await db.from('organizations').select('id').limit(1)
const ORG = orgs?.[0]?.id

let cleaned = 0
for (const email of DEMO_EMAILS) {
  const { data: leads } = await db.from('leads').select('id,company_id').eq('organization_id', ORG).eq('email', email)
  for (const lead of (leads ?? [])) {
    const { data: plays } = await db.from('play_instance').select('id').eq('lead_id', lead.id)
    for (const play of (plays ?? [])) {
      await db.from('event_log').delete().eq('play_instance_id', play.id)
      await db.from('action_execution_state').delete().eq('play_instance_id', play.id)
      await db.from('play_instance').delete().eq('id', play.id)
      cleaned++
    }
    await db.from('leads').delete().eq('id', lead.id)
    if (lead.company_id) await db.from('companies').delete().eq('id', lead.company_id)
  }
}
console.log(`✓ Cleaned up all demo rows (${cleaned} play instances removed)`)
