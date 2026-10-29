---
name: add-skill
description: Use when you want a new skill and can describe it. It asks you questions until the skill is clear, shows what it will do and its steps for you to approve, then adds it to agent-setup, runs the checks, and installs it. Say "add a skill", "new skill", or "make a skill that…". To fix a skill, use improve-skill. To reuse what we just did, use save-as-skill.
type: flow
---

# Add skill

Turn a description into a working, installed skill. The user describes it; you ask until it is clear, propose the whole skill, and write nothing until the user says yes.

## Safety

- Write no files, create no branch, and run no install until the user approves the proposal in step 5. Reading and exploring are fine.
- Do not add a skill that repeats an existing one. When an existing skill covers most of the request, recommend `improve-skill` instead.
- Work on a topic branch `feat/<id>`, never on main or the default branch. Stop if tracked files have uncommitted changes or the skill's directory already exists.
- Never put secrets, tokens, account IDs, absolute home paths, or customer data in a skill.
- Give the new skill its own gates: a skill that deploys, deletes, merges, sends messages, or spends money must ask first in its Safety section.
- Commit, push, and open a PR only when the user asks, through `finish-and-push`.

## Workflow

### 1. Capture

Quote the user's description word for word. In the agent-setup repo (`src/catalog/featureCatalog.ts` exists) follow every step; anywhere else follow [Outside agent-setup](#outside-agent-setup).

### 2. Check for overlap

Read the frontmatter `description` of every skill (`src/skills/*/SKILL.md` in agent-setup; elsewhere, the skills under `~/.claude/skills/` and the project's `.claude/skills/`).

- One skill already covers most of the request → name it and what is missing, recommend `improve-skill`, and stop unless the user still wants a new skill.
- Two skills each cover a part → name both and the gap; the new skill covers only the gap and hands off to them.

### 3. Explore before asking

Answer from the repo and docs whatever can be answered there: sibling skills to hand off to, how nearby skills are written, the tools the new skill will use and their official docs. Do not ask the user what you can look up.

### 4. Interview

Ask every question from [REFERENCE.md → Question bank](REFERENCE.md#question-bank) that the description and exploration did not settle. A vague skill needs many questions; a precise one may need few. Either way:

- Put them in the fewest `AskUserQuestion` cards (4 questions per card); never one question per turn.
- Recommended option first, marked `(Recommended)`, with the reason in its description.
- A follow-up card only for questions that could not exist until earlier answers landed.
- With no question tool, send one numbered list in a single message.

### 5. Propose and wait

Show the whole skill before writing anything, filled in from [REFERENCE.md → Proposal](REFERENCE.md#proposal): catalog fields, description, triggers and hand-offs, Safety bullets, numbered Workflow steps, the Verification report, and one example run.

Then stop. On changes, revise and show the proposal again. Continue only on a clear yes.

### 6. Write

Create branch `feat/<id>` from the default branch, then follow [REFERENCE.md → Registration checklist](REFERENCE.md#registration-checklist): the skill files, the catalog entry, the catalog test lists, the `which-skill` routing row, sibling "For X, use <id>" lines, and `pnpm generate-readme`.

### 7. Check

Run `pnpm vitest run src/catalog/featureCatalog.skillPayload.test.ts src/catalog/featureCatalog.test.ts`, then `pnpm check`. Fix and re-run until both pass. Never skip or weaken a check to make it pass.

### 8. Install and try it

First test 3–5 of the user's own phrases against the new description and its closest siblings: would each phrase load this skill, and not a sibling? When one would not, fix the description and run step 7 again.

Then install with the command in [REFERENCE.md → Install](REFERENCE.md#install) and confirm the installed `SKILL.md` exists: `~/.claude/skills/<id>/` for a global install, `.claude/skills/<id>/` for a project install. Tell the user to start a new session so the agent loads it.

### Outside agent-setup

Run steps 1–5 the same way; in the step 4 card also ask where it lives: `.claude/skills/<id>/` (this project) or `~/.claude/skills/<id>/` (every project). On a yes, write `SKILL.md` and any extra files there, and skip the catalog, tests, README, and install.

## Verification

Report:

- skill id and source path;
- the approved proposal and any change made after approval;
- files changed;
- each tried phrase → which skill it loads;
- one sentence the user can say to try the skill now.

In agent-setup, also report the branch, the two test commands and `pnpm check` with results, and the install path. The skill is done when the checks pass and the installed `SKILL.md` exists.

Outside agent-setup, report the chosen location. The skill is done when its `SKILL.md` exists there.
