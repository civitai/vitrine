import { type NextRequest, NextResponse } from 'next/server';
import { env } from '@/lib/env';

/**
 * Same-origin Faro RUM ingest proxy.
 *
 * The browser posts telemetry to `https://vitrine.civitai.com/faro`
 * (`NEXT_PUBLIC_FARO_URL`) because the cluster's Alloy Faro receiver is
 * in-cluster only and unreachable from the public internet. This route
 * server-side forwards the batch to that receiver
 * (`FARO_COLLECTOR_URL`, default the in-cluster Alloy service), which stamps
 * `service_name="vitrine"`.
 *
 * Design constraints:
 * - Thin passthrough: preserve the request body + content-type verbatim.
 * - Never break the page. Faro fires these via `navigator.sendBeacon` /
 *   `fetch({ keepalive: true })`; a collector outage must not surface as a
 *   console/network error the user sees. On any upstream failure we swallow it
 *   and return 204 so the SDK treats the beacon as delivered.
 */

// Always run per-request on the server node (in-cluster egress); never cached.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const COLLECTOR_URL = env.FARO_COLLECTOR_URL;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await req.arrayBuffer();
  const contentType = req.headers.get('content-type') ?? 'application/json';

  try {
    const upstream = await fetch(COLLECTOR_URL, {
      method: 'POST',
      headers: { 'content-type': contentType },
      body,
      // Fire-and-forget: bound the wait so a slow collector can't hold the
      // request open. RUM delivery is best-effort.
      signal: AbortSignal.timeout(5000),
    });
    // Mirror the upstream status on success so the SDK can react to 4xx/5xx if
    // it wants; a 2xx passes straight through.
    return new NextResponse(null, { status: upstream.status });
  } catch {
    // Collector unreachable / timed out — never propagate to the page.
    return new NextResponse(null, { status: 204 });
  }
}

/**
 * CORS/beacon preflight. Same-origin POSTs from Faro don't normally trigger a
 * preflight, but sendBeacon with a non-simple content-type can — answer it so
 * the beacon isn't dropped.
 */
export function OPTIONS(): NextResponse {
  return new NextResponse(null, {
    status: 204,
    headers: {
      Allow: 'POST, OPTIONS',
      'Cache-Control': 'no-store',
    },
  });
}
