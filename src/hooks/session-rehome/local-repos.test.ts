import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { createKeywordMatcher, discoverRepos, repoContaining, repoNamedByFolder } from "./local-repos.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const workspaces: Array<string> = [];

const createCodeFolder = (): string => {
  const homeRoot = mkdtempSync(path.join(packageRoot, "scratch-local-repos-"));
  workspaces.push(homeRoot);
  return homeRoot;
};

const createRepo = (request: { readonly folder: string; readonly packageName?: string; readonly origin?: string }) => {
  mkdirSync(path.join(request.folder, ".git"), { recursive: true });
  if (request.packageName) {
    writeFileSync(path.join(request.folder, "package.json"), JSON.stringify({ name: request.packageName }));
  }
  if (request.origin) {
    writeFileSync(path.join(request.folder, ".git", "config"), `[remote "origin"]\n\turl = ${request.origin}\n`);
  }
};

afterEach(() => {
  for (const workspace of workspaces.splice(0)) {
    rmSync(workspace, { recursive: true, force: true });
  }
});

describe("local repos", () => {
  it("finds repos one and two levels under each root, plus named-for-deletion repos without a checkout", () => {
    const homeRoot = createCodeFolder();
    createRepo({ folder: path.join(homeRoot, "Code", "vybekiit"), origin: "https://github.com/VybeKiit/vybekiit.git" });
    createRepo({ folder: path.join(homeRoot, "Code", "genshot-org", "genshot") });
    createRepo({ folder: path.join(homeRoot, "Code", "genshot-org", "cli"), packageName: "@genshot/cli" });
    mkdirSync(path.join(homeRoot, "Code", "notes"), { recursive: true });

    const repos = discoverRepos({ homeRoot, rootFolders: ["Code", "missing"], deletedRepoNames: ["aria"] });

    expect(repos.map((repo) => [repo.name, repo.checkedOut])).toEqual(
      expect.arrayContaining([
        ["vybekiit", true],
        ["genshot", true],
        ["cli", true],
        ["aria", false],
      ]),
    );
    expect(repos.find((repo) => repo.name === "aria")?.root).toBe(path.join(homeRoot, "Code", "aria"));
    expect(repos.some((repo) => repo.name === "notes")).toBe(false);
    // "genshot" belongs to the repo named genshot, not to @genshot/cli as well.
    expect(repos.find((repo) => repo.name === "cli")?.keywords).toEqual([]);
  });

  it("tells apart checkouts that share a folder name by their path under home", () => {
    const homeRoot = createCodeFolder();
    createRepo({ folder: path.join(homeRoot, "Code", "genshot-org", "cli") });
    createRepo({ folder: path.join(homeRoot, "Code", "other-org", "cli") });
    createRepo({ folder: path.join(homeRoot, "Code", "vybekiit") });

    const repos = discoverRepos({ homeRoot, rootFolders: ["Code"], deletedRepoNames: [] });

    expect(repos.map((repo) => repo.name).sort()).toEqual(["Code/genshot-org/cli", "Code/other-org/cli", "vybekiit"]);
  });

  it("matches prompt keywords as whole words only", () => {
    const matchKeywords = createKeywordMatcher([
      { name: "vybekiit", root: "/code/vybekiit", keywords: ["vybekiit"], checkedOut: true },
    ]);

    expect([...matchKeywords("fix the VybeKiit checkout")]).toEqual(["vybekiit"]);
    expect([...matchKeywords("the vybekiit-ui package")]).toEqual([]);
  });

  it("finds the repo that contains a folder, or the repo a folder outside every repo is named after", () => {
    const repos = [{ name: "vybekiit", root: "/code/vybekiit", keywords: [], checkedOut: true }];

    expect(repoContaining({ repos, folder: "/code/vybekiit/.worktrees/web" })?.name).toBe("vybekiit");
    expect(repoContaining({ repos, folder: "/code" })).toBeUndefined();
    expect(repoNamedByFolder({ repos, folder: "/private/tmp/vybekiit-buyer-eval-3" })?.name).toBe("vybekiit");
    expect(repoNamedByFolder({ repos, folder: "/private/tmp/other" })).toBeUndefined();
  });
});
