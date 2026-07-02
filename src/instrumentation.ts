declare global {
  var __vitrineMswStarted: boolean | undefined;
}

/**
 * Next.js runs this at process boot before any route handlers. We use it
 * to opt into MSW node-level fetch interception when running under e2e —
 * gated on MOCK_CIVITAI=1 so prod/dev paths are unaffected.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startOtel } = await import('./lib/otel');
    startOtel();
  }

  if (process.env.MOCK_CIVITAI !== '1') return;
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  // The e2e test server preloads MSW before Next boots (scripts/msw-preload.cjs)
  // so it patches fetch ahead of Next's patch-fetch capture. When that ran,
  // skip here to avoid a second interceptor. Standalone `pnpm dev` with
  // MOCK_CIVITAI=1 (no preload) still starts MSW from here.
  if (globalThis.__vitrineMswStarted) return;

  const { server } = await import('./mocks/node');
  server.listen({ onUnhandledRequest: 'bypass' });
  globalThis.__vitrineMswStarted = true;
  console.log('[msw] node interceptor started — Civitai + orchestrator calls are mocked');
}
