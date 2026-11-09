# plan-page skill — components live in the `planpage` package

The copy-paste HTML kit that used to live here has been **retired**. The components, theme, and post-back script are now the open-source [`planpage`](https://github.com/YosefHayim/planpage) package — one source of truth: typed, tested, and shown in a live gallery.

- **See every component live** — `npx planpage library --open` (preview + usage + props table for each).
- **Author a page** — `import { render, SectionCard, PickBlock, Callout, Steps, OptionCompare, … } from "planpage"`, or `npx planpage render <template> --data data.json` (`--sample` for demo data).
- **Collect a decision** — `npx planpage serve <html> <out>`.

The full component list, the plan-native pieces (`Callout` · `RiskList` · `Steps` · `Timeline` · `OptionCompare` · `PlanSummary` · `Accordion` · `AnnotatedCode` · `CodeExplorer`), the `render()`/`renderHighlighted()`/`serve` API, and the recipes live in the package's `README.md`. The decision contract and `data-id` conventions are unchanged — see [SKILL.md](SKILL.md).

**Code, in colour.** Every code component (`CodeBlock` · `DiffBlock` · `AnnotatedCode` · `CodeExplorer` · `QuestionCard` previews) is syntax-highlighted with real VSCode themes (Shiki) at render time — colour is baked into the HTML, no CDN, no client JS. `CodeExplorer` renders a multi-file canonical example as an IDE-style file tree + editor pane with a per-file before/after toggle; `CodeStylePlan`'s `canonical.files` feeds it. Author with `renderHighlighted()` (or `npx planpage render`) to get the colour; bare `render()` leaves a readable monochrome fallback.
