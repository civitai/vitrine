---
name: grafana
description: Query Grafana datasources (Loki/Tempo/Prometheus) and manage dashboards + connections via the Grafana HTTP API. Use to inspect Faro/OTel telemetry, run LogQL/PromQL/TraceQL, list/create dashboards, or list/create datasources. Reads GRAFANA_URL + token from .env. Read-only by default; writes need --writable (and --confirm-prod for non-localhost).
---

# grafana

Talk to Grafana's HTTP API from the CLI — query telemetry and manage dashboards
and connections (datasources). Pairs with the local stack from `pnpm dev:up`
(Grafana at `http://localhost:3001`, fed by Alloy → Loki/Tempo/Prometheus).

Credentials are **never hardcoded** — `grafana.mjs` reads `GRAFANA_URL` and auth
from a `.env` file (already-set shell env vars win). Don't paste tokens into
commands or this file.

**Where config is read (low → high precedence):** project-root `.env` → this
skill dir's own `.env` → real environment variables. To keep Grafana creds with
the skill instead of the app's root `.env`:

```bash
cp .claude/skills/grafana/.env.example .claude/skills/grafana/.env
# then edit it — the skill-dir .env is gitignored
```

## Auth (.env)

| Var | Default | Notes |
|-----|---------|-------|
| `GRAFANA_URL` | `http://localhost:3001` | Base URL of the Grafana instance |
| `GRAFANA_TOKEN` | — | Service-account token → `Authorization: Bearer` (preferred) |
| `GRAFANA_USER` / `GRAFANA_PASSWORD` | `admin` / `admin` | Basic-auth fallback (local lgtm default) |

For the local stack the defaults work with no `.env` entries. For a real
instance, create a service account + token in Grafana and set `GRAFANA_TOKEN`
(admin role required to create datasources).

## Commands

```bash
node .claude/skills/grafana/grafana.mjs <command> [args] [flags]
```

| Command | What | Access |
|---------|------|--------|
| `query <loki\|prometheus\|tempo> '<expr>'` | Run a query via `/api/ds/query` | read |
| `datasources` | List datasources (connections) | read |
| `datasource get <uid>` | Get one datasource | read |
| `datasource create -f <def.json>` | Create a connection | **write** |
| `dashboards [search]` | Search dashboards | read |
| `dashboard get <uid>` | Get a dashboard model | read |
| `dashboard upsert -f <model.json>` | Create/update a dashboard | **write** |
| `api <GET\|POST\|PUT\|DELETE> <path> [-f body.json]` | Raw API call (escape hatch) | read if GET, else **write** |

| Flag | Description |
|------|-------------|
| `--writable` | Allow write operations — **ask the user first** |
| `--confirm-prod` | Required for any write when `GRAFANA_URL` is non-localhost |
| `--uid <uid>` | Target a specific datasource for `query` (else first of that type) |
| `--from <ms>` / `--to <ms>` | Query time range (epoch ms; default last 1h) |
| `--limit <n>` | Max log lines / trace results |
| `--json` | Compact JSON output (good for piping) |
| `-f`, `--file <path>` | Read the request body / model from a JSON file |
| `-q`, `--quiet` | (reserved) terse output |

## Examples

```bash
# What connections exist?
node .claude/skills/grafana/grafana.mjs datasources --json

# Faro events/errors in Loki (the local stack labels the Faro stream
# service_name="unknown_service"; app_name lives in the line content):
node .claude/skills/grafana/grafana.mjs query loki '{service_name="unknown_service"}' --limit 20

# A backend metric / trace search:
node .claude/skills/grafana/grafana.mjs query prometheus 'up'
node .claude/skills/grafana/grafana.mjs query tempo '{ resource.service.name="vitrine" }'

# Inspect / create a dashboard (write needs --writable):
node .claude/skills/grafana/grafana.mjs dashboards
node .claude/skills/grafana/grafana.mjs dashboard get <uid> --json
node .claude/skills/grafana/grafana.mjs dashboard upsert -f /tmp/dash.json --writable

# Create a connection (write; payload may carry secrets — they're redacted on echo):
node .claude/skills/grafana/grafana.mjs datasource create -f /tmp/loki-ds.json --writable

# Anything else via the raw API:
node .claude/skills/grafana/grafana.mjs api GET /api/health
```

`dashboard upsert` accepts either a bare dashboard model (`{title, panels, ...}`)
or a full `{dashboard, folderUid, overwrite}` payload; a bare model is wrapped
with `overwrite: true`.

## Safety

1. **Read-only by default.** Queries, lists, and gets run freely. A query is an
   HTTP `POST` to `/api/ds/query` but is treated as a read — no flag needed.
2. **Writes require `--writable`.** `dashboard upsert`, `datasource create`, and
   non-GET `api` calls are blocked without it. Only pass it when the user asked
   to change something; confirm first.
3. **Non-local writes require `--confirm-prod`.** If `GRAFANA_URL` is not
   `localhost`/`127.0.0.1`, writes are refused unless `--confirm-prod` is also
   passed — so you can't accidentally mutate prod civitai Grafana. Ask the user,
   then add the flag.
4. **Secrets are redacted on output** (`password`, `token`, `secureJsonData`,
   etc.) and creds come only from `.env` — never logged or committed.

## Tests

Safety-critical logic (the prod/write guard, host detection, secret redaction)
has unit tests:

```bash
node --test .claude/skills/grafana/
```
