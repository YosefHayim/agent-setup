import { isPlainObject } from "./json-lines.js";

// Claude Code names the shell command "command"; Codex names it "cmd".
export const readShellCommand = (hookDetails: unknown): string => {
  const toolDetails = isPlainObject(hookDetails) ? hookDetails.tool_input : null;
  const isToolDetailsMissing = !isPlainObject(toolDetails);
  if (isToolDetailsMissing) {
    return "";
  }

  const { command, cmd } = toolDetails;

  const isCommandString = typeof command === "string";
  if (isCommandString) {
    return command;
  }

  const isCommandFieldString = typeof cmd === "string";
  return isCommandFieldString ? cmd : "";
};

export const startFolderOf = (hookDetails: unknown): string => {
  const cwd = isPlainObject(hookDetails) ? hookDetails.cwd : null;
  const hasWorkingFolder = typeof cwd === "string" && cwd !== "";
  if (hasWorkingFolder) {
    return cwd;
  }

  return process.cwd();
};
