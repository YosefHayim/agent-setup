#!/usr/bin/env node
// Claude Code status line: folder · branch · model · context · 5-hour and weekly limits, then messages,
// compacts, tool calls, session tokens, and duration. Segments fill the terminal width and wrap only when
// they run out of room. Dependency-free; reads Claude's stdin JSON.
import { execFileSync } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync, readSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";

const STATE_DIR = path.join(homedir(), ".claude", "agent-setup", "state");
const ANSI = { green: "\x1b[32m", yellow: "\x1b[33m", red: "\x1b[31m", dim: "\x1b[2m", reset: "\x1b[0m" };
const SEPARATOR = `${ANSI.dim} · ${ANSI.reset}`;
// Claude indents the status line, so leave room for it.
const WIDTH = (Number(process.env.COLUMNS) || 120) - 4;
// Bumped when the cached stats gain a field, so old caches are counted again from the start.
const CACHE_VERSION = 2;
const EMPTY_STATS = {
  version: CACHE_VERSION,
  offset: 0,
  user: 0,
  claude: 0,
  compacts: 0,
  calls: 0,
  tools: [],
  input: 0,
  output: 0,
  lastId: "",
  lastTextId: "",
  lastOutput: 0,
};

const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
};

const writeJson = (file, value) => {
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(value)}\n`);
  } catch {
    // The status line must render even when state cannot be saved.
  }
};

const shortCount = (count) => {
  if (count >= 1_000_000) return `${Number((count / 1_000_000).toFixed(1))}M`;
  if (count >= 1_000) return `${Math.round(count / 1_000)}k`;
  return String(count);
};

const duration = (milliseconds) => {
  const minutes = Math.floor(milliseconds / 60_000);
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${Math.floor(milliseconds / 1_000)}s`;
};

// Green while there is room, yellow from half, red from 80%.
const usageColor = (used) => {
  if (used >= 80) return ANSI.red;
  if (used >= 50) return ANSI.yellow;
  return ANSI.green;
};

const colored = (used, text) => `${usageColor(used)}${text}${ANSI.reset}`;

const percent = (used) => `${colored(used, `${Math.round(used)}%`)}/100%`;

const gitBranch = (cwd) => {
  try {
    return execFileSync("git", ["-C", cwd, "branch", "--show-current"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 500,
    }).trim();
  } catch {
    return "";
  }
};

const promptText = (content) => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content) || content.some((block) => block.type === "tool_result")) return undefined;
  return content.find((block) => block.type === "text")?.text || "";
};

// Only what the person typed: task notices and command output start with "<", interruptions with "[",
// and slash commands with "/".
const isUserPrompt = (entry) => {
  if (entry.type !== "user" || entry.isMeta || entry.isSidechain || entry.isCompactSummary) return false;
  const text = promptText(entry.message?.content);
  return text !== undefined && !/^[<[/]/.test(text.trimStart());
};

// One assistant reply spans several lines (thinking, text, tool calls) that share a message id and usage.
const countAssistant = (stats, message) => {
  const usage = message.usage;
  for (const block of message.content || []) {
    if (block.type !== "tool_use") continue;
    stats.calls += 1;
    if (!stats.tools.includes(block.name)) stats.tools.push(block.name);
  }
  if (message.content?.some((block) => block.type === "text") && message.id !== stats.lastTextId) {
    stats.lastTextId = message.id;
    stats.claude += 1;
  }
  if (message.id !== stats.lastId) {
    stats.lastId = message.id;
    stats.lastOutput = 0;
    // New input only: cache reads resend the whole context on every call.
    if (usage) stats.input += usage.input_tokens + usage.cache_creation_input_tokens;
  }
  if (usage && usage.output_tokens > stats.lastOutput) {
    stats.output += usage.output_tokens - stats.lastOutput;
    stats.lastOutput = usage.output_tokens;
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
  const end = buffer.lastIndexOf(10) + 1;
  return { lines: buffer.subarray(0, end).toString("utf8").split("\n"), bytes: end };
};

// Counts are cached per session, so each refresh reads only lines added since the last one.
const transcriptStats = (sessionId, transcriptPath) => {
  const cacheFile = path.join(STATE_DIR, "statusline", `${sessionId}.json`);
  const size = statSync(transcriptPath).size;
  const cached = readJson(cacheFile);
  const stats = cached?.version === CACHE_VERSION && cached.offset <= size ? cached : { ...EMPTY_STATS, tools: [] };
  if (stats.offset === size) return stats;
  const { lines, bytes } = readNewLines(transcriptPath, stats.offset, size);
  for (const line of lines) {
    if (!line) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.type === "system" && entry.subtype === "compact_boundary") stats.compacts += 1;
      else if (isUserPrompt(entry)) stats.user += 1;
      else if (entry.type === "assistant" && !entry.isSidechain && entry.message) countAssistant(stats, entry.message);
    } catch {
      // A partly written line is read again on the next refresh.
    }
  }
  stats.offset += bytes;
  writeJson(cacheFile, stats);
  return stats;
};

const contextUsage = (window) => {
  const usage = window?.current_usage;
  if (!usage || !window.context_window_size) return "";
  const used = usage.input_tokens + usage.cache_creation_input_tokens + usage.cache_read_input_tokens;
  const usedPercent =
    typeof window.used_percentage === "number" ? window.used_percentage : (used / window.context_window_size) * 100;
  return `${colored(usedPercent, shortCount(used))}/${shortCount(window.context_window_size)}`;
};

const visibleLength = (text) => stripVTControlCharacters(text).length;

const packLines = (segments, width) => {
  const lines = [];
  for (const segment of segments) {
    const line = lines.at(-1);
    if (line !== undefined && visibleLength(line + SEPARATOR + segment) <= width) {
      lines[lines.length - 1] = line + SEPARATOR + segment;
    } else {
      lines.push(segment);
    }
  }
  return lines;
};

// One line when everything fits the terminal. Otherwise the fewest lines, evened out so the last one
// is not a lone segment.
const fitLines = (segments) => {
  const lines = packLines(segments, WIDTH);
  const total = visibleLength(segments.join(SEPARATOR));
  for (let width = Math.ceil(total / lines.length); width < WIDTH; width += 1) {
    const even = packLines(segments, width);
    if (even.length === lines.length) return even;
  }
  return lines;
};

const input = readJson(0) || {};
const cwd = input.workspace?.current_dir || input.cwd || process.cwd();
const fiveHour = input.rate_limits?.five_hour?.used_percentage;
const weekly = input.rate_limits?.seven_day?.used_percentage;

const segments = [
  path.basename(cwd),
  gitBranch(cwd),
  input.model?.display_name,
  contextUsage(input.context_window),
  typeof fiveHour === "number" ? `5H ${percent(fiveHour)}` : "",
  typeof weekly === "number" ? `W ${percent(weekly)}` : "",
].filter(Boolean);

if (input.session_id && input.transcript_path) {
  try {
    const stats = transcriptStats(input.session_id, input.transcript_path);
    segments.push(
      `User:${stats.user} & Claude:${stats.claude}`,
      `Total ${stats.user + stats.claude}`,
      `Compacts:${stats.compacts}`,
      `Tools:${stats.tools.length} Calls:${stats.calls}`,
      `In:${shortCount(stats.input)} Out:${shortCount(stats.output)}`,
    );
  } catch {
    // No transcript yet: show only what Claude sent.
  }
}
if (input.cost?.total_duration_ms) segments.push(duration(input.cost.total_duration_ms));

console.log(fitLines(segments).join("\n"));
