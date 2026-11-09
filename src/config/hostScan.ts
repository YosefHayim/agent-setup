// Home and project roots, platform, and agent evidence, observed once per command and handed to capabilities.

import { Command, FileSystem, Path } from "@effect/platform";
import { Effect, Schema } from "effect";

import { type AgentDefinition, agentCatalog, agentEvidenceSchema } from "../catalog/agentCatalog.js";

class HostScanError extends Schema.TaggedError<HostScanError>()("HostScanError", {
  issue: Schema.NonEmptyString.annotations({
    description: "Actionable host scan failure.",
  }),
}) {
  get message(): string {
    return `Cannot scan host: ${this.issue}`;
  }
}

export const hostPlatformSchema = Schema.Struct({
  operatingSystem: Schema.Literal(
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
  ).annotations({
    description: "Node operating-system identifier used to evaluate feature platform requirements.",
  }),
}).annotations({
  description: "Read-only host observations used by feature diagnostics.",
});

const hostScanSchema = Schema.Struct({
  homeRoot: Schema.String.annotations({
    description: "Absolute home root that owns global-scope files.",
  }),
  projectRoot: Schema.String.annotations({
    description: "Absolute current-project root that owns project-scope files.",
  }),
  platform: hostPlatformSchema,
  agentEvidence: agentEvidenceSchema,
}).annotations({
  description: "Complete host observation handed to capabilities so they never probe the environment.",
});

export type HostScan = Schema.Schema.Type<typeof hostScanSchema>;

const uniqueSorted = (values: ReadonlyArray<string>): ReadonlyArray<string> => [...new Set(values)].sort();

const absoluteRoot = (value: string, path: Path.Path): string => path.resolve(value).replaceAll("\\", "/");

// cmux puts a wrapper for every agent it integrates with (grok, opencode, …) on each terminal's PATH whether or not
// the agent is installed — its grok wrapper only prints "grok not found" — so a wrapper alone is not evidence.
// e.g. "/Applications/cmux.app/Contents/Resources/bin/grok"
const TERMINAL_WRAPPER_PATTERN = /\/cmux\.app\/Contents\/Resources\/bin\//u;

// Effect Command passes no environment unless given one, and `which` needs PATH to find anything.
const commandAvailable = (commandName: string) =>
  Command.make("which", "-a", commandName).pipe(
    Command.env(process.env),
    Command.lines,
    Effect.map((commandPaths) =>
      commandPaths.some((commandPath) => commandPath.trim() !== "" && !TERMINAL_WRAPPER_PATTERN.test(commandPath)),
    ),
    Effect.catchAll(() => Effect.succeed(false)),
  );

const declaredEvidence = (select: (detection: AgentDefinition["detection"]) => ReadonlyArray<string>) =>
  uniqueSorted(agentCatalog.flatMap((agent) => select(agent.detection)));

// Check every detection alternative the agent catalog declares, each exactly once.
const captureAgentEvidence = (homeRoot: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const evidence = {
      homePaths: yield* Effect.filter(
        declaredEvidence((detection) => detection.homePaths),
        (homePath) => fileSystem.exists(path.join(homeRoot, homePath)),
      ),
      absolutePaths: yield* Effect.filter(
        declaredEvidence((detection) => detection.absolutePaths),
        (absolutePath) => fileSystem.exists(absolutePath),
      ),
      commands: yield* Effect.filter(
        declaredEvidence((detection) => detection.commands),
        commandAvailable,
      ),
    };

    return yield* Schema.decodeUnknown(agentEvidenceSchema, { onExcessProperty: "error" })(evidence).pipe(
      Effect.mapError((error) => new HostScanError({ issue: `Observed agent evidence is invalid: ${String(error)}` })),
    );
  });

export const scanHost = Effect.gen(function* () {
  const path = yield* Path.Path;
  const homeRoot = absoluteRoot(process.env.HOME || process.env.USERPROFILE || "", path);
  if (homeRoot === "/" || homeRoot === "") {
    return yield* new HostScanError({
      issue: "HOME (or USERPROFILE) must resolve to an absolute home directory.",
    });
  }

  const projectRoot = absoluteRoot(process.cwd(), path);
  const platform = yield* Schema.decodeUnknown(hostPlatformSchema, { onExcessProperty: "error" })({
    operatingSystem: process.platform,
  }).pipe(
    Effect.mapError((error) => new HostScanError({ issue: `Host platform evidence is invalid: ${String(error)}` })),
  );
  const agentEvidence = yield* captureAgentEvidence(homeRoot);

  return { homeRoot, projectRoot, platform, agentEvidence } satisfies HostScan;
});

export const destinationForScope = (input: {
  scope: "global" | "project";
  homeRoot: string;
  projectRoot: string;
}): { _tag: "global"; root: string } | { _tag: "project"; root: string } => {
  switch (input.scope) {
    case "global":
      return { _tag: "global", root: input.homeRoot };
    case "project":
      return { _tag: "project", root: input.projectRoot };
  }
};
