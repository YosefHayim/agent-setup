import { spawnSync } from "node:child_process";

import { reportLine } from "./reportLine.js";

type ToolPrune = { readonly tool: string; readonly pruneArguments: ReadonlyArray<string> };

// Answers only when the tool is installed.
const READY_ARGUMENTS = ["--version"];
const READY_TIMEOUT_MILLISECONDS = 10_000;
const PRUNE_TIMEOUT_MILLISECONDS = 10 * 60 * 1_000;

// Each tool drops only what nothing uses: simulators for runtimes that are gone, store packages no project links, and
// cache entries no lock file names. Docker is left alone: its prune clears the whole engine, which other sessions share.
const TOOL_PRUNES: ReadonlyArray<ToolPrune> = [
  { tool: "xcrun", pruneArguments: ["simctl", "delete", "unavailable"] },
  { tool: "pnpm", pruneArguments: ["store", "prune"] },
  { tool: "uv", pruneArguments: ["cache", "prune"] },
];

const toolCall = (request: {
  readonly tool: string;
  readonly toolArguments: ReadonlyArray<string>;
  readonly timeoutMilliseconds: number;
}) => spawnSync(request.tool, request.toolArguments, { stdio: "ignore", timeout: request.timeoutMilliseconds });

const isReady = (prune: ToolPrune): boolean => {
  const readyCall = toolCall({
    tool: prune.tool,
    toolArguments: READY_ARGUMENTS,
    timeoutMilliseconds: READY_TIMEOUT_MILLISECONDS,
  });
  return readyCall.error === undefined && readyCall.status === 0;
};

const runPrune = (request: { readonly prune: ToolPrune; readonly dryRun: boolean }): ReadonlyArray<string> => {
  const { prune } = request;
  const command = [prune.tool, ...prune.pruneArguments].join(" ");
  if (!isReady(prune)) {
    return [];
  }

  if (request.dryRun) {
    return [reportLine({ action: "would run", detail: "tool prune", target: command })];
  }

  const pruneCall = toolCall({
    tool: prune.tool,
    toolArguments: prune.pruneArguments,
    timeoutMilliseconds: PRUNE_TIMEOUT_MILLISECONDS,
  });
  const action = pruneCall.error === undefined && pruneCall.status === 0 ? "ran" : "failed";
  return [reportLine({ action, detail: "tool prune", target: command })];
};

// A tool that is not installed is skipped without a word.
export const runToolPrunes = (request: { readonly dryRun: boolean }): ReadonlyArray<string> =>
  TOOL_PRUNES.flatMap((prune) => runPrune({ prune, dryRun: request.dryRun }));
