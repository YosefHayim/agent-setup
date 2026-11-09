# Pipeline runbook

Exact commands, schemas, and recipes for each step in `SKILL.md`. `BRIDGE="${BRIDGE:?set BRIDGE to your ai-browser-bridge/dist/bridge.js}"`. Always confirm the live CLI surface first — flags shift across bridge versions:

```bash
node "$BRIDGE" --help && node "$BRIDGE" ask --help && node "$BRIDGE" download --help
```

## Consult + write (steps 3)

Text turns go through the bridge with the model pinned. There is no "GPT-5.6" — the top picker labels are **GPT-5.5 Thinking** (use this for creative reasoning) and **GPT-5.5 Pro**.

```bash
node "$BRIDGE" ask "You are a trailer director. Here is the project brief: <BRIEF>. \
Propose a 20-second vertical trailer transcript (hook/stakes/turn/payoff/CTA) with a VO line per beat." \
  --provider chatgpt --model "GPT-5.5 Thinking" --json --timeout 300
```

Continue the SAME conversation for the critique rounds and the storyboard (`--conversation <idOrUrl>` — get it from `node "$BRIDGE" chat list`). Ask ChatGPT for the storyboard as **strict JSON** matching the `scenes` schema below plus one annotated contact-sheet image (chat bubbles) via `--images 1`.

## The manifest (SSOT for the build)

`scripts/manifest.mjs` owns the schema; the agent patches it as jobs land. Shape:

```jsonc
{
  "version": 1,
  "project": "vybekiit",
  "format": { "aspect": "9:16", "fps": 30, "width": 1080, "height": 1920, "targetSeconds": 24 },
  "creativeMode": "hybrid",              // hybrid | cinematic
  "conversation": "<chatgpt id/url>",    // holds the style bible
  "style": { "bibleImage": "build/bible.png", "refs": ["build/bible.png"] },
  "audio": { "voPath": null, "musicPath": null, "voice": null, "voProvider": null, "musicProvider": null },
  "scenes": [{
    "id": "s01", "order": 1, "beat": "hook", "durationSec": 2.5,
    "shot": "slow push-in, low angle, shallow DOF",
    "voLine": "You shipped it. Nobody came.",
    "caption": "You shipped it. Nobody came.",
    "musicCue": "sparse sub + ticking, tense, 90bpm",
    "source": "ai",                      // ai | screenshot
    "screenshot": null,                  // path when source=screenshot
    "motion": "clip",                    // clip | kenburns
    "motionEngine": "higgsfield",        // higgsfield | flow  (when motion=clip)
    "stillPath": null, "stillStatus": "pending",
    "clipPath": null, "clipJobId": null, "clipStatus": "pending"
  }],
  "variants": []
}
```

```bash
node scripts/manifest.mjs init  --dir <dir> --project <name> --seconds 24
node scripts/manifest.mjs show  --dir <dir>
node scripts/manifest.mjs pending-stills --dir <dir>   # ids still to generate
node scripts/manifest.mjs pending-clips  --dir <dir>
node scripts/manifest.mjs set   --dir <dir> --id s01 --key stillStatus --value done
node scripts/manifest.mjs set   --dir <dir> --id s01 --key clipPath --value build/clips/s01.mp4
```

`set` writes atomically and re-reads, so it is safe to resume after a crash: re-run the phase and only `pending-*` scenes get regenerated.

## Keyframes (step 5)

```bash
# Lock the bible first (one image), then batch the scenes in the same conversation:
node "$BRIDGE" ask "Generate exactly 10 images, numbered 1-10, one per scene, all matching the \
attached style + character reference. Scene 1: <SCENE1>. ... Scene 10: <SCENE10>." \
  --provider chatgpt --conversation <id> --attach build/bible.png --images 10 --timeout 300
node "$BRIDGE" download --json --out <dir>/build/stills
```

`download --json` prints `[{ id, path, bytes }]` and writes a `manifest.json` (the bridge's own, per conversation) listing every attachment with `id: "image-1"`, `role: "assistant"`. Map the newest N assistant images to scenes in order. **Verify count**: if fewer than N tiles returned, re-ask in the same conversation for only the missing indices ("regenerate images 4 and 7 only, same style"). Normalize to PNG if needed: `sips -s format png in.webp --out s04.png`.

### Two browsers in parallel (the fast path)

Two ChatGPT accounts halve wall-clock. Run two lanes, one per browser app, each on its own CDP port and profile:

| Lane | App env | CDP port | Profile |
| --- | --- | --- | --- |
| A | `AI_BROWSER_BRIDGE_CHROME_APP="Google Chrome"` | `9222` | default bridge profile (`--profile ""`) |
| B | `AI_BROWSER_BRIDGE_CHROME_APP="Brave Browser"` | `9223` | a cloned profile, e.g. `~/.ai-browser-bridge/chrome-profile-parallel` |

Split the scene list **zigzag** (even → A, odd → B). Each lane opens ONE bible-anchored conversation and continues in it with `--conversation <id>` for its remaining scenes. Skip any still already on disk so a re-run only fills gaps. Sketch:

```bash
# one lane = one browser generating its half in a single bible-anchored conversation
gen_lane() {  # $1=app  $2=port  $3=profile  $4..=scene ids
  local app="$1" port="$2" profile="$3"; shift 3
  local cid=""
  for n in "$@"; do
    [ -s "build/stills/s$n.png" ] && continue                     # resumable: skip finished
    if [ -z "$cid" ]; then
      AI_BROWSER_BRIDGE_CHROME_APP="$app" node "$BRIDGE" ask "$(cat prompts/s$n.txt)" \
        --provider chatgpt --port "$port" --profile "$profile" \
        --attach build/bible.png --images 1 --fresh --timeout 420 --json > ".ask.$n"
      cid=$(sed -n 's/.*"conversationId":"\([^"]*\)".*/\1/p' ".ask.$n")   # raw shape: {"conversationId":"..."}
    else
      AI_BROWSER_BRIDGE_CHROME_APP="$app" node "$BRIDGE" ask "$(cat prompts/s$n.txt)" \
        --provider chatgpt --port "$port" --conversation "$cid" --images 1 --timeout 420 --json > ".ask.$n"
    fi
    node "$BRIDGE" download --json --out build/stills               # then rename the newest → s$n.png
  done
}
gen_lane "Google Chrome" 9222 ""                                            s01 s03 s05 s07 s09 &
gen_lane "Brave Browser" 9223 ~/.ai-browser-bridge/chrome-profile-parallel  s02 s04 s06 s08 s10 &
wait
```

Confirm the live flags first (`node "$BRIDGE" ask --help`) — port/profile/app-target names shift across bridge versions. **Don't click inside an automated window while it runs**: focusing the composer can raise a floating "orb" overlay that intercepts the send button; opening a fresh conversation clears it.

### Keep every scene on-model (the lock footer)

Attach the bible image **and append the full character/world bible text to the end of every scene prompt** — on first generation and especially on re-rolls. The image alone sometimes drifts; image + text together hold face, colours, and silhouette. Keep the bible text in one file and `cat` it onto each prompt so it is byte-identical everywhere (SSOT).

## Static animatic (step 6) — the Gate 1 cut

Assemble every keyframe into a held-still trailer and watch the whole thing before buying any motion:

```bash
# scratch music bed for pacing (no key, no credits) — set audio.musicPath to it in the manifest
node scripts/synth.mjs --out <dir>/build/audio/scratch.wav --seconds <total> --bpm 100 --mood epic
node scripts/assemble-cut.mjs --manifest <dir>/manifest.json --mode animatic --out <dir>/build/animatic.mp4
# quick uniform pass instead of storyboard pacing: add --hold 1
```

`--mode animatic` holds each scene's STILL for its `durationSec` (or `--hold <sec>` for a uniform beat), frames it **blurred-fill** (a darkened, blurred copy of the frame fills the 9:16 canvas while the whole 16:9 frame sits sharp and centred — no wide action cropped), lays the scratch bed under it, and skips motion, captions, and loudnorm. It uses only core ffmpeg filters (`split`/`boxblur`/`eq`/`overlay`) — **no `zoompan`, `drawtext`, or `libass`** — so it runs on a stock mac ffmpeg where the Ken-Burns/caption path can't. This mp4 is the Gate 1 artifact; re-roll flagged scenes (loop to step 5) and rebuild until the story lands, then move to motion.

## Motion (step 8) — after Gate 1 only

## Motion (step 7)

Per scene `motionEngine`:

- **Higgsfield** — `generate_image` (if you want Higgsfield to restyle the still) → `generate_video` with the still as the first frame + the MOTION line as the prompt; poll `job_status` until `completed`; download the mp4 to `build/clips/<id>.mp4`. Recommended for hero/complex shots.
- **Flow/Veo (image-to-video)** — `node "$BRIDGE" flow generate --start build/stills/<id>.png --prompt "<MOTION prompt>" --out <dir>/build/clips --json`. One command drives Flow's new Frames UI end to end: Agent→Frames mode, drops the still into the Start slot, types the prompt, presses Create, polls the render, and downloads the mp4 (prints `{id,url,file}`; rename `file` → `<id>.mp4`). Native Veo audio comes baked in. Do NOT use `ask --provider flow` for motion — that targets the old text-composer UI and silently no-ops on the Frames studio. Set the project's Video default (Veo 3.1 Fast/Quality, aspect, count) once in Flow's *tune Settings* first; it persists on the project but resets if you reload the canvas. Needs a Google AI Pro/Ultra plan; ~1–2 min/clip. `flow_generate` is the same op as an outbound MCP tool.
- **Seedance** — when you want higher quality per credit than Flow/Higgsfield, check for a Seedance-class model via Higgsfield `models_explore` (`action:'recommend'` with the shot's goal), then drive it with `generate_video` (still as the first frame + the MOTION line). Set the scene's `motionEngine` to `seedance` and record the credit cost so the budget stays auditable. Confirm the exact model id from `models_explore` — don't hardcode one.

Write `clipPath` + `clipStatus=done` (or `clipJobId` + `queued`) to the manifest as each lands. Scenes with `motion: "kenburns"` need no clip — ffmpeg animates the still.

## Audio (step 9) — the fallback chain

Resolve each of VO and music down the chain; record which provider won in `audio.*Provider`.

1. **ElevenLabs** (best voice + music) — used when `ELEVENLABS_API_KEY` is set. Via its MCP if connected, else REST:
   ```bash
   # voiceover
   curl -s -X POST "https://api.elevenlabs.io/v1/text-to-speech/<voice_id>?output_format=mp3_44100_128" \
     -H "xi-api-key: $ELEVENLABS_API_KEY" -H "content-type: application/json" \
     -d '{"text":"<full VO script>","model_id":"eleven_multilingual_v2"}' -o <dir>/build/audio/vo.mp3
   # music: POST https://api.elevenlabs.io/v1/music  (prompt = cue-sheet mood + total ms)
   ```
2. **Higgsfield** — `create_voice` / `generate_audio` for VO; `generate_audio` for the music bed (prompt from the cue sheet). Always available (MCP), no key.
3. **Local synth** (music only, no key, no credits): `node scripts/synth.mjs --out <dir>/build/audio/music.wav --seconds 24 --bpm 100 --mood epic`.

Produce ONE continuous VO track and ONE music bed spanning the whole trailer; `assemble-cut.mjs` handles ducking + timing.

## Assemble, master, reframe (steps 10 & 12)

```bash
# rough cut — fast, no captions, no loudnorm
node scripts/assemble-cut.mjs --manifest <dir>/manifest.json --mode rough --out <dir>/build/rough.mp4
# final — Ken-Burns stills, burned captions, VO ducked over music, loudnorm -14 LUFS / -1 dBTP
node scripts/assemble-cut.mjs --manifest <dir>/manifest.json --mode final --out <dir>/build/master-9x16.mp4
# platform cuts from the 9:16 master (blurred-fill reframe)
node scripts/reframe.mjs --in <dir>/build/master-9x16.mp4 --all --outdir <dir>/build
```

`assemble-cut.mjs` uses each scene's `clipPath` when present, else Ken-Burns on `stillPath` (or `screenshot`), concatenates in `order`, burns `caption` text in final mode, and mixes `audio.voPath` over a sidechain-ducked `audio.musicPath`. Caption burn-in needs an ffmpeg built with **libass**; without it the script writes a `<out>.srt` sidecar (upload it as the platform caption track) and warns. It fails loudly if a referenced media file is missing — fix the manifest, don't ship a gap.

## Gates (planpage)

Use the **plan-page** skill for both. Gate 1 payload: the **`animatic.mp4`** (the whole trailer as held stills over a scratch bed, watchable end-to-end) + the scene table (all fields) + the annotated sheet, with per-scene re-roll toggles and an Approve action — the user signs off story, order, and pacing on cheap stills before any motion spend. Gate 2 payload: the `rough.mp4` preview + a grid of per-scene clips + the `virality_predictor` score/notes, with "approve" or per-scene "regenerate" flags that map back to scene ids. Only these two moments block; everything else is autonomous.
