'use client';

import { Download } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui';
import { track } from '@/lib/analytics';

type Props = { campaignId: string; disabled?: boolean };

export function ExportCampaignButton({ campaignId, disabled }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onExport() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/export`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.error ?? `http ${res.status}`);
        return;
      }
      const blob = await res.blob();
      const filename =
        res.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] ?? 'campaign.zip';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      track('campaign_exported', { format: 'zip' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'export failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {error && <span className="font-mono text-[11px] text-danger">{error}</span>}
      <Button
        variant="secondary"
        size="sm"
        onClick={onExport}
        disabled={busy || disabled}
        leadingIcon={<Download size={13} strokeWidth={1.75} />}
      >
        {busy ? 'zipping…' : 'export zip'}
      </Button>
    </div>
  );
}
