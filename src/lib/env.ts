import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';

/**
 * Build-time-validated env. Misconfigured vars fail the `next build` (and the
 * first dev render) with a single readable error listing every problem at
 * once. Keep in sync with `.env.example`.
 *
 * `client` block: vars must be `NEXT_PUBLIC_`-prefixed and are bundled into
 * the browser. `server` block: server-only, never reach the client.
 */
export const env = createEnv({
  server: {
    CIVITAI_CLIENT_ID: z.string().min(1),
    CIVITAI_CLIENT_SECRET: z.string().min(1),
    SESSION_SECRET: z
      .string()
      .min(
        32,
        "SESSION_SECRET must be ≥32 chars. Generate with `node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"`.",
      ),
    ORCHESTRATOR_URL: z.string().url().default('https://orchestration.civitai.com'),
    // Vitrine infra — optional at build time so the legacy demo + login
    // still work without docker compose. Each module that reads these
    // (db, s3, redis) should error loudly when used without the matching var.
    DATABASE_URL: z.string().url().optional(),
    S3_ENDPOINT: z.string().url().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    S3_BUCKET_UPLOADS: z.string().optional(),
    S3_BUCKET_ASSETS: z.string().optional(),
    S3_PUBLIC_URL: z.string().url().optional(),
    OPENROUTER_API_KEY: z.string().optional(),
    OPENROUTER_MODEL: z.string().default('google/gemini-2.5-flash-lite'),
    /**
     * Comma-separated fallback chain. We try each model in order until one
     * returns a usable response. Free OpenRouter models share upstream
     * quotas, so a single 429 on the first pick is common; the chain
     * routes around it transparently.
     *
     * If unset, we derive the chain from OPENROUTER_MODEL + a built-in tail
     * of known-reliable free fallbacks. Set this explicitly to override.
     */
    OPENROUTER_MODELS: z.string().optional(),
    OPENROUTER_BASE_URL: z.string().url().default('https://openrouter.ai/api/v1'),
    // --- Observability (Grafana Alloy / OTel) — optional; unset = telemetry off ---
    OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
    OTEL_TRACES_SAMPLER_ARG: z.string().default('0.25'),
  },
  client: {
    NEXT_PUBLIC_APP_URL: z.string().url(),
    // Civitai host. Public (just the base URL, no secret) and read on both the
    // server (OAuth/API base) and the client ("top up" buzz CTAs), so it lives
    // in the client block — t3-env exposes client vars to server code too.
    NEXT_PUBLIC_CIVITAI_BASE_URL: z.string().url().default('https://civitai.com'),
    // Grafana Alloy Faro receiver endpoint. Unset → Faro is a no-op.
    NEXT_PUBLIC_FARO_URL: z.string().url().optional(),
    NEXT_PUBLIC_FARO_APP_NAME: z.string().default('vitrine'),
    // Git sha — release + source-map correlation in Faro/Tempo.
    NEXT_PUBLIC_APP_VERSION: z.string().optional(),
  },
  runtimeEnv: {
    CIVITAI_CLIENT_ID: process.env.CIVITAI_CLIENT_ID,
    CIVITAI_CLIENT_SECRET: process.env.CIVITAI_CLIENT_SECRET,
    SESSION_SECRET: process.env.SESSION_SECRET,
    ORCHESTRATOR_URL: process.env.ORCHESTRATOR_URL,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_CIVITAI_BASE_URL: process.env.NEXT_PUBLIC_CIVITAI_BASE_URL,
    DATABASE_URL: process.env.DATABASE_URL,
    S3_ENDPOINT: process.env.S3_ENDPOINT,
    S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY,
    S3_BUCKET_UPLOADS: process.env.S3_BUCKET_UPLOADS,
    S3_BUCKET_ASSETS: process.env.S3_BUCKET_ASSETS,
    S3_PUBLIC_URL: process.env.S3_PUBLIC_URL,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    OPENROUTER_MODEL: process.env.OPENROUTER_MODEL,
    OPENROUTER_MODELS: process.env.OPENROUTER_MODELS,
    OPENROUTER_BASE_URL: process.env.OPENROUTER_BASE_URL,
    OTEL_EXPORTER_OTLP_ENDPOINT: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    OTEL_TRACES_SAMPLER_ARG: process.env.OTEL_TRACES_SAMPLER_ARG,
    NEXT_PUBLIC_FARO_URL: process.env.NEXT_PUBLIC_FARO_URL,
    NEXT_PUBLIC_FARO_APP_NAME: process.env.NEXT_PUBLIC_FARO_APP_NAME,
    NEXT_PUBLIC_APP_VERSION: process.env.NEXT_PUBLIC_APP_VERSION,
  },
  emptyStringAsUndefined: true,
  // CI runs `next build` without real env. Setting SKIP_ENV_VALIDATION=1 in
  // that path turns validation off so the build is reproducible; production
  // deploys (Vercel, Render, etc.) leave it unset and fail fast on missing.
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
});

export const REDIRECT_URI = `${env.NEXT_PUBLIC_APP_URL}/api/auth/callback/civitai`;
