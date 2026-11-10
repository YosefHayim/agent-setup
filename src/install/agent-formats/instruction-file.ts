/** A managed block of skills inside a shared instruction file (AGENTS.md, GEMINI.md, …), framed so it can be removed byte for byte. */

import { Either, Schema, ParseResult as SchemaParseIssue } from "effect";
import { type AgentDefinition, agentCatalog, agentIdSchema } from "../../catalog/agent-catalog.js";
import { installedSkillSchema } from "../../catalog/feature-catalog.js";
import { zodAsEffectSchema } from "../../zod-as-effect-schema.js";
import { bytesEqual, hashBytes } from "../file-bytes.js";
import { fileKindSchema, fileOwnerSchema, managedBlockOwnershipSchema, relativePathSchema } from "../ownership.js";
import { stripFrontmatter, withCompleteFrontmatter } from "./skill-text.js";

const startMarker = "<!-- agent-setup:skills start -->";
const endMarker = "<!-- agent-setup:skills end -->";
const textEncoder = new TextEncoder();
const startMarkerBytes = textEncoder.encode(startMarker);
const endMarkerBytes = textEncoder.encode(endMarker);
const lineFeedBytes = textEncoder.encode("\n");
const carriageReturnBytes = textEncoder.encode("\r");
const blockSeparatorBytes = textEncoder.encode("\n\n");

export class InstructionFilePlanError extends Schema.TaggedError<InstructionFilePlanError>()(
  "InstructionFilePlanError",
  {
    issue: Schema.NonEmptyString.annotations({
      description: "Actionable instruction-file request or planning issue.",
    }),
  },
) {
  get message(): string {
    return `Cannot plan instruction file: ${this.issue}`;
  }
}

const planError = (issue: string) => new InstructionFilePlanError({ issue });

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

type ManagedBlock = {
  readonly _tag: "block";
  readonly start: number;
  readonly bodyStart: number;
  readonly bodyEnd: number;
  readonly end: number;
};

type CurrentBlock = { readonly _tag: "missing" } | ManagedBlock;

const inspectManagedBlock = (bytes: Uint8Array): Either.Either<CurrentBlock, InstructionFilePlanError> => {
  const starts = findByteIndexes(bytes, startMarkerBytes);
  const ends = findByteIndexes(bytes, endMarkerBytes);
  if (starts.length === 0 && ends.length === 0) {
    return Either.right({ _tag: "missing" });
  }

  if (starts.length !== 1 || ends.length !== 1) {
    return Either.left(planError("managed block markers must occur exactly once as a pair."));
  }

  const start = starts[0];
  const end = ends[0];
  if (start === undefined || end === undefined || end < start + startMarkerBytes.byteLength) {
    return Either.left(planError("managed block markers are reversed or overlap."));
  }

  return Either.right({
    _tag: "block",
    start,
    bodyStart: start + startMarkerBytes.byteLength,
    bodyEnd: end,
    end: end + endMarkerBytes.byteLength,
  });
};

const instructionSkillSchema = Schema.Struct({
  installedSkill: zodAsEffectSchema(installedSkillSchema).annotations({
    description: "Catalog-owned installed skill rendered into the managed instruction block.",
  }),
  markdown: withCompleteFrontmatter(Schema.NonEmptyString).annotations({
    description: "Complete installed SKILL.md text before frontmatter removal and control-path substitution.",
  }),
});

type InstructionSkill = Schema.Schema.Type<typeof instructionSkillSchema>;

const renderSkillSection = (skill: InstructionSkill) => {
  const documentText = stripFrontmatter(skill.markdown).replaceAll("\r\n", "\n").trim();
  if (documentText.length === 0) {
    return Either.left(planError(`skill ${skill.installedSkill.id} has no markdown body after frontmatter.`));
  }

  if (documentText.includes(startMarker) || documentText.includes(endMarker)) {
    return Either.left(planError(`skill ${skill.installedSkill.id} contains a reserved managed block marker.`));
  }

  return Either.right(`## ${skill.installedSkill.id}\n\n${documentText}`);
};

const renderManagedSection = (skills: ReadonlyArray<InstructionSkill>) =>
  Either.map(Either.all(skills.map((skill) => renderSkillSection(skill))), (sections) =>
    textEncoder.encode(`\n${sections.join("\n\n---\n\n")}\n`),
  );

// The block owns one trailing line feed, plus the blank-line separator before it when the file already existed.
const receiptedBlockRange = (input: {
  currentBytes: Uint8Array;
  block: ManagedBlock;
  filePreviouslyPresent: boolean;
}): Either.Either<readonly [number, number], InstructionFilePlanError> => {
  if (input.currentBytes[input.block.end] !== lineFeedBytes[0]) {
    return Either.left(planError("managed block framing changed after the closing marker."));
  }

  const end = input.block.end + lineFeedBytes.byteLength;
  if (!input.filePreviouslyPresent) {
    return Either.right([input.block.start, end]);
  }

  const frameStart = input.block.start - blockSeparatorBytes.byteLength;
  if (frameStart < 0 || !bytesEqual(input.currentBytes.slice(frameStart, input.block.start), blockSeparatorBytes)) {
    return Either.left(planError("managed block framing changed before the opening marker."));
  }

  return Either.right([frameStart, end]);
};

// User text written after the block stays on its own line once the block is gone.
const stripReceiptedBlock = (input: {
  currentBytes: Uint8Array;
  block: ManagedBlock;
  filePreviouslyPresent: boolean;
}) =>
  Either.map(receiptedBlockRange(input), ([start, end]) => {
    const prefix = input.currentBytes.slice(0, start);
    const suffix = input.currentBytes.slice(end);
    const suffixStartsLineEnding =
      suffix[0] === lineFeedBytes[0] || (suffix[0] === carriageReturnBytes[0] && suffix[1] === lineFeedBytes[0]);
    const needsSeparator =
      prefix.byteLength > 0 &&
      suffix.byteLength > 0 &&
      prefix[prefix.byteLength - 1] !== lineFeedBytes[0] &&
      !suffixStartsLineEnding;

    return concatenateBytes([prefix, ...(needsSeparator ? [lineFeedBytes] : []), suffix]);
  });

const ownedInstructionFileSchema = Schema.Struct({
  owner: fileOwnerSchema.members[1].annotations({
    description: "Catalog agents that share this exact instruction file.",
  }),
  path: relativePathSchema.annotations({
    description: "Catalog instruction path owned by the complete agent set.",
  }),
  kind: fileKindSchema.members[3].annotations({
    description: "File kind fixed to one shared instruction file.",
  }),
  ownership: managedBlockOwnershipSchema.annotations({
    description: "Exact managed block history and installed-body evidence.",
  }),
});

type OwnedInstructionFile = Schema.Schema.Type<typeof ownedInstructionFileSchema>;

const instructionFilePlanSchema = Schema.Union(
  Schema.TaggedStruct("none", {}),
  Schema.TaggedStruct("write", {
    file: ownedInstructionFileSchema,
    bytes: Schema.Uint8ArrayFromSelf.annotations({
      description: "Complete desired instruction-file bytes.",
    }),
  }),
  Schema.TaggedStruct("restore", {
    file: ownedInstructionFileSchema,
    bytes: Schema.Uint8ArrayFromSelf.annotations({
      description: "Exact surrounding bytes left after the managed block is removed.",
    }),
  }),
  Schema.TaggedStruct("remove", {
    file: ownedInstructionFileSchema,
    unownedBytes: Schema.Uint8ArrayFromSelf.annotations({
      description: "Empty bytes proving the file held nothing but the managed block.",
    }),
  }),
);

export type InstructionFilePlan = Schema.Schema.Type<typeof instructionFilePlanSchema>;

const presentInstructionSchema = Schema.TaggedStruct("present", {
  agentIds: Schema.NonEmptyArray(zodAsEffectSchema(agentIdSchema)).annotations({
    description: "Catalog-ordered agents that share the desired instruction path.",
  }),
  skills: Schema.NonEmptyArray(instructionSkillSchema).pipe(
    Schema.filter((skills) => skills.length === new Set(skills.map((skill) => skill.installedSkill.id)).size, {
      message: () => "Instruction-file installed skills must be unique.",
    }),
    Schema.annotations({
      description: "Ordered catalog skills rendered into the desired managed block.",
    }),
  ),
});

type PresentInstruction = Schema.Schema.Type<typeof presentInstructionSchema>;

const instructionFileRequestFieldsSchema = Schema.Struct({
  path: relativePathSchema.annotations({
    description: "Shared instruction path planned exactly once for all desired consumers.",
  }),
  desired: Schema.Union(Schema.TaggedStruct("absent", {}), presentInstructionSchema).annotations({
    description: "Desired managed block and owners, or explicit absence for restoration.",
  }),
  currentFile: Schema.Union(
    Schema.TaggedStruct("missing", {}),
    Schema.TaggedStruct("file", {
      bytes: Schema.Uint8ArrayFromSelf.annotations({
        description: "Exact current instruction-file bytes inspected without normalization.",
      }),
    }),
  ),
  previousFile: Schema.Union(
    Schema.TaggedStruct("missing", {}),
    Schema.TaggedStruct("owned", {
      file: Schema.typeSchema(ownedInstructionFileSchema).annotations({
        description: "Exact prior receipt entry authorizing replacement or restoration.",
      }),
    }),
  ),
});

type InstructionFileRequestFields = Schema.Schema.Type<typeof instructionFileRequestFieldsSchema>;

const requestIssues = (request: InstructionFileRequestFields) => {
  if (request.previousFile._tag === "missing") {
    return [];
  }

  const previousFile = request.previousFile.file;

  return [
    previousFile.path === request.path
      ? undefined
      : {
          path: ["previousFile", "file", "path"],
          message: "Prior instruction ownership must match the requested path.",
        },
    previousFile.ownership.startMarker === startMarker && previousFile.ownership.endMarker === endMarker
      ? undefined
      : {
          path: ["previousFile", "file", "ownership"],
          message: "Prior instruction ownership must use the canonical managed-block markers.",
        },
    agentIdsMatchPath(previousFile.owner.agentIds, request.path)
      ? undefined
      : {
          path: ["previousFile", "file", "owner"],
          message: "Every prior owner must legitimately consume this instruction path from the catalog.",
        },
    request.currentFile._tag === "file"
      ? undefined
      : { path: ["currentFile"], message: "A receipted instruction file requires current file bytes." },
  ];
};

const instructionFileRequestSchema = instructionFileRequestFieldsSchema.pipe(Schema.filter(requestIssues));

type InstructionFileRequest = Schema.Schema.Type<typeof instructionFileRequestSchema>;

// A block agent-setup wrote earlier may be replaced or removed only while its body still hashes to the receipt.
const receiptedOwnership = (request: InstructionFileRequest, block: ManagedBlock) => {
  if (request.previousFile._tag === "missing" || request.currentFile._tag === "missing") {
    return Either.left(planError("current managed block has no complete prior receipt evidence."));
  }

  const ownership = request.previousFile.file.ownership;
  if (hashBytes(request.currentFile.bytes.slice(block.bodyStart, block.bodyEnd)) !== ownership.installedBodyHash) {
    return Either.left(planError("managed block changed inside its receipted body."));
  }

  return Either.map(
    receiptedBlockRange({
      currentBytes: request.currentFile.bytes,
      block,
      filePreviouslyPresent: ownership.filePreviouslyPresent,
    }),
    () => ownership,
  );
};

// Where the new block goes: a fresh file, appended after user text, or in place of the receipted block.
const placeBlock = (input: {
  request: InstructionFileRequest;
  currentBlock: CurrentBlock;
  block: Uint8Array;
}): Either.Either<{ bytes: Uint8Array; filePreviouslyPresent: boolean }, InstructionFilePlanError> => {
  const currentFile = input.request.currentFile;
  if (currentFile._tag === "missing") {
    return Either.right({ bytes: concatenateBytes([input.block, lineFeedBytes]), filePreviouslyPresent: false });
  }

  if (input.currentBlock._tag === "missing") {
    return input.request.previousFile._tag === "owned"
      ? Either.left(planError("receipted managed block is missing from the current instruction file."))
      : Either.right({
          bytes: concatenateBytes([currentFile.bytes, blockSeparatorBytes, input.block, lineFeedBytes]),
          filePreviouslyPresent: true,
        });
  }

  const currentBlock = input.currentBlock;

  return Either.map(receiptedOwnership(input.request, currentBlock), (ownership) => ({
    bytes: concatenateBytes([
      currentFile.bytes.slice(0, currentBlock.start),
      input.block,
      currentFile.bytes.slice(currentBlock.end),
    ]),
    filePreviouslyPresent: ownership.filePreviouslyPresent,
  }));
};

const planInstructionWrite = (input: {
  request: InstructionFileRequest;
  desired: PresentInstruction;
  currentBlock: CurrentBlock;
}): Either.Either<InstructionFilePlan, InstructionFilePlanError> =>
  Either.flatMap(renderManagedSection(input.desired.skills), (section) =>
    Either.flatMap(
      placeBlock({ ...input, block: concatenateBytes([startMarkerBytes, section, endMarkerBytes]) }),
      ({ bytes, filePreviouslyPresent }) => {
        const file: OwnedInstructionFile = {
          owner: { _tag: "agent", agentIds: input.desired.agentIds },
          path: input.request.path,
          kind: { _tag: "instruction" },
          ownership: {
            _tag: "managedBlock",
            filePreviouslyPresent,
            startMarker,
            endMarker,
            installedBodyHash: hashBytes(section),
          },
        };

        return Either.right({ _tag: "write", file, bytes });
      },
    ),
  );

const planInstructionRemoval = (
  request: InstructionFileRequest,
  currentBlock: CurrentBlock,
): Either.Either<InstructionFilePlan, InstructionFilePlanError> => {
  if (request.previousFile._tag === "missing") {
    return Either.right({ _tag: "none" });
  }

  if (request.currentFile._tag === "missing" || currentBlock._tag === "missing") {
    return Either.left(planError("receipted managed block is missing from the current instruction file."));
  }

  const file = request.previousFile.file;
  const currentBytes = request.currentFile.bytes;

  return Either.flatMap(receiptedOwnership(request, currentBlock), ({ filePreviouslyPresent }) =>
    Either.map(
      stripReceiptedBlock({ currentBytes, block: currentBlock, filePreviouslyPresent }),
      (unownedBytes): InstructionFilePlan =>
        !filePreviouslyPresent && unownedBytes.byteLength === 0
          ? { _tag: "remove", file, unownedBytes }
          : { _tag: "restore", file, bytes: unownedBytes },
    ),
  );
};

// Plan one shared instruction path: a write, restoration, removal, or no-op.
export const planInstructionFile = (input: unknown): Either.Either<InstructionFilePlan, InstructionFilePlanError> =>
  Either.mapLeft(
    Schema.decodeUnknownEither(instructionFileRequestSchema, { onExcessProperty: "error" })(input),
    (error) => planError(`request is invalid: ${SchemaParseIssue.TreeFormatter.formatErrorSync(error)}`),
  ).pipe(
    Either.flatMap((request) => {
      if (request.desired._tag === "absent" && request.previousFile._tag === "missing") {
        return Either.right({ _tag: "none" });
      }

      const currentBytes = request.currentFile._tag === "missing" ? new Uint8Array() : request.currentFile.bytes;

      return Either.flatMap(inspectManagedBlock(currentBytes), (currentBlock) =>
        request.desired._tag === "absent"
          ? planInstructionRemoval(request, currentBlock)
          : planInstructionWrite({ request, desired: request.desired, currentBlock }),
      );
    }),
  );
