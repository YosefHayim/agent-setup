---
name: add-mcp-server
description: Use when you want to add or fix an MCP server for an agent. It installs the server, runs the login, restarts the agent, and checks that the tools work. Say "add MCP server", "MCP login", or "MCP not working".
type: flow
---

# Add MCP server

Complete the whole onboarding path: trustworthy endpoint, correct scope, browser consent, authenticated status, agent discovery, and one harmless real tool call.

## Safety

- Use official provider and agent documentation for current CLI syntax, transport, and OAuth behavior. Do not execute an install command copied from an untrusted page without inspection.
- Inspect existing same-name MCP entries before adding or changing one. Never overwrite or remove a working configuration silently.
- Do not ask the user to paste passwords, authorization codes, client secrets, access tokens, cookies, or bearer tokens into chat.
- OAuth consent belongs to the user. Pause for their browser approval when required; do not claim to approve permissions on their behalf.
- Verify with a read-only list, get, search, or identity operation. Do not create, send, publish, delete, or purchase anything as an onboarding test.

## Workflow

1. Identify the target agent, required scope, MCP name, official endpoint or command, transport, permissions, and expected tools. If “this MCP” is ambiguous, resolve it from repository/config context or ask for the missing trusted source.
2. Check CLI availability and current version, then inspect existing MCP configuration at project, user, and managed scopes. Record conflicts without exposing secret fields.
3. Read the live command help or official docs. Build the exact add command with explicit scope; for global Claude Code availability, use user scope rather than relying on defaults.
4. Add or update only the intended entry. Read it back and verify scope, transport, endpoint/command, and sanitized environment-key names.
5. Start the official login/auth flow. Tell the user what consent screen and account they should expect, then wait for their action when the browser requires it.
6. Re-check status until it is authenticated or a concrete error is available. Diagnose redirect, callback, browser-profile, organization-policy, or stale-credential failures from evidence.
7. Restart or open a fresh agent session if discovery occurs only at startup.
8. Invoke one harmless read-only MCP tool and validate a plausible structured response. Configuration presence or a successful redirect alone is insufficient.

## Verification

Report:

- target agent and exact scope;
- MCP name, sanitized transport/endpoint, and config readback;
- authentication status after OAuth;
- restart or new-session action;
- fully qualified read-only tool invoked and sanitized result;
- unresolved permissions, provider policy, or discovery limitations.

Never call onboarding complete while status says “Needs authentication,” the server cannot start, the agent has not discovered its tools, or no real tool call succeeded.
