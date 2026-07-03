import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const { COLLECTOR_URL } = vi.hoisted(() => ({
  COLLECTOR_URL: 'http://alloy.monitoring.svc.cluster.local:12348/collect',
}));

// Pin the server-side collector target so the test doesn't depend on real env.
vi.mock('@/lib/env', () => ({ env: { FARO_COLLECTOR_URL: COLLECTOR_URL } }));

import { OPTIONS, POST } from './route';

function req(body: string, contentType = 'application/json'): NextRequest {
  return new Request('http://localhost/faro', {
    method: 'POST',
    headers: { 'content-type': contentType },
    body,
  }) as unknown as NextRequest;
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('POST /faro', () => {
  it('forwards the body + content-type to the collector and mirrors 200', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));

    const payload = JSON.stringify({ logs: [{ message: 'hi' }] });
    const res = await POST(req(payload));

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(COLLECTOR_URL);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
    // Body is forwarded verbatim (as an ArrayBuffer).
    const forwarded = Buffer.from(init.body as ArrayBuffer).toString('utf8');
    expect(forwarded).toBe(payload);
  });

  it('preserves a non-json content-type (sendBeacon text/plain)', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    const res = await POST(req('beacon-body', 'text/plain;charset=UTF-8'));

    expect(res.status).toBe(204);
    const [, init] = fetchMock.mock.calls[0]!;
    expect((init.headers as Record<string, string>)['content-type']).toBe(
      'text/plain;charset=UTF-8',
    );
  });

  it('mirrors an upstream error status without throwing', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 502 }));

    const res = await POST(req('{}'));
    expect(res.status).toBe(502);
  });

  it('rejects an oversized body (Content-Length over cap) with 204 and never forwards', async () => {
    const oversized = new Request('http://localhost/faro', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': String(8 * 1024 * 1024) },
      body: '{}',
    }) as unknown as NextRequest;

    const res = await POST(oversized);

    expect(res.status).toBe(204);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 204 (never errors) when the collector is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

    const res = await POST(req('{}'));

    expect(res.status).toBe(204);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('OPTIONS /faro', () => {
  it('answers the beacon preflight with 204 + Allow', () => {
    const res = OPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get('allow')).toBe('POST, OPTIONS');
  });
});
