export const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export const readSessionIdFrom = (hookDetails: unknown): string => {
  const isNotObject = typeof hookDetails !== "object" || hookDetails === null;
  if (isNotObject) {
    return "";
  }

  const sessionId: unknown = Object.getOwnPropertyDescriptor(hookDetails, "session_id")?.value;

  const isInvalidSessionId = typeof sessionId !== "string" || !SESSION_ID_PATTERN.test(sessionId);
  if (isInvalidSessionId) {
    return "";
  }

  return sessionId;
};
