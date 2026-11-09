# Verification — the convergence loop

This is the mechanism that turns "looks close" into measured 1:1.

## Setup (once)

From the skill's `scripts/` directory:

```
npm install
npx playwright install chromium
```

## Inspect the target

All commands below run from the skill's `scripts/` directory:

```
npx tsx src/bin/inspect-png.ts --input design.png             # dimensions
npx tsx src/bin/inspect-png.ts --input design.png --at 40,120  # exact hex at a pixel
npx tsx src/bin/inspect-png.ts --input design.png --palette 12 # dominant colors
```

`--at` may be repeated to sample several points in one call.

## Run a diff

```
npx tsx src/bin/pixel-diff.ts --target design.png --input build/index.html
```

Options:

| Flag            | Default          | Meaning                                          |
| --------------- | ---------------- | ------------------------------------------------ |
| `--out`         | `./diff.png`     | where to write the diff image                    |
| `--width`/`--height` | target's size | override the render viewport                     |
| `--threshold`   | `0.1`            | per-pixel color tolerance, 0..1                  |
| `--max-ratio`   | `0.001` (0.1%)   | pass if the mismatch ratio is below this         |
| `--no-freeze`   | off              | do not disable animations before the screenshot  |

`--input` accepts a local HTML file or an `http(s)` URL.

## Read the output

JSON report:

- `ratio` / `ratioPct` — fraction of pixels that differ (your score; drive it toward ~0).
- `pass` — whether `ratio < max-ratio` (process exits 0 on pass, 1 on fail).
- `hotspots` — grid cells with the most difference, each with a pixel `bbox`. **Fix the top hotspot next.**
- `diffImage` — red marks every differing pixel; open it to see what is off.

## Convergence strategy ("slow but 1:1")

1. Run the diff → note `ratio` and the top hotspot.
2. Make **one** change addressing that hotspot (a spacing, a color, a font-size).
3. Re-run. Confirm the ratio dropped and no new hotspot appeared.
4. Repeat. Stop when `ratio < 0.1%` or improvements stall — then **report the final ratio**. Do not claim a 1:1 you did not measure.

## Visual judge loop (second agent)

Pixel diff tells you **where** pixels differ; a visual judge can explain **what** the design difference is. Use it when the top hotspot is hard to interpret, a low-threshold sweep reveals a broad mismatch, or the developer wants a human-style comparison before the next edit.

The judge is not the builder. It only compares images and returns concrete deltas. The builder still makes one edit, runs the harness, and checks whether the score improved.

### Inputs

Give the judge three artifacts whenever possible:

- `target.png` — the original design.
- `current.png` — a screenshot of the current build at the exact target dimensions.
- `diff.png` — the pixelDiff output.

Create `current.png` with the browser or any screenshot tool that preserves the target dimensions. If the bridge cannot attach files in the current shell, open the browser-attached target/current/diff images and ask the judge from that attached browser session. If neither path works, do the comparison yourself and say the judge loop was skipped.

### Bridge prompt

Use `bridge --help` or `bridge ask --help` for the installed syntax. The expected shape is:

```
bridge ask "You are only a visual comparison judge. Compare target.png, current.png, and diff.png. Return the top 5 concrete visual deltas in priority order: geometry, spacing, color, typography, shadows, missing elements. Do not rewrite code. Do not speculate beyond the images." --provider chatgpt --attach target.png current.png diff.png --json
```

`bridge ask --help` exposes `--attach <path...>` in the local install. If that changes, use the help output as the source of truth and attach the three images by the current mechanism.

### Iteration rule

1. Run `pixel-diff.ts` and capture the ratio + hotspots.
2. Ask the judge for prioritized visual deltas.
3. Pick **one** delta that corresponds to the top hotspot or an obvious missing region.
4. Edit only that thing.
5. Re-run `pixel-diff.ts`.
6. Keep the change only if the score improves or the developer agrees the visual match is better.

Stop when one of these is true:

- `ratio < 0.1%`.
- The judge no longer identifies meaningful deltas.
- Further numeric changes make the design worse.
- The developer approves the current match.

Report both signals at the end: final mismatch ratio and the judge/developer verdict.

### Canonical iteration example

```text
Target: design.png
Build: build/index.html

Iteration 1
ratio: 0.1842
hotspot: x=0..160, y=0..90
judge: header sits 12-16px too low; title color is too dark; icon is missing
edit: move header up 14px

Iteration 2
ratio: 0.1217
hotspot: x=412..520, y=24..88
judge: icon is 8px too small and uses rounded joins instead of square joins
edit: increase icon viewBox scale and set stroke-linejoin="miter"

Iteration 3
ratio: 0.0086
hotspot: x=220..360, y=310..340
judge: button shadow is slightly too soft
edit: tighten box-shadow blur from 18px to 12px

Final
ratio: 0.0008
judge: no meaningful visual deltas remain
verdict: measured pass
```

## Blind spots — what a low ratio can still miss

A passing `ratio` is necessary, not sufficient. The default per-pixel threshold (`0.1`) is **blind to large, very pale fills**: a soft pastel background (e.g. lavender `#f4edfd` on white `#fefefe`, a ~15/255 gap) scores as "same" on every pixel, so an entire missing background element reads as ~1% while it is **completely absent**. The score looked held; a whole region was gone.

Guard against it every build:

- **Run a second, low-threshold sweep** to surface pale differences the strict pass hides:
  ```
  npx tsx src/bin/pixel-diff.ts --target design.png --input build.html --threshold 0.02
  ```
  A big jump between the `0.1` and `0.02` ratios (here 1% → 13%) means a faint, large-area mismatch — open that diff image; the red will outline the missing/!wrong pale shape.
- **Eyeball the full render against the target at matched scale**, not just the diff. The diff paints what *differs*; it cannot flag a soft element that is below threshold everywhere. A human glance catches "the background cloud is gone" instantly.
- **Sample flat regions with `inspect-png.ts --at`** where you expect a tint. White-vs-tint at the same coordinate confirms presence/absence directly, independent of the diff.

Missing a pale element is the most likely way to ship something that "measures 1:1" yet looks wrong. Treat any large gap between strict and loose thresholds as an unmet region, not noise.

A clean _rest_ diff is also blind to **motion-only acquisition artifacts** — defects that exist in the geometry but only surface once a part moves. The classic one: a moving part traced through a slightly loose mask carries a pale background **margin** that blends in at rest (pale-on-pale, scores ~0) but swings into view as a hard-edged patch the instant the part rotates. The static score will look converged while the animation looks broken. So a passing rest diff is never sufficient for a rigged part: **seek every moving part to its rotation extremes and eyeball the part _and_ its junction there** (`src/bin/frames.ts` at the keyframe times), not just the rest pose. See `rigging.md` "Acquiring each part" (mask margin → swinging ghost) for the fix.

## Avoiding false diffs

- **Fonts** — the script waits for `document.fonts.ready`; ensure the exact font is actually loaded (self-host or Google Fonts) or text diffs everywhere.
- **Anti-aliasing** — AA pixels are ignored (`includeAA:false`); sub-pixel text rendering still leaves a small floor (~0.1–0.3% residual is normal — do not chase literal 0).
- **Animations** — frozen by default so frames are stable.
- **Dynamic content** (dates, avatars) — set it to the same value as the target before diffing.
- **Scale/retina** — build and diff at the target PNG's pixel dimensions so the screenshot and target dimensions match exactly.

## Verifying added motion (enhancements beyond the PNG)

When you add motion the original never had — a living background, ambient drift, a hover reaction — there is **no static target to diff it against**. Verify in two independent halves:

1. **The rest frame still measures 1:1.** Author the enhancement to contribute nothing at its `0%`/`100%` keyframe (opacity 0, no transform — see `animation.md` "Living background"), then run the normal frozen diff. It must hold at your converged ratio. If it rose, the enhancement leaked into the rest state and is no longer "on top of" the 1:1 still — pull it back to a true zero rest.
2. **The motion itself is eyeballed, deliberately.** A pixel diff cannot judge "does the aurora flow nicely". Sample the live cycle with `npx tsx src/bin/frames.ts <page.html> sheet.png <cell> <t0,t1,…>` across the loop's period and review the contact sheet, plus open it in a browser. Say plainly that the motion is judged by eye — that is correct here, not a shortcut.

Pick timestamps that actually land in the motion: for a long out-of-phase loop, sample seconds apart (e.g. `0,8000,14000`) so you catch the bloom, not just the rest frame.

## Manual fallback (no Node/Playwright)

Reproduce the PerfectPixel method: overlay the target PNG over the live build at ~50% opacity (a `position:fixed` `<img>` with `pointer-events:none`), and nudge CSS until aligned. Use DevTools' eyedropper for color and the ruler for spacing. **State clearly that the match is eyeballed, not measured.**
