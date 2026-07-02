# vitrine Grafana dashboards

Source-of-truth JSON models for the local Grafana stack (`pnpm dev:up` →
http://localhost:3001). Apply them with the `grafana` skill:

```bash
for d in vitrine-frontend vitrine-funnel vitrine-backend; do
  node .claude/skills/grafana/grafana.mjs dashboard upsert \
    -f docker/grafana/dashboards/$d.json --writable
done
```

| Dashboard | uid | Source | Panels |
|-----------|-----|--------|--------|
| Frontend (Faro) | `vitrine-frontend` | Loki | exceptions over time + top errors, web-vitals p75 (LCP/INP/FCP/TTFB/CLS), RUM events, session count |
| Product funnel | `vitrine-funnel` | Loki | per-event counts (bar + stacked timeseries) and a stat row for the funnel stages (login → onboarding → dna → cook → export) |
| Backend (OTel) | `vitrine-backend` | Prometheus span-metrics + Tempo | request rate, error %, p95 latency, calls/latency by route, recent-traces table |

## Data model these queries assume

Alloy's `faro.receiver` writes Faro signals to **Loki** as logfmt lines under a
single label `service_name="unknown_service"`; everything else is in the line
(`kind=event|exception|measurement`, `event_name=…`, `value_lcp=…`, `app_name=vitrine`).
So Loki panels filter `{service_name="unknown_service"} | logfmt | kind=...`.

Backend panels use **span metrics** the Tempo metrics-generator emits to
Prometheus (`traces_spanmetrics_calls_total`, `..._latency_bucket`) labelled
`service="vitrine"`, `span_name`, `status_code` (latency is in **seconds**), plus
a Tempo TraceQL table (`{ resource.service.name = "vitrine" }`).

## Seeing data

- **Real data:** run `pnpm dev` with `NEXT_PUBLIC_FARO_URL` +
  `OTEL_EXPORTER_OTLP_ENDPOINT` set (see `.env.example`) and use the app.
- **Demo data:** `node scripts/obs-seed.mjs` posts representative Faro signals +
  OTLP spans into the stack.

> **Backend RED panels need recent/continuous traffic.** The Tempo
> metrics-generator only turns *recent* spans into metrics, and `rate()` reflects
> ongoing traffic — a one-shot seed shows small bumps that decay. The Loki
> (frontend/funnel) panels use `count_over_time` and render any data regardless
> of age. The recent-traces table always works once traces exist.
