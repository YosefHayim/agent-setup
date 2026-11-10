import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { listUnsavedWorkTrees } from "./unsaved-git-work.js";

const workspaces: Array<string> = [];
const passwordRemotes: Array<ChildProcess> = [];

// Inside a git hook these tests inherit GIT_DIR, which would aim every command at the repository being committed.
const readIsolatedGitEnvironment = (): NodeJS.ProcessEnv => {
  const variables = Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_"));
  return { ...Object.fromEntries(variables), GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
};

const runGitCommand = (request: { readonly folder: string; readonly command: ReadonlyArray<string> }) => {
  const identity = ["-c", "user.name=Scratch Test", "-c", "user.email=scratch@example.test"];
  // Git refuses to clone a submodule from a local folder unless the file protocol is allowed.
  const settings = ["-c", "init.defaultBranch=main", "-c", "protocol.file.allow=always"];

  const execution = spawnSync("git", [...identity, ...settings, ...request.command], {
    cwd: request.folder,
    encoding: "utf8",
    env: readIsolatedGitEnvironment(),
  });

  const isGitFailed = execution.status !== 0;
  if (isGitFailed) {
    throw new Error(`git ${request.command.join(" ")} failed: ${execution.stderr}`);
  }
};

const commitFile = (request: { readonly workTree: string; readonly fileName: string }) => {
  writeFileSync(path.join(request.workTree, request.fileName), "content\n");
  runGitCommand({ folder: request.workTree, command: ["add", request.fileName] });
  runGitCommand({ folder: request.workTree, command: ["commit", "--quiet", "--message", `add ${request.fileName}`] });
};

type Workspace = { readonly upstream: string; readonly scratchFolder: string; readonly clone: string };

// A scratch folder holding a clone whose every commit is on its remote.
const createWorkspace = (): Workspace => {
  const root = mkdtempSync(path.join(tmpdir(), "scratch-git-work-"));
  workspaces.push(root);
  const upstream = path.join(root, "upstream");
  const scratchFolder = path.join(root, "scratchpad");
  const clone = path.join(scratchFolder, "checks", "clone");
  mkdirSync(upstream);
  mkdirSync(path.dirname(clone), { recursive: true });
  runGitCommand({ folder: upstream, command: ["init", "--quiet"] });
  commitFile({ workTree: upstream, fileName: "README.md" });
  runGitCommand({ folder: scratchFolder, command: ["clone", "--quiet", upstream, clone] });
  return { upstream, scratchFolder, clone };
};

// The repository the clone's submodule is cloned from.
const readLibraryOf = (workspace: Workspace): string => path.join(path.dirname(workspace.upstream), "library");

// Adds a submodule at vendor/library to the clone and pushes that commit, so the clone itself stays fully pushed.
const addPushedSubmodule = (workspace: Workspace): string => {
  const library = readLibraryOf(workspace);
  mkdirSync(library);
  runGitCommand({ folder: library, command: ["init", "--quiet"] });
  commitFile({ workTree: library, fileName: "library.ts" });
  runGitCommand({ folder: workspace.clone, command: ["submodule", "--quiet", "add", library, "vendor/library"] });
  runGitCommand({ folder: workspace.clone, command: ["commit", "--quiet", "--message", "add the library"] });
  runGitCommand({ folder: workspace.clone, command: ["push", "--quiet", "origin", "HEAD:refs/heads/with-library"] });
  return path.join(workspace.clone, "vendor", "library");
};

type LinkedWorkTree = { readonly workTree: string; readonly submodule: string };

// A linked worktree of the upstream repository inside the scratch folder, with the library submodule checked out.
const addLinkedWorkTreeWithSubmodule = (workspace: Workspace): LinkedWorkTree => {
  addPushedSubmodule(workspace);
  const workTree = path.join(workspace.scratchFolder, "linked");
  runGitCommand({
    folder: workspace.upstream,
    command: ["worktree", "add", "--quiet", "-b", "feature", workTree, "with-library"],
  });
  runGitCommand({ folder: workTree, command: ["submodule", "--quiet", "update", "--init"] });
  return { workTree, submodule: path.join(workTree, "vendor", "library") };
};

// Makes the clone ignore its .worktrees folder and pushes that commit, so the clone's own git status shows nothing
// of what is put there. Returns the ignored folder.
const ignoreWorktreesFolder = (workspace: Workspace): string => {
  writeFileSync(path.join(workspace.clone, ".gitignore"), ".worktrees/\n");
  runGitCommand({ folder: workspace.clone, command: ["add", ".gitignore"] });
  runGitCommand({
    folder: workspace.clone,
    command: ["commit", "--quiet", "--message", "ignore the worktrees folder"],
  });
  runGitCommand({ folder: workspace.clone, command: ["push", "--quiet", "origin", "HEAD:refs/heads/with-ignore"] });
  return path.join(workspace.clone, ".worktrees");
};

// Gives a repository a tag on a commit that no branch holds, the way a deleted release branch leaves one.
const tagCommitOutsideEveryBranch = (repository: string) => {
  runGitCommand({ folder: repository, command: ["checkout", "--quiet", "-b", "release"] });
  commitFile({ workTree: repository, fileName: "release.md" });
  runGitCommand({ folder: repository, command: ["tag", "--annotate", "--message", "release", "archive/release"] });
  runGitCommand({ folder: repository, command: ["checkout", "--quiet", "main"] });
  runGitCommand({ folder: repository, command: ["branch", "--quiet", "-D", "release"] });
};

// A clone copies every tag of its remote, also one on commits outside every branch; this fetch does the same later.
const fetchEveryTag = (workTree: string) => {
  runGitCommand({ folder: workTree, command: ["fetch", "--quiet", "--tags", "origin"] });
};

// Starts a remote that answers every request by asking for a password, and returns its address.
const startPasswordRemote = async (): Promise<string> => {
  const askForPassword = `require("node:http")
    .createServer((request, reply) => reply.writeHead(401, { "WWW-Authenticate": 'Basic realm="scratch"' }).end())
    .listen(0, "127.0.0.1", function () { console.log(this.address().port); });`;
  const passwordRemote = spawn(process.execPath, ["--eval", askForPassword], { stdio: ["ignore", "pipe", "inherit"] });
  passwordRemotes.push(passwordRemote);
  const [portLine] = await once(passwordRemote.stdout, "data");
  const port = String(portLine).trim();
  return `http://127.0.0.1:${port}/upstream.git`;
};

afterEach(() => {
  vi.unstubAllEnvs();
  for (const passwordRemote of passwordRemotes.splice(0)) {
    passwordRemote.kill();
  }

  for (const workspace of workspaces.splice(0)) {
    rmSync(workspace, { recursive: true, force: true });
  }
});

describe("unsavedWorkTrees", () => {
  it("finds nothing in a clone whose work is committed and pushed, or in a folder without git", () => {
    const workspace = createWorkspace();
    const logFolder = path.join(workspace.scratchFolder, "logs");
    mkdirSync(logFolder);
    writeFileSync(path.join(logFolder, "run.log"), "log\n");

    expect(listUnsavedWorkTrees(workspace.scratchFolder)).toEqual([]);
    expect(listUnsavedWorkTrees(logFolder)).toEqual([]);
  });

  it("finds a clone with a changed tracked file", () => {
    const workspace = createWorkspace();
    writeFileSync(path.join(workspace.clone, "README.md"), "edited\n");

    expect(listUnsavedWorkTrees(workspace.scratchFolder)).toEqual([workspace.clone]);
  });

  it("finds a clone with a new file that is not tracked", () => {
    const workspace = createWorkspace();
    writeFileSync(path.join(workspace.clone, "feature.ts"), "export const feature = 1;\n");

    expect(listUnsavedWorkTrees(workspace.scratchFolder)).toEqual([workspace.clone]);
  });

  it("finds a new file in a clone whose git status is told to hide new files", () => {
    const workspace = createWorkspace();
    runGitCommand({ folder: workspace.clone, command: ["config", "status.showUntrackedFiles", "no"] });
    writeFileSync(path.join(workspace.clone, "feature.ts"), "export const feature = 1;\n");

    expect(listUnsavedWorkTrees(workspace.scratchFolder)).toEqual([workspace.clone]);
  });

  it("lets go of a clone whose tracked files are only missing, the way a delete that was cut off leaves it", () => {
    const workspace = createWorkspace();
    rmSync(path.join(workspace.clone, "README.md"));

    expect(listUnsavedWorkTrees(workspace.scratchFolder)).toEqual([]);
  });

  it("finds a clone with a missing tracked file next to a new file", () => {
    const workspace = createWorkspace();
    rmSync(path.join(workspace.clone, "README.md"));
    writeFileSync(path.join(workspace.clone, "feature.ts"), "export const feature = 1;\n");

    expect(listUnsavedWorkTrees(workspace.scratchFolder)).toEqual([workspace.clone]);
  });

  it("finds a clone with a deletion that was staged on purpose", () => {
    const workspace = createWorkspace();
    runGitCommand({ folder: workspace.clone, command: ["rm", "--quiet", "README.md"] });

    expect(listUnsavedWorkTrees(workspace.scratchFolder)).toEqual([workspace.clone]);
  });

  it("lets go of a pushed clone whose submodule folder is only missing", () => {
    const workspace = createWorkspace();
    const submodule = addPushedSubmodule(workspace);
    rmSync(submodule, { recursive: true });

    expect(listUnsavedWorkTrees(workspace.scratchFolder)).toEqual([]);
  });

  it("finds a clone whose missing submodule left a commit on no remote in its repository", () => {
    const workspace = createWorkspace();
    const submodule = addPushedSubmodule(workspace);
    commitFile({ workTree: submodule, fileName: "feature.ts" });
    rmSync(submodule, { recursive: true });

    expect(listUnsavedWorkTrees(workspace.scratchFolder)).toEqual([workspace.clone]);
  });

  it("finds a pushed clone whose submodule holds a commit that is on no remote", () => {
    const workspace = createWorkspace();
    const submodule = addPushedSubmodule(workspace);
    commitFile({ workTree: submodule, fileName: "feature.ts" });
    runGitCommand({
      folder: workspace.clone,
      command: ["commit", "--quiet", "--all", "--message", "use the new library"],
    });
    runGitCommand({ folder: workspace.clone, command: ["push", "--quiet", "origin", "HEAD:refs/heads/with-library"] });

    expect(listUnsavedWorkTrees(workspace.scratchFolder)).toEqual([workspace.clone]);
  });

  it("finds a changed file in a submodule that git status is told to ignore", () => {
    const workspace = createWorkspace();
    const submodule = addPushedSubmodule(workspace);
    runGitCommand({ folder: workspace.clone, command: ["config", "submodule.vendor/library.ignore", "all"] });
    writeFileSync(path.join(submodule, "library.ts"), "edited\n");

    expect(listUnsavedWorkTrees(workspace.scratchFolder)).toEqual([workspace.clone]);
  });

  it("finds a clone with a commit that is on no remote", () => {
    const workspace = createWorkspace();
    commitFile({ workTree: workspace.clone, fileName: "feature.ts" });

    expect(listUnsavedWorkTrees(workspace.scratchFolder)).toEqual([workspace.clone]);
  });

  it("lets go of a pushed clone whose remote is gone, since no tag needs asking about", () => {
    const workspace = createWorkspace();
    rmSync(workspace.upstream, { recursive: true });

    expect(listUnsavedWorkTrees(workspace.scratchFolder)).toEqual([]);
  });

  it("lets go of a clone whose remote holds a tag on commits that no branch holds", () => {
    const workspace = createWorkspace();
    tagCommitOutsideEveryBranch(workspace.upstream);
    fetchEveryTag(workspace.clone);

    expect(listUnsavedWorkTrees(workspace.scratchFolder)).toEqual([]);
  });

  it("finds a clone with a tag of its own on a commit that no branch holds, beside a tag its remote holds", () => {
    const workspace = createWorkspace();
    tagCommitOutsideEveryBranch(workspace.upstream);
    fetchEveryTag(workspace.clone);
    commitFile({ workTree: workspace.clone, fileName: "feature.ts" });
    runGitCommand({ folder: workspace.clone, command: ["tag", "backup"] });
    runGitCommand({ folder: workspace.clone, command: ["reset", "--quiet", "--hard", "origin/main"] });

    expect(listUnsavedWorkTrees(workspace.scratchFolder)).toEqual([workspace.clone]);
  });

  it("finds a clone that moved a tag of its remote onto a commit of its own", () => {
    const workspace = createWorkspace();
    tagCommitOutsideEveryBranch(workspace.upstream);
    fetchEveryTag(workspace.clone);
    commitFile({ workTree: workspace.clone, fileName: "feature.ts" });
    runGitCommand({ folder: workspace.clone, command: ["tag", "--force", "archive/release"] });
    runGitCommand({ folder: workspace.clone, command: ["reset", "--quiet", "--hard", "origin/main"] });

    expect(listUnsavedWorkTrees(workspace.scratchFolder)).toEqual([workspace.clone]);
  });

  it("keeps a clone whose remote can no longer say which tags it holds", () => {
    const workspace = createWorkspace();
    tagCommitOutsideEveryBranch(workspace.upstream);
    fetchEveryTag(workspace.clone);
    rmSync(workspace.upstream, { recursive: true });

    expect(listUnsavedWorkTrees(workspace.scratchFolder)).toEqual([workspace.clone]);
  });

  it("finds a file that appears in a clone while its remote is asked about tags", () => {
    const workspace = createWorkspace();
    tagCommitOutsideEveryBranch(workspace.upstream);
    fetchEveryTag(workspace.clone);
    const lateFile = path.join(workspace.clone, "late.ts");
    // Git runs this in place of the program that answers for a remote on the same machine.
    const answerAfterNewFile = `touch '${lateFile}'; git upload-pack`;
    runGitCommand({ folder: workspace.clone, command: ["config", "remote.origin.uploadpack", answerAfterNewFile] });

    expect(listUnsavedWorkTrees(workspace.scratchFolder)).toEqual([workspace.clone]);
    expect(existsSync(lateFile)).toBe(true);
  });

  it("does not read the name of a remote as an option", () => {
    const workspace = createWorkspace();
    tagCommitOutsideEveryBranch(workspace.upstream);
    fetchEveryTag(workspace.clone);
    const optionProof = path.join(path.dirname(workspace.upstream), "option-was-read");
    const remoteNamedLikeOption = `--upload-pack=touch '${optionProof}';`;
    runGitCommand({
      folder: workspace.clone,
      command: ["config", `remote.${remoteNamedLikeOption}.url`, workspace.upstream],
    });

    expect(listUnsavedWorkTrees(workspace.scratchFolder)).toEqual([]);
    expect(existsSync(optionProof)).toBe(false);
  });

  it("does not run a password helper for a remote that wants a password", async () => {
    const workspace = createWorkspace();
    tagCommitOutsideEveryBranch(workspace.upstream);
    fetchEveryTag(workspace.clone);
    const passwordRemote = await startPasswordRemote();
    runGitCommand({ folder: workspace.clone, command: ["remote", "set-url", "origin", passwordRemote] });
    const helperProof = path.join(path.dirname(workspace.upstream), "helper-ran");
    const passwordHelper = path.join(path.dirname(workspace.upstream), "password-helper.sh");
    writeFileSync(passwordHelper, `#!/bin/sh\ntouch '${helperProof}'\necho secret\n`, { mode: 0o755 });
    runGitCommand({ folder: workspace.clone, command: ["config", "core.askPass", passwordHelper] });
    vi.stubEnv("SSH_ASKPASS", passwordHelper);

    expect(listUnsavedWorkTrees(workspace.scratchFolder)).toEqual([workspace.clone]);
    expect(existsSync(helperProof)).toBe(false);
  });

  it("tells ssh not to ask a password helper either", () => {
    const workspace = createWorkspace();
    tagCommitOutsideEveryBranch(workspace.upstream);
    fetchEveryTag(workspace.clone);
    const helperRule = path.join(path.dirname(workspace.upstream), "helper-rule");
    // Stands in for ssh: it writes down the rule it was given and connects to nothing.
    const sshStandIn = `printenv SSH_ASKPASS_REQUIRE > '${helperRule}'; false`;
    runGitCommand({ folder: workspace.clone, command: ["config", "core.sshCommand", sshStandIn] });
    runGitCommand({
      folder: workspace.clone,
      command: ["remote", "set-url", "origin", "ssh://example.invalid/upstream.git"],
    });

    expect(listUnsavedWorkTrees(workspace.scratchFolder)).toEqual([workspace.clone]);
    expect(readFileSync(helperRule, "utf8")).toBe("never\n");
  });

  it("lets go of a clone whose missing submodule has a tag that its remote holds on commits no branch holds", () => {
    const workspace = createWorkspace();
    const submodule = addPushedSubmodule(workspace);
    const library = readLibraryOf(workspace);
    tagCommitOutsideEveryBranch(library);
    fetchEveryTag(submodule);
    rmSync(submodule, { recursive: true });

    expect(listUnsavedWorkTrees(workspace.scratchFolder)).toEqual([]);
  });

  it("finds a clone with stashed changes", () => {
    const workspace = createWorkspace();
    writeFileSync(path.join(workspace.clone, "README.md"), "edited\n");
    runGitCommand({ folder: workspace.clone, command: ["stash", "--quiet"] });

    expect(listUnsavedWorkTrees(workspace.scratchFolder)).toEqual([workspace.clone]);
  });

  it("finds a repository that was never pushed anywhere", () => {
    const workspace = createWorkspace();
    const localRepository = path.join(workspace.scratchFolder, "prototype");
    mkdirSync(localRepository);
    runGitCommand({ folder: localRepository, command: ["init", "--quiet"] });
    commitFile({ workTree: localRepository, fileName: "prototype.ts" });

    expect(listUnsavedWorkTrees(workspace.scratchFolder)).toEqual([localRepository]);
  });

  it("lets go of a clean linked worktree, whose branch stays in its main repository", () => {
    const workspace = createWorkspace();
    const linkedWorkTree = path.join(workspace.scratchFolder, "linked");
    runGitCommand({
      folder: workspace.upstream,
      command: ["worktree", "add", "--quiet", "-b", "feature", linkedWorkTree],
    });
    commitFile({ workTree: linkedWorkTree, fileName: "feature.ts" });

    expect(listUnsavedWorkTrees(workspace.scratchFolder)).toEqual([]);
  });

  it("finds a linked worktree whose commits are on no branch", () => {
    const workspace = createWorkspace();
    const linkedWorkTree = path.join(workspace.scratchFolder, "linked");
    runGitCommand({ folder: workspace.upstream, command: ["worktree", "add", "--quiet", "--detach", linkedWorkTree] });
    commitFile({ workTree: linkedWorkTree, fileName: "feature.ts" });

    expect(listUnsavedWorkTrees(workspace.scratchFolder)).toEqual([linkedWorkTree]);
  });

  it("lets go of a linked worktree checked out at a tag, which stays in its main repository", () => {
    const workspace = createWorkspace();
    tagCommitOutsideEveryBranch(workspace.upstream);
    const linkedWorkTree = path.join(workspace.scratchFolder, "linked");
    const checkout = ["worktree", "add", "--quiet", "--detach", linkedWorkTree, "archive/release"];
    runGitCommand({ folder: workspace.upstream, command: checkout });

    expect(listUnsavedWorkTrees(workspace.scratchFolder)).toEqual([]);
  });

  it("lets go of a linked worktree whose pushed submodule folder is only missing", () => {
    const workspace = createWorkspace();
    const linked = addLinkedWorkTreeWithSubmodule(workspace);
    rmSync(linked.submodule, { recursive: true });

    expect(listUnsavedWorkTrees(workspace.scratchFolder)).toEqual([]);
  });

  it("finds a linked worktree whose missing submodule left a commit on no remote in its repository", () => {
    const workspace = createWorkspace();
    const linked = addLinkedWorkTreeWithSubmodule(workspace);
    commitFile({ workTree: linked.submodule, fileName: "feature.ts" });
    rmSync(linked.submodule, { recursive: true });

    expect(listUnsavedWorkTrees(workspace.scratchFolder)).toEqual([linked.workTree]);
  });

  it("lets go of a clone whose linked worktree in an ignored folder is clean", () => {
    const workspace = createWorkspace();
    const nestedWorkTree = path.join(ignoreWorktreesFolder(workspace), "feature");
    runGitCommand({
      folder: workspace.clone,
      command: ["worktree", "add", "--quiet", "-b", "feature", nestedWorkTree],
    });

    expect(listUnsavedWorkTrees(workspace.scratchFolder)).toEqual([]);
  });

  it("finds a clone whose linked worktree in an ignored folder holds a changed file", () => {
    const workspace = createWorkspace();
    const nestedWorkTree = path.join(ignoreWorktreesFolder(workspace), "feature");
    runGitCommand({
      folder: workspace.clone,
      command: ["worktree", "add", "--quiet", "-b", "feature", nestedWorkTree],
    });
    writeFileSync(path.join(nestedWorkTree, "README.md"), "edited\n");

    expect(listUnsavedWorkTrees(workspace.scratchFolder)).toEqual([workspace.clone]);
  });

  it("finds a clone that holds, in an ignored folder, another clone with a commit on no remote", () => {
    const workspace = createWorkspace();
    const nestedClone = path.join(ignoreWorktreesFolder(workspace), "tools", "prototype");
    mkdirSync(path.dirname(nestedClone), { recursive: true });
    runGitCommand({ folder: workspace.clone, command: ["clone", "--quiet", workspace.upstream, nestedClone] });
    commitFile({ workTree: nestedClone, fileName: "feature.ts" });

    expect(listUnsavedWorkTrees(workspace.scratchFolder)).toEqual([workspace.clone]);
  });

  it("does not look for work trees inside a clone's own .git folder", () => {
    const workspace = createWorkspace();
    mkdirSync(path.join(workspace.clone, ".git", "leftover", ".git"), { recursive: true });

    expect(listUnsavedWorkTrees(workspace.scratchFolder)).toEqual([]);
  });

  it("asks each work tree's own repository even when git variables point at another one", () => {
    const workspace = createWorkspace();
    writeFileSync(path.join(workspace.clone, "feature.ts"), "export const feature = 1;\n");
    vi.stubEnv("GIT_DIR", path.join(workspace.upstream, ".git"));
    vi.stubEnv("GIT_WORK_TREE", workspace.upstream);

    expect(listUnsavedWorkTrees(workspace.scratchFolder)).toEqual([workspace.clone]);
  });
});
