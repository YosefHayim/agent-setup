// The git repos a session can be re-homed into, plus the matcher that maps prompt words onto them.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { codeRootFolders, repoRootsUnder } from "../code-repos.js";
import { escapeForPattern } from "../pattern-escape.js";

export type Repo = {
  readonly name: string;
  readonly root: string;
  readonly keywords: ReadonlyArray<string>;
  /** A repo named only for deletion (`--delete-repo`), with no checkout on disk. */
  readonly checkedOut: boolean;
};

// Short names such as "cli" or "sdk" would match ordinary prose, so they never count as prompt keywords.
const MIN_KEYWORD_LENGTH = 4;

const isRecord = (candidate: unknown): candidate is Record<string, unknown> =>
  typeof candidate === "object" && candidate !== null && !Array.isArray(candidate);

const packageName = (repoRoot: string): string => {
  try {
    const manifest: unknown = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
    return isRecord(manifest) && typeof manifest.name === "string" ? manifest.name : "";
  } catch {
    return "";
  }
};

// e.g. "url = https://github.com/VybeKiit/vybekiit.git" → "vybekiit"
const originRepoName = (repoRoot: string): string => {
  try {
    const gitConfig = readFileSync(path.join(repoRoot, ".git", "config"), "utf8");
    const originUrl = /\[remote "origin"\][^[]*?url\s*=\s*(\S+)/u.exec(gitConfig)?.[1];
    return originUrl ? path.basename(originUrl).replace(/\.git$/u, "") : "";
  } catch {
    return "";
  }
};

// e.g. "@vybekiit/agent-kit" → ["vybekiit", "agent-kit"]
const keywordsFor = (names: ReadonlyArray<string>): ReadonlyArray<string> => [
  ...new Set(
    names
      .flatMap((name) => name.toLowerCase().replace(/^@/u, "").split("/"))
      .filter((keyword) => keyword.length >= MIN_KEYWORD_LENGTH),
  ),
];

const checkedOutRepo = (repoRoot: string): Repo => {
  const name = path.basename(repoRoot);
  return {
    name,
    root: repoRoot,
    keywords: keywordsFor([name, packageName(repoRoot), originRepoName(repoRoot)]),
    checkedOut: true,
  };
};

// Two checkouts named "cli" become "Desktop/Code/genshot-org/cli" and "Desktop/Code/other-org/cli", so a match
// never lands on the wrong one.
const withUniqueNames = (request: { readonly homeRoot: string; readonly repos: ReadonlyArray<Repo> }) =>
  request.repos.map((repo) =>
    request.repos.some((other) => other !== repo && other.name === repo.name)
      ? { ...repo, name: path.relative(request.homeRoot, repo.root) }
      : repo,
  );

// A keyword several repos share (genshot, genshot-org/cli as @genshot/cli, …) points at the repo named exactly
// that, or at none of them.
const withoutSharedKeywords = (repos: ReadonlyArray<Repo>): ReadonlyArray<Repo> =>
  repos.map((repo) => ({
    ...repo,
    keywords: repo.keywords.filter(
      (keyword) =>
        keyword === repo.name.toLowerCase() ||
        !repos.some((other) => other !== repo && other.keywords.includes(keyword)),
    ),
  }));

export const discoverRepos = (request: {
  readonly homeRoot: string;
  readonly rootFolders: ReadonlyArray<string>;
  readonly deletedRepoNames: ReadonlyArray<string>;
}): ReadonlyArray<Repo> => {
  const roots = codeRootFolders(request);
  const repoRoots = repoRootsUnder(roots);
  const checkedOut = withUniqueNames({ homeRoot: request.homeRoot, repos: repoRoots.map(checkedOutRepo) });
  const firstRoot = roots.find(existsSync) || request.homeRoot;
  const deleted = request.deletedRepoNames
    .filter((name) => !checkedOut.some((repo) => repo.name === name))
    .map((name) => ({ name, root: path.join(firstRoot, name), keywords: keywordsFor([name]), checkedOut: false }));
  return withoutSharedKeywords([...checkedOut, ...deleted]);
};

export const createKeywordMatcher = (repos: ReadonlyArray<Repo>): ((prompt: string) => ReadonlySet<string>) => {
  const keywordPatterns = repos.flatMap((repo) =>
    repo.keywords.map((keyword) => ({
      repoName: repo.name,
      pattern: new RegExp(`(^|[^a-z0-9-])${escapeForPattern(keyword)}([^a-z0-9-]|$)`, "u"),
    })),
  );
  return (prompt) => {
    const lowered = prompt.toLowerCase();
    return new Set(keywordPatterns.filter(({ pattern }) => pattern.test(lowered)).map(({ repoName }) => repoName));
  };
};

export const repoContaining = (request: { readonly repos: ReadonlyArray<Repo>; readonly folder: string }) =>
  [...request.repos]
    .sort((left, right) => right.root.length - left.root.length)
    .find((repo) => request.folder === repo.root || request.folder.startsWith(`${repo.root}/`));

// A session started outside every repo can still name one in its folder, e.g. /private/tmp/vybekiit-buyer-eval-3.
export const repoNamedByFolder = (request: { readonly repos: ReadonlyArray<Repo>; readonly folder: string }) => {
  const segments = request.folder.toLowerCase().split("/");
  return request.repos.find((repo) =>
    segments.some(
      (segment) => segment === repo.name.toLowerCase() || segment.startsWith(`${repo.name.toLowerCase()}-`),
    ),
  );
};
