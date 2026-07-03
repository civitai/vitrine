import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Hoisted mocks ----------------------------------------------------------

const { getSessionMock, clearSessionMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  clearSessionMock: vi.fn(),
}));
const { getUserKeyMock } = vi.hoisted(() => ({ getUserKeyMock: vi.fn() }));
const { deleteAccountMock } = vi.hoisted(() => ({ deleteAccountMock: vi.fn() }));
const { revokeSessionGrantMock } = vi.hoisted(() => ({ revokeSessionGrantMock: vi.fn() }));

vi.mock('@/lib/session', () => ({
  getSession: getSessionMock,
  clearSession: clearSessionMock,
}));
vi.mock('@/lib/userKey', () => ({ getUserKey: getUserKeyMock }));
vi.mock('@/lib/account', () => ({ deleteAccount: deleteAccountMock }));
vi.mock('@/lib/civitai', () => ({ revokeSessionGrant: revokeSessionGrantMock }));

import { POST } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  getSessionMock.mockResolvedValue({ tokens: { access_token: 'tok' } });
  getUserKeyMock.mockResolvedValue('user_1');
  deleteAccountMock.mockResolvedValue({ assets: 3, products: 2, campaigns: 1 });
  revokeSessionGrantMock.mockResolvedValue(undefined);
  clearSessionMock.mockResolvedValue(undefined);
});

describe('POST /api/account/delete', () => {
  it('returns 401 when unauthenticated and touches nothing', async () => {
    getSessionMock.mockResolvedValueOnce(null);
    const res = await POST();
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('unauthorized');
    expect(deleteAccountMock).not.toHaveBeenCalled();
    expect(revokeSessionGrantMock).not.toHaveBeenCalled();
    expect(clearSessionMock).not.toHaveBeenCalled();
  });

  it('deletes data, revokes the grant, then clears the cookie and returns counts', async () => {
    const res = await POST();
    expect(res.status).toBe(200);
    expect(deleteAccountMock).toHaveBeenCalledWith('user_1');
    expect(revokeSessionGrantMock).toHaveBeenCalledTimes(1);
    expect(clearSessionMock).toHaveBeenCalledTimes(1);
    expect(await res.json()).toEqual({ ok: true, assets: 3, products: 2, campaigns: 1 });
  });

  it('clears the cookie LAST (after data deletion) so a mid-flow throw leaves the user logged in', async () => {
    await POST();
    const deleteOrder = deleteAccountMock.mock.invocationCallOrder[0]!;
    const revokeOrder = revokeSessionGrantMock.mock.invocationCallOrder[0]!;
    const clearOrder = clearSessionMock.mock.invocationCallOrder[0]!;
    expect(deleteOrder).toBeLessThan(revokeOrder);
    expect(revokeOrder).toBeLessThan(clearOrder);
  });

  it('does NOT clear the session when data deletion throws (user can retry)', async () => {
    deleteAccountMock.mockRejectedValueOnce(new Error('db down'));
    await expect(POST()).rejects.toThrow('db down');
    expect(clearSessionMock).not.toHaveBeenCalled();
    expect(revokeSessionGrantMock).not.toHaveBeenCalled();
  });
});
