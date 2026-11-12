---
name: improve-skill
description: Use when a skill did something wrong and you want to fix it from feedback. It turns your notes into changes in the skill's SKILL.md. Say "improve this skill", "fix this skill", or "this skill did X wrong". For a new skill, use add-skill.
effort: high
type: flow
---

# Improve skill

Improve an **existing** skill using concrete feedback. The skill file is the product under test; feedback is the bug report / UX note / eval miss.

## Safety

- Identify the **canonical source** skill (repo `src/skills/<dir>/` or the user’s source of truth). Do not “fix” only a generated install copy under `~/.claude/skills` / `~/.codex/skills` / `~/.grok/skills` without updating the source and re-syncing.
- Preserve the skill’s public `name` (kebab-case id) unless the user explicitly renames and updates the catalog/install surface.
- Keep frontmatter valid: `description` ≤ 1024 chars; flow skills start with `Use when `; body has Safety / Workflow / Verification when `type: flow`.
- Do not invent user requirements. If feedback is vague, ask one focused clarifying question or propose 2–3 concrete patches and wait for pick.
- Do not delete safety gates, remote-delete bans, or main-branch protections to “make it easier.”
- After edits, run the repo’s skill validation (`src/catalog/feature-catalog.skill-payload.test.ts` / catalog checks) when this is the agent-setup monorepo.

## Workflow

1. **Capture feedback** in one place: user quote, failing session behavior, missing trigger phrase, wrong handoff, over-trigger, or eval miss. Note agent host (Codex / Grok / Claude) if relevant.
2. **Locate the skill**: open `SKILL.md` (+ references/scripts). Summarize what it claims today (triggers, steps, done criteria).
3. **Diagnose class of gap** (pick one primary):
   - **Discovery** — description/triggers do not match freeform speech
   - **Routing** — wrong skill chosen vs sibling (finish vs deploy vs preview)
   - **Procedure** — missing/extra steps, wrong order, no mode split
   - **Safety** — too loose or too strict for real use
   - **Verification** — “done” claims without evidence the user needs
   - **Packaging** — missing shipped paths, scripts, catalog deps, sync
4. **Diff plan** (show before edit): exact sections to change, sample new description bullets, any new anti-triggers, what stays untouched.
5. **Patch minimally**: prefer description + one workflow bullet + verification line over a rewrite. For freeform-trigger gaps, add the user’s real phrases. For failure modes, add an explicit anti-path or stop condition.
6. **Cross-links**: if the skill should hand off (e.g. to `finish-and-push`, `run-tasks-in-parallel`), name the sibling skill; if feedback was “I had to paste the whole SKILL.md”, add short aliases / `$name` variants.
7. **Validate**: frontmatter/tests/catalog; optionally dry-run the new description against 3–5 real user phrases (“would this load?”).
8. **Ship path**: if agent-setup, ensure `featureCatalog` / `shippedPaths` still correct; remind `install-skills` or install so hosts pick up the change. Prefer a feature branch + PR when the repo uses that policy.

## Feedback → edit map

| Feedback shape | Typical edit |
|----------------|--------------|
| “I said X and it never fired” | Expand `description` with X; keep `Use when ` prefix |
| “It did Y when I wanted Z” | Anti-trigger + routing line to sibling skill |
| “It skipped verify / deleted remote” | Harden Safety + Verification |
| “Too long / too many questions” | Short-path workflow mode; defer optional steps |
| “Worked once, broke next agent” | Host-agnostic wording; dual-agent discovery note |
| Eval shows worse tokens/success | Pair with `benchmark-agents`; only keep changes that win same-task compare |

## Verification

Report:

- skill id + source path edited;
- feedback summary (1–3 lines);
- diagnosis class;
- before → after description or key bullets (redacted if needed);
- tests/catalog commands and outcomes;
- how to reinstall/sync for each agent host;
- residual risks (over-trigger, still needs eval).

Do not claim the skill is “fixed” without either a phrase dry-run against the feedback or a same-task re-run the user accepts.
