/** Plan one native instruction link (Continue JSON `rules`, Aider YAML `read`) from the catalog target and the prior receipt. */

import { Either, Schema, ParseResult as SchemaParseIssue } from "effect";

import { agentDefinitionSchema, agentTargetSchema } from "../../catalog/agent-catalog.js";
import { zodAsEffectSchema } from "../../zod-as-effect-schema.js";
import {
  agentOwnerSchema,
  fileKindSchema,
  type JsonValuesOwnership,
  jsonValuesOwnershipSchema,
  relativePathSchema,
  type YamlSequenceValueOwnership,
  yamlSequenceValueOwnershipSchema,
} from "../ownership.js";
import { addJsonRule, jsonRulesOwnershipIsValid, removeJsonRule } from "./json-rules-link.js";
import { addYamlRead, removeYamlRead } from "./yaml-read-link.js";

class InstructionLinkPlanError extends Schema.TaggedError<InstructionLinkPlanError>()("InstructionLinkPlanError", {
  issue: Schema.NonEmptyString.annotations({
    description: "Actionable request or native configuration issue.",
  }),
}) {
  get message(): string {
    return `Cannot plan native instruction link: ${this.issue}`;
  }
}

const linkIssue = (issue: string) => new InstructionLinkPlanError({ issue });

const readErrorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const toLinkError = (error: SchemaParseIssue.ParseError) =>
  linkIssue(SchemaParseIssue.TreeFormatter.formatErrorSync(error));

type LinkOwnership = JsonValuesOwnership | YamlSequenceValueOwnership;

const ownedInstructionLinkSchema = Schema.Struct({
  owner: zodAsEffectSchema(agentOwnerSchema).annotations({
    description: "Single catalog agent that owns this native instruction link.",
  }),
  path: zodAsEffectSchema(relativePathSchema).annotations({
    description: "Exact native config path declared by the catalog target.",
  }),
  kind: zodAsEffectSchema(fileKindSchema.options[4]).annotations({
    description: "File kind fixed to a native instruction link.",
  }),
  ownership: Schema.Union(
    zodAsEffectSchema(jsonValuesOwnershipSchema),
    zodAsEffectSchema(yamlSequenceValueOwnershipSchema),
  ).annotations({
    description: "Exact JSON member or YAML sequence history retained for restoration.",
  }),
});

const instructionLinkWriteSchema = Schema.TaggedStruct("write", {
  file: ownedInstructionLinkSchema,
  bytes: Schema.Uint8ArrayFromSelf.annotations({
    description: "Complete desired native configuration bytes.",
  }),
});

type InstructionLinkWrite = Schema.Schema.Type<typeof instructionLinkWriteSchema>;

const instructionLinkRequestFieldsSchema = Schema.Struct({
  agent: zodAsEffectSchema(agentDefinitionSchema.extend({ target: agentTargetSchema.options[3] })).annotations({
    description: "Exact catalog agent whose target defines the native config path, reference, and format.",
  }),
  desired: Schema.Union(Schema.TaggedStruct("present", {}), Schema.TaggedStruct("absent", {})).annotations({
    description: "Whether this exact native reference must be present or restored away.",
  }),
  currentFile: Schema.Union(
    Schema.TaggedStruct("missing", {}),
    Schema.TaggedStruct("file", {
      bytes: Schema.Uint8ArrayFromSelf.annotations({
        description: "Exact current native configuration bytes inspected without mutation.",
      }),
    }),
  ),
  previousFile: Schema.Union(
    Schema.TaggedStruct("missing", {}),
    Schema.TaggedStruct("owned", {
      file: Schema.typeSchema(ownedInstructionLinkSchema).annotations({
        description: "Exact prior native-reference receipt entry whose restoration history must be retained.",
      }),
    }),
  ),
});

type InstructionLinkRequestFields = Schema.Schema.Type<typeof instructionLinkRequestFieldsSchema>;

const previousFileIssues = (request: InstructionLinkRequestFields) => {
  if (request.previousFile._tag === "missing") {
    return [];
  }

  const file = request.previousFile.file;
  const target = request.agent.target;

  return [
    request.currentFile._tag === "file"
      ? undefined
      : { path: ["currentFile"], message: "A receipted native reference requires current file bytes." },
    file.path === target.configPath
      ? undefined
      : {
          path: ["previousFile", "file", "path"],
          message: "Prior native-reference ownership must match the catalog config path.",
        },
    file.owner.agentIds.length === 1 && file.owner.agentIds[0] === request.agent.id
      ? undefined
      : {
          path: ["previousFile", "file", "owner"],
          message: "Prior native-reference ownership must belong only to the exact catalog agent.",
        },
    (target.referenceFormat === "yamlReadArray" && file.ownership._tag === "yamlSequenceValue") ||
    (target.referenceFormat === "jsonRulesArray" && file.ownership._tag === "jsonValues")
      ? undefined
      : {
          path: ["previousFile", "file", "ownership"],
          message: "Prior native-reference ownership must match the catalog reference format.",
        },
    file.ownership._tag !== "yamlSequenceValue" ||
    (file.ownership.key === "read" && file.ownership.reference === target.instructionPath)
      ? undefined
      : {
          path: ["previousFile", "file", "ownership"],
          message: "Prior YAML ownership must match the exact read reference.",
        },
    file.ownership._tag !== "jsonValues" || jsonRulesOwnershipIsValid(file.ownership)
      ? undefined
      : {
          path: ["previousFile", "file", "ownership"],
          message: "Prior JSON ownership must contain one /rules pointer with missing or string-array history.",
        },
  ];
};

const instructionLinkRequestSchema = instructionLinkRequestFieldsSchema.pipe(Schema.filter(previousFileIssues));

type InstructionLinkRequest = Schema.Schema.Type<typeof instructionLinkRequestSchema>;

const instructionLinkPlanSchema = Schema.Union(
  Schema.TaggedStruct("none", {}),
  instructionLinkWriteSchema,
  Schema.TaggedStruct("restore", {
    file: ownedInstructionLinkSchema,
    bytes: Schema.Uint8ArrayFromSelf.annotations({
      description: "Exact unowned native configuration bytes left after restoration.",
    }),
  }),
  Schema.TaggedStruct("remove", {
    file: ownedInstructionLinkSchema,
    unownedBytes: Schema.Uint8ArrayFromSelf.annotations({
      description: "Empty bytes proving the file held nothing but the native reference.",
    }),
  }),
);

export type InstructionLinkPlan = Schema.Schema.Type<typeof instructionLinkPlanSchema>;

const currentBytes = (request: InstructionLinkRequest): Uint8Array | undefined =>
  request.currentFile._tag === "file" ? request.currentFile.bytes : undefined;

const addReference = (
  request: InstructionLinkRequest,
): Either.Either<InstructionLinkWrite, InstructionLinkPlanError> => {
  const target = request.agent.target;
  const ownership = request.previousFile._tag === "owned" ? request.previousFile.file.ownership : undefined;
  const link = {
    currentBytes: currentBytes(request),
    configPath: target.configPath,
    instructionPath: target.instructionPath,
  };
  const toWrite = (desired: { bytes: Uint8Array; ownership: LinkOwnership }): InstructionLinkWrite => ({
    _tag: "write",
    file: {
      path: target.configPath,
      kind: { _tag: "instructionLink" },
      owner: { _tag: "agent", agentIds: [request.agent.id] },
      ownership: desired.ownership,
    },
    bytes: desired.bytes,
  });

  switch (target.referenceFormat) {
    case "yamlReadArray": {
      const previousYamlOwnership = ownership?._tag === "yamlSequenceValue" ? ownership : null;
      const yamlReadReply = Either.try({
        try: () => addYamlRead({ ...link, previousOwnership: previousYamlOwnership }),
        catch: (error) => linkIssue(readErrorMessage(error)),
      });

      return Either.map(yamlReadReply, toWrite);
    }
    case "jsonRulesArray":
      return Either.mapBoth(
        addJsonRule({ ...link, previousOwnership: ownership?._tag === "jsonValues" ? ownership : undefined }),
        { onLeft: linkIssue, onRight: toWrite },
      );
  }
};

// Empty unowned bytes mean the file held nothing but the reference, so it may be deleted.
const unownedBytes = (request: InstructionLinkRequest, ownership: LinkOwnership): Either.Either<Uint8Array, string> => {
  const target = request.agent.target;
  const bytes = currentBytes(request);

  switch (target.referenceFormat) {
    case "yamlReadArray": {
      const isYamlReferenceUnusable = bytes === undefined || ownership._tag !== "yamlSequenceValue";
      if (isYamlReferenceUnusable) {
        return Either.left("Receipted Aider configuration is missing or incompatible.");
      }

      return Either.try({
        try: () => removeYamlRead({ currentBytes: bytes, configPath: target.configPath, ownership }),
        catch: readErrorMessage,
      });
    }
    case "jsonRulesArray":
      return bytes === undefined || ownership._tag !== "jsonValues"
        ? Either.left("Receipted Continue configuration is missing or incompatible.")
        : removeJsonRule({ currentBytes: bytes, configPath: target.configPath, ownership });
  }
};

const planReferenceChange = (
  request: InstructionLinkRequest,
): Either.Either<InstructionLinkPlan, InstructionLinkPlanError> => {
  if (request.desired._tag === "present") {
    return addReference(request);
  }

  if (request.previousFile._tag === "missing") {
    return Either.right({ _tag: "none" });
  }

  const file = request.previousFile.file;

  return Either.mapBoth(unownedBytes(request, file.ownership), {
    onLeft: linkIssue,
    onRight: (bytes): InstructionLinkPlan =>
      bytes.byteLength === 0 && !file.ownership.filePreviouslyPresent
        ? { _tag: "remove", file, unownedBytes: bytes }
        : { _tag: "restore", file, bytes },
  });
};

export const planInstructionLink = (input: unknown): Either.Either<InstructionLinkPlan, InstructionLinkPlanError> =>
  Either.mapLeft(
    Schema.decodeUnknownEither(instructionLinkRequestSchema, { onExcessProperty: "error" })(input),
    toLinkError,
  ).pipe(Either.flatMap(planReferenceChange));
