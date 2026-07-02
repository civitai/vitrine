import {
  getWebInstrumentations,
  initializeFaro,
  ReactIntegration,
} from '@grafana/faro-react';
import { ReplayInstrumentation } from '@grafana/faro-instrumentation-replay';
import { TracingInstrumentation } from '@grafana/faro-web-tracing';

const FARO_URL = process.env.NEXT_PUBLIC_FARO_URL ?? '';
const APP_NAME = process.env.NEXT_PUBLIC_FARO_APP_NAME ?? 'vitrine';
const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? 'dev';
const IS_PROD = process.env.NODE_ENV === 'production';

let started = false;

export function faroEnabled(): boolean {
  return FARO_URL.length > 0;
}

/**
 * Initialize Faro RUM/errors/tracing (+ session replay in prod). No-op when
 * `NEXT_PUBLIC_FARO_URL` is unset (dev/e2e/offline) and idempotent so React
 * StrictMode double-invocation can't double-init.
 */
export function initFaro(): void {
  if (!faroEnabled() || started || typeof window === 'undefined') return;
  started = true;

  initializeFaro({
    url: FARO_URL,
    app: { name: APP_NAME, version: APP_VERSION, environment: IS_PROD ? 'production' : 'development' },
    instrumentations: [
      ...getWebInstrumentations(),
      new TracingInstrumentation(),
      new ReactIntegration(),
      // Session replay: prod-only, PII-masked. errors always recorded; 10% of
      // clean sessions sampled.
      ...(IS_PROD
        ? [
            new ReplayInstrumentation({
              maskAllInputs: true,
              maskTextSelector: '*',
              recordAfter: 'load',
              samplingRate: 0.1,
            }),
          ]
        : []),
    ],
  });
}
