export const isProcessAlive = (pid: number): boolean => {
  const isInvalidPid = !Number.isInteger(pid) || pid <= 0;
  if (isInvalidPid) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (failure) {
    return failure instanceof Error && "code" in failure && failure.code === "EPERM";
  }
};
