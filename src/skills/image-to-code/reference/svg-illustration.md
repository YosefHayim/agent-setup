# SVG illustrations & logos

Order of preference: **reuse → customize → trace → hand-build**. Always try to find an existing vector before drawing one from scratch.

> **If the illustration will animate, this order changes.** A flat trace is anonymous path soup — fine for a static logo, a dead end for a character you must rig (you can't select "the hand"). For anything with moving parts, prefer **reuse a structured kit → hand-build → per-part masked trace**, and **never one flat trace**. See `reference/rigging.md` (decide this during decomposition, step E).

## 1. Reuse (check first)

| Source                                   | Best for                  | Notes                                  |
| ---------------------------------------- | ------------------------- | -------------------------------------- |
| SVGRepo (svgrepo.com)                    | 500k+ icons & vectors     | filter by license; mono & multicolor   |
| unDraw (undraw.co)                       | illustrations             | live recolor to a brand hue; open license |
| Heroicons / Feather / Phosphor / Lucide  | UI icons                  | MIT; consistent stroke sets            |
| Iconify (iconify.design)                 | aggregate of many sets    | one API, huge selection                |
| Noun Project (thenounproject.com)        | broad icon search         | check attribution / license            |

Customizing a reused SVG: set `fill`/`stroke` to the sampled hex, scale via the `viewBox` (not width/height hacks), strip unrelated nodes, and align it using the diff loop.

## 2. Trace (when no existing vector fits)

Tracers give a **starting path set, not a final 1:1** — always simplify and refine after tracing.

- **potrace** — single-color line art / logos; the best engine for clean silhouettes. Pre-process with `mkbitmap` for grayscale/color. It powers Inkscape's *Trace Bitmap* (Potrace mode).
- **AutoTrace** — multi-color plus **centerline** tracing (produces strokes, not just filled outlines).
- **Inkscape Trace Bitmap** — GUI; use "Multiple scans" for color (one object per scan), then **Path → Simplify (Ctrl+L)** to cut the huge node count.
- **Illustrator Image Trace** — most control (threshold / paths / corners / noise) if it is available.

CLI sketch (single color):

```
mkbitmap design.png -o tmp.pbm     # threshold/blur pre-process
potrace tmp.pbm -s -o out.svg      # -s = SVG output
```

Multi-color: trace per color layer (or use Inkscape's multiple scans) and stack the resulting paths.

### No tracer installed? Extract one flat region yourself

When potrace/VTracer aren't available but you need a single **flat or soft color region** as a path (a background blob, a solid shape behind the figure), you can DIY a one-color tracer with `pngjs` in ~120 lines — it's just the per-color step a real tracer does internally:

1. **Classify** each pixel as in/out of the region by color test (e.g. lavender = pale, blue-dominant, not white/linework). Forgive anti-aliasing with a tolerance.
2. **Downsample** to a coarse grid (÷3–÷4) — soft regions are low-frequency, and a smaller grid both speeds tracing and smooths the contour.
3. **Connected components** (flood fill) so each region traces once; drop specks below a min area.
4. **Moore-neighbour boundary trace** each component → an ordered ring of points.
5. **Douglas–Peucker simplify** — but the ring is **closed** (start == end), so a single DP pass collapses it to 2 points on a zero-length baseline. Split the ring at its farthest vertex and DP each open half. (This bug silently drops every contour — watch for "kept 0".)
6. Emit `<path d="M…L…Z">` per component; add a slight `feGaussianBlur` to match a feathered edge.

Place a background region **behind** the figure: the figure's opaque paths cover the part inside its footprint, so only the true background shows. `scripts/src/png/extract-blob.ts` is a worked example.

## 3. Hand-build (geometric / simple shapes)

Set `viewBox="0 0 W H"` to the target's pixel frame so coordinates map 1:1 to measured positions. Use primitives (`rect`, `circle`, `path`) with coordinates measured from the PNG. Verify placement with the diff loop and nudge coordinates until the region clears.

## 4. Effects: SVG vs CSS

- Simple flat fills / gradients → inline SVG gradient (`<linearGradient>`).
- Reusable UI shadows/blurs → prefer CSS (`box-shadow`, `filter: drop-shadow()`); cheaper than SVG filters.
- Keep one source of truth — do not duplicate a gradient in both the SVG and the CSS.

## 5. Optimize (always, before shipping)

Run SVGO with the bundled safe config (keeps `viewBox` for responsiveness and IDs for animation):

```
npx svgo --config scripts/svgo.config.mjs -i out.svg -o out.min.svg
```

Typical 30–85% size cut with no visual change. Do **not** optimize after wiring animations to IDs — SVGO can rename or merge them and break the animation.
