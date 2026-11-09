// Real-user Core Web Vitals reporting (RUM).
//
// Copy into your app's entry point, run `npm i web-vitals`, and point ENDPOINT
// at your collector. Uses the `web-vitals/attribution` build so a bad score
// also tells you *what* caused it (the LCP element, the shifting node, the
// slow interaction target). INP replaced FID — there is no onFID.
//
// On a TypeScript codebase, rename to .ts; the types ship with the package.
import { onCLS, onFCP, onINP, onLCP, onTTFB } from "web-vitals/attribution";

const ENDPOINT = "/rum"; // <-- your collector endpoint (or swap report() for gtag)

function report(metric) {
  const measurementJson = JSON.stringify({
    name: metric.name, // "LCP" | "INP" | "CLS" | "FCP" | "TTFB"
    value: metric.value,
    rating: metric.rating, // "good" | "needs-improvement" | "poor"
    delta: metric.delta, // send delta to analytics that sum events
    id: metric.id,
    navigationType: metric.navigationType,
    // The element/interaction/shift behind the score (attribution build).
    target:
      metric.attribution?.element || metric.attribution?.interactionTarget || metric.attribution?.largestShiftTarget,
    url: location.pathname,
  });

  // sendBeacon survives the page-unload that ends a visit; fetch is the fallback.
  if (navigator.sendBeacon) navigator.sendBeacon(ENDPOINT, measurementJson);
  else fetch(ENDPOINT, { body: measurementJson, method: "POST", keepalive: true });
}

onLCP(report);
onINP(report);
onCLS(report);
onFCP(report);
onTTFB(report);
