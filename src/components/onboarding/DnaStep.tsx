'use client';

import { ArrowRight, Globe, Pencil, Plus, TriangleAlert, UploadCloud, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Button, cn, Input, Textarea } from '@/components/ui';
import { track } from '@/lib/analytics';
import { pickContrast } from '@/lib/color';
import type { OnboardingPayload, ScrapedSite } from '@/lib/onboarding';
import { isBrandDnaSufficient } from '@/lib/onboardingValidation';
import { ColorPickerChip } from './ColorPickerChip';
import { LogoPreview } from './LogoPreview';
import { useLogoUpload } from './useLogoUpload';

type Props = {
  payload: OnboardingPayload;
};

const DEFAULT_TONE = ['playful', 'plainspoken', 'lowercase', 'punchy', 'warm'];

export function DnaStep({ payload }: Props) {
  const router = useRouter();
  const scrape: ScrapedSite | null = payload.scrape ?? null;
  const websiteUrl = payload.websiteUrl ?? null;

  const [brandName, setBrandName] = useState<string>(
    payload.brandName?.trim() || scrape?.brandName?.trim() || hostnameLabel(scrape?.finalUrl) || '',
  );
  const [tagline, setTagline] = useState<string>(payload.tagline ?? '');
  const [description, setDescription] = useState<string>(
    payload.description ?? scrape?.description ?? '',
  );
  const [tone, setTone] = useState<string[]>(payload.tone ?? []);
  const [font, setFont] = useState<string>(payload.font ?? scrape?.font ?? '');
  const [colors, setColors] = useState<string[]>(
    (payload.colors && payload.colors.length > 0
      ? payload.colors
      : (scrape?.palette ?? [])
    ).slice(0, 6),
  );
  const [logoUrl, setLogoUrl] = useState<string | null>(payload.logoUrl ?? scrape?.logoUrl ?? null);
  const [logoName, setLogoName] = useState<string | null>(payload.logoName ?? null);
  const logoUpload = useLogoUpload();
  const brandDnaTrackedRef = useRef(false);

  async function handleLogoFile(file: File) {
    setLogoName(file.name);
    const result = await logoUpload.upload(file);
    if (result) setLogoUrl(result.publicUrl);
  }

  function clearLogo() {
    setLogoUrl(null);
    setLogoName(null);
  }

  function toggleColor(hex: string) {
    setColors((cs) => {
      if (cs.includes(hex)) return cs.filter((x) => x !== hex);
      if (cs.length >= 6) return cs;
      return [...cs, hex];
    });
  }

  function addColor(hex: string) {
    const c = hex.toLowerCase();
    setColors((cs) => {
      if (cs.includes(c)) return cs;
      if (cs.length >= 6) return cs;
      return [c, ...cs];
    });
  }

  function removeColor(hex: string) {
    setColors((cs) => cs.filter((c) => c !== hex));
  }

  const isInitialMount = useRef(true);
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      void fetch('/api/onboarding/payload', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        signal: ctrl.signal,
        body: JSON.stringify({
          brandName,
          tagline,
          description,
          tone,
          font,
          colors,
          logoUrl,
          logoName,
        }),
      })
        .then((res) => {
          if (res.ok && !brandDnaTrackedRef.current) {
            brandDnaTrackedRef.current = true;
            track('brand_dna_saved', { fonts: font ? 1 : 0, colors: colors.length });
          }
        })
        .catch(() => {});
    }, 500);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [brandName, tagline, description, tone, font, colors, logoUrl, logoName]);

  const sourceLabel = scrape
    ? `scraped from ${hostnameLabel(scrape.finalUrl)}`
    : 'no website scanned yet';
  const subtitle = hostnameLabel(scrape?.finalUrl ?? websiteUrl);

  const readiness = computeReadiness({
    brandName,
    palette: colors,
    description,
    logoUrl,
    tagline,
    tone,
    font,
  });

  return (
    <section className="flex flex-col gap-8 pt-10">
      <header className="flex flex-col gap-2 text-center">
        <span className="t-eyebrow">// dna reveal</span>
        <h2 className="t-h2 text-fg-0">your brand dna.</h2>
        <p className="mx-auto max-w-[520px] text-[14.5px] text-fg-2">
          {scrape
            ? 'we read everything you gave us. edit anything that feels off — vitrine will learn.'
            : 'fill the details that make you, you. anything you skip we will guess at later.'}
        </p>
        <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-fg-3">
          {sourceLabel}
        </span>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <DnaCard title="identity">
          <Input
            value={brandName}
            onChange={(e) => setBrandName(e.target.value)}
            placeholder="your brand name"
            className="font-display text-[22px] font-bold tracking-[-0.02em]"
          />
          {subtitle && <p className="truncate text-[12px] text-fg-3">{subtitle}</p>}
        </DnaCard>

        <DnaCard title="logo">
          {logoUrl ? (
            <LogoPreview
              src={logoUrl}
              name={logoName ?? (brandName.trim() || null)}
              caption="your brand logo."
              helperText="replace or remove anytime. we crop + tint automatically."
              onReplace={handleLogoFile}
              onRemove={clearLogo}
              status={logoUpload.status}
            />
          ) : (
            <label className="flex h-[120px] cursor-pointer flex-col items-center justify-center gap-2 rounded-[14px] border border-dashed border-line bg-bg-3/60 text-fg-2 transition-colors duration-fast ease-out hover:border-line-volt hover:text-volt">
              {logoUpload.status.kind === 'uploading' ? (
                <Globe size={22} strokeWidth={1.5} className="animate-spin text-volt" />
              ) : (
                <UploadCloud size={22} strokeWidth={1.5} />
              )}
              <div className="text-center text-[12.5px]">
                <div className="text-fg-1">
                  {logoUpload.status.kind === 'uploading' ? 'uploading…' : 'add a logo'}
                </div>
                <div className="font-mono text-[10.5px] text-fg-3">png, svg, or jpg</div>
              </div>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleLogoFile(f);
                }}
              />
            </label>
          )}
          {logoUpload.status.kind === 'error' && (
            <p className="flex items-center gap-2 text-[12px] text-fg-2">
              <TriangleAlert size={12} strokeWidth={2} className="text-danger" />
              upload failed — {logoUpload.status.message}
            </p>
          )}
        </DnaCard>

        <DnaCard title="palette">
          {colors.length > 0 ? (
            <div className="flex flex-wrap items-center gap-3">
              {colors.map((c) => (
                <div key={c} className="group relative">
                  <button
                    type="button"
                    onClick={() => toggleColor(c)}
                    className="grid h-[56px] w-[56px] place-items-end rounded-[10px] border border-line p-2 transition-transform duration-fast ease-out hover:scale-[1.04]"
                    style={{ background: c }}
                    title={`${c} · tap to remove`}
                  >
                    <span
                      className="font-mono text-[9.5px] uppercase"
                      style={{
                        color: pickContrast(c),
                        opacity: 0.85,
                        textShadow:
                          pickContrast(c) === '#ffffff'
                            ? '0 1px 1px rgba(0,0,0,0.35)'
                            : '0 1px 1px rgba(255,255,255,0.35)',
                      }}
                    >
                      {c.slice(1)}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => removeColor(c)}
                    aria-label={`remove ${c}`}
                    className="absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-pill border border-line bg-bg-2 text-fg-2 opacity-0 transition-opacity duration-fast ease-out hover:text-danger group-hover:opacity-100 group-focus-within:opacity-100"
                  >
                    <X size={11} strokeWidth={2.5} />
                  </button>
                </div>
              ))}
              {colors.length < 6 && <ColorPickerChip onPick={addColor} />}
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <ColorPickerChip onPick={addColor} />
              <span className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-fg-3">
                no colors yet — pick one
              </span>
            </div>
          )}
        </DnaCard>

        <DnaCard title="fonts">
          <FontPicker value={font} onChange={setFont} />
        </DnaCard>

        <DnaCard title="tagline">
          <Input
            value={tagline}
            onChange={(e) => setTagline(e.target.value)}
            placeholder="small-batch heat. honest oil."
            className="font-display text-[18px] leading-[1.2] tracking-[-0.01em]"
          />
        </DnaCard>

        <DnaCard title="tone of voice">
          <TagInput
            value={tone}
            onChange={setTone}
            placeholder="add tone (playful, punchy, …)"
            suggestions={DEFAULT_TONE.filter((s) => !tone.includes(s))}
          />
        </DnaCard>

        <DnaCard title="business overview" wide>
          <Textarea
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="what do you sell, who buys, what's the vibe?"
          />
        </DnaCard>
      </div>

      <div className="flex items-center justify-between border-t border-line-subtle pt-6">
        <div className="flex items-center gap-5">
          <Link
            href="/onboarding/input"
            className="font-mono text-[12px] uppercase tracking-[0.12em] text-fg-3 hover:text-fg-1"
          >
            ← edit inputs
          </Link>
          <div className="hidden items-center gap-3 sm:flex">
            <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-fg-3">
              dna readiness
            </span>
            <span className="h-2 w-[160px] overflow-hidden rounded-pill bg-bg-3">
              <span
                className="block h-full bg-volt shadow-[0_0_12px_-2px_var(--volt-glow)] transition-[width] duration-300 ease-out"
                style={{ width: `${readiness}%` }}
              />
            </span>
            <span className="font-mono text-[11px] text-volt">{readiness}%</span>
          </div>
        </div>
        <Button
          variant="primary"
          size="lg"
          disabled={!isBrandDnaSufficient({ name: brandName, description, palette: colors })}
          onClick={() => router.push('/onboarding/next')}
          trailingIcon={<ArrowRight size={16} strokeWidth={1.75} />}
        >
          let&apos;s go
        </Button>
      </div>
    </section>
  );
}

function FontPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  useEffect(() => {
    const name = value.trim();
    if (!name) return;
    const id = `google-font-${slugifyFontName(name)}`;
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(name).replace(/%20/g, '+')}:wght@400;700&display=swap`;
    document.head.appendChild(link);
  }, [value]);

  function commit(next: string) {
    const t = next.trim();
    if (t === value) return;
    onChange(t);
  }

  const previewFont = value.trim() || draft.trim();
  const previewFamily = previewFont ? `'${previewFont}', ui-sans-serif, system-ui` : 'inherit';

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3 rounded-[10px] border border-line-subtle bg-bg-3/60 px-3 py-2">
        <span className="text-[36px] leading-none text-fg-0" style={{ fontFamily: previewFamily }}>
          Aa
        </span>
        <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-fg-3">
          {value.trim() ? value : 'using vitrine defaults'}
        </span>
      </div>
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit(draft);
            (e.target as HTMLInputElement).blur();
          }
        }}
        placeholder="e.g. Inter, Bricolage Grotesque (any google font)"
        spellCheck={false}
      />
      <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-fg-3">
        any name from{' '}
        <a
          href="https://fonts.google.com"
          target="_blank"
          rel="noreferrer"
          className="text-volt hover:underline"
        >
          fonts.google.com
        </a>{' '}
        — leave blank to use defaults
      </span>
    </div>
  );
}

function slugifyFontName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function TagInput({
  value,
  onChange,
  placeholder,
  suggestions = [],
}: {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  suggestions?: string[];
}) {
  const [draft, setDraft] = useState('');

  function commit() {
    const t = draft.trim();
    if (!t) return;
    if (value.some((v) => v.toLowerCase() === t.toLowerCase())) {
      setDraft('');
      return;
    }
    onChange([...value, t]);
    setDraft('');
  }

  function remove(tag: string) {
    onChange(value.filter((v) => v !== tag));
  }

  function addSuggestion(s: string) {
    if (value.some((v) => v.toLowerCase() === s.toLowerCase())) return;
    onChange([...value, s]);
  }

  // Selected tags first (in user order), then suggestion chips that aren't
  // already selected. Clicking either toggles membership; selected entries
  // get the volt-bordered style, suggestions get the muted dashed style.
  const selectedKeys = new Set(value.map((v) => v.toLowerCase()));
  const remainingSuggestions = suggestions.filter((s) => !selectedKeys.has(s.toLowerCase()));
  const pills: { label: string; on: boolean }[] = [
    ...value.map((tag) => ({ label: tag, on: true })),
    ...remainingSuggestions.map((tag) => ({ label: tag, on: false })),
  ];

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              commit();
            } else if (e.key === 'Backspace' && draft === '' && value.length > 0) {
              onChange(value.slice(0, -1));
            }
          }}
          placeholder={placeholder}
          className="text-[12.5px]"
        />
        <button
          type="button"
          onClick={commit}
          disabled={!draft.trim()}
          className="inline-flex h-9 items-center justify-center rounded-[8px] border border-line-volt bg-bg-3 px-2 text-fg-2 transition-colors duration-fast ease-out hover:text-volt disabled:cursor-not-allowed disabled:opacity-50"
          aria-label="add"
        >
          <Plus size={14} strokeWidth={2} />
        </button>
      </div>
      {pills.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {pills.map(({ label, on }) =>
            on ? (
              <span
                key={label}
                className="inline-flex items-center gap-1 rounded-pill border border-line-volt bg-volt-soft px-2.5 py-1 text-[12px] text-fg-0"
              >
                {label}
                <button
                  type="button"
                  onClick={() => remove(label)}
                  className="text-fg-3 hover:text-danger"
                  aria-label={`remove ${label}`}
                >
                  <X size={11} strokeWidth={2} />
                </button>
              </span>
            ) : (
              <button
                key={label}
                type="button"
                onClick={() => addSuggestion(label)}
                className="rounded-pill border border-dashed border-line bg-bg-3 px-2.5 py-1 text-[12px] text-fg-3 transition-colors duration-fast ease-out hover:border-line-volt hover:text-fg-1"
              >
                + {label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

function DnaCard({
  title,
  wide,
  children,
}: {
  title: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <article
      className={cn(
        'flex flex-col gap-3 rounded-[14px] border border-line-subtle bg-bg-2 p-4',
        wide && 'md:col-span-2',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="t-eyebrow">// {title}</span>
        <button
          type="button"
          aria-label={`edit ${title}`}
          className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-[8px] border border-line bg-bg-2 text-fg-2 transition-all duration-fast ease-out hover:border-line-volt hover:text-volt"
        >
          <Pencil size={13} strokeWidth={1.8} />
        </button>
      </div>
      {children}
    </article>
  );
}

function hostnameLabel(input: string | null | undefined): string | null {
  if (!input) return null;
  try {
    return new URL(input).hostname.replace(/^www\./i, '');
  } catch {
    return (
      input
        .replace(/^https?:\/\//i, '')
        .replace(/^www\./i, '')
        .split('/')[0] ?? null
    );
  }
}

function computeReadiness({
  brandName,
  palette,
  description,
  logoUrl,
  tagline,
  tone,
  font,
}: {
  brandName: string;
  palette: string[];
  description: string | null;
  logoUrl: string | null;
  tagline: string;
  tone: string[];
  font: string;
}): number {
  const checks: boolean[] = [
    brandName.trim().length > 0,
    palette.length > 0,
    Boolean(description && description.trim().length > 0),
    Boolean(logoUrl),
    tagline.trim().length > 0,
    tone.length > 0,
    font.trim().length > 0,
  ];
  const filled = checks.filter(Boolean).length;
  return Math.round((filled / checks.length) * 100);
}
