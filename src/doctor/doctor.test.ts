import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { defaultConfig } from "#src/config/config-schema.js";
import { checkHealth } from "./doctor.js";

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

const temporaryRoots: Array<string> = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

const makeTemporaryRoot = (prefix: string): string => {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  temporaryRoots.push(root);

  return root;
};

// A temporary install root and prepared package; config.json and receipt.json are written only when asked for.
const makeWorkspace = async (files: { readonly config?: boolean; readonly receipt?: string | object }) => {
  const root = makeTemporaryRoot("agent-setup-doctor-root-");
  const preparedRoot = makeTemporaryRoot("agent-setup-doctor-prepared-");
  const configPath = path.join(root, ".claude/agent-setup/config.json");
  const receiptPath = path.join(root, ".claude/agent-setup/receipt.json");
  const isConfigRequested = files.config === true;
  const isReceiptRequested = files.receipt !== undefined;

  if (isConfigRequested || isReceiptRequested) {
    await mkdir(path.dirname(configPath), { recursive: true });
  }

  if (isConfigRequested) {
    await writeFile(configPath, `${JSON.stringify(defaultConfig)}\n`);
  }

  if (isReceiptRequested) {
    const isReceiptText = typeof files.receipt === "string";
    const receiptText = isReceiptText ? files.receipt : `${JSON.stringify(files.receipt)}\n`;
    await writeFile(receiptPath, receiptText);
  }

  const requestFor = (overrides: object = {}) => ({
    ...validRequest,
    destination: { _tag: "project", root },
    preparedPackage: { root: preparedRoot, version: "1.0.0" },
    ...overrides,
  });

  return { root, preparedRoot, configPath, receiptPath, requestFor };
};

describe("checkHealth", () => {
  it("strictly rejects unknown doctor request properties at the capability boundary", async () => {
    await expect(checkHealth({ ...validRequest, repair: true })).rejects.toThrow("repair");
  });

  it("strictly rejects an unknown host platform", async () => {
    await expect(checkHealth({ ...validRequest, platform: { operatingSystem: "temple-os" } })).rejects.toThrow(
      "operatingSystem",
    );
  });

  it("reports decoded receipt, catalog, platform, prepared-runtime, and agent discrepancies without writing", async () => {
    const workspace = await makeWorkspace({
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
    await mkdir(path.dirname(preparedScratchGuardPath), { recursive: true });
    await writeFile(preparedScratchGuardPath, "export {};\n");
    const configBefore = await readFile(workspace.configPath);
    const receiptBefore = await readFile(workspace.receiptPath);

    const report = await checkHealth(
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
    expect(await readFile(workspace.configPath)).toEqual(configBefore);
    expect(await readFile(workspace.receiptPath)).toEqual(receiptBefore);
    expect(existsSync(path.join(workspace.root, ".claude/agent-setup/recovery.json"))).toBe(false);
  });

  it("reports an absent installation without treating detected paths as deletion authority", async () => {
    const workspace = await makeWorkspace({});
    const detectedMarker = path.join(workspace.root, ".cursor/user-owned.txt");
    await mkdir(path.dirname(detectedMarker), { recursive: true });
    await writeFile(detectedMarker, "keep me\n");

    const report = await checkHealth(
      workspace.requestFor({ agentEvidence: { ...noEvidence, homePaths: [".cursor"] } }),
    );

    expect(report.installation).toEqual({ _tag: "missing" });
    expect(report.config).toEqual({ _tag: "missing" });
    expect(report.features).toEqual([]);
    expect(report.agents.find((agent) => agent.id === "cursor")).toEqual(cursor);
    expect(report.discrepancies).toEqual([{ _tag: "detectedAgentNotManaged", agentId: "cursor" }]);
    expect(await readFile(detectedMarker, "utf8")).toBe("keep me\n");
    expect(existsSync(path.join(workspace.root, ".claude"))).toBe(false);
  });

  it("reports a missing managed config for a receipted installation", async () => {
    const workspace = await makeWorkspace({
      receipt: { version: "1.0.0", scope: "project", features: [], ownedFiles: [] },
    });

    const report = await checkHealth(workspace.requestFor());

    expect(report.config).toEqual({ _tag: "missing" });
    expect(report.discrepancies).toEqual([{ _tag: "missingManagedConfig" }]);
    expect(existsSync(workspace.configPath)).toBe(false);
  });

  it("reports a dependency the receipt does not list as missing, without changing the receipt", async () => {
    const workspace = await makeWorkspace({
      config: true,
      receipt: {
        version: "1.0.0",
        scope: "project",
        features: ["organize-commits", "finish-and-push", "run-local-and-check", "run-tasks-in-parallel"],
        ownedFiles: [],
      },
    });
    const receiptBefore = await readFile(workspace.receiptPath);

    const report = await checkHealth(workspace.requestFor());

    expect(report.discrepancies).toEqual([{ _tag: "missingFeatureDependency", featureId: "active-run-reminder" }]);
    expect(await readFile(workspace.receiptPath)).toEqual(receiptBefore);
  });

  it("rejects an ambiguous receipt without normalizing or rewriting it", async () => {
    const receipt = '{"version":"1.0.0","scope":"project","features":[],"ownedFiles":[],"scope":"global"}\n';
    const workspace = await makeWorkspace({ config: true, receipt });

    await expect(checkHealth(workspace.requestFor())).rejects.toThrow("duplicate JSON property");
    expect(await readFile(workspace.receiptPath, "utf8")).toBe(receipt);
  });
});
