import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const getSession = vi.fn();
const getUserKey = vi.fn();
const recordEvent = vi.fn();

vi.mock('@/lib/session', () => ({ getSession: () => getSession() }));
vi.mock('@/lib/userKey', () => ({ getUserKey: (s: unknown) => getUserKey(s) }));
vi.mock('@/lib/analytics.server', () => ({ recordEvent: (i: unknown) => recordEvent(i) }));

import { POST } from './route';

function req(body: unknown): NextRequest {
  return new Request('http://localhost/api/track', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

beforeEach(() => {
  getSession.mockReset();
  getUserKey.mockReset();
  recordEvent.mockReset();
});

describe('POST /api/track', () => {
  it('401 when not authenticated', async () => {
    getSession.mockResolvedValue(null);
    const res = await POST(req({ event: 'login_succeeded' }));
    expect(res.status).toBe(401);
    expect(recordEvent).not.toHaveBeenCalled();
  });

  it('400 on unknown event name', async () => {
    getSession.mockResolvedValue({ tokens: {} });
    getUserKey.mockResolvedValue('u:alice');
    const res = await POST(req({ event: 'not_a_real_event' }));
    expect(res.status).toBe(400);
    expect(recordEvent).not.toHaveBeenCalled();
  });

  it('records with the server-derived userKey, ignoring any client userKey', async () => {
    getSession.mockResolvedValue({ tokens: {} });
    getUserKey.mockResolvedValue('u:alice');
    recordEvent.mockResolvedValue(undefined);
    const res = await POST(req({ event: 'campaign_cook_submitted', props: { tiles: 3 }, sessionId: 's1', userKey: 'u:attacker' }));
    expect(res.status).toBe(204);
    expect(recordEvent).toHaveBeenCalledWith({
      userKey: 'u:alice',
      event: 'campaign_cook_submitted',
      props: { tiles: 3 },
      sessionId: 's1',
    });
  });
});
