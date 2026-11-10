import type { z } from "zod";

// e.g. "sessionRehomeRoots.0: Text must not start or end with spaces."
export const joinZodIssueMessages = (error: z.ZodError): string =>
  error.issues
    .map((issue) => (issue.path.length === 0 ? issue.message : `${issue.path.join(".")}: ${issue.message}`))
    .join("; ");

export interface ZodIssueDetail {
  readonly path: ReadonlyArray<PropertyKey>;
  readonly message: string;
}

// Reports each detail that is not undefined at its own path, e.g. ["ownedFiles", 1, "path"], from one refinement.
export const addZodIssueDetails = (
  context: z.RefinementCtx,
  issueDetails: ReadonlyArray<ZodIssueDetail | undefined>,
): void => {
  for (const issueDetail of issueDetails) {
    const isIssueFound = issueDetail !== undefined;
    if (isIssueFound) {
      context.addIssue({ code: "custom", path: [...issueDetail.path], message: issueDetail.message });
    }
  }
};
