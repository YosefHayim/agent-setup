import type { PlatformPath } from "node:path";

import { z } from "zod";

import type { AgentDefinition } from "#src/catalog/agent-catalog.js";
import { featureCatalog } from "#src/catalog/feature-catalog.js";
import { joinZodIssueMessages } from "#src/zod-issue-messages.js";
import { decodeStrictString } from "./file-bytes.js";
import { findDuplicateJsonKey } from "./find-duplicate-json-key.js";
import { applicationOwner, checkFileChange, type FileSnapshot, readExpectedCurrent } from "./host-files.js";
import { settingsPath } from "./install-paths.js";
import { createInstallError, readErrorMessage } from "./install-request.js";
import {
  appendDocumentArrayElement,
  editDocumentField,
  hashDocumentField,
  removeDocumentArrayElement,
  removeDocumentField,
} from "./json-edit.js";
import type { HookLinesOwnership, OwnedDocumentField, OwnedFile, OwnedHookEvent } from "./ownership.js";
import { readInstalledHookFile, readRegistrationEntrypoint } from "./package-files.js";
import type { FileChange } from "./plan.js";

const SETTINGS_FILE_NAME = "settings.json";
const GENERATED_SETTINGS_LABEL = "Generated settings.json";
const HOOKS_KEY = "hooks";
const HOOKS_CONTAINER_POINTER = "/hooks";
const HOOKS_POINTER_PREFIX = "/hooks/";
const CLAUDE_CODE_AGENT_ID = "claude-code";

const stringEncoder = new TextEncoder();

const settingsDocumentSchema = z.looseObject({
  hooks: z.record(z.string(), z.array(z.unknown())).optional(),
});

type SettingsDocument = z.infer<typeof settingsDocumentSchema>;

// The settings text is kept beside the parsed document so every edit preserves the user's bytes.
export interface DecodedSettings {
  readonly documentString: string;
  readonly document: SettingsDocument;
}

interface HookSettingsEdit extends DecodedSettings {
  readonly events: ReadonlyArray<OwnedHookEvent>;
  readonly createdContainers: ReadonlyArray<string>;
}

const parseSettingsDocument = (settingsString: string, label: string): unknown => {
  try {
    return JSON.parse(settingsString);
  } catch (error) {
    throw createInstallError(`${label} is invalid: ${readErrorMessage(error)}`);
  }
};

const parseSettings = (settingsString: string, label: string): SettingsDocument => {
  const parsedDocument = parseSettingsDocument(settingsString, label);
  const settingsReply = settingsDocumentSchema.safeParse(parsedDocument);

  const isSettingsInvalid = !settingsReply.success;
  if (isSettingsInvalid) {
    throw createInstallError(`${label} is invalid: ${joinZodIssueMessages(settingsReply.error)}`);
  }

  return settingsReply.data;
};

export const decodeSettings = (snapshot: FileSnapshot): DecodedSettings => {
  const isSettingsMissing = snapshot._tag === "missing";
  if (isSettingsMissing) {
    return { documentString: "{}\n", document: {} };
  }

  const stringReply = decodeStrictString(snapshot.bytes, SETTINGS_FILE_NAME);

  const isStringInvalid = stringReply._tag === "invalid";
  if (isStringInvalid) {
    throw createInstallError(stringReply.message);
  }

  const documentString = stringReply.fileContents;
  const duplicateProperty = findDuplicateJsonKey(documentString);

  const isPropertyDuplicated = duplicateProperty != null;
  if (isPropertyDuplicated) {
    throw createInstallError(
      `${SETTINGS_FILE_NAME} contains duplicate JSON property ${JSON.stringify(duplicateProperty)}.`,
    );
  }

  return { documentString, document: parseSettings(documentString, SETTINGS_FILE_NAME) };
};

const readHookEventFromPointer = (pointer: string): string | null => {
  const isHookPointer = pointer.startsWith(HOOKS_POINTER_PREFIX);
  const event = pointer.slice(HOOKS_POINTER_PREFIX.length);
  const isDirectHookEvent = isHookPointer && !event.includes("/");

  return isDirectHookEvent ? event : null;
};

const readGroupsAtPointer = (document: SettingsDocument, pointer: string): ReadonlyArray<unknown> | null => {
  const event = readHookEventFromPointer(pointer);
  const isEventNamed = event != null;

  return isEventNamed ? (document.hooks?.[event] ?? null) : null;
};

const readEventNames = (ownedEvents: ReadonlyArray<OwnedHookEvent>): string[] =>
  ownedEvents.flatMap((owned) => {
    const event = readHookEventFromPointer(owned.pointer);
    const isEventNamed = event != null;

    return isEventNamed ? [event] : [];
  });

const decodeHookGroups = (field: unknown, event: string): ReadonlyArray<unknown> => {
  const isGroupList = Array.isArray(field);
  if (isGroupList) {
    return field;
  }

  throw createInstallError(`${SETTINGS_FILE_NAME} hook event ${event} must contain an array.`);
};

const createChangedLinesError = ({ filePath, pointer }: { filePath: string; pointer: string }): Error =>
  createInstallError(`Receipted hook entries in ${filePath} ${pointer} changed after installation.`);

const hashGroups = (groups: ReadonlyArray<unknown>): string[] => groups.map((group) => hashDocumentField(group));

// Receipts written before entry ownership hashed a whole event array: the user's groups, then agent-setup's.
// That installed array is still the start of the current one when other tools only appended entries since.
const migrateLegacyEvent = ({
  filePath,
  ownedField,
  document,
}: {
  filePath: string;
  ownedField: OwnedDocumentField;
  document: SettingsDocument;
}): OwnedHookEvent => {
  const { pointer, previous, installed } = ownedField;
  const event = readHookEventFromPointer(pointer);
  const isEventNamed = event != null;
  const current = readGroupsAtPointer(document, pointer);

  const isCurrentMissing = !isEventNamed || current == null;
  if (isCurrentMissing) {
    throw createChangedLinesError({ filePath, pointer });
  }

  const isUserFieldPresent = previous._tag === "value";
  const userGroups = isUserFieldPresent ? decodeHookGroups(previous.value, event) : [];
  const prefixLengths = Array.from(
    { length: current.length - userGroups.length + 1 },
    (_, offset) => current.length - offset,
  );
  const installedLength = prefixLengths.find((length) => {
    const installedPrefix = current.slice(0, length);

    return hashDocumentField(installedPrefix) === installed.hash;
  });

  const isInstalledPrefixMissing = installedLength == null;
  if (isInstalledPrefixMissing) {
    throw createChangedLinesError({ filePath, pointer });
  }

  const ownedGroups = current.slice(userGroups.length, installedLength);

  return { pointer, previouslyPresent: isUserFieldPresent, entries: hashGroups(ownedGroups) };
};

// Reads the entries the receipt says agent-setup owns in one settings file, migrating the older whole-array layout.
const readPreviousHookLines = ({
  file,
  document,
}: {
  file: OwnedFile;
  document: SettingsDocument;
}): HookLinesOwnership => {
  const { ownership } = file;
  switch (ownership._tag) {
    case "hookEntries":
      return ownership;
    case "jsonValues":
      return {
        _tag: "hookEntries",
        filePreviouslyPresent: ownership.filePreviouslyPresent,
        createdContainers: ownership.createdContainers,
        events: ownership.values.map((ownedField) => migrateLegacyEvent({ filePath: file.path, ownedField, document })),
      };
    case "wholeFile":
    case "managedBlock":
    case "yamlSequenceValue":
      throw createInstallError(`Receipted settings entry ${file.path} has invalid ownership ${ownership._tag}.`);
  }
};

const countOf = (hashes: ReadonlyArray<string>, hash: string): number =>
  hashes.filter((candidate) => candidate === hash).length;

// Only agent-setup's own entries are checked, so entries other tools add to the same event never count as drift.
const isOwnedEventPresent = ({ event, document }: { event: OwnedHookEvent; document: SettingsDocument }): boolean => {
  const currentGroups = readGroupsAtPointer(document, event.pointer);

  const isCurrentMissing = currentGroups == null;
  if (isCurrentMissing) {
    return false;
  }

  const currentHashes = hashGroups(currentGroups);

  return event.entries.every((hash) => countOf(currentHashes, hash) >= countOf(event.entries, hash));
};

const validateOwnedLines = ({
  filePath,
  ownership,
  document,
}: {
  filePath: string;
  ownership: HookLinesOwnership | null;
  document: SettingsDocument;
}): void => {
  const changedEvent = ownership?.events.find((event) => !isOwnedEventPresent({ event, document }));

  const isEventChanged = changedEvent != null;
  if (isEventChanged) {
    throw createChangedLinesError({ filePath, pointer: changedEvent.pointer });
  }
};

// The nth occurrence of a hash is extra when the baseline holds fewer of it, e.g. [a, a, b] over [a] → a, b.
const isExtraOccurrence = ({
  hashes,
  index,
  baseline,
}: {
  hashes: ReadonlyArray<string>;
  index: number;
  baseline: ReadonlyArray<string>;
}): boolean => {
  const hash = hashes[index];

  const isHashMissing = hash == null;
  if (isHashMissing) {
    return false;
  }

  const seen = hashes.slice(0, index + 1);

  return countOf(seen, hash) > countOf(baseline, hash);
};

const applyEdits = <Change>({
  documentString,
  changes,
  edit,
}: {
  documentString: string;
  changes: ReadonlyArray<Change>;
  edit: (currentDocumentString: string, change: Change) => string;
}): string => changes.reduce((editedDocumentString, change) => edit(editedDocumentString, change), documentString);

interface HookCommand {
  readonly type: "command";
  readonly command: string;
  readonly async?: true;
}

interface ManagedHookGroup {
  readonly matcher?: string;
  readonly hooks: readonly [HookCommand];
}

interface HookEventPlan {
  readonly event: string;
  readonly current: ReadonlyArray<unknown> | null;
  readonly owned: OwnedHookEvent | null;
  readonly desired: ReadonlyArray<ManagedHookGroup>;
}

const isEventPreviouslyPresent = (plan: HookEventPlan): boolean => {
  const hasNoOwnedEvent = plan.owned == null;
  if (hasNoOwnedEvent) {
    return plan.current != null;
  }

  return plan.owned.previouslyPresent;
};

const listOwnedHookEvents = (plan: HookEventPlan): OwnedHookEvent[] => {
  const desiredHashes = hashGroups(plan.desired);

  const isNothingDesired = desiredHashes.length === 0;
  if (isNothingDesired) {
    return [];
  }

  return [
    {
      pointer: `${HOOKS_POINTER_PREFIX}${plan.event}`,
      previouslyPresent: isEventPreviouslyPresent(plan),
      entries: desiredHashes,
    },
  ];
};

// Removes agent-setup's stale entries and appends its new ones; every other entry in the array keeps its bytes.
const editHookEvent = ({ documentString, plan }: { documentString: string; plan: HookEventPlan }): string => {
  const { event, current, owned, desired } = plan;
  const path = [HOOKS_KEY, event];
  const isEventNew = current == null;

  const isNothingDesired = desired.length === 0;

  const isEmptyNewEvent = isEventNew && isNothingDesired;
  if (isEmptyNewEvent) {
    return documentString;
  }

  if (isEventNew) {
    return editDocumentField({ document: documentString, path, newField: desired });
  }

  const ownedHashes = owned?.entries ?? [];
  const desiredHashes = hashGroups(desired);
  const currentHashes = hashGroups(current);
  const staleHashes = ownedHashes.filter((_, index) =>
    isExtraOccurrence({ hashes: ownedHashes, index, baseline: desiredHashes }),
  );

  // The last occurrence of each stale hash goes, highest index first so the lower indexes stay valid.
  const staleIndexes = currentHashes
    .flatMap((hash, index) => {
      const laterHashes = currentHashes.slice(index + 1);
      const isStaleHashAtIndex = countOf(laterHashes, hash) < countOf(staleHashes, hash);

      return isStaleHashAtIndex ? [index] : [];
    })
    .reverse();
  const addedGroups = desired.filter((_, index) =>
    isExtraOccurrence({ hashes: desiredHashes, index, baseline: ownedHashes }),
  );

  const withoutStale = applyEdits({
    documentString,
    changes: staleIndexes,
    edit: (editedDocumentString, index) => removeDocumentArrayElement({ document: editedDocumentString, path, index }),
  });
  const withAdded = applyEdits({
    documentString: withoutStale,
    changes: addedGroups,
    edit: (editedDocumentString, group) =>
      appendDocumentArrayElement({ document: editedDocumentString, path, newElement: group }),
  });

  const remainingGroupCount = current.length - staleIndexes.length + addedGroups.length;

  const isCreatedEventEmptied = remainingGroupCount === 0 && !isEventPreviouslyPresent(plan);
  if (isCreatedEventEmptied) {
    return removeDocumentField({ document: withAdded, path });
  }

  return withAdded;
};

const addEmptyHooksContainer = (documentString: string): string =>
  editDocumentField({ document: documentString, path: [HOOKS_KEY], newField: {} });

// A hooks object agent-setup created goes again once it is empty; a user's own empty hooks object stays.
const removeEmptyCreatedHooks = ({
  documentString,
  isHooksContainerOwned,
}: {
  documentString: string;
  isHooksContainerOwned: boolean;
}): DecodedSettings => {
  const document = parseSettings(documentString, GENERATED_SETTINGS_LABEL);
  const hooks = document.hooks;

  const isHooksKept = !isHooksContainerOwned || hooks == null || Object.keys(hooks).length > 0;
  if (isHooksKept) {
    return { documentString, document };
  }

  const documentStringWithoutHooks = removeDocumentField({ document: documentString, path: [HOOKS_KEY] });

  return {
    documentString: documentStringWithoutHooks,
    document: parseSettings(documentStringWithoutHooks, GENERATED_SETTINGS_LABEL),
  };
};

// A command that points into the installed hooks folder is agent-setup's, whether its path is the old camelCase one or the current one.
const isInstalledHookGroup = (group: unknown, installedHooksFolder: string): boolean =>
  JSON.stringify(group).includes(`${installedHooksFolder}/`);

// Installed groups that no receipt lists (a lost receipt, or an older layout) join the receipted hashes, so the edit replaces them.
const listOwnInstalledGroups = ({
  receiptEvents,
  hooks,
  installedHooksFolder,
}: {
  receiptEvents: ReadonlyArray<OwnedHookEvent>;
  hooks: Record<string, ReadonlyArray<unknown>> | undefined;
  installedHooksFolder: string;
}): OwnedHookEvent[] => {
  const isInstalled = (group: unknown): boolean => isInstalledHookGroup(group, installedHooksFolder);
  const receiptEventNames = readEventNames(receiptEvents);
  const installedEventNames = Object.entries(hooks ?? {})
    .filter(([, groups]) => groups.some(isInstalled))
    .map(([event]) => event);
  const eventNames = [...new Set([...receiptEventNames, ...installedEventNames])];

  return eventNames.flatMap((event): OwnedHookEvent[] => {
    const receiptEvent = receiptEvents.find((owned) => owned.pointer === `${HOOKS_POINTER_PREFIX}${event}`) ?? null;
    const groups = hooks?.[event] ?? [];
    const installedHashes = hashGroups(groups.filter(isInstalled));
    const unlistedHashes = installedHashes.filter((_, index) =>
      isExtraOccurrence({ hashes: installedHashes, index, baseline: receiptEvent?.entries ?? [] }),
    );

    const hasReceiptEvent = receiptEvent != null;
    if (hasReceiptEvent) {
      return [{ ...receiptEvent, entries: [...receiptEvent.entries, ...unlistedHashes] }];
    }

    const isThereNoUnlistedGroup = unlistedHashes.length === 0;
    if (isThereNoUnlistedGroup) {
      return [];
    }

    const hasForeignGroups = groups.some((group) => !isInstalled(group));

    return [
      { pointer: `${HOOKS_POINTER_PREFIX}${event}`, previouslyPresent: hasForeignGroups, entries: unlistedHashes },
    ];
  });
};

const editHookSettings = ({
  filePath,
  decoded,
  previous,
  desiredGroups,
  installedHooksFolder,
}: {
  filePath: string;
  decoded: DecodedSettings;
  previous: HookLinesOwnership | null;
  desiredGroups: ReadonlyMap<string, ReadonlyArray<ManagedHookGroup>>;
  installedHooksFolder: string;
}): HookSettingsEdit => {
  const { document } = decoded;
  validateOwnedLines({ filePath, ownership: previous, document });

  // Events agent-setup no longer wants are edited first, newest first, then every desired event.
  const receiptEvents = previous?.events ?? [];
  const ownedEvents = listOwnInstalledGroups({ receiptEvents, hooks: document.hooks, installedHooksFolder });
  const previousEventNames = readEventNames(ownedEvents);
  const removedEventNames = previousEventNames.filter((event) => !desiredGroups.has(event)).reverse();
  const eventNames = [...new Set([...removedEventNames, ...desiredGroups.keys()])];
  const plans = eventNames.map(
    (event): HookEventPlan => ({
      event,
      current: document.hooks?.[event] ?? null,
      owned: ownedEvents.find((owned) => owned.pointer === `${HOOKS_POINTER_PREFIX}${event}`) ?? null,
      desired: desiredGroups.get(event) ?? [],
    }),
  );

  const isHooksMissing = document.hooks == null;
  const isHooksContainerCreated = isHooksMissing && desiredGroups.size > 0;
  const isHooksContainerReceipted = previous?.createdContainers.includes(HOOKS_CONTAINER_POINTER) ?? false;
  const isHooksContainerOwned = isHooksContainerReceipted || isHooksContainerCreated;

  const documentStringWithContainer = isHooksContainerCreated
    ? addEmptyHooksContainer(decoded.documentString)
    : decoded.documentString;
  const withEvents = applyEdits({
    documentString: documentStringWithContainer,
    changes: plans,
    edit: (editedDocumentString, plan) => editHookEvent({ documentString: editedDocumentString, plan }),
  });
  const settingsWithoutEmptyHooks = removeEmptyCreatedHooks({ documentString: withEvents, isHooksContainerOwned });

  return {
    documentString: settingsWithoutEmptyHooks.documentString,
    document: settingsWithoutEmptyHooks.document,
    events: plans.flatMap(listOwnedHookEvents),
    createdContainers: isHooksContainerOwned ? [HOOKS_CONTAINER_POINTER] : [],
  };
};

// A file agent-setup created and left empty is removed; anything else keeps its remaining user bytes.
const restoreOrRemove = ({
  file,
  documentString,
  document,
  snapshot,
  filePreviouslyPresent,
}: {
  file: OwnedFile;
  documentString: string;
  document: SettingsDocument;
  snapshot: FileSnapshot;
  filePreviouslyPresent: boolean;
}) => {
  const isEmptyCreatedFile = !filePreviouslyPresent && Object.keys(document).length === 0;
  if (isEmptyCreatedFile) {
    return {
      _tag: "remove",
      file,
      unownedBytes: new Uint8Array(),
      expectedCurrent: readExpectedCurrent(snapshot),
    };
  }

  return {
    _tag: "restore",
    file,
    bytes: stringEncoder.encode(documentString),
    expectedCurrent: readExpectedCurrent(snapshot),
  };
};

// Codex and Grok document no SubagentStop event, so only Claude Code gets it.
const isEventSupportedBy = (event: string, agent: AgentDefinition): boolean =>
  event !== "SubagentStop" || agent.id === CLAUDE_CODE_AGENT_ID;

export const readDesiredHookGroups = ({
  root,
  featureIds,
  selectedAgents,
  agent,
  path,
}: {
  root: string;
  featureIds: ReadonlyArray<string>;
  selectedAgents: ReadonlyArray<AgentDefinition>;
  agent: AgentDefinition;
  path: Pick<PlatformPath, "join">;
}): Map<string, ManagedHookGroup[]> => {
  const groups = new Map<string, ManagedHookGroup[]>();
  const isAgentSelected = selectedAgents.some((selectedAgent) => selectedAgent.id === agent.id);
  const isAgentWithoutHooks = agent.nativeHooks._tag === "unsupported";

  const isAgentSkipped = !isAgentSelected || isAgentWithoutHooks;
  if (isAgentSkipped) {
    return groups;
  }

  for (const feature of featureCatalog) {
    const featureRuntime = feature.runtime;

    const isFeatureSkipped = !featureIds.includes(feature.id) || featureRuntime._tag === "none";
    if (isFeatureSkipped) {
      continue;
    }

    for (const registration of featureRuntime.registrations) {
      const isEventUnsupported = !isEventSupportedBy(registration.event, agent);
      if (isEventUnsupported) {
        continue;
      }

      const entrypoint = readInstalledHookFile(
        feature.sourceDirectory,
        readRegistrationEntrypoint(featureRuntime, registration),
      );
      const runtimeCommand = `node "${path.join(root, entrypoint)}"`;
      const doesReadAgentId = registration.readsAgentId === true;
      const command = doesReadAgentId ? `AGENT_SETUP_AGENT_ID=${agent.id} ${runtimeCommand}` : runtimeCommand;
      const isBackgroundHook = registration.runsInBackground === true && agent.id === CLAUDE_CODE_AGENT_ID;
      const matcher = registration.matcher;
      const hasMatcherPattern = matcher._tag === "pattern";
      const group: ManagedHookGroup = {
        ...(hasMatcherPattern ? { matcher: matcher.value } : {}),
        hooks: [{ type: "command", command, ...(isBackgroundHook ? { async: true as const } : {}) }],
      };

      groups.set(registration.event, [...(groups.get(registration.event) ?? []), group]);
    }
  }

  return groups;
};

export const planSettings = ({
  filePath: requestedFilePath,
  snapshot,
  decoded,
  previousFile,
  desiredGroups,
  installedHooksFolder,
}: {
  filePath?: string;
  snapshot: FileSnapshot;
  decoded: DecodedSettings;
  previousFile: OwnedFile | null;
  desiredGroups: ReadonlyMap<string, ReadonlyArray<ManagedHookGroup>>;
  installedHooksFolder: string;
}): FileChange | null => {
  const filePath = requestedFilePath ?? settingsPath;

  const isPreviousFileWrong =
    previousFile != null &&
    (previousFile.path !== filePath ||
      previousFile.kind._tag !== "settings" ||
      previousFile.owner._tag !== "application");
  if (isPreviousFileWrong) {
    throw createInstallError("Receipted settings entry must keep its exact path, kind, and application owner.");
  }

  const isPreviousFileRemoved = previousFile != null && snapshot._tag === "missing";
  if (isPreviousFileRemoved) {
    throw createInstallError(`Receipted ${SETTINGS_FILE_NAME} was removed after installation.`);
  }

  const isReceiptPresent = previousFile != null;
  const previousOwnership = isReceiptPresent
    ? readPreviousHookLines({ file: previousFile, document: decoded.document })
    : null;
  const edited = editHookSettings({
    filePath,
    decoded,
    previous: previousOwnership,
    desiredGroups,
    installedHooksFolder,
  });
  const { documentString, document, events, createdContainers } = edited;

  const isReceiptedFileEmptied = events.length === 0 && previousFile != null && previousOwnership != null;
  if (isReceiptedFileEmptied) {
    const restoration = restoreOrRemove({
      file: previousFile,
      documentString,
      document,
      snapshot,
      filePreviouslyPresent: previousOwnership.filePreviouslyPresent,
    });

    return checkFileChange(restoration);
  }

  const isSettingsUnchanged = documentString === decoded.documentString;
  const hasNoHookEvent = events.length === 0;

  const isNothingToWrite = hasNoHookEvent && isSettingsUnchanged;
  if (isNothingToWrite) {
    return null;
  }

  const wasFilePresent = snapshot._tag === "file";
  const hasNoPreviousOwnership = previousOwnership == null;
  const ownership: HookLinesOwnership = {
    _tag: "hookEntries",
    filePreviouslyPresent: hasNoPreviousOwnership ? wasFilePresent : previousOwnership.filePreviouslyPresent,
    createdContainers: [...createdContainers],
    events: [...events],
  };

  return checkFileChange({
    _tag: "write",
    file: { owner: applicationOwner, path: filePath, kind: { _tag: "settings" }, ownership },
    bytes: stringEncoder.encode(documentString),
    expectedCurrent: readExpectedCurrent(snapshot),
  });
};

export const restoreSettings = ({
  file,
  snapshot,
  installedHooksFolder,
}: {
  file: OwnedFile;
  snapshot: FileSnapshot;
  installedHooksFolder: string;
}): FileChange => {
  const isInvalidOwnership = file.kind._tag !== "settings" || file.owner._tag !== "application";
  if (isInvalidOwnership) {
    throw createInstallError(`Settings restoration for ${file.path} has invalid ownership.`);
  }

  const isSnapshotMissing = snapshot._tag === "missing";
  if (isSnapshotMissing) {
    throw createInstallError(`Receipted settings file ${file.path} was removed after installation.`);
  }

  const decoded = decodeSettings(snapshot);
  const previous = readPreviousHookLines({ file, document: decoded.document });
  const edited = editHookSettings({
    filePath: file.path,
    decoded,
    previous,
    desiredGroups: new Map(),
    installedHooksFolder,
  });
  const restoration = restoreOrRemove({
    file,
    documentString: edited.documentString,
    document: edited.document,
    snapshot,
    filePreviouslyPresent: previous.filePreviouslyPresent,
  });

  return checkFileChange(restoration);
};
