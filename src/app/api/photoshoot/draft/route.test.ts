import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Hoisted mocks ----------------------------------------------------------

const { getSessionMock } = vi.hoisted(() => ({ getSessionMock: vi.fn() }));
const { getUserKeyMock } = vi.hoisted(() => ({ getUserKeyMock: vi.fn() }));
const { getDefaultBrandMock } = vi.hoisted(() => ({ getDefaultBrandMock: vi.fn() }));
const { getPublicUrlsMock } = vi.hoisted(() => ({ getPublicUrlsMock: vi.fn() }));
const { generatePhotoshootDraftMock } = vi.hoisted(() => ({
  generatePhotoshootDraftMock: vi.fn(),
}));

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
vi.mock('@/lib/photoshootDraft', () => ({
  generatePhotoshootDraft: generatePhotoshootDraftMock,
}));

import { POST } from './route';

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/photoshoot/draft', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    prompt: 'studio product shots for a ceramic mug',
    referenceAssetIds: [],
    productName: 'Mug',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getSessionMock.mockResolvedValue({ tokens: { access_token: 'tok' } });
  getUserKeyMock.mockResolvedValue('user_1');
  getDefaultBrandMock.mockResolvedValue(null);
  getPublicUrlsMock.mockImplementation(async (_u: string, ids: string[]) =>
    ids.map((id) => `https://cdn.test/${id}`),
  );
  generatePhotoshootDraftMock.mockResolvedValue({
    draft: { subject: 'ceramic mug', templates: ['studio'] },
    meta: { model: 'test' },
  });
});

describe('POST /api/photoshoot/draft', () => {
  it('returns 401 when unauthenticated', async () => {
    getSessionMock.mockResolvedValueOnce(null);
    const res = await POST(makeRequest(validBody()) as never);
    expect(res.status).toBe(401);
    expect(generatePhotoshootDraftMock).not.toHaveBeenCalled();
  });

  it('returns 400 invalid_input on empty prompt', async () => {
    const res = await POST(makeRequest(validBody({ prompt: '' })) as never);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_input');
  });

  it('rejects a prompt longer than the max', async () => {
    const res = await POST(makeRequest(validBody({ prompt: 'x'.repeat(2001) })) as never);
    expect(res.status).toBe(400);
    expect(generatePhotoshootDraftMock).not.toHaveBeenCalled();
  });

  it('rejects more than 8 reference assets', async () => {
    const referenceAssetIds = Array.from({ length: 9 }, (_, i) => `a${i}`);
    const res = await POST(makeRequest(validBody({ referenceAssetIds })) as never);
    expect(res.status).toBe(400);
    expect(generatePhotoshootDraftMock).not.toHaveBeenCalled();
  });

  it('threads brand + referenceCount + productName into the draft generator', async () => {
    getDefaultBrandMock.mockResolvedValueOnce({ id: 'brand_9', name: 'Kiln' });
    await POST(
      makeRequest(validBody({ referenceAssetIds: ['a1', 'a2', 'a3'], productName: 'Mug' })) as never,
    );
    expect(getPublicUrlsMock).toHaveBeenCalledWith('user_1', ['a1', 'a2', 'a3']);
    const arg = generatePhotoshootDraftMock.mock.calls[0]![0];
    expect(arg.brand).toEqual({ id: 'brand_9', name: 'Kiln' });
    expect(arg.referenceCount).toBe(3);
    expect(arg.productName).toBe('Mug');
  });

  it('uses referenceCount 0 and skips getPublicUrls with no references', async () => {
    await POST(makeRequest(validBody()) as never);
    expect(getPublicUrlsMock).not.toHaveBeenCalled();
    expect(generatePhotoshootDraftMock.mock.calls[0]![0].referenceCount).toBe(0);
  });

  it('returns the draft + meta on success', async () => {
    const res = await POST(makeRequest(validBody()) as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      draft: { subject: 'ceramic mug', templates: ['studio'] },
      meta: { model: 'test' },
    });
  });

  it('returns 400 invalid_reference_assets when a reference is missing (no UUID leak)', async () => {
    getPublicUrlsMock.mockRejectedValueOnce(new FakeMissingReferenceError(2, 'assets'));
    const res = await POST(makeRequest(validBody({ referenceAssetIds: ['ghost'] })) as never);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('invalid_reference_assets');
    expect(json.missing).toBe(2);
    expect(JSON.stringify(json)).not.toContain('ghost');
    expect(generatePhotoshootDraftMock).not.toHaveBeenCalled();
  });

  it('re-throws a non-MissingReferenceError', async () => {
    getPublicUrlsMock.mockRejectedValueOnce(new Error('db down'));
    await expect(
      POST(makeRequest(validBody({ referenceAssetIds: ['a1'] })) as never),
    ).rejects.toThrow('db down');
  });
});
