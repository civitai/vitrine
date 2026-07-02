'use client';

import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { track } from '@/lib/analytics';

const CAMPAIGN_CAPS = ['12 social posts', '3 ad creatives', '1 hero reel'] as const;
const PHOTOSHOOT_CAPS = ['studio', 'lifestyle', 'in-use', 'hero'] as const;

/**
 * Terminal onboarding step ("ship it"). Presented as a regular full-width step
 * — consistent with the other onboarding screens rather than a modal — so the
 * wizard flow reads end to end. Picks a starting surface; either card or the
 * dashboard link leaves onboarding.
 *
 * No Buzz estimate is shown here: cost depends on the brief / params the user
 * picks inside each tool, so a number on this screen would be a guess.
 */
export function NextScreen() {
  const router = useRouter();

  // The page-level server gate only renders this screen once `completedAt`
  // is set, so reaching it client-side is itself the completion signal.
  useEffect(() => {
    track('onboarding_completed');
  }, []);

  return (
    <section className="flex flex-col items-center gap-8 pt-4 text-center lg:gap-10 lg:pt-8">
      <header className="flex flex-col items-center gap-3">
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-fg-3">
          {'// step 3 of 3 · ship it'}
        </span>
        <h1 className="t-h1 text-fg-0">
          your brand DNA is{' '}
          <span className="bg-gradient-to-br from-volt to-ion bg-clip-text text-transparent">
            ready.
          </span>
        </h1>
        <p className="max-w-[540px] text-[16px] leading-[1.5] text-fg-1">
          pick where to start — you can always come back for the other.
        </p>
      </header>

      <div data-testid="next-choice" className="grid w-full grid-cols-1 gap-4 md:grid-cols-2">
        {/* Campaigns — recommended */}
        <button
          type="button"
          data-testid="next-choice-campaigns"
          onClick={() => router.push('/campaigns')}
          className="group relative flex flex-col gap-5 rounded-[20px] border border-line-volt bg-gradient-to-b from-bg-1 to-bg-2 p-6 text-left transition-all duration-base ease-out hover:-translate-y-[2px] hover:shadow-bloom-volt-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt"
        >
          <span className="absolute right-5 top-5 rounded-pill bg-volt px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-fg-on-volt">
            recommended
          </span>

          <div className="flex flex-col gap-2 pr-28">
            <h3 className="font-display text-[20px] font-semibold tracking-[-0.02em] text-fg-0">
              campaigns
            </h3>
            <p className="text-[13px] leading-[1.5] text-fg-1">
              turn one product shot into a full campaign. pick a direction and we generate the posts,
              ad creatives, and a hero reel — every tile tuned to your brand dna.
            </p>
          </div>

          <ul className="flex flex-wrap gap-1.5">
            {CAMPAIGN_CAPS.map((cap) => (
              <li
                key={cap}
                className="rounded-pill border border-line bg-bg-3/50 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-fg-2"
              >
                {cap}
              </li>
            ))}
          </ul>

          {/* Mini 3-post preview */}
          <div className="grid h-[88px] grid-cols-3 gap-1.5 overflow-hidden rounded-[10px]">
            <div className="flex flex-col items-center justify-center rounded-[8px] bg-[#c84a2e] p-1">
              <span className="text-center font-display text-[8px] font-bold leading-tight text-white">
                put the
                <br />
                heat
                <br />
                back in
              </span>
              <span className="mt-1 font-mono text-[6px] text-white/60">1/12</span>
            </div>
            <div className="flex flex-col items-center justify-center rounded-[8px] bg-[#ffd966] p-1">
              <span className="text-center font-display text-[8px] font-bold leading-tight text-[#1a1a1a]">
                small
                <br />
                batch.
                <br />
                big flavor.
              </span>
              <span className="mt-1 font-mono text-[6px] text-[#1a1a1a]/50">2/12</span>
            </div>
            <div className="flex flex-col items-center justify-center rounded-[8px] bg-[#1a3d2a] p-1">
              <span className="text-center font-display text-[8px] font-bold leading-tight text-[#ffd966]">
                cooked
                <br />
                with
                <br />
                care
              </span>
              <span className="mt-1 font-mono text-[6px] text-white/40">reel</span>
            </div>
          </div>

          <span
            data-testid="next-start-campaigns"
            className="mt-auto inline-flex items-center gap-1 text-[13px] font-medium text-volt transition-opacity duration-base ease-out md:opacity-0 md:group-hover:opacity-100"
          >
            start <ArrowRight size={14} strokeWidth={2} />
          </span>
        </button>

        {/* Photoshoot */}
        <button
          type="button"
          data-testid="next-choice-photoshoot"
          onClick={() => router.push('/photoshoot')}
          className="group flex flex-col gap-5 rounded-[20px] border border-line bg-gradient-to-b from-bg-1 to-bg-2 p-6 text-left transition-all duration-base ease-out hover:-translate-y-[2px] hover:border-line-volt hover:shadow-bloom-volt-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt"
        >
          <div className="flex flex-col gap-2">
            <h3 className="font-display text-[20px] font-semibold tracking-[-0.02em] text-fg-0">
              photoshoot
            </h3>
            <p className="text-[13px] leading-[1.5] text-fg-1">
              upload a single phone photo and restyle it into a clean set of product shots — no
              camera, no studio, no set to book.
            </p>
          </div>

          <ul className="flex flex-wrap gap-1.5">
            {PHOTOSHOOT_CAPS.map((cap) => (
              <li
                key={cap}
                className="rounded-pill border border-line bg-bg-3/50 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-fg-2"
              >
                {cap}
              </li>
            ))}
          </ul>

          {/* Mini input-photo + 4-shot preview */}
          <div className="flex h-[88px] gap-1.5 overflow-hidden rounded-[10px]">
            <div className="flex w-[38%] flex-col items-center justify-center gap-1 rounded-[8px] border border-dashed border-line bg-bg-3/60 p-1">
              <div className="h-9 w-9 rounded-[6px] bg-[#2a6fa8]/70" />
              <span className="font-mono text-[6px] uppercase tracking-[0.08em] text-fg-3">
                your photo
              </span>
            </div>
            <div className="grid flex-1 grid-cols-2 grid-rows-2 gap-1">
              <div className="rounded-[6px] bg-[#2a6fa8]" />
              <div className="rounded-[6px] bg-[#f5b8b8]" />
              <div className="rounded-[6px] bg-[#4a3a2e]" />
              <div className="rounded-[6px] bg-[#8ed0a8]" />
            </div>
          </div>

          <span
            data-testid="next-start-photoshoot"
            className="mt-auto inline-flex items-center gap-1 text-[13px] font-medium text-volt transition-opacity duration-base ease-out md:opacity-0 md:group-hover:opacity-100"
          >
            start <ArrowRight size={14} strokeWidth={2} />
          </span>
        </button>
      </div>

      <div className="flex w-full items-center justify-between">
        <Link
          href="/onboarding/dna"
          data-testid="next-back-link"
          className="font-mono text-[12px] uppercase tracking-[0.12em] text-fg-3 transition-colors duration-fast ease-out hover:text-fg-1"
        >
          ← back
        </Link>
        <button
          type="button"
          data-testid="next-dashboard-link"
          onClick={() => router.push('/campaigns')}
          className="font-mono text-[11.5px] text-fg-3 transition-colors duration-fast ease-out hover:text-fg-1"
        >
          or just drop me at the dashboard →
        </button>
      </div>
    </section>
  );
}
