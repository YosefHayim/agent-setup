import { Schema } from "effect";

// e.g. "AGENT_SETUP_REHOME_STATE_DIR" — AGENT_SETUP_<AREA>_<SETTING>
const ENVIRONMENT_VARIABLE_PATTERN = /^AGENT_SETUP_[A-Z]+(?:_[A-Z]+)+$/;

const environmentVariableSchema = Schema.Struct({
  name: Schema.String.pipe(
    Schema.pattern(ENVIRONMENT_VARIABLE_PATTERN, {
      message: () => "Environment variables are named AGENT_SETUP_<AREA>_<SETTING>.",
    }),
    Schema.annotations({ description: "Exact environment variable name." }),
  ),
  defaultValue: Schema.NonEmptyTrimmedString.annotations({
    description: "What applies when the variable is unset.",
  }),
  purpose: Schema.NonEmptyTrimmedString.annotations({
    description: "What the variable changes, in one or two plain sentences.",
  }),
});

// Every AGENT_SETUP_* variable any agent-setup code reads; environment-variables.test.ts fails when src/ drifts from it.
export const environmentVariables = Schema.decodeUnknownSync(Schema.Array(environmentVariableSchema), {
  onExcessProperty: "error",
})([
  {
    name: "AGENT_SETUP_AGENT_ID",
    defaultValue: "set by agent-setup in hook commands",
    purpose:
      "Which agent ran a hook (claude-code, codex, grok). Install writes AGENT_SETUP_AGENT_ID=<agent> in front of the hook commands that read it: session rehome and the scratch cleanup question.",
  },
  {
    name: "AGENT_SETUP_REHOME_STATE_DIR",
    defaultValue:
      "~/.claude/agent-setup/state/session-rehome for a global install, .claude/agent-setup/state/session-rehome for a project install",
    purpose:
      "Folder for session-rehome's ledger of moved, kept, and deleted sessions, its watcher lock, and its sweep stamp. Tests point it at a temporary folder.",
  },
  {
    name: "AGENT_SETUP_DISK_CLEANUP_STATE_DIR",
    defaultValue:
      "~/.claude/agent-setup/state/disk-cleanup for a global install, .claude/agent-setup/state/disk-cleanup for a project install",
    purpose:
      "Folder for disk-cleanup's watcher lock, the stamp that limits the cache cleanup to once a day, the list of kept worktrees to look at again, and the log of what each pass did. Tests point it at a temporary folder.",
  },
  {
    name: "AGENT_SETUP_DISK_CLEANUP_WAIT_LIMIT_MILLISECONDS",
    defaultValue: "600000 (10 minutes)",
    purpose:
      "How long disk-cleanup's watcher waits for the ended session to stop looking live before it logs that it gave up. Tests set it to a fraction of a second.",
  },
  {
    name: "AGENT_SETUP_LEFTOVER_PROCESS_CLEANUP_BROWSER_MINIMUM_AGE_SECONDS",
    defaultValue: "3600 (1 hour)",
    purpose:
      "How long an orphaned test browser (Lighthouse, Playwright, Puppeteer temporary profile) must have been running before leftover-process-cleanup stops it. Tests set it to a few seconds.",
  },
]);
