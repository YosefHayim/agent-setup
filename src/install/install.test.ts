import { createHash } from "node:crypto";

import { FileSystem, Path } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { expect, layer } from "@effect/vitest";
import { Effect, Schema } from "effect";

import { defaultConfig } from "../config/configSchema.js";
import { install } from "./install.js";
import { installRequestSchema } from "./installRequest.js";
import { planRestorations } from "./restore.js";

const textEncoder = new TextEncoder();

const sha256 = (bytes: Uint8Array | string): string => createHash("sha256").update(bytes).digest("hex");

const scratchFolderRuntime = {
  "hooks/scratchFolderGuard/hooks/scratchFolderGuard.js": "export {};\n",
  "hooks/scratchFolderGuard/hooks/askScratchCleanup.js": "export {};\n",
  "hooks/scratchFolderGuard/hooks/clearSessionScratch.js": "export {};\n",
  "hooks/scratchFolderGuard/command/clearScratch.js": "export {};\n",
  "hooks/scratchFolderGuard/watchers/scratchWatcher.js": "export {};\n",
};

const makeCodeReadableSkill = {
  "skills/make-code-readable/SKILL.md": "---\nname: make-code-readable\n---\nRun the steps.\n",
  "skills/make-code-readable/references/examples.md": "# Examples\n",
  "skills/make-code-readable/references/review-and-apply.md": "# Review and apply\n",
};

const sessionRehomeRuntime = {
  "hooks/sessionRehome/hooks/rehomeEndedSession.js": "export {};\n",
  "hooks/sessionRehome/hooks/announceMovedSession.js": "export {};\n",
};

const workspace = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "agent-setup-install-root-" });
  const preparedRoot = yield* fileSystem.makeTempDirectoryScoped({ prefix: "agent-setup-install-prepared-" });
  const writeFiles = (base: string, files: Readonly<Record<string, string>>) =>
    Effect.forEach(Object.entries(files), ([relativePath, contents]) =>
      Effect.gen(function* () {
        const destination = path.join(base, relativePath);
        yield* fileSystem.makeDirectory(path.dirname(destination), { recursive: true });
        yield* fileSystem.writeFileString(destination, contents);
      }),
    );

  const readText = (relativePath: string) => fileSystem.readFileString(path.join(root, relativePath));

  const exists = (relativePath: string) => fileSystem.exists(path.join(root, relativePath));

  const readReceipt = Effect.map(readText(".claude/agent-setup/receipt.json"), (text) => JSON.parse(text));

  return { fileSystem, path, root, preparedRoot, writeFiles, readText, exists, readReceipt };
});

// e.g. {"hooks":{"Stop":[{"hooks":[{"command":"node \\"/x.js\\""}]}]}} → ['node "/x.js"']
const hookCommands = (settingsText: string): ReadonlyArray<string> =>
  [...settingsText.matchAll(/"command"\s*:\s*("(?:[^"\\]|\\.)*")/g)].flatMap((match) =>
    match[1] === undefined ? [] : [String(JSON.parse(match[1]))],
  );

const installRequest = (input: { root: string; preparedRoot: string }) => ({
  destination: { _tag: "project", root: input.root },
  host: { homeRoot: input.root },
  preparedPackage: { root: input.preparedRoot, version: "0.12.0" },
  features: { _tag: "selected", ids: ["scratch-folder-guard"] },
  agents: { _tag: "selected", ids: ["claude-code"] },
  interaction: { _tag: "scripted" },
  configuration: { _tag: "selected", config: defaultConfig },
});

const decodeInstallRequest = Schema.decodeUnknownEither(installRequestSchema, { onExcessProperty: "error" });

layer(NodeContext.layer)("install", (it) => {
  it.scoped("installs one decoded prepared runtime, managed config, settings hook, and ownership receipt", () =>
    Effect.gen(function* () {
      const { root, preparedRoot, writeFiles, readText, readReceipt } = yield* workspace;
      yield* writeFiles(preparedRoot, scratchFolderRuntime);
      yield* writeFiles(root, {
        ".claude/settings.json":
          '{\n  "theme": "dark",\n  "hooks": {\n    "Stop": [{ "hooks": [{ "type": "command", "command": "user-command" }] }]\n  }\n}\n',
      });

      const installation = yield* install(installRequest({ root, preparedRoot }));

      expect(installation).toMatchObject({
        _tag: "installed",
        scope: "project",
        features: ["scratch-folder-guard"],
        agents: ["claude-code"],
      });
      expect(installation.platformRequirements).toEqual([{ featureId: "scratch-folder-guard", platform: "any" }]);
      expect(yield* readText(".claude/agent-setup/hooks/scratchFolderGuard/hooks/scratchFolderGuard.js")).toBe(
        "export {};\n",
      );
      expect(JSON.parse(yield* readText(".claude/agent-setup/config.json"))).toEqual(defaultConfig);

      const settings = yield* readText(".claude/settings.json");
      expect(settings).toContain('"theme": "dark"');
      expect(settings).toContain("user-command");
      expect(settings).toContain("scratchFolderGuard/hooks/scratchFolderGuard.js");

      const receipt = yield* readReceipt;
      expect(receipt.features).toEqual(["scratch-folder-guard"]);
      expect(receipt.ownedFiles.map((file: { path: string }) => file.path)).toEqual([
        ".claude/agent-setup/hooks/scratchFolderGuard/command/clearScratch.js",
        ".claude/agent-setup/hooks/scratchFolderGuard/hooks/askScratchCleanup.js",
        ".claude/agent-setup/hooks/scratchFolderGuard/hooks/clearSessionScratch.js",
        ".claude/agent-setup/hooks/scratchFolderGuard/hooks/scratchFolderGuard.js",
        ".claude/agent-setup/hooks/scratchFolderGuard/watchers/scratchWatcher.js",
        ".claude/agent-setup/config.json",
        ".claude/settings.json",
      ]);
    }),
  );

  it.scoped("adds named features to the installed selection and keeps every installed feature", () =>
    Effect.gen(function* () {
      const { root, preparedRoot, writeFiles, readText, exists, readReceipt } = yield* workspace;
      yield* writeFiles(preparedRoot, { ...scratchFolderRuntime, ...sessionRehomeRuntime });
      yield* install(installRequest({ root, preparedRoot }));

      const installation = yield* install({
        ...installRequest({ root, preparedRoot }),
        features: { _tag: "selected", ids: ["session-rehome"] },
      });

      expect(installation.features).toEqual(["scratch-folder-guard", "session-rehome"]);
      expect((yield* readReceipt).features).toEqual(["scratch-folder-guard", "session-rehome"]);
      expect(yield* exists(".claude/agent-setup/hooks/scratchFolderGuard/hooks/scratchFolderGuard.js")).toBe(true);
      const commands = hookCommands(yield* readText(".claude/settings.json"));
      expect(commands.some((command) => command.includes("scratchFolderGuard/hooks/scratchFolderGuard.js"))).toBe(true);
      expect(commands.some((command) => command.includes("sessionRehome/hooks/rehomeEndedSession.js"))).toBe(true);
    }),
  );

  it.scoped("installs native hooks for detected Codex and Grok without replacing user hooks", () =>
    Effect.gen(function* () {
      const { root, preparedRoot, writeFiles, readText, exists } = yield* workspace;
      yield* writeFiles(preparedRoot, sessionRehomeRuntime);
      yield* writeFiles(root, {
        ".codex/hooks.json":
          '{\n  "keep": true,\n  "hooks": { "Stop": [{ "hooks": [{ "type": "command", "command": "user-stop" }] }] }\n}\n',
      });

      yield* install({
        ...installRequest({ root, preparedRoot }),
        features: { _tag: "selected", ids: ["session-rehome"] },
        agents: { _tag: "selected", ids: ["codex", "grok"] },
      });

      const codex = yield* readText(".codex/hooks.json");
      expect(codex).toContain('"keep": true');
      expect(codex).toContain("user-stop");
      expect(codex).toContain("AGENT_SETUP_AGENT_ID=codex node ");

      const grok = yield* readText(".grok/hooks/agent-setup.json");
      expect(grok).toContain("AGENT_SETUP_AGENT_ID=grok");
      expect(grok).toContain("rehomeEndedSession.js");
      expect(yield* exists(".claude/settings.json")).toBe(false);
    }),
  );

  it.scoped("passes the agent id to the session-rehome hooks for Claude, Codex, and Grok", () =>
    Effect.gen(function* () {
      const { root, preparedRoot, writeFiles, readText } = yield* workspace;
      yield* writeFiles(preparedRoot, {
        "hooks/sessionRehome/hooks/rehomeEndedSession.js": "export {};\n",
        "hooks/sessionRehome/hooks/announceMovedSession.js": "export {};\n",
      });

      yield* install({
        ...installRequest({ root, preparedRoot }),
        features: { _tag: "selected", ids: ["session-rehome"] },
        agents: { _tag: "selected", ids: ["claude-code", "codex", "grok"] },
      });

      expect(yield* readText(".claude/settings.json")).toContain("AGENT_SETUP_AGENT_ID=claude-code node ");
      expect(yield* readText(".codex/hooks.json")).toContain("AGENT_SETUP_AGENT_ID=codex node ");
      expect(yield* readText(".grok/hooks/agent-setup.json")).toContain("AGENT_SETUP_AGENT_ID=grok node ");
    }),
  );

  it.scoped("returns unchanged without rewriting an identical installation", () =>
    Effect.gen(function* () {
      const { root, preparedRoot, writeFiles, readText } = yield* workspace;
      const request = installRequest({ root, preparedRoot });
      yield* writeFiles(preparedRoot, scratchFolderRuntime);

      yield* install(request);
      const before = yield* readText(".claude/agent-setup/receipt.json");
      const installation = yield* install(request);

      expect(installation._tag).toBe("unchanged");
      expect(yield* readText(".claude/agent-setup/receipt.json")).toBe(before);
    }),
  );

  it.scoped("adopts a receipted skill file an external sync rewrote with the exact desired bytes", () =>
    Effect.gen(function* () {
      const { fileSystem, path, root, preparedRoot, writeFiles, readText, readReceipt } = yield* workspace;
      const installedSkill = ".claude/skills/make-code-readable/SKILL.md";
      const request = {
        ...installRequest({ root, preparedRoot }),
        features: { _tag: "selected", ids: ["make-code-readable"] },
        agents: { _tag: "selected", ids: ["claude-code"] },
      };
      yield* writeFiles(preparedRoot, { ...scratchFolderRuntime, ...makeCodeReadableSkill });
      yield* install(request);

      // Ship a newer skill, then let an external sync write that same rendered content first.
      yield* writeFiles(preparedRoot, {
        "skills/make-code-readable/SKILL.md":
          "---\nname: make-code-readable\n---\nRun the steps after every handoff.\n",
      });
      const synced = "---\nname: make-code-readable\n---\nRun the steps after every handoff.\n";
      yield* writeFiles(root, { [installedSkill]: synced });

      const installation = yield* install(request);

      expect(installation._tag).toBe("installed");
      expect(yield* readText(installedSkill)).toBe(synced);

      // The refreshed receipt must describe the adopted bytes, so the next install stays clean.
      const entry = (yield* readReceipt).ownedFiles.find((file: { path: string }) => file.path === installedSkill);
      expect(entry.ownership.installedHash).toBe(sha256(yield* fileSystem.readFile(path.join(root, installedSkill))));
      expect((yield* Effect.exit(install(request)))._tag).toBe("Success");
    }),
  );

  it.scoped("still refuses a receipted skill file rewritten with content it would not write", () =>
    Effect.gen(function* () {
      const { root, preparedRoot, writeFiles, readText } = yield* workspace;
      const installedSkill = ".claude/skills/make-code-readable/SKILL.md";
      const handWritten = "---\nname: make-code-readable\n---\nMy own hand-written notes.\n";
      const request = {
        ...installRequest({ root, preparedRoot }),
        features: { _tag: "selected", ids: ["make-code-readable"] },
        agents: { _tag: "selected", ids: ["claude-code"] },
      };
      yield* writeFiles(preparedRoot, { ...scratchFolderRuntime, ...makeCodeReadableSkill });
      yield* install(request);
      yield* writeFiles(root, { [installedSkill]: handWritten });

      const exit = yield* Effect.exit(install(request));

      expect(exit._tag).toBe("Failure");
      expect(yield* readText(installedSkill)).toBe(handWritten);
    }),
  );

  it.scoped("plans all four native agent formats without duplicate instruction destinations", () =>
    Effect.gen(function* () {
      const { root, preparedRoot, writeFiles, readText, exists, readReceipt } = yield* workspace;
      yield* writeFiles(preparedRoot, { ...scratchFolderRuntime, ...makeCodeReadableSkill });

      yield* install({
        ...installRequest({ root, preparedRoot }),
        features: { _tag: "selected", ids: ["make-code-readable"] },
        agents: { _tag: "selected", ids: ["continue", "aider", "codex", "cursor", "claude-code"] },
      });

      expect(yield* readText(".claude/skills/make-code-readable/SKILL.md")).toContain("Run");
      expect(yield* readText(".agents/skills/make-code-readable/SKILL.md")).toContain("Run");
      expect(yield* exists(".codex/skills/make-code-readable/SKILL.md")).toBe(false);
      expect(yield* readText(".cursor/rules/make-code-readable.mdc")).toContain("Run the steps.");

      const instructions = yield* readText("AGENTS.md");
      expect(instructions.match(/<!-- agent-setup:skills start -->/g)).toHaveLength(1);
      expect(instructions).toContain("## make-code-readable");
      expect(yield* readText(".aider.conf.yml")).toContain("AGENTS.md");
      expect(JSON.parse(yield* readText(".continue/config.json")).rules).toEqual(["AGENTS.md"]);

      const instructionFiles = (yield* readReceipt).ownedFiles.filter(
        (file: { kind: { _tag: string }; path: string }) =>
          file.kind._tag === "instruction" && file.path === "AGENTS.md",
      );
      expect(instructionFiles).toHaveLength(1);
      expect(instructionFiles[0].owner.agentIds).toEqual(["aider", "continue"]);
    }),
  );

  it.scoped("rejects an extra prepared skill file before writing host files", () =>
    Effect.gen(function* () {
      const { root, preparedRoot, writeFiles, exists } = yield* workspace;
      yield* writeFiles(preparedRoot, {
        ...scratchFolderRuntime,
        ...makeCodeReadableSkill,
        "skills/make-code-readable/EXTRA.md": "not catalog-shipped\n",
      });

      const exit = yield* Effect.exit(
        install({
          ...installRequest({ root, preparedRoot }),
          features: { _tag: "selected", ids: ["make-code-readable"] },
        }),
      );

      expect(exit._tag).toBe("Failure");
      expect(yield* exists(".claude/agent-setup/receipt.json")).toBe(false);
      expect(yield* exists(".claude/agent-setup/config.json")).toBe(false);
    }),
  );

  it.scoped("copies a validated global config once into a first project installation", () =>
    Effect.gen(function* () {
      const { fileSystem, root: homeRoot, preparedRoot, writeFiles } = yield* workspace;
      const projectRoot = yield* fileSystem.makeTempDirectoryScoped({ prefix: "agent-setup-install-project-" });
      const globalConfig = { ...defaultConfig, sessionRehomeRoots: ["vendor"] };
      const writeGlobalConfig = (config: object) =>
        writeFiles(homeRoot, { ".claude/agent-setup/config.json": `${JSON.stringify(config, null, 2)}\n` });
      const request = {
        ...installRequest({ root: projectRoot, preparedRoot }),
        host: { homeRoot },
        configuration: { _tag: "automatic" },
      };
      yield* writeFiles(preparedRoot, scratchFolderRuntime);
      yield* writeGlobalConfig(globalConfig);

      yield* install(request);
      yield* writeGlobalConfig({ ...globalConfig, sessionRehomeRoots: ["generated"] });
      yield* install(request);

      expect(JSON.parse(yield* fileSystem.readFileString(`${projectRoot}/.claude/agent-setup/config.json`))).toEqual(
        globalConfig,
      );
    }),
  );

  it.scoped("uses one canonical root for inspection, writes, and generated commands", () =>
    Effect.gen(function* () {
      const { fileSystem, path, root: container, preparedRoot, writeFiles } = yield* workspace;
      const realRoot = path.join(container, "realRoot");
      const linkedRoot = path.join(container, "linkedRoot");
      yield* fileSystem.makeDirectory(realRoot);
      yield* fileSystem.symlink(realRoot, linkedRoot);
      yield* writeFiles(preparedRoot, scratchFolderRuntime);

      yield* install(installRequest({ root: linkedRoot, preparedRoot }));

      const settings = yield* fileSystem.readFileString(path.join(realRoot, ".claude/settings.json"));
      expect(settings).toContain(realRoot);
      expect(settings).not.toContain(linkedRoot);
    }),
  );

  it.scoped("removes installer-created whole files even when they drifted or vanished", () =>
    Effect.gen(function* () {
      const { root, writeFiles } = yield* workspace;
      const driftedPath = ".claude/agent-setup/hooks/scratchFolderGuard/hooks/scratchFolderGuard.js";
      const exactPath = ".claude/agent-setup/hooks/scratchFolderGuard/lib/hookConfig.js";
      yield* writeFiles(root, { [driftedPath]: "drifted after install\n", [exactPath]: "exact\n" });
      const wholeFile = (filePath: string, hash: string) => ({
        owner: { _tag: "application" as const },
        path: filePath,
        kind: { _tag: "runtime" as const },
        ownership: { _tag: "wholeFile" as const, installedHash: hash, previous: { _tag: "missing" as const } },
      });

      const restorations = yield* planRestorations({
        root,
        files: [
          wholeFile(driftedPath, sha256("old\n")),
          wholeFile(".claude/agent-setup/hooks/scratchFolderGuard/lib/scratchState.js", sha256("old\n")),
          wholeFile(exactPath, sha256("exact\n")),
        ],
      });

      expect(restorations).toHaveLength(3);
      expect(restorations.every((operation) => operation._tag === "remove")).toBe(true);
    }),
  );

  it.scoped("still refuses to restore a prior host file that drifted after install", () =>
    Effect.gen(function* () {
      const { root, writeFiles } = yield* workspace;
      yield* writeFiles(root, { "owned.txt": "user edited\n" });

      const restorationPlan = yield* planRestorations({
        root,
        files: [
          {
            owner: { _tag: "application" },
            path: "owned.txt",
            kind: { _tag: "runtime" },
            ownership: {
              _tag: "wholeFile",
              installedHash: sha256("installed\n"),
              previous: { _tag: "priorFile", bytes: textEncoder.encode("prior\n") },
            },
          },
        ],
      }).pipe(Effect.either);

      expect(restorationPlan._tag).toBe("Left");
      if (restorationPlan._tag === "Left") {
        expect(restorationPlan.left.message).toContain("changed after installation");
      }
    }),
  );

  it("strictly rejects unknown request properties", () => {
    const decoded = decodeInstallRequest({
      ...installRequest({ root: "/workspace", preparedRoot: "/package/dist" }),
      global: true,
    });

    expect(decoded._tag).toBe("Left");
  });

  it.each([
    "/workspace/$HOME",
    '/workspace/"quoted"',
    "/workspace/`command`",
    "/workspace/back\\slash",
  ])("rejects an installation root that cannot be embedded safely in generated commands: %s", (root) => {
    expect(decodeInstallRequest(installRequest({ root, preparedRoot: "/package/dist" }))._tag).toBe("Left");
  });
});
