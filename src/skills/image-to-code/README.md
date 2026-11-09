# image-to-code

Convert a PNG design into pixel-perfect code — SVG, HTML/CSS, Tailwind, or React — using a measured screenshot-diff loop.

## Setup

From this directory's `scripts/` folder:

```bash
cd scripts
npm install
npx playwright install chromium
npm run typecheck
```

Run scripts from `scripts/` with `npx tsx src/...` or the npm shortcuts below.

## Core harness

| Script | Command | Purpose |
|--------|---------|---------|
| pixel-diff | `npm run diff -- --target design.png --input build.html` | Render + diff → ratio + hotspots |
| inspect-png | `npm run inspect -- --input design.png --at 40,120` | Dimensions, color samples, palette |
| frames | `npm run frames -- page.html sheet.png 300 0,300,600` | Animation contact sheet |

## PNG utilities (`src/png/`)

| Script | Purpose |
|--------|---------|
| `mask.ts` | Mask regions on a PNG before tracing |
| `crop.ts` | Crop + upscale a bbox for inspection |
| `regions.ts` | Column-projection band detection |
| `detect-purple.ts` | Connected-component violet feature detection |
| `extract-blob.ts` | Trace soft background blobs to SVG paths |

## HTML / SVG utilities

| Script | Path | Purpose |
|--------|------|---------|
| wrap | `src/html/wrap.ts` | Wrap SVG in sized HTML for diffing |
| embed-svg | `src/html/embed-svg.ts` | Build a responsive HTML viewer around an SVG |
| hand-clip | `src/png/hand-clip.ts` | Flood-fill hand silhouette for clip-path |

## Verification (`src/verify/`)

| Script | Purpose |
|--------|---------|
| `stitch.ts` | Side-by-side PNG compare sheet |
| `render-shot.ts` | Quick Playwright screenshot of HTML |

## Canonical iteration

Use this shape for any PNG → SVG/HTML task. The file names are examples; replace them with the user's real target and build output.

```bash
npm run inspect -- --input design.png
npm run diff -- --target design.png --input build/index.html --out diff.png
```

Read the ratio and top hotspot, then make exactly one edit. When the hotspot is hard to interpret, ask a second agent or browser model to act only as a visual judge:

```bash
bridge ask "Compare design.png, current.png, and diff.png. List the exact visual changes needed next; do not rewrite code." --provider chatgpt --attach design.png current.png diff.png --json
```

Use `bridge --help` / `bridge ask --help` for the installed attachment syntax. Feed the judge the target, current screenshot, and diff image. The judge's answer is feedback, not a pass condition; re-run `npm run diff` after every edit.

Example loop:

```text
before: ratio 0.1842; hotspot top-left; judge says header is too low
edit: move header up 14px
after:  ratio 0.1217; next hotspot is the icon

before: ratio 0.1217; judge says icon is too small
edit: scale icon to the measured bbox
after:  ratio 0.0086; next hotspot is button shadow

before: ratio 0.0086; judge says shadow is too soft
edit: reduce blur
after:  ratio 0.0008; measured pass
```

## SVGO

```bash
npx svgo --config scripts/svgo.config.mjs -i in.svg -o out.svg
```

## Output stack

Match the target repo's framework when one exists. Otherwise default to vanilla HTML + CSS + inline SVG. See `SKILL.md` stack detection.

## Docs

- [`SKILL.md`](SKILL.md) — agent workflow
- [`CONTEXT.md`](CONTEXT.md) — domain vocabulary and decisions
- [`TECH-GLOSSARY.md`](TECH-GLOSSARY.md) — technical term glossary
- [`reference/`](reference/) — decompose, rigging, animation, verification
