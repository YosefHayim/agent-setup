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

const homeFolder = os.homedir();
const slotsFolder = path.join(homeFolder, ".cache", "act-slots");

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
  const hasNoFlags = flags.length === 0;
  if (hasNoFlags) return { slots: DEFAULT_SLOTS, command };
  const isSlotsFlagOnly = flags.length === 2 && flags[0] === "--slots";
  if (!isSlotsFlagOnly) fail(USAGE, 2);
  const slots = Number(flags[1]);
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
    const slotText = readFileSync(slotPath, "utf8");
    const owner = JSON.parse(slotText);
    if (Number.isInteger(owner.pid)) return owner.pid;
    return null;
  } catch {
    return null;
  }
};

const readSlotAgeMs = (slotPath) => {
  try {
    const slotStats = statSync(slotPath);
    return Date.now() - slotStats.mtimeMs;
  } catch {
    return null;
  }
};

const isSlotStale = (slotPath) => {
  const ageMs = readSlotAgeMs(slotPath);
  const hasVanished = ageMs === null;
  if (hasVanished) return true;
  const ownerPid = readSlotOwnerPid(slotPath);
  const hasOwner = ownerPid !== null;
  if (!hasOwner) return ageMs > WRITING_MS;
  return ageMs > STALE_MS || !isPidAlive(ownerPid);
};

const removeSlot = (slotPath) => {
  try {
    unlinkSync(slotPath);
  } catch {}
};

const createSlotFile = (slotPath) => {
  try {
    return openSync(slotPath, "wx");
  } catch (error) {
    if (error.code === "EEXIST") return null;
    throw error;
  }
};

const tryTakeSlot = (slotPath, command) => {
  const descriptor = createSlotFile(slotPath);
  if (descriptor === null) return false;
  const commandText = command.join(" ").slice(0, COMMAND_LENGTH);
  const owner = { pid: process.pid, startedAt: new Date().toISOString(), command: commandText };
  const ownerText = JSON.stringify(owner);
  writeSync(descriptor, ownerText);
  closeSync(descriptor);
  return true;
};

const takeFreeSlot = (slotPaths, command) => {
  for (const slotPath of slotPaths) {
    if (tryTakeSlot(slotPath, command)) return slotPath;
    const isStale = isSlotStale(slotPath);
    if (!isStale) continue;
    removeSlot(slotPath);
    if (tryTakeSlot(slotPath, command)) return slotPath;
  }
  return null;
};

const waitForSlot = async (slotPaths, command) => {
  const firstSlotPath = takeFreeSlot(slotPaths, command);
  if (firstSlotPath !== null) return firstSlotPath;
  process.stderr.write(`waiting for a free act slot: all ${slotPaths.length} in use\n`);
  const giveUpAt = Date.now() + GIVE_UP_MS;
  for (;;) {
    await sleep(POLL_MS);
    const slotPath = takeFreeSlot(slotPaths, command);
    if (slotPath !== null) return slotPath;
    const hasWaitedTooLong = Date.now() > giveUpAt;
    if (hasWaitedTooLong) fail("gave up after 2 hours without a free act slot", 1);
  }
};

const runCommand = (command) =>
  new Promise((resolve) => {
    const [program, ...programArguments] = command;
    const child = spawn(program, programArguments, { stdio: "inherit" });
    for (const signalName of ["SIGINT", "SIGTERM"]) process.on(signalName, () => child.kill(signalName));
    child.on("error", (error) => {
      process.stderr.write(`holdActSlot: cannot start ${program}: ${error.message}\n`);
      resolve(127);
    });
    child.on("close", (exitCode, signalName) => {
      const diedFromSignal = signalName !== null;
      if (diedFromSignal) {
        resolve(128 + os.constants.signals[signalName]);
        return;
      }
      resolve(exitCode);
    });
  });

const main = async () => {
  const commandLine = process.argv.slice(2);
  const { slots, command } = parseArguments(commandLine);
  mkdirSync(slotsFolder, { recursive: true });
  const slotNumbers = Array.from({ length: slots }, (_, index) => index + 1);
  const slotPaths = slotNumbers.map((slotNumber) => path.join(slotsFolder, `slot-${slotNumber}`));
  const slotPath = await waitForSlot(slotPaths, command);
  process.on("exit", () => removeSlot(slotPath));
  const exitCode = await runCommand(command);
  process.exit(exitCode);
};

await main();
