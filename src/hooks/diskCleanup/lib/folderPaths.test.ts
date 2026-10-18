import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { folderPaths, isInsideAnyFolder } from "./folderPaths.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const workspaces: Array<string> = [];

// A disk folder holds the app, and a Code link leads to the disk folder.
const createLinkedCodeFolder = () => {
  const workspace = mkdtempSync(path.join(packageRoot, "scratch-folder-paths-"));
  workspaces.push(workspace);
  const realWorkspace = realpathSync(workspace);
  const appFolder = path.join(realWorkspace, "disk", "app");
  const linkedRoot = path.join(realWorkspace, "Code");
  mkdirSync(appFolder, { recursive: true });
  symlinkSync(path.dirname(appFolder), linkedRoot);
  return { realWorkspace, appFolder, linkedRoot, linkedAppFolder: path.join(linkedRoot, "app") };
};

afterEach(() => {
  for (const workspace of workspaces.splice(0)) {
    rmSync(workspace, { recursive: true, force: true });
  }
});

describe("isInsideAnyFolder", () => {
  it("takes a folder and the paths under it as inside it, and a sibling with a longer name as outside", () => {
    expect(isInsideAnyFolder({ candidate: "/code/app", folders: ["/code/app"] })).toBe(true);
    expect(isInsideAnyFolder({ candidate: "/code/app/src", folders: ["/code/app"] })).toBe(true);
    expect(isInsideAnyFolder({ candidate: "/code/app-e2e", folders: ["/code/app"] })).toBe(false);
  });

  it("takes every path as inside the top folder", () => {
    expect(isInsideAnyFolder({ candidate: "/code/app", folders: ["/"] })).toBe(true);
  });
});

describe("folderPaths", () => {
  it("names a folder found through a link by its real path too", () => {
    const code = createLinkedCodeFolder();

    expect(folderPaths({ folder: code.linkedAppFolder, roots: [] }).paths).toEqual([
      code.linkedAppFolder,
      code.appFolder,
    ]);
  });

  it("names a folder found at its real path by its path through a root that links to it", () => {
    const code = createLinkedCodeFolder();

    expect(folderPaths({ folder: code.appFolder, roots: [code.linkedRoot] }).paths).toEqual([
      code.appFolder,
      code.linkedAppFolder,
    ]);
  });

  it("names a folder by its path through a root that links to the top folder", () => {
    const code = createLinkedCodeFolder();
    const topLink = path.join(code.realWorkspace, "top");
    symlinkSync("/", topLink);

    expect(folderPaths({ folder: code.appFolder, roots: [topLink] }).paths).toEqual([
      code.appFolder,
      path.join(topLink, code.appFolder),
    ]);
  });
});
