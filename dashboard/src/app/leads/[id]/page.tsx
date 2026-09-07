import { apiFetch } from '@/lib/api'
import { getServerToken } from '@/lib/auth'
import { Lead, TimelineEvent } from '@/types/api'
import { Badge } from '@/components/ui/badge'

const EVENT_LABELS: Record<string, string> = {
  'webhook_received':              'Form submission received',
  'enrichment_requested':          'Enrichment started',
  'enrichment_succeeded':          'Enrichment complete',
  'enrichment_failed':             'Enrichment failed',
  'dedup_passed':                  'Duplicate check passed',
  'dedup_rejected':                'Duplicate detected — play stopped',
  'action_proposed':               'Agent decision made',
  'policy_validated':              'Policy check passed',
  'policy_rejected':               'Policy check failed',
  'action_execution_started':      'Action started',
  'action_execution_succeeded':    'Action completed',
  'action_execution_failed':       'Action failed',
  'sla_breached':                  '⚠ SLA deadline missed',
  'escalation_triggered':          'Escalation triggered',
  'escalation_sent':               'Manager notified',
  'human_review_requested':        'Human review required',
  'human_approved':                'Approved by human',
  'human_rejected':                'Rejected by human',
  'play_completed':                'Play completed',
  'play_marked_nurture':           'Moved to nurture',
  'play_marked_duplicate':         'Marked as duplicate',
}

const STAGE_COLORS: Record<string, string> = {
  new: 'bg-gray-100 text-gray-800',
  enriching: 'bg-blue-100 text-blue-800',
  routing: 'bg-purple-100 text-purple-800',
  in_sequence: 'bg-green-100 text-green-800',
  meeting_booked: 'bg-emerald-100 text-emerald-800',
  nurture: 'bg-amber-100 text-amber-800',
  lost: 'bg-red-100 text-red-800',
}

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let lead: Lead
  let timeline: TimelineEvent[]
  
  try {
    const token = getServerToken()
    const [leadRes, timelineRes] = await Promise.all([
      apiFetch(`/api/leads/${id}`, token),
      apiFetch(`/api/leads/${id}/timeline`, token)
    ])
    
    if (!leadRes.ok || !timelineRes.ok) throw new Error('Failed to fetch')
    
    lead = await leadRes.json()
    timeline = await timelineRes.json()
  } catch (error) {
    // Mock data for UI building
    lead = { id, company: 'Acme Corp', name: 'John Doe', title: 'CEO', stage: 'in_sequence', timeToFirstTouchMin: 12, assignedTo: 'Alice', formSubmittedAt: new Date(Date.now() - 3600000).toISOString() }
    timeline = [
      { id: '1', timestamp: new Date(Date.now() - 3600000).toISOString(), event_type: 'webhook_received', actor: 'System' },
      { id: '2', timestamp: new Date(Date.now() - 3590000).toISOString(), event_type: 'enrichment_requested', actor: 'System' },
      { id: '3', timestamp: new Date(Date.now() - 3585000).toISOString(), event_type: 'enrichment_succeeded', actor: 'Clearbit' },
      { id: '4', timestamp: new Date(Date.now() - 3580000).toISOString(), event_type: 'action_proposed', actor: 'QualificationAgent', reason_codes: ['high_intent', 'enterprise_tier'] },
      { id: '5', timestamp: new Date(Date.now() - 3575000).toISOString(), event_type: 'policy_validated', actor: 'PolicyValidator', policy_name: 'ICP Match', policy_passed: true },
      { id: '6', timestamp: new Date(Date.now() - 3570000).toISOString(), event_type: 'action_proposed', actor: 'RoutingAgent', reason_codes: ['territory_us_west', 'alice_available'] },
      { id: '7', timestamp: new Date(Date.now() - 3560000).toISOString(), event_type: 'action_execution_started', actor: 'ActionExecutor' },
      { id: '8', timestamp: new Date(Date.now() - 3550000).toISOString(), event_type: 'action_execution_succeeded', actor: 'Salesforce', external_confirmation: 'SFDC_LEAD_123' },
    ]
  }

  // Sort timeline oldest to newest
  const sortedTimeline = [...timeline].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())

  return (
    <div>
      <div className="bg-white rounded-xl shadow-sm border p-6 mb-8">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-3xl font-bold mb-2">{lead.name}</h1>
            <div className="text-xl text-gray-600 mb-4">{lead.title} at {lead.company}</div>
            <div className="text-sm text-gray-500">
              Form submitted: {new Date(lead.formSubmittedAt).toLocaleString()}
            </div>
          </div>
          <div>
            <Badge className={STAGE_COLORS[lead.stage] || 'bg-gray-100 text-gray-800'}>{lead.stage.replace('_', ' ')}</Badge>
          </div>
        </div>
      </div>

      <h2 className="text-xl font-bold mb-6">Event Timeline</h2>
      
      <div className="space-y-6 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-slate-300 before:to-transparent">
        {sortedTimeline.map((event, index) => (
          <div key={event.id} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
            <div className="flex items-center justify-center w-10 h-10 rounded-full border border-white bg-slate-300 group-[.is-active]:bg-emerald-500 text-white shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 shadow-sm">
              <span className="text-sm">{index + 1}</span>
            </div>
            
            <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] p-4 rounded-xl border bg-white shadow-sm">
              <div className="flex items-center justify-between space-x-2 mb-1">
                <div className="font-bold text-slate-900">{EVENT_LABELS[event.event_type] || event.event_type}</div>
                <time className="font-mono text-xs text-slate-500">{new Date(event.timestamp).toLocaleTimeString()}</time>
              </div>
              <div className="text-sm text-slate-500 mb-2">Actor: {event.actor}</div>
              
              {/* Agent event */}
              {event.reason_codes && event.reason_codes.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {event.reason_codes.map(code => (
                    <Badge key={code} variant="secondary" className="text-xs">{code.replace(/_/g, ' ')}</Badge>
                  ))}
                </div>
              )}
              
              {/* Policy event */}
              {event.policy_name && (
                <div className="mt-2 text-sm">
                  <span className="font-medium">{event.policy_name}: </span>
                  {event.policy_passed ? (
                    <span className="text-emerald-600">Passed ✓</span>
                  ) : (
                    <span className="text-red-600">Failed ✗</span>
                  )}
                </div>
              )}
              
              {/* Error */}
              {event.error_code && (
                <div className="mt-2 text-sm text-red-600 font-medium">
                  Error: {event.error_code}
                </div>
              )}
              
              {/* External Confirmation */}
              {event.external_confirmation && (
                <div className="mt-2 text-sm text-blue-600 bg-blue-50 p-2 rounded">
                  Confirmed: {event.external_confirmation}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
