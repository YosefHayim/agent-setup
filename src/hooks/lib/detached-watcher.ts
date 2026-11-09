import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Both agents give SessionEnd hooks only a second or two, so the work moves to a watcher that outlives the hook.
// The watcher has the hook's extension: .js when installed, .ts under tsx in tests, where execArgv carries the tsx
// loader.
export const startDetachedWatcher = (request: {
  readonly hookUrl: string;
  readonly watcherName: string;
  readonly watcherArguments: ReadonlyArray<string>;
}): void => {
  const hookFile = fileURLToPath(request.hookUrl);
  const hookFolder = path.dirname(hookFile);
  const watcherFile = path.join(hookFolder, "..", "watchers", `${request.watcherName}${path.extname(hookFile)}`);
  const watcher = spawn(process.execPath, [...process.execArgv, watcherFile, ...request.watcherArguments], {
    detached: true,
    stdio: "ignore",
  });
  watcher.unref();
};
