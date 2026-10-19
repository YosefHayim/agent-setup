import { afterEach } from "vitest";

const nextCheckPhase = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

// Tests that spawn git and the CLI synchronously can hold a worker's event loop for over a minute, and vitest then
// fails the run with 'Timeout calling "onTaskUpdate"' although the main process answered in time. The second check
// phase comes after a poll phase, which reads those answers.
afterEach(async () => {
  await nextCheckPhase();
  await nextCheckPhase();
});
