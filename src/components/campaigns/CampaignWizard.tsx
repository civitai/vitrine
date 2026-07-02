'use client';

import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Minus,
  Plus,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AssetCatalogPicker } from '@/components/pickers/AssetCatalogPicker';
import {
  Badge,
  Button,
  BuzzPill,
  Chip,
  cn,
  FieldLabel,
  Input,
  PageTransition,
  Select,
  Spinner,
  Textarea,
} from '@/components/ui';
import { GREEN_BUZZ_TOOLTIP } from '@/components/ui/BuzzPill';
import {
  type CampaignPreviewResponse,
  type FetchPreviewArgs,
  fetchCampaignPreview,
  type PreviewBrief,
  useCampaignPreview,
} from '@/hooks/useCampaignPreview';
import { track } from '@/lib/analytics';
import { buzzTopUpUrl } from '@/lib/links';
import type { EnhancedPrompt } from '@/lib/promptBuilder';
import { PresetGrid } from './PresetGrid';

type AdCopyShape = { headline: string; subhead: string; cta?: string };
type DraftShape = {
  title: string;
  description: string;
  goal: string;
  offer: string;
  audience: string;
  aesthetics: string;
  adCopy: Record<string, AdCopyShape>;
  copyPool?: AdCopyShape[];
};

export type CampaignWizardInitial = {
  brandName?: string | null;
  productCount?: number;
  assetCount?: number;
  buzzBalance?: number | null;
  defaultBrief?: Partial<PreviewBrief & { presetIds: string[] }>;
  defaultReferenceAssetIds?: string[];
};

type Props = {
  initial?: CampaignWizardInitial;
  /** Test seam — defaults to window.fetch. */
  fetcher?: typeof fetch;
};

type Step = 'prompt' | 'brief' | 'submit';

const STEP_ORDER: Step[] = ['prompt', 'brief', 'submit'];

const STEP_LABELS: Record<Step, string> = {
  prompt: 'describe',
  brief: 'review',
  submit: 'cook',
};

/**
 * The step dots a user sees depend on how they entered. Arriving from the
 * composer with a prompt skips the manual "describe" entry (we auto-draft) —
 * unless the auto-draft hard-fails and we drop them back onto the entry screen.
 */
export function resolveVisibleSteps(opts: {
  hasInitialPrompt: boolean;
  showingPromptEntry: boolean;
}): Step[] {
  if (opts.hasInitialPrompt && !opts.showingPromptEntry) return ['brief', 'submit'];
  return STEP_ORDER;
}

function parseStep(raw: string | null): Step {
  if (raw === 'brief' || raw === 'submit') return raw;
  return 'prompt';
}

const DEFAULT_BRIEF: PreviewBrief = {
  prompt: '',
  title: '',
  description: '',
  goal: '',
  offer: '',
  audience: '',
  aesthetics: '',
};

const DEFAULT_PRESETS = ['ig-feed', 'ig-story', 'li'];

/**
 * 3-step campaign wizard. Step state lives in the URL (`?step=...`) so the
 * flow is refresh-safe and browser-back-friendly. The wizard runs an LLM
 * draft pass between prompt → brief so the brief step lands pre-filled with
 * campaign fields + per-placement ad copy ready for the user to review.
 */
export function CampaignWizard({ initial, fetcher }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const step = parseStep(searchParams.get('step'));
  const hasInitialPrompt = !!initial?.defaultBrief?.prompt?.trim();

  /* ---------------------------------------------------------------- step 1 */
  const [brief, setBrief] = useState<PreviewBrief>(() => ({
    ...DEFAULT_BRIEF,
    ...(initial?.defaultBrief ?? {}),
  }));
  const [presetIds, setPresetIds] = useState<string[]>(
    () => initial?.defaultBrief?.presetIds ?? DEFAULT_PRESETS,
  );
  const [referenceAssetIds, setReferenceAssetIds] = useState<string[]>(
    () => initial?.defaultReferenceAssetIds ?? [],
  );
  const [variantsPerPreset, setVariantsPerPreset] = useState<number>(1);
  const [adCopy, setAdCopy] = useState<Record<string, AdCopyShape>>({});
  // Spare LLM-generated copy variants the review step rotates through as the
  // user adds output formats. The cursor tracks how many spares we've handed
  // out so each newly-added placement gets a distinct one (wraps when drained).
  const [copyPool, setCopyPool] = useState<AdCopyShape[]>([]);
  const poolCursorRef = useRef(0);
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [draftWarning, setDraftWarning] = useState<string | null>(null);

  /* ---------------------------------------------------------------- step 2 */
  const { preview, loading, error, schedule } = useCampaignPreview({ fetcher });
  const [userOverrides, setUserOverrides] = useState<Record<string, string>>({});
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showBrandLayer, setShowBrandLayer] = useState<Record<string, boolean>>({});
  const [perPresetLoading, setPerPresetLoading] = useState<Record<string, boolean>>({});

  /* ---------------------------------------------------------------- step 3 */
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  /* ---------------------------------------- prompt-entry vs auto-draft routing */
  // We auto-draft when the user arrived with a prompt. While that draft is in
  // flight we show only the overlay. A hard draft failure sets draftError and
  // reveals the manual prompt entry so the user can retry.
  const showingPromptEntry = step === 'prompt' && (!hasInitialPrompt || !!draftError);
  const autoDraftPending = step === 'prompt' && hasInitialPrompt && !draftError;
  const steps = resolveVisibleSteps({ hasInitialPrompt, showingPromptEntry });

  /* ----------------------------------------------------- url step transitions */
  const goToStep = useCallback(
    (next: Step) => {
      const sp = new URLSearchParams(searchParams.toString());
      if (next === 'prompt') sp.delete('step');
      else sp.set('step', next);
      const qs = sp.toString();
      router.replace(qs ? `/campaigns/new?${qs}` : `/campaigns/new`);
    },
    [router, searchParams],
  );

  /* ----------------------------------------- step → submit auto-run on enter */
  const submitInFlightRef = useRef(false);
  const didAutoDraftRef = useRef(false);
  useEffect(() => {
    if (step !== 'submit') return;
    if (submitInFlightRef.current) return;
    submitInFlightRef.current = true;
    void doCook();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const formArgs = useMemo<FetchPreviewArgs>(
    () => ({ brief, presetIds, variantsPerPreset, referenceAssetIds }),
    [brief, presetIds, variantsPerPreset, referenceAssetIds],
  );

  /* ----------------------------------------- prompt → draft → brief transition */
  const runDraft = useCallback(
    async ({ navigate }: { navigate: boolean }) => {
      setDraftError(null);
      if (!brief.prompt.trim()) {
        setDraftError('write a prompt first');
        return;
      }
      // presetIds is seeded to DEFAULT_PRESETS and the only control that can
      // empty it is the format picker (on the review step). So this guard never
      // fires from the prompt entry — it catches an empty selection on the
      // review step's regenerate.
      if (presetIds.length === 0) {
        setDraftError('pick at least one preset');
        return;
      }
      setDrafting(true);
      try {
        const f = fetcher ?? fetch;
        const res = await f('/api/campaigns/draft', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            prompt: brief.prompt,
            presetIds,
            referenceAssetIds,
          }),
        });
        const json = (await res.json().catch(() => ({}))) as {
          draft?: DraftShape;
          meta?: {
            llm?: 'ok' | 'fallback';
            model?: string;
            attempts?: string[];
            reason?: string;
          };
          error?: string;
        };
        if (!res.ok || !json.draft) {
          setDraftError(json.error ?? `http ${res.status}`);
          setDrafting(false);
          return;
        }
        const next: PreviewBrief = {
          prompt: brief.prompt,
          title: json.draft.title,
          description: json.draft.description,
          goal: json.draft.goal,
          offer: json.draft.offer,
          audience: json.draft.audience,
          aesthetics: json.draft.aesthetics,
        };
        setBrief(next);
        setAdCopy(json.draft.adCopy ?? {});
        setCopyPool(json.draft.copyPool ?? []);
        poolCursorRef.current = 0;
        setUserOverrides({});
        setDraftWarning(
          json.meta?.llm === 'fallback'
            ? `LLM draft unavailable — tried ${(json.meta?.attempts ?? []).join(', ') || 'no models'} · reason: ${json.meta?.reason ?? 'unknown'} · showing template brief`
            : null,
        );
        // Kick off the buzz preview so the brief step lands with an estimate.
        schedule({ brief: next, presetIds, variantsPerPreset, referenceAssetIds });
        if (navigate) goToStep('brief');
      } catch (err) {
        setDraftError(err instanceof Error ? err.message : 'draft failed');
      } finally {
        setDrafting(false);
      }
    },
    [brief.prompt, presetIds, referenceAssetIds, variantsPerPreset, fetcher, goToStep, schedule],
  );

  /* ------------------------------- auto-draft on arrival when a prompt exists */
  // The ref fires the draft once per mount. StrictMode's dev double-invoke keeps
  // the same ref, so it stays single-fire; only a real remount re-fires, same
  // trade-off the submit auto-run above accepts. runDraft is idempotent enough
  // that a stray re-POST is cosmetic, not corrupting.
  useEffect(() => {
    if (didAutoDraftRef.current) return;
    if (step !== 'prompt') return;
    if (!hasInitialPrompt) return;
    if (!brief.prompt.trim()) return;
    didAutoDraftRef.current = true;
    void runDraft({ navigate: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, hasInitialPrompt]);

  async function handleGenerateDraft(e: React.FormEvent) {
    e.preventDefault();
    await runDraft({ navigate: true });
  }
  async function handleRegenerateDraft() {
    await runDraft({ navigate: false });
  }

  /* -------------------------- re-preview whenever brief inputs change in step 2 */
  useEffect(() => {
    if (step !== 'brief') return;
    if (!brief.title.trim() || !brief.description.trim()) return;
    schedule(formArgs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, brief, presetIds, variantsPerPreset, referenceAssetIds]);

  /* ----------------------------- per-preset re-preview when override changes */
  function handleOverrideChange(presetId: string, value: string) {
    setUserOverrides((prev) => ({ ...prev, [presetId]: value }));
    setPerPresetLoading((prev) => ({ ...prev, [presetId]: true }));
    schedule(formArgs);
  }

  useEffect(() => {
    if (!loading) setPerPresetLoading({});
  }, [loading, preview]);

  /* -------------------------------------------------------------- brief → submit */
  async function handleCook() {
    setSubmitError(null);
    goToStep('submit');
  }

  async function doCook() {
    setSubmitting(true);
    try {
      // Apply user overrides onto the preview's enhanced prompts when present.
      const enhancedPrompts: Record<string, EnhancedPrompt> = {};
      if (preview) {
        for (const id of presetIds) {
          const ep = preview.enhancedPrompts[id];
          if (!ep) continue;
          const override = userOverrides[id]?.trim();
          enhancedPrompts[id] = { ...ep, userOverride: override || undefined };
        }
      }
      const body = {
        prompt: brief.prompt,
        title: brief.title,
        description: brief.description,
        goal: brief.goal,
        offer: brief.offer,
        audience: brief.audience,
        aesthetics: brief.aesthetics,
        presetIds,
        referenceAssetIds,
        variantsPerPreset,
        ...(Object.keys(enhancedPrompts).length > 0 ? { enhancedPrompts } : {}),
        ...(Object.keys(adCopy).length > 0 ? { adCopy } : {}),
      };
      const f = fetcher ?? fetch;
      const res = await f('/api/campaigns/cook', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as {
        campaignId?: string;
        error?: string;
      };
      if (!res.ok) {
        setSubmitError(json.error ?? `http ${res.status}`);
        setSubmitting(false);
        submitInFlightRef.current = false;
        goToStep('brief');
        return;
      }
      if (!json.campaignId) {
        setSubmitError('no campaign id returned');
        setSubmitting(false);
        submitInFlightRef.current = false;
        goToStep('brief');
        return;
      }
      track('campaign_cook_submitted', {
        tiles: presetIds.length * variantsPerPreset,
        preset: presetIds.join(','),
      });
      router.replace(`/campaigns/${json.campaignId}`);
      router.refresh();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'cook failed');
      setSubmitting(false);
      submitInFlightRef.current = false;
      goToStep('brief');
    }
  }

  /* --------------------------------------------------------------- rendering */
  return (
    <div className="flex flex-col gap-6">
      <StepDots steps={steps} step={step} />
      <PageTransition motionKey={step}>
        {step === 'prompt' &&
          (autoDraftPending ? (
            <DraftingOverlay />
          ) : (
            <PromptStep
              brief={brief}
              setBrief={setBrief}
              referenceAssetIds={referenceAssetIds}
              setReferenceAssetIds={setReferenceAssetIds}
              drafting={drafting}
              error={draftError}
              onContinue={handleGenerateDraft}
            />
          ))}
        {step === 'brief' && (
          <BriefStep
            brief={brief}
            setBrief={setBrief}
            adCopy={adCopy}
            setAdCopy={setAdCopy}
            copyPool={copyPool}
            poolCursorRef={poolCursorRef}
            presetIds={presetIds}
            setPresetIds={setPresetIds}
            variantsPerPreset={variantsPerPreset}
            setVariantsPerPreset={setVariantsPerPreset}
            preview={preview}
            previewLoading={loading}
            previewError={error}
            draftWarning={draftWarning}
            drafting={drafting}
            draftError={draftError}
            onRegenerate={handleRegenerateDraft}
            showAdvanced={showAdvanced}
            setShowAdvanced={setShowAdvanced}
            userOverrides={userOverrides}
            showBrandLayer={showBrandLayer}
            setShowBrandLayer={setShowBrandLayer}
            perPresetLoading={perPresetLoading}
            onOverrideChange={handleOverrideChange}
            onBack={() => goToStep('prompt')}
            onCook={handleCook}
            buzzBalance={initial?.buzzBalance ?? null}
          />
        )}
        {step === 'submit' && <SubmitStep submitting={submitting} error={submitError} />}
      </PageTransition>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* step dots                                                                   */
/* -------------------------------------------------------------------------- */

function StepDots({ steps, step }: { steps: Step[]; step: Step }) {
  // The active step can be absent from `steps` on purpose: while we auto-draft
  // an incoming prompt, `step` is still 'prompt' but the visible steps are
  // ['brief','submit'] — we want the first visible dot (review) lit, so fall
  // back to index 0 rather than leaving no dot current.
  const rawIdx = steps.indexOf(step);
  const idx = rawIdx === -1 ? 0 : rawIdx;
  return (
    <div
      className="flex items-center gap-2"
      role="tablist"
      aria-label="campaign wizard steps"
      data-step={step}
    >
      {steps.map((s, i) => {
        const state = i < idx ? 'done' : i === idx ? 'current' : 'upcoming';
        return (
          <div key={s} className="flex items-center gap-2">
            <span
              role="tab"
              aria-selected={state === 'current'}
              data-state={state}
              className={cn(
                'font-mono text-[10px] uppercase tracking-[0.1em]',
                state === 'current' && 'text-fg-0',
                state === 'done' && 'text-volt',
                state === 'upcoming' && 'text-fg-3',
              )}
            >
              {`0${i + 1}`} · {STEP_LABELS[s]}
            </span>
            {i < steps.length - 1 && <span className="h-px w-6 bg-line" aria-hidden />}
          </div>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* step 1: prompt                                                              */
/* -------------------------------------------------------------------------- */

type PromptStepProps = {
  brief: PreviewBrief;
  setBrief: (next: PreviewBrief) => void;
  referenceAssetIds: string[];
  setReferenceAssetIds: (ids: string[]) => void;
  drafting: boolean;
  error: string | null;
  onContinue: (e: React.FormEvent) => void;
};

function PromptStep({
  brief,
  setBrief,
  referenceAssetIds,
  setReferenceAssetIds,
  drafting,
  error,
  onContinue,
}: PromptStepProps) {
  const canSubmit = brief.prompt.trim().length > 0;

  return (
    <form className="flex flex-col gap-6" onSubmit={onContinue} data-testid="prompt-step">
      {drafting && <DraftingOverlay />}

      <div>
        <FieldLabel htmlFor="prompt-input">your prompt</FieldLabel>
        <Textarea
          id="prompt-input"
          rows={4}
          value={brief.prompt}
          onChange={(e) => setBrief({ ...brief, prompt: e.target.value })}
          placeholder="describe the campaign you want — product, vibe, time of year, audience. we'll fill in the rest."
          data-testid="prompt-input"
        />
        <p className="mt-1 font-mono text-[10.5px] text-fg-3">
          we&rsquo;ll use this + your brand DNA to draft a full brief with copy for each placement.
          you&rsquo;ll pick formats and quantities on the next step.
        </p>
      </div>

      <section>
        <FieldLabel>references</FieldLabel>
        <AssetCatalogPicker value={referenceAssetIds} onChange={setReferenceAssetIds} max={4} />
      </section>

      <div className="flex flex-wrap items-center gap-4 border-t border-line-subtle pt-4">
        <span className="text-[12.5px] text-fg-3">
          a brief and per-placement copy will be drafted before you cook.
        </span>
        <span className="flex-1" />
        {error && (
          <span className="font-mono text-[11.5px] text-danger" data-testid="prompt-error">
            {error}
          </span>
        )}
        <Button
          variant="primary"
          size="lg"
          type="submit"
          disabled={drafting || !canSubmit}
          leadingIcon={
            drafting ? (
              <Spinner size={14} label={null} />
            ) : (
              <Sparkles size={14} strokeWidth={1.75} />
            )
          }
          data-testid="prompt-continue"
        >
          {drafting ? 'drafting…' : 'generate brief'}
        </Button>
      </div>
    </form>
  );
}

/* -------------------------------------------------------------------------- */
/* drafting overlay                                                            */
/* -------------------------------------------------------------------------- */

function DraftingOverlay() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-50 grid place-items-center bg-bg-0/80 backdrop-blur-sm"
      data-testid="drafting-overlay"
    >
      <div className="flex flex-col items-center gap-3 rounded-[14px] border border-line-subtle bg-bg-2 px-8 py-6 text-center">
        <Spinner size={28} className="text-volt" label={null} />
        <span className="font-mono text-[12px] uppercase tracking-[0.14em] text-fg-1">
          drafting your brief
        </span>
        <span className="max-w-[280px] text-[12.5px] text-fg-3">
          mixing your prompt with brand DNA and writing copy for each placement.
        </span>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* variants stepper                                                            */
/* -------------------------------------------------------------------------- */

function VariantsStepper({
  value,
  onChange,
  min = 1,
  max = 8,
}: {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <div className="inline-flex items-center gap-2" data-testid="variants-stepper">
      <button
        type="button"
        aria-label="decrement variants"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        className={cn(
          'inline-flex h-9 w-9 items-center justify-center rounded-[9px] border border-line bg-bg-2 text-fg-1',
          'hover:border-line-strong hover:text-fg-0 disabled:cursor-not-allowed disabled:opacity-50',
        )}
      >
        <Minus size={14} strokeWidth={1.75} />
      </button>
      <span
        className="min-w-[2.5ch] text-center font-mono text-[15px] text-fg-0"
        data-testid="variants-value"
      >
        {value}
      </span>
      <button
        type="button"
        aria-label="increment variants"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        className={cn(
          'inline-flex h-9 w-9 items-center justify-center rounded-[9px] border border-line bg-bg-2 text-fg-1',
          'hover:border-line-strong hover:text-fg-0 disabled:cursor-not-allowed disabled:opacity-50',
        )}
      >
        <Plus size={14} strokeWidth={1.75} />
      </button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* goal select                                                                 */
/* -------------------------------------------------------------------------- */

const GOAL_OPTIONS = [
  'promote a new product',
  'drive signups',
  'announce a launch',
  'seasonal sale',
  'build awareness',
] as const;

function GoalSelect({
  id,
  value,
  onChange,
}: {
  id?: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
}) {
  const isCustom =
    value.trim() !== '' && !GOAL_OPTIONS.includes(value as (typeof GOAL_OPTIONS)[number]);
  return (
    <Select id={id} value={value} onChange={onChange}>
      {isCustom && <option value={value}>{value}</option>}
      {GOAL_OPTIONS.map((opt) => (
        <option key={opt} value={opt}>
          {opt}
        </option>
      ))}
    </Select>
  );
}

/* -------------------------------------------------------------------------- */
/* step 2: brief                                                               */
/* -------------------------------------------------------------------------- */

type BriefStepProps = {
  brief: PreviewBrief;
  setBrief: (next: PreviewBrief) => void;
  adCopy: Record<string, AdCopyShape>;
  setAdCopy: (next: Record<string, AdCopyShape>) => void;
  copyPool: AdCopyShape[];
  poolCursorRef: React.RefObject<number>;
  presetIds: string[];
  setPresetIds: (ids: string[]) => void;
  variantsPerPreset: number;
  setVariantsPerPreset: (n: number) => void;
  preview: CampaignPreviewResponse | null;
  previewLoading: boolean;
  previewError: string | null;
  draftWarning: string | null;
  drafting: boolean;
  draftError: string | null;
  onRegenerate: () => void;
  showAdvanced: boolean;
  setShowAdvanced: (v: boolean) => void;
  userOverrides: Record<string, string>;
  showBrandLayer: Record<string, boolean>;
  setShowBrandLayer: (next: Record<string, boolean>) => void;
  perPresetLoading: Record<string, boolean>;
  onOverrideChange: (presetId: string, value: string) => void;
  onBack: () => void;
  onCook: () => void;
  buzzBalance?: number | null;
};

function BriefStep({
  brief,
  setBrief,
  adCopy,
  setAdCopy,
  copyPool,
  poolCursorRef,
  presetIds,
  setPresetIds,
  variantsPerPreset,
  setVariantsPerPreset,
  preview,
  previewLoading,
  previewError,
  draftWarning,
  drafting,
  draftError,
  onRegenerate,
  showAdvanced,
  setShowAdvanced,
  userOverrides,
  showBrandLayer,
  setShowBrandLayer,
  perPresetLoading,
  onOverrideChange,
  onBack,
  onCook,
  buzzBalance,
}: BriefStepProps) {
  function update<K extends keyof PreviewBrief>(key: K, value: PreviewBrief[K]) {
    setBrief({ ...brief, [key]: value });
  }
  function updateAdCopy(id: string, field: keyof AdCopyShape, value: string) {
    const current = adCopy[id] ?? { headline: '', subhead: '', cta: '' };
    setAdCopy({ ...adCopy, [id]: { ...current, [field]: value } });
  }
  // Seeding a newly-added placement's copy card. Prefer a fresh, distinct
  // variant from the LLM-generated spare pool (rotating so each add gets its
  // own angle). When the pool is drained or unavailable (LLM fallback), fall
  // back to cloning an already-filled card / the brief title+description so the
  // card is never blank.
  function nextCopyForAddedPreset(): AdCopyShape {
    const variant = copyPool.length > 0 ? copyPool[poolCursorRef.current % copyPool.length] : null;
    if (variant) {
      poolCursorRef.current += 1;
      return { ...variant };
    }
    const template: AdCopyShape =
      presetIds.map((id) => adCopy[id]).find((c) => c && (c.headline || c.subhead || c.cta)) ?? {
        headline: brief.title,
        subhead: brief.description,
        cta: '',
      };
    return { ...template };
  }
  function handlePresetsChange(next: string[]) {
    const added = next.filter((id) => !presetIds.includes(id));
    if (added.length > 0) {
      const filled: Record<string, AdCopyShape> = { ...adCopy };
      for (const id of added) {
        const existing = filled[id];
        if (!existing || (!existing.headline && !existing.subhead && !existing.cta)) {
          filled[id] = nextCopyForAddedPreset();
        }
      }
      setAdCopy(filled);
    }
    setPresetIds(next);
  }
  const total = preview?.totalBuzz ?? 0;
  const insufficientBuzz = typeof buzzBalance === 'number' && total > 0 && total > buzzBalance;
  const noPresets = presetIds.length === 0;

  return (
    <div className="flex flex-col gap-5" data-testid="brief-step">
      {drafting && <DraftingOverlay />}
      <header className="flex flex-wrap items-center gap-3 border-b border-line-subtle pb-4">
        <span className="t-eyebrow">{'// '}review your brief</span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={onRegenerate}
          disabled={drafting}
          className={cn(
            'inline-flex h-8 items-center gap-[5px] rounded-[8px] border border-line-subtle bg-bg-2 px-2.5 font-mono text-[11px] uppercase tracking-[0.08em] text-fg-1',
            'transition-colors duration-fast ease-out hover:border-line-strong hover:text-fg-0',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
          data-testid="regenerate-draft"
          aria-label="regenerate brief with the same prompt"
        >
          <RefreshCw size={12} strokeWidth={1.75} className={drafting ? 'animate-spin' : ''} />
          {drafting ? 'drafting…' : 'regenerate'}
        </button>
        {previewLoading && (
          <span className="flex items-center gap-1 font-mono text-[11px] text-fg-3">
            <Spinner size={12} label={null} />
            estimating…
          </span>
        )}
        <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-fg-3">total</span>
        <BuzzPill amount={total} data-testid="total-buzz" title={GREEN_BUZZ_TOOLTIP} />
        <span className="text-fg-3 text-[10px]">green buzz</span>
      </header>

      {draftError && (
        <div
          role="alert"
          className="rounded-[10px] border border-danger/40 bg-danger-soft px-3 py-2 font-mono text-[11.5px] text-danger"
          data-testid="draft-error"
        >
          {draftError}
        </div>
      )}

      {draftWarning && (
        <div
          role="alert"
          className="rounded-[10px] border border-line-subtle bg-bg-3 px-3 py-2 font-mono text-[11.5px] text-fg-2"
          data-testid="draft-warning"
        >
          {draftWarning}
        </div>
      )}

      {brief.prompt.trim() && (
        <div
          className="rounded-[10px] border border-line-subtle bg-bg-2 p-[10px]"
          data-testid="submitted-prompt-sidecar"
        >
          <span className="block font-mono text-[10px] uppercase tracking-[0.1em] text-fg-3 mb-1">
            {'// '}your prompt
          </span>
          <p className="text-[13.5px] leading-[1.4] text-fg-0">{brief.prompt}</p>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <FieldLabel htmlFor="brief-title">campaign title</FieldLabel>
          <Input
            id="brief-title"
            value={brief.title}
            onChange={(e) => update('title', e.target.value)}
          />
        </div>
        <div>
          <FieldLabel htmlFor="brief-goal">campaign goal</FieldLabel>
          <GoalSelect
            id="brief-goal"
            value={brief.goal}
            onChange={(e) => update('goal', e.target.value)}
          />
        </div>
      </div>

      <div>
        <FieldLabel htmlFor="brief-desc">description</FieldLabel>
        <Textarea
          id="brief-desc"
          value={brief.description}
          onChange={(e) => update('description', e.target.value)}
          rows={3}
        />
      </div>

      <div>
        <FieldLabel htmlFor="brief-offer">offer or hook</FieldLabel>
        <Input
          id="brief-offer"
          value={brief.offer}
          onChange={(e) => update('offer', e.target.value)}
          placeholder="20% off bundle · early access · free shipping"
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <FieldLabel htmlFor="brief-audience">audience</FieldLabel>
          <Input
            id="brief-audience"
            value={brief.audience}
            onChange={(e) => update('audience', e.target.value)}
            placeholder="30s · urban · gift-giving"
          />
        </div>
        <div>
          <FieldLabel htmlFor="brief-aesthetics">aesthetics</FieldLabel>
          <Input
            id="brief-aesthetics"
            value={brief.aesthetics}
            onChange={(e) => update('aesthetics', e.target.value)}
            placeholder="festive · citrus-forward · golden hour"
          />
        </div>
      </div>

      <section>
        <FieldLabel>output formats</FieldLabel>
        <PresetGrid value={presetIds} onChange={handlePresetsChange} />
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <div>
          <FieldLabel htmlFor="brief-variants">variants per preset</FieldLabel>
          <VariantsStepper value={variantsPerPreset} onChange={setVariantsPerPreset} />
        </div>
        <div className="flex flex-col gap-2">
          <FieldLabel>total creatives</FieldLabel>
          <div className="font-mono text-[15px] text-fg-0">
            {presetIds.length} preset{presetIds.length === 1 ? '' : 's'} × {variantsPerPreset} ={' '}
            {presetIds.length * variantsPerPreset}
          </div>
        </div>
      </section>

      <section>
        <FieldLabel>per-placement copy</FieldLabel>
        <div className="grid gap-3 md:grid-cols-2">
          {presetIds.map((id) => {
            const c = adCopy[id] ?? { headline: '', subhead: '', cta: '' };
            return (
              <article
                key={id}
                className="rounded-[12px] border border-line-subtle bg-bg-2 p-3"
                data-testid={`adcopy-card-${id}`}
                data-preset-id={id}
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[12px] text-fg-0">{id}</span>
                  <span className="flex-1" />
                  <Badge kind="gen">{variantsPerPreset}×</Badge>
                </div>
                <div className="mt-3 flex flex-col gap-2">
                  <Input
                    aria-label={`headline for ${id}`}
                    value={c.headline}
                    onChange={(e) => updateAdCopy(id, 'headline', e.target.value)}
                    placeholder="headline"
                    data-testid={`adcopy-headline-${id}`}
                  />
                  <Textarea
                    aria-label={`subhead for ${id}`}
                    value={c.subhead}
                    onChange={(e) => updateAdCopy(id, 'subhead', e.target.value)}
                    rows={2}
                    placeholder="subhead"
                    data-testid={`adcopy-subhead-${id}`}
                  />
                  <Input
                    aria-label={`cta for ${id}`}
                    value={c.cta ?? ''}
                    onChange={(e) => updateAdCopy(id, 'cta', e.target.value)}
                    placeholder="cta (optional)"
                    data-testid={`adcopy-cta-${id}`}
                  />
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section>
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          aria-expanded={showAdvanced}
          className="inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-[0.1em] text-fg-2 hover:text-fg-0"
          data-testid="toggle-advanced"
        >
          {showAdvanced ? (
            <ChevronUp size={12} strokeWidth={2} />
          ) : (
            <ChevronDown size={12} strokeWidth={2} />
          )}
          advanced · per-preset enhanced prompt
        </button>
        {showAdvanced && preview && (
          <div className="mt-3 grid gap-4">
            {presetIds.map((id) => {
              const ep = preview.enhancedPrompts[id];
              const estimate = preview.estimatePerPreset[id] ?? 0;
              const errMsg = preview.errors?.[id];
              const showBrand = !!showBrandLayer[id];
              const isLoading = !!perPresetLoading[id];
              const overrideValue = userOverrides[id] ?? '';
              return (
                <article
                  key={id}
                  className="rounded-[14px] border border-line-subtle bg-bg-2 p-4"
                  data-testid={`preset-card-${id}`}
                  data-preset-id={id}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[13px] text-fg-0">{id}</span>
                    {ep && (
                      <Chip ghost data-testid={`ratio-${id}`}>
                        {ep.aspectRatio}
                      </Chip>
                    )}
                    <Badge kind="gen">{variantsPerPreset}×</Badge>
                    <span className="flex-1" />
                    {isLoading && (
                      <span
                        className="flex items-center gap-1 font-mono text-[11px] text-fg-3"
                        data-testid={`re-estimating-${id}`}
                      >
                        <Spinner size={12} label={null} />
                        re-estimating…
                      </span>
                    )}
                    <BuzzPill amount={estimate} size="compact" data-testid={`buzz-${id}`} />
                  </div>

                  {errMsg && (
                    <p
                      className="mt-2 font-mono text-[11.5px] text-danger"
                      data-testid={`error-${id}`}
                    >
                      {errMsg}
                    </p>
                  )}

                  {ep && (
                    <>
                      {/* Prompt is editable inline — no "edit raw prompt" gate. */}
                      <div className="mt-3">
                        <Textarea
                          rows={4}
                          value={overrideValue || ep.finalPrompt}
                          onChange={(e) => onOverrideChange(id, e.target.value)}
                          data-testid={`override-input-${id}`}
                          aria-label={`prompt for ${id}`}
                          className="whitespace-pre-wrap"
                        />
                        <p className="mt-1 font-mono text-[10.5px] text-fg-3">
                          edits replace the assembled prompt sent to the orchestrator. re-estimates
                          after a short pause.
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => setShowBrandLayer({ ...showBrandLayer, [id]: !showBrand })}
                        aria-expanded={showBrand}
                        className="mt-3 inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-[0.1em] text-fg-2 hover:text-fg-0"
                        data-testid={`toggle-brand-${id}`}
                      >
                        {showBrand ? (
                          <ChevronUp size={12} strokeWidth={2} />
                        ) : (
                          <ChevronDown size={12} strokeWidth={2} />
                        )}
                        what we added from your brand
                      </button>
                      {showBrand && (
                        <div
                          className="mt-2 rounded-[10px] border border-line-subtle bg-bg-3 p-3 text-[12.5px] leading-[1.5] text-fg-1"
                          data-testid={`brand-layer-${id}`}
                        >
                          <div>
                            <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-fg-3">
                              brand layer
                            </span>
                            <p className="mt-1 whitespace-pre-wrap">
                              {ep.brandLayer || '— (no brand DNA yet)'}
                            </p>
                          </div>
                          <div className="mt-2">
                            <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-fg-3">
                              style layer
                            </span>
                            <p className="mt-1 whitespace-pre-wrap">{ep.styleLayer}</p>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>

      <div className="flex flex-wrap items-center gap-3 border-t border-line-subtle pt-4">
        <Button
          variant="secondary"
          size="md"
          onClick={onBack}
          leadingIcon={<ArrowLeft size={14} strokeWidth={1.75} />}
          data-testid="brief-back"
        >
          back
        </Button>
        <span className="flex-1" />
        {previewError && (
          <span className="font-mono text-[11.5px] text-danger" data-testid="brief-error">
            {previewError}
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
        {noPresets && (
          <span className="font-mono text-[11.5px] text-danger" data-testid="no-presets">
            pick at least one format
          </span>
        )}
        <Button
          variant="primary"
          size="lg"
          onClick={onCook}
          disabled={insufficientBuzz || noPresets}
          leadingIcon={<Sparkles size={14} strokeWidth={1.75} />}
          data-testid="brief-cook"
        >
          cook for {total.toLocaleString()} buzz
        </Button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* step 3: submit                                                              */
/* -------------------------------------------------------------------------- */

function SubmitStep({ submitting, error }: { submitting: boolean; error: string | null }) {
  return (
    <div
      className="flex flex-col items-center gap-3 rounded-[14px] border border-line-subtle bg-bg-2 p-10 text-center"
      data-testid="submit-step"
    >
      {submitting && (
        <>
          <Spinner size={24} className="text-volt" label={null} />
          <span className="font-mono text-[12px] uppercase tracking-[0.1em] text-fg-2">
            submitting…
          </span>
          <span className="text-[12.5px] text-fg-3">
            cooking workflows. you&rsquo;ll land on the campaign page in a moment.
          </span>
        </>
      )}
      {!submitting && error && (
        <span className="font-mono text-[11.5px] text-danger" data-testid="submit-error">
          {error}
        </span>
      )}
    </div>
  );
}

/* re-export for direct testing without going through the hook --------------- */
export { fetchCampaignPreview };
