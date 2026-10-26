import { existsSync } from "node:fs";
import path from "node:path";

import { type GitQuestion, gitAnswerLines } from "../../lib/gitAnswers.js";

export type RepoHooksState =
  | { readonly _tag: "ready" }
  | { readonly _tag: "needsInstall"; readonly toplevel: string; readonly installCommand: string }
  | { readonly _tag: "needsHooksPath"; readonly toplevel: string };

const READY: RepoHooksState = { _tag: "ready" };

const installCommandIn = (toplevel: string): string => {
  const usesNpm = existsSync(path.join(toplevel, "package-lock.json"));
  const usesPnpm = existsSync(path.join(toplevel, "pnpm-lock.yaml"));
  if (usesNpm && !usesPnpm) {
    return "npm install";
  }

  return "pnpm install";
};

const needsInstall = (toplevel: string): RepoHooksState => ({
  _tag: "needsInstall",
  toplevel,
  installCommand: installCommandIn(toplevel),
});

const firstAnswerLine = (question: GitQuestion): string | undefined => {
  const answerLines = gitAnswerLines(question);
  if (!answerLines) {
    return undefined;
  }

  return answerLines[0];
};

// Husky v9 points core.hooksPath at .husky/_, a folder only `pnpm install` creates, so a fresh worktree has none.
export const inspectRepoHooks = (folder: string): RepoHooksState => {
  const toplevel = firstAnswerLine({ folder, query: ["rev-parse", "--show-toplevel"] });
  if (toplevel === undefined) {
    return READY;
  }

  const hooksPath = firstAnswerLine({ folder: toplevel, query: ["config", "--type=path", "--get", "core.hooksPath"] });
  const hasHooksPath = hooksPath !== undefined;
  const hooksFolderIsMissing = hasHooksPath && !existsSync(path.resolve(toplevel, hooksPath));
  if (hooksFolderIsMissing) {
    return needsInstall(toplevel);
  }

  const huskyIsNotInstalled = !hasHooksPath && existsSync(path.join(toplevel, ".husky"));
  if (huskyIsNotInstalled) {
    return needsInstall(toplevel);
  }

  const githooksIsNotUsed = !hasHooksPath && existsSync(path.join(toplevel, ".githooks"));
  if (githooksIsNotUsed) {
    return { _tag: "needsHooksPath", toplevel };
  }

  return READY;
};
