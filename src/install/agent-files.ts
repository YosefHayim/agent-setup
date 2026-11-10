import { join } from "node:path";

import type { AgentDefinition } from "#src/catalog/agent-catalog.js";
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
import { createInstallError, type InstallRequest, wrapAsInstallError } from "./install-request.js";
import type { PreviousFileValue } from "./ownership.js";
import type { PreparedSkill } from "./package-files.js";
import type { FileChange } from "./plan.js";
import type { Receipt } from "./receipt.js";

interface AgentWritesRequest {
  request: InstallRequest;
  selectedAgents: ReadonlyArray<AgentDefinition>;
  preparedSkills: ReadonlyArray<PreparedSkill>;
  previousReceipt: Receipt | undefined;
}

interface FormatWritesRequest extends AgentWritesRequest {
  agent: AgentDefinition;
}

interface InspectedFile {
  path: string;
  snapshot: FileSnapshot;
  previous: PreviousFileValue;
}

interface PlannedFile {
  readonly _tag: string;
}

// Planners and checks throw plain errors; each one becomes an InstallError.
const tryAsInstallError = <Planned>(action: () => Planned): Planned => {
  try {
    return action();
  } catch (error) {
    throw wrapAsInstallError(error);
  }
};

// Reads every destination once and resolves the prior state its receipt keeps; desired bytes allow adoption.
const readWholeFiles = async ({
  root,
  previousReceipt,
  desiredFiles,
}: {
  root: string;
  previousReceipt: Receipt | undefined;
  desiredFiles: ReadonlyMap<string, Uint8Array | undefined>;
}): Promise<InspectedFile[]> =>
  Promise.all(
    [...desiredFiles].map(async ([filePath, desiredBytes]) => {
      const snapshot = await readFileSnapshot(join(root, filePath));
      const previous = tryAsInstallError(() =>
        previousWholeFile({ receipt: previousReceipt, filePath, snapshot, desiredBytes }),
      );

      return { path: filePath, snapshot, previous };
    }),
  );

const checkPlannedWrites = (
  writes: ReadonlyArray<{ file: { path: string } }>,
  inspectedFiles: ReadonlyArray<InspectedFile>,
): FileChange[] =>
  writes.map((write) => {
    const inspectedFile = inspectedFiles.find((candidate) => candidate.path === write.file.path);
    const isInspectedFileMissing = inspectedFile == null;
    if (isInspectedFileMissing) {
      throw createInstallError(`Missing inspected state for ${write.file.path}.`);
    }

    return tryAsInstallError(() =>
      checkFileChange({ ...write, expectedCurrent: expectedCurrent(inspectedFile.snapshot) }),
    );
  });

const createSkillDirectoryWrites = async (formatRequest: FormatWritesRequest): Promise<FileChange[]> => {
  const target = formatRequest.agent.target;
  const isNotSkillDirectory = target._tag !== "skillDirectory";
  if (isNotSkillDirectory) {
    return [];
  }

  const desiredFiles = new Map(
    formatRequest.preparedSkills.flatMap((skill) =>
      skill.sourceFiles.map((file): [string, Uint8Array] => [
        `${target.path}/${skill.installedSkill.id}/${file.path}`,
        file.bytes,
      ]),
    ),
  );
  const inspectedFiles = await readWholeFiles({
    root: formatRequest.request.destination.root,
    previousReceipt: formatRequest.previousReceipt,
    desiredFiles,
  });

  const plan = tryAsInstallError(() =>
    planSkillDirectory({
      agent: formatRequest.agent,
      skills: formatRequest.preparedSkills.map(({ installedSkill, sourceFiles }) => ({ installedSkill, sourceFiles })),
      previousFiles: inspectedFiles.map(({ path, previous }) => ({ path, previous })),
    }),
  );

  return checkPlannedWrites(plan.writes, inspectedFiles);
};

const createRuleFileWrites = async (formatRequest: FormatWritesRequest): Promise<FileChange[]> => {
  const target = formatRequest.agent.target;
  const isNotRuleFile = target._tag !== "ruleFile";
  if (isNotRuleFile) {
    return [];
  }

  const desiredFiles = new Map<string, Uint8Array | undefined>(
    formatRequest.preparedSkills.map((skill) => [
      `${target.directory}/${skill.installedSkill.id}${target.extension}`,
      undefined,
    ]),
  );
  const inspectedFiles = await readWholeFiles({
    root: formatRequest.request.destination.root,
    previousReceipt: formatRequest.previousReceipt,
    desiredFiles,
  });

  const plan = tryAsInstallError(() =>
    planRuleFiles({
      agent: formatRequest.agent,
      skills: formatRequest.preparedSkills.map(({ installedSkill, markdown }) => ({ installedSkill, markdown })),
      previousFiles: inspectedFiles.map(({ path, previous }) => ({ path, previous })),
    }),
  );

  return checkPlannedWrites(plan.writes, inspectedFiles);
};

// Instruction files and native links are shared or merged into user files, so each keeps a receipt kind.
const createSharedFileWrites = async ({
  root,
  previousReceipt,
  filePath,
  kind,
  planFile,
}: {
  root: string;
  previousReceipt: Receipt | undefined;
  filePath: string;
  kind: "instruction" | "instructionLink";
  planFile: (files: { currentFile: FileSnapshot; previousFile: unknown }) => PlannedFile;
}): Promise<FileChange[]> => {
  const currentFile = await readFileSnapshot(join(root, filePath));
  const previousFile = previousReceiptFile(previousReceipt, filePath);
  const isPreviousFileOtherKind = previousFile != null && previousFile.kind._tag !== kind;
  if (isPreviousFileOtherKind) {
    const label = kind === "instruction" ? "instruction" : "native config";

    throw createInstallError(`Receipted ${label} path ${filePath} has an incompatible file kind.`);
  }

  const isPreviousFileMissing = previousFile == null;
  const previousFileState = isPreviousFileMissing ? { _tag: "missing" } : { _tag: "owned", file: previousFile };
  const plannedFile = tryAsInstallError(() => planFile({ currentFile, previousFile: previousFileState }));

  const isNothingPlanned = plannedFile._tag === "none";
  if (isNothingPlanned) {
    return [];
  }

  return [tryAsInstallError(() => checkFileChange({ ...plannedFile, expectedCurrent: expectedCurrent(currentFile) }))];
};

const createInstructionWrites = async (writesRequest: AgentWritesRequest): Promise<FileChange[]> => {
  const hasNoSkills = writesRequest.preparedSkills.length === 0;
  if (hasNoSkills) {
    return [];
  }

  const instructionPaths = [...new Set(writesRequest.selectedAgents.flatMap((agent) => instructionPath(agent) ?? []))];
  const writes = await Promise.all(
    instructionPaths.map((filePath) =>
      createSharedFileWrites({
        root: writesRequest.request.destination.root,
        previousReceipt: writesRequest.previousReceipt,
        filePath,
        kind: "instruction",
        planFile: ({ currentFile, previousFile }) =>
          planInstructionFile({
            path: filePath,
            desired: {
              _tag: "present",
              agentIds: writesRequest.selectedAgents
                .filter((agent) => instructionPath(agent) === filePath)
                .map((agent) => agent.id),
              skills: writesRequest.preparedSkills.map(({ installedSkill, markdown }) => ({
                installedSkill,
                markdown,
              })),
            },
            currentFile,
            previousFile,
          }),
      }),
    ),
  );

  return writes.flat();
};

const createInstructionLinkWrite = async ({
  writesRequest,
  agent,
}: {
  writesRequest: AgentWritesRequest;
  agent: AgentDefinition;
}): Promise<FileChange[]> => {
  const target = agent.target;
  const isNotInstructionLink = target._tag !== "instructionLink";
  if (isNotInstructionLink) {
    return [];
  }

  return createSharedFileWrites({
    root: writesRequest.request.destination.root,
    previousReceipt: writesRequest.previousReceipt,
    filePath: target.configPath,
    kind: "instructionLink",
    planFile: ({ currentFile, previousFile }) =>
      planInstructionLink({ agent, desired: { _tag: "present" }, currentFile, previousFile }),
  });
};

const createInstructionLinkWrites = async (writesRequest: AgentWritesRequest): Promise<FileChange[]> => {
  const hasNoSkills = writesRequest.preparedSkills.length === 0;
  if (hasNoSkills) {
    return [];
  }

  const writes = await Promise.all(
    writesRequest.selectedAgents.map((agent) => createInstructionLinkWrite({ writesRequest, agent })),
  );

  return writes.flat();
};

export const createAgentWrites = async (writesRequest: AgentWritesRequest): Promise<FileChange[]> => {
  const directoryWrites = await Promise.all(
    writesRequest.selectedAgents.map((agent) => createSkillDirectoryWrites({ ...writesRequest, agent })),
  );
  const ruleWrites = await Promise.all(
    writesRequest.selectedAgents.map((agent) => createRuleFileWrites({ ...writesRequest, agent })),
  );
  const instructionWrites = await createInstructionWrites(writesRequest);
  const instructionLinkWrites = await createInstructionLinkWrites(writesRequest);

  return [...directoryWrites.flat(), ...ruleWrites.flat(), ...instructionWrites, ...instructionLinkWrites];
};
