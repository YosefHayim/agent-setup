import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const hookPath = fileURLToPath(new URL("./activeRunReminder.ts", import.meta.url));
const packageRoot = path.resolve(path.dirname(hookPath), "../../../..");
const REPOSITORY_NAME = "agent-run-repo";
const ACTIVE_RUN_TITLE = "Code-shape cleanup";
const roots: Array<string> = [];

type Scenario = {
  readonly root: string;
  readonly homeFolder: string;
  readonly stateFolder: string;
  readonly repositoryFolder: string;
};

const createScenario = (): Scenario => {
  const root = mkdtempSync(path.join(packageRoot, "tmp-active-run-reminder-"));
  roots.push(root);

  return {
    root,
    homeFolder: path.join(root, "home"),
    stateFolder: path.join(root, "state"),
    repositoryFolder: path.join(root, REPOSITORY_NAME),
  };
};

// Git variables such as GIT_DIR come from an outer git hook and would point these calls at another repository.
const testEnvironment = (): NodeJS.ProcessEnv =>
  Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")));

const runGit = (request: { readonly folder: string; readonly args: ReadonlyArray<string> }) =>
  spawnSync("git", ["-C", request.folder, ...request.args], { encoding: "utf8", env: testEnvironment() });

const createRepository = (folder: string): void => {
  mkdirSync(folder, { recursive: true });
  runGit({ folder, args: ["init", "--quiet"] });
};

const writeActiveRunFile = (request: { readonly stateFolder: string; readonly activeRunJson: string }) => {
  const runFolder = path.join(request.stateFolder, "agent-setup", "runs", REPOSITORY_NAME);
  mkdirSync(runFolder, { recursive: true });
  writeFileSync(path.join(runFolder, "active-run.json"), request.activeRunJson);
};

const writeValidActiveRun = (scenario: Scenario, stateFolder: string): string => {
  const specPath = path.join(scenario.root, "SPEC.md");
  const reportPath = path.join(scenario.root, "report.md");
  writeFileSync(specPath, "# Spec\n");
  writeActiveRunFile({
    stateFolder,
    activeRunJson: JSON.stringify({ title: ACTIVE_RUN_TITLE, specPath, reportPath }),
  });

  return specPath;
};

const runHook = (request: {
  readonly scenario: Scenario;
  readonly hookInput: string;
  readonly stateHome: string | null;
}) => {
  const environment: NodeJS.ProcessEnv = {
    ...testEnvironment(),
    HOME: request.scenario.homeFolder,
    // Git never climbs above the temp root, so a test folder is not inside this repository.
    GIT_CEILING_DIRECTORIES: request.scenario.root,
  };
  delete environment.XDG_STATE_HOME;
  if (request.stateHome !== null) environment.XDG_STATE_HOME = request.stateHome;

  return spawnSync(process.execPath, ["--import", "tsx", hookPath], {
    cwd: request.scenario.repositoryFolder,
    input: request.hookInput,
    encoding: "utf8",
    env: environment,
  });
};

const hookInputFor = (request: { readonly hookEventName: string; readonly cwd: string }): string =>
  JSON.stringify({ hook_event_name: request.hookEventName, cwd: request.cwd });

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("activeRunReminder process boundary", () => {
  it("reminds the session at SessionStart to re-read the spec of the active run", () => {
    const scenario = createScenario();
    createRepository(scenario.repositoryFolder);
    const specPath = writeValidActiveRun(scenario, scenario.stateFolder);
    const hookInput = hookInputFor({ hookEventName: "SessionStart", cwd: scenario.repositoryFolder });

    const execution = runHook({ scenario, hookInput, stateHome: scenario.stateFolder });

    expect(execution.status).toBe(0);
    expect(execution.stderr).toBe("");
    const output = JSON.parse(execution.stdout);
    expect(output.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(output.hookSpecificOutput.additionalContext).toContain(`This repo has an active run: ${ACTIVE_RUN_TITLE}.`);
    expect(output.hookSpecificOutput.additionalContext).toContain(`read ${specPath} in full`);
  });

  it("reminds a subagent at SubagentStart with the same spec line", () => {
    const scenario = createScenario();
    createRepository(scenario.repositoryFolder);
    writeValidActiveRun(scenario, scenario.stateFolder);
    const hookInput = hookInputFor({ hookEventName: "SubagentStart", cwd: scenario.repositoryFolder });

    const execution = runHook({ scenario, hookInput, stateHome: scenario.stateFolder });

    expect(execution.status).toBe(0);
    const output = JSON.parse(execution.stdout);
    expect(output.hookSpecificOutput.hookEventName).toBe("SubagentStart");
    expect(output.hookSpecificOutput.additionalContext).toContain(`This repo has an active run: ${ACTIVE_RUN_TITLE}.`);
  });

  it("says the spec is missing when the active run points to a file that does not exist", () => {
    const scenario = createScenario();
    createRepository(scenario.repositoryFolder);
    const missingSpecPath = path.join(scenario.root, "missing-SPEC.md");
    writeActiveRunFile({
      stateFolder: scenario.stateFolder,
      activeRunJson: JSON.stringify({
        title: ACTIVE_RUN_TITLE,
        specPath: missingSpecPath,
        reportPath: path.join(scenario.root, "report.md"),
      }),
    });
    const hookInput = hookInputFor({ hookEventName: "SessionStart", cwd: scenario.repositoryFolder });

    const execution = runHook({ scenario, hookInput, stateHome: scenario.stateFolder });

    expect(execution.status).toBe(0);
    const output = JSON.parse(execution.stdout);
    expect(output.hookSpecificOutput.additionalContext).toBe(
      `This repo's active-run.json points to a missing spec (${missingSpecPath}). Tell the user before you continue.`,
    );
  });

  it("stays silent outside a git repository", () => {
    const scenario = createScenario();
    mkdirSync(scenario.repositoryFolder, { recursive: true });
    writeValidActiveRun(scenario, scenario.stateFolder);
    const hookInput = hookInputFor({ hookEventName: "SessionStart", cwd: scenario.repositoryFolder });

    const execution = runHook({ scenario, hookInput, stateHome: scenario.stateFolder });

    expect(execution.status).toBe(0);
    expect(execution.stdout).toBe("");
  });

  it("stays silent when the repository has no active-run.json", () => {
    const scenario = createScenario();
    createRepository(scenario.repositoryFolder);
    const hookInput = hookInputFor({ hookEventName: "SessionStart", cwd: scenario.repositoryFolder });

    const execution = runHook({ scenario, hookInput, stateHome: scenario.stateFolder });

    expect(execution.status).toBe(0);
    expect(execution.stdout).toBe("");
  });

  it("finds the active run of the main repository from one of its worktrees", () => {
    const scenario = createScenario();
    createRepository(scenario.repositoryFolder);
    runGit({
      folder: scenario.repositoryFolder,
      args: [
        "-c",
        "user.name=agent-setup tests",
        "-c",
        "user.email=tests@example.invalid",
        "commit",
        "--quiet",
        "--allow-empty",
        "-m",
        "start",
      ],
    });
    const worktreeFolder = path.join(scenario.root, "a-worktree-folder");
    runGit({ folder: scenario.repositoryFolder, args: ["worktree", "add", "--quiet", "--detach", worktreeFolder] });
    writeValidActiveRun(scenario, scenario.stateFolder);
    const hookInput = hookInputFor({ hookEventName: "SessionStart", cwd: worktreeFolder });

    const execution = runHook({ scenario, hookInput, stateHome: scenario.stateFolder });

    expect(execution.status).toBe(0);
    const output = JSON.parse(execution.stdout);
    expect(output.hookSpecificOutput.additionalContext).toContain(`This repo has an active run: ${ACTIVE_RUN_TITLE}.`);
  });

  it("reads the runs folder under XDG_STATE_HOME and ignores the default folder under HOME", () => {
    const scenario = createScenario();
    createRepository(scenario.repositoryFolder);
    writeValidActiveRun(scenario, scenario.stateFolder);
    const decoyHomeStateFolder = path.join(scenario.homeFolder, ".local", "state");
    writeActiveRunFile({
      stateFolder: decoyHomeStateFolder,
      activeRunJson: JSON.stringify({ title: "Decoy run", specPath: "/missing", reportPath: "/missing" }),
    });
    const hookInput = hookInputFor({ hookEventName: "SessionStart", cwd: scenario.repositoryFolder });

    const execution = runHook({ scenario, hookInput, stateHome: scenario.stateFolder });

    expect(execution.status).toBe(0);
    const output = JSON.parse(execution.stdout);
    expect(output.hookSpecificOutput.additionalContext).toContain(ACTIVE_RUN_TITLE);
    expect(output.hookSpecificOutput.additionalContext).not.toContain("Decoy run");
  });

  it("reads the runs folder under HOME/.local/state when XDG_STATE_HOME is unset", () => {
    const scenario = createScenario();
    createRepository(scenario.repositoryFolder);
    const defaultStateFolder = path.join(scenario.homeFolder, ".local", "state");
    writeValidActiveRun(scenario, defaultStateFolder);
    const hookInput = hookInputFor({ hookEventName: "SessionStart", cwd: scenario.repositoryFolder });

    const execution = runHook({ scenario, hookInput, stateHome: null });

    expect(execution.status).toBe(0);
    const output = JSON.parse(execution.stdout);
    expect(output.hookSpecificOutput.additionalContext).toContain(`This repo has an active run: ${ACTIVE_RUN_TITLE}.`);
  });

  it("fails open with clean stdout when hook input is malformed", () => {
    const scenario = createScenario();
    createRepository(scenario.repositoryFolder);

    const execution = runHook({ scenario, hookInput: "{", stateHome: scenario.stateFolder });

    expect(execution.status).toBe(0);
    expect(execution.stdout).toBe("");
  });

  it("fails open with clean stdout when active-run.json is malformed", () => {
    const scenario = createScenario();
    createRepository(scenario.repositoryFolder);
    writeActiveRunFile({ stateFolder: scenario.stateFolder, activeRunJson: "{" });
    const hookInput = hookInputFor({ hookEventName: "SessionStart", cwd: scenario.repositoryFolder });

    const execution = runHook({ scenario, hookInput, stateHome: scenario.stateFolder });

    expect(execution.status).toBe(0);
    expect(execution.stdout).toBe("");
  });
});
