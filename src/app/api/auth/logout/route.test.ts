import { beforeEach, describe, expect, it, vi } from 'vitest';

const { clearSessionMock } = vi.hoisted(() => ({ clearSessionMock: vi.fn() }));

vi.mock('@/lib/session', () => ({ clearSession: clearSessionMock }));

import { POST } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  clearSessionMock.mockResolvedValue(undefined);
});

describe('POST /api/auth/logout', () => {
  it('clears the session cookie and returns ok', async () => {
    const res = await POST();
    expect(clearSessionMock).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
