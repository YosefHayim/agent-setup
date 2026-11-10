import type { RunningProcess } from "../process-table.js";
import type { KillTarget } from "./kill-targets.js";

export type KillCheck = {
  readonly killTargets: ReadonlyArray<KillTarget>;
  readonly processes: ReadonlyArray<RunningProcess>;
  readonly claudeProcessIds: ReadonlySet<number>;
};

export type KillDecision = { readonly _tag: "allow" } | { readonly _tag: "deny"; readonly reason: string };

type ProtectedRole = "session" | "terminal" | "app";

type ProtectedProcess = {
  readonly running: RunningProcess;
  readonly role: ProtectedRole;
  readonly label: string;
};

// e.g. "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" or "/System/Applications/Notes.app/Contents/..."
const APP_BUNDLE = /^(?:\/System)?\/Applications\/(.+?)\.app\//u;
const APP_NAME_WORD = /[^\p{L}\p{N}]+/u;
const ROLE_HEADINGS: Readonly<Record<ProtectedRole, string>> = {
  session: "Claude Code sessions",
  terminal: "the terminal and shells they run in",
  app: "apps the pattern does not name",
};
const PROTECTED_ROLES: ReadonlyArray<ProtectedRole> = ["session", "terminal", "app"];

// pid 1 is launchd or init, the parent of every session's terminal, and no kill pattern can reach it.
const listAncestorsOf = (
  child: RunningProcess,
  processesById: ReadonlyMap<number, RunningProcess>,
): ReadonlyArray<RunningProcess> => {
  const parent = processesById.get(child.parentProcessId);

  const isParentMissingOrInit = !parent || parent.processId <= 1;
  if (isParentMissingOrInit) {
    return [];
  }

  const olderAncestors = listAncestorsOf(parent, processesById);
  return [parent, ...olderAncestors];
};

const listAppProcess = (running: RunningProcess): ReadonlyArray<ProtectedProcess> => {
  const bundle = APP_BUNDLE.exec(running.commandLine);

  const isBundleMissing = !bundle;
  if (isBundleMissing) {
    return [];
  }

  const [, appName = ""] = bundle;
  return [{ running, role: "app", label: appName }];
};

const listFirstPerProcess = (candidates: ReadonlyArray<ProtectedProcess>): ReadonlyArray<ProtectedProcess> =>
  candidates.filter(
    (candidate, index) =>
      candidates.findIndex((other) => other.running.processId === candidate.running.processId) === index,
  );

const listProtectedProcesses = (check: KillCheck): ReadonlyArray<ProtectedProcess> => {
  const processesById = new Map(check.processes.map((running) => [running.processId, running]));
  const sessions = check.processes.filter((running) => check.claudeProcessIds.has(running.processId));
  const sessionProcesses = sessions.map(
    (running): ProtectedProcess => ({
      running,
      role: "session",
      label: `pid ${running.processId}`,
    }),
  );
  const terminalProcesses = sessions
    .flatMap((session) => listAncestorsOf(session, processesById))
    .map((running): ProtectedProcess => ({ running, role: "terminal", label: running.name }));
  const appProcesses = check.processes.flatMap(listAppProcess);
  return listFirstPerProcess([...sessionProcesses, ...terminalProcesses, ...appProcesses]);
};

// A pattern names an app through its full name or one of its longer words, e.g. "chrome" names Google Chrome.
const isNamingApp = (killTarget: KillTarget, appName: string): boolean => {
  const patternString = killTarget.patterns.join(" ").toLowerCase();
  const lowerAppName = appName.toLowerCase();
  const appWords = lowerAppName.split(APP_NAME_WORD).filter((word) => word.length >= 3);
  return patternString.includes(lowerAppName) || appWords.some((word) => patternString.includes(word));
};

const runMatcher = (killTarget: KillTarget) => {
  const isIgnoringCase = killTarget.ignoresCase;
  const flags = isIgnoringCase ? "i" : "";
  const expressions = killTarget.patterns.map((pattern) => {
    const isAnchored = killTarget.matchesWholeText;
    const origin = isAnchored ? `^(?:${pattern})$` : pattern;
    return new RegExp(origin, flags);
  });
  return (running: RunningProcess): boolean => {
    const isFullCommand = killTarget.matchesFullCommand;
    const matchedString = isFullCommand ? running.commandLine : running.name;
    const isMatchingAnyPattern = expressions.some((expression) => expression.test(matchedString));
    return isMatchingAnyPattern !== killTarget.inverted;
  };
};

const listHitsOf = (
  killTarget: KillTarget,
  guarded: ReadonlyArray<ProtectedProcess>,
): ReadonlyArray<ProtectedProcess> => {
  const isMatchingTarget = runMatcher(killTarget);
  return guarded.filter(
    (candidate) =>
      !(candidate.role === "app" && isNamingApp(killTarget, candidate.label)) && isMatchingTarget(candidate.running),
  );
};

const listRoleSummary = (hits: ReadonlyArray<ProtectedProcess>, role: ProtectedRole): ReadonlyArray<string> => {
  const roleLabels = hits.filter((hit) => hit.role === role).map((hit) => hit.label);
  const uniqueLabels = [...new Set(roleLabels)];

  const isUniqueLabelsEmpty = uniqueLabels.length === 0;
  if (isUniqueLabelsEmpty) {
    return [];
  }

  return [`${ROLE_HEADINGS[role]} (${uniqueLabels.join(", ")})`];
};

const denyReason = (killTarget: KillTarget, hits: ReadonlyArray<ProtectedProcess>): string => {
  const victims = PROTECTED_ROLES.flatMap((role) => listRoleSummary(hits, role));
  return [
    `process-kill-guard: \`${killTarget.commandWords}\` matches more than the processes you started.`,
    `It would also stop ${victims.join("; ")}.`,
    "Kill only what you started, by the pid you saved when you started it,",
    "or narrow the pattern until `pgrep -fl <pattern>` lists only your own processes. Do not retry with another broad pattern.",
  ].join(" ");
};

export const decideKill = (check: KillCheck): KillDecision => {
  const guarded = listProtectedProcesses(check);
  const judgedKills = check.killTargets.map((killTarget) => ({ killTarget, hits: listHitsOf(killTarget, guarded) }));

  const harmfulKill = judgedKills.find((judgedKill) => judgedKill.hits.length > 0);

  const isNotHarmfulKill = !harmfulKill;
  if (isNotHarmfulKill) {
    return { _tag: "allow" };
  }

  return { _tag: "deny", reason: denyReason(harmfulKill.killTarget, harmfulKill.hits) };
};
