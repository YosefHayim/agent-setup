import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { defaultConfig } from "../config/config-schema.js";
import { install } from "./install.js";
import { uninstall, uninstallRequestSchema } from "./uninstall.js";

const packageFiles = {
  "hooks/scratch-folder-guard/hooks/scratch-folder-guard.js": "export {};\n",
  "hooks/scratch-folder-guard/hooks/ask-scratch-cleanup.js": "export {};\n",
  "hooks/scratch-folder-guard/hooks/clear-session-scratch.js": "export {};\n",
  "hooks/scratch-folder-guard/command/clear-scratch.js": "export {};\n",
  "hooks/scratch-folder-guard/watchers/scratch-watcher.js": "export {};\n",
  "skills/make-code-readable/SKILL.md": "---\nname: make-code-readable\n---\nRun the steps.\n",
  "skills/make-code-readable/references/examples.md": "# Examples\n",
  "skills/make-code-readable/references/review-and-apply.md": "# Review and apply\n",
};

const notAbortedSignal = new AbortController().signal;

const temporaryDirectories: string[] = [];

afterEach(async () => {
  const directoriesToRemove = temporaryDirectories.splice(0);
  await Promise.all(directoriesToRemove.map((directory) => rm(directory, { recursive: true, force: true })));
});

const makeTemporaryDirectory = async (prefix: string): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);

  return directory;
};

const writeFiles = async (base: string, files: Readonly<Record<string, string>>): Promise<void> => {
  for (const [relativePath, fileString] of Object.entries(files)) {
    const destination = join(base, relativePath);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, fileString);
  }
};

const createWorkspace = async (): Promise<{ root: string; preparedRoot: string }> => {
  const root = await makeTemporaryDirectory("agent-setup-uninstall-root-");
  const preparedRoot = await makeTemporaryDirectory("agent-setup-uninstall-prepared-");
  await writeFiles(preparedRoot, packageFiles);

  return { root, preparedRoot };
};

const readFileContents = (root: string, relativePath: string): Promise<string> =>
  readFile(join(root, relativePath), "utf8");

const installRequest = (input: { root: string; preparedRoot: string }) => ({
  destination: { _tag: "project", root: input.root },
  host: { homeRoot: input.root },
  preparedPackage: { root: input.preparedRoot, version: "0.12.0" },
  features: { _tag: "selected", ids: ["make-code-readable", "scratch-folder-guard"] },
  agents: { _tag: "selected", ids: ["claude-code", "cursor", "codex", "aider", "continue"] },
  interaction: { _tag: "scripted" },
  configuration: { _tag: "selected", config: { ...defaultConfig, sessionRehomeRoots: ["vendor"] } },
});

const uninstallRequest = (root: string) => ({
  destination: { _tag: "project", root },
  host: { homeRoot: root },
  interaction: { _tag: "scripted" },
});

const uninstalled = { _tag: "uninstalled", scope: "project", interaction: { _tag: "scripted" } };

describe("uninstall", () => {
  it("restores every receipted format exactly and removes installer-created files", async () => {
    const { root, preparedRoot } = await createWorkspace();
    const originals = {
      ".claude/agent-setup/config.json": `${JSON.stringify(defaultConfig, null, 2)}\n`,
      ".claude/settings.json": '{\r\n\t"theme":"dark",\r\n\t"hooks": { }\r\n}\r\n',
      "AGENTS.md": "User instructions.\n",
      ".aider.conf.yml": "model: sonnet\n",
      ".continue/config.json": '{\r\n\t"models": []\r\n}\r\n',
    };
    const installerCreatedFiles = [
      ".claude/agent-setup/receipt.json",
      ...Object.keys(packageFiles)
        .filter((packagePath) => packagePath.startsWith("hooks/"))
        .map((packagePath) => `.claude/agent-setup/${packagePath}`),
      ".claude/skills/make-code-readable/SKILL.md",
      ".cursor/rules/make-code-readable.mdc",
    ];

    await writeFiles(root, originals);
    await install(installRequest({ root, preparedRoot }), notAbortedSignal);
    for (const created of installerCreatedFiles) {
      expect(existsSync(join(root, created))).toBe(true);
    }

    const uninstallation = await uninstall(uninstallRequest(root), notAbortedSignal);
    for (const [relativePath, fileString] of Object.entries(originals)) {
      expect(await readFileContents(root, relativePath)).toBe(fileString);
    }
    for (const created of installerCreatedFiles) {
      expect(existsSync(join(root, created))).toBe(false);
    }
    expect(uninstallation).toEqual(uninstalled);
  });

  it("leaves unreceipted agent files untouched", async () => {
    const { root, preparedRoot } = await createWorkspace();
    const userFiles = {
      ".cursor/rules/user.mdc": "User-owned rule.\n",
      ".claude/skills/user/SKILL.md": "User-owned skill.\n",
    };
    await install(installRequest({ root, preparedRoot }), notAbortedSignal);
    await writeFiles(root, userFiles);

    await uninstall(uninstallRequest(root), notAbortedSignal);

    for (const [relativePath, fileString] of Object.entries(userFiles)) {
      expect(await readFileContents(root, relativePath)).toBe(fileString);
    }
  });

  it("removes the folders its removed files leave empty and keeps folders still in use", async () => {
    const { root, preparedRoot } = await createWorkspace();
    await install(installRequest({ root, preparedRoot }), notAbortedSignal);
    await writeFiles(root, { ".claude/skills/user/SKILL.md": "User-owned skill.\n" });

    await uninstall(uninstallRequest(root), notAbortedSignal);

    for (const emptied of [".claude/agent-setup", ".claude/skills/make-code-readable", ".agents", ".cursor"]) {
      expect(existsSync(join(root, emptied))).toBe(false);
    }
    expect(existsSync(join(root, ".claude/skills/user/SKILL.md"))).toBe(true);
  });

  it("returns absent without mutating files when no receipt exists", async () => {
    const root = await makeTemporaryDirectory("agent-setup-uninstall-root-");
    await writeFiles(root, { ".cursor/rules/user.mdc": "User-owned rule.\n" });

    const uninstallation = await uninstall(uninstallRequest(root), notAbortedSignal);

    expect(uninstallation).toEqual({ ...uninstalled, _tag: "absent" });
    expect(await readFileContents(root, ".cursor/rules/user.mdc")).toBe("User-owned rule.\n");
  });

  // Runtime hooks were created from missing: uninstall force-removes them even if edited.
  // Drift still blocks only when a prior host file must be restored (wholeFile previous present).
  it("still removes installer-created files when their bytes drifted after install", async () => {
    const { root, preparedRoot } = await createWorkspace();
    const hookFile = ".claude/agent-setup/hooks/scratch-folder-guard/hooks/scratch-folder-guard.js";
    await install(installRequest({ root, preparedRoot }), notAbortedSignal);
    await writeFiles(root, { [hookFile]: "user changed this\n" });

    const uninstallation = await uninstall(uninstallRequest(root), notAbortedSignal);

    expect(uninstallation).toEqual(uninstalled);
    expect(existsSync(join(root, hookFile))).toBe(false);
    expect(existsSync(join(root, ".claude/agent-setup/receipt.json"))).toBe(false);
  });

  it("restores a multiline pre-existing hook value byte for byte", async () => {
    const { root, preparedRoot } = await createWorkspace();
    const originalSettings = [
      "{",
      '  "hooks": {',
      '    "PreToolUse": [',
      "      {",
      '        "matcher": "Read",',
      '        "hooks": [{ "type": "command", "command": "user-command" }]',
      "      }",
      "    ]",
      "  },",
      '  "theme": "dark"',
      "}",
      "",
    ].join("\n");
    await writeFiles(root, { ".claude/settings.json": originalSettings });
    await install(installRequest({ root, preparedRoot }), notAbortedSignal);

    await uninstall(uninstallRequest(root), notAbortedSignal);

    expect(await readFileContents(root, ".claude/settings.json")).toBe(originalSettings);
  });

  it("strictly rejects agent detection and prepared-package inputs", () => {
    const decodedCheck = uninstallRequestSchema.safeParse({
      ...uninstallRequest("/workspace"),
      agents: { _tag: "detected", evidence: { homePaths: [".cursor"], absolutePaths: [], commands: [] } },
      preparedPackage: { root: "/package/dist", version: "0.12.0" },
    });

    expect(decodedCheck.success).toBe(false);
  });
});
