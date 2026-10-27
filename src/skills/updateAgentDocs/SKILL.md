---
name: update-agent-docs
description: Use when you want to create or update agent instruction files — AGENTS.md, CLAUDE.md, Cursor rules, and others. It checks each agent's official docs first. Say "update AGENTS.md", "refresh CLAUDE.md", or "sync agent docs". For the README, use write-readme.
---

# Update agent docs

Refresh repo agent guidance from current official docs without turning prompts into a markdown dump.

## Core Contract

- Fetch fresh official docs at the start of every run; do not rely on memory or an old cache.
- Keep one repo instruction source of truth when possible, usually `AGENTS.md`.
- Tool-specific files are adapters or scoped rules, not duplicated style guides.
- Root docs point to canonical details by relevance; they do not inline the code-standard README, `PROJECT.md`, `CONTEXT.md`, or `LANGUAGE.md`.
- Inspect `README.md` only for repo context. For README structure, landing docs, or public project onboarding, use `write-readme`.
- Show a before/after plan and wait for approval before writing.

## Workflow

1. Inspect current repo docs: `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `PROJECT.md`, `CONTEXT.md`, `LANGUAGE.md`, `README.md`, plus `.cursor/rules/`, `.kiro/steering/`, `.roo/rules*/`, and `.github/copilot-instructions.md`.
2. Refresh vendor guidance from this skill directory:

   ```bash
   node scripts/fetchOfficialAgentDocs.mjs --save-to <your scratchpad>/agent-docs
   ```

   Read the files in the printed folder as the source set. If any source fails, report it; if every source fails, stop.
3. Compare tool behavior:
   - Codex/OpenAI, Cursor, Kiro, Roo, and other AGENTS-aware tools can share compact `AGENTS.md` guidance.
   - Claude Code needs `CLAUDE.md`; use `@AGENTS.md` only when `AGENTS.md` is intentionally compact.
   - Gemini CLI uses `GEMINI.md`; imports are useful but add prompt weight.
   - Cursor, Kiro, and Roo scoped-rule directories are for path/tool-specific rules, not copies of the whole root guide.
4. Propose the repo shape:
   - `AGENTS.md`: compact project contract, source-of-truth map, read order, verification, safety.
   - `CLAUDE.md` / `GEMINI.md`: adapters unless tool-specific behavior is genuinely needed.
   - scoped rules: only for large or path-specific guidance.
5. Render or write a before/after plan. Prefer the `plan-page` skill when available.
6. On approval, edit docs, then run `git diff --check` and the repo's relevant doc or verify commands.

## Output Rules

- Cite fetched source URLs in the summary.
- Never paste full vendor docs into repo files.
- Do not add backward-compat duplicate files "just in case"; replace or remove them in the same approved change.
- If repo docs conflict, surface the contradiction and ask which source wins before editing.

## Common Mistakes

| Mistake | Better behavior |
| --- | --- |
| Reusing remembered vendor behavior | Fetch official docs every run, then synthesize. |
| Copying full official docs into root files | Keep local docs short and repo-specific. |
| Making every tool file a full clone | Keep adapters tiny; put canonical guidance in one place. |
| Adding scoped rule folders by default | Add them only when scope changes behavior. |
