'use client';

import { Download, MoreVertical, Pencil, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Spinner } from '@/components/ui';
import { track } from '@/lib/analytics';
import type { CampaignTile } from '@/lib/campaigns';
import { AD_STACK_COUNT, isStackedPreset, PRESETS, stackedAspectRatio } from '@/lib/presets';
import type { CreativeGroup } from './creativeGroups';
import { slotsForTile } from './creativeGroups';
import { type TileWorkflowStatus, useTileWorkflow } from './useTileWorkflow';

type Props = { campaignId: string; group: CreativeGroup };

export function CampaignCreativeRow({ campaignId, group }: Props) {
  const preset = PRESETS[group.presetId];

  return (
    <section data-testid="campaign-creative-row" className="border-b border-line-subtle py-5">
      <div className="mb-3 flex items-center gap-3">
        <span className="font-display text-[15px] font-semibold text-fg-0">{preset.label}</span>
        <span className="font-mono text-[11px] text-fg-3">{preset.ratio}</span>
        <span className="font-mono text-[11px] text-fg-3">
          {group.tiles.length} {group.tiles.length === 1 ? 'variant' : 'variants'}
          {isStackedPreset(group.presetId) ? ` · ${AD_STACK_COUNT} per sheet` : ''}
        </span>
      </div>
      <div className="flex flex-wrap gap-3 pb-1">
        {group.tiles.map((tile) => (
          <VariantThumb key={tile.id} campaignId={campaignId} tile={tile} />
        ))}
      </div>
    </section>
  );
}

/**
 * Renders one tile's image(s) and owns its live workflow poll. A grouped (new)
 * variant tile renders a single image linking to its own editor. A legacy tile
 * renders its `quantity` images, each linking to the same editor with `?v=<i>`
 * (handled by the editor's `initialVariant`).
 */
function VariantThumb({ campaignId, tile }: { campaignId: string; tile: CampaignTile }) {
  const preset = PRESETS[tile.presetId];
  const { imageUrls, status, setStatus, setError, setWorkflowId } = useTileWorkflow(
    tile.workflowId,
    {
      status: tile.status,
      imageUrls: tile.assetUrl ? [tile.assetUrl] : [],
    },
  );
  const [regenerating, setRegenerating] = useState(false);
  const base = `/campaigns/${campaignId}/c/${tile.id}`;
  const slots = slotsForTile(tile, imageUrls.length);
  // Stacked (wide-ad) tiles render the 3-banner sheet at its real generated AR,
  // not the preset's narrow strip ratio. The stack count is the constant.
  const stacked = isStackedPreset(tile.presetId);
  const displayRatio = stacked
    ? stackedAspectRatio(preset, AD_STACK_COUNT)
    : preset.width / preset.height;

  async function redo() {
    setRegenerating(true);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/tiles/${tile.id}/regenerate`, {
        method: 'POST',
      });
      const data = (await res.json().catch(() => ({}))) as { workflowId?: string };
      if (res.ok && data.workflowId) {
        // Clear the failure and flip to cooking so the tile starts polling the
        // new workflow immediately instead of sitting on the failed state.
        setError(null);
        setStatus('cooking');
        setWorkflowId(data.workflowId);
        track('tile_regenerated', { tileId: tile.id });
      }
    } finally {
      setRegenerating(false);
    }
  }

  return (
    <>
      {Array.from({ length: slots }).map((_, i) => (
        <RowImage
          key={i}
          url={imageUrls[i] ?? null}
          status={status}
          editHref={i === 0 ? base : `${base}?v=${i}`}
          ratio={displayRatio}
          stacked={stacked}
          filename={`${preset.id}-${tile.id}-${i}`}
          onRegenerate={redo}
          regenerating={regenerating}
        />
      ))}
    </>
  );
}

/**
 * Display width (px) for a variant tile, scaled by aspect ratio so wide banners
 * (leaderboards at 8:1) get more width instead of rendering as a tiny sliver,
 * while tall/square tiles stay near the base size. Stacked 3-banner sheets render
 * a bit larger so the stacked banners and their text stay legible, but there are
 * N per row so the bounds stay grid-friendly. Combined with `flex-wrap` on the
 * row, tiles lay out as a grid that flows to the next line at the edge.
 */
function tileWidth(ratio: number, stacked: boolean): number {
  if (stacked) return Math.max(260, Math.min(480, Math.round(220 * ratio)));
  const BASE_HEIGHT = 168;
  const MIN_WIDTH = 168;
  const MAX_WIDTH = 480;
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(BASE_HEIGHT * ratio)));
}

function RowImage({
  url,
  status,
  editHref,
  ratio,
  stacked = false,
  filename,
  onRegenerate,
  regenerating,
}: {
  url: string | null;
  status: TileWorkflowStatus;
  editHref: string;
  ratio: number;
  stacked?: boolean;
  filename: string;
  onRegenerate: () => void;
  regenerating: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Click-outside + Escape to dismiss the menu. Mirrors the `TileMenu`
  // pattern in `CreativeCard` so the campaign overlays behave consistently.
  useEffect(() => {
    if (!menuOpen) return;
    function onDocClick(e: MouseEvent) {
      if (!menuRef.current) return;
      if (e.target instanceof Node && menuRef.current.contains(e.target)) return;
      setMenuOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  function downloadOne() {
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener noreferrer';
    a.click();
  }

  return (
    <div
      className="relative shrink-0 overflow-hidden rounded-[10px] border border-line bg-bg-3"
      style={{ width: tileWidth(ratio, stacked), maxWidth: '100%', aspectRatio: ratio }}
    >
      {url ? (
        <Link href={editHref} aria-label="edit creative">
          <img src={url} alt="" className="h-full w-full object-cover" />
        </Link>
      ) : status === 'failed' ? (
        <button
          type="button"
          data-testid="row-image-failed"
          onClick={onRegenerate}
          disabled={regenerating}
          aria-label="generation failed — regenerate"
          className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-bg-3 px-2 text-center text-fg-3 transition-colors hover:text-fg-1 disabled:opacity-60"
        >
          <RefreshCw
            size={14}
            strokeWidth={1.75}
            className={regenerating ? 'animate-spin' : ''}
          />
          <span className="font-mono text-[10px] leading-tight">
            {regenerating ? 'retrying…' : "didn't generate · retry"}
          </span>
        </button>
      ) : (
        <div
          className="absolute inset-0 flex items-center justify-center bg-bg-2"
          data-testid="row-image-skeleton"
        >
          <Spinner size={18} className="text-fg-3" label="cooking" />
        </div>
      )}
      {url && (
        <div ref={menuRef} className="absolute right-1.5 top-1.5">
          <button
            type="button"
            data-testid="row-image-menu"
            aria-label="image options"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
            className="grid size-6 place-items-center rounded-[6px] bg-black/55 text-white backdrop-blur-md"
          >
            <MoreVertical size={13} strokeWidth={1.75} />
          </button>
          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 top-7 z-10 w-36 overflow-hidden rounded-[8px] border border-line-subtle bg-bg-1 py-1 shadow-lg"
            >
              <Link
                role="menuitem"
                href={editHref}
                className="flex items-center gap-2 px-3 py-1.5 text-[12px] text-fg-1 hover:bg-bg-2"
              >
                <Pencil size={12} strokeWidth={1.75} /> edit
              </Link>
              <button
                role="menuitem"
                type="button"
                onClick={() => {
                  downloadOne();
                  setMenuOpen(false);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-fg-1 hover:bg-bg-2"
              >
                <Download size={12} strokeWidth={1.75} /> download
              </button>
              <button
                role="menuitem"
                type="button"
                disabled={regenerating}
                onClick={() => {
                  onRegenerate();
                  setMenuOpen(false);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-fg-1 hover:bg-bg-2 disabled:opacity-40"
              >
                <RefreshCw
                  size={12}
                  strokeWidth={1.75}
                  className={regenerating ? 'animate-spin' : ''}
                />{' '}
                regenerate
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
