import { existsSync } from "node:fs";
import path from "node:path";

import { type GitQuestion, readGitAnswerLines } from "../git-answers.js";

export type RepoHooksStatus =
  | { readonly _tag: "ready" }
  | { readonly _tag: "needsInstall"; readonly toplevel: string; readonly installCommand: string }
  | { readonly _tag: "needsHooksPath"; readonly toplevel: string };

const READY: RepoHooksStatus = { _tag: "ready" };

const installCommandIn = (toplevel: string): string => {
  const usesNpm = existsSync(path.join(toplevel, "package-lock.json"));

  const usesPnpm = existsSync(path.join(toplevel, "pnpm-lock.yaml"));

  const isUsingNpmOnly = usesNpm && !usesPnpm;
  if (isUsingNpmOnly) {
    return "npm install";
  }

  return "pnpm install";
};

const readNeedsInstall = (toplevel: string): RepoHooksStatus => ({
  _tag: "needsInstall",
  toplevel,
  installCommand: installCommandIn(toplevel),
});

const readFirstAnswerLine = (question: GitQuestion): string | null => {
  const answerLines = readGitAnswerLines(question);

  const hasNoAnswerLines = !answerLines;
  if (hasNoAnswerLines) {
    return null;
  }

  return answerLines[0];
};

// Husky v9 points core.hooksPath at .husky/_, a folder only `pnpm install` creates, so a fresh worktree has none.
export const inspectRepoHooks = (folder: string): RepoHooksStatus => {
  const toplevel = readFirstAnswerLine({ folder, query: ["rev-parse", "--show-toplevel"] });

  const isToplevelMissing = toplevel == null;
  if (isToplevelMissing) {
    return READY;
  }

  const hooksPath = readFirstAnswerLine({
    folder: toplevel,
    query: ["config", "--type=path", "--get", "core.hooksPath"],
  });
  const hasHooksPath = hooksPath != null;

  const isHooksFolderMissing = hasHooksPath && !existsSync(path.resolve(toplevel, hooksPath));
  if (isHooksFolderMissing) {
    return readNeedsInstall(toplevel);
  }

  const isHuskyMissing = !hasHooksPath && existsSync(path.join(toplevel, ".husky"));
  if (isHuskyMissing) {
    return readNeedsInstall(toplevel);
  }

  const isGithooksUnused = !hasHooksPath && existsSync(path.join(toplevel, ".githooks"));
  if (isGithooksUnused) {
    return { _tag: "needsHooksPath", toplevel };
  }

  return READY;
};
