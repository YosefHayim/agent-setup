import { setTimeout as sleep } from "node:timers/promises";

import { isProcessAlive } from "../process-alive.js";

const GRACE_MILLISECONDS = 1_500;
const GRACE_POLL_MILLISECONDS = 100;

// A process can end between the table read and the signal; that is the goal, not a failure.
const sendSignal = (processId: number, signal: "SIGTERM" | "SIGKILL"): void => {
  try {
    process.kill(processId, signal);
  } catch (failure) {
    const isAlreadyGone = failure instanceof Error && "code" in failure && failure.code === "ESRCH";
    if (!isAlreadyGone) {
      throw failure;
    }
  }
};

const waitUntilGoneOrGraceEnds = async (processIds: ReadonlyArray<number>, pollsLeft: number): Promise<void> => {
  const isAnyStillUp = processIds.some(isProcessAlive);
  const isGraceOver = pollsLeft === 0;
  if (!isAnyStillUp || isGraceOver) {
    return;
  }

  await sleep(GRACE_POLL_MILLISECONDS);
  await waitUntilGoneOrGraceEnds(processIds, pollsLeft - 1);
};

export const stopProcesses = async (processIds: ReadonlyArray<number>): Promise<void> => {
  for (const processId of processIds) {
    sendSignal(processId, "SIGTERM");
  }
  await waitUntilGoneOrGraceEnds(processIds, GRACE_MILLISECONDS / GRACE_POLL_MILLISECONDS);
  for (const processId of processIds.filter(isProcessAlive)) {
    sendSignal(processId, "SIGKILL");
  }
};
