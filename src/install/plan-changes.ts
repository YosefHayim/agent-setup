import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import { addZodIssueDetails, joinZodIssueMessages, type ZodIssueDetail } from "#src/zod-issue-messages.js";
import {
  type DocumentFieldsOwnership,
  type HookEntriesOwnership,
  isOwnedFilesEqual,
  isPathsConflict,
  type OwnedFile,
  type Ownership,
  type YamlSequenceFieldOwnership,
} from "./ownership.js";
import {
  absoluteRootSchema,
  checkPlan,
  expectedCurrentSchema,
  listReservedReceiptPaths,
  type Plan,
  type PlannedRestoration,
  plannedRestorationSchema,
  plannedWriteOperationSchema,
  type Restoration,
  receiptTargetSchema,
} from "./plan.js";
import { receiptSchema } from "./receipt.js";

const reverseFields = <Field>(fields: ReadonlyArray<Field>): ReadonlyArray<Field> =>
  fields.map((_, index) => fields[fields.length - index - 1]);

const listRestorationConsistencyIssues = (
  expectedFiles: ReadonlyArray<OwnedFile>,
  restorations: ReadonlyArray<Restoration>,
): ReadonlyArray<ZodIssueDetail> => [
  ...expectedFiles.flatMap((expectedFile) => {
    const matchingIndexes = restorations.flatMap((restoration, index) =>
      isOwnedFilesEqual(restoration.file, expectedFile) ? [index] : [],
    );

    const isMatchingIndexesEmpty = matchingIndexes.length === 0;
    if (isMatchingIndexesEmpty) {
      return [
        {
          path: ["restorations"],
          message: `Prior receipt entry ${expectedFile.path} requires one exact restoration action.`,
        },
      ];
    }

    return matchingIndexes.slice(1).map((index) => ({
      path: ["restorations", index, "file"],
      message: `Prior receipt entry ${expectedFile.path} cannot have duplicate restoration actions.`,
    }));
  }),
  ...restorations.flatMap((restoration, index) => {
    const isPriorFile = expectedFiles.some((file) => isOwnedFilesEqual(restoration.file, file));
    if (isPriorFile) {
      return [];
    }

    return [
      {
        path: ["restorations", index, "file"],
        message: "Restoration actions cannot include files absent from the prior receipt.",
      },
    ];
  }),
];

const orderRestorations = (
  expectedFiles: ReadonlyArray<OwnedFile>,
  restorations: ReadonlyArray<PlannedRestoration>,
): ReadonlyArray<PlannedRestoration> =>
  [...restorations].sort(
    (left, right) =>
      expectedFiles.findIndex((file) => isOwnedFilesEqual(file, left.file)) -
      expectedFiles.findIndex((file) => isOwnedFilesEqual(file, right.file)),
  );

const previousReceiptSchema = z.discriminatedUnion("_tag", [
  z.strictObject({ _tag: z.literal("missing") }),
  z.strictObject({ _tag: z.literal("receipt"), receipt: receiptSchema }),
]);

const listDesiredWriteIssues = (desired: DesiredStatus): ReadonlyArray<ZodIssueDetail> =>
  desired.writes.flatMap((operation, index) => {
    const receiptFile = desired.receipt.ownedFiles.find((file) => file.path === operation.file.path);

    const isReceiptFileEqual = receiptFile != null && isOwnedFilesEqual(operation.file, receiptFile);
    if (isReceiptFileEqual) {
      return [];
    }

    return [
      {
        path: ["writes", index, "file"],
        message: "Every desired write must exactly match its desired receipt entry.",
      },
    ];
  });

const listDesiredReceiptFileIssues = (desired: DesiredStatus): ReadonlyArray<ZodIssueDetail> =>
  desired.receipt.ownedFiles.flatMap((file, index) => {
    const writeCount = desired.writes.filter((operation) => operation.file.path === file.path).length;

    const isExactlyOneWrite = writeCount === 1;
    if (isExactlyOneWrite) {
      return [];
    }

    return [
      {
        path: ["receipt", "ownedFiles", index, "path"],
        message: "Every desired receipt entry must have exactly one desired write.",
      },
    ];
  });

const desiredStatusSchema = z
  .strictObject({
    receipt: receiptSchema,
    writes: z.array(plannedWriteOperationSchema),
  })
  .superRefine((desired, scope) =>
    addZodIssueDetails(scope, [...listDesiredWriteIssues(desired), ...listDesiredReceiptFileIssues(desired)]),
  );

type DesiredStatus = z.infer<typeof desiredStatusSchema>;

type RetainedFile = {
  readonly file: OwnedFile;
  readonly previous: OwnedFile;
  readonly path: ReadonlyArray<string | number>;
};

const listRetainedFileIssues = ({ file, previous, path }: RetainedFile): ReadonlyArray<ZodIssueDetail> => {
  const isSameKind = previous.kind._tag === file.kind._tag;
  const isSameOwner = previous.owner._tag === file.owner._tag;
  return [
    ...(isSameKind
      ? []
      : [
          {
            path: [...path, "kind"],
            message: `Cannot change file kind from ${previous.kind._tag} to ${file.kind._tag} at ${file.path}; remove the prior ownership first.`,
          },
        ]),
    ...(isSameOwner
      ? []
      : [
          {
            path: [...path, "owner"],
            message: `Cannot change file owner from ${previous.owner._tag} to ${file.owner._tag} at ${file.path}; remove the prior ownership first.`,
          },
        ]),
  ];
};

// Settings receipts from before entry ownership owned whole hook event arrays; the next install migrates them.
const isOwnershipChangeAllowed = ({ file, previous }: RetainedFile): boolean =>
  previous.ownership._tag === file.ownership._tag ||
  (file.kind._tag === "settings" && previous.ownership._tag === "jsonValues" && file.ownership._tag === "hookEntries");

const listOwnershipChangeIssues = (retained: RetainedFile): ReadonlyArray<ZodIssueDetail> => {
  const { file, previous, path } = retained;

  if (isOwnershipChangeAllowed(retained)) {
    return [];
  }

  return [
    {
      path: [...path, "ownership", "_tag"],
      message: `Cannot change ownership from ${previous.ownership._tag} to ${file.ownership._tag} at ${file.path}; remove the prior ownership first.`,
    },
  ];
};

type DocumentPointerOwnership = DocumentFieldsOwnership | HookEntriesOwnership;

const listOwnedDocumentPointers = (ownership: DocumentPointerOwnership): ReadonlyArray<string> => {
  const isDocumentValuesOwnership = ownership._tag === "jsonValues";
  return isDocumentValuesOwnership
    ? ownership.values.map((field) => field.pointer)
    : ownership.events.map((event) => event.pointer);
};

const readDocumentPointerOwnership = (ownership: Ownership): DocumentPointerOwnership | null => {
  const isDocumentOrHookEntriesOwnership = ownership._tag === "jsonValues" || ownership._tag === "hookEntries";
  return isDocumentOrHookEntriesOwnership ? ownership : null;
};

// A created container is deletion authority, so it may only be acquired together with a newly owned value inside it.
const listDocumentContainerAcquisitionIssues = ({
  file,
  previous,
  path,
}: RetainedFile): ReadonlyArray<ZodIssueDetail> => {
  const previousOwnership = readDocumentPointerOwnership(previous.ownership);

  const desiredOwnership = readDocumentPointerOwnership(file.ownership);

  const isOwnershipMissing = previousOwnership == null || desiredOwnership == null;
  if (isOwnershipMissing) {
    return [];
  }

  const previousPointers = listOwnedDocumentPointers(previousOwnership);
  const desiredPointers = listOwnedDocumentPointers(desiredOwnership);
  return desiredOwnership.createdContainers.flatMap((container, containerIndex) => {
    const ownsNewDescendant = desiredPointers.some(
      (pointer) => pointer.startsWith(`${container}/`) && !previousPointers.includes(pointer),
    );
    const isContainerStillNeeded = previousOwnership.createdContainers.includes(container) || ownsNewDescendant;

    if (isContainerStillNeeded) {
      return [];
    }

    return [
      {
        path: [...path, "ownership", "createdContainers", containerIndex],
        message: `Created JSON container ${container} requires a newly owned descendant pointer.`,
      },
    ];
  });
};

const installRequestIssues = (request: InstallPlanRequest): ReadonlyArray<ZodIssueDetail> => {
  const previousStatus = request.previous;
  const isPreviousReceipt = previousStatus._tag === "receipt";
  const previousFiles = isPreviousReceipt ? previousStatus.receipt.ownedFiles : [];
  const desiredFiles = request.desired.receipt.ownedFiles;
  const staleFiles = reverseFields(
    previousFiles.filter((previousFile) => !desiredFiles.some((file) => file.path === previousFile.path)),
  );
  const retainedFiles = desiredFiles.flatMap((file, index): ReadonlyArray<RetainedFile> => {
    const previous = previousFiles.find((candidate) => candidate.path === file.path);

    const isPreviousMissing = previous == null;
    return isPreviousMissing ? [] : [{ file, previous, path: ["desired", "receipt", "ownedFiles", index] }];
  });

  return [
    ...installScopeIssues(request),
    ...listRestorationConsistencyIssues(staleFiles, request.restorations),
    ...retainedFiles.flatMap(listOwnershipChangeIssues),
    ...retainedFiles.flatMap(listRetainedFileIssues),
    ...retainedFiles.flatMap(listDocumentContainerAcquisitionIssues),
    ...listReservedDesiredPathIssues(request),
  ];
};

const installScopeIssues = (request: InstallPlanRequest): ReadonlyArray<ZodIssueDetail> => {
  const isScopeMatching =
    request.previous._tag !== "receipt" || request.previous.receipt.scope === request.desired.receipt.scope;
  if (isScopeMatching) {
    return [];
  }

  return [{ path: ["previous", "receipt", "scope"], message: "Previous and desired receipt scopes must match." }];
};

const listReservedDesiredPathIssues = (request: InstallPlanRequest): ReadonlyArray<ZodIssueDetail> =>
  request.desired.receipt.ownedFiles.flatMap((file, index) => {
    const reservedPath = listReservedReceiptPaths(request.receiptTarget).find((path) =>
      isPathsConflict(file.path, path),
    );

    const isReservedPathMissing = reservedPath == null;
    if (isReservedPathMissing) {
      return [];
    }

    return [
      {
        path: ["desired", "receipt", "ownedFiles", index, "path"],
        message: `Desired file path ${file.path} conflicts with reserved path ${reservedPath}.`,
      },
    ];
  });

const installRequestSchema = z
  .strictObject({
    root: absoluteRootSchema,
    previous: previousReceiptSchema,
    restorations: z
      .array(plannedRestorationSchema)
      .describe("Exact final-action set for stale prior receipt entries; the planner owns operation order."),
    desired: desiredStatusSchema,
    receiptTarget: receiptTargetSchema,
    receiptExpectedCurrent: expectedCurrentSchema.describe(
      "Receipt target state captured during capability inspection.",
    ),
  })
  .superRefine((request, scope) => addZodIssueDetails(scope, installRequestIssues(request)));

type InstallPlanRequest = z.infer<typeof installRequestSchema>;

const uninstallRequestSchema = z
  .strictObject({
    root: absoluteRootSchema,
    receipt: receiptSchema,
    restorations: z
      .array(plannedRestorationSchema)
      .describe("Exact final-action set for every receipt entry; the planner owns operation order."),
    receiptTarget: receiptTargetSchema,
    receiptExpectedCurrent: expectedCurrentSchema.describe(
      "Receipt target state captured during capability inspection.",
    ),
  })
  .superRefine((request, scope) =>
    addZodIssueDetails(
      scope,
      listRestorationConsistencyIssues(reverseFields(request.receipt.ownedFiles), request.restorations),
    ),
  );

type UninstallPlanRequest = z.infer<typeof uninstallRequestSchema>;

const listPreservedContainers = (
  previous: DocumentPointerOwnership,
  desired: DocumentPointerOwnership,
): Array<string> => {
  const desiredPointers = listOwnedDocumentPointers(desired);

  return [
    ...previous.createdContainers.filter((container) =>
      desiredPointers.some((pointer) => pointer.startsWith(`${container}/`)),
    ),
    ...desired.createdContainers.filter((container) => !previous.createdContainers.includes(container)),
  ];
};

const readPreserveDocumentRestoration = (
  previous: DocumentFieldsOwnership,
  desired: DocumentFieldsOwnership,
): Ownership => ({
  ...desired,
  filePreviouslyPresent: previous.filePreviouslyPresent,
  createdContainers: listPreservedContainers(previous, desired),
  values: desired.values.map((field) => {
    const priorField = previous.values.find((candidate) => candidate.pointer === field.pointer);

    const isPriorFieldMissing = priorField == null;
    return isPriorFieldMissing ? field : { ...field, previous: priorField.previous };
  }),
});

// Whether each hook event array existed before agent-setup first owned it, from either settings receipt format.
const readPriorEventPresence = (previous: DocumentPointerOwnership): ReadonlyMap<string, boolean> => {
  const isPreviousDocumentValues = previous._tag === "jsonValues";
  return new Map(
    isPreviousDocumentValues
      ? previous.values.map((field) => [field.pointer, field.previous._tag === "value"])
      : previous.events.map((event) => [event.pointer, event.previouslyPresent]),
  );
};

const readPreserveHookEntriesRestoration = (
  previous: DocumentPointerOwnership,
  desired: HookEntriesOwnership,
): Ownership => {
  const presence = readPriorEventPresence(previous);

  return {
    ...desired,
    filePreviouslyPresent: previous.filePreviouslyPresent,
    createdContainers: listPreservedContainers(previous, desired),
    events: desired.events.map((event) => {
      const previouslyPresent = presence.get(event.pointer);

      const isPreviouslyPresentUnknown = previouslyPresent == null;
      return isPreviouslyPresentUnknown ? event : { ...event, previouslyPresent };
    }),
  };
};

const readPreserveYamlRestoration = (
  previous: YamlSequenceFieldOwnership,
  desired: YamlSequenceFieldOwnership,
): Ownership => {
  const isYamlFieldChanged = previous.key !== desired.key || previous.reference !== desired.reference;
  if (isYamlFieldChanged) {
    return { ...desired, filePreviouslyPresent: previous.filePreviouslyPresent };
  }

  return {
    ...desired,
    filePreviouslyPresent: previous.filePreviouslyPresent,
    insertedPrefix: previous.insertedPrefix,
    keyPreviouslyPresent: previous.keyPreviouslyPresent,
    previouslyPresent: previous.previouslyPresent,
  };
};

// A retained path keeps the restoration evidence from when it was first owned, not from this install.
const readPreserveRestoration = (previous: Ownership, desired: Ownership): Ownership => {
  const isWholeFileChange = previous._tag === "wholeFile" && desired._tag === "wholeFile";
  if (isWholeFileChange) {
    return { ...desired, previous: previous.previous };
  }

  const isDocumentValuesChange = previous._tag === "jsonValues" && desired._tag === "jsonValues";
  if (isDocumentValuesChange) {
    return readPreserveDocumentRestoration(previous, desired);
  }

  const previousDocumentOwnership = readDocumentPointerOwnership(previous);

  const isHookEntriesOverDocumentPointer = previousDocumentOwnership != null && desired._tag === "hookEntries";
  if (isHookEntriesOverDocumentPointer) {
    return readPreserveHookEntriesRestoration(previousDocumentOwnership, desired);
  }

  const isManagedBlockChange = previous._tag === "managedBlock" && desired._tag === "managedBlock";
  if (isManagedBlockChange) {
    return { ...desired, filePreviouslyPresent: previous.filePreviouslyPresent };
  }

  const isYamlSequencePair = previous._tag === "yamlSequenceValue" && desired._tag === "yamlSequenceValue";
  if (isYamlSequencePair) {
    return readPreserveYamlRestoration(previous, desired);
  }

  return desired;
};

const isInstalledOwnershipEqual = (left: Ownership, right: Ownership): boolean => {
  const isWholeFilePair = left._tag === "wholeFile" && right._tag === "wholeFile";
  if (isWholeFilePair) {
    return left.installedHash === right.installedHash;
  }

  const isManagedBlockPair = left._tag === "managedBlock" && right._tag === "managedBlock";
  if (isManagedBlockPair) {
    return (
      left.startMarker === right.startMarker &&
      left.endMarker === right.endMarker &&
      left.installedBodyHash === right.installedBodyHash
    );
  }

  const isDocumentValuesPair = left._tag === "jsonValues" && right._tag === "jsonValues";
  if (isDocumentValuesPair) {
    return (
      left.values.length === right.values.length &&
      left.values.every((field, index) => {
        const candidate = right.values[index];

        return (
          candidate != null &&
          field.pointer === candidate.pointer &&
          isDeepStrictEqual(field.installed, candidate.installed)
        );
      })
    );
  }

  const isHookEntriesPair = left._tag === "hookEntries" && right._tag === "hookEntries";
  if (isHookEntriesPair) {
    return (
      left.events.length === right.events.length &&
      left.events.every((event, index) => {
        const candidate = right.events[index];

        return (
          candidate != null &&
          event.pointer === candidate.pointer &&
          event.entries.join(",") === candidate.entries.join(",")
        );
      })
    );
  }

  const isYamlSequencePair = left._tag === "yamlSequenceValue" && right._tag === "yamlSequenceValue";
  if (isYamlSequencePair) {
    return left.key === right.key && left.reference === right.reference;
  }

  return false;
};

const isInstalledFilesEqual = (left: OwnedFile, right: OwnedFile): boolean =>
  left.path === right.path &&
  left.kind._tag === right.kind._tag &&
  isDeepStrictEqual(left.owner, right.owner) &&
  isInstalledOwnershipEqual(left.ownership, right.ownership);

const readWithPreservedRestoration = (desiredFile: OwnedFile, previousFiles: ReadonlyArray<OwnedFile>): OwnedFile => {
  const previousFile = previousFiles.find((file) => file.path === desiredFile.path);

  const isPreviousFileMissing = previousFile == null;
  if (isPreviousFileMissing) {
    return desiredFile;
  }

  return { ...desiredFile, ownership: readPreserveRestoration(previousFile.ownership, desiredFile.ownership) };
};

const planAcceptedInstall = (request: InstallPlanRequest): Plan => {
  const previousStatus = request.previous;
  const isPreviousReceipt = previousStatus._tag === "receipt";
  const previousFiles = isPreviousReceipt ? previousStatus.receipt.ownedFiles : [];
  const nextFiles = request.desired.receipt.ownedFiles.map((desiredFile) =>
    readWithPreservedRestoration(desiredFile, previousFiles),
  );
  const staleFiles = reverseFields(
    previousFiles.filter((previousFile) => !nextFiles.some((file) => file.path === previousFile.path)),
  );
  // Only writes whose installed state changes are emitted; unchanged files become preconditions.
  const changedWrites = request.desired.writes.flatMap((operation) =>
    nextFiles
      .filter((file) => file.path === operation.file.path)
      .flatMap((file) => {
        const previousFile = previousFiles.find((candidate) => candidate.path === file.path);

        const isPreviousFileEqual = previousFile != null && isInstalledFilesEqual(previousFile, file);
        return isPreviousFileEqual ? [] : [{ ...operation, file }];
      }),
  );
  const changedPaths = new Set(changedWrites.map((operation) => operation.file.path));
  const receipt = { ...request.desired.receipt, ownedFiles: nextFiles };

  return checkPlan({
    scope: receipt.scope,
    root: request.root,
    operations: [...orderRestorations(staleFiles, request.restorations), ...changedWrites],
    preconditions: request.desired.writes.flatMap((operation) => {
      const isPathChanged = changedPaths.has(operation.file.path);
      return isPathChanged ? [] : [{ path: operation.file.path, expectedCurrent: operation.expectedCurrent }];
    }),
    receipt: {
      _tag: "receiptPublish",
      target: request.receiptTarget,
      receipt,
      expectedCurrent: request.receiptExpectedCurrent,
    },
  });
};

const planAcceptedUninstall = (request: UninstallPlanRequest): Plan =>
  checkPlan({
    scope: request.receipt.scope,
    root: request.root,
    operations: orderRestorations(reverseFields(request.receipt.ownedFiles), request.restorations),
    preconditions: [],
    receipt: { _tag: "remove", target: request.receiptTarget, expectedCurrent: request.receiptExpectedCurrent },
  });

// Plans an install from the raw request, or throws one Error that lists every rejected field.
export const planInstall = (candidateRequest: unknown): Plan => {
  const requestCheck = installRequestSchema.safeParse(candidateRequest);

  const isRequestAccepted = requestCheck.success;
  if (isRequestAccepted) {
    return planAcceptedInstall(requestCheck.data);
  }

  throw new Error(joinZodIssueMessages(requestCheck.error));
};

// Plans an uninstall from the raw request, or throws one Error that lists every rejected field.
export const planUninstall = (candidateRequest: unknown): Plan => {
  const requestCheck = uninstallRequestSchema.safeParse(candidateRequest);

  const isRequestAccepted = requestCheck.success;
  if (isRequestAccepted) {
    return planAcceptedUninstall(requestCheck.data);
  }

  throw new Error(joinZodIssueMessages(requestCheck.error));
};
