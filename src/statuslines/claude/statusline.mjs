#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync, readSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";

const NEWLINE_CHARACTER = "\n";

const NUMBER_TYPE_NAME = "number";

const TEXT_BLOCK_TYPE = "text";

const STDIO_IGNORE = "ignore";

const UTF8_ENCODING = "utf8";

const ONE_MILLION = 1_000_000;

const STATUS_DIR = path.join(homedir(), ".claude", "agent-setup", "state");
const ANSI = { green: "\x1b[32m", yellow: "\x1b[33m", red: "\x1b[31m", dim: "\x1b[2m", reset: "\x1b[0m" };
const SEPARATOR = `${ANSI.dim} · ${ANSI.reset}`;
// Claude indents the status line, so leave room for it.
const WIDTH = (Number(process.env.COLUMNS) || 120) - 4;
// Bumped when the cached stats gain a field, so old caches are counted again from the start.
const CACHE_VERSION = 2;
const NEWLINE_BYTE = 10;
const EMPTY_STATS = {
  version: CACHE_VERSION,
  offset: 0,
  user: 0,
  claude: 0,
  compacts: 0,
  calls: 0,
  tools: [],
  input: 0,
  generatedTokens: 0,
  lastId: "",
  lastReplyId: "",
  lastGeneratedTokens: 0,
};

const readDocument = (file) => {
  try {
    return JSON.parse(readFileSync(file, UTF8_ENCODING));
  } catch {
    return null;
  }
};

// The status line must render even when state cannot be saved, so a failed write returns false.
const writeDocument = (file, document) => {
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(document)}\n`);
    return true;
  } catch {
    return false;
  }
};

const shortenCount = (count) => {
  const isAtLeastMillion = count >= ONE_MILLION;
  if (isAtLeastMillion) return `${Number((count / ONE_MILLION).toFixed(1))}M`;

  const thousandCountThreshold = 1_000;

  const isAtLeastThousand = count >= thousandCountThreshold;
  const thousandCountDivisor = 1_000;

  if (isAtLeastThousand) return `${Math.round(count / thousandCountDivisor)}k`;

  return String(count);
};

const createDurationLabel = (milliseconds) => {
  const millisecondsPerMinute = 60_000;

  const minutes = Math.floor(milliseconds / millisecondsPerMinute);
  const minutesPerHour = 60;

  const isAtLeastOneHour = minutes >= minutesPerHour;
  const minutesPerHourForDisplay = 60;

  const minutesPerHourForRemainder = 60;

  if (isAtLeastOneHour)
    return `${Math.floor(minutes / minutesPerHourForDisplay)}h ${minutes % minutesPerHourForRemainder}m`;

  const hasWholeMinutes = minutes > 0;
  if (hasWholeMinutes) return `${minutes}m`;

  const millisecondsPerSecond = 1_000;

  return `${Math.floor(milliseconds / millisecondsPerSecond)}s`;
};

// Green while there is room, yellow from half, red from 80%.
const pickUsageColor = (used) => {
  const criticalUsedPercent = 80;

  const isCritical = used >= criticalUsedPercent;
  if (isCritical) return ANSI.red;

  const warningUsedPercent = 50;

  const isWarning = used >= warningUsedPercent;
  if (isWarning) return ANSI.yellow;

  return ANSI.green;
};

const createColoredLabel = (used, label) => `${pickUsageColor(used)}${label}${ANSI.reset}`;

const createPercentLabel = (used) => `${createColoredLabel(used, `${Math.round(used)}%`)}/100%`;

const readGitBranch = (cwd) => {
  try {
    const timeoutMilliseconds = 500;

    return execFileSync("git", ["-C", cwd, "branch", "--show-current"], {
      encoding: UTF8_ENCODING,
      stdio: [STDIO_IGNORE, "pipe", STDIO_IGNORE],
      timeout: timeoutMilliseconds,
    }).trim();
  } catch {
    return "";
  }
};

const readPrompt = (message) => {
  const isStringMessage = typeof message === "string";
  if (isStringMessage) return message;

  const isPromptMessageUnreadable = !Array.isArray(message) || message.some((block) => block.type === "tool_result");
  if (isPromptMessageUnreadable) return null;

  return message.find((block) => block.type === TEXT_BLOCK_TYPE)?.text || "";
};

// Only what the person typed: task notices and command output start with "<", interruptions with "[",
// and slash commands with "/".
const isUserPrompt = (transcriptLine) => {
  const isOrdinaryUserMessage =
    transcriptLine.type === "user" &&
    !transcriptLine.isMeta &&
    !transcriptLine.isSidechain &&
    !transcriptLine.isCompactSummary;
  const promptLine = isOrdinaryUserMessage ? readPrompt(transcriptLine.message?.content) : null;
  const isPromptLineFound = promptLine !== null;
  return isPromptLineFound && !/^[<[/]/.test(promptLine.trimStart());
};

// One assistant reply spans several lines (thinking, text, tool calls) that share a message id and usage.
const countAssistant = (stats, message) => {
  const usage = message.usage;
  const hasUsage = usage != null;

  for (const block of message.content || []) {
    const isBlockTypeNotToolUse = block.type !== "tool_use";
    if (isBlockTypeNotToolUse) continue;

    stats.calls += 1;

    const isNewTool = !stats.tools.includes(block.name);
    if (isNewTool) stats.tools.push(block.name);
  }

  const hasReplyBlock = message.content?.some((block) => block.type === TEXT_BLOCK_TYPE) ?? false;
  const isNewReply = hasReplyBlock && message.id !== stats.lastReplyId;
  if (isNewReply) {
    stats.lastReplyId = message.id;
    stats.claude += 1;
  }

  const isNewMessage = message.id !== stats.lastId;
  if (isNewMessage) {
    stats.lastId = message.id;
    stats.lastGeneratedTokens = 0;

    // New input only: cache reads resend the whole context on every call.
    if (hasUsage) stats.input += usage.input_tokens + usage.cache_creation_input_tokens;
  }

  const isGeneratedTokensGrowing = hasUsage && usage.output_tokens > stats.lastGeneratedTokens;
  if (isGeneratedTokensGrowing) {
    stats.generatedTokens += usage.output_tokens - stats.lastGeneratedTokens;
    stats.lastGeneratedTokens = usage.output_tokens;
  }
};

const readNewLines = (transcriptPath, offset, size) => {
  const buffer = Buffer.alloc(size - offset);
  const descriptor = openSync(transcriptPath, "r");
  try {
    readSync(descriptor, buffer, 0, buffer.length, offset);
  } finally {
    closeSync(descriptor);
  }
  const end = buffer.lastIndexOf(NEWLINE_BYTE) + 1;
  return { lines: buffer.subarray(0, end).toString(UTF8_ENCODING).split(NEWLINE_CHARACTER), bytes: end };
};

const countTranscriptLine = (stats, line) => {
  const parsedLine = JSON.parse(line);

  const isCompactBoundary = parsedLine.type === "system" && parsedLine.subtype === "compact_boundary";
  if (isCompactBoundary) {
    stats.compacts += 1;
    return;
  }

  if (isUserPrompt(parsedLine)) {
    stats.user += 1;
    return;
  }

  const isAssistantReply = parsedLine.type === "assistant" && !parsedLine.isSidechain && Boolean(parsedLine.message);
  if (isAssistantReply) countAssistant(stats, parsedLine.message);
};

// Counts are cached per session, so each refresh reads only lines added since the last one.
const updateTranscriptStats = (sessionId, transcriptPath) => {
  const cacheFile = path.join(STATUS_DIR, "statusline", `${sessionId}.json`);
  const size = statSync(transcriptPath).size;
  const cachedStats = readDocument(cacheFile);

  const isCacheUsable = cachedStats?.version === CACHE_VERSION && cachedStats.offset <= size;
  const stats = isCacheUsable ? cachedStats : { ...EMPTY_STATS, tools: [] };
  const isAlreadyCounted = stats.offset === size;
  if (isAlreadyCounted) return stats;

  const { lines, bytes } = readNewLines(transcriptPath, stats.offset, size);
  for (const line of lines) {
    const isBlankLine = !line;
    if (isBlankLine) continue;

    try {
      countTranscriptLine(stats, line);
    } catch {}
  }

  stats.offset += bytes;
  writeDocument(cacheFile, stats);
  return stats;
};

const updateTranscriptStatsOrNull = (sessionId, transcriptPath) => {
  try {
    return updateTranscriptStats(sessionId, transcriptPath);
  } catch {
    // No transcript yet: the status line shows only what Claude sent.
    return null;
  }
};

const readWindowUsage = (windowStatus) => {
  const usage = windowStatus?.current_usage;
  const isWindowUsageMissing = !usage || !windowStatus.context_window_size;
  if (isWindowUsageMissing) return "";

  const used = usage.input_tokens + usage.cache_creation_input_tokens + usage.cache_read_input_tokens;
  const hasUsedPercentage = typeof windowStatus.used_percentage === NUMBER_TYPE_NAME;
  const percentScale = 100;

  const tokenPercent = (used / windowStatus.context_window_size) * percentScale;
  const usedPercent = hasUsedPercentage ? windowStatus.used_percentage : tokenPercent;
  return `${createColoredLabel(usedPercent, shortenCount(used))}/${shortenCount(windowStatus.context_window_size)}`;
};

const measureVisibleLength = (label) => stripVTControlCharacters(label).length;

const packSegmentLines = (segments, width) => {
  const lines = [];
  for (const segment of segments) {
    const lastLine = lines.at(-1);
    const isFittingOnLastLine = lastLine != null && measureVisibleLength(lastLine + SEPARATOR + segment) <= width;
    if (isFittingOnLastLine) {
      lines[lines.length - 1] = lastLine + SEPARATOR + segment;
    } else {
      lines.push(segment);
    }
  }
  return lines;
};

// One line when everything fits the terminal. Otherwise the fewest lines, evened out so the last one
// is not a lone segment.
const fitSegmentLines = (segments) => {
  const lines = packSegmentLines(segments, WIDTH);
  const total = measureVisibleLength(segments.join(SEPARATOR));
  for (let width = Math.ceil(total / lines.length); width < WIDTH; width += 1) {
    const evenLines = packSegmentLines(segments, width);
    const isSameLineCount = evenLines.length === lines.length;
    if (isSameLineCount) return evenLines;
  }
  return lines;
};

const sessionStatus = readDocument(0) || {};
const cwd = sessionStatus.workspace?.current_dir || sessionStatus.cwd || process.cwd();
const fiveHour = sessionStatus.rate_limits?.five_hour?.used_percentage;
const weekly = sessionStatus.rate_limits?.seven_day?.used_percentage;
const hasFiveHourUsage = typeof fiveHour === NUMBER_TYPE_NAME;
const hasWeeklyUsage = typeof weekly === NUMBER_TYPE_NAME;

const segments = [
  path.basename(cwd),
  readGitBranch(cwd),
  sessionStatus.model?.display_name,
  readWindowUsage(sessionStatus.context_window),
  hasFiveHourUsage ? `5H ${createPercentLabel(fiveHour)}` : "",
  hasWeeklyUsage ? `W ${createPercentLabel(weekly)}` : "",
].filter(Boolean);

const isTranscriptKnown = Boolean(sessionStatus.session_id) && Boolean(sessionStatus.transcript_path);
const transcriptStats = isTranscriptKnown
  ? updateTranscriptStatsOrNull(sessionStatus.session_id, sessionStatus.transcript_path)
  : null;
const hasTranscriptStats = transcriptStats != null;
if (hasTranscriptStats) {
  segments.push(
    `User:${transcriptStats.user} & Claude:${transcriptStats.claude}`,
    `Total ${transcriptStats.user + transcriptStats.claude}`,
    `Compacts:${transcriptStats.compacts}`,
    `Tools:${transcriptStats.tools.length} Calls:${transcriptStats.calls}`,
    `In:${shortenCount(transcriptStats.input)} Out:${shortenCount(transcriptStats.generatedTokens)}`,
  );
}

const hasDuration = Boolean(sessionStatus.cost?.total_duration_ms);
if (hasDuration) segments.push(createDurationLabel(sessionStatus.cost.total_duration_ms));

console.log(fitSegmentLines(segments).join(NEWLINE_CHARACTER));
