import { createHash } from "node:crypto";

import { FileSystem, Path } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { expect, layer } from "@effect/vitest";
import { Effect } from "effect";

import { defaultConfig } from "../config/configSchema.js";
import { install } from "./install.js";
import { update } from "./update.js";

const packageFiles = {
  "hooks/contextGuard/hooks/contextGuard.js": "export {};\n",
  "hooks/contextGuard/hooks/startAutorunWatcher.js": "export {};\n",
  "hooks/contextGuard/command/autorunControl.js": "export {};\n",
  "hooks/contextGuard/hooks/recordIdleCompactEvent.js": "export {};\n",
  "skills/autorun/SKILL.md": "---\nname: autorun\n---\nRun @@AUTORUN_CONTROL@@ when armed.\n",
  "skills/autorun/agents/openai.yaml": "policy:\n  allow_implicit_invocation: false\n",
  "hooks/activeRunReminder/hooks/activeRunReminder.js": "export {};\n",
  "skills/organize-commits/SKILL.md": "---\nname: organize-commits\n---\nOrganize commits.\n",
  "skills/organize-commits/REFERENCE.md": "# Reference\n",
  "skills/finish-and-push/SKILL.md": "---\nname: finish-and-push\n---\nFinish and push.\n",
  "skills/finish-and-push/REFERENCE.md": "# Reference\n",
  "skills/run-local-and-check/SKILL.md": "---\nname: run-local-and-check\n---\nRun locally.\n",
  "skills/run-local-and-check/REFERENCE.md": "# Reference\n",
  "skills/run-tasks-in-parallel/SKILL.md": "---\nname: run-tasks-in-parallel\n---\nRun tasks in parallel.\n",
  "skills/run-tasks-in-parallel/REFERENCE.md": "# Reference\n",
};

// A receipt written before active-run-reminder became a dependency of run-tasks-in-parallel.
const RECEIPT_BEFORE_REMINDER_JSON = JSON.stringify({
  version: "0.12.0",
  scope: "project",
  features: ["organize-commits", "finish-and-push", "run-local-and-check", "run-tasks-in-parallel"],
  ownedFiles: [],
});

const REMINDER_RECEIPT_FEATURES = [
  "active-run-reminder",
  "organize-commits",
  "finish-and-push",
  "run-local-and-check",
  "run-tasks-in-parallel",
];

const workspace = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "agent-setup-update-root-" });
  const preparedRoot = yield* fileSystem.makeTempDirectoryScoped({ prefix: "agent-setup-update-prepared-" });
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

  yield* writeFiles(preparedRoot, packageFiles);

  return { fileSystem, path, root, preparedRoot, writeFiles, readText, exists };
});

const request = (input: { root: string; preparedRoot: string; features: ReadonlyArray<string> }) => ({
  destination: { _tag: "project", root: input.root },
  host: { homeRoot: input.root },
  preparedPackage: { root: input.preparedRoot, version: "0.12.0" },
  features: { _tag: "selected", ids: input.features },
  agents: { _tag: "selected", ids: ["claude-code", "cursor", "codex", "aider", "continue"] },
  interaction: { _tag: "scripted" },
  configuration: { _tag: "automatic" },
});

const selectedDefaults = { _tag: "selected", config: defaultConfig };

layer(NodeContext.layer)("update", (it) => {
  it.scoped("restores removed feature files while retaining user bytes outside owned regions", () =>
    Effect.gen(function* () {
      const { root, preparedRoot, writeFiles, readText, exists } = yield* workspace;
      yield* writeFiles(root, {
        "AGENTS.md": "User instructions.\n",
        ".claude/settings.json": '{\n  "theme": "dark"\n}\n',
      });
      yield* install({ ...request({ root, preparedRoot, features: ["autorun"] }), configuration: selectedDefaults });

      const updateExecution = yield* update(request({ root, preparedRoot, features: ["context-guard"] }));

      expect(updateExecution._tag).toBe("updated");
      for (const removed of [
        ".claude/skills/autorun/SKILL.md",
        ".claude/skills/autorun/agents/openai.yaml",
        ".agents/skills/autorun/agents/openai.yaml",
        ".cursor/rules/autorun.mdc",
        ".aider.conf.yml",
        ".continue/config.json",
      ]) {
        expect(yield* exists(removed)).toBe(false);
      }
      expect(yield* readText("AGENTS.md")).toBe("User instructions.\n");
      expect(yield* readText(".claude/settings.json")).toContain('"theme": "dark"');
      expect(yield* readText(".claude/settings.json")).toContain("SessionStart");

      const receipt = JSON.parse(yield* readText(".claude/agent-setup/receipt.json"));
      expect(receipt.features).toEqual(["context-guard"]);
      // context-guard's own autorunControl.js stays; only the autorun skill's files must go.
      const autorunSkillFile = /(?:^|\/)autorun(?:\/|\.)/;
      expect(receipt.ownedFiles.some((file: { path: string }) => autorunSkillFile.test(file.path))).toBe(false);
    }),
  );

  it.scoped("refreshes named installed features and keeps the rest of the receipt selection", () =>
    Effect.gen(function* () {
      const { root, preparedRoot, readText, exists } = yield* workspace;
      const baseRequest = request({ root, preparedRoot, features: ["autorun"] });
      yield* install({ ...baseRequest, configuration: selectedDefaults });

      const updateSummary = yield* update({ ...baseRequest, features: { _tag: "refresh", ids: ["context-guard"] } });

      expect(updateSummary.features).toEqual(["context-guard", "autorun"]);
      expect(JSON.parse(yield* readText(".claude/agent-setup/receipt.json")).features).toEqual([
        "context-guard",
        "autorun",
      ]);
      expect(yield* exists(".claude/skills/autorun/SKILL.md")).toBe(true);
    }),
  );

  it.scoped("refuses to refresh a feature that is not installed and changes nothing", () =>
    Effect.gen(function* () {
      const { root, preparedRoot, readText, exists } = yield* workspace;
      const baseRequest = request({ root, preparedRoot, features: ["context-guard"] });
      yield* install({ ...baseRequest, configuration: selectedDefaults });
      const originalReceipt = yield* readText(".claude/agent-setup/receipt.json");

      const error = yield* Effect.flip(update({ ...baseRequest, features: { _tag: "refresh", ids: ["autorun"] } }));

      expect(error.message).toContain("Feature autorun is not installed in this scope; use install to add it.");
      expect(yield* readText(".claude/agent-setup/receipt.json")).toBe(originalReceipt);
      expect(yield* exists(".claude/skills/autorun/SKILL.md")).toBe(false);
    }),
  );

  it.scoped("refuses an update after bytes inside a receipted instruction block change", () =>
    Effect.gen(function* () {
      const { root, preparedRoot, writeFiles, readText } = yield* workspace;
      yield* install({ ...request({ root, preparedRoot, features: ["autorun"] }), configuration: selectedDefaults });
      const originalReceipt = yield* readText(".claude/agent-setup/receipt.json");
      yield* writeFiles(root, { "AGENTS.md": (yield* readText("AGENTS.md")).replace("Run", "Changed") });

      const exit = yield* Effect.exit(update(request({ root, preparedRoot, features: ["context-guard"] })));

      expect(exit._tag).toBe("Failure");
      expect(yield* readText(".claude/agent-setup/receipt.json")).toBe(originalReceipt);
      expect(yield* readText("AGENTS.md")).toContain("Changed");
    }),
  );

  it.scoped.each([
    [
      "preserves a user-owned empty hooks object after the last managed hook is removed",
      '{\r\n\t"hooks": { }\r\n}\r\n',
    ],
    ["removes its created hooks container without reformatting any user byte", '{\r\n\t"theme":"dark"\r\n}\r\n'],
  ])("%s", ([, originalSettings]) =>
    Effect.gen(function* () {
      const { root, preparedRoot, writeFiles, readText } = yield* workspace;
      const baseRequest = request({ root, preparedRoot, features: ["context-guard"] });
      yield* writeFiles(root, { ".claude/settings.json": originalSettings });
      yield* install({ ...baseRequest, configuration: selectedDefaults });

      yield* update({ ...baseRequest, agents: { _tag: "selected", ids: ["cursor"] } });

      expect(yield* readText(".claude/settings.json")).toBe(originalSettings);
    }),
  );

  it.scoped("tracks a hooks container created by an update after a hookless installation", () =>
    Effect.gen(function* () {
      const { root, preparedRoot, writeFiles, readText } = yield* workspace;
      const originalSettings = '{\r\n\t"env": { "keep":"yes" }\r\n}\r\n';
      const baseRequest = request({ root, preparedRoot, features: ["context-guard"] });
      yield* writeFiles(root, { ".claude/settings.json": originalSettings });
      yield* install({ ...baseRequest, agents: { _tag: "selected", ids: ["cursor"] } });

      yield* update({ ...baseRequest, agents: { _tag: "selected", ids: ["claude-code"] } });
      expect(yield* readText(".claude/settings.json")).toContain("SessionStart");
      yield* update({ ...baseRequest, agents: { _tag: "selected", ids: ["cursor"] } });

      expect(yield* readText(".claude/settings.json")).toBe(originalSettings);
    }),
  );

  it.scoped("resets a receipted config.json that no longer decodes and records the new bytes", () =>
    Effect.gen(function* () {
      const { fileSystem, path, root, preparedRoot, writeFiles, readText } = yield* workspace;
      const configPath = ".claude/agent-setup/config.json";
      const baseRequest = request({ root, preparedRoot, features: ["context-guard"] });
      yield* install({
        ...baseRequest,
        configuration: { _tag: "selected", config: { ...defaultConfig, duplicateCodeSkipFolders: ["fixtures"] } },
      });
      // Neither decodable nor the receipted bytes: both guards that used to block a reset.
      yield* writeFiles(root, {
        [configPath]: '{ "duplicateCodeSkipFolders": ["fixtures"], "unknownSetting": true,\n',
      });

      const refused = yield* Effect.exit(update({ ...baseRequest, features: { _tag: "preserve" } }));
      expect(refused._tag).toBe("Failure");

      yield* update({ ...baseRequest, features: { _tag: "preserve" }, configuration: { _tag: "reset" } });

      const configBytes = yield* fileSystem.readFile(path.join(root, configPath));
      expect(JSON.parse(new TextDecoder().decode(configBytes))).toEqual(defaultConfig);
      const receipt = JSON.parse(yield* readText(".claude/agent-setup/receipt.json"));
      const managedConfigFile = receipt.ownedFiles.find((file: { path: string }) => file.path === configPath);
      expect(managedConfigFile.ownership.installedHash).toBe(createHash("sha256").update(configBytes).digest("hex"));
      expect(managedConfigFile.ownership.previous).toEqual({ _tag: "missing" });
    }),
  );

  it.scoped("install adds a dependency that an older receipt does not list", () =>
    Effect.gen(function* () {
      const { root, preparedRoot, writeFiles, readText, exists } = yield* workspace;
      yield* writeFiles(root, { ".claude/agent-setup/receipt.json": RECEIPT_BEFORE_REMINDER_JSON });

      const installSummary = yield* install({
        ...request({ root, preparedRoot, features: ["run-tasks-in-parallel"] }),
        configuration: selectedDefaults,
      });

      expect(installSummary.features).toEqual(REMINDER_RECEIPT_FEATURES);
      expect(yield* exists(".claude/agent-setup/hooks/activeRunReminder/hooks/activeRunReminder.js")).toBe(true);
      expect(yield* readText(".claude/settings.json")).toContain("SubagentStart");
      expect(JSON.parse(yield* readText(".claude/agent-setup/receipt.json")).features).toEqual(
        REMINDER_RECEIPT_FEATURES,
      );
    }),
  );

  it.scoped("update adds a dependency that an older receipt does not list", () =>
    Effect.gen(function* () {
      const { root, preparedRoot, writeFiles, readText, exists } = yield* workspace;
      yield* writeFiles(root, { ".claude/agent-setup/receipt.json": RECEIPT_BEFORE_REMINDER_JSON });

      const updateSummary = yield* update({
        ...request({ root, preparedRoot, features: [] }),
        features: { _tag: "preserve" },
        configuration: selectedDefaults,
      });

      expect(updateSummary.features).toEqual(REMINDER_RECEIPT_FEATURES);
      expect(yield* exists(".claude/agent-setup/hooks/activeRunReminder/hooks/activeRunReminder.js")).toBe(true);
      expect(yield* readText(".claude/settings.json")).toContain("SessionStart");
      expect(JSON.parse(yield* readText(".claude/agent-setup/receipt.json")).features).toEqual(
        REMINDER_RECEIPT_FEATURES,
      );
    }),
  );

  it.scoped("update refreshes a dependency that an older receipt does not list", () =>
    Effect.gen(function* () {
      const { root, preparedRoot, writeFiles } = yield* workspace;
      yield* writeFiles(root, { ".claude/agent-setup/receipt.json": RECEIPT_BEFORE_REMINDER_JSON });

      const updateSummary = yield* update({
        ...request({ root, preparedRoot, features: [] }),
        features: { _tag: "refresh", ids: ["active-run-reminder"] },
        configuration: selectedDefaults,
      });

      expect(updateSummary.features).toEqual(REMINDER_RECEIPT_FEATURES);
    }),
  );
});
