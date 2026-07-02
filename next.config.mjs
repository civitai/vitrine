/**
 * Security headers applied to every response.
 *
 * `'unsafe-inline'` + `'unsafe-eval'` in `script-src` are kept because Next's
 * hydration script is inline and React DevTools / HMR want eval. The
 * production-hardened path is a CSP **nonce** wired through middleware — see
 * https://nextjs.org/docs/app/guides/content-security-policy. Worth the
 * upgrade once your app stops iterating quickly.
 *
 * `frame-ancestors 'none'` + `X-Frame-Options: DENY` together kill
 * clickjacking. `Referrer-Policy: strict-origin-when-cross-origin` keeps the
 * OAuth `code=` query param out of cross-origin Referer headers.
 */
const CIVITAI_HOSTS_BASE = [
  'https://civitai.com',
  'https://*.civitai.com',
  'https://civitai.red',
  'https://*.civitai.red',
  'https://orchestration.civitai.com',
  'https://orchestration-new.civitai.com',
  'https://image.civitai.com',
];

/** Read NEXT_PUBLIC_CIVITAI_BASE_URL / ORCHESTRATOR_URL at config-load and fold their
 * origins into the CSP allow-list. Lets the starter point at a self-hosted
 * Civitai dev (e.g. https://civitai-dev.blue) without users having to edit
 * CSP by hand. */
function originOrNull(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

const CIVITAI_HOSTS = Array.from(
  new Set(
    [
      ...CIVITAI_HOSTS_BASE,
      originOrNull(process.env.NEXT_PUBLIC_CIVITAI_BASE_URL),
      originOrNull(process.env.ORCHESTRATOR_URL),
    ].filter(Boolean),
  ),
);

// Object-storage origins (MinIO for local dev, R2 for prod). Folded into
// `connect-src` so presigned-URL PUTs from the browser aren't blocked, and
// into `img-src` so uploaded logo previews render.
const STORAGE_HOSTS = Array.from(
  new Set(
    [originOrNull(process.env.S3_ENDPOINT), originOrNull(process.env.S3_PUBLIC_URL)].filter(
      Boolean,
    ),
  ),
);

// Grafana Alloy Faro receiver origin — folded into connect-src so the browser
// can POST telemetry. Empty when NEXT_PUBLIC_FARO_URL is unset (no-op).
const FARO_HOSTS = Array.from(
  new Set([originOrNull(process.env.NEXT_PUBLIC_FARO_URL)].filter(Boolean)),
);

// Google Fonts are loaded dynamically by the DnaStep font picker.
const GOOGLE_FONTS = ['https://fonts.googleapis.com', 'https://fonts.gstatic.com'];

const csp = [
  `default-src 'self'`,
  `img-src 'self' data: blob: ${[...CIVITAI_HOSTS, ...STORAGE_HOSTS].join(' ')}`,
  `script-src 'self' 'unsafe-inline' 'unsafe-eval'`,
  `style-src 'self' 'unsafe-inline' ${GOOGLE_FONTS[0]}`,
  `font-src 'self' data: ${GOOGLE_FONTS[1]}`,
  `connect-src 'self' ${[...CIVITAI_HOSTS, ...STORAGE_HOSTS, ...FARO_HOSTS].join(' ')}`,
  `frame-ancestors 'none'`,
  `base-uri 'self'`,
  `form-action 'self' ${CIVITAI_HOSTS.join(' ')}`,
  `object-src 'none'`,
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  // Force HTTPS for two years incl. subdomains. Browsers ignore HSTS received
  // over plain HTTP, so this is harmless for local-dev http://localhost and
  // only takes effect once served over TLS (staging/prod) — where it prevents
  // a TLS-strip MITM from ever capturing the session cookie.
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Emit browser source maps in production ONLY when Faro is configured, so it
  // can symbolicate stack traces. NOTE: Next serves these .js.map files
  // PUBLICLY from the app origin — acceptable interim (no secrets; only
  // NEXT_PUBLIC_* is in the bundle). End-state is hidden maps + private
  // Grafana upload (infra/CI, keyed by NEXT_PUBLIC_APP_VERSION).
  productionBrowserSourceMaps: Boolean(process.env.NEXT_PUBLIC_FARO_URL),
  // Override the build/dev output directory when running the e2e test server
  // so it can coexist with a parallel `pnpm dev` (Next 16 advisory-locks
  // each distDir against multiple concurrent dev processes).
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // @civitai/app-sdk is a workspace package shipping uncompiled-style ESM.
  // Telling Next to transpile it keeps source-maps and lets us iterate
  // without a separate publish cycle during local development.
  transpilePackages: ['@civitai/app-sdk'],
  // Tree-shake icon barrels — Next 16 rewrites `import { Foo } from 'lucide-react'`
  // into deep imports so unused icons drop out of the bundle.
  experimental: {
    optimizePackageImports: ['lucide-react'],
  },
  images: {
    // The orchestrator returns blob URLs on its CDN. Allow them as image sources.
    remotePatterns: [
      { protocol: 'https', hostname: '*.civitai.com' },
      { protocol: 'https', hostname: '*.civitai.red' },
      { protocol: 'https', hostname: 'image.civitai.com' },
      { protocol: 'https', hostname: 'orchestration.civitai.com' },
      { protocol: 'https', hostname: 'orchestration-new.civitai.com' },
    ],
  },
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }];
  },
};

export default nextConfig;
