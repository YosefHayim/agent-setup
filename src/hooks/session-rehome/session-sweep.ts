import { existsSync } from "node:fs";
import path from "node:path";

import { createPathMatcher } from "../path-matcher.js";
import { type RepoMatchers, readClaudeEvidence, readCodexEvidence, type SessionEvidence } from "../session-evidence.js";
import {
  type ClaudeSession,
  deleteClaudeSessions,
  findClaudeSession,
  isClaudeSessionLive,
  listClaudeSessions,
  moveClaudeSession,
  removeEmptyProjectFolder,
} from "./claude-sessions.js";
import {
  type CodexThread,
  deleteCodexThread,
  isCodexThreadLive,
  listCodexThreads,
  moveCodexThread,
} from "./codex-threads.js";
import { createKeywordMatcher, type Repo, readRepoContaining, readRepoNamedByFolder } from "./local-repos.js";
import { decideRehome, isDeletedReposDominate, type RepoScore, scoreSession } from "./rehome-decision.js";
import {
  type LedgerDecision,
  type LedgerLine,
  type RehomeAgent,
  readLedger,
  readLedgerLine,
  saveLedgerLine,
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
type SweepScope = SweepRequest & {
  readonly matchers: RepoMatchers;
  readonly ledger: ReadonlyMap<string, LedgerLine>;
};

type Placement = Pick<SessionPlan, "action" | "toFolder" | "repoName" | "share" | "candidates">;

const readPlacement = (request: Partial<Placement> & Pick<Placement, "action">): Placement => ({
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

const readAssignedRepo = (request: { readonly sweep: SweepScope; readonly sessionId: string }): Repo | null => {
  const assignedName = [...request.sweep.assignments].find(([idPrefix]) => request.sessionId.startsWith(idPrefix))?.[1];
  return request.sweep.repos.find((repo) => repo.name === assignedName) ?? null;
};

const placeSession = (request: {
  readonly sweep: SweepScope;
  readonly sessionId: string;
  readonly homeFolder: string;
  readonly evidence: SessionEvidence;
}): Placement => {
  const { repos, deletedRepoNames } = request.sweep;

  const isAssigned = readAssignedRepo(request);
  if (isAssigned) {
    return readPlacement({ action: "move", toFolder: isAssigned.root, repoName: isAssigned.name, share: 1 });
  }

  const homeRepo = readRepoContaining({ repos, folder: request.homeFolder });

  const isHomeRepoMissing = homeRepo == null;
  const folderRepo = isHomeRepoMissing ? readRepoNamedByFolder({ repos, folder: request.homeFolder }) : null;
  const scores = scoreSession({ evidence: request.evidence, folderRepoName: folderRepo?.name ?? null });
  const decision = decideRehome({ scores, homeRepoName: homeRepo?.name });
  const isDecisionMoveOrStay = decision._tag === "move" || decision._tag === "stay";
  const ownerName = isDecisionMoveOrStay ? decision.repoName : (homeRepo || folderRepo)?.name;

  const isOwnerDeleted = ownerName && deletedRepoNames.has(ownerName);
  const deletedOwner = isOwnerDeleted ? ownerName : undefined;

  const dominantDeleted = isDeletedReposDominate({ scores, deletedRepoNames })
    ? scores.find((repoScore) => deletedRepoNames.has(repoScore.repoName))?.repoName
    : undefined;

  const isDeletedOwnerOrDominant = deletedOwner || dominantDeleted;
  if (isDeletedOwnerOrDominant) {
    return readPlacement({
      action: "delete",
      repoName: deletedOwner || dominantDeleted,
      candidates: scores.slice(0, 3),
    });
  }

  switch (decision._tag) {
    case "move": {
      const target = repos.find((repo) => repo.name === decision.repoName);
      return readPlacement({
        action: "move",
        toFolder: target?.root || "",
        repoName: decision.repoName,
        share: decision.share,
      });
    }
    case "stay": {
      const isHomeRepoElsewhere = homeRepo != null && !isOwnCheckout({ repo: homeRepo, folder: request.homeFolder });
      return isHomeRepoElsewhere
        ? readPlacement({ action: "move", toFolder: homeRepo.root, repoName: homeRepo.name, share: 1 })
        : readPlacement({ action: "stay", toFolder: request.homeFolder, repoName: decision.repoName });
    }
    case "uncertain":
      return readPlacement({ action: "uncertain", candidates: decision.candidates });
    case "noSignal":
      return readPlacement({ action: "no-signal" });
  }
};

const isSettled = (request: { readonly sweep: SweepScope; readonly agent: RehomeAgent; readonly sessionId: string }) =>
  !request.sweep.reevaluate &&
  !readAssignedRepo(request) &&
  readLedgerLine({ ledger: request.sweep.ledger, agent: request.agent, sessionId: request.sessionId }) != null;

const readLivePlan = (request: {
  readonly agent: RehomeAgent;
  readonly sessionId: string;
  readonly homeFolder: string;
}): SessionPlan => ({
  ...request,
  ...readPlacement({ action: "live" }),
  title: "",
  fromFolder: request.homeFolder,
  status: "skipped",
});

const planClaudeSession = (request: { readonly sweep: SweepScope; readonly session: ClaudeSession }) => {
  const { session, sweep } = request;

  const isClaudeLive = isClaudeSessionLive({ homeRoot: sweep.homeRoot, session, quietSeconds: sweep.quietSeconds });
  if (isClaudeLive) {
    return readLivePlan({ agent: "claude-code", sessionId: session.sessionId, homeFolder: session.homeFolder });
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

const planCodexThread = async (request: { readonly sweep: SweepScope; readonly thread: CodexThread }) => {
  const { thread, sweep } = request;

  const isCodexLive = await isCodexThreadLive({ homeRoot: sweep.homeRoot, thread, quietSeconds: sweep.quietSeconds });
  if (isCodexLive) {
    return readLivePlan({ agent: "codex", sessionId: thread.threadId, homeFolder: thread.homeFolder });
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

const savePlan = (request: { readonly plan: SessionPlan; readonly decision: LedgerDecision }): SessionPlan => {
  const { plan } = request;
  saveLedgerLine({
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
  readonly sweep: SweepScope;
  readonly session: ClaudeSession;
  readonly plan: SessionPlan;
}): SessionPlan => {
  const { plan } = request;
  switch (plan.action) {
    case "live":
      return plan;
    case "delete":
      deleteClaudeSessions({ homeRoot: request.sweep.homeRoot, sessions: [request.session] });
      return savePlan({ plan, decision: "deleted" });
    case "move": {
      const move = moveClaudeSession({
        homeRoot: request.sweep.homeRoot,
        session: request.session,
        targetFolder: plan.toFolder,
      });

      const isMoveDone = move._tag === "moved";
      return savePlan({ plan, decision: isMoveDone ? "moved" : "conflict" });
    }
    default:
      return savePlan({ plan, decision: KEPT_DECISIONS[plan.action] });
  }
};

const applyCodexPlan = async (request: {
  readonly sweep: SweepScope;
  readonly thread: CodexThread;
  readonly plan: SessionPlan;
}): Promise<SessionPlan> => {
  const { plan } = request;
  switch (plan.action) {
    case "live":
      return plan;
    case "delete": {
      const deletions = await deleteCodexThread({ homeRoot: request.sweep.homeRoot, thread: request.thread });
      const hasEveryDeletionSucceeded = deletions.every((deletion) => deletion.deleted);
      return hasEveryDeletionSucceeded ? savePlan({ plan, decision: "deleted" }) : { ...plan, status: "failed" };
    }
    case "move":
      await moveCodexThread({ homeRoot: request.sweep.homeRoot, thread: request.thread, targetFolder: plan.toFolder });
      return savePlan({ plan, decision: "moved" });
    default:
      return savePlan({ plan, decision: KEPT_DECISIONS[plan.action] });
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

const listClaudeSessionsToSweep = (sweep: SweepScope): ReadonlyArray<ClaudeSession> => {
  const isSweepSessionIdMissing = !sweep.sessionId;
  if (isSweepSessionIdMissing) {
    return listClaudeSessions(sweep.homeRoot);
  }

  const session = findClaudeSession({ homeRoot: sweep.homeRoot, sessionId: sweep.sessionId });

  const isSessionFound = session != null;
  return isSessionFound ? [session] : [];
};

const listSweepClaude = (sweep: SweepScope): ReadonlyArray<SessionPlan> =>
  listClaudeSessionsToSweep(sweep)
    .filter((session) => !isSettled({ sweep, agent: "claude-code", sessionId: session.sessionId }))
    .map((session) => {
      const plan = planClaudeSession({ sweep, session });

      const isDryRun = sweep.dryRun;
      return isDryRun ? plan : applyClaudePlanSafely({ sweep, session, plan });
    });

// A thread the ledger moved can drift back when Codex rebuilds its row from an older rollout; put it back.
const readDriftedCodexPlan = (request: { readonly sweep: SweepScope; readonly thread: CodexThread }) => {
  const line = readLedgerLine({ ledger: request.sweep.ledger, agent: "codex", sessionId: request.thread.threadId });

  const hasNoMoveToHome = line?.decision !== "moved" || line.toFolder === request.thread.homeFolder;
  if (hasNoMoveToHome) {
    return null;
  }

  return {
    agent: "codex" as const,
    sessionId: request.thread.threadId,
    title: line.title,
    fromFolder: request.thread.homeFolder,
    ...readPlacement({ action: "move", toFolder: line.toFolder, repoName: line.repoName, share: line.share }),
    status: "planned" as const,
  };
};

const planCodexSweepLine = async (request: { readonly sweep: SweepScope; readonly thread: CodexThread }) => {
  const shouldReevaluate = request.sweep.reevaluate;
  const isDrifted = shouldReevaluate ? null : readDriftedCodexPlan(request);

  const live = isDrifted
    ? await isCodexThreadLive({ homeRoot: request.sweep.homeRoot, thread: request.thread, quietSeconds: 0 })
    : false;

  const isDriftedAndNotLive = isDrifted && !live;
  if (isDriftedAndNotLive) {
    return isDrifted;
  }

  return isSettled({ sweep: request.sweep, agent: "codex", sessionId: request.thread.threadId })
    ? null
    : planCodexThread(request);
};

const listSweepCodex = async (sweep: SweepScope): Promise<ReadonlyArray<SessionPlan>> => {
  const threads = (await listCodexThreads(sweep.homeRoot)).filter(
    (thread) => !sweep.sessionId || thread.threadId === sweep.sessionId,
  );
  const plans: Array<SessionPlan> = [];
  for (const thread of threads) {
    const plan = await planCodexSweepLine({ sweep, thread });

    const isPlanMissing = plan == null;
    if (isPlanMissing) continue;

    const isDryRun = sweep.dryRun;
    if (isDryRun) {
      plans.push(plan);
      continue;
    }

    const appliedPlan = await applyCodexPlanSafely({ sweep, thread, plan });
    plans.push(appliedPlan);
  }
  return plans;
};

export const runSweep = async (request: SweepRequest): Promise<ReadonlyArray<SessionPlan>> => {
  const sweep: SweepScope = {
    ...request,
    matchers: { matchPaths: createPathMatcher(request.repos), matchKeywords: createKeywordMatcher(request.repos) },
    ledger: readLedger(),
  };

  const isClaudeCodeSwept = sweep.agents.includes("claude-code");
  const claudePlans = isClaudeCodeSwept ? listSweepClaude(sweep) : [];

  const isCodexSwept = sweep.agents.includes("codex");
  const codexPlans = isCodexSwept ? await listSweepCodex(sweep) : [];

  const isSweepDryRunMissing = !sweep.dryRun;
  if (isSweepDryRunMissing) {
    for (const repo of sweep.repos.filter((candidate) => sweep.deletedRepoNames.has(candidate.name))) {
      removeEmptyProjectFolder({ homeRoot: sweep.homeRoot, folder: repo.root });
    }
  }

  return [...claudePlans, ...codexPlans];
};
