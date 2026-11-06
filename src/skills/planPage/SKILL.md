---
name: plan-page
description: Use when a skill needs to show a plan, an approval step, or a report as an interactive web page. You approve or change choices in the browser, and your answer goes back to the agent. It uses the planpage package. Say "show the plan as a page" or "approval page".
---

# plan-page — interactive HTML plans for skills

Like `mcp-ui`, but for terminal skills. This skill is a **thin consumer of the open-source [`planpage`](https://github.com/YosefHayim/planpage) package** (on npm — `npm i planpage`, or zero-install with `npx planpage`). The components, the render engine, the auto-captured gallery, and the post-back server all live there as the single source of truth. Don't hand-roll HTML here; author with the package.

## What the package gives you

- **Components** — `SectionCard`, `PickBlock`, `DiffBlock`, `TreePanel`, `Flow`, `CodeBlock`, `CodeExplorer` (IDE-style file tree + editor pane, per-file before/after), plus plan-native pieces: `Callout`, `RiskList`, `Steps`, `Timeline`, `OptionCompare`, `PlanSummary`, `Accordion`, `AnnotatedCode`. Browse them live: `npx planpage library --open`.
- **Templates** — `plan-brief` (a whole agent plan on one page), `before-after`, `code-style-plan` (its `canonical` takes either a single `code` snippet or a multi-file `files` list → the `CodeExplorer`), `library`.
- **`render()` / `renderHighlighted()`** — `render(<Template {...data} />)` → a self-contained HTML string (Tailwind + Mermaid from CDN, light/dark theme). `await renderHighlighted(…)` also bakes in **real VSCode syntax colour** (Shiki, TS/JS-first) at render time — no CDN, no client JS to read colour. `npx planpage render …` highlights for you.
- **`serve`** — a never-hang post-back server (OS-assigned ephemeral port 49152+, idle timeout, `file://` + clipboard fallback) that collects one `Decision`.

## Sketch plans and wireframes (the default for plans)

Show every plan as a sketch plan: hand-drawn pages, one picture per page, short notes tied to their part, and a last "Your call" page with options A, B and C.

```bash
npx planpage recipes                     # list the 80 recipes (flows, systems, data, screens, account, product...)
npx planpage recipes login-screen        # print one recipe's scene as JSON to copy and change
npx planpage parts                       # list the 192 hand-drawn UI parts (sk-button, sk-input, sk-phone...)
npx planpage parts sk-table              # print one part's example HTML
npx planpage render sketch-plan --data plan.json --out <scratchpad>/plan.html
npx planpage serve <scratchpad>/plan.html <scratchpad>/decision.json --timeout 3600
npx planpage render sketch-kit --sample --out <scratchpad>/kit.html   # see every part drawn
```

- **Start from a recipe.** Pick the closest one, copy its `scene`, change the words. Full app screens (log in, sign up, paywall, settings, dashboard, checkout, pricing, AI chat, search, landing...) are ready as the `account` and `product` recipes.
- **Wireframes only when asked.** A normal plan uses flow, file, data, system and decision pictures. Draw a screen wireframe (or use the `account` / `product` / `screens` recipes) only when the person asks for a wireframe, mockup or screen sketch.
- **Wireframes** are scene nodes of kind `screen` (`{ id, kind: "screen", x, y, w, h, html }`). Lay out with Tailwind inside one device frame (`sk-phone`, `sk-browser-window`, `sk-terminal-window`), put `sk-*` parts inside, and give a part `data-part="name"` so a note can point at it with `link: "<screenId>#name"`.
- **The decision** for a sketch plan is `{ approved, choice, notes }`, where `choice` is the letter picked.
- The style guide, scene format and full recipe list: `skills/planpage/SKETCH-STYLE.md` in the package.

## Quick start (how a skill uses it)

1. **Assemble** the page from the package's components (or a whole template):
   ```tsx
   import { render, PlanBrief } from "planpage";
   const html = render(<PlanBrief title="…" steps={/* … */} risks={/* … */} />);
   ```
   or straight from the CLI: `npx planpage render plan-brief --data plan.json`.
2. **Write** it to the OS temp dir (`$TMPDIR/<name>-<timestamp>.html`) — nothing lands in the repo.
3. **Serve + collect** the decision on a safe ephemeral port:
   ```bash
   npx planpage serve <html-path> <decision-out.json> --timeout 600
   ```
   It prints the local URL, opens the browser, and blocks until the user clicks **Approve** / **Adjust** (or the idle timeout fires), then writes the decision JSON and exits `0`.
4. **Read** `<decision-out.json>` and act on it.

**Fallback — never hang.** Headless / no Node / port blocked → `open` the file directly (`file://`); the page's **Copy decision** button puts the same JSON (base64) on the clipboard to paste back. A non-TTY caller always has a decision path.

## The decision contract

The page posts one JSON object; the server writes it verbatim to the out-path:

```json
{ "approved": true, "flips": ["rule.function-form"], "revisit": ["rule.error-shape"], "notes": "keep classes only in the DB layer" }
```

- **`approved`** — Approve (`true`) vs Adjust (`false`).
- **`flips`** — `data-id`s of `PickBlock`s the user flipped (chosen ↔ rejected). Re-open the grill on these.
- **`revisit`** — `data-id`s marked "revisit" without a firm decision.
- **`notes`** — free text from the notes box.

Every interactive component carries a stable `data-id`; that id is what appears in `flips` / `revisit`. Name ids meaningfully (`rule.error-shape`, `move.orders-dir`) so a bare id tells you what to re-open.

## Rules

- **The package owns the HTML; the skill owns the content.** Reference `planpage` and plug in content — don't re-derive the shell. When a report needs a new widget, add it to the package (with a gallery entry) so every skill inherits it.
- **Self-contained.** No repo assets, no build step at render time; Tailwind + Mermaid from CDN, and syntax colour baked into the HTML by Shiki (no CDN, no client JS).
- **Never block a script.** `serve` carries an idle timeout; the fallback is copy-paste. A headless / non-TTY caller must still reach a decision.
- **Installing the package adds no skills.** `npx planpage init` scaffolds one ready `render-plan` skill (wired to `npx planpage`) into `.claude/skills/` — ship that to end users; the package itself is just the engine.
