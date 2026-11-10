import { onCLS, onFCP, onINP, onLCP, onTTFB } from "web-vitals/attribution";

const ENDPOINT = "/rum"; // <-- your collector endpoint (or swap report() for gtag)

const report = (metric) => {
  const measurementDocument = JSON.stringify({
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
  const canSendBeacon = navigator.sendBeacon != null;
  if (canSendBeacon) navigator.sendBeacon(ENDPOINT, measurementDocument);
  else fetch(ENDPOINT, { body: measurementDocument, method: "POST", keepalive: true });
};

onLCP(report);
onINP(report);
onCLS(report);
onFCP(report);
onTTFB(report);
