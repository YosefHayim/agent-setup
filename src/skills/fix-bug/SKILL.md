---
name: fix-bug
description: Use when you want to fix real bugs with proof. It reproduces the bug first, finds the real cause, fixes it, tests edge cases, and shows that the fix works. Say "fix this bug", "reproduce then fix", or "debug this failure".
type: flow
---

# Fix Bug

Treat the user's report as a **hypothesis**, not a patch list. Work one defect at a time (or a small independent set) through reproduce → root cause → fix → verify. Do not edit product code for a defect until that defect is observed, or reproduction is blocked with evidence you report honestly.

## Safety

- Read repository run, test, seed, and environment instructions before starting services or mutating data.
- Prefer local, sandbox, or explicitly authorized environments. Do not use production write paths, real customer data, or live payments to prove a bug unless the user authorizes it and no safer path exists.
- Never expose secrets, tokens, PII, or private logs in the final report. Redact when quoting evidence.
- Stop and ask when reproduction needs credentials, irreversible actions, or product choices you cannot discover safely. Do not invent a root cause to unblock coding.
- Prefer the smallest correct fix. No drive-by refactors, unrelated cleanups, or "while I'm here" scope expansion unless required to land the fix.

## Multi-bug queue

When the user describes **more than one** bug (or a batch):

1. Inventory each item as a short ticket: ID (bug-1…), symptoms, expected vs actual, severity/impact, known steps, and shared vs independent surface.
2. Order the queue: blockers and crashes first, then user-visible wrong behavior, then polish. Prefer fixing shared root causes once when evidence shows one cause feeds many tickets.
3. Run the full workflow **per ticket** (or per shared root-cause group). Do not claim the batch is done while any ticket is unreproduced, unfixed, or unverified.
4. Keep a live scoreboard: `open | reproducing | root-caused | fixed | verified | blocked`. Update it after each ticket.
5. If tickets interact, re-verify earlier verified tickets after later fixes when shared code changed.

Single-bug runs are just a queue of length 1.

## Workflow

For **each** ticket in order:

### 1. Capture (do not code yet)

- Restate symptoms, expected vs actual, environment hints, and any steps the user gave.
- List what would count as a successful reproduction and a successful fix for this ticket only.
- Treat "I think it's in file X" as a lead, not as the diagnosis.

### 2. Reproduce like a senior engineer

- Boot what the stack needs: install deps, start services, seed data, feature flags, mobile/web targets, or the minimal CLI path.
- Prefer the highest-signal path available, in order:
  1. failing automated test or a new minimal failing test that encodes the report;
  2. scripted CLI/API path with logs;
  3. real UI/app path with console/network/device logs when the bug is user-visible.
- Collect evidence: stack traces, log lines, status codes, screenshots, DB/query results, race timing notes. Save commands so verification can re-run them.
- Probe nearby edge cases that could change the diagnosis (empty input, auth boundary, concurrency, locale, offline, large payload, first-run vs returning).
- **Gate:** no product-code fix until the bug is observed **or** you document a blocked reproduction (missing env, flaky only in prod, insufficient access) and get direction.

### 3. Root cause

- Trace from observed failure to the responsible code path with evidence (not "maybe").
- Separate: trigger, underlying defect, and any secondary symptoms.
- If multiple tickets share one cause, merge them for fix/verify and note which IDs close together.
- If the report is wrong or incomplete, say so with evidence and update the ticket before coding.

### 4. Fix

- Implement the minimal change that addresses the root cause.
- Add or extend a regression test when the stack makes that practical; otherwise record an explicit manual repro command as the regression harness.
- Keep unrelated files out of the diff.

### 5. Verify

- Re-run the **same** reproduction path; it must pass.
- Re-check the edge cases that matter for this ticket.
- Run the repository's relevant narrow tests and the project verify gate when the change is non-trivial.
- For multi-bug: mark the ticket `verified`, then proceed to the next open ticket. Re-smoke shared surfaces when a later fix touches the same code.

## Verification

Report a per-ticket table (or equivalent sections) covering:

| Field | Content |
| --- | --- |
| Ticket | ID + one-line symptom |
| Repro | Commands/steps, env identity, evidence observed before the fix |
| Root cause | Evidence-backed explanation (file/function when known) |
| Fix | What changed and why it addresses the cause |
| Proof | Same repro after fix, tests run, edge cases checked |
| Status | verified / blocked / deferred with reason |
| Residual risk | What was not covered |

Do **not** claim a bug (or the batch) is fixed if you only read the report and edited code without observing the failure and re-running the repro path. Do not collapse multiple tickets into one green claim without per-ticket proof.
