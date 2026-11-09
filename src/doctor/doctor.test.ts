import { FileSystem, Path } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { expect, layer } from "@effect/vitest";
import { Effect, Schema } from "effect";

import { defaultConfig } from "../config/config-schema.js";
import { checkHealth, HealthCheckError, healthRequestSchema } from "./doctor.js";

const noEvidence = { homePaths: [], absolutePaths: [], commands: [] };

const validRequest = {
  destination: { _tag: "project", root: "/workspace" },
  preparedPackage: { root: "/package/dist", version: "1.0.0" },
  platform: { operatingSystem: "darwin" },
  agentEvidence: noEvidence,
};

const cursor = {
  id: "cursor",
  displayName: "Cursor",
  detected: true,
  managed: false,
  nativeHookSupport: "unsupported",
};

// A temporary install root and prepared package; config.json and receipt.json are written only when asked for.
const makeWorkspace = (files: { readonly config?: boolean; readonly receipt?: string | object }) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "agent-setup-doctor-root-" });
    const preparedRoot = yield* fileSystem.makeTempDirectoryScoped({ prefix: "agent-setup-doctor-prepared-" });
    const configPath = path.join(root, ".claude/agent-setup/config.json");
    const receiptPath = path.join(root, ".claude/agent-setup/receipt.json");
    if (files.config || files.receipt !== undefined) {
      yield* fileSystem.makeDirectory(path.dirname(configPath), { recursive: true });
    }
    if (files.config) {
      yield* fileSystem.writeFileString(configPath, `${JSON.stringify(defaultConfig)}\n`);
    }
    if (files.receipt !== undefined) {
      const receipt = typeof files.receipt === "string" ? files.receipt : `${JSON.stringify(files.receipt)}\n`;
      yield* fileSystem.writeFileString(receiptPath, receipt);
    }

    const requestFor = (overrides: object = {}) => ({
      ...validRequest,
      destination: { _tag: "project", root },
      preparedPackage: { root: preparedRoot, version: "1.0.0" },
      ...overrides,
    });
    return { root, preparedRoot, configPath, receiptPath, requestFor };
  });

layer(NodeContext.layer)("doctor", (it) => {
  it.effect("strictly rejects unknown doctor request properties at the capability boundary", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(checkHealth({ ...validRequest, repair: true }));

      expect(error).toBeInstanceOf(HealthCheckError);
      expect(error.message).toContain("repair");
    }),
  );

  it("strictly rejects an unknown host platform", () => {
    const decoded = Schema.decodeUnknownEither(healthRequestSchema, { onExcessProperty: "error" })({
      ...validRequest,
      platform: { operatingSystem: "temple-os" },
    });

    expect(decoded._tag).toBe("Left");
  });

  it.scoped(
    "reports decoded receipt, catalog, platform, prepared-runtime, and agent discrepancies without writing",
    () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const workspace = yield* makeWorkspace({
          config: true,
          receipt: {
            version: "0.9.0",
            scope: "global",
            features: ["scratch-folder-guard", "make-code-readable", "make-promo-video"],
            ownedFiles: [
              {
                owner: { _tag: "agent", agentIds: ["codex"] },
                path: "AGENTS.md",
                kind: { _tag: "instruction" },
                ownership: {
                  _tag: "managedBlock",
                  filePreviouslyPresent: false,
                  startMarker: "<!-- agent-setup start -->",
                  endMarker: "<!-- agent-setup end -->",
                  installedBodyHash: "a".repeat(64),
                },
              },
            ],
          },
        });
        const preparedScratchGuardPath = path.join(
          workspace.preparedRoot,
          "hooks/scratch-folder-guard/hooks/scratch-folder-guard.js",
        );
        yield* fileSystem.makeDirectory(path.dirname(preparedScratchGuardPath), { recursive: true });
        yield* fileSystem.writeFileString(preparedScratchGuardPath, "export {};\n");
        const configBefore = yield* fileSystem.readFile(workspace.configPath);
        const receiptBefore = yield* fileSystem.readFile(workspace.receiptPath);

        const report = yield* checkHealth(
          workspace.requestFor({
            platform: { operatingSystem: "linux" },
            agentEvidence: { ...noEvidence, homePaths: [".cursor"] },
          }),
        );

        expect(report.installation).toEqual({
          _tag: "present",
          version: "0.9.0",
          features: ["scratch-folder-guard", "make-code-readable", "make-promo-video"],
        });
        expect(report.config).toEqual({ _tag: "present", config: defaultConfig });
        expect(report.features).toEqual([
          {
            id: "scratch-folder-guard",
            title: "Scratch folder guard",
            platform: "any",
            platformAvailable: true,
            preparedRuntime: { _tag: "present", path: "hooks/scratch-folder-guard/hooks/scratch-folder-guard.js" },
          },
          {
            id: "make-code-readable",
            title: "Make code readable",
            platform: "any",
            platformAvailable: true,
            preparedRuntime: { _tag: "notRequired" },
          },
          {
            id: "make-promo-video",
            title: "Make promo video",
            platform: "macos",
            platformAvailable: false,
            preparedRuntime: { _tag: "notRequired" },
          },
        ]);
        expect(report.agents.find((agent) => agent.id === "codex")).toEqual({
          id: "codex",
          displayName: "Codex",
          detected: false,
          managed: true,
          nativeHookSupport: "verified",
        });
        expect(report.agents.find((agent) => agent.id === "cursor")).toEqual(cursor);
        expect(report.discrepancies).toEqual([
          { _tag: "receiptScopeMismatch", requestedScope: "project", receiptScope: "global" },
          { _tag: "packageVersionMismatch", installedVersion: "0.9.0", preparedVersion: "1.0.0" },
          { _tag: "missingFeatureDependency", featureId: "plan-page" },
          { _tag: "unsupportedFeaturePlatform", featureId: "make-promo-video", platform: "macos" },
          { _tag: "detectedAgentNotManaged", agentId: "cursor" },
          { _tag: "managedAgentNotDetected", agentId: "codex" },
        ]);
        expect([...(yield* fileSystem.readFile(workspace.configPath))]).toEqual([...configBefore]);
        expect([...(yield* fileSystem.readFile(workspace.receiptPath))]).toEqual([...receiptBefore]);
        expect(yield* fileSystem.exists(path.join(workspace.root, ".claude/agent-setup/recovery.json"))).toBe(false);
      }),
  );

  it.scoped("reports an absent installation without treating detected paths as deletion authority", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const workspace = yield* makeWorkspace({});
      const detectedMarker = path.join(workspace.root, ".cursor/user-owned.txt");
      yield* fileSystem.makeDirectory(path.dirname(detectedMarker), { recursive: true });
      yield* fileSystem.writeFileString(detectedMarker, "keep me\n");

      const report = yield* checkHealth(
        workspace.requestFor({ agentEvidence: { ...noEvidence, homePaths: [".cursor"] } }),
      );

      expect(report.installation).toEqual({ _tag: "missing" });
      expect(report.config).toEqual({ _tag: "missing" });
      expect(report.features).toEqual([]);
      expect(report.agents.find((agent) => agent.id === "cursor")).toEqual(cursor);
      expect(report.discrepancies).toEqual([{ _tag: "detectedAgentNotManaged", agentId: "cursor" }]);
      expect(yield* fileSystem.readFileString(detectedMarker)).toBe("keep me\n");
      expect(yield* fileSystem.exists(path.join(workspace.root, ".claude"))).toBe(false);
    }),
  );

  it.scoped("reports a missing managed config for a receipted installation", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const workspace = yield* makeWorkspace({
        receipt: { version: "1.0.0", scope: "project", features: [], ownedFiles: [] },
      });

      const report = yield* checkHealth(workspace.requestFor());

      expect(report.config).toEqual({ _tag: "missing" });
      expect(report.discrepancies).toEqual([{ _tag: "missingManagedConfig" }]);
      expect(yield* fileSystem.exists(workspace.configPath)).toBe(false);
    }),
  );

  it.scoped("reports a dependency the receipt does not list as missing, without changing the receipt", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const workspace = yield* makeWorkspace({
        config: true,
        receipt: {
          version: "1.0.0",
          scope: "project",
          features: ["organize-commits", "finish-and-push", "run-local-and-check", "run-tasks-in-parallel"],
          ownedFiles: [],
        },
      });
      const receiptBefore = yield* fileSystem.readFile(workspace.receiptPath);

      const report = yield* checkHealth(workspace.requestFor());

      expect(report.discrepancies).toEqual([{ _tag: "missingFeatureDependency", featureId: "active-run-reminder" }]);
      expect([...(yield* fileSystem.readFile(workspace.receiptPath))]).toEqual([...receiptBefore]);
    }),
  );

  it.scoped("rejects an ambiguous receipt without normalizing or rewriting it", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const receipt = '{"version":"1.0.0","scope":"project","features":[],"ownedFiles":[],"scope":"global"}\n';
      const workspace = yield* makeWorkspace({ config: true, receipt });

      const error = yield* Effect.flip(checkHealth(workspace.requestFor()));

      expect(error).toBeInstanceOf(HealthCheckError);
      expect(error.message).toContain("duplicate JSON property");
      expect(yield* fileSystem.readFileString(workspace.receiptPath)).toBe(receipt);
    }),
  );
});
