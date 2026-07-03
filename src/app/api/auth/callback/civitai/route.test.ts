import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Hoisted mocks ----------------------------------------------------------

const { exchangeCodeMock } = vi.hoisted(() => ({ exchangeCodeMock: vi.fn() }));
const { consumeOAuthStateMock, setSessionMock } = vi.hoisted(() => ({
  consumeOAuthStateMock: vi.fn(),
  setSessionMock: vi.fn(),
}));
const { getUserKeyMock } = vi.hoisted(() => ({ getUserKeyMock: vi.fn() }));
const { recordEventMock } = vi.hoisted(() => ({ recordEventMock: vi.fn() }));

const { FakeOAuthError } = vi.hoisted(() => {
  class FakeOAuthError extends Error {
    readonly status: number;
    constructor(message: string, status: number) {
      super(message);
      this.name = 'OAuthError';
      this.status = status;
    }
  }
  return { FakeOAuthError };
});

vi.mock('@civitai/app-sdk', () => ({
  exchangeCode: exchangeCodeMock,
  OAuthError: FakeOAuthError,
}));
vi.mock('@/lib/env', () => ({
  env: {
    NEXT_PUBLIC_CIVITAI_BASE_URL: 'https://civitai.test',
    CIVITAI_CLIENT_ID: 'client_id',
    CIVITAI_CLIENT_SECRET: 'client_secret',
    NEXT_PUBLIC_APP_URL: 'https://app.example.com',
  },
  REDIRECT_URI: 'https://app.example.com/api/auth/callback/civitai',
}));
vi.mock('@/lib/session', () => ({
  consumeOAuthState: consumeOAuthStateMock,
  setSession: setSessionMock,
}));
vi.mock('@/lib/userKey', () => ({ getUserKey: getUserKeyMock }));
vi.mock('@/lib/analytics.server', () => ({ recordEvent: recordEventMock }));

import { GET } from './route';

function callbackReq(params: Record<string, string>): Request {
  const url = new URL('http://internal-listen-addr:3000/api/auth/callback/civitai');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new Request(url);
}

function locationOf(res: Response): URL {
  return new URL(res.headers.get('location') ?? '');
}

beforeEach(() => {
  vi.clearAllMocks();
  consumeOAuthStateMock.mockResolvedValue({ state: 'st4te', verifier: 'v', scope: 7 });
  exchangeCodeMock.mockResolvedValue({
    access_token: 'a',
    refresh_token: 'r',
    expires_at: Date.now() + 60_000,
  });
  getUserKeyMock.mockResolvedValue('user_1');
  recordEventMock.mockResolvedValue(undefined);
  setSessionMock.mockResolvedValue(undefined);
});

describe('GET /api/auth/callback/civitai', () => {
  it('redirects home with the provider error when ?error is present', async () => {
    const res = await GET(callbackReq({ error: 'access_denied' }) as never);
    expect(res.status).toBe(303);
    const loc = locationOf(res);
    expect(loc.searchParams.get('error')).toBe('oauth_error:access_denied');
    expect(exchangeCodeMock).not.toHaveBeenCalled();
  });

  it('redirects with missing_code_or_state when code is absent', async () => {
    const res = await GET(callbackReq({ state: 'st4te' }) as never);
    expect(res.status).toBe(303);
    expect(locationOf(res).searchParams.get('error')).toBe('missing_code_or_state');
    expect(exchangeCodeMock).not.toHaveBeenCalled();
  });

  it('redirects with state_mismatch when no pending state was stored', async () => {
    consumeOAuthStateMock.mockResolvedValueOnce(null);
    const res = await GET(callbackReq({ code: 'c', state: 'st4te' }) as never);
    expect(res.status).toBe(303);
    expect(locationOf(res).searchParams.get('error')).toBe('state_mismatch');
    expect(exchangeCodeMock).not.toHaveBeenCalled();
  });

  it('redirects with state_mismatch when the returned state does not match (CSRF)', async () => {
    const res = await GET(callbackReq({ code: 'c', state: 'attacker-state' }) as never);
    expect(res.status).toBe(303);
    expect(locationOf(res).searchParams.get('error')).toBe('state_mismatch');
    expect(exchangeCodeMock).not.toHaveBeenCalled();
    expect(setSessionMock).not.toHaveBeenCalled();
  });

  it('exchanges the code and seals the session on success', async () => {
    const res = await GET(callbackReq({ code: 'the-code', state: 'st4te' }) as never);
    expect(exchangeCodeMock).toHaveBeenCalledTimes(1);
    const arg = exchangeCodeMock.mock.calls[0]![0];
    expect(arg.code).toBe('the-code');
    expect(arg.codeVerifier).toBe('v');
    expect(arg.redirectUri).toBe('https://app.example.com/api/auth/callback/civitai');
    expect(setSessionMock).toHaveBeenCalledWith({
      tokens: expect.objectContaining({ access_token: 'a' }),
    });
    expect(res.status).toBe(303);
    const loc = locationOf(res);
    expect(loc.searchParams.get('notice')).toBe('connected');
    expect(loc.searchParams.get('error')).toBeNull();
  });

  it('builds the redirect from NEXT_PUBLIC_APP_URL, not the internal req.url host', async () => {
    const res = await GET(callbackReq({ code: 'c', state: 'st4te' }) as never);
    const loc = locationOf(res);
    expect(loc.origin).toBe('https://app.example.com');
    expect(loc.hostname).not.toBe('internal-listen-addr');
  });

  it('maps an OAuthError from token exchange to token_exchange:<status>', async () => {
    exchangeCodeMock.mockRejectedValueOnce(new FakeOAuthError('bad grant', 401));
    const res = await GET(callbackReq({ code: 'c', state: 'st4te' }) as never);
    expect(res.status).toBe(303);
    expect(locationOf(res).searchParams.get('error')).toBe('token_exchange:401');
    expect(setSessionMock).not.toHaveBeenCalled();
  });

  it('maps a generic token-exchange failure to token_exchange_failed', async () => {
    exchangeCodeMock.mockRejectedValueOnce(new Error('network down'));
    const res = await GET(callbackReq({ code: 'c', state: 'st4te' }) as never);
    expect(res.status).toBe(303);
    expect(locationOf(res).searchParams.get('error')).toBe('token_exchange_failed');
  });

  it('still succeeds when the post-login analytics call throws (login not blocked)', async () => {
    getUserKeyMock.mockRejectedValueOnce(new Error('/me timeout'));
    const res = await GET(callbackReq({ code: 'c', state: 'st4te' }) as never);
    // Session was sealed before analytics ran, and the swallowed error must
    // not turn a successful login into an OAuth failure.
    expect(setSessionMock).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(303);
    const loc = locationOf(res);
    expect(loc.searchParams.get('notice')).toBe('connected');
    expect(loc.searchParams.get('error')).toBeNull();
  });

  it('records a login_succeeded event on the happy path', async () => {
    await GET(callbackReq({ code: 'c', state: 'st4te' }) as never);
    expect(recordEventMock).toHaveBeenCalledWith({
      userKey: 'user_1',
      event: 'login_succeeded',
    });
  });
});
