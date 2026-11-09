---
name: free-ports
description: Use when a port is busy and your dev server will not start. It stops the local servers that hold the ports (it keeps Metro on 8081). Say "kill ports", "free ports", or "port already in use".
type: flow
---

# Free ports

Free local TCP listeners so the next dev launch is not blocked by a stale process. Default preserve Metro / Expo on **8081** unless the user overrides the allowlist.

## Safety

- List listeners before killing. Never kill without showing what will die.
- Default allowlist: **8081** (Metro). Expand only when the user names more keep-alive ports.
- Never kill system services outside user-owned listeners, remote hosts, or production.
- Prefer the owning process for the port; do not `kill -9` first. Escalate only if a graceful signal fails.
- Do not delete worktrees, containers, or databases as part of “free ports.”

## Workflow

1. Confirm allowlist (default keep `8081`; add others only if requested).
2. Inventory listening TCP ports and owners (macOS examples):

   ```bash
   lsof -nP -iTCP -sTCP:LISTEN
   ```

3. Present a short table: port → pid → command → keep/kill decision.
4. Kill only the approved set:

   ```bash
   # graceful then force if still listening
   kill <pid> || true
   sleep 0.5
   kill -9 <pid> 2>/dev/null || true
   ```

5. Re-run `lsof` and confirm allowlisted ports still listen (if they should) and killed ports are gone.
6. Optionally relaunch the project’s documented dev command when the user asked to relaunch after clearing ports.

## Verification

Report:

- allowlist used;
- ports/pids killed and commands that owned them;
- ports still listening after the pass;
- any kill failures and why;
- relaunch command and outcome when requested.

Do not claim “ports free” without a post-kill `lsof` (or equivalent) check.
