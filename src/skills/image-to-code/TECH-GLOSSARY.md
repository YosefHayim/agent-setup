# TECH-GLOSSARY.md — Technical glossary

> Pure term definitions for tools and concepts used by the image-to-code scripts and references.
> Project-specific vocabulary agents must reuse consistently lives in [`CONTEXT.md`](CONTEXT.md).

## Playwright

Headless browser automation used to render HTML/SVG and capture screenshots. The harness sets `viewport` to the target PNG's pixel size and `deviceScaleFactor: 1` for 1:1 comparison. `waitUntil: 'networkidle'` waits for network activity to settle before shooting.

## pixelmatch

Per-pixel image comparison library. Returns a count of differing pixels. The `threshold` option controls how different two colors must be to count as a mismatch (not the overall pass/fail ratio). `includeAA: false` ignores anti-aliased edge pixels.

## mismatch ratio

`diffPixels / (width × height)` — the convergence metric. The default pass bar is `< 0.001` (0.1%).

## hotspot grid

An 8×N grid overlaid on the diff image. Cells with the most red diff pixels are ranked — fix the top hotspot before random tweaks.

## pngjs

Node library for reading/writing PNG pixel buffers synchronously (`PNG.sync.read` / `PNG.sync.write`).

## SVGO

SVG optimizer. Default presets strip `viewBox` and IDs that animations depend on — use `scripts/svgo.config.mjs`. Animated figures with opacity-0 rest frames need more plugins off — see the minify guard in `reference/animation.md`.

## potrace / trace

Vectorizing a bitmap into SVG paths. Use only for gaps you cannot find in existing SVG libraries or hand-build.

## transform-origin / transform-box

CSS properties that control where a rotation or scale pivots. `transform-box: view-box` keeps origins in SVG viewBox coordinates. Wrong pivot = pinwheeling limb.

## prefers-reduced-motion

Media query. Animated figures should fall back to the static 1:1 still when the user requests reduced motion.

## contact sheet (frames)

A single PNG of multiple animation poses at specified timeline timestamps. The harness seeks animations via the Web Animations API (`getAnimations().currentTime = t`) for deterministic poses without load-timing drift.

## tsx

TypeScript execution runtime. Scripts run directly from `.ts` source without a compile step: `npx tsx src/bin/pixel-diff.ts`.

## Douglas–Peucker / Moore-neighbour

Contour tracing/simplification algorithms used by `extract-blob` and `hand-clip` to turn pixel regions into SVG path data.

## chroma key (green screen)

Painting non-subject pixels bright green (#00FF00) so a trace can strip the background to transparency. Used to cut a white part off a white body before tracing (`reference/rigging.md`).

## flood fill / exterior flood

Filling from the canvas border inward through non-outline pixels; unreachable pixels form a closed silhouette (hand clip-path technique).
