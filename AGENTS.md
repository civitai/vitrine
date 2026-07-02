# Agent Guide — `vitrine`

> **If you only read one thing:** Civitai OAuth + Buzz-powered campaign
> generator. Postgres-backed (Drizzle), MinIO/R2 for uploads. Demo:
> login → onboarding → brand dna → cook a campaign or photoshoot → review.

Next.js 16 App Router app on top of `@civitai/app-sdk`. The starter has
been extended with Drizzle (Postgres), the AWS S3 SDK (MinIO local / R2
prod), MSW (e2e mocks), and a Playwright suite that runs against an
isolated test database.

## Stack

- Next.js 16, App Router, TypeScript strict, React 19, Tailwind 3.4
- `@civitai/app-sdk` for all OAuth + orchestrator glue
- Postgres + Drizzle ORM (`src/lib/db/`) — required, app fails loud if `DATABASE_URL` unset
- S3-compatible object storage (MinIO local, R2 prod) — required for the asset uploader
- Encrypted-cookie sessions (no token storage in DB)
- MSW node interceptor for e2e (`src/instrumentation.ts`, gated on `MOCK_CIVITAI=1`)
- Faro (frontend) + OTel (backend) telemetry, env-gated — local Grafana stack (`lgtm` + `alloy` in `docker-compose.yml`) via `pnpm dev:up`, Grafana UI at http://localhost:3001 (admin/admin)

## File layout

```
src/
├── app/
│   ├── page.tsx                            login or post-OAuth onboarding-gate redirect
│   ├── onboarding/[step]/                  5-step flow; each view persists state
│   ├── (app)/                              auth-guarded shell, also enforces onboarding
│   │   ├── campaigns/                      list · new · [id]
│   │   ├── photoshoot/                     list · new · [id]
│   │   └── brand/                          dna · book · catalog · assets (+ /new uploader)
│   ├── api/
│   │   ├── auth/                           login · callback/civitai · logout · revoke
│   │   ├── campaigns/                      cook · estimate · [id]/export ·
│   │   │                                    [id]/tiles/[tileId]/{regenerate,download}
│   │   ├── photoshoot/cook/
│   │   ├── catalog/products/               GET · POST · [id] GET/PATCH/DELETE
│   │   ├── assets/                         GET list · POST finalize · presign/
│   │   └── workflow/[id]/                  long-poll snapshot; updates db on terminal
│   └── instrumentation.ts                  starts MSW node when MOCK_CIVITAI=1
├── components/                             ui · shell · login · onboarding · campaigns ·
│                                            photoshoot · catalog · assets
└── lib/
    ├── env.ts                              Zod env validation
    ├── session.ts                          sealed-cookie session (read · write · refresh)
    ├── civitai.ts                          SDK wiring (fetchMe, buzz, orchestrator)
    ├── userKey.ts                          upserts `users` row; returns stable id
    ├── db/                                 Drizzle client + schema (12 tables, 8 enums)
    ├── presets.ts                          social + civitai-ads output-format presets
    ├── adExport.ts                         sharp center-crop to exact ad pixels (cropToExactPng)
    ├── onboarding.ts · brand.ts · catalog.ts · campaigns.ts · photoshoots.ts
    ├── generations.ts · buzz.ts · assets.ts
    └── s3.ts                               presigned PUT + public URL builder
```

## Patterns to keep

- **OAuth + tokens stay server-side.** Browser only ever sees the opaque `httpOnly` `civ_session` cookie. Never expose `access_token`, `refresh_token`, or `CIVITAI_CLIENT_SECRET`.
- **Object storage stays on a separate origin from the app.** Uploads accept `image/svg+xml`, and an SVG with embedded script executes in whatever origin *serves* it. Assets are served from `S3_PUBLIC_URL` (MinIO `:9000` / R2), never the app origin — keep it that way. Proxying the assets bucket under the app domain (or a shared cookie domain) would turn any uploaded SVG into stored XSS. (audit #13)
- **Asset finalize re-derives the storage pointer.** `POST /api/assets` must not trust client `publicUrl`/`bucket`/`key` — it validates the bucket + `isOwnedStorageKey` prefix and rebuilds `publicUrl` via `publicUrlFor`. (audit #3/#4)
- **Server-side URL fetches go through the SSRF-safe path.** `lib/scrape.ts` pins DNS (validated public IPs only) for all outbound brand-site fetches. Any new code that fetches a user-influenced URL server-side (e.g. a future `assetMirror` caller) must reuse that pinned fetch, not bare `fetch`.
- **Session = sealed cookie.** Read via `getSession()` in `src/lib/session.ts`. If `null`, user is logged out. Don't reach into the cookie store anywhere else.
- **User key = drizzle FK.** Always call `getUserKey(session)` before writing any user-scoped row — it upserts the `users` row that everything else FKs to.
- **Onboarding gate.** `app/page.tsx` and `(app)/layout.tsx` both check `getOnboarding(userKey).completedAt`. Incomplete users get redirected to `/onboarding/<currentStep>`. If you add new app routes that should be gated, put them under `src/app/(app)/`.
- **Generation audit trail.** Every `submitWorkflow` call goes through `recordGeneration` + `recordBuzzEvent` (estimate + submit). Terminal workflow status triggers `syncAssetsFromSnapshot` to create the `assets` row and link it to the tile.
- **Buzz cost preview before submission.** Always call `estimate` and surface the cost; users blame the app, not Civitai.
- **All Civitai SDK calls happen in route handlers**, not RSCs. RSCs can call drizzle helpers in `lib/*` directly via `getSession()`.

## Patterns to avoid

- ❌ Storing tokens in `localStorage`, cookies-without-httpOnly, or in rendered HTML.
- ❌ Writing to user-scoped tables (`products`, `campaigns`, `assets`, …) without going through `getUserKey()` first.
- ❌ Skipping `recordGeneration` / `recordBuzzEvent` when submitting a new workflow — the audit + UI both depend on it.
- ❌ Mutating sessions or session-derived state in middleware.
- ❌ Hard-coding orchestrator base URLs — use the SDK defaults or env override.
- ❌ Adding new env vars without putting them in `.env.example` **and** validating them in `src/lib/env.ts`.

## Extending

| Task | How |
|---|---|
| New Civitai SDK call | Add to `src/lib/civitai.ts`. Don't call SDK from RSCs. |
| New OAuth scope | Bump `REQUESTED_SCOPES` in `src/lib/scopes.ts` + grant on the OAuth App. Users re-login. |
| New social preset / shoot template | Append to `PRESETS` / `PHOTOSHOOT_TEMPLATES`. `width`/`height` drive aspect ratio; `styleNotes` get injected into the prompt. |
| New ad size | Add a preset to `PRESETS` (`src/lib/presets.ts`) with `platform: 'civitai-ads'`, `exact: true`, an explicit `aspectRatio` (nearest of `1:1`/`4:5`/`9:16`/`16:9`), the exact `width`/`height`, and crop-safe `styleNotes`. The `sharp` crop in `lib/adExport.ts` handles the exact-pixel deliverable — no per-size cook code needed. |
| New persisted entity | Add the table to `src/lib/db/schema.ts`, run `pnpm db:generate` to emit a migration, run `pnpm db:migrate`. Add a `lib/<entity>.ts` helper module with the same shape as `lib/catalog.ts`. |
| New env var | Add to Zod schema in `src/lib/env.ts` **and** `.env.example`. |
| New asset workflow | Use `presignUpload()` from `lib/s3.ts` for client uploads, then `createAsset()` from `lib/assets.ts` to persist. For orchestrator outputs, `syncAssetsFromSnapshot()` already runs from the workflow route. |
| Mock external service for e2e | Add an http handler to `src/mocks/handlers.ts`. Already covers `/api/v1/me`, buzz, and orchestrator. |

## Demo flow

1. Logged out → `<CivitaiSsoButton>` → `POST /api/auth/login` → 303 to Civitai authorize → user consents → `GET /api/auth/callback/civitai` → session sealed → 303 to `/`.
2. `app/page.tsx` reads session, calls `getOnboarding(userKey)`. If `completed_at` is null → redirect to `/onboarding/<currentStep>`; else → `/campaigns`.
3. User walks onboarding; visiting `/onboarding/next` sets `completed_at`.
4. From `/campaigns/new` (or `/photoshoot/new`), client submits a brief → server cooks per-tile workflows in parallel → persists campaign + tiles + generations + buzz events.
5. Client polls `/api/workflow/[id]?wait=15000`. On terminal status, server updates generation, creates asset rows, links to tile, records charged buzz once.

**Civitai ad formats are campaign output-format presets**, not a separate feature. They live in `src/lib/presets.ts` alongside `social` presets, tagged `platform: 'civitai-ads'` with `exact: true` and an explicit `aspectRatio` (the nearest of `1:1`/`4:5`/`9:16`/`16:9`). The wizard picker (`PresetGrid`) groups presets by `platform`, so ad sizes show under a "civitai ads" section next to "social". Cooking an ad preset goes through the normal campaign flow (`POST /api/campaigns/cook`), generating at its nearest ratio with `resolution: '2K'`. The exact-pixel deliverable is produced by a server-side `sharp` center-crop — `cropToExactPng` in `src/lib/adExport.ts` — wired into the campaign ZIP export (`GET /api/campaigns/[id]/export`) and the per-creative download (`GET /api/campaigns/[id]/tiles/[tileId]/download`). (The `generation_source` enum still carries a now-unused `ad_campaign` value — Postgres can't drop enum values — but the enum count is unchanged at 8.)

## Local observability

The `docker-compose.yml` "Observability" services (`lgtm` + `alloy`) run a
local Grafana/Loki/Tempo stack that mirrors prod telemetry. Pipeline-only
check (receivers up, a synthetic event reaches Loki — no app involved):
`pnpm dev:up` then `bash scripts/obs-smoke.sh`.

To see **real app telemetry** end to end:
1. Set `NEXT_PUBLIC_FARO_URL` and `OTEL_EXPORTER_OTLP_ENDPOINT` in `.env`.
2. `pnpm dev`, then trigger an action (cook a campaign, hit an error route).
3. Grafana Explore (http://localhost:3001): **Loki** for Faro browser
   events/errors (Alloy doesn't map Faro's `meta.app.name` to a stream
   label, so select `{service_name="unknown_service"}` and filter by line
   content, e.g. `app_name=vitrine`), **Tempo** (service `vitrine`) for the
   browser→backend trace.
4. Session replay is prod-only gated — needs `pnpm build && pnpm start`,
   not `pnpm dev`.

## Verifying changes

| You touched | Run |
|---|---|
| Anything in `src/` | `pnpm typecheck` |
| `next.config.mjs`, env, security headers | `pnpm build` |
| Schema (`src/lib/db/schema.ts`) | `pnpm db:generate` → review SQL → `pnpm db:migrate` (and `pnpm test:db:setup` to keep `vitrine_test` in sync) |
| Auth flow (`src/app/api/auth/**`, `lib/session.ts`) | `pnpm test:e2e` (the suite includes the real-OAuth `00-auth-flow` spec) |
| Cook / regenerate / workflow polling | `pnpm test:e2e` (50-campaigns, 60-photoshoot specs cook against MSW-mocked orchestrator) |
| Observability stack (`docker/alloy/`, `scripts/obs-smoke.sh`) | `bash scripts/obs-smoke.sh` against the running stack (`pnpm dev:up`) |

`pnpm test:e2e` needs a Civitai dev server with `testing-login` enabled and an OAuth app whose redirect URIs include both `http://localhost:3333/api/auth/callback/civitai` (dev) and `http://localhost:3334/...` (e2e). See [README › End-to-end tests](./README.md#end-to-end-tests) for the full prereqs.
