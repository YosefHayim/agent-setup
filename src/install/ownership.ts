import { z } from "zod";

import { agentCatalog, agentIdSchema } from "../catalog/agent-catalog.js";
import { addZodIssueDetails, type ZodIssueDetail } from "../zod-issue-messages.js";
import { replaceBytesWithBase64 } from "./file-bytes.js";
import { nonEmptyTrimmedTextSchema } from "./text-rules.js";

// e.g. "skills/make-code-readable/SKILL.md" — not "/abs", "C:\x", "a/../b", or "a//b"
export const relativePathSchema = nonEmptyTrimmedTextSchema
  .regex(
    /^(?!\/)(?![A-Za-z]:)(?!.*(?:^|\/)\.{1,2}(?:\/|$))(?!.*\/\/)[^\\/\0]+(?:\/[^\\/\0]+)*$/,
    "Owned file paths must be relative, normalized, and stay inside the scope root.",
  )
  .describe("Normalized scope-relative file path.");

export const sha256Schema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, "Hashes must be lowercase SHA-256 hex strings.")
  .describe("Lowercase SHA-256 digest.");

// e.g. "/hooks/0/command", "/a~1b" (~0/~1 escapes) — not "hooks" (relative) or "/a~2"
export const jsonPointerSchema = z
  .string()
  .regex(/^(?:\/(?:[^~/]|~[01])*)+$/, "JSON pointers must be absolute RFC 6901 paths with valid escape sequences.")
  .describe("Absolute RFC 6901 pointer to one owned JSON value.");

const isCanonicalBase64 = (encoded: string): boolean => Buffer.from(encoded, "base64").toString("base64") === encoded;

const copyBytes = (bytes: Uint8Array): Uint8Array => new Uint8Array(bytes);

const decodeBase64Bytes = (encoded: string): Uint8Array => new Uint8Array(Buffer.from(encoded, "base64"));

// Bytes are held as Uint8Array in memory and as canonical base64 in the receipt JSON.
const priorBytesSchema = z
  .union([
    z.instanceof(Uint8Array).transform(copyBytes),
    z.string().refine(isCanonicalBase64, "Prior file bytes must use canonical base64.").transform(decodeBase64Bytes),
  ])
  .describe("Original bytes decoded from their receipt-safe base64 representation.");

const isJsonValue = (jsonCandidate: unknown): boolean => {
  const isJsonPrimitive =
    jsonCandidate === null || typeof jsonCandidate === "string" || typeof jsonCandidate === "boolean";
  if (isJsonPrimitive) {
    return true;
  }

  const isJsonNumber = typeof jsonCandidate === "number";
  if (isJsonNumber) {
    return Number.isFinite(jsonCandidate);
  }

  if (Array.isArray(jsonCandidate)) {
    return jsonCandidate.every(isJsonValue);
  }

  const isPlainObject =
    typeof jsonCandidate === "object" &&
    jsonCandidate !== null &&
    Object.getPrototypeOf(jsonCandidate) === Object.prototype;

  const isNotPlainObject = !isPlainObject;
  if (isNotPlainObject) {
    return false;
  }

  return Object.values(jsonCandidate).every(isJsonValue);
};

const jsonValueSchema = z.unknown().refine(isJsonValue, "Previous JSON values must contain only JSON-compatible data.");

const hasUniqueEntries = <Entry>(entries: ReadonlyArray<Entry>): boolean => entries.length === new Set(entries).size;

const knownAgentIds = new Set<string>(agentCatalog.map((agent) => agent.id));

const agentCatalogOrderIssues = (agentIds: ReadonlyArray<string>): Array<ZodIssueDetail> => {
  const unknownIndex = agentIds.findIndex((agentId) => !knownAgentIds.has(agentId));
  if (unknownIndex >= 0) {
    return [{ path: [unknownIndex], message: `Agent ownership ID ${agentIds[unknownIndex]} is unknown.` }];
  }

  const selectedIds = new Set(agentIds);
  const orderedIds = agentCatalog.flatMap((agent) => (selectedIds.has(agent.id) ? [agent.id] : []));
  const mismatchIndex = agentIds.findIndex((agentId, index) => agentId !== orderedIds[index]);
  if (mismatchIndex >= 0 || agentIds.length !== orderedIds.length) {
    return [
      {
        path: [mismatchIndex >= 0 ? mismatchIndex : agentIds.length],
        message: "Agent ownership IDs must use exact catalog order.",
      },
    ];
  }

  return [];
};

const agentIdsIssues = (agentIds: ReadonlyArray<string>): Array<ZodIssueDetail> => {
  const isAgentIdsUnique = hasUniqueEntries(agentIds);

  const hasDuplicateAgentIds = !isAgentIdsUnique;
  if (hasDuplicateAgentIds) {
    return [{ path: [], message: "Agent ownership IDs must be unique." }];
  }

  return agentCatalogOrderIssues(agentIds);
};

const agentIdsSchema = z
  .array(agentIdSchema)
  .min(1)
  .superRefine((agentIds, context) => addZodIssueDetails(context, agentIdsIssues(agentIds)));

export const agentOwnerSchema = z.strictObject({
  _tag: z.literal("agent"),
  agentIds: agentIdsSchema.describe("Agents that share ownership of this exact file path."),
});

export const fileOwnerSchema = z
  .discriminatedUnion("_tag", [z.strictObject({ _tag: z.literal("application") }), agentOwnerSchema])
  .describe("Application or shared agent ownership authority.");

export type FileOwner = z.infer<typeof fileOwnerSchema>;

export const instructionKindSchema = z.strictObject({ _tag: z.literal("instruction") });

export const instructionLinkKindSchema = z.strictObject({ _tag: z.literal("instructionLink") });

export const fileKindSchema = z
  .discriminatedUnion("_tag", [
    z.strictObject({ _tag: z.literal("runtime") }),
    z.strictObject({ _tag: z.literal("skill") }),
    z.strictObject({ _tag: z.literal("rule") }),
    instructionKindSchema,
    instructionLinkKindSchema,
    z.strictObject({ _tag: z.literal("settings") }),
    z.strictObject({ _tag: z.literal("managedConfig") }),
    z.strictObject({ _tag: z.literal("receipt") }),
  ])
  .describe("File role used to constrain ownership and restoration metadata.");

type FileKind = z.infer<typeof fileKindSchema>;

export const previousFileValueSchema = z
  .discriminatedUnion("_tag", [
    z.strictObject({ _tag: z.literal("missing") }),
    z.strictObject({ _tag: z.literal("priorFile"), bytes: priorBytesSchema }),
  ])
  .describe("Original whole-file state needed for exact restoration.");

export type PreviousFileValue = z.infer<typeof previousFileValueSchema>;

const previousJsonLexicalSchema = z
  .strictObject({
    _tag: z.literal("value"),
    source: z.string().min(1).describe("Exact JSON value token replaced while this pointer is owned."),
  })
  .describe("Exact lexical evidence needed to restore one settings value without reformatting user bytes.");

export const previousJsonValueSchema = z
  .discriminatedUnion("_tag", [
    z.strictObject({ _tag: z.literal("missing") }),
    z.strictObject({
      _tag: z.literal("value"),
      value: jsonValueSchema.describe("Exact JSON-compatible value present before this pointer first became owned."),
      lexical: previousJsonLexicalSchema
        .optional()
        .describe("Settings-only lexical evidence correlated with the previous semantic value."),
    }),
  ])
  .describe("JSON pointer state recorded before the pointer first became owned.");

export type PreviousJsonValue = z.infer<typeof previousJsonValueSchema>;

export const wholeFileOwnershipSchema = z.strictObject({
  _tag: z.literal("wholeFile"),
  installedHash: sha256Schema.describe("Hash of the complete installed file."),
  previous: previousFileValueSchema,
});

const managedBlockFieldsSchema = z.strictObject({
  _tag: z.literal("managedBlock"),
  filePreviouslyPresent: z
    .boolean()
    .describe("Whether the host file existed before this receipt entry first managed it."),
  startMarker: nonEmptyTrimmedTextSchema.describe("Exact opening marker delimiting the managed block."),
  endMarker: nonEmptyTrimmedTextSchema.describe("Exact closing marker delimiting the managed block."),
  installedBodyHash: sha256Schema.describe("Hash of the exact managed block body."),
});

const managedBlockMarkerIssue = (ownership: z.infer<typeof managedBlockFieldsSchema>): ZodIssueDetail | null => {
  const areMarkersDistinct = ownership.startMarker !== ownership.endMarker;
  if (areMarkersDistinct) {
    return null;
  }

  return { path: ["endMarker"], message: "Managed block markers must be distinct." };
};

export const managedBlockOwnershipSchema = managedBlockFieldsSchema.superRefine((ownership, context) =>
  addZodIssueDetails(context, [managedBlockMarkerIssue(ownership)]),
);

const installedJsonValueSchema = z
  .strictObject({
    _tag: z.literal("value"),
    hash: sha256Schema.describe("Hash of the canonical JSON value present after installation."),
  })
  .describe("Exact installed state required before one managed JSON pointer can be restored.");

export type InstalledJsonValue = z.infer<typeof installedJsonValueSchema>;

const ownedJsonValueSchema = z.strictObject({
  pointer: jsonPointerSchema,
  installed: installedJsonValueSchema.describe("Exact hashed value state installed at this pointer."),
  previous: previousJsonValueSchema.describe("State recorded before this JSON pointer first became owned."),
});

export type OwnedJsonValue = z.infer<typeof ownedJsonValueSchema>;

const nestedOrEqual = (left: string, right: string): boolean =>
  left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);

// Owned paths compare case-insensitively so a case-folding filesystem can never hold two owners of one file.
export const pathsConflict = (left: string, right: string): boolean =>
  nestedOrEqual(left.toLowerCase(), right.toLowerCase());

const pointerConflictIssues = (owned: ReadonlyArray<{ readonly pointer: string }>): Array<ZodIssueDetail> =>
  owned.flatMap((ownedEntry, index) =>
    owned.slice(index + 1).flatMap((candidate, offset) =>
      nestedOrEqual(ownedEntry.pointer, candidate.pointer)
        ? [
            {
              path: [index + offset + 1, "pointer"],
              message: `JSON pointer ${candidate.pointer} conflicts with ${ownedEntry.pointer}.`,
            },
          ]
        : [],
    ),
  );

const createdContainerIssues = (ownership: {
  readonly createdContainers: ReadonlyArray<string>;
  readonly pointers: ReadonlyArray<string>;
}): Array<ZodIssueDetail> => [
  ...ownership.createdContainers.flatMap((container, index) =>
    ownership.createdContainers.indexOf(container) === index
      ? []
      : [{ path: ["createdContainers", index], message: `Created JSON container ${container} must be unique.` }],
  ),
  ...ownership.createdContainers.flatMap((container, index) =>
    ownership.pointers.some((pointer) => pointer.startsWith(`${container}/`))
      ? []
      : [
          {
            path: ["createdContainers", index],
            message: `Created JSON container ${container} must be a proper ancestor of an owned value.`,
          },
        ],
  ),
];

const ownedJsonValuesSchema = z
  .array(ownedJsonValueSchema)
  .min(1, "JSON ownership must record at least one pointer.")
  .superRefine((ownedValues, context) => addZodIssueDetails(context, pointerConflictIssues(ownedValues)));

export const jsonValuesOwnershipSchema = z
  .strictObject({
    _tag: z.literal("jsonValues"),
    filePreviouslyPresent: z
      .boolean()
      .describe("Whether the host file existed before this receipt entry first managed it."),
    createdContainers: z
      .array(jsonPointerSchema)
      .describe("Exact JSON object pointers created to reach owned values and removable only when empty."),
    values: ownedJsonValuesSchema,
  })
  .superRefine((ownership, context) =>
    addZodIssueDetails(
      context,
      createdContainerIssues({
        createdContainers: ownership.createdContainers,
        pointers: ownership.values.map((ownedValue) => ownedValue.pointer),
      }),
    ),
  );

export type JsonValuesOwnership = z.infer<typeof jsonValuesOwnershipSchema>;

const ownedHookEventSchema = z.strictObject({
  pointer: jsonPointerSchema.regex(/^\/hooks\/[^~/]+$/, "Hook event pointers must name one /hooks/<event> array."),
  previouslyPresent: z
    .boolean()
    .describe("Whether the event array existed before agent-setup first added an entry to it."),
  entries: z
    .array(sha256Schema)
    .min(1, "Hook event ownership must record at least one entry.")
    .describe("Hash of each agent-setup hook entry in the event array; other entries belong to the user."),
});

export type OwnedHookEvent = z.infer<typeof ownedHookEventSchema>;

export const hookEntriesOwnershipSchema = z
  .strictObject({
    _tag: z.literal("hookEntries"),
    filePreviouslyPresent: z
      .boolean()
      .describe("Whether the host file existed before this receipt entry first managed it."),
    createdContainers: z
      .array(jsonPointerSchema)
      .describe("Exact JSON object pointers created to reach owned events and removable only when empty."),
    events: z
      .array(ownedHookEventSchema)
      .min(1, "Hook entry ownership must record at least one event.")
      .superRefine((ownedEvents, context) => addZodIssueDetails(context, pointerConflictIssues(ownedEvents))),
  })
  .superRefine((ownership, context) =>
    addZodIssueDetails(
      context,
      createdContainerIssues({
        createdContainers: ownership.createdContainers,
        pointers: ownership.events.map((ownedEvent) => ownedEvent.pointer),
      }),
    ),
  );

export type HookEntriesOwnership = z.infer<typeof hookEntriesOwnershipSchema>;

const yamlSequenceFieldsSchema = z.strictObject({
  _tag: z.literal("yamlSequenceValue"),
  filePreviouslyPresent: z
    .boolean()
    .describe("Whether the host file existed before this receipt entry first managed it."),
  key: nonEmptyTrimmedTextSchema.describe("Exact YAML sequence key that owns the reference."),
  keyPreviouslyPresent: z
    .boolean()
    .describe("Whether the YAML sequence key existed before this reference first became owned."),
  insertedPrefix: z
    .enum(["", "\n", "\r\n"])
    .describe("Exact separator inserted before a handler-created YAML key so removal can restore the prior bytes."),
  reference: nonEmptyTrimmedTextSchema.describe("Exact sequence value installed under the key."),
  previouslyPresent: z
    .boolean()
    .describe("Whether the exact key/reference pair existed before that pair first became owned."),
});

type YamlSequenceFields = z.infer<typeof yamlSequenceFieldsSchema>;

const yamlReferenceIssue = (ownership: YamlSequenceFields): ZodIssueDetail | null => {
  const isReferenceAfterKey = ownership.keyPreviouslyPresent || !ownership.previouslyPresent;
  if (isReferenceAfterKey) {
    return null;
  }

  return { path: ["previouslyPresent"], message: "A YAML reference cannot predate a key that did not exist." };
};

const yamlKeyPrefixIssue = (ownership: YamlSequenceFields): ZodIssueDetail | null => {
  const isPrefixAllowed = !ownership.keyPreviouslyPresent || ownership.insertedPrefix.length === 0;
  if (isPrefixAllowed) {
    return null;
  }

  return { path: ["insertedPrefix"], message: "A pre-existing YAML key cannot own an inserted key prefix." };
};

export const yamlSequenceValueOwnershipSchema = yamlSequenceFieldsSchema.superRefine((ownership, context) =>
  addZodIssueDetails(context, [yamlReferenceIssue(ownership), yamlKeyPrefixIssue(ownership)]),
);

export type YamlSequenceValueOwnership = z.infer<typeof yamlSequenceValueOwnershipSchema>;

const ownershipSchema = z.union([
  wholeFileOwnershipSchema,
  managedBlockOwnershipSchema,
  jsonValuesOwnershipSchema,
  hookEntriesOwnershipSchema,
  yamlSequenceValueOwnershipSchema,
]);

export type Ownership = z.infer<typeof ownershipSchema>;

const ownerMatchesKind = (kind: FileKind, owner: FileOwner): boolean => {
  switch (kind._tag) {
    case "runtime":
    case "settings":
    case "managedConfig":
    case "receipt":
      return owner._tag === "application";
    case "skill":
    case "rule":
    case "instruction":
    case "instructionLink":
      return owner._tag === "agent";
  }
};

const ownershipMatchesKind = (kind: FileKind, ownership: Ownership): boolean => {
  switch (kind._tag) {
    case "runtime":
    case "skill":
    case "rule":
    case "managedConfig":
    case "receipt":
      return ownership._tag === "wholeFile";
    case "instruction":
      return ownership._tag === "managedBlock";
    case "instructionLink":
      return ownership._tag === "jsonValues" || ownership._tag === "yamlSequenceValue";
    case "settings":
      return ownership._tag === "hookEntries" || ownership._tag === "jsonValues";
  }
};

const parseJsonSourceOrNull = (source: string): { readonly parsedValue: unknown } | null => {
  try {
    return { parsedValue: JSON.parse(source) };
  } catch {
    // Source that is not JSON simply cannot match the value, so the caller reports it as not restorable.
    return null;
  }
};

const jsonValuesEqual = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);

const lexicalMatchesPrevious = (ownedValue: OwnedJsonValue): boolean => {
  const previous = ownedValue.previous;
  const isPreviousMissing = previous._tag === "missing";
  if (isPreviousMissing) {
    return false;
  }

  const lexical = previous.lexical;
  const isLexicalAbsent = lexical == null;
  if (isLexicalAbsent) {
    return false;
  }

  const lexicalSource = parseJsonSourceOrNull(lexical.source);

  const isLexicalSourceUnparsed = lexicalSource === null;
  if (isLexicalSourceUnparsed) {
    return false;
  }

  const isLexicalJsonValid = jsonValueSchema.safeParse(lexicalSource.parsedValue).success;

  return isLexicalJsonValid && jsonValuesEqual(lexicalSource.parsedValue, previous.value);
};

const settingsLexicalIssues = (entry: { kind: FileKind; ownership: Ownership }): Array<ZodIssueDetail> => {
  if (entry.ownership._tag !== "jsonValues") {
    return [];
  }

  return entry.ownership.values.flatMap((ownedValue, index) => {
    const path = ["ownership", "values", index, "previous", "lexical"];
    const lexical = ownedValue.previous._tag === "value" ? ownedValue.previous.lexical : null;
    if (entry.kind._tag !== "settings") {
      return lexical == null
        ? []
        : [{ path, message: "Only settings ownership may carry lexical JSON restoration evidence." }];
    }

    const isLexicalEvidenceMatched = ownedValue.previous._tag === "missing" || lexicalMatchesPrevious(ownedValue);
    if (isLexicalEvidenceMatched) {
      return [];
    }

    return [{ path, message: "Settings ownership requires correlated value lexical restoration evidence." }];
  });
};

const ownerKindIssue = (entry: { kind: FileKind; owner: FileOwner }): ZodIssueDetail | null => {
  if (ownerMatchesKind(entry.kind, entry.owner)) {
    return null;
  }

  return {
    path: ["owner"],
    message: `File kind ${entry.kind._tag} has incompatible owner ${entry.owner._tag}.`,
  };
};

const ownershipKindIssue = (entry: { kind: FileKind; ownership: Ownership }): ZodIssueDetail | null => {
  if (ownershipMatchesKind(entry.kind, entry.ownership)) {
    return null;
  }

  return {
    path: ["ownership"],
    message: `File kind ${entry.kind._tag} has incompatible ownership ${entry.ownership._tag}.`,
  };
};

export const ownedFileSchema = z
  .strictObject({
    owner: fileOwnerSchema,
    path: relativePathSchema,
    kind: fileKindSchema,
    ownership: ownershipSchema,
  })
  .superRefine((entry, context) =>
    addZodIssueDetails(context, [ownerKindIssue(entry), ownershipKindIssue(entry), ...settingsLexicalIssues(entry)]),
  );

export type OwnedFile = z.infer<typeof ownedFileSchema>;

const stringifyOwnedFile = (file: OwnedFile): string =>
  JSON.stringify(ownedFileSchema.parse(file), replaceBytesWithBase64);

// Compares two owned files by their canonical JSON, so key order and byte copies never matter.
export const ownedFilesEqual = (left: OwnedFile, right: OwnedFile): boolean =>
  stringifyOwnedFile(left) === stringifyOwnedFile(right);
