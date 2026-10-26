#!/usr/bin/env node
import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync, writeSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_SLOTS = 6;
const POLL_MS = 5000;
const GIVE_UP_MS = 2 * 60 * 60 * 1000;
const STALE_MS = 3 * 60 * 60 * 1000;
const WRITING_MS = 10 * 1000;
const COMMAND_LENGTH = 200;
const USAGE = "usage: holdActSlot.mjs [--slots <n>] -- <command> [args...]";

const slotsFolder = path.join(os.homedir(), ".cache", "act-slots");

const fail = (message, exitCode) => {
  process.stderr.write(`holdActSlot: ${message}\n`);
  process.exit(exitCode);
};

const parseArguments = (argv) => {
  const separatorIndex = argv.indexOf("--");
  const hasCommand = separatorIndex !== -1 && separatorIndex < argv.length - 1;
  if (!hasCommand) fail(USAGE, 2);
  const flags = argv.slice(0, separatorIndex);
  const command = argv.slice(separatorIndex + 1);
  const slotsFlagIndex = flags.indexOf("--slots");
  const hasSlotsFlag = slotsFlagIndex !== -1;
  const expectedFlagCount = hasSlotsFlag ? 2 : 0;
  if (flags.length !== expectedFlagCount) fail(USAGE, 2);
  if (!hasSlotsFlag) return { slots: DEFAULT_SLOTS, command };
  const slots = Number(flags[slotsFlagIndex + 1]);
  const isSlotsValid = Number.isInteger(slots) && slots > 0;
  if (!isSlotsValid) fail(USAGE, 2);
  return { slots, command };
};

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const isPidAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== "ESRCH";
  }
};

const readSlotOwnerPid = (slotPath) => {
  try {
    const owner = JSON.parse(readFileSync(slotPath, "utf8"));
    return Number.isInteger(owner.pid) ? owner.pid : null;
  } catch {
    return null;
  }
};

const isSlotStale = (slotPath) => {
  const ageMs = Date.now() - statSync(slotPath).mtimeMs;
  const ownerPid = readSlotOwnerPid(slotPath);
  const hasOwner = ownerPid !== null;
  if (!hasOwner) return ageMs > WRITING_MS;
  return ageMs > STALE_MS || !isPidAlive(ownerPid);
};

const isSlotGone = (slotPath) => {
  try {
    return isSlotStale(slotPath);
  } catch {
    return true;
  }
};

const removeSlot = (slotPath) => {
  try {
    unlinkSync(slotPath);
  } catch {}
};

const tryTakeSlot = (slotPath, command) => {
  let descriptor;
  try {
    descriptor = openSync(slotPath, "wx");
  } catch (error) {
    if (error.code === "EEXIST") return false;
    throw error;
  }
  const commandText = command.join(" ").slice(0, COMMAND_LENGTH);
  const owner = { pid: process.pid, startedAt: new Date().toISOString(), command: commandText };
  writeSync(descriptor, JSON.stringify(owner));
  closeSync(descriptor);
  return true;
};

const takeFreeSlot = (slots, command) => {
  let slotsInUse = 0;
  for (let index = 1; index <= slots; index += 1) {
    const slotPath = path.join(slotsFolder, `slot-${index}`);
    if (tryTakeSlot(slotPath, command)) return { slotPath, slotsInUse };
    const isStale = isSlotGone(slotPath);
    if (isStale) removeSlot(slotPath);
    if (isStale && tryTakeSlot(slotPath, command)) return { slotPath, slotsInUse };
    slotsInUse += 1;
  }
  return { slotPath: null, slotsInUse };
};

const waitForSlot = async (slots, command) => {
  const startedWaitingAt = Date.now();
  let hasAnnounced = false;
  for (;;) {
    const { slotPath, slotsInUse } = takeFreeSlot(slots, command);
    if (slotPath !== null) return slotPath;
    if (!hasAnnounced) process.stderr.write(`waiting for a free act slot: ${slotsInUse} of ${slots} in use\n`);
    hasAnnounced = true;
    const hasWaitedTooLong = Date.now() - startedWaitingAt > GIVE_UP_MS;
    if (hasWaitedTooLong) fail("gave up after 2 hours without a free act slot", 1);
    await sleep(POLL_MS);
  }
};

const runCommand = (command) =>
  new Promise((resolve) => {
    const child = spawn(command[0], command.slice(1), { stdio: "inherit" });
    for (const signalName of ["SIGINT", "SIGTERM"]) process.on(signalName, () => child.kill(signalName));
    child.on("error", (error) => {
      process.stderr.write(`holdActSlot: cannot start ${command[0]}: ${error.message}\n`);
      resolve(127);
    });
    child.on("close", (exitCode, signalName) => {
      const diedFromSignal = signalName !== null;
      if (diedFromSignal) resolve(128 + os.constants.signals[signalName]);
      if (!diedFromSignal) resolve(exitCode);
    });
  });

const main = async () => {
  const { slots, command } = parseArguments(process.argv.slice(2));
  mkdirSync(slotsFolder, { recursive: true });
  let heldSlotPath = null;
  process.on("exit", () => {
    if (heldSlotPath !== null) removeSlot(heldSlotPath);
  });
  for (const signalName of ["SIGINT", "SIGTERM"]) {
    process.on(signalName, () => {
      const isStillWaiting = heldSlotPath === null;
      if (isStillWaiting) process.exit(128 + os.constants.signals[signalName]);
    });
  }
  heldSlotPath = await waitForSlot(slots, command);
  const exitCode = await runCommand(command);
  process.exit(exitCode);
};

await main();
