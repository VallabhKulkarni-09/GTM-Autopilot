'use client';

import { useRouter, useSearchParams } from 'next/navigation';

export function LeadsFilter() {
  const router = useRouter();
  const searchParams = useSearchParams();
  
  const stage = searchParams.get('stage') || 'all';
  const dateRange = searchParams.get('dateRange') || 'all';

  const updateFilter = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value === 'all') {
      params.delete(key);
    } else {
      params.set(key, value);
    }
    params.set('page', '1'); // reset page
    router.push(`/leads?${params.toString()}`);
  };

  return (
    <div className="flex gap-4 mb-6">
      <select 
        value={stage}
        onChange={(e) => updateFilter('stage', e.target.value)}
        className="border p-2 rounded"
      >
        <option value="all">All Stages</option>
        <option value="new">New</option>
        <option value="enriching">Enriching</option>
        <option value="routing">Routing</option>
        <option value="in_sequence">In Sequence</option>
        <option value="meeting_booked">Meeting Booked</option>
        <option value="nurture">Nurture</option>
        <option value="lost">Lost</option>
      </select>
      
      <select 
        value={dateRange}
        onChange={(e) => updateFilter('dateRange', e.target.value)}
        className="border p-2 rounded"
      >
        <option value="all">All Time</option>
        <option value="7d">Last 7 Days</option>
        <option value="30d">Last 30 Days</option>
      </select>
    </div>
  );
}
