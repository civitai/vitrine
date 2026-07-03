# Production image for vitrine. Build context = this repo (single checkout).
#
# Deployed to vitrine.civitai.com on the Civitai cluster via FluxCD
# (talos-infra). All server env (OAuth creds, DATABASE_URL, S3_*) is injected
# at runtime by the deployment; only NEXT_PUBLIC_* is needed at build time.
FROM node:24-alpine

RUN npm install -g pnpm@10

WORKDIR /app
COPY . .

# @civitai/app-sdk is a published npm package, pinned in the lockfile. Plain
# registry install — no side-by-side civitai-app-starters checkout needed.
RUN pnpm install --frozen-lockfile

# NEXT_PUBLIC_* vars are inlined into the client bundle at build time.
ARG NEXT_PUBLIC_APP_URL=https://vitrine.civitai.com
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL

# Faro RUM is gated on NEXT_PUBLIC_FARO_URL being baked into the bundle. It
# points at THIS app's same-origin /faro proxy route (the cluster Alloy Faro
# receiver is in-cluster only) — the route forwards to it server-side. Must be
# a build-arg because NEXT_PUBLIC_* is inlined at `next build`, not read at
# runtime. Setting it here also flips on productionBrowserSourceMaps
# (next.config.mjs) so Faro can symbolicate stack traces.
ARG NEXT_PUBLIC_FARO_URL=https://vitrine.civitai.com/faro
ENV NEXT_PUBLIC_FARO_URL=$NEXT_PUBLIC_FARO_URL
ARG NEXT_PUBLIC_FARO_APP_NAME=vitrine
ENV NEXT_PUBLIC_FARO_APP_NAME=$NEXT_PUBLIC_FARO_APP_NAME
# Release identifier for Faro/Tempo correlation + source-map versioning. The
# build pipeline should pass the git short-sha or image tag; defaults to `dev`.
ARG NEXT_PUBLIC_APP_VERSION=dev
ENV NEXT_PUBLIC_APP_VERSION=$NEXT_PUBLIC_APP_VERSION

# S3_ENDPOINT / S3_PUBLIC_URL are read at BUILD time by next.config.mjs, which
# folds their origins into the CSP connect-src (browser presigned PUT) and
# img-src (uploaded-asset <img>). They must be present during `next build` or
# the baked-in CSP omits the storage host and blocks uploads + asset rendering
# at runtime. Public bucket host only (no secret) — the access key/secret stay
# runtime-injected. Defaults target Backblaze B2 us-west-004.
ARG S3_ENDPOINT=https://s3.us-west-004.backblazeb2.com
ENV S3_ENDPOINT=$S3_ENDPOINT
ARG S3_PUBLIC_URL=https://s3.us-west-004.backblazeb2.com
ENV S3_PUBLIC_URL=$S3_PUBLIC_URL

# devDependencies (drizzle-kit) are kept so the cluster initContainer can run
# migrations before each rollout: `node ./node_modules/drizzle-kit/bin.cjs migrate`.
#
# Placeholder DATABASE_URL for the build only: the db client throws at import if
# unset, but pg's Pool is lazy so no DB is contacted during page-data
# collection. Inline (not ENV) so it never reaches the runtime image.
# SKIP_ENV_VALIDATION=1 turns off t3-env build-time validation; real server env
# arrives at runtime and fails fast there if missing.
RUN DATABASE_URL=postgres://build:build@127.0.0.1:5432/build \
    SKIP_ENV_VALIDATION=1 NODE_ENV=production pnpm build

ENV NODE_ENV=production
EXPOSE 3000
CMD ["./node_modules/.bin/next", "start", "-p", "3000"]
