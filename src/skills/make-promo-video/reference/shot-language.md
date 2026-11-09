# Shot language & prompt scheme

The vocabulary the storyboard and every image/motion prompt is written in. The goal is a cut that reads as directed, not assembled.

## The viral-trailer structure (15–30s, 9:16)

A social trailer is not a demo — it is a **feeling delivered in three moves**, hook-first because most of the audience is gone by second 3.

| Beat | Time | Job | Feel |
| --- | --- | --- | --- |
| **Hook** | 0–2s | The pattern-break. State the pain or the impossible promise, hard. No logo, no preamble. | tension / curiosity |
| **Stakes** | 2–6s | Twist the knife — show the world *without* the thing. The status quo hurts. | frustration |
| **Turn** | 6–14s | The thing appears. First real product moment / the transformation begins. | relief / momentum |
| **Payoff** | 14–24s | The win, escalating. Real screenshots or the hero-shot of the product working. | awe / desire |
| **CTA** | 24–30s | Logo + one line + where to go. The only place the brand name lands. | resolve |

Every scene owes a **caption** (social is watched muted) and a **VO line** or a beat of silence. Cut on the music, not the clock.

## Shot vocabulary (put these in the storyboard `shot` field)

- **Size** — extreme wide (ECU establishing the world) · wide · medium · close-up (emotion) · extreme close-up (a detail: eyes, a cursor, a metric ticking).
- **Angle** — eye-level (neutral) · low (hero, power) · high (vulnerable, small) · dutch tilt (unease) · over-the-shoulder (POV into a screen).
- **Camera move** — locked (stillness, gravity) · slow push-in (rising tension → the reveal) · pull-out (context, "it's bigger than you thought") · whip-pan / crash-zoom (energy, act breaks) · parallax dolly (depth). *For AI motion, one clear move per shot beats a busy one.*
- **Lens / depth** — shallow depth of field for the hero; deep focus for the product-working payoff.
- **Lighting** — low-key + rim light for the stakes (problem), warming to bright key light at the turn/payoff (the emotional arc *is* the lighting arc).
- **Pace** — long holds (3–4s) in hook/stakes; quick cuts (0.6–1.2s) in the payoff montage. Accelerate into the CTA.

## Directing the human (hybrid mode)

When there's a protagonist, the storyboard's `expression` + `pose` fields carry the arc: **weary/frustrated → a flicker of doubt → focused → quiet confidence → open, energized**. Keep it one recognizable person. Environments track the arc too: cramped/dim → opening up → clean, luminous.

## The prompt-block scheme (reused from write-blog-post, extended for motion)

Compose every image prompt from fixed blocks so the look never drifts. Keep IDENTITY / STYLE / NEG **verbatim** across a build; write only SCENE and MOTION fresh per shot.

- **SCENE** — one or two sentences of *this beat* as a single frame (subject + action + environment + emotion). Derived from the storyboard, never a template.
- **IDENTITY** — the recurring hero, fixed traits ("the SAME person from the attached reference: …"). Omit in fully-cinematic product builds; there use a fixed **style anchor** instead.
- **STYLE** — the look bible: medium (cinematic photoreal / stylized 3D / flat editorial), palette, grain/film stock, aspect "vertical 9:16 composition". Identical every shot.
- **MOTION** (for `clip` scenes) — the one camera/subject move for the animator: e.g. "slow 8-second push-in, subject still, subtle atmospheric drift; no cuts, no text."
- **NEG** — "avoid garbled text or watermarks; only the specific brand logo requested may appear; no extra limbs/faces."

**Batch form (step 6):** `"Generate exactly N images, numbered 1–N, one per scene, all matching the attached style + character reference. Scene 1: <SCENE1>. Scene 2: <SCENE2>. …"` — then attach the bible image and verify N tiles came back.

## Music & audio direction (cue-sheet fields)

- One musical idea, arced: sparse/tense under hook–stakes → a lift at the turn → full at the payoff → a resolved sting on the logo. Note **BPM** and **mood** (epic / warm / tense / playful) per section.
- VO: pick one voice for the build; short declarative lines that land on the cut. Silence is a legitimate cue — leave room for a music swell at the reveal.
- SFX punctuate act breaks (a riser into the turn, an impact on the logo). Keep them original.
