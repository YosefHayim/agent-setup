export const readCodexHomeFolder = (): string | null => process.env.CODEX_HOME || null;

export const readClaudeConfigFolder = (): string | null => process.env.CLAUDE_CONFIG_DIR || null;

export const readClaudeCodeTmpFolder = (): string | null => process.env.CLAUDE_CODE_TMPDIR || null;

export const readXdgStateHome = (): string | null => process.env.XDG_STATE_HOME || null;

export const readAgentId = (): string | null => process.env.AGENT_SETUP_AGENT_ID ?? null;

export const readClaudeCodeSessionAttended = (): string | null => process.env.CLAUDE_CODE_SESSION_ATTENDED ?? null;

export const readDiskCleanupStateFolder = (): string | null => process.env.AGENT_SETUP_DISK_CLEANUP_STATE_DIR || null;

export const readDiskCleanupWaitLimitMilliseconds = (): number | null =>
  Number(process.env.AGENT_SETUP_DISK_CLEANUP_WAIT_LIMIT_MILLISECONDS) || null;

export const readLeftoverBrowserMinimumAgeSeconds = (): string | null =>
  process.env.AGENT_SETUP_LEFTOVER_PROCESS_CLEANUP_BROWSER_MINIMUM_AGE_SECONDS ?? null;

export const readRehomeStateFolder = (): string | null => process.env.AGENT_SETUP_REHOME_STATE_DIR || null;
