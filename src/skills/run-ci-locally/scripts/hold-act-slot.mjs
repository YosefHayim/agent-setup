#!/usr/bin/env node
import { spawn } from "node:child_process";
import net from "node:net";
import os from "node:os";

const ERROR_EVENT_NAME = "error";

const DEFAULT_SLOTS = 6;
const FIRST_SLOT_PORT = 28731;
const POLL_MS = 5000;
const MINUTES_PER_HOUR = 60;
const SECONDS_PER_MINUTE = 60;
const MILLISECONDS_PER_SECOND = 1000;
const GIVE_UP_HOURS = 2;
const GIVE_UP_MS = GIVE_UP_HOURS * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MILLISECONDS_PER_SECOND;
const USAGE = "usage: hold-act-slot.mjs [--slots <n>] -- <command> [args...]";

const fail = (message, exitCode) => {
  process.stderr.write(`holdActSlot: ${message}\n`);
  process.exit(exitCode);
};

const parseArguments = (argv) => {
  const separatorIndex = argv.indexOf("--");

  const hasNoCommand = separatorIndex === -1 || separatorIndex >= argv.length - 1;
  const missingCommandExitCode = 2;

  if (hasNoCommand) fail(USAGE, missingCommandExitCode);

  const flags = argv.slice(0, separatorIndex);
  const command = argv.slice(separatorIndex + 1);

  const hasNoFlags = flags.length === 0;
  if (hasNoFlags) return { slots: DEFAULT_SLOTS, command };

  const slotsFlagArgumentCount = 2;

  const isNotSlotsFlagOnly = flags.length !== slotsFlagArgumentCount || flags[0] !== "--slots";
  const wrongSlotsFlagExitCode = 2;

  if (isNotSlotsFlagOnly) fail(USAGE, wrongSlotsFlagExitCode);

  const slots = Number(flags[1]);

  const isNotSlotsValid = !Number.isInteger(slots) || slots <= 0;
  const invalidSlotsExitCode = 2;

  if (isNotSlotsValid) fail(USAGE, invalidSlotsExitCode);

  return { slots, command };
};

const sleep = (milliseconds) => new Promise((fulfill) => setTimeout(fulfill, milliseconds));

const reserveSlotPort = (port) =>
  new Promise((fulfill, reject) => {
    const server = net.createServer();
    server.once(ERROR_EVENT_NAME, (error) => {
      const isSlotTaken = error.code === "EADDRINUSE";
      if (isSlotTaken) {
        fulfill(false);
        return;
      }

      reject(error);
    });
    server.listen({ port, host: "127.0.0.1" }, () => fulfill(true));
  });

const takeFreeSlot = async (slotPorts) => {
  for (const port of slotPorts) {
    const isHeld = await reserveSlotPort(port);
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
  new Promise((fulfill) => {
    const [program, ...programArguments] = command;
    const child = spawn(program, programArguments, { stdio: "inherit" });
    for (const signalName of ["SIGINT", "SIGTERM"]) process.on(signalName, () => child.kill(signalName));
    child.on(ERROR_EVENT_NAME, (error) => {
      process.stderr.write(`holdActSlot: cannot start ${program}: ${error.message}\n`);
      const commandNotFoundExitCode = 127;

      fulfill(commandNotFoundExitCode);
    });
    child.on("close", (exitCode, signalName) => {
      const isKilledBySignal = signalName !== null;
      if (isKilledBySignal) {
        const signalExitCodeBase = 128;

        fulfill(signalExitCodeBase + os.constants.signals[signalName]);
        return;
      }

      fulfill(exitCode);
    });
  });

const runHoldActSlotCommand = async () => {
  const firstArgumentIndex = 2;

  const commandLine = process.argv.slice(firstArgumentIndex);
  const { slots, command } = parseArguments(commandLine);
  const slotOffsets = Array.from({ length: slots }, (_, offset) => offset);
  const slotPorts = slotOffsets.map((offset) => FIRST_SLOT_PORT + offset);
  await waitForSlot(slotPorts);
  const exitCode = await runCommand(command);
  process.exit(exitCode);
};

await runHoldActSlotCommand();
