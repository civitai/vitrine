import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const pushEvent = vi.fn();
const getSession = vi.fn(() => ({ id: 'sess-xyz' }));

vi.mock('@grafana/faro-web-sdk', () => ({
  faro: { api: { pushEvent: (...a: unknown[]) => pushEvent(...a), getSession: () => getSession() } },
}));

import { track } from './analytics';

beforeEach(() => {
  pushEvent.mockClear();
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true } as Response)));
});
afterEach(() => vi.unstubAllGlobals());

describe('track', () => {
  it('pushes a Faro event and POSTs /api/track with the session id', () => {
    track('brand_dna_saved', { fonts: 2 });
    expect(pushEvent).toHaveBeenCalledWith('brand_dna_saved', { fonts: '2' });
    expect(fetch).toHaveBeenCalledWith(
      '/api/track',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ event: 'brand_dna_saved', props: { fonts: 2 }, sessionId: 'sess-xyz' }),
      }),
    );
  });

  it('does not throw when faro is uninitialized / fetch rejects', () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
    expect(() => track('login_succeeded')).not.toThrow();
  });
});
