import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const registerOTel = vi.fn();
vi.mock('@vercel/otel', () => ({ registerOTel: (o: unknown) => registerOTel(o) }));

beforeEach(() => {
  vi.resetModules();
  registerOTel.mockClear();
});
afterEach(() => vi.unstubAllEnvs());

describe('otel', () => {
  it('disabled when OTEL_EXPORTER_OTLP_ENDPOINT unset', async () => {
    vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', '');
    const { otelEnabled, startOtel } = await import('./otel');
    expect(otelEnabled()).toBe(false);
    startOtel();
    expect(registerOTel).not.toHaveBeenCalled();
  });

  it('registers with serviceName vitrine when endpoint set', async () => {
    vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', 'http://alloy:4318');
    const { otelEnabled, startOtel } = await import('./otel');
    expect(otelEnabled()).toBe(true);
    startOtel();
    expect(registerOTel).toHaveBeenCalledTimes(1);
    expect(registerOTel.mock.calls[0]![0]).toMatchObject({ serviceName: 'vitrine' });
  });
});
