---
name: write-blog-post
description: Use when you want a new blog post for Joseph Sabag's portfolio, written in Joseph's voice. It adds the post to the blog data file and makes a matching cover image in ChatGPT. Say "write a post", "new blog post", or "post in my voice".
disable-model-invocation: true
---

# write-blog-post

Write a portfolio blog post that sounds like **Joseph (Yosef Hayim) Sabag** wrote it, add it to the site with one command, and give it a cover that matches the existing set — the same character, the same flat-2D editorial style.

This skill has three jobs, in order: **(1) draft in the voice → (2) scaffold into the data file → (3) generate the cover via ai-browser-bridge.** Do them in order; do not skip the cover.

## Where things live (portfolio repo)

Run this from the portfolio repo root. Key paths:

- Posts data (SSOT): `clientV3/src/data/blog.ts` — an array of `BlogPost` objects.
- Scaffolder: `scripts/dev/new-post.mjs` — appends a new post from flags (gitignored dev tool).
- Covers: `clientV3/public/blog/<slug>.png` (16:9).
- Likeness photo ("how I look"): `clientV3/public/images-of-me/hero-image.png`.
- ai-browser-bridge CLI: set `BRIDGE` to your local build (e.g. path to `ai-browser-bridge/dist/bridge.js`).

## The voice (non-negotiable)

Read 2–3 existing posts in `blog.ts` first to calibrate. The rules that make it sound like him:

- **First person, raw, honest, a little defiant.** He's a self-taught freelance AI engineer; ex-IDF, ex-security-guard. He earned it and it shows.
- **Short, punchy, declarative.** Fragments for emphasis. "That scared me more than the plastic chair ever did." Vary rhythm; never corporate.
- **Open with a hook or a confession**, not a preamble. First line earns the second.
- **Concrete specifics** — real tool names, real numbers, real projects (eBay MCP, ai-browser-bridge, agent-setup, planpage, Effect, SmallBites, Bolt ASINs, Predicto, IITC, Gdud 931). No vague "leveraging synergies."
- **Land one hard, quotable lesson at the end.** Every post pays off with a line worth screenshotting.
- **Em-dashes yes. Emojis never.** Sparing profanity is on-brand but rare (one, maybe, for impact).
- **~2–4 minute read.** Tight. Cut filler.
- **Markdown body**: `##`/`###` headings, fenced code blocks with a language, `[text](url)` links, `**bold**`, `*italic*`, inline `` `code` ``. The site renderer supports exactly these.

Categories: `engineering | career | tutorials | thoughts | projects`. Ask which if unclear; default `engineering`. Ask if it should be `featured` (pinned on the blog home).

## Step 1 — draft

1. If the user gave a title/theme + beats, use them. Otherwise ask for the theme, the key beats, category, and featured (a short `AskUserQuestion` is ideal — don't over-ask).
2. Write the full body as markdown in the voice above. Give it a real title and a one-line excerpt (the hook).
3. Save the body to a temp file so newlines/backticks survive the shell, e.g. `/tmp/post-<slug>.md`.

## Step 2 — scaffold into blog.ts

Drive the scaffolder (never hand-edit the array). It derives slug, reading time, and excerpt when omitted, and defaults the cover to `/blog/<slug>.png`:

```bash
node scripts/dev/new-post.mjs \
  --title="<title>" \
  --body-file=/tmp/post-<slug>.md \
  --date=$(date +%F) \
  --category=<engineering|career|tutorials|thoughts|projects> \
  --tags="tag one, tag two, tag three" \
  --excerpt="<one-line hook>" \
  --image=/blog/<slug>.png \
  --featured   # omit if not featured
```

It prints the id, slug, and the cover path to fill. Confirm the post reads well in `blog.ts`.

## Step 3 — generate the cover via ai-browser-bridge

The cover MUST match the existing set: **the same recurring character** (so it's clearly him across every post) and the **same flat-2D editorial style**. The way to keep the face consistent is to **attach the likeness photo and an existing cover as references** and continue the same ChatGPT image conversation when possible.

First, confirm the CLI surface (it changes across versions):

```bash
BRIDGE="${BRIDGE:?set BRIDGE to your ai-browser-bridge/dist/bridge.js}"
node "$BRIDGE" --help
node "$BRIDGE" ask --help        # confirm --attach, --images, --conversation, --timeout
node "$BRIDGE" chat --help       # to find/list an existing image conversation to continue
```

Prereq: quit normal Chrome first (bridge drives its own profile). If needed, `node "$BRIDGE" login` once.

Compose the prompt from four reusable blocks — keep STYLE/IDENTITY/DEVICES/NEG verbatim so the character and look stay identical; write only the SCENE fresh, derived from **what this post is about**:

- **SCENE** — one or two sentences that express the post's core idea as an image (e.g. a post about teaching the AI your taste → "he sits at his midnight-blue MacBook Air shaping a glowing floating rulebook/skill that a friendly AI robot reads from before writing code; calm sense of a craftsman setting the standard"). Derive it from the post text, not a template.
- **IDENTITY** — "The character is the SAME young man from the earlier images and reference photos in this conversation: warm olive Mediterranean skin, short dark curly hair faded on the sides, thick dark eyebrows, light stubble, and modern ROUND nerdy glasses, wearing an Apple Watch. Keep his face and round glasses identical."
- **DEVICES** — "Any laptop is a midnight-blue (dark navy) MacBook Air; any phone is an iPhone. Keep the devices consistent."
- **STYLE** — "Flat 2D minimal vector illustration, modern editorial style. Simple bold clean shapes, limited muted palette with a single emerald-green accent, generous negative space, soft flat shading, subtle grain. Cartoonish and friendly, NOT 3D, NOT photorealistic. Wide 16:9 composition."
- **NEG** — "Avoid random or garbled text and any watermark; only the specific brand logos requested may appear."

Attach the likeness photo ("how I look") **and** an existing cover as a style example, and ask for exactly one image:

```bash
node "$BRIDGE" ask "Generate exactly one image. <SCENE> <IDENTITY> <DEVICES> <STYLE> <NEG>" \
  --repo "${PORTFOLIO_REPO:?set PORTFOLIO_REPO to your portfolio checkout}" \
  --attach clientV3/public/images-of-me/hero-image.png clientV3/public/blog/agentic-workflows.png \
  --images 1 --timeout 300
```

Prefer continuing the existing cover conversation (`--conversation <idOrUrl>`) so the model already holds the character — attaching the refs again is safe and reinforces the likeness. Then download and place it:

```bash
node "$BRIDGE" download --json --out /tmp/cover-out
# pick the newest "Generated image" from the manifest, then normalize to PNG:
sips -s format png "/tmp/cover-out/<generated>.png" --out clientV3/public/blog/<slug>.png
```

Confirm `clientV3/public/blog/<slug>.png` exists and reads as the same character + style as the others.

## Step 4 — verify

- Post object is well-formed in `blog.ts`; cover path matches `coverImage`.
- Optional: `cd clientV3 && pnpm lint` (biome) so formatting matches the repo.
- Report the new slug, category, featured flag, and the cover path to the user.

## Guardrails

- Reference `scripts/generate-blog-covers.sh` in the portfolio for the proven bridge invocation and the exact character/style blocks — reuse them; don't reinvent.
- One cover per post, 16:9, the recurring character, flat-2D emerald-accent style. If the face drifts, re-run with the refs re-attached (or continue the same conversation).
- Never invent stats or projects. If a fact isn't given or in the repo, ask or leave it out.
