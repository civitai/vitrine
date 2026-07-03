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

// Reject oversized bodies before buffering. This route is unauthenticated by
// design (a browser beacon can't carry a secret), so cap the payload to bound
// the memory a hostile client can force us to buffer + amplify into in-cluster
// Alloy. Session-replay batches are the largest legitimate payload and stay
// well under this ceiling.
const MAX_BODY_BYTES = 4 * 1024 * 1024;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const declaredLength = Number(req.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return new NextResponse(null, { status: 204 });
  }

  const body = await req.arrayBuffer();
  if (body.byteLength > MAX_BODY_BYTES) {
    return new NextResponse(null, { status: 204 });
  }
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
    // Drain the (empty) upstream body so undici returns the socket to the pool
    // immediately instead of holding it until a GC finalizer runs — this route
    // is on the per-page-view hot path.
    upstream.body?.cancel().catch(() => {});
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
