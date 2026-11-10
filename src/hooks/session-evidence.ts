import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { decodeLine, isPlainObject } from "./json-lines.js";

export type RepoMatchers = {
  readonly matchPaths: (scannedString: string) => ReadonlySet<string>;
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

const saveAt = (fields: Record<string, unknown>, property: string): Record<string, unknown> => {
  const candidate = fields[property];
  return isPlainObject(candidate) ? candidate : {};
};

const readStringAt = (fields: Record<string, unknown>, property: string): string => {
  const candidate = fields[property];

  const isCandidateString = typeof candidate === "string";
  return isCandidateString ? candidate : "";
};

const listStringBlocks = (message: unknown): ReadonlyArray<Record<string, unknown>> => {
  const isMessageArray = Array.isArray(message);
  return isMessageArray ? message.filter(isPlainObject) : [];
};

type LineSignals = { readonly pathTexts: ReadonlyArray<string>; readonly prompts: ReadonlyArray<string> };

// Codex records a command's folder as a file:// URL, Claude Code as a plain path.
const readFolderPath = (folder: string): string => {
  const isNotFileFolder = !folder.startsWith("file://");
  if (isNotFileFolder) {
    return folder;
  }

  try {
    return fileURLToPath(folder);
  } catch {
    return "";
  }
};

type CommandPlace = { readonly folder: string; readonly homeRoot: string };

const readAbsoluteWord = (request: CommandPlace & { readonly word: string }): string => {
  const isHomeWord = request.word.startsWith("~/");
  if (isHomeWord) {
    return path.join(request.homeRoot, request.word.slice(2));
  }

  const isWordAbsoluteOrFolderless = path.isAbsolute(request.word) || !request.folder;
  return isWordAbsoluteOrFolderless ? request.word : path.join(request.folder, request.word);
};

// `cat vybekiit/package.json` run in ~/Desktop/Code reads ~/Desktop/Code/vybekiit/package.json, but the path matcher
// only knows absolute repo roots, so relative and ~ words are resolved against the folder the command ran in.
const readAbsolutePaths = (request: CommandPlace & { readonly text: string }): string =>
  request.text
    .slice(0, COMMAND_SCAN_CHARACTERS)
    .replace(/\\[nt]/gu, " ")
    .split(COMMAND_WORD_SEPARATORS)
    .filter((word) => word && !word.startsWith("-"))
    .map((word) => readAbsoluteWord({ ...request, word }))
    .join(" ");

const listClaudePrompts = (line: Record<string, unknown>): ReadonlyArray<string> => {
  const isNotUserLine = line.type !== "user" || line.isMeta === true;
  if (isNotUserLine) {
    return [];
  }

  const message = saveAt(line, "message").content;

  const isStringMessage = typeof message === "string";
  if (isStringMessage) {
    return [message];
  }

  return listStringBlocks(message)
    .filter((block) => block.type === "text")
    .map((block) => readStringAt(block, "text"));
};

const listClaudeToolDetailsList = (line: Record<string, unknown>): ReadonlyArray<string> => {
  const isAssistantLine = line.type === "assistant";
  return isAssistantLine
    ? listStringBlocks(saveAt(line, "message").content)
        .filter((block) => block.type === "tool_use")
        .map((block) => JSON.stringify(block.input))
    : [];
};

const readClaudeSignalsIn =
  (homeRoot: string) =>
  (line: Record<string, unknown>): LineSignals => {
    const folder = readStringAt(line, "cwd");
    const toolDetailsList = listClaudeToolDetailsList(line);
    const absoluteInputs = toolDetailsList.map((detail) => readAbsolutePaths({ text: detail, folder, homeRoot }));
    return {
      pathTexts: [folder, ...toolDetailsList, ...absoluteInputs].filter(Boolean),
      prompts: listClaudePrompts(line),
    };
  };

const readCommandString = (element: Record<string, unknown>): string => {
  const command = element.command;
  const isCommandArray = Array.isArray(command);
  return isCommandArray ? command.join(" ") : readStringAt(element, "command");
};

const readCodexElementSignals = (request: { readonly item: Record<string, unknown>; readonly homeRoot: string }) => {
  const { item: element } = request;
  switch (element.type) {
    case "CommandExecution": {
      const folder = readFolderPath(readStringAt(element, "cwd"));
      const command = readCommandString(element);
      const absolutePaths = readAbsolutePaths({ text: command, folder, homeRoot: request.homeRoot });
      return { pathTexts: [folder, command, absolutePaths], prompts: [] };
    }
    case "FileChange":
      return { pathTexts: Object.keys(saveAt(element, "changes")), prompts: [] };
    case "ImageView":
      return { pathTexts: [readStringAt(element, "path")], prompts: [] };
    case "UserMessage":
      return { pathTexts: [], prompts: listStringBlocks(element.content).map((block) => readStringAt(block, "text")) };
    default:
      return { pathTexts: [], prompts: [] };
  }
};

// Rollout lines wrap their content in a `payload` object; tool calls carry their input as a string.
const readCodexSignalsIn =
  (homeRoot: string) =>
  (line: Record<string, unknown>): LineSignals => {
    const lineMessage = saveAt(line, "payload");
    switch (line.type) {
      case "turn_context":
        return { pathTexts: [readFolderPath(readStringAt(lineMessage, "cwd"))], prompts: [] };
      case "event_msg": {
        const isCompletedEvent = lineMessage.type === "item_completed";
        return isCompletedEvent
          ? readCodexElementSignals({ item: saveAt(lineMessage, "item"), homeRoot })
          : { pathTexts: [], prompts: [] };
      }
      case "response_item":
        return { pathTexts: [readStringAt(lineMessage, "input"), readStringAt(lineMessage, "arguments")], prompts: [] };
      default:
        return { pathTexts: [], prompts: [] };
    }
  };

const readTally = (repoSets: ReadonlyArray<ReadonlySet<string>>): ReadonlyMap<string, number> => {
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
    const isLineBlank = line.trim() === "";
    const signals = isLineBlank ? { pathTexts: [], prompts: [] } : request.signalsOf(decodeLine(line));
    // One line counts once per repo, however many paths of that repo it mentions.
    pathRepoSets.push(new Set(signals.pathTexts.flatMap((pathString) => [...request.matchers.matchPaths(pathString)])));
    prompts.push(...signals.prompts);
    promptRepoSets.push(
      ...signals.prompts.map((prompt) => request.matchers.matchKeywords(prompt.slice(0, PROMPT_SCAN_CHARACTERS))),
    );
  }
  const firstPrompt = prompts.find((prompt) => prompt.trim()) || "";
  return {
    pathHits: readTally(pathRepoSets),
    promptHits: readTally(promptRepoSets),
    firstPrompt: firstPrompt.trim().slice(0, 200),
  };
};

type EvidenceRequest = { readonly transcriptFile: string; readonly matchers: RepoMatchers; readonly homeRoot: string };

export const readClaudeEvidence = (request: EvidenceRequest): SessionEvidence =>
  collectEvidence({ ...request, signalsOf: readClaudeSignalsIn(request.homeRoot) });

export const readCodexEvidence = (request: EvidenceRequest): SessionEvidence =>
  collectEvidence({ ...request, signalsOf: readCodexSignalsIn(request.homeRoot) });
