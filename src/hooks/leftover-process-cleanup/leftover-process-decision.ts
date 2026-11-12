import type { RunningProcess } from "../process-table.js";

export interface LeftoverProcessCheck {
  readonly processes: ReadonlyArray<RunningProcess>;
  readonly protectedProcessIds: ReadonlySet<number>;
  readonly workingFolders: ReadonlyMap<number, string>;
  readonly missingFolders: ReadonlySet<string>;
  readonly codeRoots: ReadonlyArray<string>;
  readonly finishedFolders: ReadonlyArray<string>;
  readonly testBrowserMinimumAgeSeconds: number;
}

export interface LeftoverProcess {
  readonly processId: number;
  readonly name: string;
  readonly reason: string;
}

// Shells, terminals and agents keep running from a folder that is gone; the owner closes those, never this hook.
const NEVER_STOPPED_NAMES = new Set([
  "zsh",
  "bash",
  "sh",
  "fish",
  "dash",
  "login",
  "tmux",
  "cmux",
  "ssh",
  "claude",
  "codex",
  "launchd",
]);

const NEVER_STOPPED_COMMAND_LINES: ReadonlyArray<RegExp> = [
  /Business OS/u,
  /\b4823\b/u,
  /docker/iu,
  /Visual Studio Code/u,
  /Code Helper/u,
  /agent-voice/u,
  /--remote-debugging-port=922[23]\b/u,
];

const ORPHAN_PARENT_PROCESS_ID = 1;
// e.g. "--user-data-dir=/var/folders/ab/cd/T/lighthouse.Xy12Zk" or ".../T/playwright_chromiumdev_profile-AbC123"
const TEST_BROWSER_PROFILE =
  /--user-data-dir=((?:\/private)?(?:\/var\/folders|\/tmp)\/(?:\S*\/)?(?:lighthouse|playwright|puppeteer)[^/\s]*)/u;

const isInsideFolder = (request: { readonly folder: string; readonly root: string }): boolean => {
  const hasTrailingSlash = request.root.endsWith("/");
  const insideStart = hasTrailingSlash ? request.root : `${request.root}/`;
  return request.folder === request.root || request.folder.startsWith(insideStart);
};

const isProtectedByIdOrName = (request: {
  readonly runningProcess: RunningProcess;
  readonly protectedProcessIds: ReadonlySet<number>;
}): boolean => {
  const { runningProcess } = request;
  const isProtectedId = request.protectedProcessIds.has(runningProcess.processId);
  const hasProtectedName = NEVER_STOPPED_NAMES.has(runningProcess.name);
  return isProtectedId || hasProtectedName;
};

const hasProtectedCommandLine = (runningProcess: RunningProcess): boolean =>
  NEVER_STOPPED_COMMAND_LINES.some((pattern) => pattern.test(runningProcess.commandLine));

export const isNeverStopped = (request: {
  readonly runningProcess: RunningProcess;
  readonly protectedProcessIds: ReadonlySet<number>;
}): boolean => isProtectedByIdOrName(request) || hasProtectedCommandLine(request.runningProcess);

const collectAncestors = (
  parentByProcessId: ReadonlyMap<number, number>,
  processId: number,
  found: ReadonlySet<number>,
): ReadonlySet<number> => {
  const isChainEnd = processId <= ORPHAN_PARENT_PROCESS_ID || found.has(processId);
  if (isChainEnd) {
    return found;
  }

  const parentProcessId = parentByProcessId.get(processId) ?? 0;
  return collectAncestors(parentByProcessId, parentProcessId, new Set([...found, processId]));
};

// The process itself and every parent up to launchd, so the hook never stops the session that runs it.
export const readAncestorProcessIds = (request: {
  readonly processes: ReadonlyArray<RunningProcess>;
  readonly startProcessId: number;
}): ReadonlySet<number> => {
  const parentByProcessId = new Map(request.processes.map((running) => [running.processId, running.parentProcessId]));
  return collectAncestors(parentByProcessId, request.startProcessId, new Set());
};

const listFolderGoneLeftover = (
  check: LeftoverProcessCheck,
  runningProcess: RunningProcess,
): ReadonlyArray<LeftoverProcess> => {
  const workingFolder = check.workingFolders.get(runningProcess.processId);

  const isWorkingFolderMissing = workingFolder == null;
  if (isWorkingFolderMissing) {
    return [];
  }

  const isUnderCodeRoot = check.codeRoots.some((root) => isInsideFolder({ folder: workingFolder, root }));

  const isFolderGone = check.missingFolders.has(workingFolder);

  const isNotUnderCodeRootOrGone = !isUnderCodeRoot || !isFolderGone;
  if (isNotUnderCodeRootOrGone) {
    return [];
  }

  const reason = `working folder no longer exists: ${workingFolder}`;
  return [{ processId: runningProcess.processId, name: runningProcess.name, reason }];
};

// A copy of a protected app (Business OS) started from a finished job's folder is a leftover test build, not the owner's.
const listFinishedFolderLeftover = (
  check: LeftoverProcessCheck,
  runningProcess: RunningProcess,
): ReadonlyArray<LeftoverProcess> => {
  const workingFolder = check.workingFolders.get(runningProcess.processId);
  const finishedFolder = check.finishedFolders.find((folder) => {
    const isRunFromFolder = runningProcess.commandLine.includes(`${folder}/`);
    const isWorkingInFolder = workingFolder != null && isInsideFolder({ folder: workingFolder, root: folder });
    return isRunFromFolder || isWorkingInFolder;
  });

  const isNotInFinishedFolder = finishedFolder == null;
  if (isNotInFinishedFolder) {
    return [];
  }

  const reason = `running from the folder of a finished Claude job or session: ${finishedFolder}`;
  return [{ processId: runningProcess.processId, name: runningProcess.name, reason }];
};

const readTestBrowserProfile = (runningProcess: RunningProcess): string | null =>
  TEST_BROWSER_PROFILE.exec(runningProcess.commandLine)?.[1] ?? null;

const readOrphanedTestBrowserProfiles = (check: LeftoverProcessCheck): ReadonlySet<string> => {
  const profiles = check.processes
    .filter((running) => running.parentProcessId === ORPHAN_PARENT_PROCESS_ID)
    .filter((running) => running.elapsedSeconds > check.testBrowserMinimumAgeSeconds)
    .map(readTestBrowserProfile)
    .filter((profile) => profile !== null);
  return new Set(profiles);
};

// A browser's helper processes share the profile of the orphaned main process and are not orphans themselves.
const listTestBrowserLeftover = (
  runningProcess: RunningProcess,
  orphanedProfiles: ReadonlySet<string>,
): ReadonlyArray<LeftoverProcess> => {
  const profile = readTestBrowserProfile(runningProcess);

  const isNotOrphanedProfile = profile === null || !orphanedProfiles.has(profile);
  if (isNotOrphanedProfile) {
    return [];
  }

  const reason = `orphaned test browser with temporary profile: ${profile}`;
  return [{ processId: runningProcess.processId, name: runningProcess.name, reason }];
};

const listLeftover = (request: {
  readonly check: LeftoverProcessCheck;
  readonly orphanedProfiles: ReadonlySet<string>;
  readonly runningProcess: RunningProcess;
}): ReadonlyArray<LeftoverProcess> => {
  const { check, orphanedProfiles, runningProcess } = request;

  const isProtected = isProtectedByIdOrName({ runningProcess, protectedProcessIds: check.protectedProcessIds });
  if (isProtected) {
    return [];
  }

  const finishedFolderLeftover = listFinishedFolderLeftover(check, runningProcess);
  const isInFinishedFolder = finishedFolderLeftover.length > 0;
  if (isInFinishedFolder) {
    return finishedFolderLeftover;
  }

  if (hasProtectedCommandLine(runningProcess)) {
    return [];
  }

  const folderGone = listFolderGoneLeftover(check, runningProcess);
  const isFolderGone = folderGone.length > 0;
  return isFolderGone ? folderGone : listTestBrowserLeftover(runningProcess, orphanedProfiles);
};

export const decideLeftoverProcesses = (check: LeftoverProcessCheck): ReadonlyArray<LeftoverProcess> => {
  const orphanedProfiles = readOrphanedTestBrowserProfiles(check);
  return check.processes.flatMap((runningProcess) => listLeftover({ check, orphanedProfiles, runningProcess }));
};
