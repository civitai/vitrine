'use client';

import Link from 'next/link';
import { type ReactNode, useEffect, useState } from 'react';
import { Wordmark } from '@/components/shell';
import { track } from '@/lib/analytics';
import { ONBOARDING_STEPS, type OnboardingStep } from './steps';
import { useOnboardingKeyboardNav } from './useOnboardingKeyboardNav';

type Props = {
  step: OnboardingStep;
  children: ReactNode;
  /**
   * When true, the frame's built-in keyboard navigation is suppressed.
   * Use this when a child step component registers its own keyboard nav
   * (e.g. InputStep which needs a `canAdvance` guard tied to its local state).
   */
  suppressKeyboardNav?: boolean;
};

export function OnboardingFrame({ step, children, suppressKeyboardNav }: Props) {
  useOnboardingKeyboardNav(suppressKeyboardNav ? null : step);
  const stepIndex = ONBOARDING_STEPS.indexOf(step);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    track('onboarding_step_viewed', { step });
  }, [step]);

  async function signOut() {
    setSigningOut(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      window.location.href = '/';
    } finally {
      setSigningOut(false);
    }
  }
  return (
    <div className="relative min-h-screen overflow-hidden bg-bg-0">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          background:
            'radial-gradient(ellipse 900px 540px at 50% -10%, var(--volt-soft), transparent 60%),' +
            'radial-gradient(ellipse 800px 480px at 92% 110%, var(--ultraviolet-soft), transparent 60%)',
        }}
      />

      {/* Reduced horizontal padding on mobile (px-4) vs desktop (px-10) */}
      <header className="relative z-card flex items-center justify-between px-4 py-5 sm:px-10 sm:py-6">
        <Link href="/onboarding/welcome">
          <Wordmark size={26} />
        </Link>
        <div className="flex items-center gap-3">
          {/* Progress dots — always visible on mobile (was hidden sm:flex) */}
          <div className="flex items-center gap-[5px]">
            {ONBOARDING_STEPS.map((s, i) => (
              <span
                key={s}
                className="rounded-pill transition-all duration-[280ms] ease-out"
                style={{
                  width: i === stepIndex ? '22px' : '7px',
                  height: '7px',
                  background:
                    i === stepIndex ? 'var(--volt)' : i < stepIndex ? 'var(--fg-3)' : 'var(--bg-3)',
                  boxShadow: i === stepIndex ? '0 0 12px -2px var(--volt-glow)' : undefined,
                }}
              />
            ))}
          </div>
          <span aria-hidden className="h-3 w-px bg-line-subtle" />
          <button
            type="button"
            onClick={signOut}
            disabled={signingOut}
            className="font-mono text-[11px] uppercase tracking-[0.1em] text-fg-3 transition-colors duration-fast ease-out hover:text-fg-1 disabled:opacity-50"
          >
            {signingOut ? 'signing out…' : 'sign out'}
          </button>
        </div>
      </header>

      {/* px-4 on mobile, px-10 on sm+ */}
      <main className="relative z-card mx-auto w-full max-w-[1080px] px-4 pb-8 sm:px-10 lg:pb-12">
        {children}
      </main>
    </div>
  );
}
