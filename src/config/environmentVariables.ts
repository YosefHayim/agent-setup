import { Schema } from "effect";

// e.g. "AGENT_SETUP_IDLE_COMPACT_AFTER" — AGENT_SETUP_<AREA>_<SETTING>
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

// Every AGENT_SETUP_* variable any agent-setup code reads; environmentVariables.test.ts fails when src/ drifts from it.
export const environmentVariables = Schema.decodeUnknownSync(Schema.Array(environmentVariableSchema), {
  onExcessProperty: "error",
})([
  {
    name: "AGENT_SETUP_AGENT_ID",
    defaultValue: "set by agent-setup in hook commands",
    purpose:
      "Which agent ran a hook (claude-code, codex, grok). Install writes AGENT_SETUP_AGENT_ID=<agent> in front of the hook commands that read it: idle compact, session rehome, and the scratch cleanup question.",
  },
  {
    name: "AGENT_SETUP_IDLE_COMPACT_AFTER",
    defaultValue: "unset (idleCompactAfter in config.json applies)",
    purpose:
      "Overrides idleCompactAfter for one agent session: off, or a time like 30s. Set it when starting the agent, e.g. `AGENT_SETUP_IDLE_COMPACT_AFTER=30s codex`.",
  },
  {
    name: "AGENT_SETUP_AUTORUN_DRY_RUN",
    defaultValue: "off",
    purpose:
      "When 1, true, or yes, the autorun watcher logs the keystrokes it would type instead of typing them (safe manual testing).",
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
]);
