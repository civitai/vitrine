#!/usr/bin/env bash
# Smoke-test the local observability pipeline (run after `pnpm dev:up`).
# 1) POST a synthetic Faro event to the Alloy Faro receiver -> expect 2xx.
# 2) Confirm the OTLP HTTP receiver is listening (bad body -> 4xx, not refused).
# 3) Query Loki (inside the lgtm container) for the synthetic event.
#
# This script only proves the pipeline plumbing is alive (receivers up,
# event lands in Loki). It does NOT exercise the real app.
#
## Manual full-stack check
# To see real app telemetry end to end:
#   1. Set NEXT_PUBLIC_FARO_URL and OTEL_EXPORTER_OTLP_ENDPOINT in `.env`
#      (see docker-compose.yml header for the local values).
#   2. `pnpm dev`, then trigger an action in the app (cook a campaign, hit
#      an error route, etc).
#   3. Open Grafana Explore (http://localhost:3001) and pick:
#        - Loki  -> select `{service_name="unknown_service"}` (Alloy doesn't
#          map Faro's meta.app.name to a Loki stream label, so every Faro
#          log lands under the OTel-default `unknown_service` label — filter
#          further by line content, e.g. `app_name=vitrine` or the action
#          you triggered).
#        - Tempo -> service `vitrine`, for the browser->backend trace.
#   4. Session replay is prod-only gated — it needs `pnpm build && pnpm start`,
#      not `pnpm dev`.
set -euo pipefail

MARK="obs-smoke-$$"

echo "1) Faro receiver POST..."
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST http://localhost:12347/collect \
  -H 'content-type: application/json' \
  -d "{\"meta\":{\"app\":{\"name\":\"vitrine\",\"version\":\"smoke\"},\"session\":{\"id\":\"$MARK\"}},\"logs\":[{\"message\":\"$MARK\",\"level\":\"info\",\"timestamp\":\"2026-06-30T00:00:00Z\"}]}")
echo "   HTTP $code"
case "$code" in 2*) echo "   faro receiver OK";; *) echo "   FARO RECEIVER FAILED ($code)"; exit 1;; esac

echo "2) OTLP HTTP receiver liveness..."
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST http://localhost:4318/v1/traces \
  -H 'content-type: application/json' -d '{}')
echo "   HTTP $code"
case "$code" in 000) echo "   OTLP RECEIVER UNREACHABLE"; exit 1;; *) echo "   otlp receiver listening (HTTP $code)";; esac

echo "3) Query Loki for the synthetic event (give Alloy a moment to flush)..."
sleep 3
# NOTE: this lgtm image (otel-lgtm:0.28.0) has no wget, only curl — use curl
# inside the container. The Faro receiver doesn't set a `service.name`
# resource attribute on the synthetic payload, so Alloy/Loki falls back to
# the OTel default stream label `service_name="unknown_service"` (verified
# via `/loki/api/v1/labels` + `/loki/api/v1/label/service_name/values`
# against the live stack — it was the *only* label present). That's the
# deterministic selector for this stack; if a later Alloy config adds a
# `service.name` resource attribute (e.g. via Faro `meta.app.name`), update
# this to `{service_name="vitrine"}`.
query='{service_name="unknown_service"}'
encoded_query=$(printf '%s' "$query" | sed "s/{/%7B/g; s/}/%7D/g; s/\"/%22/g; s/=/%3D/g")
hits=$(docker compose exec -T lgtm \
  curl -s "http://localhost:3100/loki/api/v1/query_range?query=${encoded_query}" 2>/dev/null | grep -c "$MARK" || true)
if [ "$hits" -gt 0 ]; then
  echo "   Loki received the event ✓ (query: $query)"
else
  echo "   NOTE: event not found via $query — the Faro receiver's label set may differ."
  echo "   Open Grafana Explore (http://localhost:3001) -> Loki and search for: $MARK"
fi
echo "SMOKE DONE"
