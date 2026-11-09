#!/usr/bin/env python3
"""Measure real Claude Code token use in a time window, to judge a settings or skill change on real sessions.

Read-only. Reads the Claude Code transcripts; writes only the --out file.

Usage:
  python3 scripts/sessionTokenUsage.py --since 2026-10-04 --until 2026-10-11 --out "$RUN_DIR/usage.json"
  python3 scripts/sessionTokenUsage.py --since 2026-10-11 --compare "$BASELINE_RUN_DIR/usage.json"
"""

from __future__ import annotations

import argparse
import json
import os
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path

# USD per million tokens (input, 5m cache write, 1h cache write, cache read, output),
# from platform.claude.com/docs/en/about-claude/pricing on 2026-10-11. The longest matching prefix wins.
# Fast mode bills twice these prices.
PRICES = {
    "claude-fable-5-1": (10, 12.5, 20, 0.25, 50),
    "claude-fable-5": (10, 12.5, 20, 1, 50),
    "claude-opus-5-5": (4, 5, 8, 0.20, 20),
    "claude-opus-5": (5, 6.25, 10, 0.50, 25),
    "claude-opus-4-8": (5, 6.25, 10, 0.50, 25),
    "claude-opus-4-7": (5, 6.25, 10, 0.50, 25),
    "claude-opus-4-6": (5, 6.25, 10, 0.50, 25),
    "claude-opus-4-5": (5, 6.25, 10, 0.50, 25),
    "claude-opus-4": (15, 18.75, 30, 1.50, 75),
    "claude-sonnet-5-5": (2, 2.5, 4, 0.10, 10),
    "claude-sonnet-5": (2, 2.5, 4, 0.20, 10),
    "claude-sonnet-4": (3, 3.75, 6, 0.30, 15),
    "claude-haiku-5-5": (0.10, 0.125, 0.20, 0.01, 0.50),
    "claude-haiku-4": (1, 1.25, 2, 0.10, 5),
}
HAIKU_LONG_PROMPT_PRICES = (0.50, 0.625, 1, 0.05, 2.50)
HAIKU_LONG_PROMPT_TOKENS = 100_000
FAST_MODE_MULTIPLIER = 2
CHARS_PER_TOKEN = 3.6
LARGE_CONTEXT_TOKENS = 150_000
FILE_DUMP_COMMANDS = ("cat ", "sed -n", "head ", "tail ")
FILE_DUMP_MIN_CHARS = 4_000
NOT_HUMAN_PROMPTS = ("<task-notification", "This session is being continued", "<local-command", "Caveat:")


def parseArguments() -> argparse.Namespace:
    weekAgo = (datetime.now(timezone.utc) - timedelta(days=7)).strftime("%Y-%m-%d")
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--since", default=weekAgo, help="UTC start, YYYY-MM-DD or ISO time (default: 7 days ago)")
    parser.add_argument("--until", default="9999", help="UTC end, exclusive (default: now)")
    parser.add_argument("--projects", default=str(Path.home() / ".claude" / "projects"))
    parser.add_argument("--out", help="write the metrics as JSON to this file")
    parser.add_argument("--compare", help="an earlier --out file to compare against")
    return parser.parse_args()


def priceFor(model: str, promptTokens: int) -> tuple | None:
    if model.startswith("claude-haiku-5-5") and promptTokens > HAIKU_LONG_PROMPT_TOKENS:
        return HAIKU_LONG_PROMPT_PRICES
    matches = [prefix for prefix in PRICES if model.startswith(prefix)]
    if not matches:
        return None
    return PRICES[max(matches, key=len)]


def callCost(model: str, usage: dict) -> float | None:
    cacheWrites = usage.get("cache_creation") or {}
    written = usage.get("cache_creation_input_tokens") or 0
    writtenOneHour = cacheWrites.get("ephemeral_1h_input_tokens") or 0
    writtenFiveMinutes = written - writtenOneHour
    inputTokens = usage.get("input_tokens") or 0
    readTokens = usage.get("cache_read_input_tokens") or 0
    prices = priceFor(model, inputTokens + written + readTokens)
    if prices is None:
        return None
    tokenCounts = (inputTokens, writtenFiveMinutes, writtenOneHour, readTokens, usage.get("output_tokens") or 0)
    speedMultiplier = FAST_MODE_MULTIPLIER if usage.get("speed") == "fast" else 1
    return speedMultiplier * sum(count * price for count, price in zip(tokenCounts, prices)) / 1e6


def isHumanPrompt(entry: dict) -> bool:
    content = (entry.get("message") or {}).get("content")
    if entry.get("isMeta") or entry.get("isCompactSummary") or not isinstance(content, str):
        return False
    return not content.lstrip().startswith(NOT_HUMAN_PROMPTS)


def toolResultText(block: dict) -> str:
    content = block.get("content")
    if isinstance(content, str):
        return content
    parts = content if isinstance(content, list) else []
    return "".join(part.get("text", "") for part in parts if isinstance(part, dict))


def transcriptsIn(projectsRoot: Path, since: str):
    sinceTime = datetime.fromisoformat(since[:10]).replace(tzinfo=timezone.utc).timestamp()
    for folder, _, fileNames in os.walk(projectsRoot):
        for fileName in fileNames:
            transcript = Path(folder) / fileName
            if fileName.endswith(".jsonl") and transcript.stat().st_mtime >= sinceTime:
                yield transcript, "subagents" in transcript.parts


class UsageTally:
    def __init__(self) -> None:
        self.counts = Counter()
        self.costByModel = Counter()
        self.callsByModel = Counter()
        self.unpricedModels = set()
        self.toolsPerCall = Counter()
        self.seenMessageIds = set()

    def addAssistant(self, message: dict, isSubagent: bool) -> None:
        messageId = message.get("id")
        toolUses = [block for block in message.get("content") or [] if block.get("type") == "tool_use"]
        self.toolsPerCall[messageId] += len(toolUses)
        if messageId in self.seenMessageIds:
            return
        self.seenMessageIds.add(messageId)
        model = message.get("model") or "?"
        usage = message.get("usage") or {}
        if model == "<synthetic>" or not usage:
            return
        promptTokens = sum(usage.get(field) or 0 for field in ("input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"))
        cost = callCost(model, usage)
        self.counts["apiCalls"] += 1
        self.counts["promptTokens"] += promptTokens
        self.counts["outputTokens"] += usage.get("output_tokens") or 0
        self.counts["callsOver150k"] += promptTokens > LARGE_CONTEXT_TOKENS
        self.callsByModel[model] += 1
        if cost is None:
            self.unpricedModels.add(model)
            return
        self.costByModel[model] += cost
        self.counts["subagentCost"] += cost if isSubagent else 0

    def addToolResult(self, toolUse: dict, text: str) -> None:
        name = toolUse.get("name")
        command = (toolUse.get("input") or {}).get("command") or ""
        isFileDump = name == "Bash" and command.lstrip().startswith(FILE_DUMP_COMMANDS) and len(text) > FILE_DUMP_MIN_CHARS
        self.counts["bashOutputChars"] += len(text) if name == "Bash" else 0
        self.counts["fileDumpChars"] += len(text) if isFileDump else 0
        self.counts["readOutputChars"] += len(text) if name == "Read" else 0

    def addAttachment(self, entry: dict) -> None:
        attachment = entry.get("attachment") or {}
        kind = attachment.get("type")
        self.counts["hookErrors"] += kind == "hook_non_blocking_error"
        if kind != "skill_listing":
            return
        rendered = entry.get("rendered") if isinstance(entry.get("rendered"), list) else []
        self.counts["skillListings"] += 1
        self.counts["skillListingChars"] += sum(len(part.get("content", "")) for part in rendered if isinstance(part, dict))


def scanTranscript(transcript: Path, isSubagent: bool, window: tuple[str, str], tally: UsageTally) -> None:
    toolUses = {}
    for line in open(transcript, errors="replace"):
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            continue
        timestamp = entry.get("timestamp") or ""
        if not window[0] <= timestamp < window[1]:
            continue
        kind = entry.get("type")
        message = entry.get("message") or {}
        if kind == "assistant":
            toolUses.update({block["id"]: block for block in message.get("content") or [] if block.get("type") == "tool_use"})
            tally.addAssistant(message, isSubagent)
        if kind == "user" and not isSubagent and isHumanPrompt(entry):
            tally.counts["humanPrompts"] += 1
        if kind == "user" and isinstance(message.get("content"), list):
            for block in message["content"]:
                isKnownToolResult = isinstance(block, dict) and block.get("tool_use_id") in toolUses
                if isKnownToolResult:
                    tally.addToolResult(toolUses[block["tool_use_id"]], toolResultText(block))
        if kind == "attachment":
            tally.addAttachment(entry)
        tally.counts["compactions"] += kind == "system" and entry.get("subtype") == "compact_boundary"


def tokens(chars: int) -> int:
    return int(chars / CHARS_PER_TOKEN)


def share(part: float, whole: float) -> float:
    return round(part / whole, 4) if whole else 0.0


def summarize(tally: UsageTally, window: tuple[str, str], sessions: Counter) -> dict:
    counts = tally.counts
    totalCost = sum(tally.costByModel.values())
    toolCallCounts = [count for count in tally.toolsPerCall.values() if count]
    return {
        "window": {"since": window[0], "until": window[1]},
        "sessions": {"main": sessions["main"], "subagent": sessions["subagent"]},
        "humanPrompts": counts["humanPrompts"],
        "apiCalls": counts["apiCalls"],
        "costUsd": round(totalCost, 2),
        "costPerPromptUsd": round(totalCost / max(counts["humanPrompts"], 1), 3),
        "apiCallsPerPrompt": round(counts["apiCalls"] / max(counts["humanPrompts"], 1), 1),
        "avgContextTokens": counts["promptTokens"] // max(counts["apiCalls"], 1),
        "shareCallsOver150k": share(counts["callsOver150k"], counts["apiCalls"]),
        "shareSingleToolCalls": share(sum(1 for count in toolCallCounts if count == 1), len(toolCallCounts)),
        "outputTokens": counts["outputTokens"],
        "bashOutputTokensEstimated": tokens(counts["bashOutputChars"]),
        "fileDumpTokensEstimated": tokens(counts["fileDumpChars"]),
        "readOutputTokensEstimated": tokens(counts["readOutputChars"]),
        "hookErrors": counts["hookErrors"],
        "avgSkillListingTokensEstimated": tokens(counts["skillListingChars"] / max(counts["skillListings"], 1)),
        "compactions": counts["compactions"],
        "subagentCostShare": share(counts["subagentCost"], totalCost),
        "costByModelUsd": {model: round(cost, 2) for model, cost in tally.costByModel.most_common()},
        "apiCallsByModel": dict(tally.callsByModel.most_common()),
        "unpricedModels": sorted(tally.unpricedModels),
    }


def printComparison(before: dict, after: dict) -> None:
    print(f"\n{'metric':34} {'before':>14} {'after':>14} {'change':>9}")
    for metric, afterValue in after.items():
        beforeValue = before.get(metric)
        isNumber = isinstance(afterValue, (int, float)) and isinstance(beforeValue, (int, float))
        if not isNumber:
            continue
        change = f"{100 * (afterValue - beforeValue) / beforeValue:+.0f}%" if beforeValue else "-"
        print(f"{metric:34} {beforeValue:>14,} {afterValue:>14,} {change:>9}")


def main() -> None:
    arguments = parseArguments()
    window = (arguments.since, arguments.until)
    tally = UsageTally()
    sessions = Counter()
    for transcript, isSubagent in transcriptsIn(Path(arguments.projects), arguments.since):
        sessions["subagent" if isSubagent else "main"] += 1
        scanTranscript(transcript, isSubagent, window, tally)
    metrics = summarize(tally, window, sessions)
    print(json.dumps(metrics, indent=2))
    if arguments.out:
        Path(arguments.out).write_text(json.dumps(metrics, indent=2) + "\n")
    if arguments.compare:
        baseline = json.loads(Path(arguments.compare).read_text())
        printComparison(baseline, metrics)


if __name__ == "__main__":
    main()
