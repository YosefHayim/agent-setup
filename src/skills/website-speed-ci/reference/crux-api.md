# Reference — Chrome UX Report (CrUX) API (the durable field source)

Google is **discontinuing CrUX field data from the PageSpeed Insights API** ([official notice](https://developers.google.com/speed/docs/insights/v5/get-started): *"We plan to discontinue including real-world data from the Chrome User Experience Report in this API"*). No hard removal date is published, and PSI's **lab** data (`lighthouseResult`) is unaffected — but field checks should read from the **CrUX API** directly so they don't break. Docs: <https://developer.chrome.com/docs/crux/api>.

CrUX is the real-user 75th-percentile data Google uses for Core Web Vitals and search ranking, aggregated over a 28-day rolling window.

## Endpoint

```
POST https://chromeuxreport.googleapis.com/v1/records:queryRecord?key=API_KEY
```

- **API key required.** The same Google API key as PSI works — but you must **enable the "Chrome UX Report API"** on the project (separate from the PageSpeed Insights API). Free.
- **Quota:** 150 queries/minute per Google Cloud project. Free; the quota cannot be increased by paying.

## Request body

```json
{ "url": "https://example.com/page", "formFactor": "PHONE" }
```

- **`url`** (a specific page) **or** `origin` (the whole site, e.g. `https://example.com`) — mutually exclusive. A specific `url` needs its own traffic to have a record; falling back to `origin` is common for smaller sites.
- **`formFactor`** — `PHONE` (recommend, mobile-first), `DESKTOP`, `TABLET`, or omit for all devices combined.
- **`metrics`** — optional array to limit which metrics return; omit for all.

## Response

```jsonc
{
  "record": {
    "key": { "formFactor": "PHONE", "url": "https://example.com/page" },
    "metrics": {
      "largest_contentful_paint":       { "percentiles": { "p75": 2400 }, "histogram": [ /* … */ ] },
      "interaction_to_next_paint":      { "percentiles": { "p75": 180 } },
      "cumulative_layout_shift":        { "percentiles": { "p75": "0.08" } },
      "first_contentful_paint":         { "percentiles": { "p75": 1600 } },
      "experimental_time_to_first_byte":{ "percentiles": { "p75": 700 } }
    },
    "collectionPeriod": { "firstDate": { "year": 2026, "month": 6, "day": 8 }, "lastDate": { "year": 2026, "month": 7, "day": 5 } }
  }
}
```

### Reading it correctly

- **`percentiles.p75`** is the value to gate on — the 75th-percentile real-user experience (Google's Core Web Vitals cutoff).
- **CLS is a decimal string** (`"0.08"`) — `parseFloat` it. This differs from PSI, where CrUX CLS came back as an integer ×100. LCP/INP/FCP/TTFB are integer milliseconds.
- **Metric keys are lowercase snake_case** (`largest_contentful_paint`, `interaction_to_next_paint`, …) — unlike PSI's `LARGEST_CONTENTFUL_PAINT_MS`.
- **INP is real here.** CrUX has real users interacting, so `interaction_to_next_paint` is a true field metric (no lab proxy needed).
- **`collectionPeriod`** gives the 28-day window — field data lags, so this is a *trend monitor*, not an instant post-deploy signal.
- **No record → HTTP 404** (`"chrome ux report data not found"`) when a URL/origin lacks enough traffic. Treat this as "no field data yet," **not** a failure.

## curl example

```bash
curl -s -X POST \
  "https://chromeuxreport.googleapis.com/v1/records:queryRecord?key=$CRUX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com/","formFactor":"PHONE"}'
```

## What `run-crux.mjs` does

1. Query the exact `url`; on 404, automatically retry the `origin` (note which level answered).
2. Read each vital's `p75`, classify against the budget (`templates/budgets.json`).
3. **Exit non-zero** if any Core Web Vital p75 is `poor` (tune with `--strict` to also fail `needs-improvement`/over-budget).
4. **No CrUX record → print "no field data" and exit 0** — a new/low-traffic page must not block a deploy.

## History + dashboards

- **CrUX History API** (`records:queryHistoryRecord`) — the same shape with a time series of collection periods; use it for trend charts.
- **CrUX on BigQuery** — the full monthly dataset for custom analysis (the CrUX *Dashboard* Looker tool was deprecated in late 2025; the data lives on).
