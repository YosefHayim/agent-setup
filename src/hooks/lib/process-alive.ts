// Signal 0 probes a pid without touching it; kill(0, 0) would probe our own process group, so only real pids count.
// EPERM means the process is there and another user owns it.
export const isProcessAlive = (pid: number): boolean => {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (failure) {
    return failure instanceof Error && "code" in failure && failure.code === "EPERM";
  }
};
