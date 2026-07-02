'use client';

import { ArrowLeft, Box, Image as ImageIcon, Sparkles } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, BuzzPill, Chip, cn, FieldLabel, Input, PageTransition, Spinner, Textarea } from '@/components/ui';
import { GREEN_BUZZ_TOOLTIP } from '@/components/ui/BuzzPill';
import { track } from '@/lib/analytics';
import type { Asset } from '@/lib/assets';
import type { Product } from '@/lib/catalog';
import { buzzTopUpUrl } from '@/lib/links';
import {
  PHOTOSHOOT_TEMPLATES,
  recommendedTemplateIds,
  type PhotoshootRatio,
  type PhotoshootTemplate,
  type PhotoshootTemplateId,
} from '@/lib/photoshootTemplates';
import type { EnhancedPrompt } from '@/lib/promptBuilder';

const RATIOS: PhotoshootRatio[] = ['4:5', '9:16', '1:1', '16:9'];

const GROUP_LABEL: Record<PhotoshootTemplate['group'], string> = {
  studio: 'studio',
  lifestyle: 'lifestyle · in use',
  hero: 'hero',
};

const ALL_TEMPLATES: PhotoshootTemplate[] = Object.values(PHOTOSHOOT_TEMPLATES);

export type WizardStep = 'configure' | 'review' | 'submit';

export function isStep(value: string | null | undefined): value is WizardStep {
  return value === 'configure' || value === 'review' || value === 'submit';
}

/**
 * Build the request body for `POST /api/photoshoot/preview`. Pure helper —
 * exported so unit tests can lock the wire format without booting the wizard.
 */
export function buildPreviewPayload(
  brief: Brief,
  referenceAssetIds: string[],
): { brief: Brief; templateIds: PhotoshootTemplateId[]; referenceAssetIds: string[] } {
  return {
    brief,
    templateIds: brief.templateIds,
    referenceAssetIds,
  };
}

/**
 * Build the request body for `POST /api/photoshoot/cook`. Merges any
 * user-typed raw prompt overrides into the corresponding template's
 * `EnhancedPrompt.userOverride` field, leaving the rest of the prompt layers
 * intact so the audit trail keeps the brand-DNA composition. The free-text
 * `title` rides alongside the brief (independent of `productName`).
 */
export function buildCookPayload(
  brief: Brief,
  referenceAssetIds: string[],
  enhancedFromPreview: Record<string, EnhancedPrompt> | undefined,
  userOverrides: Record<string, string>,
  title: string,
): Brief & {
  title: string;
  referenceAssetIds: string[];
  enhancedPrompts: Record<string, EnhancedPrompt>;
} {
  const enhancedPrompts: Record<string, EnhancedPrompt> = {};
  for (const id of brief.templateIds) {
    const base = enhancedFromPreview?.[id];
    if (!base) continue;
    const trimmed = userOverrides[id]?.trim();
    enhancedPrompts[id] = {
      ...base,
      userOverride: trimmed ? trimmed : undefined,
    };
  }
  return { ...brief, title, referenceAssetIds, enhancedPrompts };
}

/**
 * Resolve the product name backing the brief's `productName` field. The wizard
 * never collects a product name directly — it derives one from the first
 * `product:<id>` reference (matched against the catalog). When no product is
 * attached we fall back to `'product'` so the schema's `min(1)` is satisfied.
 * Exported for unit testing.
 */
export function resolveProductName(referenceAssetIds: string[], products: Product[]): string {
  const ref = referenceAssetIds.find((id) => id.startsWith('product:'));
  if (ref) {
    const productId = ref.slice('product:'.length);
    const product = products.find((p) => p.id === productId);
    if (product?.name.trim()) return product.name.trim();
  }
  return 'product';
}

type PreviewResponse = {
  enhancedPrompts: Record<string, EnhancedPrompt>;
  estimatePerPreset: Record<string, number>;
  totalBuzz: number;
  errors?: Record<string, string>;
};

type CookResponse = {
  photoshootId?: string;
  id?: string;
  error?: string;
};

type DraftResponse = {
  draft?: {
    title: string;
    prompt: string;
    templateIds: PhotoshootTemplateId[];
  };
  error?: string;
};

export type Brief = {
  productName: string;
  productNotes: string;
  ratio: PhotoshootRatio;
  variantsPerTemplate: number;
  templateIds: PhotoshootTemplateId[];
};

/** A resolved reference thumbnail for the read-only configure display. */
type ResolvedReference = {
  id: string;
  kind: 'product' | 'asset';
  label: string;
  thumbUrl: string | null;
  isProduct: boolean;
};

/**
 * Resolve the prefixed reference ids to thumbnails. `product:<id>` matches a
 * catalog product (hero image), `asset:<id>` matches an uploaded asset (url).
 * Exported for unit testing.
 */
export function resolveReferences(
  referenceAssetIds: string[],
  products: Product[],
  assets: Asset[],
): ResolvedReference[] {
  const out: ResolvedReference[] = [];
  for (const ref of referenceAssetIds) {
    if (ref.startsWith('product:')) {
      const id = ref.slice('product:'.length);
      const product = products.find((p) => p.id === id);
      const thumbUrl = product?.heroAssetId
        ? (assets.find((a) => a.id === product.heroAssetId)?.publicUrl ?? product?.heroUrl ?? null)
        : (product?.heroUrl ?? null);
      out.push({
        id: ref,
        kind: 'product',
        label: product?.name ?? 'product',
        thumbUrl,
        isProduct: true,
      });
    } else if (ref.startsWith('asset:')) {
      const id = ref.slice('asset:'.length);
      const asset = assets.find((a) => a.id === id);
      const label = asset ? (asset.storageKey.split('/').pop() ?? asset.id) : 'upload';
      out.push({
        id: ref,
        kind: 'asset',
        label,
        thumbUrl: asset?.publicUrl ?? null,
        isProduct: false,
      });
    }
  }
  return out;
}

export type PhotoshootWizardProps = {
  prompt?: string | null;
  referenceAssetIds?: string[];
  buzzBalance?: number | null;
  libraryAssets: Asset[];
  libraryProducts: Product[];
};

export function PhotoshootWizard({
  prompt = null,
  referenceAssetIds = [],
  buzzBalance = null,
  libraryAssets,
  libraryProducts,
}: PhotoshootWizardProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawStep = searchParams?.get('step');
  const step: WizardStep = isStep(rawStep) ? rawStep : 'configure';

  const hasPrompt = !!prompt?.trim();

  // Product name is derived from the attached product reference (never typed).
  const productName = useMemo(
    () => resolveProductName(referenceAssetIds, libraryProducts),
    [referenceAssetIds, libraryProducts],
  );

  const references = useMemo(
    () => resolveReferences(referenceAssetIds, libraryProducts, libraryAssets),
    [referenceAssetIds, libraryProducts, libraryAssets],
  );

  // --- configure state -------------------------------------------------------
  // `title` is a free-text photoshoot name, independent of the product.
  const [title, setTitle] = useState('');
  // `masterPrompt` is the LLM-improved prompt; it maps to the brief's productNotes.
  const [masterPrompt, setMasterPrompt] = useState('');
  const [ratio, setRatio] = useState<PhotoshootRatio>('4:5');
  const [variants, setVariants] = useState(1);
  const [templateIds, setTemplateIds] = useState<Set<PhotoshootTemplateId>>(
    () => new Set(recommendedTemplateIds()),
  );

  // --- draft state -----------------------------------------------------------
  const [drafting, setDrafting] = useState(hasPrompt);

  // --- preview / review state ------------------------------------------------
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [userOverrides, setUserOverrides] = useState<Record<string, string>>({});

  // --- cook state ------------------------------------------------------------
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const goStep = useCallback(
    (next: WizardStep) => {
      const params = new URLSearchParams(searchParams?.toString() ?? '');
      params.set('step', next);
      router.replace(`/photoshoot/new?${params.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  const toggleTemplate = useCallback((id: PhotoshootTemplateId) => {
    setTemplateIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const buildBrief = useCallback((): Brief => {
    return {
      productName,
      productNotes:
        masterPrompt.trim() || 'small-batch product · studio clean · brand-forward, no overlays',
      ratio,
      variantsPerTemplate: variants,
      templateIds: Array.from(templateIds),
    };
  }, [productName, masterPrompt, ratio, variants, templateIds]);

  // --- auto-draft on mount ---------------------------------------------------
  // When arriving from the composer with a prompt, ask the server to improve it
  // into a title + master prompt + recommended styles. Fire once per mount.
  const didDraftRef = useRef(false);
  useEffect(() => {
    if (didDraftRef.current) return;
    if (!hasPrompt) return;
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch('/api/photoshoot/draft', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ prompt, referenceAssetIds, productName }),
          signal: controller.signal,
        });
        // An aborted run (StrictMode remount / navigation) must not commit the
        // dedupe guard or apply state — let the next effect run redo the draft.
        if (controller.signal.aborted) return;
        const json = (await res.json().catch(() => ({}))) as DraftResponse;
        didDraftRef.current = true;
        if (!res.ok || !json.draft) {
          setTitle(productName !== 'product' ? productName : 'Photoshoot');
          setMasterPrompt(prompt?.trim() ?? '');
          setTemplateIds(new Set(recommendedTemplateIds()));
          return;
        }
        setTitle(json.draft.title);
        setMasterPrompt(json.draft.prompt);
        setTemplateIds(
          new Set(
            json.draft.templateIds.length > 0 ? json.draft.templateIds : recommendedTemplateIds(),
          ),
        );
      } catch (err) {
        if (controller.signal.aborted || (err instanceof Error && err.name === 'AbortError')) {
          // Aborted: do NOT set the guard — the remount will retry.
          return;
        }
        didDraftRef.current = true;
        setTitle(productName !== 'product' ? productName : 'Photoshoot');
        setMasterPrompt(prompt?.trim() ?? '');
        setTemplateIds(new Set(recommendedTemplateIds()));
      } finally {
        // Keep the "improving…" state across an aborted run so it doesn't flicker
        // to an enabled-but-empty Continue; the retrying run clears it.
        if (!controller.signal.aborted) setDrafting(false);
      }
    })();
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Fetch a fresh preview from the server. Buzz pricing depends on the
   * orchestrator estimate (image count, aspect, references) and the prompt
   * text, so we re-fetch when any of those change.
   */
  const fetchPreview = useCallback(async () => {
    if (templateIds.size === 0) {
      setPreviewError('pick at least one style');
      return null;
    }
    setPreviewing(true);
    setPreviewError(null);
    try {
      const brief = buildBrief();
      const res = await fetch('/api/photoshoot/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(buildPreviewPayload(brief, referenceAssetIds)),
      });
      const json = (await res.json().catch(() => ({}))) as PreviewResponse & {
        error?: string;
      };
      if (!res.ok) {
        setPreviewError(json?.error ?? `http ${res.status}`);
        setPreviewing(false);
        return null;
      }
      setPreview(json);
      setPreviewing(false);
      return json;
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : 'preview failed');
      setPreviewing(false);
      return null;
    }
  }, [templateIds, buildBrief, referenceAssetIds]);

  // Debounced live estimate while configuring or reviewing. Re-runs when the
  // prompt, styles, ratio, variants, or overrides change. Skipped while the
  // draft is still in flight (nothing meaningful to price yet) and when the
  // master prompt is empty (the brief is invalid).
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (step === 'submit') return;
    if (drafting) return;
    if (!masterPrompt.trim()) return;
    if (templateIds.size === 0) return;
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      void fetchPreview();
    }, 350);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
    // fetchPreview captures the current brief; re-run on the inputs it depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, drafting, masterPrompt, ratio, variants, templateIds, userOverrides, referenceAssetIds]);

  // --- handlers --------------------------------------------------------------

  async function onContinueToReview(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    const result = preview ?? (await fetchPreview());
    if (result) goStep('review');
  }

  async function onCook() {
    setSubmitError(null);
    setSubmitting(true);
    goStep('submit');
    try {
      const brief = buildBrief();
      const payload = buildCookPayload(
        brief,
        referenceAssetIds,
        preview?.enhancedPrompts,
        userOverrides,
        title.trim() || brief.productName,
      );
      const res = await fetch('/api/photoshoot/cook', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => ({}))) as CookResponse;
      if (!res.ok) {
        setSubmitError(body?.error ?? `http ${res.status}`);
        setSubmitting(false);
        goStep('review');
        return;
      }
      const id = body?.photoshootId ?? body?.id;
      if (!id) {
        setSubmitError('no photoshoot id returned');
        setSubmitting(false);
        goStep('review');
        return;
      }
      track('photoshoot_cook_submitted', { template: Array.from(templateIds).join(',') });
      router.replace(`/photoshoot/${id}`);
      router.refresh();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'submit failed');
      setSubmitting(false);
      goStep('review');
    }
  }

  // --- derived ---------------------------------------------------------------
  const totalShots = templateIds.size * variants;
  const totalBuzz = preview?.totalBuzz ?? 0;
  const promptEmpty = !masterPrompt.trim();

  // --- render ----------------------------------------------------------------
  return (
    <div className="relative pb-24" data-testid="photoshoot-wizard" data-step={step}>
      <header className="mx-auto max-w-[720px] text-center">
        <span className="t-eyebrow">
          // step 2 · shoot ·{' '}
          <span className="text-fg-1">
            {step === 'configure' ? 'configure' : step === 'review' ? 'review' : 'cooking'}
          </span>
        </span>
        <h1 className="mt-[6px] t-h1 text-fg-0">photoshoot.</h1>
        <p className="mx-auto mt-[6px] max-w-[540px] text-[15px] text-fg-2">
          one product → a studio set. configure, review, cook.
        </p>
        <StepDots step={step} />
      </header>

      <PageTransition motionKey={step}>
        {step === 'configure' && (
          <ConfigureStep
            drafting={drafting}
            references={references}
            title={title}
            setTitle={setTitle}
            masterPrompt={masterPrompt}
            setMasterPrompt={setMasterPrompt}
            ratio={ratio}
            setRatio={setRatio}
            variants={variants}
            setVariants={setVariants}
            templateIds={templateIds}
            toggleTemplate={toggleTemplate}
            totalShots={totalShots}
            totalBuzz={totalBuzz}
            previewing={previewing}
            previewError={previewError}
            promptEmpty={promptEmpty}
            onSubmit={onContinueToReview}
          />
        )}

        {step === 'review' && (
          <ReviewStep
            brief={buildBrief()}
            preview={preview}
            previewing={previewing}
            previewError={previewError}
            totalBuzz={totalBuzz}
            userOverrides={userOverrides}
            setUserOverrides={setUserOverrides}
            submitError={submitError}
            onBack={() => goStep('configure')}
            onCook={onCook}
            buzzBalance={buzzBalance}
          />
        )}

        {step === 'submit' && <SubmitStep submitting={submitting} error={submitError} />}
      </PageTransition>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* sub-components                                                              */
/* -------------------------------------------------------------------------- */

function StepDots({ step }: { step: WizardStep }) {
  const items: WizardStep[] = ['configure', 'review', 'submit'];
  return (
    <div
      className="mt-3 flex items-center justify-center gap-1.5"
      aria-label="wizard progress"
      data-testid="step-dots"
    >
      {items.map((s, i) => {
        const idx = items.indexOf(step);
        const reached = i <= idx;
        return (
          <span
            key={s}
            aria-current={s === step ? 'step' : undefined}
            className={cn(
              'h-1.5 w-6 rounded-pill transition-colors duration-fast',
              reached ? 'bg-volt' : 'bg-bg-3',
            )}
          />
        );
      })}
    </div>
  );
}

type ConfigureStepProps = {
  drafting: boolean;
  references: ResolvedReference[];
  title: string;
  setTitle: (v: string) => void;
  masterPrompt: string;
  setMasterPrompt: (v: string) => void;
  ratio: PhotoshootRatio;
  setRatio: (r: PhotoshootRatio) => void;
  variants: number;
  setVariants: (fn: (v: number) => number) => void;
  templateIds: Set<PhotoshootTemplateId>;
  toggleTemplate: (id: PhotoshootTemplateId) => void;
  totalShots: number;
  totalBuzz: number;
  previewing: boolean;
  previewError: string | null;
  promptEmpty: boolean;
  onSubmit: (e: React.FormEvent) => void;
};

function ConfigureStep(props: ConfigureStepProps) {
  const {
    drafting,
    references,
    title,
    setTitle,
    masterPrompt,
    setMasterPrompt,
    ratio,
    setRatio,
    variants,
    setVariants,
    templateIds,
    toggleTemplate,
    totalShots,
    totalBuzz,
    previewing,
    previewError,
    promptEmpty,
    onSubmit,
  } = props;

  const groups = useMemo(() => {
    const out: Record<PhotoshootTemplate['group'], PhotoshootTemplate[]> = {
      studio: [],
      lifestyle: [],
      hero: [],
    };
    for (const t of ALL_TEMPLATES) out[t.group].push(t);
    return out;
  }, []);

  return (
    <form onSubmit={onSubmit} data-testid="configure-step">
      <div className="mx-auto mt-10 grid w-full max-w-[1080px] grid-cols-1 gap-6 pb-36 md:grid-cols-[1fr_1.4fr] md:pb-24">
        {/* LEFT COLUMN — name + prompt + references */}
        <section className="flex flex-col gap-5">
          {references.length > 0 && (
            <div className="flex flex-col gap-2" data-testid="reference-strip">
              <h2 className="t-eyebrow">// subject &amp; references</h2>
              <div className="flex flex-wrap gap-2">
                {references.map((ref) => (
                  <div
                    key={ref.id}
                    data-testid="reference-thumb"
                    data-reference-id={ref.id}
                    className={cn(
                      'relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-[10px] border bg-bg-3',
                      ref.isProduct ? 'border-line-volt' : 'border-line-subtle',
                    )}
                    title={ref.label}
                  >
                    {ref.thumbUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={ref.thumbUrl}
                        alt={ref.label}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    ) : ref.isProduct ? (
                      <Box size={20} strokeWidth={1.5} className="text-fg-2" />
                    ) : (
                      <ImageIcon size={20} strokeWidth={1.5} className="text-fg-2" />
                    )}
                    {ref.isProduct && (
                      <span className="absolute bottom-0 left-0 right-0 bg-volt px-1 py-[1px] text-center font-mono text-[8px] uppercase tracking-[0.06em] text-fg-on-volt">
                        product
                      </span>
                    )}
                  </div>
                ))}
              </div>
              <p className="font-mono text-[10.5px] text-fg-3">
                delivered to the render as references · not editable here
              </p>
            </div>
          )}

          <div>
            <FieldLabel htmlFor="ps-name">name</FieldLabel>
            <Input
              id="ps-name"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="golden hour serum set"
              data-testid="photoshoot-name"
            />
          </div>

          <div>
            <FieldLabel htmlFor="ps-prompt">prompt</FieldLabel>
            <Textarea
              id="ps-prompt"
              value={masterPrompt}
              onChange={(e) => setMasterPrompt(e.target.value)}
              rows={6}
              placeholder="15ml amber dropper on a warm wooden counter, soft window light, honey palette, candid editorial framing"
              data-testid="photoshoot-prompt"
            />
            <p className="mt-1 text-[12px] text-fg-3">
              this prompt drives every style. brand dna fills the rest.
            </p>
          </div>
        </section>

        {/* RIGHT COLUMN — styles */}
        <section className="flex flex-col gap-6">
          {(['studio', 'lifestyle', 'hero'] as const).map((group) => (
            <div key={group} className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <h3 className="t-eyebrow">// {GROUP_LABEL[group]}</h3>
                <span className="font-mono text-[10.5px] text-fg-3">
                  {groups[group].length} options
                </span>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {groups[group].map((t) => {
                  const on = templateIds.has(t.id);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => toggleTemplate(t.id)}
                      aria-pressed={on}
                      data-testid="style-chip"
                      data-template-id={t.id}
                      data-active={on ? '' : undefined}
                      className={cn(
                        'group relative flex flex-col gap-2 rounded-[14px] border bg-bg-2 p-4 text-left transition-all duration-fast ease-out',
                        on
                          ? 'border-line-volt shadow-bloom-volt-sm'
                          : 'border-line-subtle hover:border-line-strong',
                      )}
                    >
                      {on && (
                        <span className="absolute right-3 top-3 grid h-5 w-5 place-items-center rounded-pill bg-volt text-fg-on-volt">
                          <svg
                            viewBox="0 0 24 24"
                            width="12"
                            height="12"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="3"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden
                          >
                            <path d="M5 12l5 5L20 7" />
                          </svg>
                        </span>
                      )}
                      <span className="font-display text-[15px] font-semibold tracking-[-0.015em] text-fg-0">
                        {t.label}
                      </span>
                      <span className="text-[12.5px] leading-[1.45] text-fg-2">
                        {t.styleNotes.split(',').slice(0, 2).join(',')}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </section>
      </div>

      {/* STICKY ACTION BAR */}
      <div className="fixed bottom-[calc(env(safe-area-inset-bottom)_+_84px)] left-0 right-0 z-sticky border-t border-line-subtle bg-bg-0/90 backdrop-blur-md md:bottom-0 md:left-[232px]">
        <div className="mx-auto flex max-w-[1080px] flex-wrap items-center gap-3 px-9 py-4">
          {/* Ratio chips */}
          <div className="flex items-center gap-1" role="group" aria-label="aspect ratio">
            {RATIOS.map((r) => (
              <Chip
                key={r}
                active={ratio === r}
                onClick={() => setRatio(r)}
                role="radio"
                aria-checked={ratio === r}
              >
                {r}
              </Chip>
            ))}
          </div>

          <span aria-hidden className="h-5 w-px shrink-0 bg-line-subtle" />

          {/* Variants stepper */}
          <div className="flex items-center gap-2 rounded-pill border border-line-subtle bg-bg-2 px-3 py-1 font-mono text-[11.5px] text-fg-1">
            variants
            <button
              type="button"
              aria-label="decrement variants"
              onClick={() => setVariants((v) => Math.max(1, v - 1))}
              className="px-2 text-fg-2 hover:text-fg-0"
            >
              −
            </button>
            <span className="w-4 text-center text-fg-0">{variants}</span>
            <button
              type="button"
              aria-label="increment variants"
              onClick={() => setVariants((v) => Math.min(4, v + 1))}
              className="px-2 text-fg-2 hover:text-fg-0"
            >
              +
            </button>
          </div>

          <span aria-hidden className="h-5 w-px shrink-0 bg-line-subtle" />

          <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-fg-2">
            {templateIds.size} style{templateIds.size === 1 ? '' : 's'} × {variants} variant
            {variants === 1 ? '' : 's'}
          </span>

          <span aria-hidden className="h-5 w-px shrink-0 bg-line-subtle" />

          <span className="font-mono text-[12px] text-fg-3">
            {totalShots} shot{totalShots === 1 ? '' : 's'}
          </span>

          {previewError && (
            <span className="font-mono text-[11.5px] text-danger">{previewError}</span>
          )}

          <span className="flex-1" />

          {drafting && (
            <span className="flex items-center gap-1 font-mono text-[11px] text-fg-3">
              <Spinner size={12} label={null} />
              improving prompt…
            </span>
          )}

          <Button
            type="submit"
            variant="primary"
            size="lg"
            disabled={drafting || previewing || templateIds.size === 0 || promptEmpty}
            leadingIcon={<Sparkles size={14} strokeWidth={1.75} />}
            data-testid="configure-continue"
          >
            {previewing ? (
              'estimating…'
            ) : (
              <>
                review
                {totalBuzz > 0 && (
                  <span className="ml-1 font-mono text-[11px] opacity-70">· {totalBuzz} buzz</span>
                )}
              </>
            )}
          </Button>
        </div>
      </div>
    </form>
  );
}

type ReviewStepProps = {
  brief: Brief;
  preview: PreviewResponse | null;
  previewing: boolean;
  previewError: string | null;
  totalBuzz: number;
  userOverrides: Record<string, string>;
  setUserOverrides: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  submitError: string | null;
  onBack: () => void;
  onCook: () => void;
  buzzBalance?: number | null;
};

function ReviewStep(props: ReviewStepProps) {
  const {
    brief,
    preview,
    previewing,
    previewError,
    totalBuzz,
    userOverrides,
    setUserOverrides,
    submitError,
    onBack,
    onCook,
    buzzBalance,
  } = props;
  const insufficientBuzz = typeof buzzBalance === 'number' && totalBuzz > buzzBalance;

  return (
    <div className="mx-auto mt-10 w-full max-w-[960px]" data-testid="review-step">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onBack} leadingIcon={<ArrowLeft size={14} />}>
            back
          </Button>
          <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-fg-3">
            {brief.templateIds.length} style{brief.templateIds.length === 1 ? '' : 's'} ·{' '}
            {brief.variantsPerTemplate} variant{brief.variantsPerTemplate === 1 ? '' : 's'} each
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-fg-3">total</span>
          <BuzzPill amount={totalBuzz} data-testid="total-buzz" title={GREEN_BUZZ_TOOLTIP} />
          <span className="text-fg-3 text-[10px]">green buzz</span>
        </div>
      </div>

      {previewError && (
        <div
          role="alert"
          className="mb-4 rounded-[12px] border border-line bg-bg-2 px-4 py-3 text-[13px] text-fg-1"
        >
          preview error — {previewError}
        </div>
      )}

      <div className="flex flex-col gap-4">
        {brief.templateIds.map((tid) => {
          const template = PHOTOSHOOT_TEMPLATES[tid];
          const enhanced = preview?.enhancedPrompts?.[tid];
          const buzz = preview?.estimatePerPreset?.[tid] ?? 0;
          const errorForId = preview?.errors?.[tid];
          const override = userOverrides[tid] ?? '';

          return (
            <TemplateReviewCard
              key={tid}
              template={template}
              enhanced={enhanced}
              buzz={buzz}
              ratio={
                (enhanced?.aspectRatio && RATIOS.includes(enhanced.aspectRatio as PhotoshootRatio)
                  ? (enhanced.aspectRatio as PhotoshootRatio)
                  : null) ?? brief.ratio
              }
              error={errorForId}
              override={override}
              onOverrideChange={(value) =>
                setUserOverrides((prev) => {
                  if (!value) {
                    if (!(tid in prev)) return prev;
                    const next = { ...prev };
                    delete next[tid];
                    return next;
                  }
                  return { ...prev, [tid]: value };
                })
              }
            />
          );
        })}
      </div>

      {submitError && (
        <div
          role="alert"
          className="mt-6 rounded-[12px] border border-line bg-bg-2 px-4 py-3 text-[13px] text-danger"
        >
          {submitError}
        </div>
      )}

      <div className="fixed bottom-[calc(env(safe-area-inset-bottom)_+_84px)] left-0 right-0 z-sticky border-t border-line-subtle bg-bg-0/90 backdrop-blur-md md:bottom-0 md:left-[232px]">
        <div className="mx-auto flex max-w-[960px] flex-wrap items-center gap-4 px-9 py-4">
          <Button variant="ghost" size="md" onClick={onBack} leadingIcon={<ArrowLeft size={14} />}>
            back
          </Button>
          <span className="flex-1" />
          {previewing && (
            <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-fg-3">
              re-estimating…
            </span>
          )}
          {insufficientBuzz && (
            <span className="font-mono text-[11.5px] text-danger" data-testid="insufficient-buzz">
              insufficient buzz ·{' '}
              <a
                href={buzzTopUpUrl()}
                target="_blank"
                rel="noreferrer"
                className="underline hover:text-fg-0"
              >
                top up
              </a>
            </span>
          )}
          <Button
            type="button"
            variant="primary"
            size="lg"
            onClick={onCook}
            disabled={previewing || !preview || totalBuzz <= 0 || insufficientBuzz}
            leadingIcon={<Sparkles size={14} strokeWidth={1.75} />}
            data-testid="cook-button"
          >
            cook for {totalBuzz} buzz
          </Button>
        </div>
      </div>
    </div>
  );
}

function TemplateReviewCard({
  template,
  enhanced,
  buzz,
  ratio,
  error,
  override,
  onOverrideChange,
}: {
  template: PhotoshootTemplate;
  enhanced: EnhancedPrompt | undefined;
  buzz: number;
  ratio: PhotoshootRatio;
  error?: string;
  override: string;
  onOverrideChange: (value: string) => void;
}) {
  const [brandOpen, setBrandOpen] = useState(false);

  const finalPrompt = enhanced?.finalPrompt ?? '';

  return (
    <article
      data-testid="template-card"
      data-template-id={template.id}
      className="rounded-[14px] border border-line-subtle bg-bg-2 p-5"
    >
      <header className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-fg-3">
          // {template.label}
        </span>
        <span className="flex-1" />
        <Chip ghost active>
          {ratio}
        </Chip>
        <BuzzPill amount={buzz} size="compact" data-testid="template-buzz" />
      </header>

      {error && (
        <p
          role="alert"
          className="mt-3 rounded-[10px] border border-line bg-bg-3 px-3 py-2 font-mono text-[11px] text-danger"
        >
          {error}
        </p>
      )}

      <div className="mt-4">
        <FieldLabel htmlFor={`prompt-${template.id}`}>final prompt</FieldLabel>
        <Textarea
          id={`prompt-${template.id}`}
          value={override.trim() ? override : finalPrompt}
          onChange={(e) => onOverrideChange(e.target.value)}
          rows={4}
          placeholder={finalPrompt}
          data-testid={`override-textarea-${template.id}`}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setBrandOpen((v) => !v)}
          aria-expanded={brandOpen}
          className="inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-[0.08em] text-fg-2 hover:text-fg-0"
          data-testid="brand-toggle"
        >
          {brandOpen ? '− hide' : '+ show'} what we added from your brand
        </button>
      </div>

      {brandOpen && enhanced && (
        <div className="mt-3 rounded-[10px] border border-line-subtle bg-bg-3 px-3 py-3 text-[12.5px] leading-[1.5]">
          <Layer label="brand" value={enhanced.brandLayer} />
          <Layer label="style" value={enhanced.styleLayer} />
          <Layer label="base" value={enhanced.base} />
          {enhanced.negativePrompt && <Layer label="negative" value={enhanced.negativePrompt} />}
        </div>
      )}
    </article>
  );
}

function Layer({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="flex items-baseline gap-2 [&:not(:last-child)]:mb-2">
      <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.1em] text-fg-3">
        {label}
      </span>
      <span className="text-fg-1">{value}</span>
    </div>
  );
}

function SubmitStep({ submitting, error }: { submitting: boolean; error: string | null }) {
  return (
    <div
      className="mx-auto mt-20 flex max-w-[480px] flex-col items-center gap-4 text-center"
      data-testid="submit-step"
    >
      <div
        className={cn(
          'grid h-14 w-14 place-items-center rounded-pill bg-volt-soft text-volt',
          submitting && 'animate-pulse',
        )}
      >
        <Sparkles size={22} strokeWidth={1.75} />
      </div>
      <h2 className="font-display text-[20px] font-semibold tracking-[-0.015em] text-fg-0">
        {error ? 'submit failed' : 'cooking your photoshoot…'}
      </h2>
      <p className="font-mono text-[12px] uppercase tracking-[0.08em] text-fg-3">
        {error ? error : 'queueing workflows · charging buzz · about to redirect'}
      </p>
    </div>
  );
}
