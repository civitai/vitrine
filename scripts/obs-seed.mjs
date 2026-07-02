#!/usr/bin/env node
// Seed representative telemetry into the local observability stack so the
// Grafana dashboards have data to render. Sends Faro signals (events,
// exceptions, web-vitals) to the Alloy Faro receiver and synthetic OTLP spans
// to the Alloy OTLP receiver. Local-dev only.
//
// Usage: node scripts/obs-seed.mjs   (stack must be up: pnpm dev:up)
import { randomBytes } from 'node:crypto';

const FARO_URL = process.env.FARO_URL ?? 'http://localhost:12347/collect';
const OTLP_URL = process.env.OTLP_URL ?? 'http://localhost:4318/v1/traces';

const now = Date.now();
const isoAt = (msAgo) => new Date(now - msAgo).toISOString();
const spread = (i, n) => Math.floor((i / n) * 50 * 60_000); // over last ~50 min
const hex = (bytes) => randomBytes(bytes).toString('hex');

// --- Funnel events (counts shape a realistic drop-off) ---
const EVENTS = [
  ['login_succeeded', 20, () => ({})],
  ['onboarding_step_viewed', 60, (i) => ({ step: ['welcome', 'input', 'dna', 'next'][i % 4] })],
  ['onboarding_completed', 14, () => ({})],
  ['brand_dna_saved', 12, (i) => ({ fonts: String(i % 3), colors: String(2 + (i % 4)) })],
  ['campaign_cook_submitted', 9, (i) => ({ tiles: String(2 + (i % 5)), preset: ['ig-feed', 'story', 'x-post'][i % 3] })],
  ['tile_regenerated', 5, () => ({ tileId: hex(4) })],
  ['campaign_exported', 6, () => ({ format: 'zip' })],
  ['photoshoot_cook_submitted', 4, (i) => ({ template: ['studio-clean', 'lifestyle'][i % 2] })],
];

function meta(sessionId) {
  return {
    app: { name: 'vitrine', version: '1.0.0', environment: 'production' },
    session: { id: sessionId },
    sdk: { name: '@grafana/faro-web-sdk', version: '2.8.1' },
    browser: { name: 'Chrome', version: '120.0', os: 'macOS', mobile: false },
    page: { url: 'http://localhost:3333/campaigns' },
    user: { id: `u:seed${sessionId.slice(0, 4)}` },
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The Alloy faro.receiver rate-limits, so batch many signals per payload and
// throttle between POSTs.
async function postFaro(signals) {
  const res = await fetch(FARO_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ meta: meta(hex(8)), ...signals }),
  });
  if (!res.ok && res.status !== 202) {
    throw new Error(`faro POST ${res.status}: ${await res.text()}`);
  }
  await sleep(300);
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function seedFaro() {
  // Flatten all funnel events, then send in batches.
  const events = [];
  for (const [name, count, attrsOf] of EVENTS) {
    for (let i = 0; i < count; i++) {
      events.push({
        name,
        domain: 'custom',
        attributes: Object.fromEntries(
          Object.entries(attrsOf(i)).map(([k, v]) => [k, String(v)]),
        ),
        timestamp: isoAt(spread(i, count)),
      });
    }
  }
  for (const batch of chunk(events, 20)) await postFaro({ events: batch });

  const errs = [
    ['TypeError', "Cannot read properties of undefined (reading 'id')"],
    ['Error', 'cook failed: orchestrator 503'],
    ['NetworkError', 'Failed to fetch /api/campaigns/cook'],
  ];
  const exceptions = Array.from({ length: 7 }, (_, i) => {
    const [type, value] = errs[i % errs.length];
    return {
      type,
      value,
      stacktrace: { frames: [{ filename: 'app.js', function: 'cook', lineno: 42 }] },
      timestamp: isoAt(spread(i, 7)),
    };
  });
  await postFaro({ exceptions });

  const measurements = Array.from({ length: 24 }, (_, i) => ({
    type: 'web-vitals',
    values: {
      lcp: 800 + (i % 10) * 220,
      cls: Number((0.01 + (i % 5) * 0.02).toFixed(3)),
      inp: 40 + (i % 8) * 25,
      fcp: 500 + (i % 6) * 150,
      ttfb: 80 + (i % 7) * 30,
    },
    timestamp: isoAt(spread(i, 24)),
  }));
  for (const batch of chunk(measurements, 20)) await postFaro({ measurements: batch });

  return events.length + exceptions.length + measurements.length;
}

// --- OTLP traces -> Tempo ---
const ROUTES = [
  ['GET /api/campaigns', 1, 30, 120],
  ['POST /api/campaigns/cook', 2, 400, 2500],
  ['POST /api/track', 1, 5, 25],
  ['GET /api/auth/callback/civitai', 1, 200, 900],
  ['GET /api/workflow/[id]', 1, 50, 400],
];

function span(name, kind, lo, hi, errorRate, i, n) {
  // Tempo's metrics-generator only turns RECENT spans into span metrics, so
  // keep trace timestamps inside the last ~90s (unlike Faro logs, which
  // count_over_time at any age).
  const startMs = now - ((i * 7) % 90) * 1000;
  const dur = lo + Math.floor((i / n) * (hi - lo));
  const startNano = `${startMs}000000`;
  const endNano = `${startMs + dur}000000`;
  const isErr = i % errorRate === errorRate - 1;
  return {
    traceId: hex(16),
    spanId: hex(8),
    name,
    kind,
    startTimeUnixNano: startNano,
    endTimeUnixNano: endNano,
    attributes: [{ key: 'http.route', value: { stringValue: name.split(' ')[1] ?? name } }],
    status: { code: isErr ? 2 : 1, ...(isErr ? { message: 'error' } : {}) },
  };
}

async function seedTempo() {
  const spans = [];
  const N = 6;
  ROUTES.forEach(([name, kind, lo, hi], r) => {
    for (let i = 0; i < N; i++) {
      // ~1 in 6 of the cook route errors; others rarely
      const errEvery = name.includes('cook') ? 4 : 12;
      spans.push(span(name, kind, lo, hi, errEvery, i + r, N + r));
    }
  });
  const body = {
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: 'vitrine' } },
            { key: 'deployment.environment', value: { stringValue: 'local-seed' } },
          ],
        },
        scopeSpans: [{ scope: { name: 'obs-seed' }, spans }],
      },
    ],
  };
  const res = await fetch(OTLP_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`otlp POST ${res.status}: ${await res.text()}`);
  return spans.length;
}

const faro = await seedFaro();
const traces = await seedTempo();
console.log(`seeded ${faro} Faro signals -> Loki, ${traces} spans -> Tempo`);
console.log('give Alloy a few seconds to flush, then query/build dashboards.');
