import { createHash } from "node:crypto";

import { Either, Option } from "effect";
import { describe, expect, expectTypeOf, it } from "vitest";

import { agentCatalog } from "../../catalog/agent-catalog.js";
import { findFeature } from "../../catalog/feature-catalog.js";
import type { OwnedFile } from "../ownership.js";
import { type InstructionFilePlan, InstructionFilePlanError, planInstructionFile } from "./instruction-file.js";

const startMarker = "<!-- agent-setup:skills start -->";
const endMarker = "<!-- agent-setup:skills end -->";
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const makeCodeReadable = findFeature("make-code-readable")!;
const simplifyCode = findFeature("simplify-code")!;
const makeCodeReadableSkill = Option.getOrThrow(
  Option.liftPredicate(makeCodeReadable.installedSkill, (skill) => skill._tag === "skill"),
);
const simplifyCodeSkill = Option.getOrThrow(
  Option.liftPredicate(simplifyCode.installedSkill, (skill) => skill._tag === "skill"),
);

const encode = (value: string): Uint8Array => textEncoder.encode(value);

const decode = (value: Uint8Array): string => textDecoder.decode(value);

const hash = (value: Uint8Array): string => createHash("sha256").update(value).digest("hex");

const desiredSkill = (markdown = "Alpha body.") => ({
  installedSkill: makeCodeReadableSkill,
  markdown,
});

const request = (input?: {
  agentIds?: ReadonlyArray<string>;
  currentBytes?: Uint8Array;
  desired?: "present" | "absent";
  path?: string;
  previousFile?: OwnedFile;
  skills?: ReadonlyArray<{ installedSkill: typeof makeCodeReadableSkill; markdown: string }>;
}) => ({
  path: input?.path || "AGENTS.md",
  desired:
    input?.desired === "absent"
      ? { _tag: "absent" }
      : {
          _tag: "present",
          agentIds: input?.agentIds || ["aider"],
          skills: input?.skills || [desiredSkill()],
        },
  currentFile: input?.currentBytes === undefined ? { _tag: "missing" } : { _tag: "file", bytes: input.currentBytes },
  previousFile: input?.previousFile === undefined ? { _tag: "missing" } : { _tag: "owned", file: input.previousFile },
});

type RequestInput = Parameters<typeof request>[0];

const plan = (input?: RequestInput): InstructionFilePlan =>
  Either.getOrThrowWith(planInstructionFile(request(input)), (error) => new Error(error.message));

const rejects = (input: unknown): boolean => Either.isLeft(planInstructionFile(input));

const write = (input?: RequestInput) => {
  const operation = plan(input);
  if (operation._tag !== "write") {
    throw new Error("Expected one instruction-file write.");
  }

  return operation;
};

const restore = (input?: RequestInput) => {
  const operation = plan(input);
  if (operation._tag !== "restore") {
    throw new Error("Expected one instruction-file restoration.");
  }

  return operation;
};

describe("planInstructionFile", () => {
  it("renders exact catalog skills in order", () => {
    const operation = write({
      skills: [
        desiredSkill("---\nname: make-code-readable\n---\nReadable body.\n"),
        { installedSkill: simplifyCodeSkill, markdown: "---\r\nname: simplify-code\r\n---\r\nV2 body.\r\n" },
      ],
    });
    const expectedContent = "\n## make-code-readable\n\nReadable body.\n\n---\n\n## simplify-code\n\nV2 body.\n";
    const exactInstructionKind: "instruction" = operation.file.kind._tag;

    expectTypeOf(exactInstructionKind).toEqualTypeOf<"instruction">();
    expectTypeOf(operation.file.owner._tag).toEqualTypeOf<"agent">();
    expectTypeOf(operation.file.ownership._tag).toEqualTypeOf<"managedBlock">();
    expect(decode(operation.bytes)).toBe(`${startMarker}${expectedContent}${endMarker}\n`);
    expect(operation.file).toEqual({
      owner: { _tag: "agent", agentIds: ["aider"] },
      path: "AGENTS.md",
      kind: { _tag: "instruction" },
      ownership: {
        _tag: "managedBlock",
        filePreviouslyPresent: false,
        startMarker,
        endMarker,
        installedBodyHash: hash(encode(expectedContent)),
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
      if (agent.target._tag === "instructionFile") {
        return [{ agentId: agent.id, path: agent.target.path }];
      }

      return agent.target._tag === "instructionLink" ? [{ agentId: agent.id, path: agent.target.instructionPath }] : [];
    }),
  )("plans catalog instruction consumer $agentId at $path", ({ agentId, path }) => {
    expect(rejects(request({ agentIds: [agentId], path }))).toBe(false);
  });

  it.each([
    ["opening marker only", `Before${startMarker}body`],
    ["closing marker only", `body${endMarker}`],
    ["reversed markers", `${endMarker}body${startMarker}`],
    ["duplicate blocks", `${startMarker}one${endMarker}${startMarker}two${endMarker}`],
  ])("rejects %s", (_case, current) => {
    const instructionMerge = planInstructionFile(request({ currentBytes: encode(current) }));

    expect(Either.isLeft(instructionMerge)).toBe(true);
    if (Either.isLeft(instructionMerge)) {
      expect(instructionMerge.left).toBeInstanceOf(InstructionFilePlanError);
      expect(instructionMerge.left.message).toContain("marker");
    }
  });

  it("rejects edits inside a receipted body and changed framing", () => {
    const installed = write();
    const editedContent = encode(`${startMarker}\nEdited\n${endMarker}\n`);

    expect(rejects(request({ currentBytes: editedContent, previousFile: installed.file }))).toBe(true);
    expect(rejects(request({ currentBytes: installed.bytes.slice(0, -1), previousFile: installed.file }))).toBe(true);
  });

  it.each([["unknown request property", { ...request(), unexpected: true }]])(
    "rejects %s at the strict request boundary",
    (_case, input) => {
      expect(rejects(input)).toBe(true);
    },
  );

  it("rejects prior owners that cannot legitimately consume the shared path", () => {
    const installed = write();
    const forged = { ...installed.file, owner: { _tag: "agent", agentIds: ["gemini"] } };

    expect(
      rejects({ ...request({ currentBytes: installed.bytes }), previousFile: { _tag: "owned", file: forged } }),
    ).toBe(true);
  });
});
