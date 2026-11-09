# Rigging — structure art so it animates without breaking

The lesson that costs the most time when skipped: **if a part will move, its riggability is decided when you _build_ it, not when you animate it.** Tracing the whole figure flat and then trying to cut "the hand" out of the path soup is the trap — you spend the animation phase fighting gaps, detached limbs, and wrong pivots. The pre-AI discipline (Illustrator/After Effects/Spine/Rive all share it) is the reverse: **decompose into the skeleton first**, build each part to rig, and the motion becomes trivial keyframes on already-correct pivots.

## When this applies

- **Static** illustration / logo / UI screen → skip this file. A flat trace or hand-build is fine (`svg-illustration.md`).
- **Anything with moving parts** — a mascot that waves/blinks/floats, an animated icon, a character — → **rig-first.** Decide the skeleton _before_ acquiring geometry.

## The four principles (in order — this is the whole game)

1. **Slice at the joints into named parts.** One `<g id="…">` per part that moves independently, cut where rotation happens: shoulder, elbow, wrist, neck, eyelid, pupil. Name semantically (`arm-l`, `forearm-l`, `hand-l`). Don't over-segment (YAGNI): fingers are one `hand` group unless they must articulate; an eye + its glint move together.

2. **Pivot at the joint, never the center.** A part rotates around its `transform-origin`; put it _on the joint_ that connects the part to its parent (hand→wrist, forearm→elbow, arm→shoulder, head→neck, pupil→eyeball center, whole mascot→feet/base). A **center** pivot makes the part pinwheel and detach; a **joint** pivot hinges. _Symptom → diagnosis:_ "the limb swings away / orbits empty space / helicopters" ⇒ pivot is at the center, must move to the joint. (Recipes below.)

3. **Parent child-inside-parent (nest the groups).** Physically nest `<g>`: hand inside forearm inside upper-arm inside torso. Nested groups compose transforms exactly like an FK bone chain — rotating a parent carries all its children for free, so you animate the parent once and the chain follows. Use **FK only** (rotate down the chain); IK (place the tip, solve backwards) is overkill for UI motion and has no native SVG support.

4. **Overlap at the joint so rotation never opens a gap.** This is _the_ fix for the "windshield-wiper gap" — two pieces that merely touch at a seam tear open a wedge the instant the child rotates. Three combined build-time moves:
   - **Extend the child under the parent** — draw the forearm's top as a tongue that tucks _beneath_ the upper arm, deep enough to cover the maximum swing the animation uses.
   - **Layer parent over child** — document order is z-order in SVG; put the child group _earlier_ (underneath) so the parent always covers the seam.
   - **Round the joint cap** — a circle centered on the pivot looks identical at every angle, so it never reveals a gap. (This is why cartoon mascots have visibly rounded shoulders, elbows, knees, wrists — and the pivot sits at that circle's center, tying back to principle 2.)

   The covering art has to _exist in the source_ — a flat PNG sliced on a hard edge has no tuck-under tongue. That's why this is a build-time decision, not a fix you can apply later.

> **Crux test (do this before claiming a rig works).** Seek each moving part to its rotation extremes (`src/bin/frames.ts`, or rotate by hand) and look at the joint. Hinges cleanly from the joint with no gap → right. Pinwheels, detaches, or tears a seam → a **principle-2 (pivot)** or **principle-4 (overlap)** defect in the _structure_. Fix the art, not the keyframes.

## Match the joint to the gesture — and to the rest pose

Principle 1 says slice at *the* joint; this is *which* one. The right joint is the one a human would actually move to make **that gesture from that starting pose** — not a fixed per-character rule. A rig can hinge cleanly and still read as awkward if it animates the wrong joint.

- **Hand already raised, palm forward → wave at the WRIST.** Only the hand turns (rock ±12–15°); the forearm and shoulder stay planted. This is the universal "hello".
- **Arm down at the side → raise from the SHOULDER,** then rock the wrist.
- A **whole-arm rigid sweep is the wrong model for an already-raised hand.** A rigid limb can only pivot at its *base*, so the base joint (elbow/shoulder) hinges the entire limb like a gate — the elbow swings sideways and the palm *slides* instead of waving. It reads as a stiff pendulum, not a greeting. "Rig-first" is not "rig the biggest part".

This decides **principle 1's slice**: choosing the joint and choosing the cut are one decision. An already-raised wave needs the **hand** as its own part — cut at the wrist, with the forearm left in the base to hide the junction (its planted bulk covers the seam, so the rock never gaps) — *not* the whole arm as one rigid piece. Make this call during decomposition, from the rest pose, not after tracing.

## Acquiring each part (decision rule)

**Reuse > hand-build geometry > per-part masked trace > single flat trace.** For an animated character, **never one flat trace** — tracers are pixel-followers with no concept of "hand," so they emit anonymous, fragmented paths you can't select or rig.

- **Reuse** a structured kit and recolor: Open Peeps (CC0, modular heads/bodies/limbs), Humaaans, or any vector already split into named parts. Verify it is actually riggable: named groups, clean nodes (few anchors; true `<circle>`/`<rect>` where geometric), parts _not_ fused into one compound path. A single flattened path is no better than a trace.
- **Hand-build** with primitives (`<circle>`, `<rect>`, `<path>`) when the shape is regular — crisp at any scale, tiny, and you get the joint coordinate for free (a hand-built arm _is_ a `<g>` with a known shoulder point).
- **Per-part masked trace** when the source is a raster you must trace: isolate **one** part (mask everything else), trace that alone onto its own named layer, set its joint pivot, then repeat per part. Deliberate per-part isolation yields a named, riggable hierarchy instead of soup. This is what a color tracer does internally per color — you do it per _body part_, on purpose.
  - **White-on-white parts** (a white arm whose fill merges into a white body trace into one mega-path): chroma/luma-key the part out first — mask the whole limb on a green key → trace → strip the green for a transparent overlay. Then **fill the hole** you cut from the base by stretching true background across each row (sample the first _bright_ pixel outside the mask, stepping **past** the black linework so you don't smear it, then flat-fill). The overlapping part hides the fill at rest; rotation then reveals only plausible background, never a void.
  - **Cover-layer fallback (no tracer / messy fill).** A per-row stretch-fill often leaves a faint **ghost** of the part's rest outline in the base — invisible at rest (the part covers it) but revealed the moment the part sweeps off it. If you can't re-mask/re-fill at the source, **sample the true background behind the part** (`inspect-png.ts --at`) and lay a flat shape of that color over the part's footprint, _behind_ the moving group. When the background is uniform (e.g. flat white) this is exact and free: same-color-on-same-color at rest (no fidelity hit), clean background revealed during motion. This realizes the overlap principle with a cover instead of redrawn art.
  - **Mask margin → "swinging ghost" (clip the moving part to its own silhouette).** A hand-drawn mask polygon is almost always a little _looser_ than the part's ink, so the traced layer carries a thin ring of **background** between the mask edge and the part's outline. At rest it blends in — and the strict pixel diff is **blind** to it when the background is pale (pale-on-pale, like a white margin on a white page) — but it rotates _with_ the part and reads as a hard-edged patch swinging behind it (a straight mask edge becomes a tell-tale parallelogram). You usually **can't just delete** the background path: a colour trace fuses the part's own same-coloured fill (a white palm) and the surrounding background into **one path** with the part as a hole, so dropping it removes the part's fill too. Instead **clip the moving `<g>` to the part's true silhouette** — the interior of its _own_ outline:
    - Build the silhouette by **flooding the exterior inward** from the canvas border through everything that is _not_ the part's dark outline; whatever the flood can't reach is the part (outline + enclosed fills). Trace that region's contour to a `<path>` (Moore-neighbour + Douglas–Peucker, as in `extract-blob.ts`).
    - The part is **open at its joint cut** (it was sliced there, so it has no outline along that edge) — **seal the joint edge first** by stroking a barrier along the mask's joint-side edge, or the flood pours through the cut and fills the whole part.
    - Apply it as `clip-path="url(#id)"` on the rotating group, with `clipPathUnits="userSpaceOnUse"`. The clip lives in the group's coordinate space, so it **rotates with the part** and stays aligned at every angle — cutting only the margin while every part path (palm fill, shading, linework) stays intact. Verify the clip survives minify (`cleanupIds:false`, so `#id` and the `url(#id)` ref aren't renamed apart).

    `scripts/src/png/hand-clip.ts` builds this clip for a waving hand: flood-fill from the hand's own outline, wrist cut sealed.

## Pinning the pivot (the `transform-origin` recipes)

SVG's default `transform-origin` is `0 0` of the **whole viewBox**, not the element's center — so an un-pinned `rotate()` orbits the canvas corner (the classic "why is it sliding, not waving" bug). Always pin explicitly. Three forms:

- **A — spin on its own center** (blink, twinkle, spin-in-place):
  ```css
  transform-box: fill-box;   /* rescope the origin to this element's own bbox */
  transform-origin: center;
  ```
- **B — hinge at a known joint coordinate** (an arm at the shoulder):
  ```css
  transform-box: view-box;            /* the default: origin in viewBox units */
  transform-origin: <jointX>px <jointY>px;   /* put it exactly on the joint */
  ```
- **C — SMIL / attribute form** (portable, survives in `<img>`/background contexts):
  ```xml
  <g transform="rotate(<angle> <cx> <cy>)">   <!-- pivot baked in -->
  ```
  `rotate(a cx cy)` _is_ `translate(cx cy) rotate(a) translate(-cx -cy)`. CSS's `rotate()` function does **not** take a center — use `transform-origin` there.

**Splitting a merged overlay into segments** (e.g. one arm trace into hand vs forearm): project each path's bbox centroid onto the limb axis — the sign of its dot product with the normalized proximal→distal joint vector (wrist→elbow) decides the side. Don't split on a flat horizontal line; limbs are diagonal.

## Rig in place when the part is already its own color

Eyes, pupils, sparkles, cheeks — anything traced as distinct paths — wrap in an animated `<g>` **without re-cutting the image**: classify paths by bbox-centroid into the feature's region and group them. No second trace, no seam, exact pixels. **Size-guard** the classification: a large path (the whole head/body) whose centroid happens to land in a small-feature box will get pulled on top and hide the art — reject hits above a size cap.

## Map to SVG (summary)

| Rigging concept | SVG realization |
| --- | --- |
| Part / layer (principle 1) | `<g id="forearm-l">` around that part's paths |
| Pivot at joint (principle 2) | `transform-origin` on the joint (recipe A/B/C) |
| Parenting / FK chain (principle 3) | physically nest the `<g>` inside its parent |
| Overlap (principle 4) | child-first document order + tuck-under art + round cap |

Once the rig passes the crux test, the motion layer (timing, easing, holds) is in `animation.md`.
