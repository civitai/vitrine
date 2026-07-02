import { registerOTel } from '@vercel/otel';

/**
 * Backend tracing/error reporting via @vercel/otel → Alloy OTLP receiver.
 * Auto-instruments HTTP routes, outbound fetch, and pg. No-op when the OTLP
 * endpoint is unset (dev/e2e/offline). The exporter reads
 * OTEL_EXPORTER_OTLP_ENDPOINT / OTEL_EXPORTER_OTLP_TRACES_ENDPOINT from env.
 */
export function otelEnabled(): boolean {
  return !!process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
}

export function startOtel(): void {
  if (!otelEnabled()) return;
  registerOTel({ serviceName: 'vitrine' });
}
