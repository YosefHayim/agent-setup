#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const NO_ENTRIES_MARKDOWN = "- None";

const UTF8_ENCODING = "utf8";

const PLAIN_FILE_EXTENSION = "txt";

const HTML_FORMAT = "html";

const MARKDOWN_EXTENSION = "md";

const MARKDOWN_FORMAT = "markdown";

const ORIGIN_FILE_SUFFIX = ".source";
const USAGE = "Usage: node scripts/fetch-official-agent-docs.mjs --save-to <folder>";

const readSaveToFolder = (argumentList) => {
  const { values: parsedFlags } = parseArgs({
    args: argumentList,
    options: { "save-to": { type: "string" } },
    strict: true,
  });
  return parsedFlags["save-to"];
};

const describeError = (error) => {
  const isErrorObject = error instanceof Error;
  if (isErrorObject) return error.message;

  return String(error);
};

const pickFileExtension = (origin, mediaType) => {
  const isMarkdownFormat = origin.format === MARKDOWN_FORMAT;
  if (isMarkdownFormat) return MARKDOWN_EXTENSION;

  const isHtmlFormat = origin.format === HTML_FORMAT;
  if (isHtmlFormat) return HTML_FORMAT;

  const isPlainFormat = origin.format === "text";
  if (isPlainFormat) return PLAIN_FILE_EXTENSION;

  const isMarkdownMediaType = mediaType.includes(MARKDOWN_FORMAT);
  if (isMarkdownMediaType) return MARKDOWN_EXTENSION;

  const isHtmlMediaType = mediaType.includes(HTML_FORMAT);
  if (isHtmlMediaType) return HTML_FORMAT;

  return PLAIN_FILE_EXTENSION;
};

const readDocumentFile = async (filePath) => {
  const documentString = await readFile(filePath, UTF8_ENCODING);
  return JSON.parse(documentString);
};

const fetchOrigin = async (origin) => {
  const fetchTimeoutMilliseconds = 20000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), fetchTimeoutMilliseconds);

  try {
    const httpReply = await fetch(origin.url, {
      headers: {
        accept: "text/html, text/markdown, text/plain;q=0.9, */*;q=0.8",
        "user-agent": "agent-setup-update-agent-docs/1.0",
      },
      redirect: "follow",
      signal: controller.signal,
    });

    const isReplyNotOk = !httpReply.ok;
    if (isReplyNotOk) {
      return {
        ok: false,
        source: origin,
        status: httpReply.status,
        error: `${httpReply.status} ${httpReply.statusText}`,
      };
    }

    const pageDocument = await httpReply.text();
    const mediaType = httpReply.headers.get("content-type") || "";

    return {
      ok: true,
      pageDocument,
      contentType: mediaType,
      finalUrl: httpReply.url,
      source: origin,
      status: httpReply.status,
    };
  } catch (error) {
    return {
      ok: false,
      error: describeError(error),
      source: origin,
    };
  } finally {
    clearTimeout(timeout);
  }
};

const createSummary = ({ failures, manifest, outputDirectory, successes }) => {
  const lines = [
    "# Update Agent Docs Sources",
    "",
    `Generated: ${manifest.generatedAt}`,
    `Output: ${outputDirectory}`,
    "",
    "## Fetched",
    "",
  ];

  const isSuccessesEmpty = successes.length === 0;
  if (isSuccessesEmpty) {
    lines.push(NO_ENTRIES_MARKDOWN);
  } else {
    for (const fetchedPage of successes) {
      lines.push(`- ${fetchedPage.id}: ${fetchedPage.name} (${fetchedPage.bytes} bytes)`);
      lines.push(`  - Source: ${fetchedPage.url}`);

      const hasRedirected = fetchedPage.finalUrl !== fetchedPage.url;
      if (hasRedirected) lines.push(`  - Final URL: ${fetchedPage.finalUrl}`);

      lines.push(`  - File: ${fetchedPage.file}`);
    }
  }

  lines.push("", "## Failed", "");

  const isFailuresEmpty = failures.length === 0;
  if (isFailuresEmpty) {
    lines.push(NO_ENTRIES_MARKDOWN);
  } else {
    for (const failure of failures) {
      lines.push(`- ${failure.source.id}: ${failure.source.name}`);
      lines.push(`  - Source: ${failure.source.url}`);
      lines.push(`  - Error: ${failure.error}`);
    }
  }

  lines.push("");
  return lines.join("\n");
};

const runFetchCommand = async () => {
  const firstArgumentIndex = 2;

  const saveToFolder = readSaveToFolder(process.argv.slice(firstArgumentIndex));

  const hasNoSaveToFolder = !saveToFolder;
  if (hasNoSaveToFolder) {
    console.error(USAGE);
    process.exit(1);
  }

  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
  const skillDirectory = path.resolve(scriptDirectory, "..");
  const originPath = path.join(skillDirectory, "sources.json");
  const origins = await readDocumentFile(originPath);
  const outputDirectory = path.resolve(saveToFolder);

  await mkdir(outputDirectory, { recursive: true });

  const fetched = await Promise.all(origins.map((origin) => fetchOrigin(origin)));
  const successes = [];
  const failures = [];

  for (const fetchAttempt of fetched) {
    const isFetchFailed = !fetchAttempt.ok;
    if (isFetchFailed) {
      failures.push(fetchAttempt);
      continue;
    }

    const extension = pickFileExtension(fetchAttempt.source, fetchAttempt.contentType);
    const fileName = `${fetchAttempt.source.id}${ORIGIN_FILE_SUFFIX}.${extension}`;
    await writeFile(path.join(outputDirectory, fileName), fetchAttempt.pageDocument);

    successes.push({
      bytes: Buffer.byteLength(fetchAttempt.pageDocument, UTF8_ENCODING),
      contentType: fetchAttempt.contentType,
      file: fileName,
      finalUrl: fetchAttempt.finalUrl,
      format: fetchAttempt.source.format,
      id: fetchAttempt.source.id,
      name: fetchAttempt.source.name,
      notes: fetchAttempt.source.notes,
      status: fetchAttempt.status,
      url: fetchAttempt.source.url,
    });
  }

  const manifest = {
    failed: failures.map((failure) => ({
      error: failure.error,
      id: failure.source.id,
      name: failure.source.name,
      url: failure.source.url,
    })),
    fetched: successes,
    generatedAt: new Date().toISOString(),
    sourceFile: originPath,
  };

  const indentSpaceCount = 2;

  await writeFile(path.join(outputDirectory, "manifest.json"), `${JSON.stringify(manifest, null, indentSpaceCount)}\n`);
  await writeFile(
    path.join(outputDirectory, "summary.md"),
    createSummary({ failures, manifest, outputDirectory, successes }),
  );

  console.log(`Fetched ${successes.length}/${origins.length} official sources.`);
  console.log(`Cache: ${outputDirectory}`);

  const hasFailures = failures.length > 0;
  if (hasFailures) {
    for (const failure of failures) {
      console.error(`Failed ${failure.source.id}: ${failure.error}`);
    }
  }

  const isSuccessesEmpty = successes.length === 0;
  if (isSuccessesEmpty) {
    process.exitCode = 1;
  }
};

try {
  await runFetchCommand();
} catch (error) {
  console.error(describeError(error));
  console.error(USAGE);
  process.exit(1);
}
