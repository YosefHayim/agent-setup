import { escapeForPattern } from "./pattern-escape.js";

type NamedFolder = { readonly name: string; readonly root: string };

// The longest root wins at each position, and a root only counts when a path boundary follows it, so
// ".../agent-runner" never matches inside ".../agent-runner-e2e".
export const createPathMatcher = (folders: ReadonlyArray<NamedFolder>): ((text: string) => ReadonlySet<string>) => {
  if (folders.length === 0) {
    return () => new Set();
  }

  const rootsLongestFirst = [...folders].sort((left, right) => right.root.length - left.root.length);
  const nameByRoot = new Map(rootsLongestFirst.map((folder) => [folder.root, folder.name]));
  const rootPattern = new RegExp(
    `(${rootsLongestFirst.map((folder) => escapeForPattern(folder.root)).join("|")})(?=[/"'\\s:),\\\\\`]|$)`,
    "gu",
  );
  return (text) => new Set([...text.matchAll(rootPattern)].map((match) => nameByRoot.get(match[1]) || ""));
};
