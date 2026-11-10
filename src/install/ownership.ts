import { z } from "zod";

import { agentCatalog, agentIdSchema } from "#src/catalog/agent-catalog.js";
import { addZodIssueDetails, type ZodIssueDetail } from "#src/zod-issue-messages.js";
import { replaceBytesWithBase64 } from "./file-bytes.js";
import { nonEmptyTrimmedTextSchema } from "./text-rules.js";

// e.g. "skills/make-documentString-readable/SKILL.md" — not "/abs", "C:\x", "a/../b", or "a//b"
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
export const documentPointerSchema = z
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

const isDocumentField = (documentCandidate: unknown): boolean => {
  const isDocumentPrimitive =
    documentCandidate === null || typeof documentCandidate === "string" || typeof documentCandidate === "boolean";
  if (isDocumentPrimitive) {
    return true;
  }

  const isDocumentNumber = typeof documentCandidate === "number";
  if (isDocumentNumber) {
    return Number.isFinite(documentCandidate);
  }

  const isDocumentArray = Array.isArray(documentCandidate);
  if (isDocumentArray) {
    return documentCandidate.every(isDocumentField);
  }

  const isPlainObject =
    typeof documentCandidate === "object" &&
    documentCandidate !== null &&
    Object.getPrototypeOf(documentCandidate) === Object.prototype;

  const isNotPlainObject = !isPlainObject;
  if (isNotPlainObject) {
    return false;
  }

  return Object.values(documentCandidate).every(isDocumentField);
};

const documentFieldSchema = z
  .unknown()
  .refine(isDocumentField, "Previous JSON values must contain only JSON-compatible data.");

const hasUniqueEntries = <Entry>(entries: ReadonlyArray<Entry>): boolean => entries.length === new Set(entries).size;

const knownAgentIds = new Set<string>(agentCatalog.map((agent) => agent.id));

const listAgentCatalogOrderIssues = (agentIds: ReadonlyArray<string>): Array<ZodIssueDetail> => {
  const unknownIndex = agentIds.findIndex((agentId) => !knownAgentIds.has(agentId));

  const hasUnknownId = unknownIndex >= 0;
  if (hasUnknownId) {
    return [{ path: [unknownIndex], message: `Agent ownership ID ${agentIds[unknownIndex]} is unknown.` }];
  }

  const selectedIds = new Set(agentIds);
  const orderedIds = agentCatalog.flatMap((agent) => {
    const isAgentSelected = selectedIds.has(agent.id);
    return isAgentSelected ? [agent.id] : [];
  });

  const mismatchIndex = agentIds.findIndex((agentId, index) => agentId !== orderedIds[index]);

  const hasAgentOrderMismatch = mismatchIndex >= 0 || agentIds.length !== orderedIds.length;
  if (hasAgentOrderMismatch) {
    const hasOrderMismatch = mismatchIndex >= 0;
    return [
      {
        path: [hasOrderMismatch ? mismatchIndex : agentIds.length],
        message: "Agent ownership IDs must use exact catalog order.",
      },
    ];
  }

  return [];
};

const listAgentIdsIssues = (agentIds: ReadonlyArray<string>): Array<ZodIssueDetail> => {
  const isAgentIdsUnique = hasUniqueEntries(agentIds);

  const hasDuplicateAgentIds = !isAgentIdsUnique;
  if (hasDuplicateAgentIds) {
    return [{ path: [], message: "Agent ownership IDs must be unique." }];
  }

  return listAgentCatalogOrderIssues(agentIds);
};

const agentIdsSchema = z
  .array(agentIdSchema)
  .min(1)
  .superRefine((agentIds, scope) => addZodIssueDetails(scope, listAgentIdsIssues(agentIds)));

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

export const previousFileFieldSchema = z
  .discriminatedUnion("_tag", [
    z.strictObject({ _tag: z.literal("missing") }),
    z.strictObject({ _tag: z.literal("priorFile"), bytes: priorBytesSchema }),
  ])
  .describe("Original whole-file state needed for exact restoration.");

export type PreviousFileValue = z.infer<typeof previousFileFieldSchema>;

const previousDocumentLexicalSchema = z
  .strictObject({
    _tag: z.literal("value"),
    source: z.string().min(1).describe("Exact JSON value token replaced while this pointer is owned."),
  })
  .describe("Exact lexical evidence needed to restore one settings value without reformatting user bytes.");

export const previousDocumentFieldSchema = z
  .discriminatedUnion("_tag", [
    z.strictObject({ _tag: z.literal("missing") }),
    z.strictObject({
      _tag: z.literal("value"),
      value: documentFieldSchema.describe(
        "Exact JSON-compatible value present before this pointer first became owned.",
      ),
      lexical: previousDocumentLexicalSchema
        .optional()
        .describe("Settings-only lexical evidence correlated with the previous semantic value."),
    }),
  ])
  .describe("JSON pointer state recorded before the pointer first became owned.");

export type PreviousDocumentField = z.infer<typeof previousDocumentFieldSchema>;

export const wholeFileOwnershipSchema = z.strictObject({
  _tag: z.literal("wholeFile"),
  installedHash: sha256Schema.describe("Hash of the complete installed file."),
  previous: previousFileFieldSchema,
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

const readManagedBlockMarkerIssue = (ownership: z.infer<typeof managedBlockFieldsSchema>): ZodIssueDetail | null => {
  const areMarkersDistinct = ownership.startMarker !== ownership.endMarker;
  if (areMarkersDistinct) {
    return null;
  }

  return { path: ["endMarker"], message: "Managed block markers must be distinct." };
};

export const managedBlockOwnershipSchema = managedBlockFieldsSchema.superRefine((ownership, scope) =>
  addZodIssueDetails(scope, [readManagedBlockMarkerIssue(ownership)]),
);

const installedDocumentFieldSchema = z
  .strictObject({
    _tag: z.literal("value"),
    hash: sha256Schema.describe("Hash of the canonical JSON value present after installation."),
  })
  .describe("Exact installed state required before one managed JSON pointer can be restored.");

export type InstalledDocumentField = z.infer<typeof installedDocumentFieldSchema>;

const ownedDocumentFieldSchema = z.strictObject({
  pointer: documentPointerSchema,
  installed: installedDocumentFieldSchema.describe("Exact hashed value state installed at this pointer."),
  previous: previousDocumentFieldSchema.describe("State recorded before this JSON pointer first became owned."),
});

export type OwnedDocumentField = z.infer<typeof ownedDocumentFieldSchema>;

const isNestedOrEqual = (left: string, right: string): boolean =>
  left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);

// Owned paths compare case-insensitively so a case-folding filesystem can never hold two owners of one file.
export const isPathsConflict = (left: string, right: string): boolean =>
  isNestedOrEqual(left.toLowerCase(), right.toLowerCase());

const listPointerConflictIssues = (owned: ReadonlyArray<{ readonly pointer: string }>): Array<ZodIssueDetail> =>
  owned.flatMap((ownedLine, index) =>
    owned.slice(index + 1).flatMap((candidate, offset) =>
      isNestedOrEqual(ownedLine.pointer, candidate.pointer)
        ? [
            {
              path: [index + offset + 1, "pointer"],
              message: `JSON pointer ${candidate.pointer} conflicts with ${ownedLine.pointer}.`,
            },
          ]
        : [],
    ),
  );

const listCreatedContainerIssues = (ownership: {
  readonly createdContainers: ReadonlyArray<string>;
  readonly pointers: ReadonlyArray<string>;
}): Array<ZodIssueDetail> => [
  ...ownership.createdContainers.flatMap((container, index) => {
    const isFirstOccurrence = ownership.createdContainers.indexOf(container) === index;
    return isFirstOccurrence
      ? []
      : [{ path: ["createdContainers", index], message: `Created JSON container ${container} must be unique.` }];
  }),
  ...ownership.createdContainers.flatMap((container, index) => {
    const hasOwnedDescendant = ownership.pointers.some((pointer) => pointer.startsWith(`${container}/`));
    return hasOwnedDescendant
      ? []
      : [
          {
            path: ["createdContainers", index],
            message: `Created JSON container ${container} must be a proper ancestor of an owned value.`,
          },
        ];
  }),
];

const ownedDocumentFieldsSchema = z
  .array(ownedDocumentFieldSchema)
  .min(1, "JSON ownership must record at least one pointer.")
  .superRefine((ownedFields, scope) => addZodIssueDetails(scope, listPointerConflictIssues(ownedFields)));

export const documentFieldsOwnershipSchema = z
  .strictObject({
    _tag: z.literal("jsonValues"),
    filePreviouslyPresent: z
      .boolean()
      .describe("Whether the host file existed before this receipt entry first managed it."),
    createdContainers: z
      .array(documentPointerSchema)
      .describe("Exact JSON object pointers created to reach owned values and removable only when empty."),
    values: ownedDocumentFieldsSchema,
  })
  .superRefine((ownership, scope) =>
    addZodIssueDetails(
      scope,
      listCreatedContainerIssues({
        createdContainers: ownership.createdContainers,
        pointers: ownership.values.map((ownedField) => ownedField.pointer),
      }),
    ),
  );

export type DocumentFieldsOwnership = z.infer<typeof documentFieldsOwnershipSchema>;

const ownedHookEventSchema = z.strictObject({
  pointer: documentPointerSchema.regex(/^\/hooks\/[^~/]+$/, "Hook event pointers must name one /hooks/<event> array."),
  previouslyPresent: z
    .boolean()
    .describe("Whether the event array existed before agent-setup first added an entry to it."),
  entries: z
    .array(sha256Schema)
    .min(1, "Hook event ownership must record at least one entry.")
    .describe("Hash of each agent-setup hook entry in the event array; other entries belong to the user."),
});

export type OwnedHookEvent = z.infer<typeof ownedHookEventSchema>;

export const hookLinesOwnershipSchema = z
  .strictObject({
    _tag: z.literal("hookEntries"),
    filePreviouslyPresent: z
      .boolean()
      .describe("Whether the host file existed before this receipt entry first managed it."),
    createdContainers: z
      .array(documentPointerSchema)
      .describe("Exact JSON object pointers created to reach owned events and removable only when empty."),
    events: z
      .array(ownedHookEventSchema)
      .min(1, "Hook entry ownership must record at least one event.")
      .superRefine((ownedEvents, scope) => addZodIssueDetails(scope, listPointerConflictIssues(ownedEvents))),
  })
  .superRefine((ownership, scope) =>
    addZodIssueDetails(
      scope,
      listCreatedContainerIssues({
        createdContainers: ownership.createdContainers,
        pointers: ownership.events.map((ownedEvent) => ownedEvent.pointer),
      }),
    ),
  );

export type HookLinesOwnership = z.infer<typeof hookLinesOwnershipSchema>;

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

const readYamlReferenceIssue = (ownership: YamlSequenceFields): ZodIssueDetail | null => {
  const isReferenceAfterKey = ownership.keyPreviouslyPresent || !ownership.previouslyPresent;
  if (isReferenceAfterKey) {
    return null;
  }

  return { path: ["previouslyPresent"], message: "A YAML reference cannot predate a key that did not exist." };
};

const readYamlKeyPrefixIssue = (ownership: YamlSequenceFields): ZodIssueDetail | null => {
  const isPrefixAllowed = !ownership.keyPreviouslyPresent || ownership.insertedPrefix.length === 0;
  if (isPrefixAllowed) {
    return null;
  }

  return { path: ["insertedPrefix"], message: "A pre-existing YAML key cannot own an inserted key prefix." };
};

export const yamlSequenceFieldOwnershipSchema = yamlSequenceFieldsSchema.superRefine((ownership, scope) =>
  addZodIssueDetails(scope, [readYamlReferenceIssue(ownership), readYamlKeyPrefixIssue(ownership)]),
);

export type YamlSequenceFieldOwnership = z.infer<typeof yamlSequenceFieldOwnershipSchema>;

const ownershipSchema = z.union([
  wholeFileOwnershipSchema,
  managedBlockOwnershipSchema,
  documentFieldsOwnershipSchema,
  hookLinesOwnershipSchema,
  yamlSequenceFieldOwnershipSchema,
]);

export type Ownership = z.infer<typeof ownershipSchema>;

const isOwnerHitsKind = (kind: FileKind, owner: FileOwner): boolean => {
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

const isOwnershipHitsKind = (kind: FileKind, ownership: Ownership): boolean => {
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

const parseDocumentStringOrNull = (documentString: string): { readonly parsedField: unknown } | null => {
  try {
    return { parsedField: JSON.parse(documentString) };
  } catch {
    // Source that is not JSON simply cannot match the value, so the caller reports it as not restorable.
    return null;
  }
};

const isDocumentFieldsEqual = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

const isLexicalHitsPrevious = (ownedField: OwnedDocumentField): boolean => {
  const previous = ownedField.previous;

  const isPreviousMissing = previous._tag === "missing";
  if (isPreviousMissing) {
    return false;
  }

  const lexical = previous.lexical;

  const isLexicalAbsent = lexical == null;
  if (isLexicalAbsent) {
    return false;
  }

  const lexicalParsed = parseDocumentStringOrNull(lexical.source);

  const isLexicalUnparsed = lexicalParsed === null;
  if (isLexicalUnparsed) {
    return false;
  }

  const isLexicalDocumentValid = documentFieldSchema.safeParse(lexicalParsed.parsedField).success;

  return isLexicalDocumentValid && isDocumentFieldsEqual(lexicalParsed.parsedField, previous.value);
};

const listSettingsLexicalIssues = (file: { kind: FileKind; ownership: Ownership }): Array<ZodIssueDetail> => {
  const ownership = file.ownership;
  const isNotDocumentValuesOwnership = ownership._tag !== "jsonValues";
  if (isNotDocumentValuesOwnership) {
    return [];
  }

  return ownership.values.flatMap((ownedField, index) => {
    const path = ["ownership", "values", index, "previous", "lexical"];

    const previousField = ownedField.previous;
    const hasStoredPreviousField = previousField._tag === "value";
    const lexical = hasStoredPreviousField ? previousField.lexical : null;

    const isNotSettingsFile = file.kind._tag !== "settings";
    if (isNotSettingsFile) {
      const isLexicalMissing = lexical == null;
      return isLexicalMissing
        ? []
        : [{ path, message: "Only settings ownership may carry lexical JSON restoration evidence." }];
    }

    const isLexicalEvidenceMatched = ownedField.previous._tag === "missing" || isLexicalHitsPrevious(ownedField);
    if (isLexicalEvidenceMatched) {
      return [];
    }

    return [{ path, message: "Settings ownership requires correlated value lexical restoration evidence." }];
  });
};

const readOwnerKindIssue = (file: { kind: FileKind; owner: FileOwner }): ZodIssueDetail | null => {
  if (isOwnerHitsKind(file.kind, file.owner)) {
    return null;
  }

  return {
    path: ["owner"],
    message: `File kind ${file.kind._tag} has incompatible owner ${file.owner._tag}.`,
  };
};

const readOwnershipKindIssue = (file: { kind: FileKind; ownership: Ownership }): ZodIssueDetail | null => {
  if (isOwnershipHitsKind(file.kind, file.ownership)) {
    return null;
  }

  return {
    path: ["ownership"],
    message: `File kind ${file.kind._tag} has incompatible ownership ${file.ownership._tag}.`,
  };
};

export const ownedFileSchema = z
  .strictObject({
    owner: fileOwnerSchema,
    path: relativePathSchema,
    kind: fileKindSchema,
    ownership: ownershipSchema,
  })
  .superRefine((file, scope) =>
    addZodIssueDetails(scope, [
      readOwnerKindIssue(file),
      readOwnershipKindIssue(file),
      ...listSettingsLexicalIssues(file),
    ]),
  );

export type OwnedFile = z.infer<typeof ownedFileSchema>;

const serializeOwnedFile = (file: OwnedFile): string =>
  JSON.stringify(ownedFileSchema.parse(file), replaceBytesWithBase64);

// Compares two owned files by their canonical JSON, so key order and byte copies never matter.
export const isOwnedFilesEqual = (left: OwnedFile, right: OwnedFile): boolean =>
  serializeOwnedFile(left) === serializeOwnedFile(right);
