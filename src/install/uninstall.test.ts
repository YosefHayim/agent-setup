import { FileSystem, Path } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { expect, layer } from "@effect/vitest";
import { Effect, Schema } from "effect";

import { defaultConfig } from "../config/configSchema.js";
import { install } from "./install.js";
import { uninstall, uninstallRequestSchema } from "./uninstall.js";

const packageFiles = {
  "hooks/scratchFolderGuard/hooks/scratchFolderGuard.js": "export {};\n",
  "hooks/scratchFolderGuard/command/clearScratch.js": "export {};\n",
  "hooks/scratchFolderGuard/watchers/scratchWatcher.js": "export {};\n",
  "skills/makeCodeReadable/SKILL.md": "---\nname: make-code-readable\n---\nRun the steps.\n",
};

const workspace = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "agent-setup-uninstall-root-" });
  const preparedRoot = yield* fileSystem.makeTempDirectoryScoped({ prefix: "agent-setup-uninstall-prepared-" });
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

  return { root, preparedRoot, writeFiles, readText, exists };
});

const installRequest = (input: { root: string; preparedRoot: string }) => ({
  destination: { _tag: "project", root: input.root },
  host: { homeRoot: input.root },
  preparedPackage: { root: input.preparedRoot, version: "0.12.0" },
  features: { _tag: "selected", ids: ["make-code-readable"] },
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

layer(NodeContext.layer)("uninstall", (it) => {
  it.scoped("restores every receipted format exactly and removes installer-created files", () =>
    Effect.gen(function* () {
      const { root, preparedRoot, writeFiles, readText, exists } = yield* workspace;
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
      yield* writeFiles(root, originals);
      yield* install(installRequest({ root, preparedRoot }));
      for (const created of installerCreatedFiles) {
        expect(yield* exists(created)).toBe(true);
      }

      expect(yield* uninstall(uninstallRequest(root))).toEqual(uninstalled);
      for (const [relativePath, contents] of Object.entries(originals)) {
        expect(yield* readText(relativePath)).toBe(contents);
      }
      for (const created of installerCreatedFiles) {
        expect(yield* exists(created)).toBe(false);
      }
    }),
  );

  it.scoped("leaves unreceipted agent files untouched", () =>
    Effect.gen(function* () {
      const { root, preparedRoot, writeFiles, readText } = yield* workspace;
      const userFiles = {
        ".cursor/rules/user.mdc": "User-owned rule.\n",
        ".claude/skills/user/SKILL.md": "User-owned skill.\n",
      };
      yield* install(installRequest({ root, preparedRoot }));
      yield* writeFiles(root, userFiles);

      yield* uninstall(uninstallRequest(root));

      for (const [relativePath, contents] of Object.entries(userFiles)) {
        expect(yield* readText(relativePath)).toBe(contents);
      }
    }),
  );

  it.scoped("removes the folders its removed files leave empty and keeps folders still in use", () =>
    Effect.gen(function* () {
      const { root, preparedRoot, writeFiles, exists } = yield* workspace;
      yield* install(installRequest({ root, preparedRoot }));
      yield* writeFiles(root, { ".claude/skills/user/SKILL.md": "User-owned skill.\n" });

      yield* uninstall(uninstallRequest(root));

      for (const emptied of [".claude/agent-setup", ".claude/skills/make-code-readable", ".agents", ".cursor"]) {
        expect(yield* exists(emptied)).toBe(false);
      }
      expect(yield* exists(".claude/skills/user/SKILL.md")).toBe(true);
    }),
  );

  it.scoped("returns absent without mutating files when no receipt exists", () =>
    Effect.gen(function* () {
      const { root, writeFiles, readText } = yield* workspace;
      yield* writeFiles(root, { ".cursor/rules/user.mdc": "User-owned rule.\n" });

      expect(yield* uninstall(uninstallRequest(root))).toEqual({ ...uninstalled, _tag: "absent" });
      expect(yield* readText(".cursor/rules/user.mdc")).toBe("User-owned rule.\n");
    }),
  );

  // Runtime hooks were created from missing: uninstall force-removes them even if edited.
  // Drift still blocks only when a prior host file must be restored (wholeFile previous present).
  it.scoped("still removes installer-created files when their bytes drifted after install", () =>
    Effect.gen(function* () {
      const { root, preparedRoot, writeFiles, exists } = yield* workspace;
      const hookFile = ".claude/agent-setup/hooks/scratchFolderGuard/hooks/scratchFolderGuard.js";
      yield* install(installRequest({ root, preparedRoot }));
      yield* writeFiles(root, { [hookFile]: "user changed this\n" });

      expect(yield* uninstall(uninstallRequest(root))).toEqual(uninstalled);
      expect(yield* exists(hookFile)).toBe(false);
      expect(yield* exists(".claude/agent-setup/receipt.json")).toBe(false);
    }),
  );

  it.scoped("restores a multiline pre-existing hook value byte for byte", () =>
    Effect.gen(function* () {
      const { root, preparedRoot, writeFiles, readText } = yield* workspace;
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
      yield* writeFiles(root, { ".claude/settings.json": originalSettings });
      yield* install(installRequest({ root, preparedRoot }));

      yield* uninstall(uninstallRequest(root));

      expect(yield* readText(".claude/settings.json")).toBe(originalSettings);
    }),
  );

  it("strictly rejects agent detection and prepared-package inputs", () => {
    const decoded = Schema.decodeUnknownEither(uninstallRequestSchema, { onExcessProperty: "error" })({
      ...uninstallRequest("/workspace"),
      agents: { _tag: "detected", evidence: { homePaths: [".cursor"], absolutePaths: [], commands: [] } },
      preparedPackage: { root: "/package/dist", version: "0.12.0" },
    });

    expect(decoded._tag).toBe("Left");
  });
});
