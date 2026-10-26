#!/usr/bin/env node
import { spawn } from "node:child_process";
import net from "node:net";
import os from "node:os";

const DEFAULT_SLOTS = 6;
const FIRST_SLOT_PORT = 28731;
const POLL_MS = 5000;
const GIVE_UP_MS = 2 * 60 * 60 * 1000;
const USAGE = "usage: holdActSlot.mjs [--slots <n>] -- <command> [args...]";

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

const holdSlotPort = (port) =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", (error) => {
      const isSlotTaken = error.code === "EADDRINUSE";
      if (isSlotTaken) {
        resolve(false);
        return;
      }
      reject(error);
    });
    server.listen({ port, host: "127.0.0.1" }, () => resolve(true));
  });

const takeFreeSlot = async (slotPorts) => {
  for (const port of slotPorts) {
    const isHeld = await holdSlotPort(port);
    if (isHeld) return true;
  }
  return false;
};

const waitForSlot = async (slotPorts) => {
  const isHeldAtOnce = await takeFreeSlot(slotPorts);
  if (isHeldAtOnce) return;
  process.stderr.write(`waiting for a free act slot: all ${slotPorts.length} in use\n`);
  const giveUpAt = Date.now() + GIVE_UP_MS;
  for (;;) {
    await sleep(POLL_MS);
    const isHeld = await takeFreeSlot(slotPorts);
    if (isHeld) return;
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
  const slotOffsets = Array.from({ length: slots }, (_, offset) => offset);
  const slotPorts = slotOffsets.map((offset) => FIRST_SLOT_PORT + offset);
  await waitForSlot(slotPorts);
  const exitCode = await runCommand(command);
  process.exit(exitCode);
};

await main();
