import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { FileSystem, Path } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import { defaultConfig } from "../config/config-schema.js";
import { install } from "./install.js";
import { uninstall } from "./uninstall.js";
import { update } from "./update.js";

const installEffect = (request: unknown) =>
  Effect.tryPromise({ try: (signal) => install(request, signal), catch: (error) => error });

const uninstallEffect = (request: unknown) =>
  Effect.tryPromise({ try: (signal) => uninstall(request, signal), catch: (error) => error });

const packageFiles = {
  "hooks/scratch-folder-guard/hooks/scratch-folder-guard.js": "export {};\n",
  "hooks/scratch-folder-guard/hooks/ask-scratch-cleanup.js": "export {};\n",
  "hooks/scratch-folder-guard/hooks/clear-session-scratch.js": "export {};\n",
  "hooks/leftover-process-cleanup/hooks/stop-leftover-processes.js": "export {};\n",
};

const claudeSettingsPath = ".claude/settings.json";
const codexHooksPath = ".codex/hooks.json";
const receiptPath = ".claude/agent-setup/receipt.json";

const userStop = { hooks: [{ type: "command", command: "user-stop" }] };
const foreignStop = { hooks: [{ type: "command", command: "agent-voice-stop" }] };

interface Workspace {
  root: string;
  canonicalRoot: string;
  preparedRoot: string;
}

interface ReceiptHookEvent {
  pointer: string;
  previouslyPresent: boolean;
}

interface ReceiptHookEntriesOwnership {
  filePreviouslyPresent: boolean;
  createdContainers: ReadonlyArray<string>;
  events: ReadonlyArray<ReceiptHookEvent>;
}

const temporaryDirectories: string[] = [];

afterEach(async () => {
  const directoriesToRemove = temporaryDirectories.splice(0);
  await Promise.all(directoriesToRemove.map((directory) => rm(directory, { recursive: true, force: true })));
});

const jsonContents = (document: object) => `${JSON.stringify(document, null, 2)}\n`;

const sha256 = (contents: string): string => createHash("sha256").update(contents).digest("hex");

// Runs an installer effect the way the CLI does: the Node file system and path services.
const runInstaller = <Success>(
  installerEffect: Effect.Effect<Success, unknown, FileSystem.FileSystem | Path.Path>,
): Promise<Success> => Effect.runPromise(installerEffect.pipe(Effect.provide(NodeContext.layer)));

const makeTemporaryDirectory = async (prefix: string): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);

  return directory;
};

const writeFiles = async (base: string, files: Readonly<Record<string, string>>): Promise<void> => {
  await Promise.all(
    Object.entries(files).map(async ([relativePath, contents]) => {
      const destination = join(base, relativePath);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, contents);
    }),
  );
};

const readFileContents = (root: string, relativePath: string): Promise<string> =>
  readFile(join(root, relativePath), "utf8");

const readJsonFile = async (root: string, relativePath: string) => {
  const fileContents = await readFileContents(root, relativePath);

  return JSON.parse(fileContents);
};

const createWorkspace = async (): Promise<Workspace> => {
  const root = await makeTemporaryDirectory("agent-setup-hook-settings-root-");
  // The installer writes to the canonical root, where macOS turns /var into /private/var.
  const canonicalRoot = await realpath(root);
  const preparedRoot = await makeTemporaryDirectory("agent-setup-hook-settings-prepared-");
  await writeFiles(preparedRoot, packageFiles);

  return { root, canonicalRoot, preparedRoot };
};

// Another tool, such as agent-voice, appends its own Stop entry and rewrites the file in its own format.
const appendForeignStop = async (root: string, relativePath: string): Promise<void> => {
  const settings = await readJsonFile(root, relativePath);
  settings.hooks.Stop.push(foreignStop);
  await writeFiles(root, { [relativePath]: JSON.stringify(settings) });
};

const installRequest = (input: { root: string; preparedRoot: string; agentIds: ReadonlyArray<string> }) => ({
  destination: { _tag: "project", root: input.root },
  host: { homeRoot: input.root },
  preparedPackage: { root: input.preparedRoot, version: "0.12.0" },
  features: { _tag: "selected", ids: ["scratch-folder-guard"] },
  agents: { _tag: "selected", ids: input.agentIds },
  interaction: { _tag: "scripted" },
  configuration: { _tag: "selected", config: defaultConfig },
});

const uninstallRequest = (root: string) => ({
  destination: { _tag: "project", root },
  host: { homeRoot: root },
  interaction: { _tag: "scripted" },
});

// Receipts before entry ownership hashed each whole /hooks/<event> array and kept the groups it replaced.
const legacyHookEventOwnership = (event: ReceiptHookEvent, hooks: Readonly<Record<string, unknown>>) => {
  const installedGroups = hooks[event.pointer.slice("/hooks/".length)];

  return {
    pointer: event.pointer,
    installed: { _tag: "value", hash: sha256(JSON.stringify(installedGroups)) },
    previous: event.previouslyPresent
      ? { _tag: "value", value: [userStop], lexical: { _tag: "value", source: JSON.stringify([userStop]) } }
      : { _tag: "missing" },
  };
};

const legacySettingsOwnership = (ownership: ReceiptHookEntriesOwnership, hooks: Readonly<Record<string, unknown>>) => ({
  _tag: "jsonValues",
  filePreviouslyPresent: ownership.filePreviouslyPresent,
  createdContainers: ownership.createdContainers,
  values: ownership.events.map((event) => legacyHookEventOwnership(event, hooks)),
});

describe("hook settings", () => {
  it("writes async true on background hooks for Claude Code only", async () => {
    const { root, preparedRoot } = await createWorkspace();
    const request = {
      ...installRequest({ root, preparedRoot, agentIds: ["claude-code", "codex"] }),
      features: { _tag: "selected", ids: ["leftover-process-cleanup"] },
    };

    await runInstaller(installEffect(request));

    const claudeHooks = (await readJsonFile(root, claudeSettingsPath)).hooks;
    const codexHooks = (await readJsonFile(root, codexHooksPath)).hooks;
    expect(claudeHooks.Stop[0].hooks[0].async).toBe(true);
    expect(claudeHooks.SubagentStop[0].hooks[0].async).toBe(true);
    expect(codexHooks.Stop[0].hooks[0].async).toBeUndefined();
    expect(codexHooks.SubagentStop).toBeUndefined();
  });

  it("replaces old camelCase hook entries that have no receipt and keeps a foreign Stop entry", async () => {
    const { root, canonicalRoot, preparedRoot } = await createWorkspace();
    const request = installRequest({ root, preparedRoot, agentIds: ["claude-code"] });
    const oldHookCommand = `node "${canonicalRoot}/.claude/agent-setup/hooks/scratchFolderGuard/hooks/askScratchCleanup.js"`;
    const oldInstalledStop = { hooks: [{ type: "command", command: oldHookCommand }] };
    await writeFiles(root, {
      [claudeSettingsPath]: jsonContents({ hooks: { Stop: [oldInstalledStop, foreignStop] } }),
    });

    await runInstaller(installEffect(request));

    const stopGroups = (await readJsonFile(root, claudeSettingsPath)).hooks.Stop;
    const stopCommands = stopGroups.flatMap((group: { hooks: Array<{ command: string }> }) =>
      group.hooks.map((hook) => hook.command),
    );
    expect(stopCommands).not.toContain(oldHookCommand);
    expect(stopCommands.filter((command: string) => command.includes("ask-scratch-cleanup.js"))).toHaveLength(1);
    expect(stopCommands).toContain("agent-voice-stop");
  });

  it("keeps a foreign Stop entry through install, update, and uninstall without reporting drift", async () => {
    const { root, preparedRoot } = await createWorkspace();
    const request = installRequest({ root, preparedRoot, agentIds: ["claude-code", "codex"] });
    await writeFiles(root, {
      [claudeSettingsPath]: jsonContents({ theme: "dark" }),
      [codexHooksPath]: jsonContents({ hooks: { Stop: [userStop] } }),
    });
    await runInstaller(installEffect(request));
    await appendForeignStop(root, claudeSettingsPath);
    await appendForeignStop(root, codexHooksPath);

    await runInstaller(installEffect(request));
    await runInstaller(update({ ...request, features: { _tag: "preserve" } }));
    await runInstaller(update({ ...request, features: { _tag: "refresh", ids: ["scratch-folder-guard"] } }));

    for (const hookFile of [claudeSettingsPath, codexHooksPath]) {
      const settings = await readFileContents(root, hookFile);
      expect(settings).toContain("agent-voice-stop");
      expect(settings).toContain("ask-scratch-cleanup.js");
    }

    await runInstaller(uninstallEffect(uninstallRequest(root)));

    expect(await readJsonFile(root, claudeSettingsPath)).toEqual({ theme: "dark", hooks: { Stop: [foreignStop] } });
    expect(await readJsonFile(root, codexHooksPath)).toEqual({ hooks: { Stop: [userStop, foreignStop] } });
  });

  it("still refuses an install after one of its own hook entries changed", async () => {
    const { root, preparedRoot } = await createWorkspace();
    const request = installRequest({ root, preparedRoot, agentIds: ["claude-code"] });
    await runInstaller(installEffect(request));
    const changedSettings = (await readFileContents(root, claudeSettingsPath)).replace(
      "ask-scratch-cleanup.js",
      "ask-scratch-cleanup.js --changed",
    );
    await writeFiles(root, { [claudeSettingsPath]: changedSettings });

    const installError = await runInstaller(Effect.flip(installEffect(request)));

    expect(installError).toMatchObject({
      message: expect.stringContaining(`Receipted hook entries in ${claudeSettingsPath}`),
    });
    expect(await readFileContents(root, claudeSettingsPath)).toBe(changedSettings);
  });

  it("migrates a whole-array settings receipt and keeps entries other tools appended since", async () => {
    const { root, preparedRoot } = await createWorkspace();
    const request = installRequest({ root, preparedRoot, agentIds: ["claude-code"] });
    await writeFiles(root, { [claudeSettingsPath]: jsonContents({ theme: "dark", hooks: { Stop: [userStop] } }) });
    await runInstaller(installEffect(request));
    const receipt = await readJsonFile(root, receiptPath);
    const hooks = (await readJsonFile(root, claudeSettingsPath)).hooks;
    const legacyOwnedFiles = receipt.ownedFiles.map((file: { path: string; ownership: ReceiptHookEntriesOwnership }) =>
      file.path === claudeSettingsPath ? { ...file, ownership: legacySettingsOwnership(file.ownership, hooks) } : file,
    );
    await writeFiles(root, { [receiptPath]: jsonContents({ ...receipt, ownedFiles: legacyOwnedFiles }) });
    await appendForeignStop(root, claudeSettingsPath);

    await runInstaller(installEffect(request));

    const migratedReceipt = await readJsonFile(root, receiptPath);
    const settingsEntry = migratedReceipt.ownedFiles.find((file: { path: string }) => file.path === claudeSettingsPath);
    expect(settingsEntry.ownership._tag).toBe("hookEntries");
    expect(settingsEntry.ownership.events).toContainEqual(
      expect.objectContaining({ pointer: "/hooks/Stop", previouslyPresent: true }),
    );

    await runInstaller(uninstallEffect(uninstallRequest(root)));

    expect(await readJsonFile(root, claudeSettingsPath)).toEqual({
      theme: "dark",
      hooks: { Stop: [userStop, foreignStop] },
    });
  });
});
