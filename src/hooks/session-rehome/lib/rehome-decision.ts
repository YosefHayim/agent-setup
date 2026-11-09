// Pure policy: which repo a session belongs to, given how often each repo appeared in its work.

import type { SessionEvidence } from "../../lib/session-evidence.js";

export type RepoScore = {
  readonly repoName: string;
  readonly score: number;
  readonly share: number;
  /** Lines whose working folder, file, or command touched the repo, as opposed to prompts that only name it. */
  readonly pathHits: number;
};

export type RehomeDecision =
  | { readonly _tag: "move"; readonly repoName: string; readonly share: number }
  | { readonly _tag: "stay"; readonly repoName: string }
  | { readonly _tag: "uncertain"; readonly candidates: ReadonlyArray<RepoScore> }
  | { readonly _tag: "noSignal" };

// A prompt naming a repo says more about intent than one path in one tool call.
const PROMPT_WEIGHT = 3;
// A session started in a folder named after a repo (a /tmp eval copy, a generated kit) leans toward that repo.
const FOLDER_NAME_WEIGHT = 10;
// Below this many weighted signals a session is too thin to move out of a repo, or to delete.
const MIN_SCORE = 10;
// A session started outside every repo is listed nowhere useful, so a short one moves once it touched the repo and a
// prompt or more files back that up. Prompts alone still need MIN_SCORE: some repo keywords, like "extensions", are
// ordinary words.
const MIN_SCORE_FROM_GENERIC = 4;
// A session started outside every repo moves when one repo owns this share of its signals.
const MOVE_FROM_GENERIC_SHARE = 0.6;
// A session already inside a repo moves only when another repo clearly dominates and its own barely appears.
const MOVE_FROM_REPO_SHARE = 0.75;
const MAX_HOME_SHARE_WHEN_MOVING = 0.15;

export const scoreSession = (request: {
  readonly evidence: SessionEvidence;
  readonly folderRepoName: string | undefined;
}): ReadonlyArray<RepoScore> => {
  const weighted = new Map<string, number>();
  for (const [repoName, hits] of request.evidence.pathHits) {
    weighted.set(repoName, (weighted.get(repoName) || 0) + hits);
  }
  for (const [repoName, hits] of request.evidence.promptHits) {
    weighted.set(repoName, (weighted.get(repoName) || 0) + hits * PROMPT_WEIGHT);
  }
  if (request.folderRepoName) {
    weighted.set(request.folderRepoName, (weighted.get(request.folderRepoName) || 0) + FOLDER_NAME_WEIGHT);
  }

  const total = [...weighted.values()].reduce((sum, score) => sum + score, 0);
  return [...weighted]
    .map(([repoName, score]) => ({
      repoName,
      score,
      share: total === 0 ? 0 : score / total,
      pathHits: request.evidence.pathHits.get(repoName) || 0,
    }))
    .sort((left, right) => right.score - left.score);
};

// Repos named for deletion count as one owner, so a session split between a project and its renamed predecessor
// still belongs to the deleted project.
export const deletedReposDominate = (request: {
  readonly scores: ReadonlyArray<RepoScore>;
  readonly deletedRepoNames: ReadonlySet<string>;
}): boolean => {
  const total = request.scores.reduce((sum, repoScore) => sum + repoScore.score, 0);
  const deletedScore = request.scores
    .filter((repoScore) => request.deletedRepoNames.has(repoScore.repoName))
    .reduce((sum, repoScore) => sum + repoScore.score, 0);
  return total >= MIN_SCORE && deletedScore / total >= MOVE_FROM_GENERIC_SHARE;
};

export const decideRehome = (request: {
  readonly scores: ReadonlyArray<RepoScore>;
  /** The repo the session already lives in, or undefined for a generic folder such as ~/Desktop/Code. */
  readonly homeRepoName: string | undefined;
}): RehomeDecision => {
  const [top] = request.scores;
  const total = request.scores.reduce((sum, repoScore) => sum + repoScore.score, 0);
  if (!top) {
    return { _tag: "noSignal" };
  }

  if (top.repoName === request.homeRepoName) {
    return { _tag: "stay", repoName: top.repoName };
  }

  if (request.homeRepoName === undefined) {
    const enoughSignal = total >= MIN_SCORE || (total >= MIN_SCORE_FROM_GENERIC && top.pathHits > 0);
    return enoughSignal && top.share >= MOVE_FROM_GENERIC_SHARE
      ? { _tag: "move", repoName: top.repoName, share: top.share }
      : { _tag: "uncertain", candidates: request.scores.slice(0, 3) };
  }

  const homeShare = request.scores.find((repoScore) => repoScore.repoName === request.homeRepoName)?.share || 0;
  return total >= MIN_SCORE && top.share >= MOVE_FROM_REPO_SHARE && homeShare <= MAX_HOME_SHARE_WHEN_MOVING
    ? { _tag: "move", repoName: top.repoName, share: top.share }
    : { _tag: "stay", repoName: request.homeRepoName };
};
