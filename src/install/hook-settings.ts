import type { PlatformPath } from "node:path";

import { z } from "zod";

import type { AgentDefinition } from "../catalog/agent-catalog.js";
import { featureCatalog } from "../catalog/feature-catalog.js";
import { joinZodIssueMessages } from "../zod-issue-messages.js";
import { decodeStrictText } from "./file-bytes.js";
import { findDuplicateJsonKey } from "./find-duplicate-json-key.js";
import { applicationOwner, checkFileChange, expectedCurrent, type FileSnapshot } from "./host-files.js";
import { settingsPath } from "./install-paths.js";
import { createInstallError, readErrorMessage } from "./install-request.js";
import { appendJsonArrayItem, editJsonValue, hashJsonValue, removeJsonArrayItem } from "./json-edit.js";
import type { HookEntriesOwnership, OwnedFile, OwnedHookEvent, OwnedJsonValue } from "./ownership.js";
import { installedHookFile, registrationEntrypoint } from "./package-files.js";
import type { FileChange } from "./plan.js";

const SETTINGS_FILE_NAME = "settings.json";
const GENERATED_SETTINGS_LABEL = "Generated settings.json";
const HOOKS_KEY = "hooks";
const HOOKS_CONTAINER_POINTER = "/hooks";
const HOOKS_POINTER_PREFIX = "/hooks/";
const CLAUDE_CODE_AGENT_ID = "claude-code";

const textEncoder = new TextEncoder();

const settingsDocumentSchema = z.looseObject({
  hooks: z.record(z.string(), z.array(z.unknown())).optional(),
});

type SettingsDocument = z.infer<typeof settingsDocumentSchema>;

// The source text is kept beside the document so every edit preserves the user's bytes.
export interface DecodedSettings {
  readonly source: string;
  readonly document: SettingsDocument;
}

interface HookSettingsEdit extends DecodedSettings {
  readonly events: ReadonlyArray<OwnedHookEvent>;
  readonly createdContainers: ReadonlyArray<string>;
}

const parseSettingsJson = (settingsText: string, label: string): unknown => {
  try {
    return JSON.parse(settingsText);
  } catch (error) {
    throw createInstallError(`${label} is invalid: ${readErrorMessage(error)}`);
  }
};

const parseSettings = (settingsText: string, label: string): SettingsDocument => {
  const parsedJson = parseSettingsJson(settingsText, label);
  const settingsReply = settingsDocumentSchema.safeParse(parsedJson);
  const isSettingsInvalid = !settingsReply.success;
  if (isSettingsInvalid) {
    throw createInstallError(`${label} is invalid: ${joinZodIssueMessages(settingsReply.error)}`);
  }

  return settingsReply.data;
};

export const decodeSettings = (snapshot: FileSnapshot): DecodedSettings => {
  const isSettingsMissing = snapshot._tag === "missing";
  if (isSettingsMissing) {
    return { source: "{}\n", document: {} };
  }

  const textReply = decodeStrictText(snapshot.bytes, SETTINGS_FILE_NAME);
  const isTextInvalid = textReply._tag === "invalid";
  if (isTextInvalid) {
    throw createInstallError(textReply.message);
  }

  const jsonText = textReply.fileContents;
  const duplicateProperty = findDuplicateJsonKey(jsonText);
  const isPropertyDuplicated = duplicateProperty != null;
  if (isPropertyDuplicated) {
    throw createInstallError(
      `${SETTINGS_FILE_NAME} contains duplicate JSON property ${JSON.stringify(duplicateProperty)}.`,
    );
  }

  return { source: jsonText, document: parseSettings(jsonText, SETTINGS_FILE_NAME) };
};

const hookEventFromPointer = (pointer: string): string | null => {
  const isHookPointer = pointer.startsWith(HOOKS_POINTER_PREFIX);
  const event = pointer.slice(HOOKS_POINTER_PREFIX.length);
  const isDirectHookEvent = isHookPointer && !event.includes("/");

  return isDirectHookEvent ? event : null;
};

const readGroupsAtPointer = (document: SettingsDocument, pointer: string): ReadonlyArray<unknown> | null => {
  const event = hookEventFromPointer(pointer);
  const isEventNamed = event != null;

  return isEventNamed ? (document.hooks?.[event] ?? null) : null;
};

const readEventNames = (ownedEvents: ReadonlyArray<OwnedHookEvent>): string[] =>
  ownedEvents.flatMap((owned) => {
    const event = hookEventFromPointer(owned.pointer);
    const isEventNamed = event != null;

    return isEventNamed ? [event] : [];
  });

const decodeHookGroups = (value: unknown, event: string): ReadonlyArray<unknown> => {
  const isGroupList = Array.isArray(value);
  if (isGroupList) {
    return value;
  }

  throw createInstallError(`${SETTINGS_FILE_NAME} hook event ${event} must contain an array.`);
};

const createChangedEntriesError = ({ filePath, pointer }: { filePath: string; pointer: string }): Error =>
  createInstallError(`Receipted hook entries in ${filePath} ${pointer} changed after installation.`);

const hashGroups = (groups: ReadonlyArray<unknown>): string[] => groups.map((group) => hashJsonValue(group));

// Receipts written before entry ownership hashed a whole event array: the user's groups, then agent-setup's.
// That installed array is still the start of the current one when other tools only appended entries since.
const migrateLegacyEvent = ({
  filePath,
  value,
  document,
}: {
  filePath: string;
  value: OwnedJsonValue;
  document: SettingsDocument;
}): OwnedHookEvent => {
  const { pointer, previous, installed } = value;
  const event = hookEventFromPointer(pointer);
  const isEventNamed = event != null;
  const current = readGroupsAtPointer(document, pointer);
  const isCurrentMissing = !isEventNamed || current == null;
  if (isCurrentMissing) {
    throw createChangedEntriesError({ filePath, pointer });
  }

  const isUserValuePresent = previous._tag === "value";
  const userGroups = isUserValuePresent ? decodeHookGroups(previous.value, event) : [];
  const prefixLengths = Array.from(
    { length: current.length - userGroups.length + 1 },
    (_, offset) => current.length - offset,
  );
  const installedLength = prefixLengths.find((length) => {
    const installedPrefix = current.slice(0, length);

    return hashJsonValue(installedPrefix) === installed.hash;
  });
  const isInstalledPrefixMissing = installedLength == null;
  if (isInstalledPrefixMissing) {
    throw createChangedEntriesError({ filePath, pointer });
  }

  const ownedGroups = current.slice(userGroups.length, installedLength);

  return { pointer, previouslyPresent: isUserValuePresent, entries: hashGroups(ownedGroups) };
};

// Reads the entries the receipt says agent-setup owns in one settings file, migrating the older whole-array layout.
const readPreviousHookEntries = ({
  file,
  document,
}: {
  file: OwnedFile;
  document: SettingsDocument;
}): HookEntriesOwnership => {
  const { ownership } = file;
  switch (ownership._tag) {
    case "hookEntries":
      return ownership;
    case "jsonValues":
      return {
        _tag: "hookEntries",
        filePreviouslyPresent: ownership.filePreviouslyPresent,
        createdContainers: ownership.createdContainers,
        events: ownership.values.map((value) => migrateLegacyEvent({ filePath: file.path, value, document })),
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

const validateOwnedEntries = ({
  filePath,
  ownership,
  document,
}: {
  filePath: string;
  ownership: HookEntriesOwnership | null;
  document: SettingsDocument;
}): void => {
  const changedEvent = ownership?.events.find((event) => !isOwnedEventPresent({ event, document }));
  const isEventChanged = changedEvent != null;
  if (isEventChanged) {
    throw createChangedEntriesError({ filePath, pointer: changedEvent.pointer });
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

const applyEdits = <Item>({
  source,
  items,
  edit,
}: {
  source: string;
  items: ReadonlyArray<Item>;
  edit: (source: string, item: Item) => string;
}): string => items.reduce((editedSource, item) => edit(editedSource, item), source);

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
  const entries = hashGroups(plan.desired);
  const isNothingDesired = entries.length === 0;
  if (isNothingDesired) {
    return [];
  }

  return [
    {
      pointer: `${HOOKS_POINTER_PREFIX}${plan.event}`,
      previouslyPresent: isEventPreviouslyPresent(plan),
      entries,
    },
  ];
};

// Removes agent-setup's stale entries and appends its new ones; every other entry in the array keeps its bytes.
const editHookEvent = ({ source, plan }: { source: string; plan: HookEventPlan }): string => {
  const { event, current, owned, desired } = plan;
  const path = [HOOKS_KEY, event];
  const isEventNew = current == null;
  const isNothingDesired = desired.length === 0;

  if (isEventNew && isNothingDesired) {
    return source;
  }

  if (isEventNew) {
    return editJsonValue({ source, path, value: desired });
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
    source,
    items: staleIndexes,
    edit: (edited, index) => removeJsonArrayItem({ source: edited, path, index }),
  });
  const withAdded = applyEdits({
    source: withoutStale,
    items: addedGroups,
    edit: (edited, group) => appendJsonArrayItem({ source: edited, path, value: group }),
  });

  const remainingGroupCount = current.length - staleIndexes.length + addedGroups.length;
  const isCreatedEventEmptied = remainingGroupCount === 0 && !isEventPreviouslyPresent(plan);
  if (isCreatedEventEmptied) {
    return editJsonValue({ source: withAdded, path, value: undefined });
  }

  return withAdded;
};

const addEmptyHooksContainer = (source: string): string => editJsonValue({ source, path: [HOOKS_KEY], value: {} });

// A hooks object agent-setup created goes again once it is empty; a user's own empty hooks object stays.
const removeEmptyCreatedHooks = ({
  source,
  ownsHooksContainer,
}: {
  source: string;
  ownsHooksContainer: boolean;
}): DecodedSettings => {
  const document = parseSettings(source, GENERATED_SETTINGS_LABEL);
  const hooks = document.hooks;
  const isHooksKept = !ownsHooksContainer || hooks == null || Object.keys(hooks).length > 0;
  if (isHooksKept) {
    return { source, document };
  }

  const sourceWithoutHooks = editJsonValue({ source, path: [HOOKS_KEY], value: undefined });

  return {
    source: sourceWithoutHooks,
    document: parseSettings(sourceWithoutHooks, GENERATED_SETTINGS_LABEL),
  };
};

// A command that points into the installed hooks folder is agent-setup's, whether its path is the old camelCase one or the current one.
const isInstalledHookGroup = (group: unknown, installedHooksFolder: string): boolean =>
  JSON.stringify(group).includes(`${installedHooksFolder}/`);

// Installed groups that no receipt lists (a lost receipt, or an older layout) join the receipted hashes, so the edit replaces them.
const ownInstalledGroups = ({
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
  previous: HookEntriesOwnership | null;
  desiredGroups: ReadonlyMap<string, ReadonlyArray<ManagedHookGroup>>;
  installedHooksFolder: string;
}): HookSettingsEdit => {
  const { document } = decoded;
  validateOwnedEntries({ filePath, ownership: previous, document });

  // Events agent-setup no longer wants are edited first, newest first, then every desired event.
  const receiptEvents = previous?.events ?? [];
  const ownedEvents = ownInstalledGroups({ receiptEvents, hooks: document.hooks, installedHooksFolder });
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
  const createsHooksContainer = isHooksMissing && desiredGroups.size > 0;
  const isHooksContainerReceipted = previous?.createdContainers.includes(HOOKS_CONTAINER_POINTER) ?? false;
  const ownsHooksContainer = isHooksContainerReceipted || createsHooksContainer;

  const sourceWithContainer = createsHooksContainer ? addEmptyHooksContainer(decoded.source) : decoded.source;
  const withEvents = applyEdits({
    source: sourceWithContainer,
    items: plans,
    edit: (edited, plan) => editHookEvent({ source: edited, plan }),
  });
  const settingsWithoutEmptyHooks = removeEmptyCreatedHooks({ source: withEvents, ownsHooksContainer });

  return {
    source: settingsWithoutEmptyHooks.source,
    document: settingsWithoutEmptyHooks.document,
    events: plans.flatMap(listOwnedHookEvents),
    createdContainers: ownsHooksContainer ? [HOOKS_CONTAINER_POINTER] : [],
  };
};

// A file agent-setup created and left empty is removed; anything else keeps its remaining user bytes.
const restoreOrRemove = ({
  file,
  source,
  document,
  snapshot,
  filePreviouslyPresent,
}: {
  file: OwnedFile;
  source: string;
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
      expectedCurrent: expectedCurrent(snapshot),
    };
  }

  return {
    _tag: "restore",
    file,
    bytes: textEncoder.encode(source),
    expectedCurrent: expectedCurrent(snapshot),
  };
};

// Codex and Grok document no SubagentStop event, so only Claude Code gets it.
const isEventSupportedBy = (event: string, agent: AgentDefinition): boolean =>
  event !== "SubagentStop" || agent.id === CLAUDE_CODE_AGENT_ID;

export const desiredHookGroups = ({
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

      const entrypoint = installedHookFile(
        feature.sourceDirectory,
        registrationEntrypoint(featureRuntime, registration),
      );
      const runtimeCommand = `node "${path.join(root, entrypoint)}"`;
      const doesReadAgentId = registration.readsAgentId === true;
      const command = doesReadAgentId ? `AGENT_SETUP_AGENT_ID=${agent.id} ${runtimeCommand}` : runtimeCommand;
      const isBackgroundHook = registration.runsInBackground === true && agent.id === CLAUDE_CODE_AGENT_ID;
      const hasMatcherPattern = registration.matcher._tag === "pattern";
      const group: ManagedHookGroup = {
        ...(hasMatcherPattern ? { matcher: registration.matcher.value } : {}),
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
  previousFile: OwnedFile | undefined;
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
    ? readPreviousHookEntries({ file: previousFile, document: decoded.document })
    : null;
  const edited = editHookSettings({
    filePath,
    decoded,
    previous: previousOwnership,
    desiredGroups,
    installedHooksFolder,
  });
  const { source, document, events, createdContainers } = edited;

  const isReceiptedFileEmptied = events.length === 0 && previousFile != null && previousOwnership != null;
  if (isReceiptedFileEmptied) {
    const restoration = restoreOrRemove({
      file: previousFile,
      source,
      document,
      snapshot,
      filePreviouslyPresent: previousOwnership.filePreviouslyPresent,
    });

    return checkFileChange(restoration);
  }

  const isSettingsUnchanged = source === decoded.source;
  const hasNoHookEvent = events.length === 0;
  const isNothingToWrite = hasNoHookEvent && isSettingsUnchanged;
  if (isNothingToWrite) {
    return null;
  }

  const wasFilePresent = snapshot._tag === "file";
  const hasNoPreviousOwnership = previousOwnership == null;
  const ownership: HookEntriesOwnership = {
    _tag: "hookEntries",
    filePreviouslyPresent: hasNoPreviousOwnership ? wasFilePresent : previousOwnership.filePreviouslyPresent,
    createdContainers: [...createdContainers],
    events: [...events],
  };

  return checkFileChange({
    _tag: "write",
    file: { owner: applicationOwner, path: filePath, kind: { _tag: "settings" }, ownership },
    bytes: textEncoder.encode(source),
    expectedCurrent: expectedCurrent(snapshot),
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
  const previous = readPreviousHookEntries({ file, document: decoded.document });
  const edited = editHookSettings({
    filePath: file.path,
    decoded,
    previous,
    desiredGroups: new Map(),
    installedHooksFolder,
  });
  const restoration = restoreOrRemove({
    file,
    source: edited.source,
    document: edited.document,
    snapshot,
    filePreviouslyPresent: previous.filePreviouslyPresent,
  });

  return checkFileChange(restoration);
};
