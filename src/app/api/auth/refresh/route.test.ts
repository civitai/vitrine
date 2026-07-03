import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getSessionMock } = vi.hoisted(() => ({ getSessionMock: vi.fn() }));

vi.mock('@/lib/session', () => ({ getSession: getSessionMock }));

import { POST } from './route';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/auth/refresh', () => {
  it('reports ok:true when getSession returns a (re-sealed) session', async () => {
    getSessionMock.mockResolvedValueOnce({ tokens: { access_token: 'tok' } });
    const res = await POST();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('reports ok:false when there is no session (logged out / refresh failed)', async () => {
    getSessionMock.mockResolvedValueOnce(null);
    const res = await POST();
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ ok: false });
    // Never returns token material.
    expect(text).not.toContain('access_token');
  });
});
