import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import { addZodIssueDetails, joinZodIssueMessages, type ZodIssueDetail } from "../zod-issue-messages.js";
import {
  type HookEntriesOwnership,
  type JsonValuesOwnership,
  type OwnedFile,
  type Ownership,
  ownedFilesEqual,
  pathsConflict,
  type YamlSequenceValueOwnership,
} from "./ownership.js";
import {
  absoluteRootSchema,
  checkPlan,
  expectedCurrentSchema,
  type Plan,
  type PlannedRestoration,
  plannedRestorationSchema,
  plannedWriteOperationSchema,
  type Restoration,
  receiptTargetSchema,
  reservedReceiptPaths,
} from "./plan.js";
import { receiptSchema } from "./receipt.js";

const reverseValues = <Value>(values: ReadonlyArray<Value>): ReadonlyArray<Value> =>
  values.map((_, index) => values[values.length - index - 1]);

const restorationConsistencyIssues = (
  expectedFiles: ReadonlyArray<OwnedFile>,
  restorations: ReadonlyArray<Restoration>,
): ReadonlyArray<ZodIssueDetail> => [
  ...expectedFiles.flatMap((expectedFile) => {
    const matchingIndexes = restorations.flatMap((restoration, index) =>
      ownedFilesEqual(restoration.file, expectedFile) ? [index] : [],
    );
    if (matchingIndexes.length === 0) {
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
    const isPriorFile = expectedFiles.some((file) => ownedFilesEqual(restoration.file, file));
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
      expectedFiles.findIndex((file) => ownedFilesEqual(file, left.file)) -
      expectedFiles.findIndex((file) => ownedFilesEqual(file, right.file)),
  );

const previousReceiptSchema = z.discriminatedUnion("_tag", [
  z.strictObject({ _tag: z.literal("missing") }),
  z.strictObject({ _tag: z.literal("receipt"), receipt: receiptSchema }),
]);

const desiredWriteIssues = (desired: DesiredState): ReadonlyArray<ZodIssueDetail> =>
  desired.writes.flatMap((operation, index) => {
    const receiptFile = desired.receipt.ownedFiles.find((file) => file.path === operation.file.path);
    if (receiptFile != null && ownedFilesEqual(operation.file, receiptFile)) {
      return [];
    }

    return [
      {
        path: ["writes", index, "file"],
        message: "Every desired write must exactly match its desired receipt entry.",
      },
    ];
  });

const desiredReceiptEntryIssues = (desired: DesiredState): ReadonlyArray<ZodIssueDetail> =>
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

const desiredStateSchema = z
  .strictObject({
    receipt: receiptSchema,
    writes: z.array(plannedWriteOperationSchema),
  })
  .superRefine((desired, context) =>
    addZodIssueDetails(context, [...desiredWriteIssues(desired), ...desiredReceiptEntryIssues(desired)]),
  );

type DesiredState = z.infer<typeof desiredStateSchema>;

type RetainedFile = {
  readonly file: OwnedFile;
  readonly previous: OwnedFile;
  readonly path: ReadonlyArray<string | number>;
};

const retainedFileIssues = ({ file, previous, path }: RetainedFile): ReadonlyArray<ZodIssueDetail> => [
  ...(previous.kind._tag === file.kind._tag
    ? []
    : [
        {
          path: [...path, "kind"],
          message: `Cannot change file kind from ${previous.kind._tag} to ${file.kind._tag} at ${file.path}; remove the prior ownership first.`,
        },
      ]),
  ...(previous.owner._tag === file.owner._tag
    ? []
    : [
        {
          path: [...path, "owner"],
          message: `Cannot change file owner from ${previous.owner._tag} to ${file.owner._tag} at ${file.path}; remove the prior ownership first.`,
        },
      ]),
];

// Settings receipts from before entry ownership owned whole hook event arrays; the next install migrates them.
const ownershipChangeAllowed = ({ file, previous }: RetainedFile): boolean =>
  previous.ownership._tag === file.ownership._tag ||
  (file.kind._tag === "settings" && previous.ownership._tag === "jsonValues" && file.ownership._tag === "hookEntries");

const ownershipChangeIssues = (retained: RetainedFile): ReadonlyArray<ZodIssueDetail> => {
  const { file, previous, path } = retained;
  if (ownershipChangeAllowed(retained)) {
    return [];
  }

  return [
    {
      path: [...path, "ownership", "_tag"],
      message: `Cannot change ownership from ${previous.ownership._tag} to ${file.ownership._tag} at ${file.path}; remove the prior ownership first.`,
    },
  ];
};

type JsonPointerOwnership = JsonValuesOwnership | HookEntriesOwnership;

const ownedJsonPointers = (ownership: JsonPointerOwnership): ReadonlyArray<string> =>
  ownership._tag === "jsonValues"
    ? ownership.values.map((value) => value.pointer)
    : ownership.events.map((event) => event.pointer);

const jsonPointerOwnership = (ownership: Ownership): JsonPointerOwnership | undefined =>
  ownership._tag === "jsonValues" || ownership._tag === "hookEntries" ? ownership : undefined;

// A created container is deletion authority, so it may only be acquired together with a newly owned value inside it.
const jsonContainerAcquisitionIssues = ({ file, previous, path }: RetainedFile): ReadonlyArray<ZodIssueDetail> => {
  const previousOwnership = jsonPointerOwnership(previous.ownership);
  const desiredOwnership = jsonPointerOwnership(file.ownership);
  if (previousOwnership == null || desiredOwnership == null) {
    return [];
  }

  const previousPointers = ownedJsonPointers(previousOwnership);
  const desiredPointers = ownedJsonPointers(desiredOwnership);
  return desiredOwnership.createdContainers.flatMap((container, containerIndex) => {
    const ownsNewDescendant = desiredPointers.some(
      (pointer) => pointer.startsWith(`${container}/`) && !previousPointers.includes(pointer),
    );
    if (previousOwnership.createdContainers.includes(container) || ownsNewDescendant) {
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
  const previousFiles = request.previous._tag === "receipt" ? request.previous.receipt.ownedFiles : [];
  const desiredFiles = request.desired.receipt.ownedFiles;
  const staleFiles = reverseValues(
    previousFiles.filter((previousFile) => !desiredFiles.some((file) => file.path === previousFile.path)),
  );
  const retainedFiles = desiredFiles.flatMap((file, index): ReadonlyArray<RetainedFile> => {
    const previous = previousFiles.find((candidate) => candidate.path === file.path);
    return previous == null ? [] : [{ file, previous, path: ["desired", "receipt", "ownedFiles", index] }];
  });

  return [
    ...installScopeIssues(request),
    ...restorationConsistencyIssues(staleFiles, request.restorations),
    ...retainedFiles.flatMap(ownershipChangeIssues),
    ...retainedFiles.flatMap(retainedFileIssues),
    ...retainedFiles.flatMap(jsonContainerAcquisitionIssues),
    ...reservedDesiredPathIssues(request),
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

const reservedDesiredPathIssues = (request: InstallPlanRequest): ReadonlyArray<ZodIssueDetail> =>
  request.desired.receipt.ownedFiles.flatMap((file, index) => {
    const reservedPath = reservedReceiptPaths(request.receiptTarget).find((path) => pathsConflict(file.path, path));
    if (reservedPath == null) {
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
    desired: desiredStateSchema,
    receiptTarget: receiptTargetSchema,
    receiptExpectedCurrent: expectedCurrentSchema.describe(
      "Receipt target state captured during capability inspection.",
    ),
  })
  .superRefine((request, context) => addZodIssueDetails(context, installRequestIssues(request)));

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
  .superRefine((request, context) =>
    addZodIssueDetails(
      context,
      restorationConsistencyIssues(reverseValues(request.receipt.ownedFiles), request.restorations),
    ),
  );

type UninstallPlanRequest = z.infer<typeof uninstallRequestSchema>;

const preservedContainers = (previous: JsonPointerOwnership, desired: JsonPointerOwnership): Array<string> => {
  const desiredPointers = ownedJsonPointers(desired);

  return [
    ...previous.createdContainers.filter((container) =>
      desiredPointers.some((pointer) => pointer.startsWith(`${container}/`)),
    ),
    ...desired.createdContainers.filter((container) => !previous.createdContainers.includes(container)),
  ];
};

const preserveJsonRestoration = (previous: JsonValuesOwnership, desired: JsonValuesOwnership): Ownership => ({
  ...desired,
  filePreviouslyPresent: previous.filePreviouslyPresent,
  createdContainers: preservedContainers(previous, desired),
  values: desired.values.map((value) => {
    const priorValue = previous.values.find((candidate) => candidate.pointer === value.pointer);

    return priorValue == null ? value : { ...value, previous: priorValue.previous };
  }),
});

// Whether each hook event array existed before agent-setup first owned it, from either settings receipt format.
const priorEventPresence = (previous: JsonPointerOwnership): ReadonlyMap<string, boolean> =>
  new Map(
    previous._tag === "jsonValues"
      ? previous.values.map((value) => [value.pointer, value.previous._tag === "value"])
      : previous.events.map((event) => [event.pointer, event.previouslyPresent]),
  );

const preserveHookEntriesRestoration = (previous: JsonPointerOwnership, desired: HookEntriesOwnership): Ownership => {
  const presence = priorEventPresence(previous);

  return {
    ...desired,
    filePreviouslyPresent: previous.filePreviouslyPresent,
    createdContainers: preservedContainers(previous, desired),
    events: desired.events.map((event) => {
      const previouslyPresent = presence.get(event.pointer);

      return previouslyPresent == null ? event : { ...event, previouslyPresent };
    }),
  };
};

const preserveYamlRestoration = (
  previous: YamlSequenceValueOwnership,
  desired: YamlSequenceValueOwnership,
): Ownership => {
  const isYamlValueChanged = previous.key !== desired.key || previous.reference !== desired.reference;
  if (isYamlValueChanged) {
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
const preserveRestoration = (previous: Ownership, desired: Ownership): Ownership => {
  if (previous._tag === "wholeFile" && desired._tag === "wholeFile") {
    return { ...desired, previous: previous.previous };
  }

  if (previous._tag === "jsonValues" && desired._tag === "jsonValues") {
    return preserveJsonRestoration(previous, desired);
  }

  const previousJsonOwnership = jsonPointerOwnership(previous);
  const isHookEntriesOverJsonPointer = previousJsonOwnership != null && desired._tag === "hookEntries";
  if (isHookEntriesOverJsonPointer) {
    return preserveHookEntriesRestoration(previousJsonOwnership, desired);
  }

  if (previous._tag === "managedBlock" && desired._tag === "managedBlock") {
    return { ...desired, filePreviouslyPresent: previous.filePreviouslyPresent };
  }

  const isYamlSequencePair = previous._tag === "yamlSequenceValue" && desired._tag === "yamlSequenceValue";
  if (isYamlSequencePair) {
    return preserveYamlRestoration(previous, desired);
  }

  return desired;
};

const installedOwnershipEqual = (left: Ownership, right: Ownership): boolean => {
  if (left._tag === "wholeFile" && right._tag === "wholeFile") {
    return left.installedHash === right.installedHash;
  }

  if (left._tag === "managedBlock" && right._tag === "managedBlock") {
    return (
      left.startMarker === right.startMarker &&
      left.endMarker === right.endMarker &&
      left.installedBodyHash === right.installedBodyHash
    );
  }

  if (left._tag === "jsonValues" && right._tag === "jsonValues") {
    return (
      left.values.length === right.values.length &&
      left.values.every((value, index) => {
        const candidate = right.values[index];

        return (
          candidate != null &&
          value.pointer === candidate.pointer &&
          isDeepStrictEqual(value.installed, candidate.installed)
        );
      })
    );
  }

  if (left._tag === "hookEntries" && right._tag === "hookEntries") {
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

  if (left._tag === "yamlSequenceValue" && right._tag === "yamlSequenceValue") {
    return left.key === right.key && left.reference === right.reference;
  }

  return false;
};

const installedFilesEqual = (left: OwnedFile, right: OwnedFile): boolean =>
  left.path === right.path &&
  left.kind._tag === right.kind._tag &&
  isDeepStrictEqual(left.owner, right.owner) &&
  installedOwnershipEqual(left.ownership, right.ownership);

const withPreservedRestoration = (desiredFile: OwnedFile, previousFiles: ReadonlyArray<OwnedFile>): OwnedFile => {
  const previousFile = previousFiles.find((file) => file.path === desiredFile.path);
  if (previousFile == null) {
    return desiredFile;
  }

  return { ...desiredFile, ownership: preserveRestoration(previousFile.ownership, desiredFile.ownership) };
};

const planAcceptedInstall = (request: InstallPlanRequest): Plan => {
  const previousFiles = request.previous._tag === "receipt" ? request.previous.receipt.ownedFiles : [];
  const nextFiles = request.desired.receipt.ownedFiles.map((desiredFile) =>
    withPreservedRestoration(desiredFile, previousFiles),
  );
  const staleFiles = reverseValues(
    previousFiles.filter((previousFile) => !nextFiles.some((file) => file.path === previousFile.path)),
  );
  // Only writes whose installed state changes are emitted; unchanged files become preconditions.
  const changedWrites = request.desired.writes.flatMap((operation) =>
    nextFiles
      .filter((file) => file.path === operation.file.path)
      .flatMap((file) => {
        const previousFile = previousFiles.find((candidate) => candidate.path === file.path);

        return previousFile != null && installedFilesEqual(previousFile, file) ? [] : [{ ...operation, file }];
      }),
  );
  const changedPaths = new Set(changedWrites.map((operation) => operation.file.path));
  const receipt = { ...request.desired.receipt, ownedFiles: nextFiles };

  return checkPlan({
    scope: receipt.scope,
    root: request.root,
    operations: [...orderRestorations(staleFiles, request.restorations), ...changedWrites],
    preconditions: request.desired.writes.flatMap((operation) =>
      changedPaths.has(operation.file.path)
        ? []
        : [{ path: operation.file.path, expectedCurrent: operation.expectedCurrent }],
    ),
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
    operations: orderRestorations(reverseValues(request.receipt.ownedFiles), request.restorations),
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
