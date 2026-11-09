# Reference — PageSpeed Insights API v5 (the lab source)

> **Field data is moving.** Google is discontinuing CrUX field data (`loadingExperience` / `originLoadingExperience`) from this API — read field data from the **CrUX API** instead (`crux-api.md`). PSI remains the durable source for the **lab** result (`lighthouseResult`), which is what this reference is primarily for now.

PSI runs Lighthouse (lab) **and** (for now) returns CrUX (real-user field) for a URL in one response. Docs: <https://developers.google.com/speed/docs/insights/v5/reference/pagespeedapi/runpagespeed>.

## Endpoint

```
GET https://www.googleapis.com/pagespeedonline/v5/runPagespeed
```

### Query parameters

| Param | Required | Values / notes |
| --- | --- | --- |
| `url` | yes | The page to analyze (URL-encode it). |
| `strategy` | no | `mobile` (recommend — Google ranks on mobile) or `desktop`. Default `desktop`. |
| `category` | no | Repeatable: `performance`, `accessibility`, `best-practices`, `seo`. Default `performance`. |
| `locale` | no | e.g. `en`. |
| `key` | no* | Your PSI API key. *Optional but **strongly recommended** — without it you are heavily rate-limited. |
| `utm_source` / `utm_campaign` | no | Attribution tags. |

### API key

Create one in Google Cloud Console → enable **PageSpeed Insights API** → **Create credentials → API key**. Pass as `&key=YOUR_KEY`. Keep it in a secret (`PSI_API_KEY`), never in the repo.

### curl example

```bash
curl "https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=https%3A%2F%2Fexample.com&strategy=mobile&category=performance&key=$PSI_API_KEY"
```

## Response shape (the parts that matter)

```jsonc
{
  "lighthouseResult": {
    "categories": { "performance": { "score": 0.94 } },   // lab score 0–1
    "audits": {
      "largest-contentful-paint": { "numericValue": 2100, "displayValue": "2.1 s" },
      "cumulative-layout-shift":  { "numericValue": 0.03 },
      "total-blocking-time":      { "numericValue": 120 }
    }
  },
  "loadingExperience": {                                    // THIS PAGE — CrUX field data
    "overall_category": "AVERAGE",                          // FAST | AVERAGE | SLOW | NONE
    "metrics": {
      "LARGEST_CONTENTFUL_PAINT_MS":   { "percentile": 2400, "category": "AVERAGE" },
      "INTERACTION_TO_NEXT_PAINT":     { "percentile": 180,  "category": "FAST" },
      "CUMULATIVE_LAYOUT_SHIFT_SCORE": { "percentile": 8,    "category": "FAST" },
      "FIRST_CONTENTFUL_PAINT_MS":     { "percentile": 1600, "category": "AVERAGE" },
      "EXPERIMENTAL_TIME_TO_FIRST_BYTE": { "percentile": 700, "category": "AVERAGE" }
    }
  },
  "originLoadingExperience": { /* same shape, aggregated across the whole origin */ }
}
```

### Reading it correctly

- **`lighthouseResult`** = lab (this single run). **`loadingExperience`** = field (real users, ~28-day CrUX for *this URL*). **`originLoadingExperience`** = field for the *whole domain* — the fallback when a specific URL lacks its own CrUX sample.
- **`percentile`** is the 75th-percentile real-user value (Google's Core Web Vitals cutoff). Compare it to the budget.
- **CLS unit quirk:** `CUMULATIVE_LAYOUT_SHIFT_SCORE.percentile` is the CLS value **× 100** — `8` means CLS `0.08`. Divide by 100 before comparing to `0.1`.
- **`category`** per metric is Google's own bucket: `FAST` (good) · `AVERAGE` (needs improvement) · `SLOW` (poor).
- **`NONE` / missing metrics** = not enough real-user data yet (low traffic). Fall back to `originLoadingExperience`, then to the lab score. This is expected for new or low-traffic pages.
- **INP present here, not in the lab** — `INTERACTION_TO_NEXT_PAINT` is the real thing; the lab's `total-blocking-time` is only a proxy.

## Gating logic (what `run-pagespeed.mjs` does)

1. Prefer **field** (`loadingExperience`) when present; else `originLoadingExperience`; else fall back to the **lab** metrics.
2. For each Core Web Vital, compare the 75th-percentile value to the budget: `good` ≤ threshold, `poor` above the upper bound.
3. **Exit non-zero** if any Core Web Vital is `poor`/`SLOW`, or the lab performance score is below `performanceScore`. `needs-improvement`/`AVERAGE` warns but does not fail (tune with `--strict`).

## Rate limits

Default quota is modest (roughly ~25k queries/day, ~240/min with a key — check your Cloud quota page). For CI, one call per gated URL per run is plenty. Batch multiple URLs sequentially with a small delay rather than in parallel to avoid 429s.

## CrUX beyond PSI

For history and dashboards, the same field data is available via the **CrUX API** (`chromeuxreport.googleapis.com`, day-over-day) and the **CrUX BigQuery** dataset (monthly). PSI is the simplest per-URL check and is all this gate needs.
