import { z } from "zod";

import { agentDefinitionSchema, instructionLinkTargetSchema } from "#src/catalog/agent-catalog.js";
import { readErrorMessage } from "#src/install/install-request.js";
import {
  agentOwnerSchema,
  instructionLinkKindSchema,
  type JsonValuesOwnership,
  jsonValuesOwnershipSchema,
  relativePathSchema,
  type YamlSequenceValueOwnership,
  yamlSequenceValueOwnershipSchema,
} from "#src/install/ownership.js";
import { joinZodIssueMessages } from "#src/zod-issue-messages.js";
import { addJsonRule, jsonRulesOwnershipIsValid, removeJsonRule } from "./json-rules-link.js";
import { addYamlRead, removeYamlRead } from "./yaml-read-link.js";

const createLinkPlanError = (issue: string, cause?: unknown): Error =>
  new Error(`Cannot plan native instruction link: ${issue}`, { cause });

// Native config edits throw their own messages; this names the failure as an instruction-link plan error.
const editNativeConfig = <NativeEdit>(editNative: () => NativeEdit): NativeEdit => {
  try {
    return editNative();
  } catch (error) {
    throw createLinkPlanError(readErrorMessage(error), error);
  }
};

type LinkOwnership = JsonValuesOwnership | YamlSequenceValueOwnership;

const ownedInstructionLinkSchema = z.strictObject({
  owner: agentOwnerSchema,
  path: relativePathSchema,
  kind: instructionLinkKindSchema,
  ownership: z.union([jsonValuesOwnershipSchema, yamlSequenceValueOwnershipSchema]),
});

type OwnedInstructionLink = z.infer<typeof ownedInstructionLinkSchema>;

const instructionLinkRequestFieldsSchema = z.strictObject({
  agent: agentDefinitionSchema.extend({ target: instructionLinkTargetSchema }),
  desired: z.discriminatedUnion("_tag", [
    z.strictObject({ _tag: z.literal("present") }),
    z.strictObject({ _tag: z.literal("absent") }),
  ]),
  currentFile: z.discriminatedUnion("_tag", [
    z.strictObject({ _tag: z.literal("missing") }),
    z.strictObject({ _tag: z.literal("file"), bytes: z.instanceof(Uint8Array) }),
  ]),
  previousFile: z.discriminatedUnion("_tag", [
    z.strictObject({ _tag: z.literal("missing") }),
    z.strictObject({ _tag: z.literal("owned"), file: ownedInstructionLinkSchema }),
  ]),
});

type InstructionLinkRequestFields = z.infer<typeof instructionLinkRequestFieldsSchema>;

interface PreviousFileRule {
  readonly isValid: boolean;
  readonly path: Array<string>;
  readonly message: string;
}

const findBrokenPreviousFileRules = (request: InstructionLinkRequestFields): Array<PreviousFileRule> => {
  const previousFile = request.previousFile;

  const isPreviousFileMissing = previousFile._tag === "missing";

  if (isPreviousFileMissing) {
    return [];
  }

  const file = previousFile.file;
  const target = request.agent.target;
  const rules: Array<PreviousFileRule> = [
    {
      isValid: request.currentFile._tag === "file",
      path: ["currentFile"],
      message: "A receipted native reference requires current file bytes.",
    },
    {
      isValid: file.path === target.configPath,
      path: ["previousFile", "file", "path"],
      message: "Prior native-reference ownership must match the catalog config path.",
    },
    {
      isValid: file.owner.agentIds.length === 1 && file.owner.agentIds[0] === request.agent.id,
      path: ["previousFile", "file", "owner"],
      message: "Prior native-reference ownership must belong only to the exact catalog agent.",
    },
    {
      isValid:
        (target.referenceFormat === "yamlReadArray" && file.ownership._tag === "yamlSequenceValue") ||
        (target.referenceFormat === "jsonRulesArray" && file.ownership._tag === "jsonValues"),
      path: ["previousFile", "file", "ownership"],
      message: "Prior native-reference ownership must match the catalog reference format.",
    },
    {
      isValid:
        file.ownership._tag !== "yamlSequenceValue" ||
        (file.ownership.key === "read" && file.ownership.reference === target.instructionPath),
      path: ["previousFile", "file", "ownership"],
      message: "Prior YAML ownership must match the exact read reference.",
    },
    {
      isValid: file.ownership._tag !== "jsonValues" || jsonRulesOwnershipIsValid(file.ownership),
      path: ["previousFile", "file", "ownership"],
      message: "Prior JSON ownership must contain one /rules pointer with missing or string-array history.",
    },
  ];

  return rules.filter((rule) => !rule.isValid);
};

const instructionLinkRequestSchema = instructionLinkRequestFieldsSchema.superRefine((request, context) => {
  for (const brokenRule of findBrokenPreviousFileRules(request)) {
    context.addIssue({ code: "custom", path: brokenRule.path, message: brokenRule.message });
  }
});

type InstructionLinkRequest = z.infer<typeof instructionLinkRequestSchema>;

export type InstructionLinkPlan =
  | { readonly _tag: "none" }
  | { readonly _tag: "write"; readonly file: OwnedInstructionLink; readonly bytes: Uint8Array }
  | { readonly _tag: "restore"; readonly file: OwnedInstructionLink; readonly bytes: Uint8Array }
  | { readonly _tag: "remove"; readonly file: OwnedInstructionLink; readonly unownedBytes: Uint8Array };

const currentBytes = (request: InstructionLinkRequest): Uint8Array | undefined =>
  request.currentFile._tag === "file" ? request.currentFile.bytes : undefined;

const addReference = (request: InstructionLinkRequest): InstructionLinkPlan => {
  const target = request.agent.target;
  const previousFile = request.previousFile;
  const isPreviousFileOwned = previousFile._tag === "owned";
  const ownership = isPreviousFileOwned ? previousFile.file.ownership : null;
  const link = {
    currentBytes: currentBytes(request),
    configPath: target.configPath,
    instructionPath: target.instructionPath,
  };
  const createWritePlan = (desired: { bytes: Uint8Array; ownership: LinkOwnership }): InstructionLinkPlan => ({
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
      const isYamlOwnershipReceipted = ownership?._tag === "yamlSequenceValue";
      const previousYamlOwnership = isYamlOwnershipReceipted ? ownership : null;
      const yamlReadEdit = editNativeConfig(() => addYamlRead({ ...link, previousOwnership: previousYamlOwnership }));

      return createWritePlan(yamlReadEdit);
    }
    case "jsonRulesArray": {
      const isJsonOwnershipReceipted = ownership?._tag === "jsonValues";
      const previousJsonOwnership = isJsonOwnershipReceipted ? ownership : null;
      const jsonRulesEdit = editNativeConfig(() => addJsonRule({ ...link, previousOwnership: previousJsonOwnership }));

      return createWritePlan(jsonRulesEdit);
    }
  }
};

// Empty unowned bytes mean the file held nothing but the reference, so it may be deleted.
const unownedBytes = (request: InstructionLinkRequest, ownership: LinkOwnership): Uint8Array => {
  const target = request.agent.target;
  const bytes = currentBytes(request);

  switch (target.referenceFormat) {
    case "yamlReadArray": {
      const isYamlReferenceUnusable = bytes === undefined || ownership._tag !== "yamlSequenceValue";
      if (isYamlReferenceUnusable) {
        throw createLinkPlanError("Receipted Aider configuration is missing or incompatible.");
      }

      return editNativeConfig(() => removeYamlRead({ currentBytes: bytes, configPath: target.configPath, ownership }));
    }
    case "jsonRulesArray": {
      const isJsonReferenceUnusable = bytes === undefined || ownership._tag !== "jsonValues";
      if (isJsonReferenceUnusable) {
        throw createLinkPlanError("Receipted Continue configuration is missing or incompatible.");
      }

      return editNativeConfig(() => removeJsonRule({ currentBytes: bytes, configPath: target.configPath, ownership }));
    }
  }
};

const planReferenceChange = (request: InstructionLinkRequest): InstructionLinkPlan => {
  const isReferenceWanted = request.desired._tag === "present";

  if (isReferenceWanted) {
    return addReference(request);
  }

  const previousFile = request.previousFile;

  const isPreviousFileMissing = previousFile._tag === "missing";

  if (isPreviousFileMissing) {
    return { _tag: "none" };
  }

  const file = previousFile.file;
  const bytes = unownedBytes(request, file.ownership);
  const isEmptyAndNew = bytes.byteLength === 0 && !file.ownership.filePreviouslyPresent;

  if (isEmptyAndNew) {
    return { _tag: "remove", file, unownedBytes: bytes };
  }

  return { _tag: "restore", file, bytes };
};

export const planInstructionLink = (input: unknown): InstructionLinkPlan => {
  const requestCheck = instructionLinkRequestSchema.safeParse(input);
  const isRequestAccepted = requestCheck.success;

  if (isRequestAccepted) {
    return planReferenceChange(requestCheck.data);
  }

  throw createLinkPlanError(joinZodIssueMessages(requestCheck.error), requestCheck.error);
};
