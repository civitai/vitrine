# vitrine

[![Next.js](https://img.shields.io/badge/Next.js-16-black.svg)](https://nextjs.org)
[![React](https://img.shields.io/badge/React-19-149eca.svg)](https://react.dev)
[![@civitai/app-sdk](https://img.shields.io/npm/v/@civitai/app-sdk.svg?label=%40civitai%2Fapp-sdk)](https://www.npmjs.com/package/@civitai/app-sdk)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

> Pomelli, but powered by Civitai. Drop a product photo, ship a campaign — 12 social posts, 3 ad creatives, a hero video, paid in Buzz.

Vitrine is a Civitai-powered campaign generator for small businesses, creators, and D2C brands. Upload product photos, pick a target audience + industry, and Civitai's orchestrator renders an Asset Pack in parallel — high-quality stills, sized-for-channel ad creatives, all editable in-app.

Built on the [`@civitai/app-sdk`](https://github.com/civitai/civitai-app-starters/tree/main/packages/civitai-app-sdk) starter (`next-app`). See [`docs/project-overview.md`](./docs/project-overview.md) and [`design_handoff_vitrine/README.md`](./design_handoff_vitrine/README.md) for product vision + design system.

## What works today

End-to-end loops are live against the real Civitai orchestrator and a local Postgres + MinIO + Redis stack:

- **Auth.** Civitai OAuth, encrypted-cookie sessions, post-login onboarding gate enforced server-side in `app/page.tsx` + `(app)/layout.tsx`.
- **Onboarding.** 5-step flow at `/onboarding/[step]` — welcome · brand input · DNA generation · DNA reveal · next-action picker. Each step view persists progress; reaching `/onboarding/next` sets `completed_at` and unlocks the app shell.
- **Brand.** Default brand profile auto-seeded on first visit (`/brand`). `/brand/book` lists brand profiles, `/brand/assets` is a gallery + uploader.
- **Catalog.** Drizzle-backed product CRUD (name, sku, notes, tags[], status).
- **Asset uploads.** Drag-drop or click-to-choose at `/brand/assets/new` → presigned PUT to MinIO/R2 → row recorded in `assets` table with collection + tags metadata.
- **Campaigns.** Brief modal → parallel `submitWorkflow` per preset → live-polling tile grid → per-tile regenerate. Each tile records a `generations` row + two `buzz_events` (estimate, submit). Workflow snapshots on terminal status create `assets` rows and link them to tiles.
- **Photoshoot.** Template builder (studio / lifestyle / hero) × variants × 4 ratios → same `generations` + `buzz_events` audit trail.

## Stack

| Layer | Today |
|---|---|
| Framework | Next.js 16 App Router, React 19, TypeScript strict |
| Styling | Tailwind v3 + CSS variable tokens |
| Icons | `lucide-react` |
| Validation | Zod (env, briefs, uploads, all route bodies) |
| Civitai | `@civitai/app-sdk` v0.6 (OAuth + PKCE + orchestrator) |
| DB | Postgres 16 + Drizzle ORM (`drizzle-kit migrate`) |
| Object storage | MinIO (dev, `@aws-sdk/client-s3` + `s3-request-presigner`) → Cloudflare R2 (prod, endpoint swap) |
| Cache | Redis (dev `:6380`) → Upstash (prod) — wired in docker, not yet read from code |
| E2E | Playwright + MSW (node) + isolated `vitrine_test` database |

## Quickstart

```bash
git clone <repo> vitrine && cd vitrine
cp .env.example .env
# Fill CIVITAI_CLIENT_ID, CIVITAI_CLIENT_SECRET, SESSION_SECRET
pnpm install
pnpm dev:up           # docker compose: Postgres + MinIO + Redis
pnpm db:migrate       # apply Drizzle migrations to `vitrine`
pnpm dev              # Next dev on :3333
```

Open <http://localhost:3333>.

### Register a Civitai OAuth App

1. <https://civitai.com/user/account> → **OAuth Apps** → **Create**.
2. Client type: **Confidential** (this app holds the secret server-side).
3. Grants: `authorization_code`, `refresh_token`.
4. Redirect URI: `http://localhost:3333/api/auth/callback/civitai` (add `http://localhost:3334/...` too if you'll run the e2e suite).
5. Scopes (minimum): `UserRead`, `BuzzRead`, `AIServicesRead`, `AIServicesWrite`. Add scopes by editing `REQUESTED_SCOPES` in `src/lib/scopes.ts`.
6. Copy **Client ID** + **Client Secret** into `.env`.

Generate `SESSION_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Project layout

```
src/
├── app/
│   ├── layout.tsx                 root layout (dark theme, fonts, tokens)
│   ├── page.tsx                   logged-out → LoginScreen; logged-in → onboarding gate
│   ├── instrumentation.ts         boots MSW node when MOCK_CIVITAI=1
│   ├── onboarding/[step]/         5-step flow; each view writes onboarding_state
│   ├── (app)/                     auth-guarded route group, enforces onboarding completion
│   │   ├── campaigns/             list · new (brief modal) · [id] (live-polling tiles)
│   │   ├── photoshoot/            list · new (builder) · [id] (grouped results)
│   │   ├── brand/
│   │   │   ├── page.tsx           brand DNA overview (auto-seeds default profile)
│   │   │   ├── book/              brand book list
│   │   │   ├── catalog/           product CRUD
│   │   │   └── assets/            gallery + /new dropzone uploader
│   │   └── animate/page.tsx       stub
│   └── api/
│       ├── auth/                  login · callback · logout · revoke
│       ├── campaigns/             cook · estimate · [id]/tiles/[tileId]/regenerate
│       ├── photoshoot/cook/
│       ├── catalog/products/      GET list · POST · GET/PATCH/DELETE [id]
│       ├── assets/                GET list · POST finalize · presign/
│       └── workflow/[id]/         long-poll snapshot; on terminal → assets + tile.assetId
├── components/
│   ├── ui/                        atoms (Button, Chip, Input, Modal, …)
│   ├── shell/                     Sidebar, TopBar, Shell, PlaceholderScreen, nav
│   ├── login/                     LoginScreen + AuthCard + CivitaiSsoButton
│   ├── onboarding/                OnboardingFrame + 5 step screens
│   ├── campaigns/                 List · Detail · BriefForm · CreativeCard (polling)
│   ├── photoshoot/                List · Builder · Results
│   ├── catalog/                   Grid · Detail · AddProductForm
│   └── assets/                    AssetUploader (presign + XHR PUT + finalize) · AssetsGallery
├── lib/
│   ├── env.ts                     Zod env (CIVITAI_*, SESSION_SECRET, DATABASE_URL, S3_*)
│   ├── session.ts                 sealed-cookie session
│   ├── civitai.ts                 SDK wiring — fetchMe, buzz, orchestrator
│   ├── scopes.ts                  REQUESTED_SCOPES bitmask
│   ├── presets.ts                 social presets + prompt builder
│   ├── photoshootTemplates.ts     templates + ratios + prompt builder
│   ├── briefSchema.ts             Zod for campaign briefs
│   ├── photoshootSchema.ts        Zod for photoshoot briefs
│   ├── catalogSchema.ts           Zod for product CRUD
│   ├── db/                        Drizzle client + 12-table schema (users, onboarding_state,
│   │                              brand_profiles, products, product_assets, assets,
│   │                              campaigns, campaign_tiles, photoshoots, photoshoot_tiles,
│   │                              generations, buzz_events) + 8 enums
│   ├── userKey.ts                 stable per-user key (upserts users row)
│   ├── onboarding.ts              get / step-record / complete
│   ├── brand.ts                   CRUD + ensureDefaultBrand
│   ├── catalog.ts                 product CRUD
│   ├── campaigns.ts               campaign + tile tx insert / list / get / swap
│   ├── photoshoots.ts             photoshoot + tile tx insert / list / get
│   ├── generations.ts             recordGeneration · updateGenerationFromSnapshot
│   ├── buzz.ts                    recordBuzzEvent · listBuzzEvents · sumChargedBuzz
│   ├── assets.ts                  CRUD · syncAssetsFromSnapshot · markTileFailed
│   ├── s3.ts                      presignUpload · publicUrlFor (MinIO / R2)
│   └── mocks/                     MSW handlers for Civitai + orchestrator (e2e only)
└── instrumentation.ts             starts MSW node interceptor when MOCK_CIVITAI=1
```

## How the generation loop works

1. Client builds a `BriefPayload` and `POST`s to `/api/campaigns/cook`.
2. Server resolves user key (upserts `users` row), validates with Zod.
3. For each preset, runs `estimateWorkflow` + `submitWorkflow` in parallel.
4. Server inserts `campaigns` + `campaign_tiles` rows in a transaction, then records a `generations` row + estimate/submit `buzz_events` per tile.
5. Client navigates to `/campaigns/[id]`; each `<CreativeCard>` long-polls `/api/workflow/[id]?wait=15000`.
6. On terminal status, the workflow route updates the `generations` row, calls `syncAssetsFromSnapshot` → inserts `assets` rows + links the first asset to the tile (`tile.assetId`, `status='done'`), records a single charged `buzz_event`.
7. Tile regenerate (`POST /api/campaigns/[id]/tiles/[tileId]/regenerate`) swaps workflow id, records a new `generations` + `buzz_event`.

## End-to-end tests

Playwright suite under `e2e/`. Runs **fully offline by default** against an isolated `vitrine_test` Postgres database and a dedicated Next dev server (port 3334) with MSW intercepting all Civitai + orchestrator HTTP calls — no Buzz is spent, no real orchestrator, and **no Civitai dev server required**. Specs run in parallel, each worker pinned to its own synthetic test user.

### One-time setup

```bash
pnpm test:e2e:install     # install Chromium for Playwright
pnpm test:db:setup        # CREATE DATABASE vitrine_test + apply migrations
```

For real-OAuth mode only: make sure your Civitai OAuth app has both `http://localhost:3333/api/auth/callback/civitai` and `http://localhost:3334/api/auth/callback/civitai` registered as redirect URIs.

### Running

```bash
pnpm test:e2e
```

Fully offline — no Civitai dev server needed. Playwright auto-boots the test Next dev server (`scripts/test-server.mjs`); `pnpm dev` can run alongside it (the test server uses `.next-test/` as its `distDir` to side-step Next 16's per-directory dev-server lock). Files run in parallel across workers (capped at 4 — the single dev server is the bottleneck, not CPU); tune with `--workers=N`.

To exercise the **real OAuth round-trip** (`00-auth-flow`), start your local Civitai dev server and run:

```bash
E2E_REAL_OAUTH=1 \
TEST_USER_ID=1 \
NEXT_PUBLIC_CIVITAI_BASE_URL=http://localhost:3000 \
pnpm test:e2e e2e/00-auth-flow.spec.ts
```

### Auth strategy

Offline (default): each Playwright worker seals a fake-token `civ_session` cookie for its own synthetic user (`90000 + workerIndex`) using `SESSION_SECRET`, so every spec starts pre-authenticated and parallel workers never clobber each other's data. MSW answers `/api/v1/me` + buzz, so the mock token is never validated.

Real-OAuth (`E2E_REAL_OAUTH=1`): `globalSetup` signs in once via Civitai's `testing-login` provider and caches its cookies; the `00-auth-flow.spec.ts` spec (skipped otherwise) clears `civ_session` and drives the real authorize → consent → callback flow. Run it with `--workers=1` / `TEST_USER_ID=1` (shared Civitai consent state).

The test DB is **persistent**: `globalSetup` truncates all tables on entry (a clean slate that survives crashed runs and leaves rows intact for post-mortem debugging), and it is never dropped.

### What's covered

| Spec | Covers |
|---|---|
| `00-auth-flow` | real OAuth → onboarding redirect for a fresh user (skipped unless `E2E_REAL_OAUTH=1`) |
| `10-onboarding` | walks the 5-step flow → unlocks the shell |
| `20-catalog` | create product → list → delete |
| `30-brand` | brand DNA / book / assets render with seeded data |
| `40-assets-uploader` | uploader UI renders (stubbed-PUT upload test is `.fixme` — see spec comment) |
| `50-campaigns` | list · new brief · cook → redirect to `/campaigns/[id]` (MSW-mocked orchestrator) |
| `60-photoshoot` | list · new builder · cook → redirect to `/photoshoot/[id]` |
| `70-api-health` | `GET /api/health` |

## Deploying

### Production — Civitai cluster (Tekton + FluxCD)

Production runs on the Civitai Talos cluster at **`vitrine.civitai.com`**, image **`ghcr.io/civitai/vitrine`**. Builds are **tag-driven** through Tekton — the GitHub Actions workflow is a manual fallback only.

```bash
git tag vX.Y.Z && git push --tags
```

Flow:

1. `git push --tags` → Flux `GitRepository` (semver ref) picks up the new tag.
2. Tekton `build-and-push` builds the Docker image and pushes `ghcr.io/civitai/vitrine:<14-digit-ts>-<shortsha>`, baking the `NEXT_PUBLIC_*` build-args (`NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_FARO_URL=https://vitrine.civitai.com/faro`, `NEXT_PUBLIC_APP_VERSION`, `S3_ENDPOINT`, `S3_PUBLIC_URL`).
3. Flux `ImagePolicy` selects the newest ts-sha tag and commits the bump.
4. Flux applies → rollout to `vitrine.civitai.com`.

Server env (OAuth creds, `DATABASE_URL`, `S3_*`, `FARO_COLLECTOR_URL`) is injected at runtime by the deployment (talos-infra); only `NEXT_PUBLIC_*` is needed at build time. Browser RUM posts to the same-origin **`/faro`** route, which proxies to the in-cluster Alloy Faro receiver (`FARO_COLLECTOR_URL`).

**Manual fallback:** the `Build & publish Docker image (manual fallback)` GitHub Action (`workflow_dispatch`) publishes the same image + tags — use only during cutover if Tekton is unavailable.

### Vercel (legacy / preview)

Vercel-ready. Set `CIVITAI_CLIENT_ID`, `CIVITAI_CLIENT_SECRET`, `SESSION_SECRET`, `NEXT_PUBLIC_APP_URL`, `DATABASE_URL` (Vercel Postgres / Neon), `S3_ENDPOINT` + `S3_ACCESS_KEY_ID` + `S3_SECRET_ACCESS_KEY` + `S3_BUCKET_*` + `S3_PUBLIC_URL` (R2), and register the prod redirect URI on the OAuth App.

## Useful scripts

| Script | What it does |
|---|---|
| `pnpm dev` | Next dev on `:3333` (writes to `.next/`) |
| `pnpm dev:up` / `dev:down` / `dev:reset` | docker-compose for Postgres + MinIO + Redis |
| `pnpm db:generate` | Drizzle: generate SQL from schema |
| `pnpm db:migrate` / `db:push` | Apply migrations / push schema to `DATABASE_URL` |
| `pnpm db:studio` | Drizzle Studio |
| `pnpm build` | Next production build |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | ESLint (Next config) |
| `pnpm check:env` | Validate `.env` against the Zod schema |
| `pnpm test:db:setup` | Create + migrate `vitrine_test` |
| `pnpm test:server` | Boot the e2e Next dev server (port 3334, MSW on, test DB) |
| `pnpm test:e2e` | Playwright suite (auto-boots `test:server`) |

## License

[MIT](./LICENSE)
