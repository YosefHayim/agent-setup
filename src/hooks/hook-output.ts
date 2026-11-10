import { writeSync } from "node:fs";

// Exit 0 permits the tool call; it is also the fail-open path.
export const allowAndExit = (): never => process.exit(0);

// Written synchronously because a pipe drops buffered async writes when the process exits.
export const printDecisionAndExit = (transportMessage: unknown): never => {
  writeSync(1, JSON.stringify(transportMessage));
  process.exit(0);
};
