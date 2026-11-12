---
name: make-promo-video
description: Use when you want a short promo video for a project (LinkedIn, YouTube, Instagram, TikTok). It writes the story from the repo, makes and animates the images, adds voice and music, and cuts a version for each app. You approve the plan two times. Say "make a trailer", "promo video", or "launch video".
effort: high
disable-model-invocation: true
---

# make-promo-video

Point this at any project and it ships a cinematic vertical trailer for social — you approve **twice** (a static animatic, then the motion cut), everything else runs hands-free.

## Ground rule

**One character, one world, two gates.** A trailer reads as *professional* when the face, style, and world stay identical across every scene and the whole cut lands one feeling — not when each frame is individually pretty. So: **lock a style + character bible before generating anything**, drive every image and clip from it, and record every job in a **resumable manifest** so a dead render resumes instead of re-spending credits. Claude directs; ChatGPT writes + draws; Higgsfield/Flow/Seedance move; ffmpeg cuts. Never claim a step ran that didn't — the manifest is the truth.

**Static-first — see the whole trailer before you buy a single motion clip.** Motion is the one expensive, slow step. So assemble every keyframe into a held-still **animatic** (each beat ≈1s, blurred-fill so no wide action is cropped, under a scratch music bed), watch it end-to-end, and lock order + pacing + continuity *there*. Only approved scenes ever get animated — this is what makes it cleaner (bad beats die on cheap stills) and faster (no re-rendering motion you cut).

**Two browsers beat one.** Generate the keyframes across two ChatGPT accounts in parallel — Chrome on one CDP port, Brave on another — one bible-anchored conversation per browser, the scene list split zigzag between them. ~2× throughput, and each lane stays on-model.

## Engines (who does what)

| Job | Engine | How |
| --- | --- | --- |
| Story, transcript, storyboard, **keyframes** | **ChatGPT** (GPT-5.5 Thinking) via `ai-browser-bridge` | `bridge ask` (text) + `bridge ask --images` / `bridge download` (stills) — **two browsers in parallel** |
| Motion (per scene) | **Higgsfield** `generate_video`, **Flow/Veo** `bridge ask --provider flow`, *or* **Seedance** when it's cheaper for the quality | the storyboard tags each scene's engine + budget; only run after Gate 1 |
| Voiceover + music | **ElevenLabs → Higgsfield → local synth** (fallback chain) | `reference/pipeline.md` → Audio |
| Virality check | **Higgsfield** `virality_predictor` | scored at Gate 2 |
| Assemble animatic, cut, caption, master, reframe | **ffmpeg** | `scripts/assemble-cut.mjs` (`--mode animatic\|rough\|final`), `scripts/reframe.mjs` |
| Approval gates | **planpage** | **static animatic** + motion rough-cut review |

`ai-browser-bridge` CLI: set `BRIDGE` to your local build (e.g. path to `ai-browser-bridge/dist/bridge.js`). Exact commands, the manifest schema, and the audio chain live in **`reference/pipeline.md`**; cinematic shot/prompt vocabulary in **`reference/shot-language.md`**. ChatGPT & Gemini can *play* video/audio in-UI but the bridge has no export path for either — that's a v2 bridge change, not this skill.

## Preflight (once per machine / session)

```bash
BRIDGE="${BRIDGE:?set BRIDGE to your ai-browser-bridge/dist/bridge.js}"
# quit your normal Chrome first — the bridge drives its own profile
node "$BRIDGE" chrome start --provider chatgpt   # then sign in once
node "$BRIDGE" ask --help                         # confirm --model --attach --images --conversation --timeout
which ffmpeg ffprobe                               # required (an ffmpeg built with libass burns captions; else a .srt sidecar is written)
# Higgsfield MCP must be connected; ELEVENLABS_API_KEY optional (else the chain falls back to Higgsfield)
```

## The pipeline

Everything is autonomous except the two 🚦 gates (steps 7 and 11). The storyboard is *realized* as the animatic, so the first thing you approve is the whole trailer on stills — not a text sheet.

1. **Ingest.** Read the target project's `AGENTS.md` / `README.md` / `CONTEXT.md` / `package.json` → derive purpose, audience, the pain it kills, the win. Inventory screenshots (`public/`, `docs/`, `assets/`, `screenshots/`, `.github/`, README image refs).
2. **Creative mode (auto).** Usable screenshots found → **hybrid narrative** (story beats + real screenshots at the reveal). None → **fully cinematic** (all AI scenes). Record it in the manifest.
3. **Consult + storyboard.** Claude ↔ ChatGPT: draft the transcript/VO → critique → refine (2–3 rounds), then have ChatGPT produce the storyboard (per scene: shot, expression, pose, environment, dramatic beat, music cue, VO line, **motion engine**, source = ai/screenshot) **and** one annotated storyboard sheet with chat bubbles. Write it all into `manifest.json` via `scripts/manifest.mjs`. No gate here — the storyboard proves itself at Gate 1 as real images.
4. **Lock the bible.** One ChatGPT generation of the style + hero-character reference; save its image + conversation id in the manifest. Every later image attaches it **and** appends the bible text (image + text together stop drift).
5. **Keyframes — two browsers in parallel.** Split the scene list zigzag across two ChatGPT accounts (Chrome on one CDP port, Brave on another), one bible-anchored conversation per browser. Batch **up to 10 per prompt**, explicitly numbered ("exactly 10 images, numbered 1–10, one per scene, all matching the attached refs"). After `bridge download --json`, **verify the tile count and re-roll only the missing/off indices**. Screenshot scenes skip generation. **Resumable**: skip any still already on disk, so a re-run only fills gaps. (→ `reference/pipeline.md`)
6. **Assemble the static animatic.** `node scripts/assemble-cut.mjs --manifest <dir>/manifest.json --mode animatic --out <dir>/build/animatic.mp4` — every keyframe held for its beat (blurred-fill, scratch music from `synth.mjs`), no motion, no captions. This is the entire trailer, watchable, for **zero motion credits**.
7. 🚦 **Gate 1 — static animatic.** planpage: the user watches the full held-stills cut end-to-end and approves order / pacing / continuity, or flags scenes to re-roll (loop back to 5 for only those). **No motion is generated before this.**
8. **Motion (approved scenes only).** Per scene `motionEngine`: **Higgsfield** `generate_image`→`generate_video`, **Flow/Veo** (`bridge ask --provider flow` → `bridge flow download`), or **Seedance** when it is cheaper for the quality (pick via Higgsfield `models_explore`). Poll `job_status`; write each clip path + job id to the manifest as it lands (**resumable** — a rerun skips `done` scenes). Scenes left as `kenburns` get their motion in ffmpeg.
9. **Audio.** Voiceover from the chain (ElevenLabs → Higgsfield → none); final music bed from the chain (ElevenLabs Music → Higgsfield `generate_audio` → `scripts/synth.mjs`). Match the cue sheet; paths → manifest.
10. **Rough cut + score.** `node scripts/assemble-cut.mjs --manifest <dir>/manifest.json --mode rough --out <dir>/build/rough.mp4`, then Higgsfield `virality_predictor` on it.
11. 🚦 **Gate 2 — rough cut.** planpage before/after: the assembled motion preview + per-scene clips + the virality score; the user approves or flags scenes to regen (loop back to 8 for only those).
12. **Master + variants.** `assemble-cut.mjs --mode final` (burn captions — needs an ffmpeg with libass, else a `.srt` sidecar is emitted; mix VO over ducked music; loudnorm to **−14 LUFS / ≤ −1 dBTP**) → 9:16 master; then `scripts/reframe.mjs` derives 16:9, 1:1, 4:5. Report every output path.

## Output layout

```
<project>/marketing/make-promo-video/v<N>/
  manifest.json            # tracked — the resumable plan + job ledger
  storyboard.md            # tracked
  build/                   # git-ignored — stills, animatic.mp4 (Gate 1), clips, audio, cuts, variants
```

**New run = new `v<N>` folder — never overwrite a prior trailer.** Add `build/` (and any media) to the project's `.gitignore`.

## Guardrails

- **Static animatic before any motion.** Motion is the only slow, paid step — never generate a clip until the held-stills animatic (step 6) is approved. It catches pacing, order, and continuity problems for zero motion credits, and stops you re-rendering motion for a beat you end up cutting.
- **Two browsers, not one.** Generate keyframes across two ChatGPT accounts (Chrome + Brave) in parallel, one bible-anchored conversation per browser — ~2× faster and each lane stays on-model. Don't click inside an automated window mid-run (a composer focus-orb overlay can intercept the send button; open a fresh conversation to clear it).
- **Blurred-fill, never center-crop wide action.** Fitting a 16:9 frame into 9:16 by cropping slices characters off the edges; the animatic and `reframe.mjs` use a darkened blurred fill so the whole composition survives.
- **Never model-process a logo** and never alter on-screen product/brand spelling — composite real logos in ffmpeg, don't regenerate them.
- **No imitation** of a real person, celebrity voice, composer, song, game, or film. Original audio only; the chain is royalty-free by construction.
- **Consistency or redo.** If the hero's face/style drifts, re-attach the bible **and re-append its text** (or regenerate only the off scenes) — don't ship a cut where the character changes.
- **The manifest is the source of truth.** Mark a scene `done` only after its file exists on disk. Report skipped/failed steps plainly.
- **Media stays git-ignored and local.** Trailers are large and per-project private until the user posts them.

## Files

- `reference/pipeline.md` — exact `bridge` commands, manifest schema, audio provider chain, Higgsfield calls, ffmpeg recipes, planpage gate payloads
- `reference/shot-language.md` — the viral-trailer structure, shot/camera/lighting vocabulary, and the SCENE/IDENTITY/STYLE/MOTION/NEG prompt-block scheme
- `scripts/manifest.mjs` — create/query/patch the resumable generation manifest (zero-dep)
- `scripts/assemble-cut.mjs` — ffmpeg: `--mode animatic` (held stills, blurred-fill, scratch music — the Gate 1 cut) · `--mode rough`/`final` (clips or Ken-Burns stills + captions + ducked VO/music)
- `scripts/reframe.mjs` — ffmpeg: derive 16:9 / 1:1 / 4:5 platform cuts from the 9:16 master
- `scripts/synth.mjs` — zero-dep local music-bed fallback (WAV) when no ElevenLabs / Higgsfield audio
