---
name: ask-before-build
description: Use when you start a new task and want every question asked up front, so scope does not arrive one message at a time. It sorts the task by type, asks only the open points in the fewest question cards, cuts the scope to an MVP, backlogs the rest until there is demand, then shows a brief and plan and waits for your go. Say "ask before build", "ask me everything first", or "/ask-before-build". Not for a task a skill with its own question card already owns. To grill a plan you already have, use question-my-plan. For a messy prompt, run which-skill first.
type: flow
---

# Ask before build

Ask every open question about a new task before any work starts, cut it to an MVP, and backlog the rest. The goal is one round of questions, not new scope in every later message.

## Safety

- Ask and plan only. Change no files, create no branch, and run no build until the person says go. After go, the only writes this skill makes are the brief and the backlog (step 7).
- Never ask what the prompt, the agent instructions, memory, or the repo already answer. Look it up instead.
- Never one question per turn. Put all open points in the fewest `AskUserQuestion` cards (4 questions per card), back to back, with no work between them.
- A small fix, a single question, or a status check skips this skill: say so in one line and do the task.
- Never put secrets, tokens, account ids, or customer data in the brief or the backlog.
- Create backlog items only after go, and only in the project the task belongs to. Open a GitHub issue only when the person asks for one.
- Backlog items are not part of this task. Never start one, and never hand one to another skill or agent.

## Hand-off

- A task owned by a skill that runs its own question card (`design-app-mockup`, `add-skill`, `question-my-plan`): skip this skill and load that one, so nothing is asked twice.
- A task for `fix-bug`, `ship-one-feature`, or `run-tasks-in-parallel`: ask here first, then load that skill and hand it the brief as already answered.

## Workflow

### 1. Read first

Read the task, the agent instructions, memory, `README.md`, and `AGENTS.md`. Note what they already settle.

### 2. Sort the task

Pick one type: new project, feature or change in an existing app, bug batch, concern, research, content, tooling, or ops.

For a concern, look first (read-only: code, logs, settings, numbers), then ask from the facts you found.

### 3. Pick the open points

Take the points for this type from the [question bank](#question-bank) that step 1 did not settle. Each question gets 2-4 concrete options, the recommended one first, marked `(Recommended)`, with the reason in its description.

### 4. Ask

The card count follows the type:

| Type | Cards |
|---|---|
| Bug batch, feature, concern, research, tooling, ops | usually 1 |
| New project, content | 1-2 |

A second card holds the points that did not fit in the first, or questions the first card's answers opened up.

More than 8 open points means the task is too big for one go: propose the MVP split first, then ask only the MVP's questions.

With no question tool, send the same questions as one numbered list in one message.

### 5. Cut to an MVP

The last card ends with "What goes in the MVP?": a multi-select of the features and the likely later ideas. The recommended pick is the smallest set that proves the idea works. Everything else goes to the backlog.

A bug batch has no MVP card: the list is the scope.

### 6. Show the brief and wait

Send one message with the brief. The brief is the plan, so no second plan follows it.

```markdown
**Goal:** <one line>
**Deliverable:** <what exists at the end>
**MVP (build now):** <the picked features>
**Stop when:** <one check that proves the MVP works>
**Backlog:** <each item, with the demand signal that pulls it in>
**Done means:** <proof, plus PR / merge / deploy / release>
**Steps:**
1. <step>
2. <step>
```

Send the steps to the plan dashboard when the host has one. Then wait for go.

### 7. Save after go

- Each backlog item goes to the host's follow-up list (in Claude Code, the followups `save_followup` tool). With no list, the items stay in the brief. GitHub issues labeled `backlog` only when the person asks.
- A brief for work that spans sessions goes to project memory.

### 8. New idea mid-session

When the person adds an idea while you work:

1. Say whether it is MVP or backlog. It is backlog, unless the MVP cannot work without it.
2. Add it to the brief and the plan steps, with one line on its order or cost.
3. Ask one card, "More in this area?", with 2-4 related ideas, each marked MVP or backlog.

### 9. Stop at the MVP

When the stop check passes, say "MVP done: ship it and get feedback before the backlog", and recommend stopping there.

## Question bank

Ordered by how often each point arrived late in past sessions. Ask only what is still open.

| Type | Ask about |
|---|---|
| Every task | What the session ends with (verdict, plan, mockup, PR, live); the full feature list, small items too, and what is out of v1 |
| New project | Design reference and how close to match it; who uses or drives it; repo or folder; what to reuse; name and brand; open source or paid; devices; phases |
| Feature or change | Which screens; this repo or all of them; shared parts to reuse or make generic; accounts and keys (test or production) |
| Bug batch | Order of the list; devices to prove on; test accounts; release targets |
| Concern | Report only or fix; scope (this repo or all); the target number to reach |
| Research | Answer format; what happens next; sources; cost limits |
| Content | Audience; tone; banned words; language and RTL; call-to-action channel; volume; where files go |
| Tooling | Mod, script, skill, or setting; repo or global; every field, in order |
| Ops | Cost, quota, and time limits; what may be deleted; accounts that are off limits |
| Any build | Proof (tests, screenshots, video, device); what done means; time budget and parallel agents; how the result is reviewed |

## Examples

| Task | Asks | Stop when | Backlog |
|---|---|---|---|
| "Add a share button for streaks" (feature) | 1 card: screens, share target, image style, MVP | The streak image shares from the iOS simulator | Templates, story share |
| "Build a tool that previews my app on many devices at once" (new project) | 2 cards: users, devices, open source or paid, reuse; then proof and MVP | An agent runs 3 devices and the page shows an overflow | Cloud plan, recording, more devices |
| "Fix these 6 bugs from the client" (bug batch) | 1 card: order, proof devices, done means, test account; then hand off to `fix-bug` | All 6 are proven on the named devices | none |
| "Agents burn too many tokens reading logs" (concern) | A read-only look first, then 1 card: report or fix, scope, target | A fresh session stays under the target | Other noisy tools |
| "Rename this button" (small fix) | none: one line, then do it | none | none |

## Verification

Report:

- the task type, and how many questions and cards were asked;
- the brief: goal, MVP, stop check, and done means;
- each backlog item and where it was saved;
- the hand-off skill, if any.

The skill is done when the person said go on the brief, or when it handed the task to a skill with its own question card.
