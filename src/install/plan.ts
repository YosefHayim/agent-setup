import { z } from "zod";

import { addZodIssueDetails, joinZodIssueMessages, type ZodIssueDetail } from "../zod-issue-messages.js";
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
import { nonEmptyTrimmedTextSchema } from "./text-rules.js";

const receiptFilename = "receipt.json";
const recoveryFilename = "recovery.json";

// e.g. "/Users/me/.claude" or "C:/Users/me/.claude" — not "rel", "a/../b", or "C:\\x"
export const absoluteRootSchema = nonEmptyTrimmedTextSchema
  .regex(/^(?:\/|[A-Za-z]:\/)(?!.*(?:^|\/)\.{1,2}(?:\/|$))(?!.*\/\/)(?:[^\\/\0]+(?:\/[^\\/\0]+)*)?$/, {
    message: "Plan roots must be canonical POSIX or drive-absolute forward-slash paths with no parent traversal.",
  })
  .describe("Absolute filesystem root used to resolve every scope-relative file path.");

const receiptPathSchema = relativePathSchema.refine(
  (path) => path === receiptFilename || path.endsWith(`/${receiptFilename}`),
  { message: `Ownership receipts must use the canonical ${receiptFilename} basename.` },
);

export const receiptTargetSchema = z.strictObject({
  path: receiptPathSchema.describe("Scope-relative path where the ownership receipt is published or removed."),
  kind: z
    .strictObject({ _tag: z.literal("receipt") })
    .describe("Receipt target kind fixed independently from receipt entries."),
  owner: z.strictObject({ _tag: z.literal("application") }).describe("Receipt targets are always application-owned."),
});

export type ReceiptTarget = z.infer<typeof receiptTargetSchema>;

const plannedFileSchema = ownedFileSchema.superRefine((file, context) => {
  const isReceiptEntry = file.kind._tag === "receipt";

  if (isReceiptEntry) {
    context.addIssue({
      code: "custom",
      path: ["kind"],
      message: "Receipt entries belong only in the separate receipt operation.",
    });
  }
});

export const expectedCurrentSchema = z.discriminatedUnion("_tag", [
  z.strictObject({ _tag: z.literal("missing") }).describe("Planning observed that the file target did not exist."),
  z.strictObject({
    _tag: z.literal("file"),
    sha256: sha256Schema.describe("Exact SHA-256 of the file bytes observed during planning."),
  }),
]);

export type ExpectedCurrent = z.infer<typeof expectedCurrentSchema>;

const preconditionSchema = z.strictObject({
  path: relativePathSchema.describe("Owned file path validated even when its desired bytes are unchanged."),
  expectedCurrent: expectedCurrentSchema.describe("Exact target state captured while planning the unchanged file."),
});

export type Precondition = z.infer<typeof preconditionSchema>;

// Typed as plain Uint8Array: z.instanceof alone infers Uint8Array<ArrayBuffer>, which rejects other buffers.
const fileBytesSchema: z.ZodType<Uint8Array> = z.instanceof(Uint8Array);

export const writeOperationSchema = z.strictObject({
  _tag: z.literal("write"),
  file: plannedFileSchema.describe("Complete next-owned file and its exact ownership metadata."),
  bytes: fileBytesSchema.describe("Exact desired file bytes prepared by the transactional writer."),
});

export type WriteOperation = z.infer<typeof writeOperationSchema>;

const restoreFieldsSchema = z.strictObject({
  _tag: z.literal("restore"),
  file: plannedFileSchema.describe("Previously receipted file whose final unowned bytes are restored."),
  bytes: fileBytesSchema.describe("Exact final bytes computed by the file format handler."),
});

type RestoreFields = z.infer<typeof restoreFieldsSchema>;

const restoreBytesIssues = (operation: RestoreFields): ReadonlyArray<ZodIssueDetail> => {
  const { ownership } = operation.file;
  const isOwnedInParts = ownership._tag !== "wholeFile";
  if (isOwnedInParts) {
    return [];
  }

  const { previous } = ownership;
  const isRecordedPriorBytes = previous._tag === "priorFile" && bytesEqual(operation.bytes, previous.bytes);
  if (isRecordedPriorBytes) {
    return [];
  }

  return [
    {
      path: ["bytes"],
      message: "Whole-file restoration bytes must exactly match the recorded prior bytes.",
    },
  ];
};

const refineRestoreBytes = (operation: RestoreFields, context: z.RefinementCtx): void =>
  addZodIssueDetails(context, restoreBytesIssues(operation));

const restoreOperationSchema = restoreFieldsSchema.superRefine(refineRestoreBytes);

const emptyBytesSchema = z
  .instanceof(Uint8Array)
  .refine((bytes) => bytes.byteLength === 0, { message: "File removal requires proof that no unowned bytes remain." });

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

const removeFieldsSchema = z.strictObject({
  _tag: z.literal("remove"),
  file: plannedFileSchema.describe("Previously receipted file whose final action is safe host-file deletion."),
  unownedBytes: emptyBytesSchema.describe(
    "Computed final unowned bytes, which must be empty before host-file deletion.",
  ),
});

type RemoveFields = z.infer<typeof removeFieldsSchema>;

const removalOwnershipIssues = (operation: RemoveFields): ReadonlyArray<ZodIssueDetail> => {
  const isRemovalAllowed = ownershipAllowsRemoval(operation.file.ownership);
  if (isRemovalAllowed) {
    return [];
  }

  return [
    {
      path: ["file", "ownership"],
      message: "File removal requires proof that the complete host file was originally absent.",
    },
  ];
};

const refineRemoval = (operation: RemoveFields, context: z.RefinementCtx): void =>
  addZodIssueDetails(context, removalOwnershipIssues(operation));

const removeFileOperationSchema = removeFieldsSchema.superRefine(refineRemoval);

const expectedCurrentShape = {
  expectedCurrent: expectedCurrentSchema.describe(
    "Target state that must still match before this operation may be prepared or committed.",
  ),
};

const receiptRemoveOperationSchema = z
  .strictObject({ _tag: z.literal("remove"), target: receiptTargetSchema })
  .extend(expectedCurrentShape);

const receiptPublishOperationSchema = z
  .strictObject({
    _tag: z.literal("receiptPublish"),
    target: receiptTargetSchema,
    receipt: receiptSchema.describe("Complete next ownership receipt published after every file change succeeds."),
  })
  .extend(expectedCurrentShape);

type ReceiptPublishOperation = z.infer<typeof receiptPublishOperationSchema>;

const restorationSchema = z.discriminatedUnion("_tag", [restoreOperationSchema, removeFileOperationSchema]);

export type Restoration = z.infer<typeof restorationSchema>;

export const plannedWriteOperationSchema = writeOperationSchema.extend(expectedCurrentShape);
const plannedRestoreOperationSchema = restoreFieldsSchema.extend(expectedCurrentShape).superRefine(refineRestoreBytes);
const plannedRemoveOperationSchema = removeFieldsSchema.extend(expectedCurrentShape).superRefine(refineRemoval);

export const plannedRestorationSchema = z.discriminatedUnion("_tag", [
  plannedRestoreOperationSchema,
  plannedRemoveOperationSchema,
]);

export type PlannedRestoration = z.infer<typeof plannedRestorationSchema>;

export const fileChangeSchema = z.discriminatedUnion("_tag", [
  plannedWriteOperationSchema,
  plannedRestoreOperationSchema,
  plannedRemoveOperationSchema,
]);

export type FileChange = z.infer<typeof fileChangeSchema>;

const receiptOperationSchema = z.discriminatedUnion("_tag", [
  receiptPublishOperationSchema,
  receiptRemoveOperationSchema,
]);

export type ReceiptOperation = z.infer<typeof receiptOperationSchema>;

const normalizedPath = (path: string): string => path.toLowerCase();

export const reservedReceiptPaths = (receiptTarget: ReceiptTarget): ReadonlyArray<string> => [
  receiptTarget.path,
  `${receiptTarget.path.slice(0, -receiptFilename.length)}${recoveryFilename}`,
];

const laterConflictIssues = (operation: FileChange, index: number, operations: ReadonlyArray<FileChange>) =>
  operations.slice(index + 1).flatMap((candidate, offset) => {
    const isPathClear = !pathsConflict(operation.file.path, candidate.file.path);
    if (isPathClear) {
      return [];
    }

    const isSamePath = normalizedPath(operation.file.path) === normalizedPath(candidate.file.path);
    const message = isSamePath
      ? "File change paths must be unique."
      : `File change path ${candidate.file.path} conflicts with ${operation.file.path}.`;

    return [{ path: ["operations", index + offset + 1, "file", "path"], message }];
  });

const reservedPathIssues = (
  operation: FileChange,
  index: number,
  receiptTarget: ReceiptTarget,
): ReadonlyArray<ZodIssueDetail> => {
  const reservedPath = reservedReceiptPaths(receiptTarget).find((path) => pathsConflict(operation.file.path, path));
  if (reservedPath == null) {
    return [];
  }

  return [
    {
      path: ["operations", index, "file", "path"],
      message: `File change path ${operation.file.path} conflicts with reserved path ${reservedPath}.`,
    },
  ];
};

const operationPathIssues = (
  operations: ReadonlyArray<FileChange>,
  receiptTarget: ReceiptTarget,
): ReadonlyArray<ZodIssueDetail> =>
  operations.flatMap((operation, index) => [
    ...laterConflictIssues(operation, index, operations),
    ...reservedPathIssues(operation, index, receiptTarget),
  ]);

const receiptFileIssues = (receipt: Receipt, receiptTarget: ReceiptTarget): ReadonlyArray<ZodIssueDetail> =>
  receipt.ownedFiles.flatMap((file, index) => {
    const path = ["receipt", "receipt", "ownedFiles", index];
    const isReceiptEntry = file.kind._tag === "receipt";
    const reservedPath = reservedReceiptPaths(receiptTarget).find((reserved) => pathsConflict(file.path, reserved));

    return [
      ...(isReceiptEntry
        ? [{ path: [...path, "kind"], message: "Published receipt entries cannot contain the receipt itself." }]
        : []),
      ...(reservedPath == null
        ? []
        : [
            {
              path: [...path, "path"],
              message: `Receipt entry path ${file.path} conflicts with reserved path ${reservedPath}.`,
            },
          ]),
    ];
  });

type PlanFields = z.infer<typeof planFieldsSchema>;

const preconditionIssues = (plan: PlanFields): ReadonlyArray<ZodIssueDetail> => [
  ...plan.preconditions.flatMap((precondition, index) => {
    const isPathRepeated = plan.preconditions
      .slice(0, index)
      .some((candidate) => normalizedPath(candidate.path) === normalizedPath(precondition.path));
    if (isPathRepeated) {
      return [
        { path: ["preconditions", index, "path"], message: `Precondition path ${precondition.path} must be unique.` },
      ];
    }

    return [];
  }),
  ...plan.preconditions.flatMap((precondition, index) => {
    const isMutationTarget = plan.operations.some(
      (operation) => normalizedPath(operation.file.path) === normalizedPath(precondition.path),
    );
    if (isMutationTarget) {
      return [
        {
          path: ["preconditions", index, "path"],
          message: "Validation-only preconditions cannot duplicate mutation targets.",
        },
      ];
    }

    return [];
  }),
];

const publishScopeIssues = (plan: PlanFields, publish: ReceiptPublishOperation): ReadonlyArray<ZodIssueDetail> => {
  const isScopeMatching = publish.receipt.scope === plan.scope;
  if (isScopeMatching) {
    return [];
  }

  return [{ path: ["receipt", "receipt", "scope"], message: "Published receipt scope must match the plan scope." }];
};

const operationReceiptIssues = (plan: PlanFields, publish: ReceiptPublishOperation): ReadonlyArray<ZodIssueDetail> =>
  plan.operations.flatMap((operation, index) => {
    const receiptFile = publish.receipt.ownedFiles.find((file) => file.path === operation.file.path);
    if (operation._tag !== "write") {
      if (receiptFile == null) {
        return [];
      }

      return [
        {
          path: ["operations", index, "file", "path"],
          message: "Restored and removed files must be absent from the published receipt.",
        },
      ];
    }

    const isExactReceiptEntry = receiptFile != null && ownedFilesEqual(operation.file, receiptFile);
    if (isExactReceiptEntry) {
      return [];
    }

    return [
      {
        path: ["operations", index, "file"],
        message: "Written files must exactly match their published receipt entries.",
      },
    ];
  });

const receiptEntryCoverageIssues = (
  plan: PlanFields,
  publish: ReceiptPublishOperation,
): ReadonlyArray<ZodIssueDetail> =>
  publish.receipt.ownedFiles.flatMap((file, index) => {
    const isMutated = plan.operations.some((operation) => operation.file.path === file.path);
    const isGuarded = plan.preconditions.filter((precondition) => precondition.path === file.path).length === 1;
    if (isMutated || isGuarded) {
      return [];
    }

    return [
      {
        path: ["receipt", "receipt", "ownedFiles", index, "path"],
        message: "Every published file requires a mutation or validation-only precondition.",
      },
    ];
  });

const preconditionReceiptIssues = (plan: PlanFields, publish: ReceiptPublishOperation): ReadonlyArray<ZodIssueDetail> =>
  plan.preconditions.flatMap((precondition, index) => {
    const isPublished = publish.receipt.ownedFiles.some((file) => file.path === precondition.path);
    if (isPublished) {
      return [];
    }

    return [
      {
        path: ["preconditions", index, "path"],
        message: "Validation-only preconditions must correspond to a published receipt entry.",
      },
    ];
  });

const publishIssues = (plan: PlanFields, publish: ReceiptPublishOperation): ReadonlyArray<ZodIssueDetail> => [
  ...publishScopeIssues(plan, publish),
  ...receiptFileIssues(publish.receipt, publish.target),
  ...operationReceiptIssues(plan, publish),
  ...receiptEntryCoverageIssues(plan, publish),
  ...preconditionReceiptIssues(plan, publish),
];

const removalIssues = (plan: PlanFields): ReadonlyArray<ZodIssueDetail> => [
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

const planIssues = (plan: PlanFields): ReadonlyArray<ZodIssueDetail> => [
  ...operationPathIssues(plan.operations, plan.receipt.target),
  ...preconditionIssues(plan),
  ...(plan.receipt._tag === "receiptPublish" ? publishIssues(plan, plan.receipt) : removalIssues(plan)),
];

const planFieldsSchema = z.strictObject({
  scope: scopeSchema.describe("Installation scope shared by the plan and published receipt."),
  root: absoluteRootSchema,
  operations: z
    .array(fileChangeSchema)
    .describe("Ordered desired writes, host-file restorations, and host-file deletions committed before the receipt."),
  preconditions: z
    .array(preconditionSchema)
    .describe("Validation-only guards retained for desired files whose bytes need no write."),
  receipt: receiptOperationSchema.describe("Receipt publication or removal represented separately and committed last."),
});

const planSchema = planFieldsSchema.superRefine((plan, context) => addZodIssueDetails(context, planIssues(plan)));

export type Plan = z.infer<typeof planSchema>;

export const checkPlan = (candidatePlan: unknown): Plan => {
  const planCheck = planSchema.safeParse(candidatePlan);
  const isPlanAccepted = planCheck.success;
  if (isPlanAccepted) {
    return planCheck.data;
  }

  throw new Error(joinZodIssueMessages(planCheck.error));
};
