// Copies the owned CI + publish workflow templates (`src/templates/workflows/`) into a repository.
// Only publish.yml is filled with OWNER/REPO/PACKAGE; every other .yml copies verbatim.

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { z } from "zod";

import { nonEmptyTrimmedTextSchema } from "../install/text-rules.js";
import { joinZodIssueMessages } from "../zod-issue-messages.js";

const execFileAsync = promisify(execFile);

interface WorkflowInputs {
  readonly owner: string;
  readonly repo: string;
  readonly packageName: string;
}

interface TemplateFile {
  readonly name: string;
  readonly text: string;
}

export interface CopiedWorkflows {
  readonly written: ReadonlyArray<string>;
  readonly skipped: ReadonlyArray<string>;
  readonly targetRoot: string;
}

const copyWorkflowsRequestSchema = z.strictObject({
  targetRoot: nonEmptyTrimmedTextSchema,
  templateDirectory: nonEmptyTrimmedTextSchema,
  force: z.boolean(),
});

const packageJsonNameSchema = z.object({
  name: z.string().refine((name) => name.trim() !== ""),
});

export const fillPublishTemplate = (fillRequest: { template: string; inputs: WorkflowInputs }): string =>
  fillRequest.template
    .replaceAll("{{OWNER}}", fillRequest.inputs.owner)
    .replaceAll("{{REPO}}", fillRequest.inputs.repo)
    .replaceAll("{{PACKAGE}}", fillRequest.inputs.packageName);

export const planWorkflowFiles = (planRequest: { files: ReadonlyArray<TemplateFile>; inputs: WorkflowInputs }) =>
  planRequest.files
    .filter((file) => file.name.endsWith(".yml"))
    .map((file) => ({
      name: file.name,
      content:
        file.name === "publish.yml"
          ? fillPublishTemplate({ template: file.text, inputs: planRequest.inputs })
          : file.text,
    }));

const readTemplates = async (templateDirectory: string): Promise<Array<TemplateFile>> => {
  const isTemplateDirectoryMissing = !existsSync(templateDirectory);
  if (isTemplateDirectoryMissing) {
    throw new Error(
      `Cannot copy workflows: src/templates/workflows missing at ${templateDirectory} — reinstall agent-setup.`,
    );
  }

  const names = (await readdir(templateDirectory)).filter((name) => name.endsWith(".yml")).sort();
  const isThereNoTemplate = names.length === 0;
  if (isThereNoTemplate) {
    throw new Error(
      `Cannot copy workflows: No workflow templates found in ${templateDirectory} — reinstall agent-setup.`,
    );
  }

  return Promise.all(
    names.map(async (name) => ({ name, text: await readFile(path.join(templateDirectory, name), "utf8") })),
  );
};

// e.g. "git@github.com:Acme/app.git" or "https://github.com/Acme/app" → owner=Acme, repo=app
const parseGitHubRemote = (url: string): { owner: string; repo: string } | null => {
  const match = url.trim().match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/);
  // Guard proves capture groups exist when match is non-null.
  return match === null ? null : { owner: match[1]!, repo: match[2]! };
};

const detectGitRemote = async (root: string): Promise<{ owner: string; repo: string } | null> => {
  try {
    const remoteReply = await execFileAsync("git", ["remote", "get-url", "origin"], { cwd: root });
    return parseGitHubRemote(remoteReply.stdout);
  } catch {
    // A folder without an origin remote gets the placeholder names, which is the normal answer here.
    return null;
  }
};

const parseJsonText = (text: string): unknown => {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed;
  } catch {
    // A package.json that is not JSON gets the placeholder package name.
    return null;
  }
};

const readPackageName = async (packageJsonPath: string): Promise<string | null> => {
  const isPackageJsonMissing = !existsSync(packageJsonPath);
  if (isPackageJsonMissing) {
    return null;
  }

  const packageJsonText = await readFile(packageJsonPath, "utf8");
  const packageJsonCheck = packageJsonNameSchema.safeParse(parseJsonText(packageJsonText));
  return packageJsonCheck.success ? packageJsonCheck.data.name : null;
};

const detectInputs = async (root: string): Promise<WorkflowInputs> => {
  const remote = await detectGitRemote(root);
  const packageName = await readPackageName(path.join(root, "package.json"));
  return {
    owner: remote?.owner || "OWNER",
    repo: remote?.repo || "REPO",
    packageName: packageName || "your-package",
  };
};

const pathExists = async (filePath: string): Promise<boolean> => {
  try {
    await access(filePath);
    return true;
  } catch {
    // A missing destination file is the normal case for a fresh copy.
    return false;
  }
};

export const copyWorkflows = async (copyRequest: unknown): Promise<CopiedWorkflows> => {
  const requestCheck = copyWorkflowsRequestSchema.safeParse(copyRequest);
  const isRequestInvalid = !requestCheck.success;
  if (isRequestInvalid) {
    throw new Error(
      `Cannot copy workflows: Invalid workflow copy request: ${joinZodIssueMessages(requestCheck.error)}`,
      {
        cause: requestCheck.error,
      },
    );
  }

  const request = requestCheck.data;
  const templates = await readTemplates(request.templateDirectory);
  const inputs = await detectInputs(request.targetRoot);
  const workflowsDir = path.join(request.targetRoot, ".github", "workflows");
  await mkdir(workflowsDir, { recursive: true });

  const written: Array<string> = [];
  const skipped: Array<string> = [];
  for (const file of planWorkflowFiles({ files: templates, inputs })) {
    const destination = path.join(workflowsDir, file.name);
    const isExistingFileKept = !request.force && (await pathExists(destination));
    if (isExistingFileKept) {
      skipped.push(file.name);
      continue;
    }

    await writeFile(destination, file.content);
    written.push(file.name);
  }

  return { written, skipped, targetRoot: request.targetRoot };
};
