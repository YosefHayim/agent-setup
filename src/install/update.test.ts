import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { defaultConfig } from "#src/config/config-schema.js";
import { install } from "./install.js";
import { update } from "./update.js";

const packageFiles = {
  "hooks/scratch-folder-guard/hooks/scratch-folder-guard.js": "export {};\n",
  "hooks/scratch-folder-guard/hooks/ask-scratch-cleanup.js": "export {};\n",
  "hooks/scratch-folder-guard/hooks/clear-session-scratch.js": "export {};\n",
  "hooks/scratch-folder-guard/command/clear-scratch.js": "export {};\n",
  "skills/make-code-readable/SKILL.md": "---\nname: make-code-readable\n---\nRun the steps.\n",
  "skills/make-code-readable/references/examples.md": "# Examples\n",
  "skills/make-code-readable/references/review-and-apply.md": "# Review and apply\n",
  "hooks/active-run-reminder/hooks/active-run-reminder.js": "export {};\n",
  "skills/organize-commits/SKILL.md": "---\nname: organize-commits\n---\nOrganize commits.\n",
  "skills/organize-commits/REFERENCE.md": "# Reference\n",
  "skills/finish-and-push/SKILL.md": "---\nname: finish-and-push\n---\nFinish and push.\n",
  "skills/run-local-and-check/SKILL.md": "---\nname: run-local-and-check\n---\nRun locally.\n",
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

const writeFilesInto = async (base: string, files: Readonly<Record<string, string>>): Promise<void> => {
  for (const [relativePath, fileString] of Object.entries(files)) {
    const destination = join(base, relativePath);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, fileString);
  }
};

const createWorkspace = async () => {
  const root = await makeTemporaryDirectory("agent-setup-update-root-");
  const preparedRoot = await makeTemporaryDirectory("agent-setup-update-prepared-");
  await writeFilesInto(preparedRoot, packageFiles);

  return {
    root,
    preparedRoot,
    writeFiles: (files: Readonly<Record<string, string>>) => writeFilesInto(root, files),
    readText: (relativePath: string): Promise<string> => readFile(join(root, relativePath), "utf8"),
    exists: (relativePath: string): boolean => existsSync(join(root, relativePath)),
  };
};

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

describe("update", () => {
  it("restores removed feature files while retaining user bytes outside owned regions", async () => {
    const { root, preparedRoot, writeFiles, readText, exists } = await createWorkspace();
    await writeFiles({
      "AGENTS.md": "User instructions.\n",
      ".claude/settings.json": '{\n  "theme": "dark"\n}\n',
    });
    await install(
      { ...request({ root, preparedRoot, features: ["make-code-readable"] }), configuration: selectedDefaults },
      notAbortedSignal,
    );

    const updateExecution = await update(
      request({ root, preparedRoot, features: ["scratch-folder-guard"] }),
      notAbortedSignal,
    );

    expect(updateExecution._tag).toBe("updated");
    for (const removed of [
      ".claude/skills/make-code-readable/SKILL.md",
      ".cursor/rules/make-code-readable.mdc",
      ".aider.conf.yml",
      ".continue/config.json",
    ]) {
      expect(exists(removed)).toBe(false);
    }
    expect(await readText("AGENTS.md")).toBe("User instructions.\n");
    expect(await readText(".claude/settings.json")).toContain('"theme": "dark"');
    expect(await readText(".claude/settings.json")).toContain("scratch-folder-guard/hooks/scratch-folder-guard.js");

    const receipt = JSON.parse(await readText(".claude/agent-setup/receipt.json"));
    expect(receipt.features).toEqual(["scratch-folder-guard"]);
    // The make-code-readable skill files are removed with the feature, so none may remain in the receipt.
    const makeCodeReadableSkillFile = /(?:^|\/)make-code-readable(?:\/|\.)/;
    expect(receipt.ownedFiles.some((file: { path: string }) => makeCodeReadableSkillFile.test(file.path))).toBe(false);
  });

  it("refreshes named installed features and keeps the rest of the receipt selection", async () => {
    const { root, preparedRoot, readText, exists } = await createWorkspace();
    const baseRequest = request({ root, preparedRoot, features: ["make-code-readable", "scratch-folder-guard"] });
    await install({ ...baseRequest, configuration: selectedDefaults }, notAbortedSignal);

    const updateSummary = await update(
      {
        ...baseRequest,
        features: { _tag: "refresh", ids: ["scratch-folder-guard"] },
      },
      notAbortedSignal,
    );

    expect(updateSummary.features).toEqual(["scratch-folder-guard", "make-code-readable"]);
    expect(JSON.parse(await readText(".claude/agent-setup/receipt.json")).features).toEqual([
      "scratch-folder-guard",
      "make-code-readable",
    ]);
    expect(exists(".claude/skills/make-code-readable/SKILL.md")).toBe(true);
  });

  it("refuses to refresh a feature that is not installed and changes nothing", async () => {
    const { root, preparedRoot, readText, exists } = await createWorkspace();
    const baseRequest = request({ root, preparedRoot, features: ["scratch-folder-guard"] });
    await install({ ...baseRequest, configuration: selectedDefaults }, notAbortedSignal);
    const originalReceipt = await readText(".claude/agent-setup/receipt.json");

    await expect(
      update({ ...baseRequest, features: { _tag: "refresh", ids: ["make-code-readable"] } }, notAbortedSignal),
    ).rejects.toThrow("Feature make-code-readable is not installed in this scope; use install to add it.");

    expect(await readText(".claude/agent-setup/receipt.json")).toBe(originalReceipt);
    expect(exists(".claude/skills/make-code-readable/SKILL.md")).toBe(false);
  });

  it("refuses an update after bytes inside a receipted instruction block change", async () => {
    const { root, preparedRoot, writeFiles, readText } = await createWorkspace();
    await install(
      { ...request({ root, preparedRoot, features: ["make-code-readable"] }), configuration: selectedDefaults },
      notAbortedSignal,
    );
    const originalReceipt = await readText(".claude/agent-setup/receipt.json");
    await writeFiles({ "AGENTS.md": (await readText("AGENTS.md")).replace("Run", "Changed") });

    await expect(
      update(request({ root, preparedRoot, features: ["scratch-folder-guard"] }), notAbortedSignal),
    ).rejects.toThrow();

    expect(await readText(".claude/agent-setup/receipt.json")).toBe(originalReceipt);
    expect(await readText("AGENTS.md")).toContain("Changed");
  });

  it.each([
    [
      "preserves a user-owned empty hooks object after the last managed hook is removed",
      '{\r\n\t"hooks": { }\r\n}\r\n',
    ],
    ["removes its created hooks container without reformatting any user byte", '{\r\n\t"theme":"dark"\r\n}\r\n'],
  ])("%s", async (_testName: string, originalSettings: string) => {
    const { root, preparedRoot, writeFiles, readText } = await createWorkspace();
    const baseRequest = request({ root, preparedRoot, features: ["scratch-folder-guard"] });
    await writeFiles({ ".claude/settings.json": originalSettings });
    await install({ ...baseRequest, configuration: selectedDefaults }, notAbortedSignal);

    await update({ ...baseRequest, agents: { _tag: "selected", ids: ["cursor"] } }, notAbortedSignal);

    expect(await readText(".claude/settings.json")).toBe(originalSettings);
  });

  it("tracks a hooks container created by an update after a hookless installation", async () => {
    const { root, preparedRoot, writeFiles, readText } = await createWorkspace();
    const originalSettings = '{\r\n\t"env": { "keep":"yes" }\r\n}\r\n';
    const baseRequest = request({ root, preparedRoot, features: ["scratch-folder-guard"] });
    await writeFiles({ ".claude/settings.json": originalSettings });
    await install({ ...baseRequest, agents: { _tag: "selected", ids: ["cursor"] } }, notAbortedSignal);

    await update({ ...baseRequest, agents: { _tag: "selected", ids: ["claude-code"] } }, notAbortedSignal);
    expect(await readText(".claude/settings.json")).toContain("scratch-folder-guard/hooks/scratch-folder-guard.js");
    await update({ ...baseRequest, agents: { _tag: "selected", ids: ["cursor"] } }, notAbortedSignal);

    expect(await readText(".claude/settings.json")).toBe(originalSettings);
  });

  it("resets a receipted config.json that no longer decodes and records the new bytes", async () => {
    const { root, preparedRoot, writeFiles, readText } = await createWorkspace();
    const configPath = ".claude/agent-setup/config.json";
    const baseRequest = request({ root, preparedRoot, features: ["scratch-folder-guard"] });
    await install(
      {
        ...baseRequest,
        configuration: { _tag: "selected", config: { ...defaultConfig, sessionRehomeRoots: ["fixtures"] } },
      },
      notAbortedSignal,
    );
    // Neither decodable nor the receipted bytes: both guards that used to block a reset.
    await writeFiles({
      [configPath]: '{ "sessionRehomeRoots": ["fixtures"], "unknownSetting": true,\n',
    });

    await expect(update({ ...baseRequest, features: { _tag: "preserve" } }, notAbortedSignal)).rejects.toThrow();

    await update(
      { ...baseRequest, features: { _tag: "preserve" }, configuration: { _tag: "reset" } },
      notAbortedSignal,
    );

    const configBytes = await readFile(join(root, configPath));
    expect(JSON.parse(new TextDecoder().decode(configBytes))).toEqual(defaultConfig);
    const receipt = JSON.parse(await readText(".claude/agent-setup/receipt.json"));
    const managedConfigFile = receipt.ownedFiles.find((file: { path: string }) => file.path === configPath);
    expect(managedConfigFile.ownership.installedHash).toBe(createHash("sha256").update(configBytes).digest("hex"));
    expect(managedConfigFile.ownership.previous).toEqual({ _tag: "missing" });
  });

  it("install adds a dependency that an older receipt does not list", async () => {
    const { root, preparedRoot, writeFiles, readText, exists } = await createWorkspace();
    await writeFiles({ ".claude/agent-setup/receipt.json": RECEIPT_BEFORE_REMINDER_JSON });

    const installSummary = await install(
      {
        ...request({ root, preparedRoot, features: ["run-tasks-in-parallel"] }),
        configuration: selectedDefaults,
      },
      notAbortedSignal,
    );

    expect(installSummary.features).toEqual(REMINDER_RECEIPT_FEATURES);
    expect(exists(".claude/agent-setup/hooks/active-run-reminder/hooks/active-run-reminder.js")).toBe(true);
    expect(await readText(".claude/settings.json")).toContain("SubagentStart");
    expect(JSON.parse(await readText(".claude/agent-setup/receipt.json")).features).toEqual(REMINDER_RECEIPT_FEATURES);
  });

  it("update adds a dependency that an older receipt does not list", async () => {
    const { root, preparedRoot, writeFiles, readText, exists } = await createWorkspace();
    await writeFiles({ ".claude/agent-setup/receipt.json": RECEIPT_BEFORE_REMINDER_JSON });

    const updateSummary = await update(
      {
        ...request({ root, preparedRoot, features: [] }),
        features: { _tag: "preserve" },
        configuration: selectedDefaults,
      },
      notAbortedSignal,
    );

    expect(updateSummary.features).toEqual(REMINDER_RECEIPT_FEATURES);
    expect(exists(".claude/agent-setup/hooks/active-run-reminder/hooks/active-run-reminder.js")).toBe(true);
    expect(await readText(".claude/settings.json")).toContain("SessionStart");
    expect(JSON.parse(await readText(".claude/agent-setup/receipt.json")).features).toEqual(REMINDER_RECEIPT_FEATURES);
  });

  it("update refreshes a dependency that an older receipt does not list", async () => {
    const { root, preparedRoot, writeFiles } = await createWorkspace();
    await writeFiles({ ".claude/agent-setup/receipt.json": RECEIPT_BEFORE_REMINDER_JSON });

    const updateSummary = await update(
      {
        ...request({ root, preparedRoot, features: [] }),
        features: { _tag: "refresh", ids: ["active-run-reminder"] },
        configuration: selectedDefaults,
      },
      notAbortedSignal,
    );

    expect(updateSummary.features).toEqual(REMINDER_RECEIPT_FEATURES);
  });
});
