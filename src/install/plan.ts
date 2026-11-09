/** The plan shape: every file change, validation-only guard, and receipt step one transaction applies. */

import { Schema } from "effect";

import { bytesEqual } from "./file-bytes.js";
import {
  type Ownership,
  ownedFileSchema,
  ownedFilesEqual,
  pathsConflict,
  relativePathSchema,
  sha256Schema,
} from "./ownership.js";
import { type Receipt, receiptSchema, scopeSchema } from "./receipt.js";

const receiptFilename = "receipt.json";
const recoveryFilename = "recovery.json";

// e.g. "/Users/me/.claude" or "C:/Users/me/.claude" — not "rel", "a/../b", or "C:\\x"
const ABSOLUTE_ROOT_PATTERN =
  /^(?:\/|[A-Za-z]:\/)(?!.*(?:^|\/)\.{1,2}(?:\/|$))(?!.*\/\/)(?:[^\\/\0]+(?:\/[^\\/\0]+)*)?$/;

export const absoluteRootSchema = Schema.NonEmptyTrimmedString.pipe(
  Schema.pattern(ABSOLUTE_ROOT_PATTERN, {
    message: () => "Plan roots must be canonical POSIX or drive-absolute forward-slash paths with no parent traversal.",
  }),
  Schema.annotations({
    description: "Absolute filesystem root used to resolve every scope-relative file path.",
  }),
);

const receiptPathSchema = relativePathSchema.pipe(
  Schema.filter((path) => path === receiptFilename || path.endsWith(`/${receiptFilename}`), {
    message: () => `Ownership receipts must use the canonical ${receiptFilename} basename.`,
  }),
);

export const receiptTargetSchema = Schema.Struct({
  path: receiptPathSchema.annotations({
    description: "Scope-relative path where the ownership receipt is published or removed.",
  }),
  kind: Schema.TaggedStruct("receipt", {}).annotations({
    description: "Receipt target kind fixed independently from receipt entries.",
  }),
  owner: Schema.TaggedStruct("application", {}).annotations({
    description: "Receipt targets are always application-owned.",
  }),
});

export type ReceiptTarget = Schema.Schema.Type<typeof receiptTargetSchema>;

const plannedFileSchema = ownedFileSchema.pipe(
  Schema.filter((file) =>
    file.kind._tag === "receipt"
      ? { path: ["kind"], message: "Receipt entries belong only in the separate receipt operation." }
      : undefined,
  ),
);

export const expectedCurrentSchema = Schema.Union(
  Schema.TaggedStruct("missing", {}).annotations({
    description: "Planning observed that the file target did not exist.",
  }),
  Schema.TaggedStruct("file", {
    sha256: sha256Schema.annotations({
      description: "Exact SHA-256 of the file bytes observed during planning.",
    }),
  }),
);

export type ExpectedCurrent = Schema.Schema.Type<typeof expectedCurrentSchema>;

const preconditionSchema = Schema.Struct({
  path: relativePathSchema.annotations({
    description: "Owned file path validated even when its desired bytes are unchanged.",
  }),
  expectedCurrent: expectedCurrentSchema.annotations({
    description: "Exact target state captured while planning the unchanged file.",
  }),
});

export type Precondition = Schema.Schema.Type<typeof preconditionSchema>;

export const writeOperationSchema = Schema.TaggedStruct("write", {
  file: plannedFileSchema.annotations({
    description: "Complete next-owned file and its exact ownership metadata.",
  }),
  bytes: Schema.Uint8ArrayFromSelf.annotations({
    description: "Exact desired file bytes prepared by the transactional writer.",
  }),
});

export type WriteOperation = Schema.Schema.Type<typeof writeOperationSchema>;

const restoreOperationSchema = Schema.TaggedStruct("restore", {
  file: plannedFileSchema.annotations({
    description: "Previously receipted file whose final unowned bytes are restored.",
  }),
  bytes: Schema.Uint8ArrayFromSelf.annotations({
    description: "Exact final bytes computed by the file format handler.",
  }),
}).pipe(
  Schema.filter((operation) => {
    if (operation.file.ownership._tag !== "wholeFile") {
      return undefined;
    }

    const previous = operation.file.ownership.previous;

    return previous._tag === "priorFile" && bytesEqual(operation.bytes, previous.bytes)
      ? undefined
      : { path: ["bytes"], message: "Whole-file restoration bytes must exactly match the recorded prior bytes." };
  }),
);

const emptyBytesSchema = Schema.Uint8ArrayFromSelf.pipe(
  Schema.filter((bytes) => bytes.byteLength === 0, {
    message: () => "File removal requires proof that no unowned bytes remain.",
  }),
);

const ownershipAllowsRemoval = (ownership: Ownership): boolean => {
  switch (ownership._tag) {
    case "wholeFile":
      return ownership.previous._tag === "missing";
    case "managedBlock":
      return !ownership.filePreviouslyPresent;
    case "jsonValues":
      return !ownership.filePreviouslyPresent && ownership.values.every((value) => value.previous._tag === "missing");
    case "hookEntries":
      return !ownership.filePreviouslyPresent && ownership.events.every((event) => !event.previouslyPresent);
    case "yamlSequenceValue":
      return !ownership.filePreviouslyPresent && !ownership.previouslyPresent;
  }
};

const removeFileOperationSchema = Schema.TaggedStruct("remove", {
  file: plannedFileSchema.annotations({
    description: "Previously receipted file whose final action is safe host-file deletion.",
  }),
  unownedBytes: emptyBytesSchema.annotations({
    description: "Computed final unowned bytes, which must be empty before host-file deletion.",
  }),
}).pipe(
  Schema.filter((operation) =>
    ownershipAllowsRemoval(operation.file.ownership)
      ? undefined
      : {
          path: ["file", "ownership"],
          message: "File removal requires proof that the complete host file was originally absent.",
        },
  ),
);

const expectedCurrentFieldsSchema = Schema.Struct({
  expectedCurrent: expectedCurrentSchema.annotations({
    description: "Target state that must still match before this operation may be prepared or committed.",
  }),
});

const receiptRemoveOperationSchema = Schema.extend(
  Schema.TaggedStruct("remove", { target: receiptTargetSchema }),
  expectedCurrentFieldsSchema,
);

const receiptPublishOperationSchema = Schema.extend(
  Schema.TaggedStruct("receiptPublish", {
    target: receiptTargetSchema,
    receipt: receiptSchema.annotations({
      description: "Complete next ownership receipt published after every file change succeeds.",
    }),
  }),
  expectedCurrentFieldsSchema,
);

type ReceiptPublishOperation = Schema.Schema.Type<typeof receiptPublishOperationSchema>;

const restorationSchema = Schema.Union(restoreOperationSchema, removeFileOperationSchema);

export type Restoration = Schema.Schema.Type<typeof restorationSchema>;

export const plannedWriteOperationSchema = Schema.extend(writeOperationSchema, expectedCurrentFieldsSchema);
const plannedRestoreOperationSchema = Schema.extend(restoreOperationSchema, expectedCurrentFieldsSchema);
const plannedRemoveOperationSchema = Schema.extend(removeFileOperationSchema, expectedCurrentFieldsSchema);
export const plannedRestorationSchema = Schema.Union(plannedRestoreOperationSchema, plannedRemoveOperationSchema);

export type PlannedRestoration = Schema.Schema.Type<typeof plannedRestorationSchema>;

export const fileChangeSchema = Schema.Union(
  plannedWriteOperationSchema,
  plannedRestoreOperationSchema,
  plannedRemoveOperationSchema,
);

export type FileChange = Schema.Schema.Type<typeof fileChangeSchema>;

const receiptOperationSchema = Schema.Union(receiptPublishOperationSchema, receiptRemoveOperationSchema);

export type ReceiptOperation = Schema.Schema.Type<typeof receiptOperationSchema>;

const normalizedPath = (path: string): string => path.toLowerCase();

export const reservedReceiptPaths = (receiptTarget: ReceiptTarget): ReadonlyArray<string> => [
  receiptTarget.path,
  `${receiptTarget.path.slice(0, -receiptFilename.length)}${recoveryFilename}`,
];

const operationPathIssues = (operations: ReadonlyArray<FileChange>, receiptTarget: ReceiptTarget) =>
  operations.flatMap((operation, index) => {
    const reservedPath = reservedReceiptPaths(receiptTarget).find((path) => pathsConflict(operation.file.path, path));

    return [
      ...operations.slice(index + 1).flatMap((candidate, offset) => {
        if (!pathsConflict(operation.file.path, candidate.file.path)) {
          return [];
        }

        const message =
          normalizedPath(operation.file.path) === normalizedPath(candidate.file.path)
            ? "File change paths must be unique."
            : `File change path ${candidate.file.path} conflicts with ${operation.file.path}.`;
        return [{ path: ["operations", index + offset + 1, "file", "path"], message }];
      }),
      ...(reservedPath === undefined
        ? []
        : [
            {
              path: ["operations", index, "file", "path"],
              message: `File change path ${operation.file.path} conflicts with reserved path ${reservedPath}.`,
            },
          ]),
    ];
  });

const receiptFileIssues = (receipt: Receipt, receiptTarget: ReceiptTarget) =>
  receipt.ownedFiles.flatMap((file, index) => {
    const path = ["receipt", "receipt", "ownedFiles", index];
    const reservedPath = reservedReceiptPaths(receiptTarget).find((reserved) => pathsConflict(file.path, reserved));

    return [
      ...(file.kind._tag === "receipt"
        ? [{ path: [...path, "kind"], message: "Published receipt entries cannot contain the receipt itself." }]
        : []),
      ...(reservedPath === undefined
        ? []
        : [
            {
              path: [...path, "path"],
              message: `Receipt entry path ${file.path} conflicts with reserved path ${reservedPath}.`,
            },
          ]),
    ];
  });

const planFieldsSchema = Schema.Struct({
  scope: scopeSchema.annotations({
    description: "Installation scope shared by the plan and published receipt.",
  }),
  root: absoluteRootSchema,
  operations: Schema.Array(fileChangeSchema).annotations({
    description:
      "Ordered desired writes, host-file restorations, and host-file deletions committed before the receipt.",
  }),
  preconditions: Schema.Array(preconditionSchema).annotations({
    description: "Validation-only guards retained for desired files whose bytes need no write.",
  }),
  receipt: receiptOperationSchema.annotations({
    description: "Receipt publication or removal represented separately and committed last.",
  }),
});

type PlanFields = Schema.Schema.Type<typeof planFieldsSchema>;

const preconditionIssues = (plan: PlanFields) => [
  ...plan.preconditions.flatMap((precondition, index) =>
    plan.preconditions
      .slice(0, index)
      .some((candidate) => normalizedPath(candidate.path) === normalizedPath(precondition.path))
      ? [{ path: ["preconditions", index, "path"], message: `Precondition path ${precondition.path} must be unique.` }]
      : [],
  ),
  ...plan.preconditions.flatMap((precondition, index) =>
    plan.operations.some((operation) => normalizedPath(operation.file.path) === normalizedPath(precondition.path))
      ? [
          {
            path: ["preconditions", index, "path"],
            message: "Validation-only preconditions cannot duplicate mutation targets.",
          },
        ]
      : [],
  ),
];

const publishIssues = (plan: PlanFields, publish: ReceiptPublishOperation) => [
  ...(publish.receipt.scope === plan.scope
    ? []
    : [{ path: ["receipt", "receipt", "scope"], message: "Published receipt scope must match the plan scope." }]),
  ...receiptFileIssues(publish.receipt, publish.target),
  ...plan.operations.flatMap((operation, index) => {
    const receiptFile = publish.receipt.ownedFiles.find((file) => file.path === operation.file.path);
    if (operation._tag !== "write") {
      return receiptFile === undefined
        ? []
        : [
            {
              path: ["operations", index, "file", "path"],
              message: "Restored and removed files must be absent from the published receipt.",
            },
          ];
    }

    return receiptFile !== undefined && ownedFilesEqual(operation.file, receiptFile)
      ? []
      : [
          {
            path: ["operations", index, "file"],
            message: "Written files must exactly match their published receipt entries.",
          },
        ];
  }),
  ...publish.receipt.ownedFiles.flatMap((file, index) => {
    const mutated = plan.operations.some((operation) => operation.file.path === file.path);
    const guarded = plan.preconditions.filter((precondition) => precondition.path === file.path).length === 1;

    return mutated || guarded
      ? []
      : [
          {
            path: ["receipt", "receipt", "ownedFiles", index, "path"],
            message: "Every published file requires a mutation or validation-only precondition.",
          },
        ];
  }),
  ...plan.preconditions.flatMap((precondition, index) =>
    publish.receipt.ownedFiles.some((file) => file.path === precondition.path)
      ? []
      : [
          {
            path: ["preconditions", index, "path"],
            message: "Validation-only preconditions must correspond to a published receipt entry.",
          },
        ],
  ),
];

const removalIssues = (plan: PlanFields) => [
  ...plan.preconditions.map((_, index) => ({
    path: ["preconditions", index],
    message: "Receipt-removal plans cannot retain validation-only desired files.",
  })),
  ...plan.operations.flatMap((operation, index) =>
    operation._tag === "write"
      ? [
          {
            path: ["operations", index, "_tag"],
            message: "A receipt-removal plan can contain only file restorations or removals.",
          },
        ]
      : [],
  ),
];

const planSchema = planFieldsSchema.pipe(
  Schema.filter((plan) => [
    ...operationPathIssues(plan.operations, plan.receipt.target),
    ...preconditionIssues(plan),
    ...(plan.receipt._tag === "receiptPublish" ? publishIssues(plan, plan.receipt) : removalIssues(plan)),
  ]),
);

export type Plan = Schema.Schema.Type<typeof planSchema>;

export const checkPlan = (input: unknown) =>
  Schema.validateEither(planSchema, {
    onExcessProperty: "error",
  })(input);
