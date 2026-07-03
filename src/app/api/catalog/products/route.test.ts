import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Hoisted mocks ----------------------------------------------------------

const { getSessionMock } = vi.hoisted(() => ({ getSessionMock: vi.fn() }));
const { getUserKeyMock } = vi.hoisted(() => ({ getUserKeyMock: vi.fn() }));
const { createProductMock, listProductsMock } = vi.hoisted(() => ({
  createProductMock: vi.fn(),
  listProductsMock: vi.fn(),
}));

vi.mock('@/lib/session', () => ({ getSession: getSessionMock }));
vi.mock('@/lib/userKey', () => ({ getUserKey: getUserKeyMock }));
vi.mock('@/lib/catalog', () => ({
  createProduct: createProductMock,
  listProducts: listProductsMock,
}));

import { GET, POST } from './route';

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/catalog/products', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getSessionMock.mockResolvedValue({ tokens: { access_token: 'tok' } });
  getUserKeyMock.mockResolvedValue('user_1');
  listProductsMock.mockResolvedValue([{ id: 'p1' }]);
  createProductMock.mockImplementation(async (input: Record<string, unknown>) => ({
    id: 'p_new',
    ...input,
  }));
});

describe('GET /api/catalog/products', () => {
  it('returns 401 when unauthenticated', async () => {
    getSessionMock.mockResolvedValueOnce(null);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(listProductsMock).not.toHaveBeenCalled();
  });

  it('lists the caller-scoped products', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(listProductsMock).toHaveBeenCalledWith('user_1');
    expect(await res.json()).toEqual({ products: [{ id: 'p1' }] });
  });
});

describe('POST /api/catalog/products', () => {
  it('returns 401 when unauthenticated', async () => {
    getSessionMock.mockResolvedValueOnce(null);
    const res = await POST(makeRequest({ name: 'Widget' }) as never);
    expect(res.status).toBe(401);
    expect(createProductMock).not.toHaveBeenCalled();
  });

  it('returns 400 invalid_product on empty name', async () => {
    const res = await POST(makeRequest({ name: '' }) as never);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_product');
    expect(createProductMock).not.toHaveBeenCalled();
  });

  it('rejects an invalid status enum value', async () => {
    const res = await POST(makeRequest({ name: 'Widget', status: 'sold-out' }) as never);
    expect(res.status).toBe(400);
    expect(createProductMock).not.toHaveBeenCalled();
  });

  it('rejects non-uuid imageAssetIds', async () => {
    const res = await POST(
      makeRequest({ name: 'Widget', imageAssetIds: ['not-a-uuid'] }) as never,
    );
    expect(res.status).toBe(400);
    expect(createProductMock).not.toHaveBeenCalled();
  });

  it('creates the product scoped to the caller and applies schema defaults', async () => {
    const res = await POST(makeRequest({ name: 'Widget' }) as never);
    expect(res.status).toBe(201);
    expect(createProductMock).toHaveBeenCalledTimes(1);
    const arg = createProductMock.mock.calls[0]![0];
    expect(arg.userId).toBe('user_1');
    expect(arg.name).toBe('Widget');
    expect(arg.status).toBe('live'); // default
    expect(arg.tags).toEqual([]); // default
    expect(arg.imageAssetIds).toEqual([]); // default
    expect((await res.json()).product.id).toBe('p_new');
  });

  it('passes through provided fields', async () => {
    await POST(
      makeRequest({
        name: 'Candle',
        notes: 'soy wax',
        tags: ['home', 'decor'],
        status: 'draft',
      }) as never,
    );
    const arg = createProductMock.mock.calls[0]![0];
    expect(arg).toMatchObject({
      name: 'Candle',
      notes: 'soy wax',
      tags: ['home', 'decor'],
      status: 'draft',
    });
  });
});
