// Reads one Claude Code transcript or Codex rollout and counts how often each repo shows up in the work itself:
// working folders, tool and command inputs, edited files, and the user's own prompts.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { decodeJsonLine, isRecord } from "./json-lines.js";

export type RepoMatchers = {
  readonly matchPaths: (text: string) => ReadonlySet<string>;
  readonly matchKeywords: (prompt: string) => ReadonlySet<string>;
};

export type SessionEvidence = {
  readonly pathHits: ReadonlyMap<string, number>;
  readonly promptHits: ReadonlyMap<string, number>;
  readonly firstPrompt: string;
};

// Pasted logs can be huge; the repo a prompt is about shows up near its start.
const PROMPT_SCAN_CHARACTERS = 4_000;
// A heredoc can carry a whole file; the paths a command works on come first.
const COMMAND_SCAN_CHARACTERS = 4_000;
const COMMAND_WORD_SEPARATORS = /[\s;&|()<>"'`=,{}[\]]+/u;

const recordAt = (record: Record<string, unknown>, property: string): Record<string, unknown> => {
  const candidate = record[property];
  return isRecord(candidate) ? candidate : {};
};

const textAt = (record: Record<string, unknown>, property: string): string => {
  const candidate = record[property];
  return typeof candidate === "string" ? candidate : "";
};

const textBlocks = (content: unknown): ReadonlyArray<Record<string, unknown>> =>
  Array.isArray(content) ? content.filter(isRecord) : [];

type LineSignals = { readonly pathTexts: ReadonlyArray<string>; readonly prompts: ReadonlyArray<string> };

// Codex records a command's folder as a file:// URL, Claude Code as a plain path.
const folderPath = (folder: string): string => {
  if (!folder.startsWith("file://")) {
    return folder;
  }

  try {
    return fileURLToPath(folder);
  } catch {
    return "";
  }
};

type CommandPlace = { readonly folder: string; readonly homeRoot: string };

const resolvedWord = (request: CommandPlace & { readonly word: string }): string => {
  if (request.word.startsWith("~/")) {
    return path.join(request.homeRoot, request.word.slice(2));
  }

  return path.isAbsolute(request.word) || !request.folder ? request.word : path.join(request.folder, request.word);
};

// `cat vybekiit/package.json` run in ~/Desktop/Code reads ~/Desktop/Code/vybekiit/package.json, but the path matcher
// only knows absolute repo roots, so relative and ~ words are resolved against the folder the command ran in.
const resolvedPaths = (request: CommandPlace & { readonly text: string }): string =>
  request.text
    .slice(0, COMMAND_SCAN_CHARACTERS)
    .replace(/\\[nt]/gu, " ")
    .split(COMMAND_WORD_SEPARATORS)
    .filter((word) => word && !word.startsWith("-"))
    .map((word) => resolvedWord({ ...request, word }))
    .join(" ");

const claudePrompts = (line: Record<string, unknown>): ReadonlyArray<string> => {
  if (line.type !== "user" || line.isMeta === true) {
    return [];
  }

  const content = recordAt(line, "message").content;
  if (typeof content === "string") {
    return [content];
  }

  return textBlocks(content)
    .filter((block) => block.type === "text")
    .map((block) => textAt(block, "text"));
};

const claudeToolInputs = (line: Record<string, unknown>): ReadonlyArray<string> =>
  line.type === "assistant"
    ? textBlocks(recordAt(line, "message").content)
        .filter((block) => block.type === "tool_use")
        .map((block) => JSON.stringify(block.input))
    : [];

const claudeSignalsIn =
  (homeRoot: string) =>
  (line: Record<string, unknown>): LineSignals => {
    const folder = textAt(line, "cwd");
    const toolInputs = claudeToolInputs(line);
    const resolvedInputs = toolInputs.map((text) => resolvedPaths({ text, folder, homeRoot }));
    return { pathTexts: [folder, ...toolInputs, ...resolvedInputs].filter(Boolean), prompts: claudePrompts(line) };
  };

const commandText = (item: Record<string, unknown>): string =>
  Array.isArray(item.command) ? item.command.join(" ") : textAt(item, "command");

const codexItemSignals = (request: { readonly item: Record<string, unknown>; readonly homeRoot: string }) => {
  const { item } = request;
  switch (item.type) {
    case "CommandExecution": {
      const folder = folderPath(textAt(item, "cwd"));
      const command = commandText(item);
      const resolved = resolvedPaths({ text: command, folder, homeRoot: request.homeRoot });
      return { pathTexts: [folder, command, resolved], prompts: [] };
    }
    case "FileChange":
      return { pathTexts: Object.keys(recordAt(item, "changes")), prompts: [] };
    case "ImageView":
      return { pathTexts: [textAt(item, "path")], prompts: [] };
    case "UserMessage":
      return { pathTexts: [], prompts: textBlocks(item.content).map((block) => textAt(block, "text")) };
    default:
      return { pathTexts: [], prompts: [] };
  }
};

// Rollout lines wrap their content in a `payload` object; tool calls carry their input as a string.
const codexSignalsIn =
  (homeRoot: string) =>
  (line: Record<string, unknown>): LineSignals => {
    const lineContent = recordAt(line, "payload");
    switch (line.type) {
      case "turn_context":
        return { pathTexts: [folderPath(textAt(lineContent, "cwd"))], prompts: [] };
      case "event_msg":
        return lineContent.type === "item_completed"
          ? codexItemSignals({ item: recordAt(lineContent, "item"), homeRoot })
          : { pathTexts: [], prompts: [] };
      case "response_item":
        return { pathTexts: [textAt(lineContent, "input"), textAt(lineContent, "arguments")], prompts: [] };
      default:
        return { pathTexts: [], prompts: [] };
    }
  };

const tally = (repoSets: ReadonlyArray<ReadonlySet<string>>): ReadonlyMap<string, number> => {
  const counts = new Map<string, number>();
  for (const repoNames of repoSets) {
    for (const repoName of repoNames) {
      counts.set(repoName, (counts.get(repoName) || 0) + 1);
    }
  }
  return counts;
};

const collectEvidence = (request: {
  readonly transcriptFile: string;
  readonly matchers: RepoMatchers;
  readonly signalsOf: (line: Record<string, unknown>) => LineSignals;
}): SessionEvidence => {
  const pathRepoSets: Array<ReadonlySet<string>> = [];
  const promptRepoSets: Array<ReadonlySet<string>> = [];
  const prompts: Array<string> = [];
  for (const line of readFileSync(request.transcriptFile, "utf8").split("\n")) {
    const signals = line.trim() ? request.signalsOf(decodeJsonLine(line)) : { pathTexts: [], prompts: [] };
    // One line counts once per repo, however many paths of that repo it mentions.
    pathRepoSets.push(new Set(signals.pathTexts.flatMap((text) => [...request.matchers.matchPaths(text)])));
    prompts.push(...signals.prompts);
    promptRepoSets.push(
      ...signals.prompts.map((prompt) => request.matchers.matchKeywords(prompt.slice(0, PROMPT_SCAN_CHARACTERS))),
    );
  }
  const firstPrompt = prompts.find((prompt) => prompt.trim()) || "";
  return {
    pathHits: tally(pathRepoSets),
    promptHits: tally(promptRepoSets),
    firstPrompt: firstPrompt.trim().slice(0, 200),
  };
};

type EvidenceRequest = { readonly transcriptFile: string; readonly matchers: RepoMatchers; readonly homeRoot: string };

export const readClaudeEvidence = (request: EvidenceRequest): SessionEvidence =>
  collectEvidence({ ...request, signalsOf: claudeSignalsIn(request.homeRoot) });

export const readCodexEvidence = (request: EvidenceRequest): SessionEvidence =>
  collectEvidence({ ...request, signalsOf: codexSignalsIn(request.homeRoot) });
