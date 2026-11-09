import os from "node:os";
import path from "node:path";

// e.g. "/tmp/a.log", "> /private/tmp/x", "/var/folders/1b/x/T/a", "$TMPDIR/out" — not "/Users/me/tmpfiles" or "./tmp/a"
const SCRATCH_FOLDER_REFERENCE =
  /(?:^|[\s'"`=:(<>&|])(?:\/private)?\/(?:tmp|var\/tmp|dev\/shm|run\/user\/\d+)(?:\/|$|[\s'"`),;])|(?:^|[\s'"`=:(<>&|])(?:\/private)?\/var\/folders\/[^\s'"`]+\/T(?:\/|$|[\s'"`),;])|\$\{?(?:TMPDIR|TMP|TEMP|XDG_RUNTIME_DIR)\}?/i;
// e.g. "os.tmpdir()", "tempfile.gettempdir()", "FileManager.default.temporaryDirectory" — not "tmpdirName"
const RUNTIME_SCRATCH_LOOKUP =
  /\b(?:os\.)?(?:tmpdir|TempDir)\s*\(|\b(?:std::)?env::temp_dir\s*\(|\btempfile\.gettempdir\s*\(|\bDir\.tmpdir\b|\bSystem\.getProperty\s*\(\s*['"]java\.io\.tmpdir['"]|\bNSTemporaryDirectory\s*\(|\b(?:FileManager(?:\.default)?|URL)\.temporaryDirectory\b|\bPath\.GetTempPath\s*\(/i;
// e.g. "mktemp", "tempfile.NamedTemporaryFile", "os.CreateTemp(" — they default to the system scratch folder
const SCRATCH_FILE_FACTORY =
  /\b(?:mktemp|mkstemp|mkdtemp|tmpfile|tempnam)\b|\btempfile\.(?:TemporaryFile|NamedTemporaryFile|SpooledTemporaryFile|TemporaryDirectory|mkdtemp|mkstemp)\b|\bos\.(?:CreateTemp|MkdirTemp)\s*\(|\b(?:Files|File)\.createTemp(?:File|Directory)\s*\(|\bPath\.GetTempFileName\s*\(|\bTempfile\b|\bDir\.mktmpdir\b/i;
// e.g. "export TMPDIR=/tmp/x", "TMP=/private/var/folders/1b/x/T" — not "TMPDIR=./cache"
const SCRATCH_VARIABLE_ASSIGNMENT =
  /(?:^|\s)(?:export\s+)?(?:TMPDIR|TMP|TEMP|XDG_RUNTIME_DIR)\s*=\s*['"]?(?:(?:\/private)?\/(?:tmp|var\/tmp|dev\/shm|run\/user\/\d+)|(?:\/private)?\/var\/folders\/[^\s'"]+\/T)/i;
// e.g. "> /tmp/a.log", "2>> /private/tmp/b", "&> $TMPDIR/c" — not "> ./logs/a.log"
const REDIRECT_INTO_SCRATCH =
  /(?:^|[\s;|])(?:\d+|\{[A-Za-z_][A-Za-z0-9_]*\})?(?:&>>|&>|>>|>\||<>|>)\s*['"]?(?:(?:\/private)?\/(?:tmp|var\/tmp|dev\/shm|run\/user\/\d+)|(?:\/private)?\/var\/folders\/[^\s'"]+\/T|\$\{?(?:TMPDIR|TMP|TEMP|XDG_RUNTIME_DIR)\}?)(?:\/|['"]|$)/i;
// e.g. "cp a.txt /tmp/a.txt", "mv build /private/tmp" — not "cp /tmp/a.txt ./a.txt" or "rm -rf /tmp/tend-install-proof"
const COPY_INTO_SCRATCH =
  /(?:^|[\s;&|(])(?:cp|mv|install|rsync|scp|sftp|ln)(?=\s)[^\n;|&]*\s+['"]?(?:(?:\/private)?\/(?:tmp|var\/tmp|dev\/shm|run\/user\/\d+)|(?:\/private)?\/var\/folders\/[^\s'"]+\/T|\$\{?(?:TMPDIR|TMP|TEMP|XDG_RUNTIME_DIR)\}?)[^\s'"]*['"]?\s*(?:$|[;&|])/i;
// e.g. "touch", "tee", "sed -i", "curl -o", "git clone", "writeFileSync(" — commands and calls that create or change files
const FILE_MUTATION_COMMAND =
  /(?:^|[;&|]\s*|\b)(?:touch|mkdir|mkfifo|mknod|truncate|fallocate|tee|split|csplit)\b|\bdd\b[^\n]*\bof\s*=|\bsort\b[^\n]*(?:\s-o\s|\s--output(?:=|\s))|\b(?:sed|perl|ruby)\b[^\n]*\s-i(?:\s|['".]|$)|\b(?:tar|zip|unzip|gzip|bzip2|xz)\b[^\n]*(?:\s-f\s|\s--file(?:=|\s)|\s-d\s|\s--directory(?:=|\s))|\b(?:curl|wget)\b[^\n]*(?:\s-o\s|\s--output(?:=|\s)|\s-O(?:\s|$)|\s--remote-name(?:\s|$)|\s--output-dir(?:=|\s)|\s--output-document(?:=|\s)|\s--directory-prefix(?:=|\s)|\s--cookie-jar(?:=|\s)|\s--dump-header(?:=|\s)|\s--hsts(?:=|\s)|\s--alt-svc(?:=|\s)|\s--libcurl(?:=|\s))|\bgit\s+(?:clone|worktree\s+add)\b|\bgit\s+(?:archive|format-patch)\b[^\n]*(?:\s-o\s|\s--output(?:=|\s))|\b(?:write|writeFile|writeFileSync|WriteAllText|WriteAllBytes|appendFile|appendFileSync|copyFile|copyFileSync|cp|cpSync|createWriteStream|write_text|write_bytes|copyfile|copy2|copytree|file_put_contents|create_dir|createDirectory|CreateDirectory|createDirectories|createFile|newOutputStream|newBufferedWriter|mkdir|mkdirs|mkdirSync|rename|renameSync|move|symlink|truncate|truncateSync|OpenFile)\s*\(|\b(?:File|Files|Path|FileManager|Directory|fs(?:\.promises)?|os|shutil|std::fs|Deno|Bun)[:.]+(?:write|WriteAllText|WriteAllBytes|append|create|copy|cp|move|rename|mkdir|mkdirs|symlink|truncate|writeFile|appendFile|copyFile|createWriteStream|writeTextFile|writeFileSync|appendFileSync|copyFileSync|cpSync|mkdirSync|renameSync|truncateSync|write_text|write_bytes)\b|\bopen\s*\([^\n]*['"](?:w|a|x)[+b]?['"]/i;
// e.g. the lines under "cat > notes.txt <<'EOF'", "git commit -m \"$(cat <<'EOF'", "git commit -F - <<'EOF'" or
// "gh pr create --body-file - <<'EOF'" — not under "bash <<'EOF'", "git run-script -F - <<'EOF'" (an alias or an
// extension may run its input; neither can take the name of a built-in command), "cat <<EOF" (the shell expands
// it), "cat <<'EOF' | sh" or "cat <<'EOF' > >(sh)"
const STORED_HEREDOC_TEXT =
  /((?:^|[\n;&|]|\s(?:-[a-z]*m|--message|--body|--title)[ =]"\$\()[ \t]*(?:cat\b|(?:git(?:\s+-[Cc]\s+[^\s;&|(]+)*\s+(?:commit|tag|notes|merge)|gh\s+(?:pr|issue|release|api))(?=\s)[^\n;&|(]*\s(?:-F|--file|--body-file|--notes-file|--input)[ =]-(?=[\s<]))[^\n;&|(]*<<-?[ \t]*(['"])(\w+)\2[^\n|(]*\n)[\s\S]*?\n[ \t]*\3[ \t]*(?=\n|$)/g;
// e.g. the quoted text in "git commit -m 'drop the /tmp log'" or "gh pr create --body \"plain words\"" — not
// "-m \"$(date)\"", which the shell runs, or "touch -m '/tmp/a'"
const QUOTED_MESSAGE_VALUE =
  /(?<=\b(?:git|gh)\b[^\n;&|]*\s(?:-[a-z]*m|--message|--body|--title)[ =])(?:'[^']*'|"[^"$`]*")/g;
// e.g. "ls -la /tmp", "rm -f /tmp/a.log", "find /tmp -name x" — reading or cleaning a scratch folder stays allowed
const READ_OR_CLEAN_COMMAND =
  /^\s*(?:ls|du|stat|file|readlink|realpath|cat|head|tail|wc|rg|grep|find|rm|rmdir)\b[^\n;&|]*\s*$/i;
// e.g. "Write", "Edit", "NotebookEdit", "write_file", "mcp__fs__create_directory" — not "Read" or "Grep"
const FILE_WRITE_TOOL =
  /(?:^|[._-])(?:write(?:_file)?|edit|multiedit|notebookedit|apply_?patch|create(?:_file|_directory)?|save|copy|move|rename|append|truncate|mkdir|touch)(?:$|[._-])/i;
// e.g. "Bash", "exec_command", "run_shell_command" — not "Edit"
const SHELL_TOOL = /(?:^|[._-])(?:bash|shell|exec|exec_command|execute|write_stdin)(?:$|[._-])/i;
// e.g. "tools.exec_command(" inside a Codex code-mode script
const CODEX_SHELL_CALL = /\btools\.(?:exec_command|apply_patch|write_stdin)\s*\(/;
// e.g. "file_path", "notebook_path", "target", "output_path", "directory" — not "content"
const PATH_FIELD_NAME =
  /(?:^|_)(?:file_?path|path|notebook_?path|target(?:_path)?|destination(?:_path)?|dest(?:_path)?|output(?:_path)?|save(?:_path)?|directory|dir)$/i;
// e.g. "*** Add File: /tmp/a.txt" in a Codex apply_patch body
const PATCH_TARGET_HEADER = /^\*{3}\s+(?:Add|Update|Move to) File:\s*(.+)$/gim;
// e.g. "cd ~ && git status", "cd /Users/me/app" — a command that starts by changing folder runs there
const LEADING_FOLDER_CHANGE = /^\s*cd\s+(['"]?)([^'"\s;&|]+)\1\s*(?:&&|;|$)/;
const COMMAND_FIELDS = ["command", "cmd", "script", "code", "input", "patch", "chars", "stdin"];
const BLOCK_REASON =
  "Writes to system temporary folders (/tmp, /private/tmp, /var/tmp, /dev/shm, $TMPDIR) are blocked. Write logs and scratch files to a gitignored folder inside the current repository (its AGENTS.md may name one) and delete them before handoff.";

export type ToolCall = {
  toolName: string;
  toolInput: unknown;
  workingDirectory: string | undefined;
};

type ScratchWriteRequest = ToolCall & { systemScratchFolder: string };

export type ScratchWriteDecision = { _tag: "allow" } | { _tag: "block"; reason: string };

type ScratchPathCheck = {
  candidate: string | undefined;
  workingDirectory: string | undefined;
  systemScratchFolder: string;
};

const isObject = (candidate: unknown): candidate is Record<string, unknown> =>
  typeof candidate === "object" && candidate !== null;

const isScratchPath = (check: ScratchPathCheck): boolean => {
  if (check.candidate === undefined || check.candidate.length === 0) {
    return false;
  }

  const insideSystemScratchFolder =
    check.candidate === check.systemScratchFolder || check.candidate.startsWith(`${check.systemScratchFolder}/`);
  if (SCRATCH_FOLDER_REFERENCE.test(check.candidate) || insideSystemScratchFolder) {
    return true;
  }

  return (
    !check.candidate.startsWith("/") &&
    check.workingDirectory !== undefined &&
    SCRATCH_FOLDER_REFERENCE.test(path.resolve(check.workingDirectory, check.candidate))
  );
};

// Tool inputs nest paths at any depth (MultiEdit edits, MCP arguments), so every path-named field counts.
const pathFields = (candidate: unknown): ReadonlyArray<string> => {
  if (!isObject(candidate)) {
    return [];
  }

  return Object.entries(candidate).flatMap(([key, field]) => {
    if (typeof field === "string") {
      return PATH_FIELD_NAME.test(key) ? [field] : [];
    }

    return pathFields(field);
  });
};

const commandTextOf = (toolInput: unknown): string => {
  if (typeof toolInput === "string") {
    return toolInput;
  }

  if (!isObject(toolInput)) {
    return "";
  }

  return COMMAND_FIELDS.map((field) => toolInput[field])
    .filter((field) => typeof field === "string")
    .join("\n");
};

// A shell left inside a scratch folder must still be able to leave it.
const commandFolderOf = (commandText: string, workingDirectory: string | undefined): string | undefined => {
  const folderChange = LEADING_FOLDER_CHANGE.exec(commandText);
  if (folderChange === null) {
    return workingDirectory;
  }

  const target = (folderChange[2] || "").replace(/^(?:~|\$\{?HOME\}?)(?=\/|$)/, os.homedir());
  return path.resolve(workingDirectory || os.homedir(), target);
};

const patchTargetsOf = (commandText: string): ReadonlyArray<string> =>
  [...commandText.matchAll(PATCH_TARGET_HEADER)].flatMap((header) =>
    header[1] === undefined ? [] : [header[1].trim()],
  );

// Text a command only stores or sends is not a command; the content of a Write call is not judged either.
const withoutMessageText = (commandText: string): string =>
  commandText.replace(STORED_HEREDOC_TEXT, "$1").replace(QUOTED_MESSAGE_VALUE, "");

const shellCommandWritesScratch = (request: ScratchWriteRequest & { commandText: string }): boolean => {
  const { commandText } = request;
  if (SCRATCH_FILE_FACTORY.test(commandText) || SCRATCH_VARIABLE_ASSIGNMENT.test(commandText)) {
    return true;
  }

  const runsInScratchFolder = isScratchPath({
    ...request,
    candidate: commandFolderOf(commandText, request.workingDirectory),
  });
  const mentionsScratchFolder = SCRATCH_FOLDER_REFERENCE.test(commandText) || RUNTIME_SCRATCH_LOOKUP.test(commandText);
  if (!mentionsScratchFolder && !runsInScratchFolder) {
    return false;
  }

  if (runsInScratchFolder && !READ_OR_CLEAN_COMMAND.test(commandText)) {
    return true;
  }

  return (
    REDIRECT_INTO_SCRATCH.test(commandText) ||
    COPY_INTO_SCRATCH.test(commandText) ||
    FILE_MUTATION_COMMAND.test(commandText) ||
    patchTargetsOf(commandText).some((candidate) => isScratchPath({ ...request, candidate }))
  );
};

const fileToolWritesScratch = (request: ScratchWriteRequest & { commandText: string }): boolean => {
  if (pathFields(request.toolInput).some((candidate) => isScratchPath({ ...request, candidate }))) {
    return true;
  }

  const patchTargets = patchTargetsOf(request.commandText);
  if (patchTargets.length > 0) {
    return patchTargets.some((candidate) => isScratchPath({ ...request, candidate }));
  }

  return SCRATCH_FOLDER_REFERENCE.test(request.commandText);
};

const writesScratch = (request: ScratchWriteRequest): boolean => {
  const commandText = commandTextOf(request.toolInput);
  if (SHELL_TOOL.test(request.toolName) || CODEX_SHELL_CALL.test(commandText)) {
    const judgedText = withoutMessageText(commandText);
    return shellCommandWritesScratch({ ...request, commandText: judgedText });
  }

  // MCP and namespaced tools ("mcp__fs__write_file", "functions.apply_patch") are judged by their last segment.
  const toolVerb = request.toolName.slice(request.toolName.lastIndexOf(".") + 1);
  return FILE_WRITE_TOOL.test(toolVerb) && fileToolWritesScratch({ ...request, commandText });
};

export const decideScratchWrite = (request: ScratchWriteRequest): ScratchWriteDecision =>
  writesScratch(request) ? { _tag: "block", reason: BLOCK_REASON } : { _tag: "allow" };
