import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getSessionMock, clearSessionMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  clearSessionMock: vi.fn(),
}));
const { revokeSessionGrantMock } = vi.hoisted(() => ({ revokeSessionGrantMock: vi.fn() }));

vi.mock('@/lib/session', () => ({
  getSession: getSessionMock,
  clearSession: clearSessionMock,
}));
vi.mock('@/lib/civitai', () => ({ revokeSessionGrant: revokeSessionGrantMock }));

import { POST } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  clearSessionMock.mockResolvedValue(undefined);
  revokeSessionGrantMock.mockResolvedValue(undefined);
});

describe('POST /api/auth/revoke', () => {
  it('revokes the grant at Civitai AND clears the cookie when a session exists', async () => {
    getSessionMock.mockResolvedValueOnce({ tokens: { access_token: 'tok' } });
    const res = await POST();
    expect(revokeSessionGrantMock).toHaveBeenCalledTimes(1);
    expect(clearSessionMock).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('still clears the cookie (but does not call revoke) when there is no session', async () => {
    getSessionMock.mockResolvedValueOnce(null);
    const res = await POST();
    expect(revokeSessionGrantMock).not.toHaveBeenCalled();
    expect(clearSessionMock).toHaveBeenCalledTimes(1);
    expect(await res.json()).toEqual({ ok: true });
  });
});
