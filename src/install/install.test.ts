import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { defaultConfig } from "#src/config/config-schema.js";
import { install } from "./install.js";
import { installRequestSchema } from "./install-request.js";
import { planRestorations } from "./restore.js";

const notAbortedSignal = new AbortController().signal;

const stringEncoder = new TextEncoder();

const CLAUDE_SETTINGS_PATH = ".claude/settings.json";
const CODEX_HOOKS_PATH = ".codex/hooks.json";
const SETTINGS_PATH = ".claude/agent-setup/config.json";
const RECEIPT_PATH = ".claude/agent-setup/receipt.json";
const SCRATCH_GUARD_HOOK_PATH = ".claude/agent-setup/hooks/scratch-folder-guard/hooks/scratch-folder-guard.js";
const MAKE_CODE_READABLE_SKILL_PATH = ".claude/skills/make-code-readable/SKILL.md";
const AGENTS_INSTRUCTIONS_PATH = "AGENTS.md";

const scratchFolderRuntime = {
  "hooks/scratch-folder-guard/hooks/scratch-folder-guard.js": "export {};\n",
  "hooks/scratch-folder-guard/hooks/ask-scratch-cleanup.js": "export {};\n",
  "hooks/scratch-folder-guard/hooks/clear-session-scratch.js": "export {};\n",
  "hooks/scratch-folder-guard/command/clear-scratch.js": "export {};\n",
  "hooks/scratch-folder-guard/watchers/scratch-watcher.js": "export {};\n",
};

const makeCodeReadableSkill = {
  "skills/make-code-readable/SKILL.md": "---\nname: make-code-readable\n---\nRun the steps.\n",
  "skills/make-code-readable/references/examples.md": "# Examples\n",
  "skills/make-code-readable/references/review-and-apply.md": "# Review and apply\n",
};

const sessionRehomeRuntime = {
  "hooks/session-rehome/hooks/rehome-ended-session.js": "export {};\n",
  "hooks/session-rehome/hooks/announce-moved-session.js": "export {};\n",
};

const temporaryDirectories: string[] = [];

afterEach(async () => {
  const directoriesToRemove = temporaryDirectories.splice(0);
  await Promise.all(directoriesToRemove.map((directory) => rm(directory, { recursive: true, force: true })));
});

const createSha256Hex = (bytes: Uint8Array | string): string => createHash("sha256").update(bytes).digest("hex");

const makeTemporaryDirectory = async (prefix: string): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);

  return directory;
};

const createWorkspace = async (): Promise<{ root: string; preparedRoot: string }> => {
  const root = await makeTemporaryDirectory("agent-setup-install-root-");
  const preparedRoot = await makeTemporaryDirectory("agent-setup-install-prepared-");

  return { root, preparedRoot };
};

const writeFiles = async (base: string, files: Readonly<Record<string, string>>): Promise<void> => {
  for (const [relativePath, fileString] of Object.entries(files)) {
    const destination = join(base, relativePath);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, fileString);
  }
};

const readFileMessages = (root: string, relativePath: string): Promise<string> =>
  readFile(join(root, relativePath), "utf8");

const readReceipt = async (root: string) => {
  const receiptMessages = await readFileMessages(root, RECEIPT_PATH);

  return JSON.parse(receiptMessages);
};

// e.g. {"hooks":{"Stop":[{"hooks":[{"command":"node \\"/x.js\\""}]}]}} → ['node "/x.js"']
const readHookCommands = (settingsString: string): ReadonlyArray<string> =>
  [...settingsString.matchAll(/"command"\s*:\s*("(?:[^"\\]|\\.)*")/g)].flatMap((commandHit) => {
    const isCommandMissing = commandHit[1] == null;
    return isCommandMissing ? [] : [String(JSON.parse(commandHit[1]))];
  });

const installRequest = (details: { root: string; preparedRoot: string }) => ({
  destination: { _tag: "project", root: details.root },
  host: { homeRoot: details.root },
  preparedPackage: { root: details.preparedRoot, version: "0.12.0" },
  features: { _tag: "selected", ids: ["scratch-folder-guard"] },
  agents: { _tag: "selected", ids: ["claude-code"] },
  interaction: { _tag: "scripted" },
  configuration: { _tag: "selected", config: defaultConfig },
});

describe("install", () => {
  it("installs one decoded prepared runtime, managed config, settings hook, and ownership receipt", async () => {
    const { root, preparedRoot } = await createWorkspace();
    await writeFiles(preparedRoot, scratchFolderRuntime);
    await writeFiles(root, {
      [CLAUDE_SETTINGS_PATH]:
        '{\n  "theme": "dark",\n  "hooks": {\n    "Stop": [{ "hooks": [{ "type": "command", "command": "user-command" }] }]\n  }\n}\n',
    });

    const installation = await install(installRequest({ root, preparedRoot }), notAbortedSignal);

    expect(installation).toMatchObject({
      _tag: "installed",
      scope: "project",
      features: ["scratch-folder-guard"],
      agents: ["claude-code"],
    });
    expect(installation.platformRequirements).toEqual([{ featureId: "scratch-folder-guard", platform: "any" }]);
    expect(await readFileMessages(root, SCRATCH_GUARD_HOOK_PATH)).toBe("export {};\n");
    expect(JSON.parse(await readFileMessages(root, SETTINGS_PATH))).toEqual(defaultConfig);

    const settings = await readFileMessages(root, CLAUDE_SETTINGS_PATH);
    expect(settings).toContain('"theme": "dark"');
    expect(settings).toContain("user-command");
    expect(settings).toContain("scratch-folder-guard/hooks/scratch-folder-guard.js");

    const receipt = await readReceipt(root);
    expect(receipt.features).toEqual(["scratch-folder-guard"]);
    expect(receipt.ownedFiles.map((file: { path: string }) => file.path)).toEqual([
      ".claude/agent-setup/hooks/scratch-folder-guard/command/clear-scratch.js",
      ".claude/agent-setup/hooks/scratch-folder-guard/hooks/ask-scratch-cleanup.js",
      ".claude/agent-setup/hooks/scratch-folder-guard/hooks/clear-session-scratch.js",
      ".claude/agent-setup/hooks/scratch-folder-guard/hooks/scratch-folder-guard.js",
      ".claude/agent-setup/hooks/scratch-folder-guard/watchers/scratch-watcher.js",
      ".claude/agent-setup/config.json",
      ".claude/settings.json",
    ]);
  });

  it("adds named features to the installed selection and keeps every installed feature", async () => {
    const { root, preparedRoot } = await createWorkspace();
    await writeFiles(preparedRoot, { ...scratchFolderRuntime, ...sessionRehomeRuntime });
    await install(installRequest({ root, preparedRoot }), notAbortedSignal);

    const installation = await install(
      {
        ...installRequest({ root, preparedRoot }),
        features: { _tag: "selected", ids: ["session-rehome"] },
      },
      notAbortedSignal,
    );

    expect(installation.features).toEqual(["scratch-folder-guard", "session-rehome"]);
    expect((await readReceipt(root)).features).toEqual(["scratch-folder-guard", "session-rehome"]);
    expect(existsSync(join(root, SCRATCH_GUARD_HOOK_PATH))).toBe(true);

    const commands = readHookCommands(await readFileMessages(root, CLAUDE_SETTINGS_PATH));
    expect(commands.some((command) => command.includes("scratch-folder-guard/hooks/scratch-folder-guard.js"))).toBe(
      true,
    );
    expect(commands.some((command) => command.includes("session-rehome/hooks/rehome-ended-session.js"))).toBe(true);
  });

  it("installs native hooks for detected Codex and Grok without replacing user hooks", async () => {
    const { root, preparedRoot } = await createWorkspace();
    await writeFiles(preparedRoot, sessionRehomeRuntime);
    await writeFiles(root, {
      [CODEX_HOOKS_PATH]:
        '{\n  "keep": true,\n  "hooks": { "Stop": [{ "hooks": [{ "type": "command", "command": "user-stop" }] }] }\n}\n',
    });

    await install(
      {
        ...installRequest({ root, preparedRoot }),
        features: { _tag: "selected", ids: ["session-rehome"] },
        agents: { _tag: "selected", ids: ["codex", "grok"] },
      },
      notAbortedSignal,
    );

    const codex = await readFileMessages(root, CODEX_HOOKS_PATH);
    expect(codex).toContain('"keep": true');
    expect(codex).toContain("user-stop");
    expect(codex).toContain("AGENT_SETUP_AGENT_ID=codex node ");

    const grok = await readFileMessages(root, ".grok/hooks/agent-setup.json");
    expect(grok).toContain("AGENT_SETUP_AGENT_ID=grok");
    expect(grok).toContain("rehome-ended-session.js");
    expect(existsSync(join(root, CLAUDE_SETTINGS_PATH))).toBe(false);
  });

  it("passes the agent id to the session-rehome hooks for Claude, Codex, and Grok", async () => {
    const { root, preparedRoot } = await createWorkspace();
    await writeFiles(preparedRoot, {
      "hooks/session-rehome/hooks/rehome-ended-session.js": "export {};\n",
      "hooks/session-rehome/hooks/announce-moved-session.js": "export {};\n",
    });

    await install(
      {
        ...installRequest({ root, preparedRoot }),
        features: { _tag: "selected", ids: ["session-rehome"] },
        agents: { _tag: "selected", ids: ["claude-code", "codex", "grok"] },
      },
      notAbortedSignal,
    );

    expect(await readFileMessages(root, CLAUDE_SETTINGS_PATH)).toContain("AGENT_SETUP_AGENT_ID=claude-code node ");
    expect(await readFileMessages(root, CODEX_HOOKS_PATH)).toContain("AGENT_SETUP_AGENT_ID=codex node ");
    expect(await readFileMessages(root, ".grok/hooks/agent-setup.json")).toContain("AGENT_SETUP_AGENT_ID=grok node ");
  });

  it("returns unchanged without rewriting an identical installation", async () => {
    const { root, preparedRoot } = await createWorkspace();
    const request = installRequest({ root, preparedRoot });
    await writeFiles(preparedRoot, scratchFolderRuntime);

    await install(request, notAbortedSignal);
    const receiptBefore = await readFileMessages(root, RECEIPT_PATH);
    const installation = await install(request, notAbortedSignal);

    expect(installation._tag).toBe("unchanged");
    expect(await readFileMessages(root, RECEIPT_PATH)).toBe(receiptBefore);
  });

  it("adopts a receipted skill file an external sync rewrote with the exact desired bytes", async () => {
    const { root, preparedRoot } = await createWorkspace();
    const request = {
      ...installRequest({ root, preparedRoot }),
      features: { _tag: "selected", ids: ["make-code-readable"] },
      agents: { _tag: "selected", ids: ["claude-code"] },
    };
    await writeFiles(preparedRoot, { ...scratchFolderRuntime, ...makeCodeReadableSkill });
    await install(request, notAbortedSignal);

    // Ship a newer skill, then let an external sync write that same rendered content first.
    await writeFiles(preparedRoot, {
      "skills/make-code-readable/SKILL.md": "---\nname: make-code-readable\n---\nRun the steps after every handoff.\n",
    });
    const synced = "---\nname: make-code-readable\n---\nRun the steps after every handoff.\n";
    await writeFiles(root, { [MAKE_CODE_READABLE_SKILL_PATH]: synced });

    const installation = await install(request, notAbortedSignal);

    expect(installation._tag).toBe("installed");
    expect(await readFileMessages(root, MAKE_CODE_READABLE_SKILL_PATH)).toBe(synced);

    // The refreshed receipt must describe the adopted bytes, so the next install stays clean.
    const adoptedSkillLine = (await readReceipt(root)).ownedFiles.find(
      (file: { path: string }) => file.path === MAKE_CODE_READABLE_SKILL_PATH,
    );
    const adoptedSkillBytes = await readFile(join(root, MAKE_CODE_READABLE_SKILL_PATH));
    expect(adoptedSkillLine.ownership.installedHash).toBe(createSha256Hex(adoptedSkillBytes));

    // The next install must still succeed on the adopted bytes.
    await install(request, notAbortedSignal);
  });

  it("still refuses a receipted skill file rewritten with content it would not write", async () => {
    const { root, preparedRoot } = await createWorkspace();
    const handWritten = "---\nname: make-code-readable\n---\nMy own hand-written notes.\n";
    const request = {
      ...installRequest({ root, preparedRoot }),
      features: { _tag: "selected", ids: ["make-code-readable"] },
      agents: { _tag: "selected", ids: ["claude-code"] },
    };
    await writeFiles(preparedRoot, { ...scratchFolderRuntime, ...makeCodeReadableSkill });
    await install(request, notAbortedSignal);
    await writeFiles(root, { [MAKE_CODE_READABLE_SKILL_PATH]: handWritten });

    await expect(install(request, notAbortedSignal)).rejects.toThrow();
    expect(await readFileMessages(root, MAKE_CODE_READABLE_SKILL_PATH)).toBe(handWritten);
  });

  it("plans all four native agent formats without duplicate instruction destinations", async () => {
    const { root, preparedRoot } = await createWorkspace();
    await writeFiles(preparedRoot, { ...scratchFolderRuntime, ...makeCodeReadableSkill });

    await install(
      {
        ...installRequest({ root, preparedRoot }),
        features: { _tag: "selected", ids: ["make-code-readable"] },
        agents: { _tag: "selected", ids: ["continue", "aider", "codex", "cursor", "claude-code"] },
      },
      notAbortedSignal,
    );

    expect(await readFileMessages(root, MAKE_CODE_READABLE_SKILL_PATH)).toContain("Run");
    expect(await readFileMessages(root, ".agents/skills/make-code-readable/SKILL.md")).toContain("Run");
    expect(existsSync(join(root, ".codex/skills/make-code-readable/SKILL.md"))).toBe(false);
    expect(await readFileMessages(root, ".cursor/rules/make-code-readable.mdc")).toContain("Run the steps.");

    const instructions = await readFileMessages(root, AGENTS_INSTRUCTIONS_PATH);
    expect(instructions.match(/<!-- agent-setup:skills start -->/g)).toHaveLength(1);
    expect(instructions).toContain("## make-code-readable");
    expect(await readFileMessages(root, ".aider.conf.yml")).toContain("AGENTS.md");
    expect(JSON.parse(await readFileMessages(root, ".continue/config.json")).rules).toEqual(["AGENTS.md"]);

    const instructionFiles = (await readReceipt(root)).ownedFiles.filter(
      (file: { kind: { _tag: string }; path: string }) =>
        file.kind._tag === "instruction" && file.path === AGENTS_INSTRUCTIONS_PATH,
    );
    expect(instructionFiles).toHaveLength(1);
    expect(instructionFiles[0].owner.agentIds).toEqual(["aider", "continue"]);
  });

  it("rejects an extra prepared skill file before writing host files", async () => {
    const { root, preparedRoot } = await createWorkspace();
    await writeFiles(preparedRoot, {
      ...scratchFolderRuntime,
      ...makeCodeReadableSkill,
      "skills/make-code-readable/EXTRA.md": "not catalog-shipped\n",
    });
    const extraFileRequest = {
      ...installRequest({ root, preparedRoot }),
      features: { _tag: "selected", ids: ["make-code-readable"] },
    };

    await expect(install(extraFileRequest, notAbortedSignal)).rejects.toThrow();
    expect(existsSync(join(root, RECEIPT_PATH))).toBe(false);
    expect(existsSync(join(root, SETTINGS_PATH))).toBe(false);
  });

  it("copies a validated global config once into a first project installation", async () => {
    const { root: homeRoot, preparedRoot } = await createWorkspace();
    const projectRoot = await makeTemporaryDirectory("agent-setup-install-project-");
    const globalSettings = { ...defaultConfig, sessionRehomeRoots: ["vendor"] };
    const writeGlobalSettings = (globalSettings: object) =>
      writeFiles(homeRoot, { [SETTINGS_PATH]: `${JSON.stringify(globalSettings, null, 2)}\n` });
    const request = {
      ...installRequest({ root: projectRoot, preparedRoot }),
      host: { homeRoot },
      configuration: { _tag: "automatic" },
    };
    await writeFiles(preparedRoot, scratchFolderRuntime);
    await writeGlobalSettings(globalSettings);

    await install(request, notAbortedSignal);
    await writeGlobalSettings({ ...globalSettings, sessionRehomeRoots: ["generated"] });
    await install(request, notAbortedSignal);

    expect(JSON.parse(await readFileMessages(projectRoot, SETTINGS_PATH))).toEqual(globalSettings);
  });

  it("uses one canonical root for inspection, writes, and generated commands", async () => {
    const container = await makeTemporaryDirectory("agent-setup-install-container-");
    const preparedRoot = await makeTemporaryDirectory("agent-setup-install-prepared-");
    const realRoot = join(container, "realRoot");
    const linkedRoot = join(container, "linkedRoot");
    await mkdir(realRoot);
    await symlink(realRoot, linkedRoot);
    await writeFiles(preparedRoot, scratchFolderRuntime);

    await install(installRequest({ root: linkedRoot, preparedRoot }), notAbortedSignal);

    const settings = await readFileMessages(realRoot, CLAUDE_SETTINGS_PATH);
    expect(settings).toContain(realRoot);
    expect(settings).not.toContain(linkedRoot);
  });

  it("removes installer-created whole files even when they drifted or vanished", async () => {
    const root = await makeTemporaryDirectory("agent-setup-install-root-");
    const driftedPath = SCRATCH_GUARD_HOOK_PATH;
    const exactPath = ".claude/agent-setup/hooks/scratch-folder-guard/lib/hook-config.js";
    await writeFiles(root, { [driftedPath]: "drifted after install\n", [exactPath]: "exact\n" });
    const createWholeFileLine = (filePath: string, hash: string) => ({
      owner: { _tag: "application" as const },
      path: filePath,
      kind: { _tag: "runtime" as const },
      ownership: { _tag: "wholeFile" as const, installedHash: hash, previous: { _tag: "missing" as const } },
    });

    const restorations = await planRestorations({
      root,
      files: [
        createWholeFileLine(driftedPath, createSha256Hex("old\n")),
        createWholeFileLine(
          ".claude/agent-setup/hooks/scratch-folder-guard/lib/scratchState.js",
          createSha256Hex("old\n"),
        ),
        createWholeFileLine(exactPath, createSha256Hex("exact\n")),
      ],
    });

    expect(restorations).toHaveLength(3);
    expect(restorations.every((operation) => operation._tag === "remove")).toBe(true);
  });

  it("still refuses to restore a prior host file that drifted after install", async () => {
    const root = await makeTemporaryDirectory("agent-setup-install-root-");
    await writeFiles(root, { "owned.txt": "user edited\n" });

    await expect(
      planRestorations({
        root,
        files: [
          {
            owner: { _tag: "application" },
            path: "owned.txt",
            kind: { _tag: "runtime" },
            ownership: {
              _tag: "wholeFile",
              installedHash: createSha256Hex("installed\n"),
              previous: { _tag: "priorFile", bytes: stringEncoder.encode("prior\n") },
            },
          },
        ],
      }),
    ).rejects.toThrow("changed after installation");
  });

  it("strictly rejects unknown request properties", () => {
    const decoded = installRequestSchema.safeParse({
      ...installRequest({ root: "/workspace", preparedRoot: "/package/dist" }),
      global: true,
    });

    expect(decoded.success).toBe(false);
  });

  it.each(["/workspace/$HOME", '/workspace/"quoted"', "/workspace/`command`", "/workspace/back\\slash"])(
    "rejects an installation root that cannot be embedded safely in generated commands: %s",
    (root) => {
      const decoded = installRequestSchema.safeParse(installRequest({ root, preparedRoot: "/package/dist" }));

      expect(decoded.success).toBe(false);
    },
  );
});
