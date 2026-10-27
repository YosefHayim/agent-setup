---
name: find-repeated-prompts
description: Use when you want to find prompts you repeat in your past agent sessions (Claude Code, Codex, Cursor, and others). Repeated work is a good idea for a new skill. Say "scan my sessions", "what do I repeat", or "find skill ideas".
type: flow
---

# Find repeated prompts

Turn repeated user requests into evidence-backed skill candidates. The audit is read-only, local-first, privacy-preserving, and honest about coverage.

## Safety

- Get scope from the request: machine, user account, time range, agent families, and whether archived sessions count. Do not broaden to other users, cloud accounts, or network stores.
- Never modify, migrate, compact, or delete a session store. Open databases read-only and copy a database to temporary storage before queries when its client may create journal files.
- Extract user-authored prompts only. Exclude system/developer messages, assistant replies, tool calls/results, injected repo instructions, retries, and generated continuation noise.
- Redact secrets, tokens, credentials, personal/customer data, private URLs, and sensitive absolute paths before examples or intermediate artifacts leave their source.
- Keep clustering local by default. Obtain explicit approval before sending transcript-derived text to a hosted embedding or model service.

## Workflow

1. Prefer the **one-command pipeline** when this skill is installed with scripts:

   ```bash
   python3 scripts/runSessionAudit.py
   # or with an explicit session home:
   python3 scripts/runSessionAudit.py --home "$HOME"
   ```

   Resolve `scripts/runSessionAudit.py` from this skill’s install directory (global or project). The script discovers Claude Code (every `~/.claude*` account), Codex, and Grok stores under `$HOME`, writes coverage, prompts, clusters, intent buckets, shards, and `report.md`. It covers all sessions, not one repo, so each run gets a new folder `${XDG_STATE_HOME:-~/.local/state}/agent-setup/runs/global/find-repeated-prompts/<YYYY-MM-DD-HHMM>/`, outside every repo. Never write the audit into a repository `docs/` folder.

2. If the script is unavailable, run the same pipeline manually: discover stores → coverage manifest → sample formats → extract user prompts → normalize → exact + fuzzy cluster → intent map → skill compare.

3. Discover stores from installed commands, documented paths, app data, config, and recent modification evidence. Do not guess unsupported directories.

4. Create a coverage manifest per agent: detected version, store paths, format, sessions found, sessions parsed, prompts extracted, skipped records, errors, and unsupported surfaces.

5. Sample each format before bulk parsing. Identify role fields, content blocks, timestamps, session IDs, workspace, and duplication caused by retries or branching.

6. Normalize conservatively: trim transport noise (including `<environment_context>`, injected `<skill>` XML, plugin lists), replace volatile IDs/paths/numbers with typed placeholders, collapse whitespace, and remove acknowledgements such as “yes”, “continue”, or “proceed” unless they carry reusable intent.

7. Deduplicate exact normalized prompts, then fuzzy-cluster by both lexical and semantic evidence. Calibrate thresholds against a sample of same-intent and different-intent pairs; short prompts need stricter treatment. Prefer **unique sessions** over raw prompt counts (history + session double-count risk; Grok subagent worktrees inflate breadth).

8. Name each cluster by reusable job, not wording. Record frequency, unique sessions, agents, repositories, time span, sanitized examples, confidence, and failure modes in existing answers.

9. Rank skill candidates by repetition, cross-repo or cross-agent breadth, cost of repeated explanation, risk reduction, and how clearly a deterministic workflow can be encoded. Penalize one-off project facts, mission-paste multi-agent templates, and vague continuations.

10. Compare candidates to installed and authored skills (script also lists `~/.grok|claude|codex/skills`). Recommend create, improve, merge, or leave as ordinary prompting. Optional: fan out agents on `shard-*.jsonl` for qualitative review; the script is the SSOT for counts.

## Verification

Publish a sanitized report with:

- detected, scanned, skipped, errored, and unsupported coverage by agent;
- extraction and normalization rules;
- clustering method, thresholds, calibration sample, and confidence;
- top clusters with counts from unique sessions, source-agent breadth, date range, and redacted examples;
- existing-skill overlap and a prioritized create/improve recommendation;
- limitations that prevent “all sessions” or completeness claims.

When the script ran, point to its `report.md` plus `coverage-manifest.json` and `intent-buckets.json` as primary evidence.

Never include raw transcript dumps. A result is not a skill opportunity merely because its words repeat; it must represent a reusable job with a stable trigger and workflow.
