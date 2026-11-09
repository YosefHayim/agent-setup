import { createHash } from "node:crypto";

import { FileSystem, Path } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { expect, layer } from "@effect/vitest";
import { Effect } from "effect";

import { defaultConfig } from "../config/config-schema.js";
import { install } from "./install.js";
import { uninstall } from "./uninstall.js";
import { update } from "./update.js";

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

const jsonText = (value: object) => `${JSON.stringify(value, null, 2)}\n`;

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

const workspace = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "agent-setup-hook-settings-root-" });
  const preparedRoot = yield* fileSystem.makeTempDirectoryScoped({ prefix: "agent-setup-hook-settings-prepared-" });
  const writeFiles = (base: string, files: Readonly<Record<string, string>>) =>
    Effect.forEach(Object.entries(files), ([relativePath, contents]) =>
      Effect.gen(function* () {
        const destination = path.join(base, relativePath);
        yield* fileSystem.makeDirectory(path.dirname(destination), { recursive: true });
        yield* fileSystem.writeFileString(destination, contents);
      }),
    );

  const readText = (relativePath: string) => fileSystem.readFileString(path.join(root, relativePath));

  const readJson = (relativePath: string) => Effect.map(readText(relativePath), (text) => JSON.parse(text));

  // Another tool, such as agent-voice, appends its own Stop entry and rewrites the file in its own format.
  const appendForeignStop = (relativePath: string) =>
    Effect.gen(function* () {
      const settings = yield* readJson(relativePath);
      settings.hooks.Stop.push(foreignStop);
      yield* writeFiles(root, { [relativePath]: JSON.stringify(settings) });
    });

  yield* writeFiles(preparedRoot, packageFiles);

  return { root, preparedRoot, writeFiles, readText, readJson, appendForeignStop };
});

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

type OwnedHookEventJson = { readonly pointer: string; readonly previouslyPresent: boolean };

type HookEntriesOwnershipJson = {
  readonly filePreviouslyPresent: boolean;
  readonly createdContainers: ReadonlyArray<string>;
  readonly events: ReadonlyArray<OwnedHookEventJson>;
};

// Receipts before entry ownership hashed each whole /hooks/<event> array and kept the groups it replaced.
const legacyOwnedValue = (input: { event: OwnedHookEventJson; hooks: Readonly<Record<string, unknown>> }) => {
  const installedGroups = input.hooks[input.event.pointer.slice("/hooks/".length)];

  return {
    pointer: input.event.pointer,
    installed: { _tag: "value", hash: sha256(JSON.stringify(installedGroups)) },
    previous: input.event.previouslyPresent
      ? { _tag: "value", value: [userStop], lexical: { _tag: "value", source: JSON.stringify([userStop]) } }
      : { _tag: "missing" },
  };
};

const legacySettingsOwnership = (input: {
  ownership: HookEntriesOwnershipJson;
  hooks: Readonly<Record<string, unknown>>;
}) => ({
  _tag: "jsonValues",
  filePreviouslyPresent: input.ownership.filePreviouslyPresent,
  createdContainers: input.ownership.createdContainers,
  values: input.ownership.events.map((event) => legacyOwnedValue({ event, hooks: input.hooks })),
});

layer(NodeContext.layer)("hook settings", (it) => {
  it.scoped("writes async true on background hooks for Claude Code only", () =>
    Effect.gen(function* () {
      const { root, preparedRoot, readJson } = yield* workspace;
      const request = {
        ...installRequest({ root, preparedRoot, agentIds: ["claude-code", "codex"] }),
        features: { _tag: "selected", ids: ["leftover-process-cleanup"] },
      };

      yield* install(request);

      const claudeHooks = (yield* readJson(claudeSettingsPath)).hooks;
      const codexHooks = (yield* readJson(codexHooksPath)).hooks;
      expect(claudeHooks.Stop[0].hooks[0].async).toBe(true);
      expect(claudeHooks.SubagentStop[0].hooks[0].async).toBe(true);
      expect(codexHooks.Stop[0].hooks[0].async).toBeUndefined();
      expect(codexHooks.SubagentStop).toBeUndefined();
    }),
  );

  it.scoped("replaces old camelCase hook entries that have no receipt and keeps a foreign Stop entry", () =>
    Effect.gen(function* () {
      const { root, preparedRoot, writeFiles, readJson } = yield* workspace;
      const request = installRequest({ root, preparedRoot, agentIds: ["claude-code"] });
      const oldHookCommand = `node "${root}/.claude/agent-setup/hooks/scratchFolderGuard/hooks/askScratchCleanup.js"`;
      const oldInstalledStop = { hooks: [{ type: "command", command: oldHookCommand }] };
      yield* writeFiles(root, {
        [claudeSettingsPath]: jsonText({ hooks: { Stop: [oldInstalledStop, foreignStop] } }),
      });

      yield* install(request);

      const stopGroups = (yield* readJson(claudeSettingsPath)).hooks.Stop;
      const stopCommands = stopGroups.flatMap((group: { hooks: Array<{ command: string }> }) =>
        group.hooks.map((hook) => hook.command),
      );
      expect(stopCommands).not.toContain(oldHookCommand);
      expect(stopCommands.filter((command: string) => command.includes("ask-scratch-cleanup.js"))).toHaveLength(1);
      expect(stopCommands).toContain("agent-voice-stop");
    }),
  );

  it.scoped("keeps a foreign Stop entry through install, update, and uninstall without reporting drift", () =>
    Effect.gen(function* () {
      const { root, preparedRoot, writeFiles, readText, readJson, appendForeignStop } = yield* workspace;
      const request = installRequest({ root, preparedRoot, agentIds: ["claude-code", "codex"] });
      yield* writeFiles(root, {
        [claudeSettingsPath]: jsonText({ theme: "dark" }),
        [codexHooksPath]: jsonText({ hooks: { Stop: [userStop] } }),
      });
      yield* install(request);
      yield* appendForeignStop(claudeSettingsPath);
      yield* appendForeignStop(codexHooksPath);

      yield* install(request);
      yield* update({ ...request, features: { _tag: "preserve" } });
      yield* update({ ...request, features: { _tag: "refresh", ids: ["scratch-folder-guard"] } });

      for (const hookFile of [claudeSettingsPath, codexHooksPath]) {
        const settings = yield* readText(hookFile);
        expect(settings).toContain("agent-voice-stop");
        expect(settings).toContain("ask-scratch-cleanup.js");
      }

      yield* uninstall(uninstallRequest(root));

      expect(yield* readJson(claudeSettingsPath)).toEqual({ theme: "dark", hooks: { Stop: [foreignStop] } });
      expect(yield* readJson(codexHooksPath)).toEqual({ hooks: { Stop: [userStop, foreignStop] } });
    }),
  );

  it.scoped("still refuses an install after one of its own hook entries changed", () =>
    Effect.gen(function* () {
      const { root, preparedRoot, writeFiles, readText } = yield* workspace;
      const request = installRequest({ root, preparedRoot, agentIds: ["claude-code"] });
      yield* install(request);
      const changedSettings = (yield* readText(claudeSettingsPath)).replace(
        "ask-scratch-cleanup.js",
        "ask-scratch-cleanup.js --changed",
      );
      yield* writeFiles(root, { [claudeSettingsPath]: changedSettings });

      const error = yield* Effect.flip(install(request));

      expect(error.message).toContain(`Receipted hook entries in ${claudeSettingsPath}`);
      expect(yield* readText(claudeSettingsPath)).toBe(changedSettings);
    }),
  );

  it.scoped("migrates a whole-array settings receipt and keeps entries other tools appended since", () =>
    Effect.gen(function* () {
      const { root, preparedRoot, writeFiles, readJson, appendForeignStop } = yield* workspace;
      const request = installRequest({ root, preparedRoot, agentIds: ["claude-code"] });
      yield* writeFiles(root, { [claudeSettingsPath]: jsonText({ theme: "dark", hooks: { Stop: [userStop] } }) });
      yield* install(request);
      const receipt = yield* readJson(receiptPath);
      const hooks = (yield* readJson(claudeSettingsPath)).hooks;
      const legacyOwnedFiles = receipt.ownedFiles.map((file: { path: string; ownership: HookEntriesOwnershipJson }) =>
        file.path === claudeSettingsPath
          ? { ...file, ownership: legacySettingsOwnership({ ownership: file.ownership, hooks }) }
          : file,
      );
      yield* writeFiles(root, { [receiptPath]: jsonText({ ...receipt, ownedFiles: legacyOwnedFiles }) });
      yield* appendForeignStop(claudeSettingsPath);

      yield* install(request);

      const migratedReceipt = yield* readJson(receiptPath);
      const settingsEntry = migratedReceipt.ownedFiles.find(
        (file: { path: string }) => file.path === claudeSettingsPath,
      );
      expect(settingsEntry.ownership._tag).toBe("hookEntries");
      expect(settingsEntry.ownership.events).toContainEqual(
        expect.objectContaining({ pointer: "/hooks/Stop", previouslyPresent: true }),
      );

      yield* uninstall(uninstallRequest(root));

      expect(yield* readJson(claudeSettingsPath)).toEqual({ theme: "dark", hooks: { Stop: [userStop, foreignStop] } });
    }),
  );
});
