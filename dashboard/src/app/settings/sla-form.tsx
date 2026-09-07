'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function SlaForm({ ruleId, initialMinutes, token }: { ruleId: string; initialMinutes: number; token: string }) {
  const [minutes, setMinutes] = useState(initialMinutes);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch(`/api/policies/${ruleId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ sla_minutes: minutes })
      });
      if (!res.ok) throw new Error('Failed to save');
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      console.error(e);
      alert('Failed to save SLA');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-center space-x-4">
      <div className="w-48">
        <label className="text-sm font-medium text-gray-700 block mb-1">First touch SLA (minutes)</label>
        <Input 
          type="number" 
          value={minutes} 
          onChange={e => setMinutes(Number(e.target.value))}
          min={1}
        />
      </div>
      <div className="mt-6">
        <Button onClick={handleSave} disabled={saving || minutes === initialMinutes}>
          {saving ? 'Saving...' : 'Save'}
        </Button>
      </div>
      {saved && <span className="mt-6 text-emerald-600 text-sm">Saved!</span>}
    </div>
  );
}
