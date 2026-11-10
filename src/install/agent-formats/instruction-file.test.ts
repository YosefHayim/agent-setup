import { createHash } from "node:crypto";

import { describe, expect, expectTypeOf, it } from "vitest";

import { agentCatalog } from "#src/catalog/agent-catalog.js";
import { findFeature } from "#src/catalog/feature-catalog.js";
import type { OwnedFile } from "#src/install/ownership.js";
import { type InstructionFilePlan, planInstructionFile } from "./instruction-file.js";

const startMarker = "<!-- agent-setup:skills start -->";
const endMarker = "<!-- agent-setup:skills end -->";
const stringEncoder = new TextEncoder();
const stringDecoder = new TextDecoder();

const createInstalledSkill = (featureId: string) => {
  const feature = findFeature(featureId);

  const isFeatureMissing = feature == null;
  if (isFeatureMissing) {
    throw new Error(`Unknown feature: ${featureId}`);
  }

  const isSkillMissing = feature.installedSkill._tag !== "skill";
  if (isSkillMissing) {
    throw new Error(`Feature has no installed skill: ${featureId}`);
  }

  return feature.installedSkill;
};

const makeCodeReadableSkill = createInstalledSkill("make-code-readable");
const simplifyCodeSkill = createInstalledSkill("simplify-code");

const encode = (field: string): Uint8Array => stringEncoder.encode(field);

const decode = (field: Uint8Array): string => stringDecoder.decode(field);

const hash = (field: Uint8Array): string => createHash("sha256").update(field).digest("hex");

const createDesiredSkill = (markdown = "Alpha body.") => ({
  installedSkill: makeCodeReadableSkill,
  markdown,
});

const request = (overrides?: {
  agentIds?: ReadonlyArray<string>;
  currentBytes?: Uint8Array;
  desired?: "present" | "absent";
  path?: string;
  previousFile?: OwnedFile;
  skills?: ReadonlyArray<{ installedSkill: typeof makeCodeReadableSkill; markdown: string }>;
}) => {
  const isDesiredAbsent = overrides?.desired === "absent";
  const isCurrentBytesUnset = overrides?.currentBytes == null;
  const isPreviousFileUnset = overrides?.previousFile == null;
  return {
    path: overrides?.path || "AGENTS.md",
    desired: isDesiredAbsent
      ? { _tag: "absent" }
      : {
          _tag: "present",
          agentIds: overrides?.agentIds || ["aider"],
          skills: overrides?.skills || [createDesiredSkill()],
        },
    currentFile: isCurrentBytesUnset ? { _tag: "missing" } : { _tag: "file", bytes: overrides.currentBytes },
    previousFile: isPreviousFileUnset ? { _tag: "missing" } : { _tag: "owned", file: overrides.previousFile },
  };
};

type RequestOverrides = Parameters<typeof request>[0];

const plan = (overrides?: RequestOverrides): InstructionFilePlan => planInstructionFile(request(overrides));

const findRejectionMessage = (uncheckedRequest: unknown): boolean => {
  try {
    planInstructionFile(uncheckedRequest);
    return false;
  } catch {
    return true;
  }
};

const write = (overrides?: RequestOverrides) => {
  const operation = plan(overrides);

  const isNotWriteOperation = operation._tag !== "write";
  if (isNotWriteOperation) {
    throw new Error("Expected one instruction-file write.");
  }

  return operation;
};

const restore = (overrides?: RequestOverrides) => {
  const operation = plan(overrides);

  const isNotRestoreOperation = operation._tag !== "restore";
  if (isNotRestoreOperation) {
    throw new Error("Expected one instruction-file restoration.");
  }

  return operation;
};

describe("planInstructionFile", () => {
  it("renders exact catalog skills in order", () => {
    const operation = write({
      skills: [
        createDesiredSkill("---\nname: make-code-readable\n---\nReadable body.\n"),
        { installedSkill: simplifyCodeSkill, markdown: "---\r\nname: simplify-code\r\n---\r\nV2 body.\r\n" },
      ],
    });
    const expectedMessage = "\n## make-code-readable\n\nReadable body.\n\n---\n\n## simplify-code\n\nV2 body.\n";
    const exactInstructionKind: "instruction" = operation.file.kind._tag;

    expectTypeOf(exactInstructionKind).toEqualTypeOf<"instruction">();
    expectTypeOf(operation.file.owner._tag).toEqualTypeOf<"agent">();
    expectTypeOf(operation.file.ownership._tag).toEqualTypeOf<"managedBlock">();
    expect(decode(operation.bytes)).toBe(`${startMarker}${expectedMessage}${endMarker}\n`);
    expect(operation.file).toEqual({
      owner: { _tag: "agent", agentIds: ["aider"] },
      path: "AGENTS.md",
      kind: { _tag: "instruction" },
      ownership: {
        _tag: "managedBlock",
        filePreviouslyPresent: false,
        startMarker,
        endMarker,
        installedBodyHash: hash(encode(expectedMessage)),
      },
    });
  });

  it("preserves every existing byte while appending one reversible block", () => {
    const existing = encode("# User rules\n\nKeep trailing spaces.  ");
    const operation = write({ currentBytes: existing });

    expect(decode(operation.bytes)).toBe(
      `# User rules\n\nKeep trailing spaces.  \n\n${startMarker}\n## make-code-readable\n\nAlpha body.\n${endMarker}\n`,
    );
    expect(operation.bytes.slice(0, existing.byteLength)).toEqual(existing);
  });

  it("evolves shared AGENTS owners across Aider and Continue in catalog order", () => {
    const aider = write();
    const allOwners = write({
      agentIds: ["aider", "continue"],
      currentBytes: aider.bytes,
      previousFile: aider.file,
    });
    const aiderAgain = write({
      currentBytes: allOwners.bytes,
      previousFile: allOwners.file,
    });

    expect(aider.file.owner).toEqual({ _tag: "agent", agentIds: ["aider"] });
    expect(allOwners.file.owner).toEqual({ _tag: "agent", agentIds: ["aider", "continue"] });
    expect(aiderAgain.file.owner).toEqual({ _tag: "agent", agentIds: ["aider"] });
    expect(allOwners.bytes).toEqual(aider.bytes);
    expect(aiderAgain.bytes).toEqual(aider.bytes);
  });

  it("restores exact surrounding bytes when the final shared owner leaves", () => {
    const original = encode("User bytes without a final newline");
    const installed = write({ currentBytes: original });
    const removed = restore({
      desired: "absent",
      currentBytes: installed.bytes,
      previousFile: installed.file,
    });

    expect(removed.file).toEqual(installed.file);
    expect(removed.bytes).toEqual(original);
  });

  it("keeps user content appended after an installed block separated from the original prefix", () => {
    const installed = write({ currentBytes: encode("User bytes") });
    const currentBytes = encode(`${decode(installed.bytes)}Later rules\n`);
    const restored = restore({
      desired: "absent",
      currentBytes,
      previousFile: installed.file,
    });

    expect(decode(restored.bytes)).toBe("User bytes\nLater rules\n");
  });

  it("keeps a CRLF-prefixed user suffix without inserting an extra line feed", () => {
    const installed = write({ currentBytes: encode("User bytes") });
    const currentBytes = encode(`${decode(installed.bytes)}\r\nLater rules\r\n`);
    const restored = restore({
      desired: "absent",
      currentBytes,
      previousFile: installed.file,
    });

    expect(decode(restored.bytes)).toBe("User bytes\r\nLater rules\r\n");
  });

  it("removes a file created only for the managed block", () => {
    const installed = write();
    const removed = plan({
      desired: "absent",
      currentBytes: installed.bytes,
      previousFile: installed.file,
    });

    expect(removed).toEqual({ _tag: "remove", file: installed.file, unownedBytes: new Uint8Array() });
  });

  it("returns no operation when the path is absent and has no prior ownership", () => {
    expect(plan({ desired: "absent" })).toEqual({ _tag: "none" });
  });

  it("ignores malformed reserved markers in an unreceipted file when absence is desired", () => {
    expect(plan({ desired: "absent", currentBytes: encode(`User bytes ${startMarker}`) })).toEqual({ _tag: "none" });
  });

  it.each(
    agentCatalog.flatMap((agent) => {
      const target = agent.target;
      const isInstructionFileTarget = target._tag === "instructionFile";
      if (isInstructionFileTarget) {
        return [{ agentId: agent.id, path: target.path }];
      }

      const isInstructionLinkTarget = target._tag === "instructionLink";
      return isInstructionLinkTarget ? [{ agentId: agent.id, path: target.instructionPath }] : [];
    }),
  )("plans catalog instruction consumer $agentId at $path", ({ agentId, path }) => {
    expect(findRejectionMessage(request({ agentIds: [agentId], path }))).toBe(false);
  });

  it.each([
    ["opening marker only", `Before${startMarker}body`],
    ["closing marker only", `body${endMarker}`],
    ["reversed markers", `${endMarker}body${startMarker}`],
    ["duplicate blocks", `${startMarker}one${endMarker}${startMarker}two${endMarker}`],
  ])("rejects %s", (_case, current) => {
    expect(() => planInstructionFile(request({ currentBytes: encode(current) }))).toThrow("marker");
  });

  it("rejects edits inside a receipted body and changed framing", () => {
    const installed = write();
    const editedMessage = encode(`${startMarker}\nEdited\n${endMarker}\n`);

    expect(findRejectionMessage(request({ currentBytes: editedMessage, previousFile: installed.file }))).toBe(true);
    expect(
      findRejectionMessage(request({ currentBytes: installed.bytes.slice(0, -1), previousFile: installed.file })),
    ).toBe(true);
  });

  it.each([["unknown request property", { ...request(), unexpected: true }]])(
    "rejects %s at the strict request boundary",
    (_case, uncheckedRequest) => {
      expect(findRejectionMessage(uncheckedRequest)).toBe(true);
    },
  );

  it("rejects prior owners that cannot legitimately consume the shared path", () => {
    const installed = write();
    const forged = { ...installed.file, owner: { _tag: "agent", agentIds: ["gemini"] } };

    expect(
      findRejectionMessage({
        ...request({ currentBytes: installed.bytes }),
        previousFile: { _tag: "owned", file: forged },
      }),
    ).toBe(true);
  });
});
