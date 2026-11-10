import type { z } from "zod";

// e.g. "sessionRehomeRoots.0: Text must not start or end with spaces."
const readIssueLine = (issue: z.ZodError["issues"][number]): string => {
  const isIssueAtRoot = issue.path.length === 0;

  if (isIssueAtRoot) return issue.message;

  return `${issue.path.join(".")}: ${issue.message}`;
};

export const joinZodIssueMessages = (error: z.ZodError): string => error.issues.map(readIssueLine).join("; ");

export interface ZodIssueDetail {
  readonly path: ReadonlyArray<PropertyKey>;
  readonly message: string;
}

// Reports each detail that is not null at its own path, e.g. ["ownedFiles", 1, "path"], from one refinement.
export const addZodIssueDetails = (
  refinement: z.RefinementCtx,
  issueDetails: ReadonlyArray<ZodIssueDetail | null>,
): void => {
  for (const issueDetail of issueDetails) {
    const isIssueFound = issueDetail != null;
    if (isIssueFound) {
      refinement.addIssue({ code: "custom", path: [...issueDetail.path], message: issueDetail.message });
    }
  }
};
