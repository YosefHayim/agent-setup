import { createHash } from "node:crypto";

import { describe, expect, expectTypeOf, it } from "vitest";

import { findAgent } from "#src/catalog/agent-catalog.js";
import type { FileChange } from "#src/install/plan.js";
import { type InstructionLinkPlan, planInstructionLink } from "./instruction-link.js";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const aider = findAgent("aider")!;
const continueAgent = findAgent("continue")!;

const encode = (text: string): Uint8Array => textEncoder.encode(text);

const decode = (bytes: Uint8Array): string => textDecoder.decode(bytes);

const hashJson = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");

type RequestInput = {
  agent?: typeof aider | typeof continueAgent;
  current?: Uint8Array | string;
  desired?: "present" | "absent";
  previousFile?: FileChange["file"];
};

const request = (input: RequestInput = {}) => ({
  agent: input.agent || aider,
  desired: { _tag: input.desired || "present" },
  currentFile:
    input.current === undefined
      ? { _tag: "missing" }
      : { _tag: "file", bytes: typeof input.current === "string" ? encode(input.current) : input.current },
  previousFile: input.previousFile === undefined ? { _tag: "missing" } : { _tag: "owned", file: input.previousFile },
});

const plan = (input?: RequestInput): InstructionLinkPlan => planInstructionLink(request(input));

// True only when planning throws an Error, which is how a rejected request shows up.
const rejects = (input: unknown): boolean => {
  try {
    planInstructionLink(input);

    return false;
  } catch (error) {
    return error instanceof Error;
  }
};

const write = (input?: RequestInput) => {
  const operation = plan(input);
  if (operation._tag !== "write") {
    throw new Error("Expected one instruction-link write.");
  }

  return operation;
};

const restore = (input?: RequestInput) => {
  const operation = plan(input);
  if (operation._tag !== "restore") {
    throw new Error("Expected one instruction-link restoration.");
  }

  return operation;
};

// Installs the reference into `original`, then removes it again and returns the restoration.
const roundTrip = (input: { agent?: typeof aider | typeof continueAgent; original: string }) => {
  const installed = write({ agent: input.agent, current: input.original });

  return restore({
    agent: input.agent,
    desired: "absent",
    current: installed.bytes,
    previousFile: installed.file,
  });
};

describe("planInstructionLink", () => {
  it("returns no operation when the native reference is absent and unreceipted", () => {
    expect(plan({ desired: "absent" })).toEqual({ _tag: "none" });
  });

  it("plans only Aider native configuration with its exact catalog owner", () => {
    const aiderWrite = write();
    const exactConfigKind: "instructionLink" = aiderWrite.file.kind._tag;

    expectTypeOf(exactConfigKind).toEqualTypeOf<"instructionLink">();
    expectTypeOf(aiderWrite.file.owner._tag).toEqualTypeOf<"agent">();
    expectTypeOf(aiderWrite.file.ownership._tag).toEqualTypeOf<"jsonValues" | "yamlSequenceValue">();
    expect(aiderWrite.file.path).toBe(".aider.conf.yml");
    expect(aiderWrite.file.owner).toEqual({ _tag: "agent", agentIds: ["aider"] });
    expect(decode(aiderWrite.bytes)).toBe("read:\n  - AGENTS.md\n");
    expect(aiderWrite.file.ownership).toEqual({
      _tag: "yamlSequenceValue",
      filePreviouslyPresent: false,
      key: "read",
      keyPreviouslyPresent: false,
      insertedPrefix: "",
      reference: "AGENTS.md",
      previouslyPresent: false,
    });
  });

  it("removes an Aider file created only for the native reference", () => {
    const installed = write();

    expect(plan({ desired: "absent", current: installed.bytes, previousFile: installed.file })).toEqual({
      _tag: "remove",
      file: installed.file,
      unownedBytes: new Uint8Array(),
    });
  });

  it.each(["model: sonnet\n", "model: sonnet", "read:\n  - USER.md", "read:\r\n  - USER.md"])(
    "round-trips Aider configuration %j byte for byte",
    (original) => {
      expect(decode(roundTrip({ original }).bytes)).toBe(original);
    },
  );

  it("keeps a later Aider root key separated from a non-terminated original prefix", () => {
    const installed = write({ current: "model: sonnet" });
    const restored = restore({
      desired: "absent",
      current: `${decode(installed.bytes)}theme: dark\n`,
      previousFile: installed.file,
    });

    expect(decode(restored.bytes)).toBe("model: sonnet\ntheme: dark\n");
  });

  it("adds one Aider reference under an existing block sequence and preserves other bytes", () => {
    const aiderWrite = write({ current: "model: sonnet\nread:\n  - USER.md\ntheme: dark\n" });

    expect(decode(aiderWrite.bytes)).toBe("model: sonnet\nread:\n  - USER.md\n  - AGENTS.md\ntheme: dark\n");
    expect(aiderWrite.file.ownership).toMatchObject({
      keyPreviouslyPresent: true,
      insertedPrefix: "",
      previouslyPresent: false,
    });
  });

  it.each([
    ["the exact installed Aider reference line", "read:\n  - AGENTS.md # user edit\n"],
    ["a handler-created Aider key before removing the pair", "read: # user note\n  - AGENTS.md\n"],
  ])("rejects edits to %s", (_case, current) => {
    const installed = write();

    expect(rejects(request({ desired: "absent", current, previousFile: installed.file }))).toBe(true);
  });

  it.each(['"read":\n  - "AGENTS.md"\n', "read:\n  - AGENTS.md # user-owned\n"])(
    "recognizes one semantically equivalent pre-existing Aider reference in %j",
    (current) => {
      const aiderWrite = write({ current });

      expect(decode(aiderWrite.bytes)).toBe(current);
      expect(aiderWrite.file.ownership).toMatchObject({
        keyPreviouslyPresent: true,
        insertedPrefix: "",
        previouslyPresent: true,
      });
    },
  );

  it("restores the exact prior Continue rules value while preserving unrelated JSON bytes", () => {
    const original = '{ "theme" : "dark", "rules" : ["USER.md"] }\n';
    const restoredSource = decode(roundTrip({ agent: continueAgent, original }).bytes);

    expect(restoredSource.startsWith('{ "theme" : "dark", "rules" : ')).toBe(true);
    expect(JSON.parse(restoredSource)).toEqual(JSON.parse(original));
  });

  it("preserves unrelated Continue JSON bytes when the rules member was initially missing", () => {
    const original = '{ "theme" : "dark" }\n';

    expect(decode(roundTrip({ agent: continueAgent, original }).bytes)).toBe(original);
  });

  it("adds one Continue reference without duplicating an existing one", () => {
    const added = write({ agent: continueAgent, current: '{ "theme" : "dark", "rules" : ["USER.md"] }\n' });
    const existing = '{"rules":["AGENTS.md"]}\n';

    expect(JSON.parse(decode(added.bytes))).toEqual({ theme: "dark", rules: ["USER.md", "AGENTS.md"] });
    expect(decode(write({ agent: continueAgent, current: existing }).bytes)).toBe(existing);
  });

  it("records Continue rules as one installed value without claiming parent containers", () => {
    expect(write({ agent: continueAgent }).file.ownership).toEqual({
      _tag: "jsonValues",
      filePreviouslyPresent: false,
      createdContainers: [],
      values: [
        {
          pointer: "/rules",
          installed: { _tag: "value", hash: hashJson(["AGENTS.md"]) },
          previous: { _tag: "missing" },
        },
      ],
    });
  });

  it.each([
    ["malformed JSON", "{not-json"],
    ["duplicate JSON member", '{"rules":[],"rules":[]}'],
    ["escaped duplicate JSON member", '{"rules":[],"\\u0072ules":[]}'],
    ["non-array rules", '{"rules":"AGENTS.md"}'],
    ["non-string rule", '{"rules":[1]}'],
  ])("rejects %s instead of overwriting Continue configuration", (_case, current) => {
    expect(rejects(request({ agent: continueAgent, current }))).toBe(true);
  });

  it.each([
    "model: [\n",
    "read: AGENTS.md\n",
    "read:\n  nested: value\n",
    "read:\n\t- AGENTS.md\n",
    "{ read: [AGENTS.md] }\n",
    "read:",
    "read: # user note",
    'read:\n  - AGENTS.md\n  - "AGENTS.md"\n',
  ])("rejects malformed or unsupported Aider YAML %j without an operation", (current) => {
    expect(rejects(request({ current }))).toBe(true);
  });

  it.each([aider, continueAgent])("rejects malformed UTF-8 and a leading BOM for $id configuration", (agent) => {
    const bomSource = agent.id === "aider" ? "read:\n  - USER.md\n" : '{"rules":["USER.md"]}\n';

    expect(rejects(request({ agent, current: new Uint8Array([255]) }))).toBe(true);
    expect(rejects(request({ agent, current: `﻿${bomSource}` }))).toBe(true);
  });

  it("rejects an agent without a native instruction-link target", () => {
    expect(rejects({ ...request(), agent: findAgent("cursor")! })).toBe(true);
  });

  it("rejects prior ownership that does not match the exact native target", () => {
    const installed = write();
    const wrongOwner = { ...installed.file, owner: { _tag: "agent", agentIds: ["continue"] } };
    const wrongReference = {
      ...installed.file,
      ownership:
        installed.file.ownership._tag === "yamlSequenceValue"
          ? { ...installed.file.ownership, reference: "OTHER.md" }
          : installed.file.ownership,
    };

    for (const file of [wrongOwner, wrongReference]) {
      expect(rejects({ ...request({ current: installed.bytes }), previousFile: { _tag: "owned", file } })).toBe(true);
    }
  });

  it("rejects non-string-array Continue restoration history during update planning", () => {
    const installed = write({ agent: continueAgent });
    if (installed.file.ownership._tag !== "jsonValues") {
      throw new Error("Expected Continue JSON ownership.");
    }

    const invalidHistory = {
      ...installed.file,
      ownership: {
        ...installed.file.ownership,
        values: installed.file.ownership.values.map((value) => ({
          ...value,
          previous: { _tag: "value", value: { unexpected: true } },
        })),
      },
    };

    expect(
      rejects({
        ...request({ agent: continueAgent, current: installed.bytes }),
        previousFile: { _tag: "owned", file: invalidHistory },
      }),
    ).toBe(true);
  });

  it("rejects edits inside receipted Continue and Aider references", () => {
    const continueWrite = write({ agent: continueAgent });
    const aiderWrite = write();

    expect(
      rejects(
        request({
          agent: continueAgent,
          current: '{"rules":["AGENTS.md","UNRECEIPTED.md"]}\n',
          previousFile: continueWrite.file,
        }),
      ),
    ).toBe(true);
    expect(rejects(request({ current: "read:\n  - USER.md\n", previousFile: aiderWrite.file }))).toBe(true);
  });

  it("strictly rejects unknown request properties", () => {
    expect(rejects({ ...request(), unexpected: true })).toBe(true);
  });
});
