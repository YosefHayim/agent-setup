import { z } from "zod";

import { type AgentDefinition, agentCatalog, agentIdSchema } from "#src/catalog/agent-catalog.js";
import { installedSkillSchema } from "#src/catalog/feature-catalog.js";
import { bytesEqual, hashBytes } from "#src/install/file-bytes.js";
import {
  agentOwnerSchema,
  instructionKindSchema,
  managedBlockOwnershipSchema,
  relativePathSchema,
} from "#src/install/ownership.js";
import { addZodIssueDetails, joinZodIssueMessages, type ZodIssueDetail } from "#src/zod-issue-messages.js";
import { markdownWithCompleteFrontmatterSchema, stripFrontmatter } from "./skill-text.js";

const startMarker = "<!-- agent-setup:skills start -->";
const endMarker = "<!-- agent-setup:skills end -->";
const textEncoder = new TextEncoder();
const startMarkerBytes = textEncoder.encode(startMarker);
const endMarkerBytes = textEncoder.encode(endMarker);
const lineFeedBytes = textEncoder.encode("\n");
const carriageReturnBytes = textEncoder.encode("\r");
const blockSeparatorBytes = textEncoder.encode("\n\n");

const createPlanError = (issue: string): Error => new Error(`Cannot plan instruction file: ${issue}`);

export const instructionPath = (agent: AgentDefinition): string | undefined => {
  if (agent.target._tag === "instructionFile") {
    return agent.target.path;
  }

  return agent.target._tag === "instructionLink" ? agent.target.instructionPath : undefined;
};

const agentIdsMatchPath = (agentIds: ReadonlyArray<string>, path: string): boolean =>
  agentIds.every((agentId) => {
    const agent = agentCatalog.find((candidate) => candidate.id === agentId);

    return agent !== undefined && instructionPath(agent) === path;
  });

const concatenateBytes = (parts: ReadonlyArray<Uint8Array>): Uint8Array => {
  const bytes = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }

  return bytes;
};

// Markers are matched on raw bytes so nothing around them is decoded or normalized.
const findByteIndexes = (bytes: Uint8Array, pattern: Uint8Array): ReadonlyArray<number> => {
  const indexes: Array<number> = [];
  for (let offset = 0; offset <= bytes.byteLength - pattern.byteLength; offset += 1) {
    if (pattern.every((value, index) => bytes[offset + index] === value)) {
      indexes.push(offset);
    }
  }

  return indexes;
};

interface ManagedBlock {
  readonly _tag: "block";
  readonly start: number;
  readonly bodyStart: number;
  readonly bodyEnd: number;
  readonly end: number;
}

type CurrentBlock = { readonly _tag: "missing" } | ManagedBlock;

const inspectManagedBlock = (bytes: Uint8Array): CurrentBlock => {
  const starts = findByteIndexes(bytes, startMarkerBytes);
  const ends = findByteIndexes(bytes, endMarkerBytes);
  const isBlockAbsent = starts.length === 0 && ends.length === 0;
  if (isBlockAbsent) {
    return { _tag: "missing" };
  }

  const isMarkerCountWrong = starts.length !== 1 || ends.length !== 1;
  if (isMarkerCountWrong) {
    throw createPlanError("managed block markers must occur exactly once as a pair.");
  }

  const start = starts[0];
  const end = ends[0];
  const isBlockReversed = start === undefined || end === undefined || end < start + startMarkerBytes.byteLength;
  if (isBlockReversed) {
    throw createPlanError("managed block markers are reversed or overlap.");
  }

  return {
    _tag: "block",
    start,
    bodyStart: start + startMarkerBytes.byteLength,
    bodyEnd: end,
    end: end + endMarkerBytes.byteLength,
  };
};

const instructionSkillSchema = z.strictObject({
  installedSkill: installedSkillSchema.describe(
    "Catalog-owned installed skill rendered into the managed instruction block.",
  ),
  markdown: markdownWithCompleteFrontmatterSchema
    .min(1)
    .describe("Complete installed SKILL.md text before frontmatter removal and control-path substitution."),
});

type InstructionSkill = z.infer<typeof instructionSkillSchema>;

const createSkillSection = (skill: InstructionSkill): string => {
  const documentText = stripFrontmatter(skill.markdown).replaceAll("\r\n", "\n").trim();
  const isBodyEmpty = documentText.length === 0;
  if (isBodyEmpty) {
    throw createPlanError(`skill ${skill.installedSkill.id} has no markdown body after frontmatter.`);
  }

  const hasReservedMarker = documentText.includes(startMarker) || documentText.includes(endMarker);
  if (hasReservedMarker) {
    throw createPlanError(`skill ${skill.installedSkill.id} contains a reserved managed block marker.`);
  }

  return `## ${skill.installedSkill.id}\n\n${documentText}`;
};

const createManagedSection = (skills: ReadonlyArray<InstructionSkill>): Uint8Array => {
  const sections = skills.map((skill) => createSkillSection(skill));

  return textEncoder.encode(`\n${sections.join("\n\n---\n\n")}\n`);
};

// The block owns one trailing line feed, plus the blank-line separator before it when the file already existed.
const receiptedBlockRange = ({
  currentBytes,
  block,
  filePreviouslyPresent,
}: {
  currentBytes: Uint8Array;
  block: ManagedBlock;
  filePreviouslyPresent: boolean;
}): readonly [number, number] => {
  const isClosingFrameChanged = currentBytes[block.end] !== lineFeedBytes[0];
  if (isClosingFrameChanged) {
    throw createPlanError("managed block framing changed after the closing marker.");
  }

  const end = block.end + lineFeedBytes.byteLength;

  const isFileAbsentBefore = !filePreviouslyPresent;
  if (isFileAbsentBefore) {
    return [block.start, end];
  }

  const frameStart = block.start - blockSeparatorBytes.byteLength;
  const isOpeningFrameChanged =
    frameStart < 0 || !bytesEqual(currentBytes.slice(frameStart, block.start), blockSeparatorBytes);
  if (isOpeningFrameChanged) {
    throw createPlanError("managed block framing changed before the opening marker.");
  }

  return [frameStart, end];
};

// User text written after the block stays on its own line once the block is gone.
const stripReceiptedBlock = ({
  currentBytes,
  block,
  filePreviouslyPresent,
}: {
  currentBytes: Uint8Array;
  block: ManagedBlock;
  filePreviouslyPresent: boolean;
}): Uint8Array => {
  const [start, end] = receiptedBlockRange({ currentBytes, block, filePreviouslyPresent });
  const prefix = currentBytes.slice(0, start);
  const suffix = currentBytes.slice(end);
  const suffixStartsLineEnding =
    suffix[0] === lineFeedBytes[0] || (suffix[0] === carriageReturnBytes[0] && suffix[1] === lineFeedBytes[0]);
  const needsSeparator =
    prefix.byteLength > 0 &&
    suffix.byteLength > 0 &&
    prefix[prefix.byteLength - 1] !== lineFeedBytes[0] &&
    !suffixStartsLineEnding;

  return concatenateBytes([prefix, ...(needsSeparator ? [lineFeedBytes] : []), suffix]);
};

const ownedInstructionFileSchema = z.strictObject({
  owner: agentOwnerSchema.describe("Catalog agents that share this exact instruction file."),
  path: relativePathSchema.describe("Catalog instruction path owned by the complete agent set."),
  kind: instructionKindSchema.describe("File kind fixed to one shared instruction file."),
  ownership: managedBlockOwnershipSchema.describe("Exact managed block history and installed-body evidence."),
});

type OwnedInstructionFile = z.infer<typeof ownedInstructionFileSchema>;
type ManagedBlockOwnership = OwnedInstructionFile["ownership"];

export type InstructionFilePlan =
  | { readonly _tag: "none" }
  | { readonly _tag: "write"; readonly file: OwnedInstructionFile; readonly bytes: Uint8Array }
  | { readonly _tag: "restore"; readonly file: OwnedInstructionFile; readonly bytes: Uint8Array }
  | { readonly _tag: "remove"; readonly file: OwnedInstructionFile; readonly unownedBytes: Uint8Array };

const presentInstructionSchema = z.strictObject({
  _tag: z.literal("present"),
  agentIds: z.array(agentIdSchema).min(1).describe("Catalog-ordered agents that share the desired instruction path."),
  skills: z
    .array(instructionSkillSchema)
    .min(1)
    .refine(
      (skills) => skills.length === new Set(skills.map((skill) => skill.installedSkill.id)).size,
      "Instruction-file installed skills must be unique.",
    )
    .describe("Ordered catalog skills rendered into the desired managed block."),
});

type PresentInstruction = z.infer<typeof presentInstructionSchema>;

const instructionFileRequestFieldsSchema = z.strictObject({
  path: relativePathSchema.describe("Shared instruction path planned exactly once for all desired consumers."),
  desired: z
    .discriminatedUnion("_tag", [z.strictObject({ _tag: z.literal("absent") }), presentInstructionSchema])
    .describe("Desired managed block and owners, or explicit absence for restoration."),
  currentFile: z
    .discriminatedUnion("_tag", [
      z.strictObject({ _tag: z.literal("missing") }),
      z.strictObject({
        _tag: z.literal("file"),
        bytes: z
          .instanceof(Uint8Array)
          .describe("Exact current instruction-file bytes inspected without normalization."),
      }),
    ])
    .describe("Current instruction file bytes, or explicit absence."),
  previousFile: z
    .discriminatedUnion("_tag", [
      z.strictObject({ _tag: z.literal("missing") }),
      z.strictObject({
        _tag: z.literal("owned"),
        file: ownedInstructionFileSchema.describe("Exact prior receipt entry authorizing replacement or restoration."),
      }),
    ])
    .describe("Prior receipt entry, or explicit absence."),
});

type InstructionFileRequest = z.infer<typeof instructionFileRequestFieldsSchema>;

const requestIssues = (request: InstructionFileRequest): Array<ZodIssueDetail | null> => {
  if (request.previousFile._tag === "missing") {
    return [];
  }

  const previousFile = request.previousFile.file;
  const isPathMismatched = previousFile.path !== request.path;
  const isMarkerCanonical =
    previousFile.ownership.startMarker === startMarker && previousFile.ownership.endMarker === endMarker;
  const isAgentSetLegitimate = agentIdsMatchPath(previousFile.owner.agentIds, request.path);
  const isCurrentFileMissing = request.currentFile._tag !== "file";

  return [
    isPathMismatched
      ? {
          path: ["previousFile", "file", "path"],
          message: "Prior instruction ownership must match the requested path.",
        }
      : null,
    isMarkerCanonical
      ? null
      : {
          path: ["previousFile", "file", "ownership"],
          message: "Prior instruction ownership must use the canonical managed-block markers.",
        },
    isAgentSetLegitimate
      ? null
      : {
          path: ["previousFile", "file", "owner"],
          message: "Every prior owner must legitimately consume this instruction path from the catalog.",
        },
    isCurrentFileMissing
      ? { path: ["currentFile"], message: "A receipted instruction file requires current file bytes." }
      : null,
  ];
};

const instructionFileRequestSchema = instructionFileRequestFieldsSchema.superRefine((request, context) =>
  addZodIssueDetails(context, requestIssues(request)),
);

// A block agent-setup wrote earlier may be replaced or removed only while its body still hashes to the receipt.
const requireReceiptedOwnership = (request: InstructionFileRequest, block: ManagedBlock): ManagedBlockOwnership => {
  const previousFile = request.previousFile;
  const currentFile = request.currentFile;
  const isReceiptIncomplete = previousFile._tag === "missing" || currentFile._tag === "missing";
  if (isReceiptIncomplete) {
    throw createPlanError("current managed block has no complete prior receipt evidence.");
  }

  const ownership = previousFile.file.ownership;
  const blockBody = currentFile.bytes.slice(block.bodyStart, block.bodyEnd);
  const isBodyChanged = hashBytes(blockBody) !== ownership.installedBodyHash;
  if (isBodyChanged) {
    throw createPlanError("managed block changed inside its receipted body.");
  }

  receiptedBlockRange({
    currentBytes: currentFile.bytes,
    block,
    filePreviouslyPresent: ownership.filePreviouslyPresent,
  });

  return ownership;
};

// Where the new block goes: a fresh file, appended after user text, or in place of the receipted block.
const placeBlock = ({
  request,
  currentBlock,
  block,
}: {
  request: InstructionFileRequest;
  currentBlock: CurrentBlock;
  block: Uint8Array;
}): { bytes: Uint8Array; filePreviouslyPresent: boolean } => {
  const currentFile = request.currentFile;
  if (currentFile._tag === "missing") {
    return { bytes: concatenateBytes([block, lineFeedBytes]), filePreviouslyPresent: false };
  }

  const isBlockMissing = currentBlock._tag === "missing";
  if (isBlockMissing) {
    const isReceiptedBlockGone = request.previousFile._tag === "owned";
    if (isReceiptedBlockGone) {
      throw createPlanError("receipted managed block is missing from the current instruction file.");
    }

    return {
      bytes: concatenateBytes([currentFile.bytes, blockSeparatorBytes, block, lineFeedBytes]),
      filePreviouslyPresent: true,
    };
  }

  const ownership = requireReceiptedOwnership(request, currentBlock);

  return {
    bytes: concatenateBytes([
      currentFile.bytes.slice(0, currentBlock.start),
      block,
      currentFile.bytes.slice(currentBlock.end),
    ]),
    filePreviouslyPresent: ownership.filePreviouslyPresent,
  };
};

const planInstructionWrite = ({
  request,
  desired,
  currentBlock,
}: {
  request: InstructionFileRequest;
  desired: PresentInstruction;
  currentBlock: CurrentBlock;
}): InstructionFilePlan => {
  const section = createManagedSection(desired.skills);
  const block = concatenateBytes([startMarkerBytes, section, endMarkerBytes]);
  const placed = placeBlock({ request, currentBlock, block });
  const file: OwnedInstructionFile = {
    owner: { _tag: "agent", agentIds: desired.agentIds },
    path: request.path,
    kind: { _tag: "instruction" },
    ownership: {
      _tag: "managedBlock",
      filePreviouslyPresent: placed.filePreviouslyPresent,
      startMarker,
      endMarker,
      installedBodyHash: hashBytes(section),
    },
  };

  return { _tag: "write", file, bytes: placed.bytes };
};

const planInstructionRemoval = (request: InstructionFileRequest, currentBlock: CurrentBlock): InstructionFilePlan => {
  const previousFile = request.previousFile;
  const isNothingReceipted = previousFile._tag === "missing";
  if (isNothingReceipted) {
    return { _tag: "none" };
  }

  const currentFile = request.currentFile;
  const isBlockMissing = currentFile._tag === "missing" || currentBlock._tag === "missing";
  if (isBlockMissing) {
    throw createPlanError("receipted managed block is missing from the current instruction file.");
  }

  const file = previousFile.file;
  const ownership = requireReceiptedOwnership(request, currentBlock);
  const unownedBytes = stripReceiptedBlock({
    currentBytes: currentFile.bytes,
    block: currentBlock,
    filePreviouslyPresent: ownership.filePreviouslyPresent,
  });
  const isOnlyInstalledBlock = !ownership.filePreviouslyPresent && unownedBytes.byteLength === 0;
  if (isOnlyInstalledBlock) {
    return { _tag: "remove", file, unownedBytes };
  }

  return { _tag: "restore", file, bytes: unownedBytes };
};

// Plan one shared instruction path: a write, restoration, removal, or no-op.
export const planInstructionFile = (input: unknown): InstructionFilePlan => {
  const requestReply = instructionFileRequestSchema.safeParse(input);

  const isRequestInvalid = !requestReply.success;
  if (isRequestInvalid) {
    throw createPlanError(`request is invalid: ${joinZodIssueMessages(requestReply.error)}`);
  }

  const request = requestReply.data;
  const desired = request.desired;
  const isNothingToPlan = desired._tag === "absent" && request.previousFile._tag === "missing";
  if (isNothingToPlan) {
    return { _tag: "none" };
  }

  const currentBytes = request.currentFile._tag === "missing" ? new Uint8Array() : request.currentFile.bytes;
  const currentBlock = inspectManagedBlock(currentBytes);
  const isRemoval = desired._tag === "absent";
  if (isRemoval) {
    return planInstructionRemoval(request, currentBlock);
  }

  return planInstructionWrite({ request, desired, currentBlock });
};
