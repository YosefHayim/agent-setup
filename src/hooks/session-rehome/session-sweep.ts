// One pass over Claude Code sessions and Codex threads: decide where each belongs, then move, keep, or delete it
// and write the decision to the ledger.

import { existsSync } from "node:fs";
import path from "node:path";

import { createPathMatcher } from "../path-matcher.js";
import { type RepoMatchers, readClaudeEvidence, readCodexEvidence, type SessionEvidence } from "../session-evidence.js";
import {
  type ClaudeSession,
  claudeSessionIsLive,
  deleteClaudeSessions,
  findClaudeSession,
  listClaudeSessions,
  moveClaudeSession,
  removeEmptyProjectFolder,
} from "./claude-sessions.js";
import {
  type CodexThread,
  codexThreadIsLive,
  deleteCodexThread,
  listCodexThreads,
  moveCodexThread,
} from "./codex-threads.js";
import { createKeywordMatcher, type Repo, repoContaining, repoNamedByFolder } from "./local-repos.js";
import { decideRehome, deletedReposDominate, type RepoScore, scoreSession } from "./rehome-decision.js";
import {
  type LedgerDecision,
  type LedgerEntry,
  ledgerEntryFor,
  type RehomeAgent,
  readLedger,
  recordLedgerEntry,
} from "./rehome-ledger.js";

export type SweepRequest = {
  readonly homeRoot: string;
  readonly repos: ReadonlyArray<Repo>;
  readonly agents: ReadonlyArray<RehomeAgent>;
  /** Empty sweeps every session. */
  readonly sessionId: string;
  /** Re-decide sessions the ledger already settled. */
  readonly reevaluate: boolean;
  readonly dryRun: boolean;
  readonly deletedRepoNames: ReadonlySet<string>;
  /** Session ID (or an unambiguous prefix) → repo name, for sessions the user placed by hand. */
  readonly assignments: ReadonlyMap<string, string>;
  /** A transcript written this recently may still belong to a running agent. */
  readonly quietSeconds: number;
};

type SessionAction = "move" | "stay" | "uncertain" | "no-signal" | "delete" | "live";

export type SessionPlan = {
  readonly agent: RehomeAgent;
  readonly sessionId: string;
  readonly title: string;
  readonly fromFolder: string;
  readonly action: SessionAction;
  readonly toFolder: string;
  readonly repoName: string;
  readonly share: number;
  readonly candidates: ReadonlyArray<RepoScore>;
  /**
   * What applying the plan recorded; "planned" in a dry run, "skipped" for a live session, "failed" when a move or
   * delete threw or Codex refused a delete (left unrecorded, so the next sweep retries it).
   */
  readonly status: LedgerDecision | "planned" | "skipped" | "failed";
};

// The ledger and matchers are built once per sweep and shared by every session.
type SweepContext = SweepRequest & {
  readonly matchers: RepoMatchers;
  readonly ledger: ReadonlyMap<string, LedgerEntry>;
};

type Placement = Pick<SessionPlan, "action" | "toFolder" | "repoName" | "share" | "candidates">;

const placement = (request: Partial<Placement> & Pick<Placement, "action">): Placement => ({
  toFolder: "",
  repoName: "",
  share: 0,
  candidates: [],
  ...request,
});

// A repo's own root or a live git worktree of it is a folder its sessions can stay in; any other subfolder, or a
// deleted worktree, is not where `/resume` or `codex resume` would look.
const isOwnCheckout = (request: { readonly repo: Repo; readonly folder: string }): boolean =>
  request.folder === request.repo.root || existsSync(path.join(request.folder, ".git"));

const assignedRepoFor = (request: { readonly sweep: SweepContext; readonly sessionId: string }): Repo | undefined => {
  const assignedName = [...request.sweep.assignments].find(([idPrefix]) => request.sessionId.startsWith(idPrefix))?.[1];
  return request.sweep.repos.find((repo) => repo.name === assignedName);
};

const placeSession = (request: {
  readonly sweep: SweepContext;
  readonly sessionId: string;
  readonly homeFolder: string;
  readonly evidence: SessionEvidence;
}): Placement => {
  const { repos, deletedRepoNames } = request.sweep;
  const assigned = assignedRepoFor(request);
  if (assigned) {
    return placement({ action: "move", toFolder: assigned.root, repoName: assigned.name, share: 1 });
  }

  const homeRepo = repoContaining({ repos, folder: request.homeFolder });
  const folderRepo = homeRepo ? undefined : repoNamedByFolder({ repos, folder: request.homeFolder });
  const scores = scoreSession({ evidence: request.evidence, folderRepoName: folderRepo?.name });
  const decision = decideRehome({ scores, homeRepoName: homeRepo?.name });
  const ownerName =
    decision._tag === "move" || decision._tag === "stay" ? decision.repoName : (homeRepo || folderRepo)?.name;
  const deletedOwner = ownerName && deletedRepoNames.has(ownerName) ? ownerName : undefined;
  const dominantDeleted = deletedReposDominate({ scores, deletedRepoNames })
    ? scores.find((repoScore) => deletedRepoNames.has(repoScore.repoName))?.repoName
    : undefined;
  if (deletedOwner || dominantDeleted) {
    return placement({ action: "delete", repoName: deletedOwner || dominantDeleted, candidates: scores.slice(0, 3) });
  }

  switch (decision._tag) {
    case "move": {
      const target = repos.find((repo) => repo.name === decision.repoName);
      return placement({
        action: "move",
        toFolder: target?.root || "",
        repoName: decision.repoName,
        share: decision.share,
      });
    }
    case "stay":
      return homeRepo && !isOwnCheckout({ repo: homeRepo, folder: request.homeFolder })
        ? placement({ action: "move", toFolder: homeRepo.root, repoName: homeRepo.name, share: 1 })
        : placement({ action: "stay", toFolder: request.homeFolder, repoName: decision.repoName });
    case "uncertain":
      return placement({ action: "uncertain", candidates: decision.candidates });
    case "noSignal":
      return placement({ action: "no-signal" });
  }
};

const isSettled = (request: {
  readonly sweep: SweepContext;
  readonly agent: RehomeAgent;
  readonly sessionId: string;
}) =>
  !request.sweep.reevaluate &&
  !assignedRepoFor(request) &&
  ledgerEntryFor({ ledger: request.sweep.ledger, agent: request.agent, sessionId: request.sessionId }) !== undefined;

const livePlan = (request: {
  readonly agent: RehomeAgent;
  readonly sessionId: string;
  readonly homeFolder: string;
}): SessionPlan => ({
  ...request,
  ...placement({ action: "live" }),
  title: "",
  fromFolder: request.homeFolder,
  status: "skipped",
});

const planClaudeSession = (request: { readonly sweep: SweepContext; readonly session: ClaudeSession }) => {
  const { session, sweep } = request;
  if (claudeSessionIsLive({ homeRoot: sweep.homeRoot, session, quietSeconds: sweep.quietSeconds })) {
    return livePlan({ agent: "claude-code", sessionId: session.sessionId, homeFolder: session.homeFolder });
  }

  const evidence = readClaudeEvidence({
    transcriptFile: session.transcriptFile,
    matchers: sweep.matchers,
    homeRoot: sweep.homeRoot,
  });
  return {
    agent: "claude-code" as const,
    sessionId: session.sessionId,
    title: evidence.firstPrompt,
    fromFolder: session.homeFolder,
    ...placeSession({ sweep, sessionId: session.sessionId, homeFolder: session.homeFolder, evidence }),
    status: "planned" as const,
  };
};

const planCodexThread = async (request: { readonly sweep: SweepContext; readonly thread: CodexThread }) => {
  const { thread, sweep } = request;
  if (await codexThreadIsLive({ homeRoot: sweep.homeRoot, thread, quietSeconds: sweep.quietSeconds })) {
    return livePlan({ agent: "codex", sessionId: thread.threadId, homeFolder: thread.homeFolder });
  }

  const evidence = readCodexEvidence({
    transcriptFile: thread.rolloutFile,
    matchers: sweep.matchers,
    homeRoot: sweep.homeRoot,
  });
  return {
    agent: "codex" as const,
    sessionId: thread.threadId,
    title: thread.title.slice(0, 200) || evidence.firstPrompt,
    fromFolder: thread.homeFolder,
    ...placeSession({ sweep, sessionId: thread.threadId, homeFolder: thread.homeFolder, evidence }),
    status: "planned" as const,
  };
};

const recordPlan = (request: { readonly plan: SessionPlan; readonly decision: LedgerDecision }): SessionPlan => {
  const { plan } = request;
  recordLedgerEntry({
    agent: plan.agent,
    sessionId: plan.sessionId,
    decision: request.decision,
    title: plan.title,
    fromFolder: plan.fromFolder,
    toFolder: plan.toFolder,
    repoName: plan.repoName,
    share: plan.share,
    decidedAt: new Date().toISOString(),
    notifiedAt: "",
  });
  return { ...plan, status: request.decision };
};

const KEPT_DECISIONS: Readonly<Record<"stay" | "uncertain" | "no-signal", LedgerDecision>> = {
  stay: "stayed",
  uncertain: "uncertain",
  "no-signal": "no-signal",
};

const applyClaudePlan = (request: {
  readonly sweep: SweepContext;
  readonly session: ClaudeSession;
  readonly plan: SessionPlan;
}): SessionPlan => {
  const { plan } = request;
  switch (plan.action) {
    case "live":
      return plan;
    case "delete":
      deleteClaudeSessions({ homeRoot: request.sweep.homeRoot, sessions: [request.session] });
      return recordPlan({ plan, decision: "deleted" });
    case "move": {
      const move = moveClaudeSession({
        homeRoot: request.sweep.homeRoot,
        session: request.session,
        targetFolder: plan.toFolder,
      });
      return recordPlan({ plan, decision: move._tag === "moved" ? "moved" : "conflict" });
    }
    default:
      return recordPlan({ plan, decision: KEPT_DECISIONS[plan.action] });
  }
};

const applyCodexPlan = async (request: {
  readonly sweep: SweepContext;
  readonly thread: CodexThread;
  readonly plan: SessionPlan;
}): Promise<SessionPlan> => {
  const { plan } = request;
  switch (plan.action) {
    case "live":
      return plan;
    case "delete": {
      const deletions = await deleteCodexThread({ homeRoot: request.sweep.homeRoot, thread: request.thread });
      return deletions.every((deletion) => deletion.deleted)
        ? recordPlan({ plan, decision: "deleted" })
        : { ...plan, status: "failed" };
    }
    case "move":
      await moveCodexThread({ homeRoot: request.sweep.homeRoot, thread: request.thread, targetFolder: plan.toFolder });
      return recordPlan({ plan, decision: "moved" });
    default:
      return recordPlan({ plan, decision: KEPT_DECISIONS[plan.action] });
  }
};

// One session that cannot be moved or deleted must not stop the rest of the sweep; the next sweep retries it.
const applyClaudePlanSafely = (request: Parameters<typeof applyClaudePlan>[0]): SessionPlan => {
  try {
    return applyClaudePlan(request);
  } catch {
    return { ...request.plan, status: "failed" };
  }
};

const applyCodexPlanSafely = async (request: Parameters<typeof applyCodexPlan>[0]): Promise<SessionPlan> => {
  try {
    return await applyCodexPlan(request);
  } catch {
    return { ...request.plan, status: "failed" };
  }
};

const claudeSessionsToSweep = (sweep: SweepContext): ReadonlyArray<ClaudeSession> => {
  if (!sweep.sessionId) {
    return listClaudeSessions(sweep.homeRoot);
  }

  const session = findClaudeSession({ homeRoot: sweep.homeRoot, sessionId: sweep.sessionId });
  return session ? [session] : [];
};

const sweepClaude = (sweep: SweepContext): ReadonlyArray<SessionPlan> =>
  claudeSessionsToSweep(sweep)
    .filter((session) => !isSettled({ sweep, agent: "claude-code", sessionId: session.sessionId }))
    .map((session) => {
      const plan = planClaudeSession({ sweep, session });
      return sweep.dryRun ? plan : applyClaudePlanSafely({ sweep, session, plan });
    });

// A thread the ledger moved can drift back when Codex rebuilds its row from an older rollout; put it back.
const driftedCodexPlan = (request: { readonly sweep: SweepContext; readonly thread: CodexThread }) => {
  const entry = ledgerEntryFor({ ledger: request.sweep.ledger, agent: "codex", sessionId: request.thread.threadId });
  if (entry?.decision !== "moved" || entry.toFolder === request.thread.homeFolder) {
    return undefined;
  }

  return {
    agent: "codex" as const,
    sessionId: request.thread.threadId,
    title: entry.title,
    fromFolder: request.thread.homeFolder,
    ...placement({ action: "move", toFolder: entry.toFolder, repoName: entry.repoName, share: entry.share }),
    status: "planned" as const,
  };
};

const planCodexSweepEntry = async (request: { readonly sweep: SweepContext; readonly thread: CodexThread }) => {
  const drifted = request.sweep.reevaluate ? undefined : driftedCodexPlan(request);
  const live = drifted
    ? await codexThreadIsLive({ homeRoot: request.sweep.homeRoot, thread: request.thread, quietSeconds: 0 })
    : false;
  if (drifted && !live) {
    return drifted;
  }

  return isSettled({ sweep: request.sweep, agent: "codex", sessionId: request.thread.threadId })
    ? undefined
    : planCodexThread(request);
};

const sweepCodex = async (sweep: SweepContext): Promise<ReadonlyArray<SessionPlan>> => {
  const threads = (await listCodexThreads(sweep.homeRoot)).filter(
    (thread) => !sweep.sessionId || thread.threadId === sweep.sessionId,
  );
  const plans: Array<SessionPlan> = [];
  for (const thread of threads) {
    const plan = await planCodexSweepEntry({ sweep, thread });
    if (plan) {
      plans.push(sweep.dryRun ? plan : await applyCodexPlanSafely({ sweep, thread, plan }));
    }
  }
  return plans;
};

export const runSweep = async (request: SweepRequest): Promise<ReadonlyArray<SessionPlan>> => {
  const sweep: SweepContext = {
    ...request,
    matchers: { matchPaths: createPathMatcher(request.repos), matchKeywords: createKeywordMatcher(request.repos) },
    ledger: readLedger(),
  };
  const claudePlans = sweep.agents.includes("claude-code") ? sweepClaude(sweep) : [];
  const codexPlans = sweep.agents.includes("codex") ? await sweepCodex(sweep) : [];
  if (!sweep.dryRun) {
    for (const repo of sweep.repos.filter((candidate) => sweep.deletedRepoNames.has(candidate.name))) {
      removeEmptyProjectFolder({ homeRoot: sweep.homeRoot, folder: repo.root });
    }
  }
  return [...claudePlans, ...codexPlans];
};
