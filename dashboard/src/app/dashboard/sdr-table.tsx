'use client';

import { useState } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { SpeedToLeadDistribution } from '@/types/api';

export function SdrTable({ stats }: { stats: SpeedToLeadDistribution['sdrStats'] }) {
  const [sortDesc, setSortDesc] = useState(true);
  
  const sorted = [...stats].sort((a, b) => {
    return sortDesc 
      ? b.under15MinPct - a.under15MinPct 
      : a.under15MinPct - b.under15MinPct;
  });

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Median First Touch</TableHead>
          <TableHead 
            className="cursor-pointer hover:bg-gray-50"
            onClick={() => setSortDesc(!sortDesc)}
          >
            % &lt;15min {sortDesc ? '↓' : '↑'}
          </TableHead>
          <TableHead>Meetings Booked</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map(sdr => (
          <TableRow key={sdr.name}>
            <TableCell className="font-medium">{sdr.name}</TableCell>
            <TableCell>{sdr.medianFirstTouchMin} min</TableCell>
            <TableCell>{sdr.under15MinPct}%</TableCell>
            <TableCell>{sdr.meetingsBooked}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
