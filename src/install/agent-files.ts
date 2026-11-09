/** Per-agent files: skill directories, rule files, shared instruction files, and native instruction links. */

import { Path } from "@effect/platform";
import { Effect, Either } from "effect";

import type { AgentDefinition } from "../catalog/agent-catalog.js";
import { instructionPath, planInstructionFile } from "./agent-formats/instruction-file.js";
import { planInstructionLink } from "./agent-formats/instruction-link.js";
import { planRuleFiles } from "./agent-formats/rule-file.js";
import { planSkillDirectory } from "./agent-formats/skill-directory.js";
import {
  checkFileChange,
  expectedCurrent,
  type FileSnapshot,
  previousReceiptFile,
  previousWholeFile,
  readFileSnapshot,
} from "./host-files.js";
import { InstallError, type InstallRequest, toInstallError } from "./install-request.js";
import type { PreparedSkill } from "./package-files.js";
import type { Receipt } from "./receipt.js";

type AgentWritesRequest = {
  request: InstallRequest;
  selectedAgents: ReadonlyArray<AgentDefinition>;
  preparedSkills: ReadonlyArray<PreparedSkill>;
  previousReceipt: Receipt | undefined;
};

type FormatWritesRequest = AgentWritesRequest & { agent: AgentDefinition };

type InspectedFile = { path: string; snapshot: FileSnapshot };

// Reads every destination once and resolves the prior state its receipt keeps; desired bytes allow adoption.
const inspectWholeFiles = (input: FormatWritesRequest, desired: ReadonlyMap<string, Uint8Array | undefined>) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;

    return yield* Effect.forEach([...desired], ([filePath, desiredBytes]) =>
      Effect.gen(function* () {
        const snapshot = yield* readFileSnapshot(path.join(input.request.destination.root, filePath));
        const previous = yield* previousWholeFile({
          receipt: input.previousReceipt,
          filePath,
          snapshot,
          desiredBytes,
        });

        return { path: filePath, snapshot, previous };
      }),
    );
  });

const withExpectedCurrent = (
  writes: ReadonlyArray<{ readonly file: { readonly path: string } }>,
  inspected: ReadonlyArray<InspectedFile>,
) =>
  Either.all(
    writes.map((write) => {
      const file = inspected.find((candidate) => candidate.path === write.file.path);

      return file === undefined
        ? Either.left(new InstallError({ issue: `Missing inspected state for ${write.file.path}.` }))
        : checkFileChange({ ...write, expectedCurrent: expectedCurrent(file.snapshot) });
    }),
  );

const createSkillDirectoryWrites = (input: FormatWritesRequest) =>
  Effect.gen(function* () {
    if (input.agent.target._tag !== "skillDirectory") {
      return [];
    }

    const target = input.agent.target;
    const files = yield* inspectWholeFiles(
      input,
      new Map(
        input.preparedSkills.flatMap((skill) =>
          skill.sourceFiles.map((file): [string, Uint8Array] => [
            `${target.path}/${skill.installedSkill.id}/${file.path}`,
            file.bytes,
          ]),
        ),
      ),
    );
    const plan = yield* Either.mapLeft(
      planSkillDirectory({
        agent: input.agent,
        skills: input.preparedSkills.map(({ installedSkill, sourceFiles }) => ({ installedSkill, sourceFiles })),
        previousFiles: files.map(({ path, previous }) => ({ path, previous })),
      }),
      toInstallError,
    );

    return yield* withExpectedCurrent(plan.writes, files);
  });

const createRuleFileWrites = (input: FormatWritesRequest) =>
  Effect.gen(function* () {
    if (input.agent.target._tag !== "ruleFile") {
      return [];
    }

    const target = input.agent.target;
    const files = yield* inspectWholeFiles(
      input,
      new Map(
        input.preparedSkills.map((skill) => [
          `${target.directory}/${skill.installedSkill.id}${target.extension}`,
          undefined,
        ]),
      ),
    );
    const plan = yield* Either.mapLeft(
      planRuleFiles({
        agent: input.agent,
        skills: input.preparedSkills.map(({ installedSkill, markdown }) => ({ installedSkill, markdown })),
        previousFiles: files.map(({ path, previous }) => ({ path, previous })),
      }),
      toInstallError,
    );

    return yield* withExpectedCurrent(plan.writes, files);
  });

type FormatPlan = Either.Either<{ readonly _tag: string }, unknown>;

// Instruction files and native links are shared or merged into user files, so each keeps a receipt kind.
const createSharedFileWrite = (input: {
  root: string;
  previousReceipt: Receipt | undefined;
  filePath: string;
  kind: "instruction" | "instructionLink";
  plan: (files: { currentFile: FileSnapshot; previousFile: unknown }) => FormatPlan;
}) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const snapshot = yield* readFileSnapshot(path.join(input.root, input.filePath));
    const previousFile = previousReceiptFile(input.previousReceipt, input.filePath);
    if (previousFile !== undefined && previousFile.kind._tag !== input.kind) {
      const label = input.kind === "instruction" ? "instruction" : "native config";

      return yield* new InstallError({
        issue: `Receipted ${label} path ${input.filePath} has an incompatible file kind.`,
      });
    }

    const plan = yield* Either.mapLeft(
      input.plan({
        currentFile: snapshot,
        previousFile: previousFile === undefined ? { _tag: "missing" } : { _tag: "owned", file: previousFile },
      }),
      toInstallError,
    );
    if (plan._tag === "none") {
      return [];
    }

    return [yield* checkFileChange({ ...plan, expectedCurrent: expectedCurrent(snapshot) })];
  });

const createInstructionWrites = (input: AgentWritesRequest) =>
  Effect.gen(function* () {
    if (input.preparedSkills.length === 0) {
      return [];
    }

    const instructionPaths = [...new Set(input.selectedAgents.flatMap((agent) => instructionPath(agent) || []))];
    const writes = yield* Effect.forEach(instructionPaths, (filePath) =>
      createSharedFileWrite({
        root: input.request.destination.root,
        previousReceipt: input.previousReceipt,
        filePath,
        kind: "instruction",
        plan: (files) =>
          planInstructionFile({
            path: filePath,
            desired: {
              _tag: "present",
              agentIds: input.selectedAgents
                .filter((agent) => instructionPath(agent) === filePath)
                .map((agent) => agent.id),
              skills: input.preparedSkills.map(({ installedSkill, markdown }) => ({ installedSkill, markdown })),
            },
            ...files,
          }),
      }),
    );

    return writes.flat();
  });

const createInstructionLinkWrites = (input: AgentWritesRequest) =>
  Effect.gen(function* () {
    if (input.preparedSkills.length === 0) {
      return [];
    }

    const writes = yield* Effect.forEach(input.selectedAgents, (agent) =>
      agent.target._tag === "instructionLink"
        ? createSharedFileWrite({
            root: input.request.destination.root,
            previousReceipt: input.previousReceipt,
            filePath: agent.target.configPath,
            kind: "instructionLink",
            plan: (files) => planInstructionLink({ agent, desired: { _tag: "present" }, ...files }),
          })
        : Effect.succeed([]),
    );

    return writes.flat();
  });

export const createAgentWrites = (input: AgentWritesRequest) =>
  Effect.gen(function* () {
    const directoryWrites = yield* Effect.forEach(input.selectedAgents, (agent) =>
      createSkillDirectoryWrites({ ...input, agent }),
    );
    const ruleWrites = yield* Effect.forEach(input.selectedAgents, (agent) =>
      createRuleFileWrites({ ...input, agent }),
    );
    const instructionWrites = yield* createInstructionWrites(input);
    const instructionLinkWrites = yield* createInstructionLinkWrites(input);

    return [...directoryWrites.flat(), ...ruleWrites.flat(), ...instructionWrites, ...instructionLinkWrites];
  });
