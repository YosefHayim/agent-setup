# Animation

Add animation **only after the static match holds** (diff under threshold). Animate `transform` and `opacity` (GPU-composited); avoid animating `d`, `fill`, or `stroke` geometry (CPU repaints). Always honor `prefers-reduced-motion`.

## Pick a technique

| Technique                      | Use when                                                | Cost        |
| ------------------------------ | ------------------------------------------------------- | ----------- |
| **CSS animations/transitions** | simple, performant motion; widest browser support       | none        |
| **SMIL** (`<animate>`)         | self-contained SVG that must animate as `<img>`/background | none      |
| **GSAP** (+ DrawSVG/MorphSVG)  | complex timelines, scroll-trigger, shape morph, draw    | library     |
| **anime.js**                   | lightweight staggers, moderate sequences                | small       |
| **Vivus**                      | dedicated zero-dependency line-drawing                  | small       |
| **Lottie**                     | animation authored in After Effects (Bodymovin → JSON)  | player ~50KB |

Default to **CSS/SMIL**; reach for a library only for morphing, complex timelines, or AE-authored motion — and note why near the import.

## Line-draw ("draw-on") recipe

The most-requested SVG effect. Two stroke properties:

```css
path {
  stroke-dasharray: 1000;     /* = path length */
  stroke-dashoffset: 1000;    /* hide the stroke */
  animation: draw 2s ease forwards;  /* forwards: stay drawn */
}
@keyframes draw { to { stroke-dashoffset: 0; } }
```

Get the exact length with `path.getTotalLength()`, or set `pathLength="100"` on the path and use round numbers. `animation-fill-mode: forwards` is required, or the stroke resets to invisible when the animation ends.

## Morphing

CSS cannot morph the `d` attribute cross-browser. Use **SMIL** (`<animate attributeName="d">`) for simple, equal-point morphs, or **GSAP MorphSVG** when point counts differ.

## Structure first (don't animate a figure that isn't rigged)

A wave that "detaches," "tears a gap," or "swings the wrong way" is a **structure** defect, not a timing one — no keyframe fixes it. The parts must first be built to rig: named, joint-pivoted, parented, and overlapping at each joint. That is `reference/rigging.md`, and it is decided at **build time**, before you reach this file. Everything below assumes the rig already passes the crux test there (seek each part to its extremes — it hinges cleanly with no gap).

## Motion that reads as alive (not robotic)

The two tells of mechanical motion are **linear easing** and **a loop that never rests**. Fix both:

- **Ease everything — never linear.** Real motion accelerates and decelerates. Defaults: `ease-in-out` for ambient loops; `cubic-bezier(0.4,0,0.2,1)` (standard) for gestures/transitions; `cubic-bezier(0.2,0,0,1)` (emphasized) for a hero move; `cubic-bezier(0,0,0.2,1)` (decelerate) for a part settling into rest.
- **Act, then hold.** A gesture should `anticipate → act → overshoot → settle → HOLD`, where the hold is most of the cycle (rest value repeated across a wide keyframe span, e.g. `60–100%`). A wave that greets and pauses reads as a character; one that wipes nonstop reads as a busy GIF.
- **Follow-through / lag.** Because the rig is parented, drive the parent and let children trail: stagger each child `40–120ms` behind via `animation-delay`, same easing down the chain (shoulder leads, hand lags). Overshoot slightly, then settle.
- **Anticipation.** A small, fast counter-move before the main one (arm dips a few degrees before waving up). Reserve it for the headline gesture.
- **Keep idle amplitudes subtle** — `2–4%` scale, `2–4px` translate, `1–3°` rotation. Subtle reads as alive; large reads as a cartoon.
- **Phase-offset the periods** so parts never re-sync into one visible beat: e.g. breathe `4s`, sway `5.5s`, blink `3.2s` (no common factor), staggered delays.

### Timing cheat-sheet for a friendly UI mascot

| Motion | Duration / cadence | Easing | Amplitude | Hold |
| --- | --- | --- | --- | --- |
| Idle float / breath | 3.5–5s loop | `ease-in-out` | `translateY` 2–4px or `scale` 1.02–1.04, pivot at base | continuous, asymmetric (exhale longer than inhale) |
| Blink | close+open ~120–150ms, every 3–5s | snappy; close faster than open | `scaleY` → 0.05–0.1 | eyes open ~95% of cycle |
| Wave (hero gesture) | swing ~0.4–0.6s ×2–3, then rest | `ease-in-out` / emphasized | rotate ±12–20° **at the joint**, hand lags 40–120ms | acts ~30%, holds ~70% |
| Head / weight sway | 4–6s loop | `ease-in-out` | rotate ±1–3°, translate 1–2px | continuous, low, out of phase with breath |
| Hover reaction | 150–300ms one-shot | `cubic-bezier(0.4,0,0.2,1)` | `scale` 1.03–1.05 + `translateY` -2px | reverse on hover-out |

Act-then-hold wave skeleton:

```css
@keyframes wave {
  0%   { transform: rotate(0deg); }   /* rest */
  5%   { transform: rotate(-5deg); }  /* anticipation */
  15%  { transform: rotate(15deg); }  /* act up */
  22%  { transform: rotate(6deg); }   /* swing */
  29%  { transform: rotate(15deg); }  /* swing */
  36%  { transform: rotate(2deg); }   /* overshoot/settle */
  42%  { transform: rotate(0deg); }   /* rest */
  100% { transform: rotate(0deg); }   /* HOLD ~58% of the cycle */
}
```

## Living background (optional enhancement — suggest it during intake)

A static PNG can only show a frozen background. When the user wants the scene to feel alive (intake §0), layer ambient motion *behind* the figure — without disturbing the 1:1 still. The discipline that keeps both true:

**Rest the enhancement at the original state.** Author the added layer so its `0%`/`100%` keyframe contributes nothing (`opacity: 0`, no transform) and it blooms only mid-cycle. Then the frozen-diff frame — and the reduced-motion fallback — is exactly the original PNG; the motion is *added on top of* the measured 1:1, never baked into it. A background whose rest frame differs from the PNG silently raises your diff and breaks the "still matches 1:1" claim.

### Drifting aurora (soft colour that slides and blends)

Soft violet/pink glows that drift and bloom over a background region — the calm, northern-lights vibe.

```css
.au  { opacity: 0; animation-timing-function: ease-in-out; animation-iteration-count: infinite; }
.au1 { animation-name: drift1; animation-duration: 19s; }   /* long, out-of-phase periods   */
.au2 { animation-name: drift2; animation-duration: 24s; }   /* (19/24/29s — no common factor) */
.au3 { animation-name: drift3; animation-duration: 29s; }   /* so they never re-sync          */
@keyframes drift1 { 0%,100% { transform: translate(0,0); opacity: 0; } 35% { transform: translate(34px,-22px); opacity: .55; } 70% { transform: translate(-16px,16px); opacity: .32; } }
```

- Each glow is a large **radial-gradient ellipse** (`fill="url(#grad)"`, colour → transparent) under one heavy `feGaussianBlur` (`stdDeviation` ~26) so edges feather and colours blend.
- Place them **over the base background fill but behind the figure**, concentrated on the visible background; the figure's opaque paths cover the rest.
- Every keyframe rests at `opacity: 0` (the discipline above), and the base `.au { opacity: 0 }` is the reduced-motion fallback.

Variations on the same skeleton, matched to the vibe captured in intake: **floating blobs** (slow `translate` + reshape, blurred edges), **breathing glow** (gentle `scale`/hue-shift pulse, minimal), **turbulent flow** (animate `feTurbulence` / `feDisplacementMap` for true organic noise — richest, costlier).

> **Minify guard.** An element resting at `opacity: 0` looks "hidden" to SVGO's `removeHiddenElems`, which will **delete the whole layer**. Turn that plugin off (alongside the usual `cleanupIds` / `collapseGroups` / `minifyStyles` off) so animation-driven, rest-hidden elements survive — then re-check the layer still exists in the minified output.

## Reduced motion (opt-in, not afterthought)

Author the figure **static by default** and add life only when motion is allowed — this guarantees no flash-of-animation for sensitive users:

```css
#body, #eyes, .arm, .twinkle { transform: none; opacity: 1; }
@media (prefers-reduced-motion: no-preference) {
  .bot { animation: float 5s ease-in-out infinite; }
  /* …rest of the motion… */
}
```

Reduce, don't nuke — keep the figure present and stable; prefer dropping the trigger-heavy motion (blink, wave) while optionally keeping one slow, low-amplitude breath. Keep loop cycles ≤5s or provide a pause control (WCAG 2.2.2). In a blanket override use `0.01ms`, not true `0`, so `animationend` listeners still fire.

## Verifying animation

Pixel-diff compares static frames. To confirm an animation reaches its target pose: pause it at a key time (`element.style.animationPlayState = 'paused'`, or seek the timeline), screenshot, and diff that frame. The diff loop freezes animations by default — pass `--no-freeze` only when you intentionally capture a posed frame.

`npx tsx src/bin/frames.ts <page.html> <out.png> <cell> <ms,ms,...>` renders a contact sheet by **seeking** every animation to exact timestamps via the Web Animations API (`getAnimations().currentTime = t`) — deterministic, no load-timing drift. Use it to eyeball a wave's swing and a blink's closed frame in one image (e.g. `0,300,600` for the swing, the blink's closed time for the eyes). Seeking beats `setTimeout`-then-shoot, which drifts by the page's load time and silently misses short poses.
