/** Agent hook settings (settings.json and native equivalents): plan the agent-setup hook entries, and restore them on removal. */

import type { Path } from "@effect/platform";
import { Either, Schema, ParseResult as SchemaParseIssue } from "effect";

import type { AgentDefinition } from "../catalog/agent-catalog.js";
import { featureCatalog } from "../catalog/feature-catalog.js";
import { decodeStrictText } from "./file-bytes.js";
import { findDuplicateJsonKey } from "./find-duplicate-json-key.js";
import { applicationOwner, checkFileChange, expectedCurrent, type FileSnapshot } from "./host-files.js";
import { settingsPath } from "./install-paths.js";
import { InstallError } from "./install-request.js";
import { appendJsonArrayItem, editJsonValue, hashJsonValue, removeJsonArrayItem } from "./json-edit.js";
import type { HookEntriesOwnership, OwnedFile, OwnedHookEvent, OwnedJsonValue } from "./ownership.js";
import { installedHookFile, registrationEntrypoint } from "./package-files.js";
import type { FileChange } from "./plan.js";

const textEncoder = new TextEncoder();

const settingsDocumentSchema = Schema.Struct(
  {
    hooks: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Array(Schema.Unknown) })),
  },
  Schema.Record({ key: Schema.String, value: Schema.Unknown }),
);

type SettingsDocument = Schema.Schema.Type<typeof settingsDocumentSchema>;

// The source text is kept beside the document so every edit preserves the user's bytes.
const decodedSettingsSchema = Schema.Struct({ source: Schema.String, document: settingsDocumentSchema });

export type DecodedSettings = Schema.Schema.Type<typeof decodedSettingsSchema>;

const parseSettings = (source: string, label: string): Either.Either<SettingsDocument, InstallError> =>
  Either.mapLeft(
    Schema.decodeUnknownEither(Schema.parseJson(settingsDocumentSchema), { onExcessProperty: "preserve" })(source),
    (error) =>
      new InstallError({ issue: `${label} is invalid: ${SchemaParseIssue.TreeFormatter.formatErrorSync(error)}` }),
  );

export const decodeSettings = (snapshot: FileSnapshot): Either.Either<DecodedSettings, InstallError> => {
  if (snapshot._tag === "missing") {
    return Either.right({ source: "{}\n", document: {} });
  }

  const textReply = decodeStrictText(snapshot.bytes, "settings.json");
  const isTextInvalid = textReply._tag === "invalid";
  if (isTextInvalid) {
    return Either.left(new InstallError({ issue: textReply.message }));
  }

  const jsonText = textReply.fileContents;
  const duplicateProperty = findDuplicateJsonKey(jsonText);
  const isPropertyDuplicated = duplicateProperty !== undefined;
  if (isPropertyDuplicated) {
    return Either.left(
      new InstallError({
        issue: `settings.json contains duplicate JSON property ${JSON.stringify(duplicateProperty)}.`,
      }),
    );
  }

  return Either.map(parseSettings(jsonText, "settings.json"), (document) => ({ source: jsonText, document }));
};

const hookEventFromPointer = (pointer: string): string | undefined => {
  const event = pointer.slice("/hooks/".length);

  return pointer.startsWith("/hooks/") && !event.includes("/") ? event : undefined;
};

const decodeHookGroups = (value: unknown, event: string): Either.Either<ReadonlyArray<unknown>, InstallError> =>
  Either.mapLeft(
    Schema.decodeUnknownEither(Schema.Array(Schema.Unknown))(value),
    () => new InstallError({ issue: `settings.json hook event ${event} must contain an array.` }),
  );

const changedEntriesError = (input: { filePath: string; pointer: string }) =>
  new InstallError({
    issue: `Receipted hook entries in ${input.filePath} ${input.pointer} changed after installation.`,
  });

const hashGroups = (groups: ReadonlyArray<unknown>): ReadonlyArray<string> =>
  groups.map((group) => hashJsonValue(group));

// Receipts written before entry ownership hashed a whole event array: the user's groups, then agent-setup's.
// That installed array is still the start of the current one when other tools only appended entries since.
const migrateLegacyEvent = (input: {
  filePath: string;
  value: OwnedJsonValue;
  document: SettingsDocument;
}): Either.Either<OwnedHookEvent, InstallError> => {
  const pointer = input.value.pointer;
  const event = hookEventFromPointer(pointer);
  const current = event === undefined ? undefined : input.document.hooks?.[event];
  if (event === undefined || current === undefined) {
    return Either.left(changedEntriesError({ filePath: input.filePath, pointer }));
  }

  const previous = input.value.previous;
  const userGroups: Either.Either<ReadonlyArray<unknown>, InstallError> = previous._tag === "value"
    ? decodeHookGroups(previous.value, event)
    : Either.right([]);

  return Either.flatMap(userGroups, (groups) => {
    const prefixLengths = Array.from(
      { length: current.length - groups.length + 1 },
      (_, offset) => current.length - offset,
    );
    const installedLength = prefixLengths.find((length) => {
      const installedPrefix = current.slice(0, length);

      return hashJsonValue(installedPrefix) === input.value.installed.hash;
    });
    if (installedLength === undefined) {
      return Either.left(changedEntriesError({ filePath: input.filePath, pointer }));
    }

    const ownedGroups = current.slice(groups.length, installedLength);
    const entries = hashGroups(ownedGroups);

    return Either.right({ pointer, previouslyPresent: previous._tag === "value", entries });
  });
};

const previousHookEntries = (input: {
  file: OwnedFile;
  document: SettingsDocument;
}): Either.Either<HookEntriesOwnership, InstallError> => {
  const ownership = input.file.ownership;
  switch (ownership._tag) {
    case "hookEntries":
      return Either.right(ownership);
    case "jsonValues": {
      const migratedEvents = ownership.values.map((value) =>
        migrateLegacyEvent({ filePath: input.file.path, value, document: input.document }),
      );
      const allMigratedEvents = Either.all(migratedEvents);

      return Either.map(
        allMigratedEvents,
        (events): HookEntriesOwnership => ({
          _tag: "hookEntries",
          filePreviouslyPresent: ownership.filePreviouslyPresent,
          createdContainers: ownership.createdContainers,
          events,
        }),
      );
    }
    case "wholeFile":
    case "managedBlock":
    case "yamlSequenceValue":
      return Either.left(
        new InstallError({
          issue: `Receipted settings entry ${input.file.path} has invalid ownership ${ownership._tag}.`,
        }),
      );
  }
};

const countOf = (hashes: ReadonlyArray<string>, hash: string): number =>
  hashes.filter((candidate) => candidate === hash).length;

const ownedEntriesPresent = (input: { event: OwnedHookEvent; document: SettingsDocument }): boolean => {
  const eventName = hookEventFromPointer(input.event.pointer);
  const current = eventName === undefined ? undefined : input.document.hooks?.[eventName];
  if (current === undefined) {
    return false;
  }

  const currentHashes = hashGroups(current);

  return input.event.entries.every((hash) => countOf(currentHashes, hash) >= countOf(input.event.entries, hash));
};

// Only agent-setup's own entries are checked, so entries other tools add to the same event never count as drift.
const validateOwnedEntries = (input: {
  filePath: string;
  ownership: HookEntriesOwnership | undefined;
  document: SettingsDocument;
}): Either.Either<void, InstallError> => {
  const changed = input.ownership?.events.find((event) => !ownedEntriesPresent({ event, document: input.document }));

  return changed === undefined
    ? Either.right(undefined)
    : Either.left(changedEntriesError({ filePath: input.filePath, pointer: changed.pointer }));
};

// The nth occurrence of a hash is extra when the baseline holds fewer of it, e.g. [a, a, b] over [a] → a, b.
const isExtraOccurrence = (input: {
  hashes: ReadonlyArray<string>;
  index: number;
  baseline: ReadonlyArray<string>;
}): boolean => {
  const hash = input.hashes[input.index];
  const seen = input.hashes.slice(0, input.index + 1);

  return hash !== undefined && countOf(seen, hash) > countOf(input.baseline, hash);
};

const applyEdits = <Item>(input: {
  source: string;
  items: ReadonlyArray<Item>;
  edit: (source: string, item: Item) => Either.Either<string, InstallError>;
}): Either.Either<string, InstallError> =>
  input.items.reduce<Either.Either<string, InstallError>>(
    (edited, item) => Either.flatMap(edited, (source) => input.edit(source, item)),
    Either.right(input.source),
  );

const managedHookGroupSchema = Schema.Struct({
  matcher: Schema.optional(
    Schema.NonEmptyString.annotations({
      description: "Optional tool matcher copied from the feature registration.",
    }),
  ),
  hooks: Schema.Tuple(
    Schema.Struct({
      type: Schema.Literal("command").annotations({
        description: "Claude hook leaf kind used for a spawned command.",
      }),
      command: Schema.NonEmptyString.annotations({
        description: "Fully resolved command invoking one installed runtime entrypoint.",
      }),
      async: Schema.optional(
        Schema.Literal(true).annotations({
          description: "Claude Code runs the command in the background without blocking.",
        }),
      ),
    }),
  ).annotations({
    description: "Single agent-setup-authored command leaf for this registration.",
  }),
});

type ManagedHookGroup = Schema.Schema.Type<typeof managedHookGroupSchema>;

type HookEventPlan = {
  readonly event: string;
  readonly current: ReadonlyArray<unknown> | undefined;
  readonly owned: OwnedHookEvent | undefined;
  readonly desired: ReadonlyArray<ManagedHookGroup>;
};

const eventPreviouslyPresent = (plan: HookEventPlan): boolean =>
  plan.owned === undefined ? plan.current !== undefined : plan.owned.previouslyPresent;

const ownedHookEvent = (plan: HookEventPlan): ReadonlyArray<OwnedHookEvent> => {
  const entries = hashGroups(plan.desired);

  return entries.length === 0
    ? []
    : [{ pointer: `/hooks/${plan.event}`, previouslyPresent: eventPreviouslyPresent(plan), entries }];
};

// Removes agent-setup's stale entries and appends its new ones; every other entry in the array keeps its bytes.
const editHookEvent = (input: { source: string; plan: HookEventPlan }): Either.Either<string, InstallError> => {
  const { event, current, owned, desired } = input.plan;
  const path = ["hooks", event];
  if (current === undefined) {
    return desired.length === 0
      ? Either.right(input.source)
      : editJsonValue({ source: input.source, path, value: desired });
  }

  const ownedHashes = owned === undefined ? [] : owned.entries;
  const desiredHashes = hashGroups(desired);
  const currentHashes = hashGroups(current);
  const staleHashes = ownedHashes.filter((_, index) =>
    isExtraOccurrence({ hashes: ownedHashes, index, baseline: desiredHashes }),
  );
  // The last occurrence of each stale hash goes, highest index first so the lower indexes stay valid.
  const staleIndexes = currentHashes
    .flatMap((hash, index) => {
      const later = currentHashes.slice(index + 1);

      return countOf(later, hash) < countOf(staleHashes, hash) ? [index] : [];
    })
    .reverse();
  const addedGroups = desired.filter((_, index) =>
    isExtraOccurrence({ hashes: desiredHashes, index, baseline: ownedHashes }),
  );
  const withoutStale = applyEdits({
    source: input.source,
    items: staleIndexes,
    edit: (source, index) => removeJsonArrayItem({ source, path, index }),
  });
  const withAdded = Either.flatMap(withoutStale, (source) =>
    applyEdits({
      source,
      items: addedGroups,
      edit: (edited, group) => appendJsonArrayItem({ source: edited, path, value: group }),
    }),
  );
  const emptiedCreatedEvent =
    current.length - staleIndexes.length + addedGroups.length === 0 && !eventPreviouslyPresent(input.plan);

  return emptiedCreatedEvent
    ? Either.flatMap(withAdded, (source) => editJsonValue({ source, path, value: undefined }))
    : withAdded;
};

type HookSettingsEdit = {
  readonly source: string;
  readonly document: SettingsDocument;
  readonly events: ReadonlyArray<OwnedHookEvent>;
  readonly createdContainers: ReadonlyArray<string>;
};

// A hooks object agent-setup created goes again once it is empty; a user's own empty hooks object stays.
const removeEmptyCreatedHooks = (input: {
  source: string;
  ownsHooksContainer: boolean;
}): Either.Either<{ source: string; document: SettingsDocument }, InstallError> => {
  const document = parseSettings(input.source, "Generated settings.json");
  if (Either.isLeft(document)) {
    return Either.left(document.left);
  }

  const hooks = document.right.hooks;
  if (!input.ownsHooksContainer || hooks === undefined || Object.keys(hooks).length > 0) {
    return Either.right({ source: input.source, document: document.right });
  }

  const withoutHooks = editJsonValue({ source: input.source, path: ["hooks"], value: undefined });

  return Either.flatMap(withoutHooks, (source) => {
    const withoutHooksDocument = parseSettings(source, "Generated settings.json");

    return Either.map(withoutHooksDocument, (edited) => ({ source, document: edited }));
  });
};

// A command that points into the installed hooks folder is agent-setup's, whether its path is the old camelCase one or the current one.
const isInstalledHookGroup = (group: unknown, installedHooksFolder: string): boolean =>
  JSON.stringify(group).includes(`${installedHooksFolder}/`);

// Installed groups that no receipt lists (a lost receipt, or an older layout) join the receipted hashes, so the edit replaces them.
const withInstalledGroupsOwned = (input: {
  receiptEvents: ReadonlyArray<OwnedHookEvent>;
  hooks: Record<string, ReadonlyArray<unknown>> | undefined;
  installedHooksFolder: string;
}): ReadonlyArray<OwnedHookEvent> => {
  const isInstalled = (group: unknown) => isInstalledHookGroup(group, input.installedHooksFolder);
  const receiptEventNames = input.receiptEvents.flatMap((owned) => {
    const event = hookEventFromPointer(owned.pointer);

    return event === undefined ? [] : [event];
  });
  const installedEventNames = Object.entries(input.hooks ?? {})
    .filter(([, groups]) => groups.some(isInstalled))
    .map(([event]) => event);
  const eventNames = [...new Set([...receiptEventNames, ...installedEventNames])];

  return eventNames.flatMap((event) => {
    const receiptEvent = input.receiptEvents.find((owned) => owned.pointer === `/hooks/${event}`);
    const groups = input.hooks?.[event] ?? [];
    const installedHashes = hashGroups(groups.filter(isInstalled));
    const unlistedHashes = installedHashes.filter((_, index) =>
      isExtraOccurrence({ hashes: installedHashes, index, baseline: receiptEvent?.entries ?? [] }),
    );
    const hasReceiptEvent = receiptEvent !== undefined;
    if (hasReceiptEvent) {
      return [{ ...receiptEvent, entries: [...receiptEvent.entries, ...unlistedHashes] }];
    }

    const isThereUnlistedGroup = unlistedHashes.length > 0;
    if (!isThereUnlistedGroup) {
      return [];
    }

    const hasForeignGroups = groups.some((group) => !isInstalled(group));

    return [{ pointer: `/hooks/${event}`, previouslyPresent: hasForeignGroups, entries: unlistedHashes }];
  });
};

const editHookSettings = (input: {
  filePath: string;
  decoded: DecodedSettings;
  previous: HookEntriesOwnership | undefined;
  desiredGroups: ReadonlyMap<string, ReadonlyArray<ManagedHookGroup>>;
  installedHooksFolder: string;
}): Either.Either<HookSettingsEdit, InstallError> => {
  const document = input.decoded.document;
  const ownedEntries = validateOwnedEntries({ filePath: input.filePath, ownership: input.previous, document });
  if (Either.isLeft(ownedEntries)) {
    return Either.left(ownedEntries.left);
  }

  // Events agent-setup no longer wants are edited first, newest first, then every desired event.
  const receiptEvents = input.previous === undefined ? [] : input.previous.events;
  const ownedEvents = withInstalledGroupsOwned({
    receiptEvents,
    hooks: document.hooks,
    installedHooksFolder: input.installedHooksFolder,
  });
  const previousEvents = ownedEvents.flatMap((owned) => {
    const event = hookEventFromPointer(owned.pointer);

    return event === undefined ? [] : [event];
  });
  const removedEvents = previousEvents.filter((event) => !input.desiredGroups.has(event)).reverse();
  const events = [...new Set([...removedEvents, ...input.desiredGroups.keys()])];
  const plans = events.map(
    (event): HookEventPlan => ({
      event,
      current: document.hooks?.[event],
      owned: ownedEvents.find((owned) => owned.pointer === `/hooks/${event}`),
      desired: input.desiredGroups.get(event) || [],
    }),
  );
  const createsHooksContainer = document.hooks === undefined && input.desiredGroups.size > 0;
  const ownsHooksContainer = input.previous?.createdContainers.includes("/hooks") === true || createsHooksContainer;
  const withContainer = createsHooksContainer
    ? editJsonValue({ source: input.decoded.source, path: ["hooks"], value: {} })
    : Either.right(input.decoded.source);
  const withEvents = Either.flatMap(withContainer, (source) =>
    applyEdits({ source, items: plans, edit: (edited, plan) => editHookEvent({ source: edited, plan }) }),
  );
  const edited = Either.flatMap(withEvents, (source) => removeEmptyCreatedHooks({ source, ownsHooksContainer }));

  return Either.map(edited, ({ source, document: editedDocument }) => ({
    source,
    document: editedDocument,
    events: plans.flatMap(ownedHookEvent),
    createdContainers: ownsHooksContainer ? ["/hooks"] : [],
  }));
};

// A file agent-setup created and left empty is removed; anything else keeps its remaining user bytes.
const restoreOrRemove = (input: {
  file: OwnedFile;
  source: string;
  document: SettingsDocument;
  snapshot: FileSnapshot;
  filePreviouslyPresent: boolean;
}) =>
  !input.filePreviouslyPresent && Object.keys(input.document).length === 0
    ? {
        _tag: "remove",
        file: input.file,
        unownedBytes: new Uint8Array(),
        expectedCurrent: expectedCurrent(input.snapshot),
      }
    : {
        _tag: "restore",
        file: input.file,
        bytes: textEncoder.encode(input.source),
        expectedCurrent: expectedCurrent(input.snapshot),
      };

// Codex and Grok document no SubagentStop event, so only Claude Code gets it.
const isEventSupportedBy = (event: string, agent: AgentDefinition): boolean =>
  event !== "SubagentStop" || agent.id === "claude-code";

export const desiredHookGroups = (input: {
  root: string;
  featureIds: ReadonlyArray<string>;
  selectedAgents: ReadonlyArray<AgentDefinition>;
  agent: AgentDefinition;
  path: Path.Path;
}) => {
  const groups = new Map<string, ReadonlyArray<ManagedHookGroup>>();
  if (
    !input.selectedAgents.some((agent) => agent.id === input.agent.id) ||
    input.agent.nativeHooks._tag === "unsupported"
  ) {
    return groups;
  }

  for (const feature of featureCatalog) {
    if (!input.featureIds.includes(feature.id) || feature.runtime._tag === "none") {
      continue;
    }

    for (const registration of feature.runtime.registrations) {
      if (!isEventSupportedBy(registration.event, input.agent)) {
        continue;
      }

      const entrypoint = installedHookFile(
        feature.sourceDirectory,
        registrationEntrypoint(feature.runtime, registration),
      );
      const runtime = `node "${input.path.join(input.root, entrypoint)}"`;
      const command = registration.readsAgentId ? `AGENT_SETUP_AGENT_ID=${input.agent.id} ${runtime}` : runtime;
      const isBackgroundHook = registration.runsInBackground === true && input.agent.id === "claude-code";
      const group = managedHookGroupSchema.make({
        ...(registration.matcher._tag === "pattern" ? { matcher: registration.matcher.value } : {}),
        hooks: [{ type: "command", command, ...(isBackgroundHook ? { async: true as const } : {}) }],
      });

      groups.set(registration.event, [...(groups.get(registration.event) || []), group]);
    }
  }

  return groups;
};

export const planSettings = (input: {
  filePath?: string;
  snapshot: FileSnapshot;
  decoded: DecodedSettings;
  previousFile: OwnedFile | undefined;
  desiredGroups: ReadonlyMap<string, ReadonlyArray<ManagedHookGroup>>;
  installedHooksFolder: string;
}): Either.Either<FileChange | undefined, InstallError> => {
  const filePath = input.filePath === undefined ? settingsPath : input.filePath;
  const previousFile = input.previousFile;
  if (
    previousFile !== undefined &&
    (previousFile.path !== filePath ||
      previousFile.kind._tag !== "settings" ||
      previousFile.owner._tag !== "application")
  ) {
    return Either.left(
      new InstallError({ issue: "Receipted settings entry must keep its exact path, kind, and application owner." }),
    );
  }

  if (previousFile !== undefined && input.snapshot._tag === "missing") {
    return Either.left(new InstallError({ issue: "Receipted settings.json was removed after installation." }));
  }

  const previous: Either.Either<HookEntriesOwnership | undefined, InstallError> =
    previousFile === undefined
      ? Either.right(undefined)
      : previousHookEntries({ file: previousFile, document: input.decoded.document });
  if (Either.isLeft(previous)) {
    return Either.left(previous.left);
  }

  const previousOwnership = previous.right;
  const edited = editHookSettings({
    filePath,
    decoded: input.decoded,
    previous: previousOwnership,
    desiredGroups: input.desiredGroups,
    installedHooksFolder: input.installedHooksFolder,
  });
  if (Either.isLeft(edited)) {
    return Either.left(edited.left);
  }

  const { source, document, events, createdContainers } = edited.right;
  if (events.length === 0 && previousFile !== undefined && previousOwnership !== undefined) {
    const restoration = restoreOrRemove({
      file: previousFile,
      source,
      document,
      snapshot: input.snapshot,
      filePreviouslyPresent: previousOwnership.filePreviouslyPresent,
    });

    return checkFileChange(restoration);
  }

  const isSettingsUnchanged = source === input.decoded.source;
  const hasNoHookEvent = events.length === 0;
  const isNothingToWrite = hasNoHookEvent && isSettingsUnchanged;
  if (isNothingToWrite) {
    return Either.right(undefined);
  }

  const ownership: HookEntriesOwnership = {
    _tag: "hookEntries",
    filePreviouslyPresent:
      previousOwnership === undefined ? input.snapshot._tag === "file" : previousOwnership.filePreviouslyPresent,
    createdContainers,
    events,
  };

  return checkFileChange({
    _tag: "write",
    file: { owner: applicationOwner, path: filePath, kind: { _tag: "settings" }, ownership },
    bytes: textEncoder.encode(source),
    expectedCurrent: expectedCurrent(input.snapshot),
  });
};

export const restoreSettings = (input: {
  file: OwnedFile;
  snapshot: FileSnapshot;
  installedHooksFolder: string;
}): Either.Either<FileChange, InstallError> => {
  if (input.file.kind._tag !== "settings" || input.file.owner._tag !== "application") {
    return Either.left(
      new InstallError({ issue: `Settings restoration for ${input.file.path} has invalid ownership.` }),
    );
  }

  if (input.snapshot._tag === "missing") {
    return Either.left(
      new InstallError({ issue: `Receipted settings file ${input.file.path} was removed after installation.` }),
    );
  }

  const decoded = decodeSettings(input.snapshot);
  if (Either.isLeft(decoded)) {
    return Either.left(decoded.left);
  }

  const previous = previousHookEntries({ file: input.file, document: decoded.right.document });
  if (Either.isLeft(previous)) {
    return Either.left(previous.left);
  }

  const edited = editHookSettings({
    filePath: input.file.path,
    decoded: decoded.right,
    previous: previous.right,
    desiredGroups: new Map(),
    installedHooksFolder: input.installedHooksFolder,
  });
  if (Either.isLeft(edited)) {
    return Either.left(edited.left);
  }

  const restoration = restoreOrRemove({
    file: input.file,
    source: edited.right.source,
    document: edited.right.document,
    snapshot: input.snapshot,
    filePreviouslyPresent: previous.right.filePreviouslyPresent,
  });

  return checkFileChange(restoration);
};
