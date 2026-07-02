import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const initializeFaro = vi.fn();
vi.mock('@grafana/faro-react', () => ({
  initializeFaro: (c: unknown) => initializeFaro(c),
  getWebInstrumentations: () => [],
  ReactIntegration: class {},
}));
vi.mock('@grafana/faro-web-tracing', () => ({ TracingInstrumentation: class {} }));
vi.mock('@grafana/faro-instrumentation-replay', () => ({ ReplayInstrumentation: class {} }));

beforeEach(() => {
  vi.resetModules();
  initializeFaro.mockClear();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('faro init', () => {
  it('is disabled (no init) when NEXT_PUBLIC_FARO_URL is unset', async () => {
    vi.stubEnv('NEXT_PUBLIC_FARO_URL', '');
    const { faroEnabled, initFaro } = await import('./faro');
    expect(faroEnabled()).toBe(false);
    initFaro();
    expect(initializeFaro).not.toHaveBeenCalled();
  });

  it('initializes once when NEXT_PUBLIC_FARO_URL is set', async () => {
    vi.stubGlobal('window', {});
    vi.stubEnv('NEXT_PUBLIC_FARO_URL', 'https://alloy.example.com/collect');
    const { faroEnabled, initFaro } = await import('./faro');
    expect(faroEnabled()).toBe(true);
    initFaro();
    initFaro(); // idempotent
    expect(initializeFaro).toHaveBeenCalledTimes(1);
    const cfg = initializeFaro.mock.calls[0]![0] as { url: string; app: { name: string } };
    expect(cfg.url).toBe('https://alloy.example.com/collect');
    expect(cfg.app.name).toBe('vitrine');
  });
});
