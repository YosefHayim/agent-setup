# Reference — web-vitals RUM (your own field data)

`web-vitals` is Google's tiny library for measuring Core Web Vitals in real users' browsers. It's the same measurement logic Chrome uses, so your numbers line up with CrUX — but per page, in real time, with attribution. Source: <https://github.com/GoogleChrome/web-vitals>.

Use it when CrUX is too slow or too aggregated: CrUX is a 28-day origin/URL average and needs traffic; RUM tells you *today*, *this page*, *this element*.

## Install

```bash
npm i web-vitals
```

## What it measures

`onLCP`, `onINP`, `onCLS` (the Core Web Vitals) plus `onFCP`, `onTTFB`. **INP replaced FID** — there is no `onFID` in current versions.

```js
import { onCLS, onINP, onLCP, onFCP, onTTFB } from "web-vitals";

onLCP(console.log);
onINP(console.log);
onCLS(console.log);
onFCP(console.log);
onTTFB(console.log);
```

Each callback receives a metric object: `{ name, value, rating, delta, id, navigationType, entries }`.

- `value` — the metric value (ms, or unitless for CLS).
- `rating` — `"good" | "needs-improvement" | "poor"` (uses the standard thresholds).
- `delta` — change since the last report for this metric `id` (send `delta`, not `value`, to analytics that sum events).

## Standard vs attribution build

The **attribution build** adds an `attribution` object naming the *cause* — the LCP element, the CLS-shifting node, the event + script behind a slow INP. It's ~1.5 KB larger (brotli); worth it for debugging.

```js
import { onLCP, onINP, onCLS } from "web-vitals/attribution";
```

Attribution highlights:

- **LCP** → `attribution.element`, `attribution.url`, and phase timings (`ttfb`, `resourceLoadDelay`, `elementRenderDelay`) — tells you *why* LCP is slow, not just that it is.
- **INP** → `attribution.interactionTarget` (the element), `attribution.inputDelay` / `processingDuration` / `presentationDelay` (which phase dominates).
- **CLS** → `attribution.largestShiftTarget` (the node that jumped) and `largestShiftTime`.

## Send to your sink

`sendBeacon` survives the page-unload that ends a visit; `fetch(..., {keepalive:true})` is the fallback. Report on each callback (metrics finalize at different times):

```js
import { onCLS, onFCP, onINP, onLCP, onTTFB } from "web-vitals/attribution";

const ENDPOINT = "/rum";

function report(metric) {
  const body = JSON.stringify({
    name: metric.name,
    value: metric.value,
    rating: metric.rating,
    delta: metric.delta,
    id: metric.id,
    navigationType: metric.navigationType,
    target:
      metric.attribution?.element ??
      metric.attribution?.interactionTarget ??
      metric.attribution?.largestShiftTarget,
    url: location.pathname,
  });
  if (navigator.sendBeacon) navigator.sendBeacon(ENDPOINT, body);
  else fetch(ENDPOINT, { body, method: "POST", keepalive: true });
}

onLCP(report);
onINP(report);
onCLS(report);
onFCP(report);
onTTFB(report);
```

The shipped `templates/web-vitals.js` is this snippet, ready to drop into an app entry point.

### To Google Analytics 4 instead

```js
import { onCLS, onINP, onLCP } from "web-vitals/attribution";

const sendMetricToAnalytics = (metric) => {
  gtag("event", metric.name, {
    value: Math.round(metric.name === "CLS" ? metric.delta * 1000 : metric.delta),
    metric_id: metric.id,
    metric_rating: metric.rating,
    debug_target: metric.attribution?.element ?? metric.attribution?.interactionTarget,
  });
};
onCLS(sendMetricToAnalytics);
onINP(sendMetricToAnalytics);
onLCP(sendMetricToAnalytics);
```

## Thresholds (exported constants)

```js
import { CLSThresholds, INPThresholds, LCPThresholds } from "web-vitals";
LCPThresholds; // [2500, 4000]  → good ≤2500, poor >4000 (ms)
INPThresholds; // [200, 500]    → good ≤200,  poor >500  (ms)
CLSThresholds; // [0.1, 0.25]   → good ≤0.1,  poor >0.25 (unitless)
```

These are the same numbers the lab gate and PSI check assert — keep them in sync with `templates/budgets.json`.

## Framework notes

- **SPA / client routing** — LCP/CLS finalize per "page" on hard load; for soft navigations, current `web-vitals` supports the `navigationType` and reports per navigation. Attribute reports to `location.pathname` at report time.
- **Where to init** — once, as early as possible in the app entry (before hydration is fine). Importing the library does not block render.
- **Sampling** — for high traffic, sample (e.g. report 10%) client-side to cut collector cost; keep the sample rate in the payload so you can weight later.
