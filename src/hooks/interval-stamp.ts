import { closeSync, existsSync, mkdirSync, openSync, statSync, utimesSync } from "node:fs";
import path from "node:path";

type IntervalSlot = { readonly stampFile: string; readonly minimumSeconds: number };

// The stamp's modified time is when the slow pass last ran.
const ranWithinInterval = (slot: IntervalSlot): boolean => {
  if (!existsSync(slot.stampFile)) {
    return false;
  }

  const stampAgeMilliseconds = Date.now() - statSync(slot.stampFile).mtimeMs;
  return stampAgeMilliseconds < slot.minimumSeconds * 1_000;
};

export const claimIntervalSlot = (slot: IntervalSlot): boolean => {
  if (ranWithinInterval(slot)) {
    return false;
  }

  mkdirSync(path.dirname(slot.stampFile), { recursive: true });
  closeSync(openSync(slot.stampFile, "a"));
  const now = new Date();
  utimesSync(slot.stampFile, now, now);
  return true;
};
