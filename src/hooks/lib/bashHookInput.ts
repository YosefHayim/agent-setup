import { isRecord } from "./jsonLines.js";

// Claude Code names the shell command "command"; Codex names it "cmd".
export const shellCommandOf = (hookInput: unknown): string => {
  if (!isRecord(hookInput) || !isRecord(hookInput.tool_input)) {
    return "";
  }

  const { command, cmd } = hookInput.tool_input;
  if (typeof command === "string") {
    return command;
  }

  return typeof cmd === "string" ? cmd : "";
};

export const startFolderOf = (hookInput: unknown): string => {
  if (isRecord(hookInput) && typeof hookInput.cwd === "string" && hookInput.cwd !== "") {
    return hookInput.cwd;
  }

  return process.cwd();
};
