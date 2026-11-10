#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const STATUS_DONE = "done";

const STATUS_PENDING = "pending";

const SCENE_ORIGIN_AI = "ai";

const createEmptyManifest = (manifestFields = {}) => {
  const defaultTargetSeconds = 24;

  const defaultVideoHeight = 1920;

  const defaultVideoWidth = 1080;

  const defaultFramesPerSecond = 30;

  return {
    version: 1,
    project: manifestFields.project || "",
    createdAt: manifestFields.createdAt || new Date().toISOString(),
    format: {
      aspect: "9:16",
      fps: defaultFramesPerSecond,
      width: defaultVideoWidth,
      height: defaultVideoHeight,
      targetSeconds: manifestFields.targetSeconds || defaultTargetSeconds,
    },
    creativeMode: manifestFields.creativeMode || "hybrid",
    conversation: null,
    style: { bibleImage: null, refs: [] },
    audio: { voPath: null, musicPath: null, voice: null, voProvider: null, musicProvider: null },
    scenes: [],
    variants: [],
  };
};

const createSceneTemplate = (order) => {
  const defaultSceneSeconds = 3;

  const sceneNumberDigits = 2;

  return {
    id: `s${String(order).padStart(sceneNumberDigits, "0")}`,
    order,
    beat: "",
    durationSec: defaultSceneSeconds,
    shot: "",
    voLine: "",
    caption: "",
    musicCue: "",
    source: SCENE_ORIGIN_AI,
    screenshot: null,
    motion: "kenburns",
    motionEngine: null,
    stillPath: null,
    stillStatus: STATUS_PENDING,
    clipPath: null,
    clipJobId: null,
    clipStatus: STATUS_PENDING,
  };
};

const listPendingStills = (manifest) => {
  return manifest.scenes.filter((scene) => scene.source === SCENE_ORIGIN_AI && scene.stillStatus !== STATUS_DONE);
};

const listPendingClips = (manifest) => {
  return manifest.scenes.filter((scene) => scene.motion === "clip" && scene.clipStatus !== STATUS_DONE);
};

const applyScenePatch = (manifest, sceneId, scenePatch) => {
  const scenes = manifest.scenes.map((scene) => {
    const isPatchedScene = scene.id === sceneId;
    return isPatchedScene ? { ...scene, ...scenePatch } : scene;
  });
  return { ...manifest, scenes };
};

const addScene = (manifest, sceneFields = {}) => {
  const nextOrder = manifest.scenes.length + 1;
  const scene = { ...createSceneTemplate(nextOrder), ...sceneFields };
  return { ...manifest, scenes: [...manifest.scenes, scene] };
};

const createManifestFilePath = (directory) => join(directory, "manifest.json");

const loadManifest = (directory) => {
  const manifestFilePath = createManifestFilePath(directory);
  const isManifestMissing = !existsSync(manifestFilePath);
  if (isManifestMissing) throw new Error(`No manifest at ${manifestFilePath} — run 'init' first.`);

  return JSON.parse(readFileSync(manifestFilePath, "utf8"));
};

const saveManifest = (directory, manifest) => {
  mkdirSync(directory, { recursive: true });
  mkdirSync(join(directory, "build"), { recursive: true });
  const indentSpaceCount = 2;

  writeFileSync(createManifestFilePath(directory), `${JSON.stringify(manifest, null, indentSpaceCount)}\n`);
};

const readFlags = (argumentList) => {
  const flagPairs = [];
  const argumentPairStride = 2;

  for (let index = 0; index < argumentList.length; index += argumentPairStride) {
    const flagName = argumentList[index].replace(/^--/, "");
    flagPairs.push([flagName, argumentList[index + 1]]);
  }
  return Object.fromEntries(flagPairs);
};

const readFlag = (flagString) => {
  const isTrueFlag = flagString === "true";
  if (isTrueFlag) return true;

  const isFalseFlag = flagString === "false";
  if (isFalseFlag) return false;

  const isNumberFlag = flagString !== "" && !Number.isNaN(Number(flagString));
  if (isNumberFlag) return Number(flagString);

  return flagString;
};

const writeSceneIds = (scenes) => {
  process.stdout.write(`${scenes.map((scene) => scene.id).join(" ")}\n`);
};

const initManifest = (directory, flags) => {
  const manifest = createEmptyManifest({
    project: flags.project,
    targetSeconds: readFlag(flags.seconds),
    creativeMode: flags.mode,
  });
  saveManifest(directory, manifest);
  process.stdout.write(`Initialized ${createManifestFilePath(directory)}\n`);
};

const setSceneField = (directory, manifest, flags) => {
  const isSetArgumentMissing = !flags.id || !flags.key;
  if (isSetArgumentMissing) throw new Error("set needs --id and --key (and --value)");

  const newField = readFlag(flags.value || "");
  saveManifest(directory, applyScenePatch(manifest, flags.id, { [flags.key]: newField }));
  process.stdout.write(`Set ${flags.id}.${flags.key} = ${flags.value}\n`);
};

const runManifestCommand = (command, directory, flags) => {
  const manifest = loadManifest(directory);
  switch (command) {
    case "show": {
      const stdoutIndentSpaceCount = 2;

      process.stdout.write(`${JSON.stringify(manifest, null, stdoutIndentSpaceCount)}\n`);
      return;
    }
    case "pending-stills":
      writeSceneIds(listPendingStills(manifest));
      return;
    case "pending-clips":
      writeSceneIds(listPendingClips(manifest));
      return;
    case "add-scene":
      saveManifest(directory, addScene(manifest, JSON.parse(flags.json || "{}")));
      return;
    case "set":
      setSceneField(directory, manifest, flags);
      return;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
};

const runManifestCli = () => {
  const firstArgumentIndex = 2;

  const [command, ...commandArguments] = process.argv.slice(firstArgumentIndex);
  const flags = readFlags(commandArguments);
  const directory = flags.dir;
  const isUsageMissing = !command || !directory;
  if (isUsageMissing) throw new Error("Usage: manifest.mjs <cmd> --dir <dir> [...]");

  const isInitCommand = command === "init";
  if (isInitCommand) {
    initManifest(directory, flags);
    return;
  }

  runManifestCommand(command, directory, flags);
};

const isRunAsScript = import.meta.url === `file://${process.argv[1]}`;
if (isRunAsScript) {
  try {
    runManifestCli();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}
