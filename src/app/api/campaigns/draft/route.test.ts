import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Hoisted mocks ----------------------------------------------------------

const { getSessionMock } = vi.hoisted(() => ({ getSessionMock: vi.fn() }));
const { getUserKeyMock } = vi.hoisted(() => ({ getUserKeyMock: vi.fn() }));
const { getDefaultBrandMock } = vi.hoisted(() => ({ getDefaultBrandMock: vi.fn() }));
const { getPublicUrlsMock } = vi.hoisted(() => ({ getPublicUrlsMock: vi.fn() }));
const { generateCampaignDraftMock } = vi.hoisted(() => ({ generateCampaignDraftMock: vi.fn() }));

const { FakeMissingReferenceError } = vi.hoisted(() => {
  class FakeMissingReferenceError extends Error {
    readonly count: number;
    readonly kind: 'assets' | 'products';
    constructor(count: number, kind: 'assets' | 'products') {
      super('missing');
      this.name = 'MissingReferenceError';
      this.count = count;
      this.kind = kind;
    }
  }
  return { FakeMissingReferenceError };
});

vi.mock('@/lib/session', () => ({ getSession: getSessionMock }));
vi.mock('@/lib/userKey', () => ({ getUserKey: getUserKeyMock }));
vi.mock('@/lib/brand', () => ({ getDefaultBrand: getDefaultBrandMock }));
vi.mock('@/lib/assets', () => ({
  getPublicUrls: getPublicUrlsMock,
  MissingReferenceError: FakeMissingReferenceError,
}));
vi.mock('@/lib/adCopy', () => ({ generateCampaignDraft: generateCampaignDraftMock }));

import { POST } from './route';

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/campaigns/draft', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    prompt: 'a spring launch for our new candle',
    presetIds: ['ig-feed', 'ig-story'],
    referenceAssetIds: [],
    productName: 'Candle',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getSessionMock.mockResolvedValue({ tokens: { access_token: 'tok' } });
  getUserKeyMock.mockResolvedValue('user_1');
  getDefaultBrandMock.mockResolvedValue({ id: 'brand_1', name: 'Acme' });
  getPublicUrlsMock.mockImplementation(async (_u: string, ids: string[]) =>
    ids.map((id) => `https://cdn.test/${id}`),
  );
  generateCampaignDraftMock.mockResolvedValue({
    draft: { title: 'Spring Glow', captions: ['x'] },
    meta: { model: 'test' },
  });
});

describe('POST /api/campaigns/draft', () => {
  it('returns 401 when unauthenticated', async () => {
    getSessionMock.mockResolvedValueOnce(null);
    const res = await POST(makeRequest(validBody()) as never);
    expect(res.status).toBe(401);
    expect(generateCampaignDraftMock).not.toHaveBeenCalled();
  });

  it('returns 400 invalid_input on empty prompt', async () => {
    const res = await POST(makeRequest(validBody({ prompt: '' })) as never);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_input');
  });

  it('returns 400 when presetIds is empty', async () => {
    const res = await POST(makeRequest(validBody({ presetIds: [] })) as never);
    expect(res.status).toBe(400);
    expect(generateCampaignDraftMock).not.toHaveBeenCalled();
  });

  it('returns 400 when every preset id is unknown (filtered to empty)', async () => {
    const res = await POST(
      makeRequest(validBody({ presetIds: ['not-real', 'also-fake'] })) as never,
    );
    expect(res.status).toBe(400);
    expect(generateCampaignDraftMock).not.toHaveBeenCalled();
  });

  it('filters unknown preset ids but keeps the valid ones', async () => {
    await POST(makeRequest(validBody({ presetIds: ['ig-feed', 'bogus'] })) as never);
    expect(generateCampaignDraftMock).toHaveBeenCalledTimes(1);
    const arg = generateCampaignDraftMock.mock.calls[0]![0];
    expect(arg.presetIds).toEqual(['ig-feed']);
  });

  it('rejects a prompt longer than the max', async () => {
    const res = await POST(makeRequest(validBody({ prompt: 'x'.repeat(2001) })) as never);
    expect(res.status).toBe(400);
  });

  it('threads brand + referenceCount + productName into the draft generator', async () => {
    await POST(
      makeRequest(validBody({ referenceAssetIds: ['a1', 'a2'], productName: 'Candle' })) as never,
    );
    expect(getPublicUrlsMock).toHaveBeenCalledWith('user_1', ['a1', 'a2']);
    const arg = generateCampaignDraftMock.mock.calls[0]![0];
    expect(arg.brand).toEqual({ id: 'brand_1', name: 'Acme' });
    expect(arg.referenceCount).toBe(2);
    expect(arg.productName).toBe('Candle');
    expect(arg.prompt).toBe('a spring launch for our new candle');
  });

  it('uses referenceCount 0 and skips getPublicUrls when no references given', async () => {
    await POST(makeRequest(validBody({ referenceAssetIds: [] })) as never);
    expect(getPublicUrlsMock).not.toHaveBeenCalled();
    expect(generateCampaignDraftMock.mock.calls[0]![0].referenceCount).toBe(0);
  });

  it('returns the draft + meta on success', async () => {
    const res = await POST(makeRequest(validBody()) as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      draft: { title: 'Spring Glow', captions: ['x'] },
      meta: { model: 'test' },
    });
  });

  it('returns 400 invalid_reference_assets when a reference is missing (no UUID leak)', async () => {
    getPublicUrlsMock.mockRejectedValueOnce(new FakeMissingReferenceError(1, 'assets'));
    const res = await POST(makeRequest(validBody({ referenceAssetIds: ['ghost'] })) as never);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('invalid_reference_assets');
    expect(json.missing).toBe(1);
    expect(json.kind).toBe('assets');
    expect(JSON.stringify(json)).not.toContain('ghost');
    expect(generateCampaignDraftMock).not.toHaveBeenCalled();
  });

  it('re-throws a non-MissingReferenceError so upstream sees the failure', async () => {
    getPublicUrlsMock.mockRejectedValueOnce(new Error('db down'));
    await expect(
      POST(makeRequest(validBody({ referenceAssetIds: ['a1'] })) as never),
    ).rejects.toThrow('db down');
  });
});
