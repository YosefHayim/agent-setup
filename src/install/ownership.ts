/** What one receipt entry owns in a host file: owner, kind, path, and the exact record needed to restore it. */

import { Either, Encoding, Predicate, Schema } from "effect";

import { agentCatalog, agentIdSchema } from "../catalog/agent-catalog.js";

// e.g. "skills/make-code-readable/SKILL.md" — not "/abs", "C:\x", "a/../b", or "a//b"
const RELATIVE_PATH_PATTERN = /^(?!\/)(?![A-Za-z]:)(?!.*(?:^|\/)\.{1,2}(?:\/|$))(?!.*\/\/)[^\\/\0]+(?:\/[^\\/\0]+)*$/;
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;
// e.g. "/hooks/0/command", "/a~1b" (~0/~1 escapes) — not "hooks" (relative) or "/a~2"
const JSON_POINTER_PATTERN = /^(?:\/(?:[^~/]|~[01])*)+$/;

export const relativePathSchema = Schema.NonEmptyTrimmedString.pipe(
  Schema.pattern(RELATIVE_PATH_PATTERN, {
    message: () => "Owned file paths must be relative, normalized, and stay inside the scope root.",
  }),
  Schema.annotations({
    description: "Normalized scope-relative file path.",
  }),
);

export const sha256Schema = Schema.String.pipe(
  Schema.pattern(SHA256_HEX_PATTERN, {
    message: () => "Hashes must be lowercase SHA-256 hex strings.",
  }),
  Schema.annotations({
    description: "Lowercase SHA-256 digest.",
  }),
);

export const jsonPointerSchema = Schema.String.pipe(
  Schema.pattern(JSON_POINTER_PATTERN, {
    message: () => "JSON pointers must be absolute RFC 6901 paths with valid escape sequences.",
  }),
  Schema.annotations({
    description: "Absolute RFC 6901 pointer to one owned JSON value.",
  }),
);

const base64BytesSchema = Schema.String.pipe(
  Schema.filter(
    (encoded) => {
      const decoded = Encoding.decodeBase64(encoded);

      return Either.isRight(decoded) && Encoding.encodeBase64(decoded.right) === encoded;
    },
    {
      message: () => "Prior file bytes must use canonical base64.",
    },
  ),
  Schema.compose(Schema.Uint8ArrayFromBase64),
);

const isJsonValue = (value: unknown): boolean => {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return true;
  }

  if (typeof value === "number") {
    return Number.isFinite(value);
  }

  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }

  if (!Predicate.isRecord(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    return false;
  }

  return Object.values(value).every(isJsonValue);
};

const jsonValueSchema = Schema.Unknown.pipe(
  Schema.filter(isJsonValue, {
    message: () => "Previous JSON values must contain only JSON-compatible data.",
  }),
);

const uniqueValues = <Value>(values: ReadonlyArray<Value>): boolean => values.length === new Set(values).size;

const knownAgentIds = new Set<string>(agentCatalog.map((agent) => agent.id));

const agentCatalogOrderIssues = (agentIds: ReadonlyArray<string>) => {
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

const agentIdsSchema = Schema.NonEmptyArray(agentIdSchema).pipe(
  Schema.filter(uniqueValues, {
    message: () => "Agent ownership IDs must be unique.",
  }),
  Schema.filter(agentCatalogOrderIssues),
);

export const fileOwnerSchema = Schema.Union(
  Schema.TaggedStruct("application", {}),
  Schema.TaggedStruct("agent", {
    agentIds: agentIdsSchema.annotations({
      description: "Agents that share ownership of this exact file path.",
    }),
  }),
).annotations({
  description: "Application or shared agent ownership authority.",
});

export type FileOwner = Schema.Schema.Type<typeof fileOwnerSchema>;

export const fileKindSchema = Schema.Union(
  Schema.TaggedStruct("runtime", {}),
  Schema.TaggedStruct("skill", {}),
  Schema.TaggedStruct("rule", {}),
  Schema.TaggedStruct("instruction", {}),
  Schema.TaggedStruct("instructionLink", {}),
  Schema.TaggedStruct("settings", {}),
  Schema.TaggedStruct("managedConfig", {}),
  Schema.TaggedStruct("receipt", {}),
).annotations({
  description: "File role used to constrain ownership and restoration metadata.",
});

type FileKind = Schema.Schema.Type<typeof fileKindSchema>;

export const previousFileValueSchema = Schema.Union(
  Schema.TaggedStruct("missing", {}),
  Schema.TaggedStruct("priorFile", {
    bytes: base64BytesSchema.annotations({
      description: "Original bytes decoded from their receipt-safe base64 representation.",
    }),
  }),
).annotations({
  description: "Original whole-file state needed for exact restoration.",
});

export type PreviousFileValue = Schema.Schema.Type<typeof previousFileValueSchema>;

const previousJsonLexicalSchema = Schema.TaggedStruct("value", {
  source: Schema.NonEmptyString.annotations({
    description: "Exact JSON value token replaced while this pointer is owned.",
  }),
}).annotations({
  description: "Exact lexical evidence needed to restore one settings value without reformatting user bytes.",
});

export const previousJsonValueSchema = Schema.Union(
  Schema.TaggedStruct("missing", {}),
  Schema.TaggedStruct("value", {
    value: jsonValueSchema.annotations({
      description: "Exact JSON-compatible value present before this pointer first became owned.",
    }),
    lexical: Schema.optional(previousJsonLexicalSchema).annotations({
      description: "Settings-only lexical evidence correlated with the previous semantic value.",
    }),
  }),
).annotations({
  description: "JSON pointer state recorded before the pointer first became owned.",
});

export type PreviousJsonValue = Schema.Schema.Type<typeof previousJsonValueSchema>;

export const wholeFileOwnershipSchema = Schema.TaggedStruct("wholeFile", {
  installedHash: sha256Schema.annotations({
    description: "Hash of the complete installed file.",
  }),
  previous: previousFileValueSchema,
});

export const managedBlockOwnershipSchema = Schema.TaggedStruct("managedBlock", {
  filePreviouslyPresent: Schema.Boolean.annotations({
    description: "Whether the host file existed before this receipt entry first managed it.",
  }),
  startMarker: Schema.NonEmptyTrimmedString.annotations({
    description: "Exact opening marker delimiting the managed block.",
  }),
  endMarker: Schema.NonEmptyTrimmedString.annotations({
    description: "Exact closing marker delimiting the managed block.",
  }),
  installedBodyHash: sha256Schema.annotations({
    description: "Hash of the exact managed block body.",
  }),
}).pipe(
  Schema.filter((ownership) =>
    ownership.startMarker === ownership.endMarker
      ? { path: ["endMarker"], message: "Managed block markers must be distinct." }
      : undefined,
  ),
);

export const installedJsonValueSchema = Schema.TaggedStruct("value", {
  hash: sha256Schema.annotations({
    description: "Hash of the canonical JSON value present after installation.",
  }),
}).annotations({
  description: "Exact installed state required before one managed JSON pointer can be restored.",
});

export type InstalledJsonValue = Schema.Schema.Type<typeof installedJsonValueSchema>;

const ownedJsonValueSchema = Schema.Struct({
  pointer: jsonPointerSchema,
  installed: installedJsonValueSchema.annotations({
    description: "Exact hashed value state installed at this pointer.",
  }),
  previous: previousJsonValueSchema.annotations({
    description: "State recorded before this JSON pointer first became owned.",
  }),
});

export type OwnedJsonValue = Schema.Schema.Type<typeof ownedJsonValueSchema>;

const nestedOrEqual = (left: string, right: string): boolean =>
  left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);

// Owned paths compare case-insensitively so a case-folding filesystem can never hold two owners of one file.
export const pathsConflict = (left: string, right: string): boolean =>
  nestedOrEqual(left.toLowerCase(), right.toLowerCase());

const pointerConflictIssues = (owned: ReadonlyArray<{ readonly pointer: string }>) =>
  owned.flatMap((value, index) =>
    owned.slice(index + 1).flatMap((candidate, offset) =>
      nestedOrEqual(value.pointer, candidate.pointer)
        ? [
            {
              path: [index + offset + 1, "pointer"],
              message: `JSON pointer ${candidate.pointer} conflicts with ${value.pointer}.`,
            },
          ]
        : [],
    ),
  );

const createdContainerIssues = (ownership: {
  readonly createdContainers: ReadonlyArray<string>;
  readonly pointers: ReadonlyArray<string>;
}) => [
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

const ownedJsonValuesSchema = Schema.Array(ownedJsonValueSchema).pipe(
  Schema.minItems(1, {
    message: () => "JSON ownership must record at least one pointer.",
  }),
  Schema.filter(pointerConflictIssues),
);

export const jsonValuesOwnershipSchema = Schema.TaggedStruct("jsonValues", {
  filePreviouslyPresent: Schema.Boolean.annotations({
    description: "Whether the host file existed before this receipt entry first managed it.",
  }),
  createdContainers: Schema.Array(jsonPointerSchema).annotations({
    description: "Exact JSON object pointers created to reach owned values and removable only when empty.",
  }),
  values: ownedJsonValuesSchema,
}).pipe(
  Schema.filter((ownership) =>
    createdContainerIssues({
      createdContainers: ownership.createdContainers,
      pointers: ownership.values.map((value) => value.pointer),
    }),
  ),
);

export type JsonValuesOwnership = Schema.Schema.Type<typeof jsonValuesOwnershipSchema>;

// e.g. "/hooks/Stop" — one hook event array named as is, never a nested member such as "/hooks/Stop/0"
const HOOK_EVENT_POINTER_PATTERN = /^\/hooks\/[^~/]+$/;

const ownedHookEventSchema = Schema.Struct({
  pointer: jsonPointerSchema.pipe(
    Schema.pattern(HOOK_EVENT_POINTER_PATTERN, {
      message: () => "Hook event pointers must name one /hooks/<event> array.",
    }),
  ),
  previouslyPresent: Schema.Boolean.annotations({
    description: "Whether the event array existed before agent-setup first added an entry to it.",
  }),
  entries: Schema.Array(sha256Schema).pipe(
    Schema.minItems(1, {
      message: () => "Hook event ownership must record at least one entry.",
    }),
    Schema.annotations({
      description: "Hash of each agent-setup hook entry in the event array; other entries belong to the user.",
    }),
  ),
});

export type OwnedHookEvent = Schema.Schema.Type<typeof ownedHookEventSchema>;

export const hookEntriesOwnershipSchema = Schema.TaggedStruct("hookEntries", {
  filePreviouslyPresent: Schema.Boolean.annotations({
    description: "Whether the host file existed before this receipt entry first managed it.",
  }),
  createdContainers: Schema.Array(jsonPointerSchema).annotations({
    description: "Exact JSON object pointers created to reach owned events and removable only when empty.",
  }),
  events: Schema.Array(ownedHookEventSchema).pipe(
    Schema.minItems(1, {
      message: () => "Hook entry ownership must record at least one event.",
    }),
    Schema.filter(pointerConflictIssues),
  ),
}).pipe(
  Schema.filter((ownership) =>
    createdContainerIssues({
      createdContainers: ownership.createdContainers,
      pointers: ownership.events.map((event) => event.pointer),
    }),
  ),
);

export type HookEntriesOwnership = Schema.Schema.Type<typeof hookEntriesOwnershipSchema>;

export const yamlSequenceValueOwnershipSchema = Schema.TaggedStruct("yamlSequenceValue", {
  filePreviouslyPresent: Schema.Boolean.annotations({
    description: "Whether the host file existed before this receipt entry first managed it.",
  }),
  key: Schema.NonEmptyTrimmedString.annotations({
    description: "Exact YAML sequence key that owns the reference.",
  }),
  keyPreviouslyPresent: Schema.Boolean.annotations({
    description: "Whether the YAML sequence key existed before this reference first became owned.",
  }),
  insertedPrefix: Schema.Literal("", "\n", "\r\n").annotations({
    description: "Exact separator inserted before a handler-created YAML key so removal can restore the prior bytes.",
  }),
  reference: Schema.NonEmptyTrimmedString.annotations({
    description: "Exact sequence value installed under the key.",
  }),
  previouslyPresent: Schema.Boolean.annotations({
    description: "Whether the exact key/reference pair existed before that pair first became owned.",
  }),
}).pipe(
  Schema.filter((ownership) => [
    ownership.keyPreviouslyPresent || !ownership.previouslyPresent
      ? undefined
      : { path: ["previouslyPresent"], message: "A YAML reference cannot predate a key that did not exist." },
    !ownership.keyPreviouslyPresent || ownership.insertedPrefix.length === 0
      ? undefined
      : { path: ["insertedPrefix"], message: "A pre-existing YAML key cannot own an inserted key prefix." },
  ]),
);

export type YamlSequenceValueOwnership = Schema.Schema.Type<typeof yamlSequenceValueOwnershipSchema>;

const ownershipSchema = Schema.Union(
  wholeFileOwnershipSchema,
  managedBlockOwnershipSchema,
  jsonValuesOwnershipSchema,
  hookEntriesOwnershipSchema,
  yamlSequenceValueOwnershipSchema,
);

export type Ownership = Schema.Schema.Type<typeof ownershipSchema>;

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

const jsonValueTextSchema = Schema.parseJson(jsonValueSchema);
const decodeJsonValueSource = Schema.decodeUnknownEither(jsonValueTextSchema, {
  onExcessProperty: "error",
});

const jsonValuesEqual = (left: unknown, right: unknown): boolean =>
  Schema.encodeSync(jsonValueTextSchema)(left) === Schema.encodeSync(jsonValueTextSchema)(right);

const lexicalMatchesPrevious = (value: OwnedJsonValue): boolean => {
  if (value.previous._tag === "missing" || value.previous.lexical === undefined) {
    return false;
  }

  const decoded = decodeJsonValueSource(value.previous.lexical.source);

  return Either.isRight(decoded) && jsonValuesEqual(decoded.right, value.previous.value);
};

const settingsLexicalIssues = (entry: { kind: FileKind; ownership: Ownership }) => {
  if (entry.ownership._tag !== "jsonValues") {
    return [];
  }

  return entry.ownership.values.flatMap((value, index) => {
    const path = ["ownership", "values", index, "previous", "lexical"];
    const lexical = value.previous._tag === "value" ? value.previous.lexical : undefined;
    if (entry.kind._tag !== "settings") {
      return lexical === undefined
        ? []
        : [{ path, message: "Only settings ownership may carry lexical JSON restoration evidence." }];
    }

    if (value.previous._tag === "missing" || lexicalMatchesPrevious(value)) {
      return [];
    }

    return [{ path, message: "Settings ownership requires correlated value lexical restoration evidence." }];
  });
};

export const ownedFileSchema = Schema.Struct({
  owner: fileOwnerSchema,
  path: relativePathSchema,
  kind: fileKindSchema,
  ownership: ownershipSchema,
}).pipe(
  Schema.filter((entry) => [
    ownerMatchesKind(entry.kind, entry.owner)
      ? undefined
      : { path: ["owner"], message: `File kind ${entry.kind._tag} has incompatible owner ${entry.owner._tag}.` },
    ownershipMatchesKind(entry.kind, entry.ownership)
      ? undefined
      : {
          path: ["ownership"],
          message: `File kind ${entry.kind._tag} has incompatible ownership ${entry.ownership._tag}.`,
        },
    ...settingsLexicalIssues(entry),
  ]),
);

export type OwnedFile = Schema.Schema.Type<typeof ownedFileSchema>;

export const ownedFilesEqual = Schema.equivalence(ownedFileSchema);
