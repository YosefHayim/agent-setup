// Home and project roots, platform, and agent evidence, observed once per command and handed to capabilities.

import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { z } from "zod";

import { type AgentDefinition, type AgentEvidence, agentCatalog } from "../catalog/agent-catalog.js";
import { joinZodIssueMessages } from "../zod-issue-messages.js";

const execFileAsync = promisify(execFile);

export const hostOperatingSystems = [
  "aix",
  "android",
  "darwin",
  "freebsd",
  "haiku",
  "linux",
  "openbsd",
  "sunos",
  "win32",
  "cygwin",
  "netbsd",
] as const;

// Read-only host observations used by feature diagnostics.
export const hostPlatformSchema = z.strictObject({
  operatingSystem: z.enum(hostOperatingSystems),
});

export type HostPlatform = z.infer<typeof hostPlatformSchema>;

export interface HostScan {
  readonly homeRoot: string;
  readonly projectRoot: string;
  readonly platform: HostPlatform;
  readonly agentEvidence: AgentEvidence;
}

const uniqueSorted = (values: ReadonlyArray<string>): ReadonlyArray<string> => [...new Set(values)].sort();

const absoluteRoot = (value: string): string => path.resolve(value).replaceAll("\\", "/");

// cmux puts a wrapper for every agent it integrates with (grok, opencode, …) on each terminal's PATH whether or not
// the agent is installed — its grok wrapper only prints "grok not found" — so a wrapper alone is not evidence.
// e.g. "/Applications/cmux.app/Contents/Resources/bin/grok"
const TERMINAL_WRAPPER_PATTERN = /\/cmux\.app\/Contents\/Resources\/bin\//u;

const pathExists = async (filePath: string): Promise<boolean> => {
  try {
    await access(filePath);
    return true;
  } catch {
    // A missing path is the normal "not installed" answer, not a scan failure.
    return false;
  }
};

// `which` needs PATH to find anything, so the child gets this process's environment.
const commandAvailable = async (commandName: string): Promise<boolean> => {
  try {
    const whichReply = await execFileAsync("which", ["-a", commandName], { env: process.env });
    const commandPaths = whichReply.stdout.split("\n");
    return commandPaths.some((commandPath) => commandPath.trim() !== "" && !TERMINAL_WRAPPER_PATTERN.test(commandPath));
  } catch {
    // `which` exits non-zero when the command is absent, which is the normal "not installed" answer.
    return false;
  }
};

const declaredEvidence = (select: (detection: AgentDefinition["detection"]) => ReadonlyArray<string>) =>
  uniqueSorted(agentCatalog.flatMap((agent) => select(agent.detection)));

// Checks one value at a time, in catalog order, and keeps the ones that are present.
const keepPresentValues = async (
  values: ReadonlyArray<string>,
  isPresent: (value: string) => Promise<boolean>,
): Promise<Array<string>> => {
  const presentValues: Array<string> = [];
  for (const value of values) {
    const isValuePresent = await isPresent(value);
    if (isValuePresent) {
      presentValues.push(value);
    }
  }

  return presentValues;
};

// Checks every detection alternative the agent catalog declares, each exactly once.
const captureAgentEvidence = async (homeRoot: string): Promise<AgentEvidence> => {
  const declaredHomePaths = declaredEvidence((detection) => detection.homePaths);
  const homePaths = await keepPresentValues(declaredHomePaths, (homePath) => pathExists(path.join(homeRoot, homePath)));

  const declaredAbsolutePaths = declaredEvidence((detection) => detection.absolutePaths);
  const absolutePaths = await keepPresentValues(declaredAbsolutePaths, pathExists);

  const declaredCommands = declaredEvidence((detection) => detection.commands);
  const commands = await keepPresentValues(declaredCommands, commandAvailable);

  return { homePaths, absolutePaths, commands };
};

export const scanHost = async (): Promise<HostScan> => {
  const homeRoot = absoluteRoot(process.env.HOME || process.env.USERPROFILE || "");
  const isHomeRootUnusable = homeRoot === "/" || homeRoot === "";
  if (isHomeRootUnusable) {
    throw new Error("Cannot scan host: HOME (or USERPROFILE) must resolve to an absolute home directory.");
  }

  const projectRoot = absoluteRoot(process.cwd());
  const platformCheck = hostPlatformSchema.safeParse({ operatingSystem: process.platform });
  const isPlatformInvalid = !platformCheck.success;
  if (isPlatformInvalid) {
    throw new Error(
      `Cannot scan host: Host platform evidence is invalid: ${joinZodIssueMessages(platformCheck.error)}`,
      {
        cause: platformCheck.error,
      },
    );
  }

  const agentEvidence = await captureAgentEvidence(homeRoot);

  return { homeRoot, projectRoot, platform: platformCheck.data, agentEvidence };
};

export const destinationForScope = (request: {
  scope: "global" | "project";
  homeRoot: string;
  projectRoot: string;
}): { _tag: "global"; root: string } | { _tag: "project"; root: string } => {
  switch (request.scope) {
    case "global":
      return { _tag: "global", root: request.homeRoot };
    case "project":
      return { _tag: "project", root: request.projectRoot };
  }
};
