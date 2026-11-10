import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  decodeTranscriptLine,
  readTranscriptHead,
  readTranscriptLines,
  readTranscriptTail,
} from "./transcript-reader.js";

describe("decodeTranscriptLine", () => {
  it("reads a Claude Code entry's turn state and token usage from its message", () => {
    const line = decodeTranscriptLine(
      JSON.stringify({
        type: "assistant",
        message: {
          model: "claude-opus-4-7",
          stop_reason: "end_turn",
          content: [{ type: "text", text: "done" }],
          usage: { input_tokens: 10, cache_creation_input_tokens: 5, cache_read_input_tokens: 2, output_tokens: 7 },
        },
      }),
    );
    expect(line).toEqual({
      isSidechain: false,
      type: "assistant",
      role: "",
      model: "claude-opus-4-7",
      usage: { inputTokens: 10, cacheCreationInputTokens: 5, cacheReadInputTokens: 2, outputTokens: 7 },
      content: [{ type: "text", text: "done" }],
      stopReason: "end_turn",
    });
  });

  it("reads a role-only entry whose content sits on the entry itself", () => {
    const transcriptLine = decodeTranscriptLine(JSON.stringify({ role: "user", content: "hello", isSidechain: true }));
    expect(transcriptLine).toMatchObject({
      type: "",
      role: "user",
      content: "hello",
      isSidechain: true,
      usage: null,
    });
  });

  it("skips blank and malformed lines", () => {
    expect(decodeTranscriptLine("   ")).toBeNull();
    expect(decodeTranscriptLine("{not json")).toBeNull();
    expect(decodeTranscriptLine("[1, 2]")).toBeNull();
  });
});

describe("reading transcript files", () => {
  let folder: string;
  let transcript: string;
  beforeAll(() => {
    folder = mkdtempSync(path.join(tmpdir(), "agent-setup-transcript-"));
    transcript = path.join(folder, "session.jsonl");
    const filler = Array.from({ length: 4_000 }, (_, index) =>
      JSON.stringify({ type: "user", filler: "x".repeat(80), index }),
    );
    writeFileSync(transcript, `${[...filler, JSON.stringify({ type: "assistant", marker: "newest" })].join("\n")}\n`);
  });
  afterAll(() => rmSync(folder, { recursive: true, force: true }));

  it("reads every line of a transcript", () => {
    expect(readTranscriptLines(transcript)).toHaveLength(4_002);
  });

  it("reads only the head of a long transcript, first line included", () => {
    const head = readTranscriptHead(transcript);
    expect(head.length).toBeLessThan(4_002);
    expect(head.at(0)).toContain('"index":0');
  });

  it("reads a line that runs past the head whole", () => {
    const longTranscript = path.join(folder, "long-first-line.jsonl");
    const threadHeader = JSON.stringify({ type: "session_meta", instructions: "x".repeat(200_000), source: "cli" });
    writeFileSync(longTranscript, `${threadHeader}\n${JSON.stringify({ type: "user", index: 1 })}\n`);

    const head = readTranscriptHead(longTranscript);

    expect(head.at(0)).toBe(threadHeader);
  });

  it("reads only the tail of a long transcript, newest line included", () => {
    const tail = readTranscriptTail(transcript);
    expect(tail.length).toBeLessThan(4_002);
    expect(tail.at(-2)).toContain('"marker":"newest"');
  });
});
