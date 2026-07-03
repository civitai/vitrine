import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Hoisted mocks ----------------------------------------------------------

const { getSessionMock } = vi.hoisted(() => ({ getSessionMock: vi.fn() }));
const { getUserKeyMock } = vi.hoisted(() => ({ getUserKeyMock: vi.fn() }));
const { scrapeSiteMock } = vi.hoisted(() => ({ scrapeSiteMock: vi.fn() }));
const { patchOnboardingPayloadMock } = vi.hoisted(() => ({
  patchOnboardingPayloadMock: vi.fn(),
}));

const { FakeScrapeError } = vi.hoisted(() => {
  class FakeScrapeError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.name = 'ScrapeError';
      this.code = code;
    }
  }
  return { FakeScrapeError };
});

vi.mock('@/lib/session', () => ({ getSession: getSessionMock }));
vi.mock('@/lib/userKey', () => ({ getUserKey: getUserKeyMock }));
vi.mock('@/lib/scrape', () => ({ scrapeSite: scrapeSiteMock, ScrapeError: FakeScrapeError }));
vi.mock('@/lib/onboarding', () => ({ patchOnboardingPayload: patchOnboardingPayloadMock }));

import { POST } from './route';

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/onboarding/scrape', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const scrapeResult = {
  finalUrl: 'https://brand.example.com/',
  brandName: 'Brand',
  description: 'We sell things',
  logoUrl: 'https://brand.example.com/logo.png',
  themeColor: '#ff0000',
  palette: ['#111111', '#222222', '#333333', '#444444', '#555555'],
  font: 'Inter',
};

beforeEach(() => {
  vi.clearAllMocks();
  getSessionMock.mockResolvedValue({ tokens: { access_token: 'tok' } });
  getUserKeyMock.mockResolvedValue('user_1');
  scrapeSiteMock.mockResolvedValue(scrapeResult);
  patchOnboardingPayloadMock.mockResolvedValue(undefined);
});

describe('POST /api/onboarding/scrape', () => {
  it('returns 401 when unauthenticated', async () => {
    getSessionMock.mockResolvedValueOnce(null);
    const res = await POST(makeRequest({ url: 'https://x.com' }) as never);
    expect(res.status).toBe(401);
    expect(scrapeSiteMock).not.toHaveBeenCalled();
  });

  it('returns 400 on non-JSON body', async () => {
    const req = new Request('http://localhost/api/onboarding/scrape', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_body');
  });

  it('returns 400 invalid_request when url is too short', async () => {
    const res = await POST(makeRequest({ url: 'x' }) as never);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_request');
    expect(scrapeSiteMock).not.toHaveBeenCalled();
  });

  it('maps blocked_host to 400 and returns only the code (no SSRF oracle leak)', async () => {
    scrapeSiteMock.mockRejectedValueOnce(
      new FakeScrapeError('blocked_host', '10.0.0.5 resolves to private IP'),
    );
    const res = await POST(makeRequest({ url: 'http://10.0.0.5' }) as never);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json).toEqual({ error: 'blocked_host' });
    // The private-IP detail is a blind-SSRF oracle — it must not reach the client.
    expect(JSON.stringify(json)).not.toContain('private IP');
    expect(JSON.stringify(json)).not.toContain('10.0.0.5');
  });

  it('maps invalid_url to 400', async () => {
    scrapeSiteMock.mockRejectedValueOnce(new FakeScrapeError('invalid_url', 'bad url'));
    const res = await POST(makeRequest({ url: 'http://%%%' }) as never);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_url');
  });

  it('maps timeout to 504', async () => {
    scrapeSiteMock.mockRejectedValueOnce(new FakeScrapeError('timeout', 'took too long'));
    const res = await POST(makeRequest({ url: 'https://slow.example.com' }) as never);
    expect(res.status).toBe(504);
    expect((await res.json()).error).toBe('timeout');
  });

  it('maps other ScrapeError codes to 502', async () => {
    scrapeSiteMock.mockRejectedValueOnce(
      new FakeScrapeError('request_failed', 'connection reset'),
    );
    const res = await POST(makeRequest({ url: 'https://down.example.com' }) as never);
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe('request_failed');
  });

  it('maps an unexpected (non-ScrapeError) failure to 500 scrape_failed', async () => {
    scrapeSiteMock.mockRejectedValueOnce(new Error('kaboom'));
    const res = await POST(makeRequest({ url: 'https://x.example.com' }) as never);
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json).toEqual({ error: 'scrape_failed' });
    expect(JSON.stringify(json)).not.toContain('kaboom');
  });

  it('persists the scrape (top-4 colors only) and returns it on success', async () => {
    const res = await POST(makeRequest({ url: 'https://brand.example.com' }) as never);
    expect(res.status).toBe(200);
    expect(patchOnboardingPayloadMock).toHaveBeenCalledTimes(1);
    const [userArg, patchArg] = patchOnboardingPayloadMock.mock.calls[0]!;
    expect(userArg).toBe('user_1');
    expect(patchArg.websiteUrl).toBe('https://brand.example.com');
    expect(patchArg.brandName).toBe('Brand');
    expect(patchArg.colors).toEqual(['#111111', '#222222', '#333333', '#444444']);
    expect(patchArg.font).toBe('Inter');

    const json = await res.json();
    expect(json.scrape.finalUrl).toBe('https://brand.example.com/');
    expect(json.scrape.brandName).toBe('Brand');
    expect(typeof json.scrape.fetchedAt).toBe('number');
  });
});
