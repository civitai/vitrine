import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Hoisted mocks ----------------------------------------------------------

const { getSessionMock } = vi.hoisted(() => ({ getSessionMock: vi.fn() }));
const { getUserKeyMock } = vi.hoisted(() => ({ getUserKeyMock: vi.fn() }));
const { createAssetMock, listAssetsMock } = vi.hoisted(() => ({
  createAssetMock: vi.fn(),
  listAssetsMock: vi.fn(),
}));
const { bucketForMock, publicUrlForMock } = vi.hoisted(() => ({
  bucketForMock: vi.fn((kind: string) => (kind === 'asset' ? 'assets' : 'uploads')),
  publicUrlForMock: vi.fn(
    (bucket: string, key: string) => `https://cdn.test/${bucket}/${key}`,
  ),
}));
const { isOwnedStorageKeyMock } = vi.hoisted(() => ({
  isOwnedStorageKeyMock: vi.fn(
    (userKey: string, key: string) =>
      key.startsWith(`${userKey}/`) || key.startsWith(`generated/${userKey}/`),
  ),
}));

vi.mock('@/lib/session', () => ({ getSession: getSessionMock }));
vi.mock('@/lib/userKey', () => ({ getUserKey: getUserKeyMock }));
vi.mock('@/lib/assets', () => ({ createAsset: createAssetMock, listAssets: listAssetsMock }));
vi.mock('@/lib/s3', () => ({ bucketFor: bucketForMock, publicUrlFor: publicUrlForMock }));
vi.mock('@/lib/storageKey', () => ({ isOwnedStorageKey: isOwnedStorageKeyMock }));

import { GET, POST } from './route';

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/assets', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    bucket: 'assets',
    key: 'user_1/abc.png',
    kind: 'upload',
    contentType: 'image/png',
    byteSize: 2048,
    width: 512,
    height: 512,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getSessionMock.mockResolvedValue({ tokens: { access_token: 'tok' } });
  getUserKeyMock.mockResolvedValue('user_1');
  createAssetMock.mockImplementation(async (input: Record<string, unknown>) => ({
    id: 'asset_1',
    ...input,
  }));
  listAssetsMock.mockResolvedValue([{ id: 'a1' }, { id: 'a2' }]);
  bucketForMock.mockImplementation((kind: string) => (kind === 'asset' ? 'assets' : 'uploads'));
  publicUrlForMock.mockImplementation(
    (bucket: string, key: string) => `https://cdn.test/${bucket}/${key}`,
  );
  isOwnedStorageKeyMock.mockImplementation(
    (userKey: string, key: string) =>
      key.startsWith(`${userKey}/`) || key.startsWith(`generated/${userKey}/`),
  );
});

describe('GET /api/assets', () => {
  it('returns 401 when unauthenticated', async () => {
    getSessionMock.mockResolvedValueOnce(null);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(listAssetsMock).not.toHaveBeenCalled();
  });

  it('lists the caller-scoped assets', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(listAssetsMock).toHaveBeenCalledWith('user_1', 200);
    expect(await res.json()).toEqual({ assets: [{ id: 'a1' }, { id: 'a2' }] });
  });
});

describe('POST /api/assets (finalize)', () => {
  it('returns 401 when unauthenticated', async () => {
    getSessionMock.mockResolvedValueOnce(null);
    const res = await POST(makeRequest(validBody()) as never);
    expect(res.status).toBe(401);
    expect(createAssetMock).not.toHaveBeenCalled();
  });

  it('returns 400 on non-JSON body', async () => {
    const req = new Request('http://localhost/api/assets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{bad',
    });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_body');
  });

  it('returns 400 invalid_request on schema violation (missing key)', async () => {
    const res = await POST(makeRequest({ bucket: 'assets' }) as never);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_request');
    expect(createAssetMock).not.toHaveBeenCalled();
  });

  it('rejects a bucket that is not one of our own buckets', async () => {
    const res = await POST(makeRequest(validBody({ bucket: 'someone-else-bucket' })) as never);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_storage_ref');
    expect(createAssetMock).not.toHaveBeenCalled();
  });

  it('rejects a key that is not under the caller prefix (cross-user object)', async () => {
    const res = await POST(makeRequest(validBody({ key: 'user_2/victim.png' })) as never);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_storage_ref');
    expect(isOwnedStorageKeyMock).toHaveBeenCalledWith('user_1', 'user_2/victim.png');
    expect(createAssetMock).not.toHaveBeenCalled();
  });

  it('accepts a mirrored generated/<userId>/ key', async () => {
    const res = await POST(makeRequest(validBody({ key: 'generated/user_1/x.png' })) as never);
    expect(res.status).toBe(201);
    expect(createAssetMock).toHaveBeenCalledTimes(1);
  });

  it('DERIVES publicUrl server-side and IGNORES a client-supplied publicUrl', async () => {
    // audit #3/#4: a malicious client could send a javascript:/data: publicUrl
    // that later renders as a link. The route must never persist it.
    const res = await POST(
      makeRequest(
        validBody({
          publicUrl: 'javascript:alert(document.cookie)//',
          bucket: 'assets',
          key: 'user_1/abc.png',
        }),
      ) as never,
    );
    expect(res.status).toBe(201);
    expect(publicUrlForMock).toHaveBeenCalledWith('assets', 'user_1/abc.png');
    const persisted = createAssetMock.mock.calls[0]![0];
    expect(persisted.publicUrl).toBe('https://cdn.test/assets/user_1/abc.png');
    expect(persisted.publicUrl).not.toContain('javascript:');
    // The client publicUrl must not have flowed anywhere into the persisted row.
    expect(JSON.stringify(persisted)).not.toContain('alert(document.cookie)');
  });

  it('persists the validated row scoped to the caller (201)', async () => {
    const res = await POST(makeRequest(validBody()) as never);
    expect(res.status).toBe(201);
    const persisted = createAssetMock.mock.calls[0]![0];
    expect(persisted).toMatchObject({
      userId: 'user_1',
      kind: 'upload',
      bucket: 'assets',
      storageKey: 'user_1/abc.png',
      contentType: 'image/png',
      byteSize: 2048,
      width: 512,
      height: 512,
    });
    const json = await res.json();
    expect(json.asset.id).toBe('asset_1');
  });

  it('assembles metadata only from provided collection/tags/description', async () => {
    await POST(
      makeRequest(
        validBody({ collection: 'spring', tags: ['a', 'b'], description: 'hero shot' }),
      ) as never,
    );
    const persisted = createAssetMock.mock.calls[0]![0];
    expect(persisted.metadata).toEqual({
      collection: 'spring',
      tags: ['a', 'b'],
      description: 'hero shot',
    });
  });

  it('omits empty metadata fields (empty tags array not persisted)', async () => {
    await POST(makeRequest(validBody({ tags: [] })) as never);
    const persisted = createAssetMock.mock.calls[0]![0];
    expect(persisted.metadata).toEqual({});
  });

  it('defaults optional numeric/typing fields to null', async () => {
    await POST(makeRequest({ bucket: 'assets', key: 'user_1/abc.png' }) as never);
    const persisted = createAssetMock.mock.calls[0]![0];
    expect(persisted.kind).toBe('upload'); // schema default
    expect(persisted.contentType).toBeNull();
    expect(persisted.byteSize).toBeNull();
    expect(persisted.width).toBeNull();
    expect(persisted.height).toBeNull();
  });

  it('returns 500 create_failed when the DB write throws', async () => {
    createAssetMock.mockRejectedValueOnce(new Error('unique_violation on secret_col'));
    const res = await POST(makeRequest(validBody()) as never);
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json).toEqual({ error: 'create_failed' });
    expect(JSON.stringify(json)).not.toContain('secret_col');
  });
});
