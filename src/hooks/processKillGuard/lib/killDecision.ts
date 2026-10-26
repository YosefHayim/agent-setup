import type { KillTarget } from "./killTargets.js";
import type { RunningProcess } from "./processTable.js";

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
const ancestorsOf = (
  child: RunningProcess,
  processesById: ReadonlyMap<number, RunningProcess>,
): ReadonlyArray<RunningProcess> => {
  const parent = processesById.get(child.parentProcessId);
  if (!parent || parent.processId <= 1) {
    return [];
  }

  const olderAncestors = ancestorsOf(parent, processesById);
  return [parent, ...olderAncestors];
};

const appProcessOf = (running: RunningProcess): ReadonlyArray<ProtectedProcess> => {
  const bundle = APP_BUNDLE.exec(running.commandLine);
  if (!bundle) {
    return [];
  }

  const [, appName = ""] = bundle;
  return [{ running, role: "app", label: appName }];
};

const firstPerProcess = (candidates: ReadonlyArray<ProtectedProcess>): ReadonlyArray<ProtectedProcess> =>
  candidates.filter(
    (candidate, index) =>
      candidates.findIndex((other) => other.running.processId === candidate.running.processId) === index,
  );

const protectedProcesses = (check: KillCheck): ReadonlyArray<ProtectedProcess> => {
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
    .flatMap((session) => ancestorsOf(session, processesById))
    .map((running): ProtectedProcess => ({ running, role: "terminal", label: running.name }));
  const appProcesses = check.processes.flatMap(appProcessOf);
  return firstPerProcess([...sessionProcesses, ...terminalProcesses, ...appProcesses]);
};

// A pattern names an app through its full name or one of its longer words, e.g. "chrome" names Google Chrome.
const namesApp = (killTarget: KillTarget, appName: string): boolean => {
  const patternText = killTarget.patterns.join(" ").toLowerCase();
  const lowerAppName = appName.toLowerCase();
  const appWords = lowerAppName.split(APP_NAME_WORD).filter((word) => word.length >= 3);
  return patternText.includes(lowerAppName) || appWords.some((word) => patternText.includes(word));
};

const processMatcher = (killTarget: KillTarget) => {
  const flags = killTarget.ignoresCase ? "i" : "";
  const expressions = killTarget.patterns.map((pattern) => {
    const source = killTarget.matchesWholeText ? `^(?:${pattern})$` : pattern;
    return new RegExp(source, flags);
  });
  return (running: RunningProcess): boolean => {
    const matchedText = killTarget.matchesFullCommand ? running.commandLine : running.name;
    const matchesAnyPattern = expressions.some((expression) => expression.test(matchedText));
    return matchesAnyPattern !== killTarget.inverted;
  };
};

const hitsOf = (killTarget: KillTarget, guarded: ReadonlyArray<ProtectedProcess>): ReadonlyArray<ProtectedProcess> => {
  const matchesTarget = processMatcher(killTarget);
  return guarded.filter(
    (candidate) =>
      !(candidate.role === "app" && namesApp(killTarget, candidate.label)) && matchesTarget(candidate.running),
  );
};

const roleSummary = (hits: ReadonlyArray<ProtectedProcess>, role: ProtectedRole): ReadonlyArray<string> => {
  const roleLabels = hits.filter((hit) => hit.role === role).map((hit) => hit.label);
  const uniqueLabels = [...new Set(roleLabels)];
  if (uniqueLabels.length === 0) {
    return [];
  }

  return [`${ROLE_HEADINGS[role]} (${uniqueLabels.join(", ")})`];
};

const denyReason = (killTarget: KillTarget, hits: ReadonlyArray<ProtectedProcess>): string => {
  const victims = PROTECTED_ROLES.flatMap((role) => roleSummary(hits, role));
  return [
    `process-kill-guard: \`${killTarget.commandWords}\` matches more than the processes you started.`,
    `It would also stop ${victims.join("; ")}.`,
    "Kill only what you started, by the pid you saved when you started it,",
    "or narrow the pattern until `pgrep -fl <pattern>` lists only your own processes. Do not retry with another broad pattern.",
  ].join(" ");
};

export const decideKill = (check: KillCheck): KillDecision => {
  const guarded = protectedProcesses(check);
  const judgedKills = check.killTargets.map((killTarget) => ({ killTarget, hits: hitsOf(killTarget, guarded) }));
  const harmfulKill = judgedKills.find((judgedKill) => judgedKill.hits.length > 0);
  if (!harmfulKill) {
    return { _tag: "allow" };
  }

  return { _tag: "deny", reason: denyReason(harmfulKill.killTarget, harmfulKill.hits) };
};
