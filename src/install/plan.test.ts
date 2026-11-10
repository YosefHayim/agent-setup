import { describe, expect, it } from "vitest";

import { checkPlan } from "./plan.js";
import { planInstall, planUninstall } from "./plan-changes.js";

const oldHash = "1111111111111111111111111111111111111111111111111111111111111111";
const newHash = "2222222222222222222222222222222222222222222222222222222222222222";
const desiredBytes = new TextEncoder().encode("desired");
const newSkillBytes = new TextEncoder().encode("new-skill");
const newSettingsBytes = new TextEncoder().encode("new-config");
const previousSkillBytes = new TextEncoder().encode("previous-skill");
const previousInstructionBytes = new TextEncoder().encode("previous-instruction");

const applicationOwner = { _tag: "application" };
const createAgentOwner = (agentIds: ReadonlyArray<string>) => ({ _tag: "agent", agentIds });
const missingPrevious = { _tag: "missing" };
const expectedMissing = { _tag: "missing" };
const expectedPresent = { _tag: "file", sha256: oldHash };

const runtimeFile = {
  path: ".claude/agent-setup/hooks/scratch-folder-guard.js",
  kind: { _tag: "runtime" },
  owner: applicationOwner,
  ownership: { _tag: "wholeFile", installedHash: oldHash, previous: missingPrevious },
};

const skillFile = {
  path: ".claude/skills/make-code-readable/SKILL.md",
  kind: { _tag: "skill" },
  owner: createAgentOwner(["claude-code"]),
  ownership: { _tag: "wholeFile", installedHash: oldHash, previous: { _tag: "priorFile", bytes: previousSkillBytes } },
};

const ruleFileLine = {
  path: ".cursor/rules/make-code-readable.mdc",
  kind: { _tag: "rule" },
  owner: createAgentOwner(["cursor"]),
  ownership: { _tag: "wholeFile", installedHash: oldHash, previous: missingPrevious },
};

const instructionFileLine = {
  path: "AGENTS.md",
  kind: { _tag: "instruction" },
  owner: createAgentOwner(["cline", "codex"]),
  ownership: {
    _tag: "managedBlock",
    filePreviouslyPresent: true,
    startMarker: "<!-- agent-setup:skills start -->",
    endMarker: "<!-- agent-setup:skills end -->",
    installedBodyHash: oldHash,
  },
};

const documentReferenceFile = {
  path: ".continue/config.json",
  kind: { _tag: "instructionLink" },
  owner: createAgentOwner(["continue"]),
  ownership: {
    _tag: "jsonValues",
    filePreviouslyPresent: true,
    createdContainers: [],
    values: [
      {
        pointer: "/rules/0",
        installed: { _tag: "value", hash: oldHash },
        previous: { _tag: "value", value: "user-rule.md" },
      },
    ],
  },
};

const yamlReferenceFile = {
  path: ".aider.conf.yml",
  kind: { _tag: "instructionLink" },
  owner: createAgentOwner(["aider"]),
  ownership: {
    _tag: "yamlSequenceValue",
    filePreviouslyPresent: true,
    key: "read",
    keyPreviouslyPresent: true,
    insertedPrefix: "",
    reference: "AGENTS.md",
    previouslyPresent: false,
  },
};

const settingsFile = {
  path: ".claude/settings.json",
  kind: { _tag: "settings" },
  owner: applicationOwner,
  ownership: {
    _tag: "jsonValues",
    filePreviouslyPresent: true,
    createdContainers: ["/hooks"],
    values: [{ pointer: "/hooks/Stop", installed: { _tag: "value", hash: oldHash }, previous: missingPrevious }],
  },
};

const codexHooksFile = {
  path: ".codex/hooks.json",
  kind: { _tag: "settings" },
  owner: applicationOwner,
  ownership: {
    _tag: "hookEntries",
    filePreviouslyPresent: true,
    createdContainers: [],
    events: [{ pointer: "/hooks/Stop", previouslyPresent: true, entries: [oldHash] }],
  },
};

const managedSettingsFile = {
  path: ".claude/agent-setup/config.json",
  kind: { _tag: "managedConfig" },
  owner: applicationOwner,
  ownership: { _tag: "wholeFile", installedHash: oldHash, previous: missingPrevious },
};

const desiredFiles = [
  runtimeFile,
  skillFile,
  ruleFileLine,
  instructionFileLine,
  documentReferenceFile,
  yamlReferenceFile,
  settingsFile,
  codexHooksFile,
  managedSettingsFile,
];

const receiptTarget = { path: ".claude/agent-setup/receipt.json", kind: { _tag: "receipt" }, owner: applicationOwner };

const desiredReceipt = {
  version: "0.12.0",
  scope: "project",
  features: ["scratch-folder-guard", "make-code-readable"],
  ownedFiles: desiredFiles,
};

const write = (file: object, bytes = desiredBytes) => ({
  _tag: "write",
  file,
  bytes,
  expectedCurrent: expectedMissing,
});

const restore = (file: object, bytes: Uint8Array) => ({
  _tag: "restore",
  file,
  bytes,
  expectedCurrent: expectedMissing,
});

const remove = (file: object) => ({
  _tag: "remove",
  file,
  unownedBytes: new Uint8Array(),
  expectedCurrent: expectedMissing,
});

const attachOwnership = <File extends { readonly ownership: object }>(file: File, ownership: object) => ({
  ...file,
  ownership: { ...file.ownership, ...ownership },
});

const publishPlan = (operations: ReadonlyArray<object>, ownedFiles: ReadonlyArray<object>) => ({
  scope: "project",
  root: "/workspace",
  operations,
  preconditions: [],
  receipt: {
    _tag: "receiptPublish",
    target: receiptTarget,
    receipt: { ...desiredReceipt, ownedFiles },
    expectedCurrent: expectedMissing,
  },
});

const createRemovalPlan = (operations: ReadonlyArray<object>) => ({
  scope: "project",
  root: "/workspace",
  operations,
  preconditions: [],
  receipt: { _tag: "remove", target: receiptTarget, expectedCurrent: expectedMissing },
});

const completePlan = publishPlan(
  desiredFiles.map((file) => write(file)),
  desiredFiles,
);

type InstallScenario = {
  // Prior receipt entries; omitted means no receipt exists yet.
  readonly previous?: ReadonlyArray<object>;
  readonly restorations?: ReadonlyArray<object>;
  readonly desired: ReadonlyArray<object>;
  readonly writes?: ReadonlyArray<object>;
};

const installRequest = ({
  previous,
  restorations = [],
  desired,
  writes = desired.map((file) => write(file)),
}: InstallScenario) => {
  const isPreviousMissing = previous == null;
  return {
    root: "/workspace",
    previous: isPreviousMissing
      ? { _tag: "missing" }
      : { _tag: "receipt", receipt: { ...desiredReceipt, ownedFiles: previous } },
    restorations,
    desired: { receipt: { ...desiredReceipt, ownedFiles: desired }, writes },
    receiptTarget,
    receiptExpectedCurrent: isPreviousMissing ? expectedMissing : expectedPresent,
  };
};

const createUninstallRequest = (ownedFiles: ReadonlyArray<object>, restorations: ReadonlyArray<object>) => ({
  root: "/workspace",
  receipt: { ...desiredReceipt, ownedFiles },
  restorations,
  receiptTarget,
  receiptExpectedCurrent: expectedPresent,
});

const createPublishedReceipt = (ownedFiles: ReadonlyArray<object>) => ({
  _tag: "receiptPublish",
  target: receiptTarget,
  receipt: { ...desiredReceipt, ownedFiles },
  expectedCurrent: expectedPresent,
});

// Returns the rejection message; fails the test when the plan was accepted instead.
const readRejectionMessage = (checkRejects: () => unknown): string => {
  try {
    checkRejects();
  } catch (error) {
    const isErrorObject = error instanceof Error;
    if (isErrorObject) {
      return error.message;
    }

    return String(error);
  }

  throw new Error("Expected the plan to be rejected, but it was accepted.");
};

describe("checkPlan", () => {
  it.each([
    { name: "publish plan", plan: completePlan },
    {
      name: "receipt-removal plan",
      plan: {
        ...createRemovalPlan([]),
        receipt: { _tag: "remove", target: receiptTarget, expectedCurrent: expectedPresent },
      },
    },
    {
      name: "plan whose file changes expect present files",
      plan: {
        ...completePlan,
        operations: completePlan.operations.map((operation) => ({ ...operation, expectedCurrent: expectedPresent })),
      },
    },
  ])("accepts inspected target state on a $name", ({ plan }) => {
    expect(() => checkPlan(plan)).not.toThrow();
  });

  it.each([
    {
      name: "receipt publish without inspected state",
      plan: { ...completePlan, receipt: { _tag: "receiptPublish", target: receiptTarget, receipt: desiredReceipt } },
    },
    {
      name: "receipt publish with an invalid inspected hash",
      plan: {
        ...completePlan,
        receipt: { ...completePlan.receipt, expectedCurrent: { _tag: "file", sha256: "invalid" } },
      },
    },
    {
      name: "file change without inspected state",
      plan: { ...completePlan, operations: desiredFiles.map((file) => ({ _tag: "write", file, bytes: desiredBytes })) },
    },
    {
      name: "file change with an invalid inspected hash",
      plan: {
        ...completePlan,
        operations: [{ ...completePlan.operations[0], expectedCurrent: { _tag: "file", sha256: "invalid" } }],
      },
    },
  ])("rejects a $name", ({ plan }) => {
    expect(() => checkPlan(plan)).toThrow();
  });

  it("strictly decodes a published plan with every file kind, owner, and ownership tag", () => {
    const plan = checkPlan(completePlan);

    expect(plan.scope).toBe("project");
    expect(plan.root).toBe("/workspace");
    expect(plan.operations.map((operation) => operation._tag)).toEqual(Array(9).fill("write"));
    expect(plan.receipt._tag).toBe("receiptPublish");
    expect(new Set(plan.receipt.receipt.ownedFiles.map((file) => file.kind._tag))).toEqual(
      new Set(["runtime", "skill", "rule", "instruction", "instructionLink", "settings", "managedConfig"]),
    );
    expect(new Set(plan.receipt.receipt.ownedFiles.map((file) => file.ownership._tag))).toEqual(
      new Set(["wholeFile", "managedBlock", "jsonValues", "hookEntries", "yamlSequenceValue"]),
    );
    expect(new Set(plan.receipt.receipt.ownedFiles.map((file) => file.owner._tag))).toEqual(
      new Set(["application", "agent"]),
    );
    expect(plan.receipt.target.kind).toEqual({ _tag: "receipt" });
  });

  it.each([
    { name: "plan", rejectedPlan: { ...completePlan, unexpected: true } },
    {
      name: "write operation",
      rejectedPlan: { ...completePlan, operations: [{ ...completePlan.operations[0], unexpected: true }] },
    },
    {
      name: "receipt operation",
      rejectedPlan: { ...completePlan, receipt: { ...completePlan.receipt, unexpected: true } },
    },
    {
      name: "file target",
      rejectedPlan: {
        ...completePlan,
        operations: [{ ...completePlan.operations[0], file: { ...runtimeFile, unexpected: true } }],
      },
    },
  ])("rejects unknown keys on the $name", ({ rejectedPlan }) => {
    expect(readRejectionMessage(() => checkPlan(rejectedPlan))).toContain("Unrecognized key");
  });

  it.each(["../outside", "/absolute/path", ".claude/../outside", "nested\\windows"])(
    "rejects escaping or non-canonical relative path %s",
    (path) => {
      expect(
        readRejectionMessage(() => checkPlan({ ...completePlan, operations: [write({ ...runtimeFile, path })] })),
      ).toContain("path");
    },
  );

  it.each(["/workspace", "/", "C:/workspace", "z:/workspace/project"])(
    "accepts canonical cross-platform absolute root %s",
    (root) => {
      expect(() => checkPlan({ ...completePlan, root })).not.toThrow();
    },
  );

  it.each(["C:workspace", "C:\\workspace", "C://workspace", "/workspace//nested", "C:/workspace/../outside"])(
    "rejects non-canonical absolute root %s",
    (root) => {
      expect(readRejectionMessage(() => checkPlan({ ...completePlan, root }))).toContain("root");
    },
  );

  it.each([
    {
      name: "duplicate targets",
      operations: [write(runtimeFile), write({ ...runtimeFile, kind: { _tag: "managedConfig" } })],
      message: "unique",
    },
    {
      name: "parent and child targets",
      operations: [
        write({ ...managedSettingsFile, path: ".claude/agent-setup" }),
        write({ ...runtimeFile, path: ".claude/agent-setup/hooks/scratch-folder-guard.js" }),
      ],
      message: "conflicts with",
    },
  ])("rejects $name with a property-addressed issue", ({ operations, message }) => {
    const rejectedCheckMessage = readRejectionMessage(() => checkPlan({ ...completePlan, operations }));

    expect(rejectedCheckMessage).toContain("operations.1.file.path");
    expect(rejectedCheckMessage).toContain(message);
  });

  it("rejects case-folded target collisions on common macOS and Windows filesystems", () => {
    const first = { ...runtimeFile, path: ".agent-setup/Hooks/scratch-folder-guard.js" };
    const second = { ...managedSettingsFile, path: ".agent-setup/hooks/SCRATCH-FOLDER-GUARD.JS" };

    expect(readRejectionMessage(() => checkPlan(createRemovalPlan([remove(first), remove(second)])))).toContain(
      "operations.1.file.path",
    );
  });

  it.each([
    { name: "runtime owned by an agent", file: { ...runtimeFile, owner: createAgentOwner(["codex"]) } },
    { name: "skill owned by the application", file: { ...skillFile, owner: applicationOwner } },
    {
      name: "instruction with whole-file ownership",
      file: { ...instructionFileLine, ownership: skillFile.ownership },
    },
    {
      name: "settings with managed-block ownership",
      file: { ...settingsFile, ownership: instructionFileLine.ownership },
    },
  ])("rejects invalid ownership-kind combination: $name", ({ file }) => {
    expect(readRejectionMessage(() => checkPlan({ ...completePlan, operations: [write(file)] }))).toContain(
      "incompatible",
    );
  });

  it.each([
    { name: "empty agent ownership", owner: createAgentOwner([]) },
    { name: "duplicate agent ownership", owner: createAgentOwner(["codex", "codex"]) },
  ])("rejects $name", ({ owner }) => {
    expect(
      readRejectionMessage(() =>
        checkPlan({ ...completePlan, operations: [write({ ...instructionFileLine, owner })] }),
      ),
    ).toContain("agentIds");
  });

  it.each([
    {
      name: "owner",
      receipt: { ...completePlan.receipt, target: { ...receiptTarget, owner: createAgentOwner(["codex"]) } },
    },
    { name: "kind", receipt: { ...completePlan.receipt, target: { ...receiptTarget, kind: { _tag: "runtime" } } } },
    { name: "scope", receipt: { ...completePlan.receipt, receipt: { ...desiredReceipt, scope: "global" } } },
  ])("rejects an inconsistent receipt $name", ({ receipt }) => {
    expect(() => checkPlan({ ...completePlan, receipt })).toThrow();
  });

  it("requires the canonical receipt.json basename", () => {
    const target = { ...receiptTarget, path: ".claude/agent-setup/manifest.json" };

    expect(
      readRejectionMessage(() => checkPlan({ ...completePlan, receipt: { ...completePlan.receipt, target } })),
    ).toContain("receipt.json");
  });

  it.each([
    { reservedPath: ".claude/agent-setup/receipt.json", label: "receipt" },
    { reservedPath: ".claude/agent-setup/recovery.json", label: "recovery" },
  ])("rejects an operation conflicting with the reserved $label path", ({ reservedPath }) => {
    const rejectedCheckMessage = readRejectionMessage(() =>
      checkPlan(createRemovalPlan([remove({ ...runtimeFile, path: reservedPath })])),
    );

    expect(rejectedCheckMessage).toContain("operations.0.file.path");
    expect(rejectedCheckMessage).toContain(reservedPath);
  });

  it("rejects a published file conflicting with the reserved recovery path", () => {
    const file = { ...runtimeFile, path: ".claude/agent-setup/recovery.json/snapshot" };
    const rejectedCheckMessage = readRejectionMessage(() => checkPlan(publishPlan([write(file)], [file])));

    expect(rejectedCheckMessage).toContain("receipt.receipt.ownedFiles.0.path");
    expect(rejectedCheckMessage).toContain("recovery.json");
  });

  it("reserves receipt and recovery paths case-insensitively", () => {
    const file = { ...runtimeFile, path: ".CLAUDE/AGENT-SETUP/RECOVERY.JSON" };

    expect(readRejectionMessage(() => checkPlan(createRemovalPlan([remove(file)])))).toContain("recovery.json");
  });

  it("represents receipt publication separately and last", () => {
    expect(() =>
      checkPlan({ ...completePlan, operations: [...completePlan.operations, completePlan.receipt] }),
    ).toThrow();
  });

  it("accepts byte-backed restoration as a final action absent from the next receipt", () => {
    expect(() => checkPlan(publishPlan([restore(skillFile, previousSkillBytes)], []))).not.toThrow();
  });

  it("requires exact recorded prior bytes for a whole-file restoration", () => {
    expect(readRejectionMessage(() => checkPlan(createRemovalPlan([restore(skillFile, desiredBytes)])))).toContain(
      "recorded prior bytes",
    );
    expect(() => checkPlan(createRemovalPlan([restore(runtimeFile, desiredBytes)]))).toThrow();
  });

  it("allows deletion only when the receipt proves the whole file or partial host file was originally absent", () => {
    const absentPartialFile = attachOwnership(instructionFileLine, { filePreviouslyPresent: false });

    expect(() => checkPlan(createRemovalPlan([remove(runtimeFile), remove(absentPartialFile)]))).not.toThrow();
    expect(() => checkPlan(createRemovalPlan([remove(skillFile)]))).toThrow();
    expect(() => checkPlan(createRemovalPlan([remove(instructionFileLine)]))).toThrow();
  });

  it.each([
    { name: "JSON", file: attachOwnership(documentReferenceFile, { filePreviouslyPresent: false }) },
    {
      name: "YAML",
      file: attachOwnership(yamlReferenceFile, { filePreviouslyPresent: false, previouslyPresent: true }),
    },
  ])("rejects $name partial-host deletion when receipt history proves unowned content must remain", ({ file }) => {
    expect(() => checkPlan(createRemovalPlan([remove(file)]))).toThrow();
  });

  it("requires empty unowned bytes before deleting an absent partial host", () => {
    const absentPartialFile = attachOwnership(instructionFileLine, { filePreviouslyPresent: false });

    expect(
      readRejectionMessage(() =>
        checkPlan(createRemovalPlan([{ ...remove(absentPartialFile), unownedBytes: desiredBytes }])),
      ),
    ).toContain("no unowned bytes remain");
  });

  it("restores an originally present partial file even when its final bytes are empty", () => {
    expect(() => checkPlan(createRemovalPlan([restore(instructionFileLine, new Uint8Array())]))).not.toThrow();
  });

  it("requires restore and remove actions to be absent from a published receipt", () => {
    expect(() => checkPlan(publishPlan([restore(skillFile, previousSkillBytes)], [skillFile]))).toThrow();
    expect(() => checkPlan(publishPlan([remove(runtimeFile)], [runtimeFile]))).toThrow();
  });

  it("requires written file metadata to exactly match the published receipt", () => {
    expect(
      readRejectionMessage(() =>
        checkPlan(publishPlan([write(attachOwnership(runtimeFile, { installedHash: newHash }))], [runtimeFile])),
      ),
    ).toContain("exactly match");
  });

  it("forbids normal desired writes in a receipt-removal plan", () => {
    expect(() => checkPlan(createRemovalPlan([write(runtimeFile)]))).toThrow();
  });
});

describe("planInstall", () => {
  it("rejects desired receipt entries that have no one-to-one desired write", () => {
    const runCheckWithoutDesiredWrite = () =>
      planInstall(installRequest({ desired: [runtimeFile, skillFile], writes: [write(runtimeFile)] }));

    expect(readRejectionMessage(runCheckWithoutDesiredWrite)).toContain(
      "Every desired receipt entry must have exactly one desired write",
    );
  });

  it.each([
    { name: "duplicate", writes: [write(runtimeFile), write(runtimeFile)] },
    { name: "extra", writes: [write(runtimeFile), write(skillFile)] },
    { name: "metadata-mismatched", writes: [write(attachOwnership(runtimeFile, { installedHash: newHash }))] },
  ])("rejects $name desired writes", ({ writes }) => {
    expect(() => planInstall(installRequest({ desired: [runtimeFile], writes }))).toThrow();
  });

  it("adds, changes, removes only receipt-owned stale entries, omits unchanged state, and preserves restoration metadata", () => {
    const unchanged = runtimeFile;
    const stale = { ...ruleFileLine, path: ".cursor/rules/removed.mdc" };
    const desiredChanged = {
      ...skillFile,
      ownership: { _tag: "wholeFile", installedHash: newHash, previous: missingPrevious },
    };
    const preservedChanged = attachOwnership(desiredChanged, { previous: skillFile.ownership.previous });
    const added = managedSettingsFile;

    const plan = planInstall(
      installRequest({
        previous: [unchanged, skillFile, stale],
        restorations: [remove(stale)],
        desired: [unchanged, desiredChanged, added],
        writes: [write(unchanged), write(desiredChanged, newSkillBytes), write(added, newSettingsBytes)],
      }),
    );

    expect(plan.operations).toEqual([
      remove(stale),
      write(preservedChanged, newSkillBytes),
      write(added, newSettingsBytes),
    ]);
    expect(plan.receipt).toEqual(createPublishedReceipt([unchanged, preservedChanged, added]));
    expect(plan.preconditions).toEqual([{ path: unchanged.path, expectedCurrent: expectedMissing }]);
  });

  it("publishes deterministically from missing prior state without inventing removes", () => {
    const request = installRequest({ desired: desiredFiles });
    const first = planInstall(request);

    expect(planInstall(request)).toEqual(first);
    expect(first.operations.every((operation) => operation._tag === "write")).toBe(true);
  });

  it("does not reuse YAML restoration state when the owned key-reference pair changes", () => {
    const previousYaml = attachOwnership(yamlReferenceFile, { previouslyPresent: true });
    const desiredYaml = attachOwnership(yamlReferenceFile, {
      filePreviouslyPresent: false,
      reference: "AGENT-SETUP.md",
      previouslyPresent: false,
    });
    const preservedYaml = attachOwnership(desiredYaml, { filePreviouslyPresent: true });
    const plan = planInstall(installRequest({ previous: [previousYaml], desired: [desiredYaml] }));

    expect(plan.operations).toEqual([write(preservedYaml)]);
    expect(plan.receipt).toEqual(createPublishedReceipt([preservedYaml]));
  });

  it("preserves original file absence while retaining previous values acquired by later JSON ownership", () => {
    const previousFile = attachOwnership(documentReferenceFile, {
      filePreviouslyPresent: false,
      values: [{ pointer: "/rules/0", installed: { _tag: "value", hash: oldHash }, previous: missingPrevious }],
    });
    const acquiredField = {
      pointer: "/rules/1",
      installed: { _tag: "value", hash: newHash },
      previous: { _tag: "value", value: "user-rule.md" },
    };
    const desiredFile = attachOwnership(documentReferenceFile, {
      values: [
        {
          pointer: "/rules/0",
          installed: { _tag: "value", hash: newHash },
          previous: { _tag: "value", value: "installed-rule.md" },
        },
        acquiredField,
      ],
    });
    const expectedFile = attachOwnership(documentReferenceFile, {
      filePreviouslyPresent: false,
      values: [
        { pointer: "/rules/0", installed: { _tag: "value", hash: newHash }, previous: missingPrevious },
        acquiredField,
      ],
    });
    const plan = planInstall(installRequest({ previous: [previousFile], desired: [desiredFile] }));

    expect(plan.operations).toEqual([write(expectedFile)]);
    expect(plan.receipt).toEqual(createPublishedReceipt([expectedFile]));
  });

  it("preserves prior created JSON containers while adding newly created ancestors", () => {
    const previousFile = attachOwnership(settingsFile, { filePreviouslyPresent: false });
    const desiredFile = attachOwnership(settingsFile, {
      createdContainers: ["/permissions"],
      values: [
        {
          pointer: "/hooks/Stop",
          installed: { _tag: "value", hash: oldHash },
          previous: { _tag: "value", value: [], lexical: { _tag: "value", source: "[]" } },
        },
        { pointer: "/permissions/allow", installed: { _tag: "value", hash: newHash }, previous: missingPrevious },
      ],
    });
    const plan = planInstall(installRequest({ previous: [previousFile], desired: [desiredFile] }));

    expect(plan.receipt).toMatchObject({
      _tag: "receiptPublish",
      receipt: {
        ownedFiles: [
          {
            ownership: {
              createdContainers: ["/hooks", "/permissions"],
              values: [
                { installed: { _tag: "value", hash: oldHash }, previous: missingPrevious },
                { installed: { _tag: "value", hash: newHash }, previous: missingPrevious },
              ],
            },
          },
        ],
      },
    });
  });

  it("rejects acquiring JSON container deletion authority without a new owned pointer", () => {
    const previousFile = attachOwnership(settingsFile, { createdContainers: [] });

    expect(() => planInstall(installRequest({ previous: [previousFile], desired: [settingsFile] }))).toThrow();
  });

  it("migrates a whole-array settings receipt to hook entry ownership with its first-install history", () => {
    const previousFile = attachOwnership(settingsFile, {
      createdContainers: [],
      values: [
        {
          pointer: "/hooks/Stop",
          installed: { _tag: "value", hash: oldHash },
          previous: { _tag: "value", value: [], lexical: { _tag: "value", source: "[]" } },
        },
      ],
    });
    const desiredFile = {
      ...settingsFile,
      ownership: {
        _tag: "hookEntries",
        filePreviouslyPresent: false,
        createdContainers: [],
        events: [{ pointer: "/hooks/Stop", previouslyPresent: false, entries: [newHash] }],
      },
    };
    const expectedFile = attachOwnership(desiredFile, {
      filePreviouslyPresent: true,
      events: [{ pointer: "/hooks/Stop", previouslyPresent: true, entries: [newHash] }],
    });
    const plan = planInstall(installRequest({ previous: [previousFile], desired: [desiredFile] }));

    expect(plan.operations).toEqual([write(expectedFile)]);
    expect(plan.receipt).toEqual(createPublishedReceipt([expectedFile]));
  });

  it("rejects turning hook entry ownership back into whole-array settings values", () => {
    const previousFile = { ...settingsFile, ownership: codexHooksFile.ownership };

    expect(
      readRejectionMessage(() => planInstall(installRequest({ previous: [previousFile], desired: [settingsFile] }))),
    ).toContain("Cannot change ownership from hookEntries to jsonValues");
  });

  it("keeps an unchanged hook entry file as a precondition instead of rewriting it", () => {
    const plan = planInstall(installRequest({ previous: [codexHooksFile], desired: [codexHooksFile] }));

    expect(plan.operations).toEqual([]);
    expect(plan.preconditions).toEqual([{ path: codexHooksFile.path, expectedCurrent: expectedMissing }]);
  });

  it("preserves retained managed-block and YAML restoration history", () => {
    const desiredInstruction = attachOwnership(instructionFileLine, {
      filePreviouslyPresent: false,
      installedBodyHash: newHash,
    });
    const expectedInstruction = attachOwnership(desiredInstruction, { filePreviouslyPresent: true });
    const previousYaml = attachOwnership(yamlReferenceFile, { keyPreviouslyPresent: false, insertedPrefix: "\n" });
    const desiredYaml = attachOwnership(yamlReferenceFile, { filePreviouslyPresent: false });
    const expectedYaml = attachOwnership(yamlReferenceFile, { keyPreviouslyPresent: false, insertedPrefix: "\n" });
    const plan = planInstall(
      installRequest({
        previous: [instructionFileLine, previousYaml],
        desired: [desiredInstruction, desiredYaml],
      }),
    );

    expect(plan.operations).toEqual([write(expectedInstruction)]);
    expect(plan.receipt).toEqual(createPublishedReceipt([expectedInstruction, expectedYaml]));
  });

  it.each([
    {
      name: "the ownership tag",
      desiredFile: {
        ...documentReferenceFile,
        ownership: { ...yamlReferenceFile.ownership, reference: "AGENT-SETUP.md" },
      },
      issuePath: "desired.receipt.ownedFiles.0.ownership._tag",
    },
    {
      name: "the file kind or owner",
      desiredFile: { ...settingsFile, path: documentReferenceFile.path },
      issuePath: "desired.receipt.ownedFiles.0.kind",
    },
  ])("rejects changing $name at an already receipted path", ({ desiredFile, issuePath }) => {
    const rejectedCheckMessage = readRejectionMessage(() =>
      planInstall(installRequest({ previous: [documentReferenceFile], desired: [desiredFile] })),
    );

    expect(rejectedCheckMessage).toContain(issuePath);
    expect(rejectedCheckMessage).toContain("remove the prior ownership first");
  });
});

const exactRestorations = [restore(skillFile, previousSkillBytes), remove(runtimeFile)];

describe.each([
  {
    planner: "planInstall",
    plan: (restorations: ReadonlyArray<object>) =>
      planInstall(installRequest({ previous: [runtimeFile, skillFile], restorations, desired: [] })),
  },
  {
    planner: "planUninstall",
    plan: (restorations: ReadonlyArray<object>) =>
      planUninstall(createUninstallRequest([runtimeFile, skillFile], restorations)),
  },
])("$planner restoration set", ({ plan }) => {
  it("emits one exact restoration per prior entry in reverse receipt order", () => {
    expect(plan([...exactRestorations].reverse()).operations).toEqual(exactRestorations);
  });

  it.each([
    { name: "a missing", restorations: [remove(runtimeFile)] },
    { name: "an extra", restorations: [...exactRestorations, remove(ruleFileLine)] },
    {
      name: "a duplicate",
      restorations: [restore(skillFile, previousSkillBytes), restore(skillFile, previousSkillBytes)],
    },
    {
      name: "a metadata-mismatched",
      restorations: [
        restore(attachOwnership(skillFile, { installedHash: newHash }), previousSkillBytes),
        remove(runtimeFile),
      ],
    },
  ])("rejects $name restoration", ({ restorations }) => {
    expect(() => plan(restorations)).toThrow();
  });
});

describe("planUninstall", () => {
  it("uses exact reverse-order final restorations from receipt entries and removes the receipt last", () => {
    const restorations = [
      restore(instructionFileLine, previousInstructionBytes),
      restore(skillFile, previousSkillBytes),
      remove(runtimeFile),
    ];
    const plan = planUninstall(createUninstallRequest([runtimeFile, skillFile, instructionFileLine], restorations));

    expect(plan.operations).toEqual(restorations);
    expect(plan.receipt).toEqual({ _tag: "remove", target: receiptTarget, expectedCurrent: expectedPresent });
  });

  it("rejects detection evidence and proves it cannot authorize a remove", () => {
    const request = createUninstallRequest([runtimeFile], [remove(runtimeFile)]);
    const detection = { homePaths: [".cursor"], absolutePaths: [], commands: ["cursor"] };

    expect(() => planUninstall({ ...request, detection })).toThrow();
    expect(planUninstall(request).operations).toEqual([remove(runtimeFile)]);
  });
});
