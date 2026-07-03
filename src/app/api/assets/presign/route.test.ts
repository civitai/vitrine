import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Hoisted mocks ----------------------------------------------------------

const { getSessionMock } = vi.hoisted(() => ({ getSessionMock: vi.fn() }));
const { getUserKeyMock } = vi.hoisted(() => ({ getUserKeyMock: vi.fn() }));
const { presignUploadMock } = vi.hoisted(() => ({ presignUploadMock: vi.fn() }));

vi.mock('@/lib/session', () => ({ getSession: getSessionMock }));
vi.mock('@/lib/userKey', () => ({ getUserKey: getUserKeyMock }));
vi.mock('@/lib/s3', () => ({ presignUpload: presignUploadMock }));

import { POST } from './route';

const MAX_BYTES = 20 * 1024 * 1024;

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/assets/presign', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    filename: 'product.png',
    contentType: 'image/png',
    byteSize: 1024,
    bucketKind: 'asset',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getSessionMock.mockResolvedValue({ tokens: { access_token: 'tok' } });
  getUserKeyMock.mockResolvedValue('user_1');
  presignUploadMock.mockResolvedValue({
    bucket: 'assets',
    key: 'user_1/uuid.png',
    putUrl: 'https://s3.test/put?sig',
    publicUrl: 'https://cdn.test/assets/user_1/uuid.png',
  });
});

describe('POST /api/assets/presign', () => {
  it('returns 401 when unauthenticated', async () => {
    getSessionMock.mockResolvedValueOnce(null);
    const res = await POST(makeRequest(validBody()) as never);
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('not_authenticated');
    expect(presignUploadMock).not.toHaveBeenCalled();
  });

  it('returns 400 on non-JSON body', async () => {
    const req = new Request('http://localhost/api/assets/presign', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not-json',
    });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_body');
  });

  it('returns 400 invalid_request on schema violation (missing filename)', async () => {
    const res = await POST(makeRequest({ byteSize: 10 }) as never);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_request');
    expect(presignUploadMock).not.toHaveBeenCalled();
  });

  it('rejects empty filename', async () => {
    const res = await POST(makeRequest(validBody({ filename: '' })) as never);
    expect(res.status).toBe(400);
    expect(presignUploadMock).not.toHaveBeenCalled();
  });

  it('rejects byteSize over the 20MB cap', async () => {
    const res = await POST(makeRequest(validBody({ byteSize: MAX_BYTES + 1 })) as never);
    expect(res.status).toBe(400);
    expect(presignUploadMock).not.toHaveBeenCalled();
  });

  it('accepts byteSize exactly at the cap (boundary)', async () => {
    const res = await POST(makeRequest(validBody({ byteSize: MAX_BYTES })) as never);
    expect(res.status).toBe(200);
    expect(presignUploadMock).toHaveBeenCalledTimes(1);
  });

  it('rejects negative byteSize', async () => {
    const res = await POST(makeRequest(validBody({ byteSize: -1 })) as never);
    expect(res.status).toBe(400);
    expect(presignUploadMock).not.toHaveBeenCalled();
  });

  it('rejects non-integer byteSize', async () => {
    const res = await POST(makeRequest(validBody({ byteSize: 12.5 })) as never);
    expect(res.status).toBe(400);
    expect(presignUploadMock).not.toHaveBeenCalled();
  });

  it('rejects an unknown bucketKind', async () => {
    const res = await POST(makeRequest(validBody({ bucketKind: 'root' })) as never);
    expect(res.status).toBe(400);
    expect(presignUploadMock).not.toHaveBeenCalled();
  });

  it('threads validated input into presignUpload (byteSize signed as contentLength)', async () => {
    const res = await POST(makeRequest(validBody({ byteSize: 4096 })) as never);
    expect(res.status).toBe(200);
    expect(presignUploadMock).toHaveBeenCalledTimes(1);
    const arg = presignUploadMock.mock.calls[0]![0];
    expect(arg).toMatchObject({
      userId: 'user_1',
      filename: 'product.png',
      contentType: 'image/png',
      bucketKind: 'asset',
      contentLength: 4096,
    });
  });

  it('applies schema defaults (contentType + bucketKind) when omitted', async () => {
    const res = await POST(
      makeRequest({ filename: 'raw.bin', byteSize: 1 }) as never,
    );
    expect(res.status).toBe(200);
    const arg = presignUploadMock.mock.calls[0]![0];
    expect(arg.contentType).toBe('application/octet-stream');
    expect(arg.bucketKind).toBe('asset');
  });

  it('returns the presigned upload payload on success', async () => {
    const res = await POST(makeRequest(validBody()) as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      bucket: 'assets',
      key: 'user_1/uuid.png',
      putUrl: 'https://s3.test/put?sig',
      publicUrl: 'https://cdn.test/assets/user_1/uuid.png',
    });
  });

  it('returns 500 presign_failed when the S3 client throws (no detail leak)', async () => {
    presignUploadMock.mockRejectedValueOnce(new Error('SecretAccessKey=leak'));
    const res = await POST(makeRequest(validBody()) as never);
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json).toEqual({ error: 'presign_failed' });
    expect(JSON.stringify(json)).not.toContain('leak');
  });
});
