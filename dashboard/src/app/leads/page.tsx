import { apiFetch } from '@/lib/api'
import { getServerToken } from '@/lib/auth'
import { Lead, PaginatedLeads } from '@/types/api'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import Link from 'next/link'
import { LeadsFilter } from './leads-filter'

const STAGE_COLORS: Record<string, string> = {
  new: 'bg-gray-100 text-gray-800',
  enriching: 'bg-blue-100 text-blue-800',
  routing: 'bg-purple-100 text-purple-800',
  in_sequence: 'bg-green-100 text-green-800',
  meeting_booked: 'bg-emerald-100 text-emerald-800',
  nurture: 'bg-amber-100 text-amber-800',
  lost: 'bg-red-100 text-red-800',
}

export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const params = await searchParams;
  const page = Number(params.page || '1')
  const stage = typeof params.stage === 'string' ? params.stage : undefined
  const dateRange = typeof params.dateRange === 'string' ? params.dateRange : undefined

  let data: PaginatedLeads
  
  try {
    const token = getServerToken()
    const query = new URLSearchParams({ page: page.toString(), limit: '50' })
    if (stage) query.set('stage', stage)
    if (dateRange) query.set('dateRange', dateRange)
    
    const res = await apiFetch(`/api/leads?${query.toString()}`, token)
    if (!res.ok) throw new Error('Failed to fetch')
    data = await res.json()
  } catch (error) {
    // Mock data for UI building
    data = {
      data: [
        { id: '1', company: 'Acme Corp', name: 'John Doe', title: 'CEO', stage: 'new', timeToFirstTouchMin: null, assignedTo: null, formSubmittedAt: new Date().toISOString() },
        { id: '2', company: 'Globex', name: 'Jane Smith', title: 'VP Sales', stage: 'meeting_booked', timeToFirstTouchMin: 12, assignedTo: 'Alice', formSubmittedAt: new Date(Date.now() - 86400000).toISOString() },
      ],
      total: 2,
      page: 1,
      limit: 50
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Leads</h1>
      
      <LeadsFilter />
      
      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Company</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Title</TableHead>
              <TableHead>Stage</TableHead>
              <TableHead>Time to First Touch</TableHead>
              <TableHead>Assigned To</TableHead>
              <TableHead>Form Submitted</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.data.map(lead => (
              <TableRow key={lead.id} className="cursor-pointer hover:bg-gray-50">
                <TableCell>
                  <Link href={`/leads/${lead.id}`} className="block">{lead.company}</Link>
                </TableCell>
                <TableCell><Link href={`/leads/${lead.id}`} className="block">{lead.name}</Link></TableCell>
                <TableCell><Link href={`/leads/${lead.id}`} className="block">{lead.title}</Link></TableCell>
                <TableCell>
                  <Link href={`/leads/${lead.id}`} className="block">
                    <Badge className={STAGE_COLORS[lead.stage] || 'bg-gray-100 text-gray-800'}>{lead.stage.replace('_', ' ')}</Badge>
                  </Link>
                </TableCell>
                <TableCell><Link href={`/leads/${lead.id}`} className="block">{lead.timeToFirstTouchMin !== null ? `${lead.timeToFirstTouchMin} min` : '-'}</Link></TableCell>
                <TableCell><Link href={`/leads/${lead.id}`} className="block">{lead.assignedTo || '-'}</Link></TableCell>
                <TableCell><Link href={`/leads/${lead.id}`} className="block">{new Date(lead.formSubmittedAt).toLocaleString()}</Link></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex justify-between items-center mt-4">
        <div className="text-sm text-gray-500">
          Showing {data.data.length} of {data.total} leads
        </div>
        <div className="flex space-x-2">
          {page > 1 && (
            <Link href={`/leads?page=${page - 1}${stage ? `&stage=${stage}` : ''}${dateRange ? `&dateRange=${dateRange}` : ''}`} className="px-3 py-1 border rounded hover:bg-gray-50">
              Previous
            </Link>
          )}
          {data.page * data.limit < data.total && (
            <Link href={`/leads?page=${page + 1}${stage ? `&stage=${stage}` : ''}${dateRange ? `&dateRange=${dateRange}` : ''}`} className="px-3 py-1 border rounded hover:bg-gray-50">
              Next
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}
