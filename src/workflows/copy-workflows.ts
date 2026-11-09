// Copies the owned CI + publish workflow templates (`src/templates/workflows/`) into a repository.
// Only publish.yml is filled with OWNER/REPO/PACKAGE; every other .yml copies verbatim.

import { Command, FileSystem, Path } from "@effect/platform";
import { Effect, Option, Schema } from "effect";

class CopyWorkflowsError extends Schema.TaggedError<CopyWorkflowsError>()("CopyWorkflowsError", {
  issue: Schema.NonEmptyString.annotations({
    description: "Actionable workflow copy failure.",
  }),
}) {
  get message(): string {
    return `Cannot copy workflows: ${this.issue}`;
  }
}

type WorkflowInputs = { readonly owner: string; readonly repo: string; readonly packageName: string };

type TemplateFile = { readonly name: string; readonly text: string };

const copyWorkflowsRequestSchema = Schema.Struct({
  targetRoot: Schema.NonEmptyTrimmedString.annotations({
    description: "Absolute repository root that receives the workflow files.",
  }),
  templateDirectory: Schema.NonEmptyTrimmedString.annotations({
    description: "Absolute directory containing shipped workflow templates.",
  }),
  force: Schema.Boolean.annotations({
    description: "Whether existing workflow files should be overwritten.",
  }),
});

const copiedWorkflowsSchema = Schema.Struct({
  written: Schema.Array(Schema.NonEmptyTrimmedString).annotations({
    description: "Workflow filenames written by this run.",
  }),
  skipped: Schema.Array(Schema.NonEmptyTrimmedString).annotations({
    description: "Workflow filenames kept because they already exist.",
  }),
  targetRoot: Schema.NonEmptyTrimmedString.annotations({
    description: "Absolute repository root that received the workflow files.",
  }),
});

type CopiedWorkflows = Schema.Schema.Type<typeof copiedWorkflowsSchema>;

const packageNameSchema = Schema.parseJson(
  Schema.Struct({ name: Schema.String.pipe(Schema.filter((name) => name.trim() !== "")) }),
);

export const fillPublishTemplate = (input: { template: string; inputs: WorkflowInputs }): string =>
  input.template
    .replaceAll("{{OWNER}}", input.inputs.owner)
    .replaceAll("{{REPO}}", input.inputs.repo)
    .replaceAll("{{PACKAGE}}", input.inputs.packageName);

export const planWorkflowFiles = (input: { files: ReadonlyArray<TemplateFile>; inputs: WorkflowInputs }) =>
  input.files
    .filter((file) => file.name.endsWith(".yml"))
    .map((file) => ({
      name: file.name,
      content:
        file.name === "publish.yml" ? fillPublishTemplate({ template: file.text, inputs: input.inputs }) : file.text,
    }));

const readTemplates = (templateDirectory: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    if (!(yield* fileSystem.exists(templateDirectory))) {
      return yield* new CopyWorkflowsError({
        issue: `src/templates/workflows missing at ${templateDirectory} — reinstall agent-setup.`,
      });
    }

    const names = (yield* fileSystem.readDirectory(templateDirectory)).filter((name) => name.endsWith(".yml")).sort();
    if (names.length === 0) {
      return yield* new CopyWorkflowsError({
        issue: `No workflow templates found in ${templateDirectory} — reinstall agent-setup.`,
      });
    }

    return yield* Effect.forEach(names, (name) =>
      fileSystem.readFileString(path.join(templateDirectory, name)).pipe(Effect.map((text) => ({ name, text }))),
    );
  });

const detectGitRemote = (root: string) =>
  Command.make("git", "remote", "get-url", "origin").pipe(
    Command.workingDirectory(root),
    Command.string,
    Effect.map((url) => {
      // e.g. "git@github.com:Acme/app.git" or "https://github.com/Acme/app" → owner=Acme, repo=app
      const match = url.trim().match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/);
      // Guard proves capture groups exist when match is non-null.
      return match === null ? undefined : { owner: match[1]!, repo: match[2]! };
    }),
    Effect.catchAll(() => Effect.succeed(undefined)),
  );

const readPackageName = (packageJsonPath: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    if (!(yield* fileSystem.exists(packageJsonPath))) {
      return undefined;
    }

    const packageJson = yield* fileSystem.readFileString(packageJsonPath);
    return Option.getOrUndefined(Schema.decodeUnknownOption(packageNameSchema)(packageJson))?.name;
  });

const detectInputs = (root: string) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const remote = yield* detectGitRemote(root);
    const packageName = yield* readPackageName(path.join(root, "package.json"));
    return {
      owner: remote?.owner || "OWNER",
      repo: remote?.repo || "REPO",
      packageName: packageName || "your-package",
    } satisfies WorkflowInputs;
  });

export const copyWorkflows = (input: unknown) =>
  Effect.gen(function* () {
    const request = yield* Schema.decodeUnknown(copyWorkflowsRequestSchema, { onExcessProperty: "error" })(input).pipe(
      Effect.mapError((error) => new CopyWorkflowsError({ issue: `Invalid workflow copy request: ${String(error)}` })),
    );
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const templates = yield* readTemplates(request.templateDirectory);
    const inputs = yield* detectInputs(request.targetRoot);
    const workflowsDir = path.join(request.targetRoot, ".github", "workflows");
    yield* fileSystem.makeDirectory(workflowsDir, { recursive: true });

    const written: Array<string> = [];
    const skipped: Array<string> = [];
    for (const file of planWorkflowFiles({ files: templates, inputs })) {
      const destination = path.join(workflowsDir, file.name);
      if (!request.force && (yield* fileSystem.exists(destination))) {
        skipped.push(file.name);
        continue;
      }

      yield* fileSystem.writeFileString(destination, file.content);
      written.push(file.name);
    }

    return { written, skipped, targetRoot: request.targetRoot } satisfies CopiedWorkflows;
  });
