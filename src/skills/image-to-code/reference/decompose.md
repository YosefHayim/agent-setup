# Decompose the design

Goal: turn one flat PNG into an ordered build plan plus exact specs, before writing any code.

## 0. Intent intake (ask before you measure)

A PNG is a single frozen frame. Two things the user cares about are **not recoverable from the pixels** — how it should *move*, and how *faithful* vs *enhanced* they want it — so surface them up front instead of guessing and reworking. A short `AskUserQuestion` (2–4 questions) is the right tool. Resolve:

- **Static or animated?** If animated: which parts move (wave, blink, float, hover), and how big — a subtle idle, or a hero gesture? Any sound-off interactions (hover/click)?
- **Fidelity bar.** Strict pixel-perfect 1:1 reproduction, or "inspired-by / make it prettier" where deviating from the PNG is welcome? This decides whether the diff score is a hard gate or a loose guide.
- **Living enhancements the PNG can't show — suggest these, don't wait to be asked.** A still can't depict an animated/living background, ambient particle drift, a breathing glow, or a gradient that flows. Propose the obvious one (most commonly a **living background** — drifting aurora, floating colour blobs) and confirm the *vibe* (calm breath vs turbulent flow). Make clear it's an optional layer on top of the 1:1 still, not a change to the figure.
- **Reduced-motion** expectation (default: figure static, motion only under `prefers-reduced-motion: no-preference`).

Record the answers as the build contract. Enhancements that go *beyond* the PNG change how you verify — design them to rest at the PNG's state so the frozen diff still measures 1:1 (see `animation.md` "Living background" and `verification.md` "Verifying added motion").

## A. Establish the frame

- Run `npx tsx src/bin/inspect-png.ts --input design.png` (from `scripts/`) → get `width × height`. Build at these exact pixel dimensions; the diff loop renders at this viewport.
- Sample the base background (a corner): `--at 2,2`.
- If the PNG is a 2x/retina export, you can still build at its pixel dimensions — just keep every measured number in those same pixels. Stay consistent end to end.

## B. Raster vs reproducible (triage every region)

For each visual region decide: rebuild in code, or export the pixels?

| Reproduce in code (preferred)            | Export as raster (slice)                  |
| ---------------------------------------- | ----------------------------------------- |
| Solid fills, gradients, borders, radii   | Photographs                               |
| Box/drop shadows, blurs                  | Complex painterly textures                |
| Type, icons, simple/geometric logos      | Noise/grain, scanned art                  |
| Geometric illustration, charts, UI       | Anything cheaper as a PNG than 500 SVG nodes |

The pre-AI consensus: **slice only true raster; rebuild everything else.** Over-slicing is the classic mistake — gradients, shadows, and rounded corners belong in CSS, not in exported images.

## C. Extract exact specs (measure, don't guess)

You have only a PNG (no Figma/Zeplin handoff), so measure from pixels:

- **Color** — sample with `inspect-png.ts --at x,y` (exact hex) or `--palette 12` (dominant colors). Do not eyeball hex.
- **Type** — measure cap-height and line-height in pixels; identify the family by shape (serif / grotesque / geometric / humanist) and match to the closest web or system stack; then refine `font-size` until the diff over the text region drops. Record family, size, weight, letter-spacing, line-height, and color per text block.
- **Spacing & size** — measure gaps, padding, and element box sizes in pixels directly off the image.
- **Effects** — shadows: read offset, blur, spread, and sample the shadow color. Gradients: sample 2–3 stops and estimate the angle. Radii: measure the corner arc.

## D. Build a region map (order matters)

List regions in build order — **structural/largest first**, decorative/smallest last:

1. Page frame / background
2. Major layout blocks (header, hero, columns, footer)
3. Components within each block
4. Type and inline elements
5. Effects (shadows, gradients, borders)
6. Illustrations / icons
7. Animation (last — see `animation.md`)

Build and **measure one region at a time** so every diff is attributable to a single change. This is the "slow but 1:1" discipline — it is what makes convergence reliable instead of a guessing game.

## E. Plan the rig — if anything will animate

The moment the design is a **character/mascot or has parts that move** (waves, blinks, floats), decompose into the **skeleton first**, while you read the image — not later. This is the single biggest time-saver: building parts to rig up front turns animation into trivial keyframes; tracing flat and cutting later costs hours of fighting gaps and wrong pivots.

Enumerate, before acquiring any geometry:

- the **moving parts** (one named part per thing that rotates independently: head, eye, pupil, upper-arm, forearm, hand);
- each part's **joint** (where it pivots — wrist, elbow, shoulder, neck);
- the **parent → child chain** (hand → forearm → arm → torso);
- where parts **overlap** at each joint (so rotation never opens a gap).

Then acquire each part as its own clean, named, joint-pivoted layer (**reuse > hand-build > per-part masked trace > never one flat trace**). Full method in `reference/rigging.md`; the motion that rides on top is in `reference/animation.md`.
