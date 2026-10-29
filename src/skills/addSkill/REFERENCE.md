# Add skill — reference

## Question bank

Ask only what the description and exploration left open. Offer concrete options with a recommendation, not open-ended prompts.

| Topic | Question | Lands in |
|---|---|---|
| Triggers | What would you say to start it? Give 2–3 phrases. | description `Say "…"` |
| Hand-offs | What is close to this but belongs to another skill? | description "For X, use Y" |
| Input | What does it start from — a repo, a file, a URL, a past session, nothing? | Workflow step 1 |
| Done | What exists when it is finished — a file, a PR, a report, a running app? | Verification |
| Never | What must it never do without asking — work on main, deploy, delete, merge, spend money, message people, touch secrets? | Safety |
| Questions | Does it ask questions as it goes, or run alone after one approval? | Workflow gates |
| Edits | Does it change files, or only advise? | Safety, Workflow |
| Scope | One file, one feature, a whole repo, or many repos? | Workflow |
| Platform | Any OS, macOS only, or macOS + Ghostty? | catalog `platform` |
| Extra files | Does it need scripts, templates, or reference docs next to `SKILL.md`? | catalog `shippedPaths` |
| Siblings | Which existing skills does it use or hand off to? | catalog `dependencies`, Workflow |
| Proof | How will we both know it worked? | Verification |
| Name | Offer 2–3 ids: plain verb + noun, kebab-case, like `add-mcp-server`. | `id`, `name` |

## Proposal

Fill this in and show it before writing anything.

```markdown
## Proposed skill: <id>

| Field | Value |
|---|---|
| id / `name` | <kebab-case> |
| sourceDirectory | <camelCase> (the folder name under `src/skills/`) |
| title | <Title case, 2–4 words> |
| summary | <one sentence for the README table> |
| type | flow (repeated workflow with gates), or omitted (short instruction) |
| shippedPaths | SKILL.md[, REFERENCE.md, scripts, templates] |
| dependencies | <catalog ids it needs installed, or none> |
| platform | any / macos / macos+ghostty |

**Description:** Use when you want … It … Say "…", "…", or "…". For …, use <sibling>.

**Safety**
- …

**Workflow**
1. …

**Verification** — the report lists: …

**Example run**
You say: "…" → it asks: … → it produces: …
```

## Choosing `type`

- `type: flow` — a repeated workflow with steps and gates; most skills. The description must start with `Use when `, the body needs `## Safety`, `## Workflow`, and `## Verification`, and the file stays at 500 lines or fewer. `src/catalog/featureCatalog.skillPayload.test.ts` enforces all of it.
- No `type` — a short instruction such as `src/skills/questionMyPlan/SKILL.md`.

Both need a `name` equal to the catalog id (lowercase letters, digits, hyphens; 64 characters at most) and a `description` of 1024 characters at most.

## Registration checklist

All paths are in the agent-setup repo. Put the new skill next to related skills and use the same position in every list.

1. **Skill files** — `src/skills/<sourceDirectory>/SKILL.md`, plus every extra file the proposal named. Mirror `src/skills/githubRepoAbout/` for a one-file skill.
2. **Catalog** — one entry in `src/catalog/featureCatalog.ts`:

   ```ts
   skillFeature({
     id: "<id>",
     sourceDirectory: "<sourceDirectory>",
     title: "<title>",
     summary: "<summary>",
     shippedPaths: ["SKILL.md"],
     // dependencies: ["<sibling-id>"],   only when it needs a sibling installed
     // platform: "macos",                 only when not "any"
   }),
   ```

3. **Catalog tests** — `src/catalog/featureCatalog.test.ts` has three lists in catalog order: `expectedFeatureIds` (add `"<id>"`), `expectedSourceDirectories` (add `"<sourceDirectory>"`), and the shipped-paths list in "derives defaults, installed skills, and exact shipped allowlists" (add `["<id>", [<shippedPaths>]]`). With `dependencies`, also add `["<id>", [<dependencies>]]` to the list in "expands dependencies once and returns stable catalog order".
   A skill that writes run records starts its run with the "start a run" snippet from `src/skills/_shared/agent-artifacts.md` (`SKILL="<id>"`, `RUN_DIR`, one `report.md`). It also gets a row in the "run report folders" list of `src/catalog/featureCatalog.skillPayload.test.ts`, which checks its SKILL.md for `SKILL="<id>"` and `RUN_DIR`, and a row in the `which-skill` REFERENCE "Agent artifact paths" table.
4. **Routing** — a row in the fitting table of `src/skills/whichSkill/REFERENCE.md`: the user's phrases → `` `<id>` ``.
5. **Siblings** — when the new skill takes work from a sibling, add "For …, use <id>." to that sibling's description.
6. **README** — run `pnpm generate-readme`. Never edit the generated sections by hand.

## Install

`install <id>` adds the feature and keeps everything already installed. Run from the agent-setup repo after `pnpm check` (it builds `dist/`, which the hooks install from):

```bash
pnpm cli install <id>
ls ~/.claude/skills/<id>/SKILL.md
```

For a project install, run the same command from the target repo: replace `pnpm cli` with `node <agent-setup repo>/dist/src/cli/main.js` (the project is the current folder), add `--scope project`, and check `.claude/skills/<id>/SKILL.md`.
