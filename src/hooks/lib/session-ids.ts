// Claude Code session IDs are UUIDv4 and Codex thread IDs UUIDv7 — never "../x" or "*".
export const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export const sessionIdFrom = (hookInput: unknown): string => {
  if (typeof hookInput !== "object" || hookInput === null) {
    return "";
  }

  const sessionId: unknown = Object.getOwnPropertyDescriptor(hookInput, "session_id")?.value;
  if (typeof sessionId !== "string" || !SESSION_ID_PATTERN.test(sessionId)) {
    return "";
  }

  return sessionId;
};
