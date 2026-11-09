import type { z } from "zod";

// e.g. "sessionRehomeRoots.0: Text must not start or end with spaces."
export const joinZodIssueMessages = (error: z.ZodError): string =>
  error.issues
    .map((issue) => (issue.path.length === 0 ? issue.message : `${issue.path.join(".")}: ${issue.message}`))
    .join("; ");
