#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

const NONE_CSS_KEYWORD = "none";

const HEADING_ONE_TAG = "h1";

const LIST_SEPARATOR = ",";

const ZERO_PIXEL_LENGTH = "0px";

const TRANSPARENT_COLOR = "rgba(0, 0, 0, 0)";

const EVERY_PAGE_ELEMENT_SELECTOR = "body *";

const STRING_TYPE_NAME = "string";

const lastMotionFrameDelay = 1200;

const thirdMotionFrameDelay = 700;

const secondMotionFrameDelay = 500;

const firstMotionFrameDelay = 350;

const motionFrameDelays = [firstMotionFrameDelay, secondMotionFrameDelay, thirdMotionFrameDelay, lastMotionFrameDelay];

const { values: flags } = parseArgs({
  options: {
    url: { type: STRING_TYPE_NAME },
    "out-folder": { type: STRING_TYPE_NAME },
    width: { type: STRING_TYPE_NAME, default: "1440" },
    height: { type: STRING_TYPE_NAME, default: "900" },
    "chrome-path": {
      type: STRING_TYPE_NAME,
      default: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    },
  },
});

const isMissingFlag = !flags.url || !flags["out-folder"];
if (isMissingFlag) {
  console.error(
    "Usage: node capture-template.mjs --url <preview url> --out-folder <folder> [--width 1440] [--height 900] [--chrome-path <path>]",
  );
  const usageExitCode = 2;

  process.exit(usageExitCode);
}

const width = Number(flags.width);
const height = Number(flags.height);
const outFolder = path.resolve(flags["out-folder"]);
const profileFolder = path.join(outFolder, "chrome-profile");

const sleep = (milliseconds) => new Promise((fulfill) => setTimeout(fulfill, milliseconds));

const readPortLine = (portFile) => {
  const isPortFileMissing = !existsSync(portFile);
  if (isPortFileMissing) return "";

  const portFileLines = readFileSync(portFile, "utf8");
  return portFileLines.split("\n")[0];
};

const waitForDebugPort = async () => {
  const portFile = path.join(profileFolder, "DevToolsActivePort");
  const maximumWaitAttempts = 100;

  for (let attempt = 0; attempt < maximumWaitAttempts; attempt += 1) {
    const portLine = readPortLine(portFile);
    const isPortLineReady = portLine !== "";
    if (isPortLineReady) return portLine;

    const waitBetweenAttemptsMilliseconds = 100;

    await sleep(waitBetweenAttemptsMilliseconds);
  }
  throw new Error("Chrome did not open a debug port");
};

const findPageSocketUrl = async (port) => {
  const targetListReply = await fetch(`http://127.0.0.1:${port}/json/list`);
  const targets = await targetListReply.json();
  const page = targets.find((target) => target.type === "page");
  return page.webSocketDebuggerUrl;
};

const connectDevtools = async (socketUrl) => {
  const socket = new WebSocket(socketUrl);
  await new Promise((fulfill) => socket.addEventListener("open", fulfill));
  const waiting = new Map();
  let lastMessageId = 0;
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);

    const pendingCall = waiting.get(message.id);
    const isUnknownReply = pendingCall == null;
    if (isUnknownReply) return;

    waiting.delete(message.id);

    const isErrorReply = Boolean(message.error);
    if (isErrorReply) {
      pendingCall.reject(new Error(message.error.message));
      return;
    }

    pendingCall.fulfill(message.result);
  });
  const send = (method, parameters = {}) =>
    new Promise((fulfill, reject) => {
      lastMessageId += 1;
      waiting.set(lastMessageId, { fulfill, reject });
      socket.send(JSON.stringify({ id: lastMessageId, method, params: parameters }));
    });
  return { send, close: () => socket.close() };
};

const evaluate = async (devtools, expression) => {
  const evaluation = await devtools.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  return evaluation.result.value;
};

const saveScreenshot = async (devtools, fileName) => {
  const screenshotJpegQuality = 75;

  const screenshot = await devtools.send("Page.captureScreenshot", { format: "jpeg", quality: screenshotJpegQuality });
  const imageBytes = Buffer.from(screenshot.data, "base64");
  const filePath = path.join(outFolder, fileName);
  writeFileSync(filePath, imageBytes);
};

// Runs inside the browser through evaluate, so it must not use anything from this file.
const readPageStudy = () => {
  const countMostCommon = (styleSamples) => {
    const counts = new Map();
    for (const styleSample of styleSamples) counts.set(styleSample, (counts.get(styleSample) || 0) + 1);
    const sorted = [...counts.entries()].sort((first, second) => second[1] - first[1]);
    const mostCommonCount = 12;

    return sorted.slice(0, mostCommonCount);
  };
  const hasOwnString = (element) =>
    [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
  const stringElements = [...document.querySelectorAll(EVERY_PAGE_ELEMENT_SELECTOR)].filter(hasOwnString);
  const stringStyles = stringElements.map((element) => getComputedStyle(element));
  const allStyles = [...document.querySelectorAll(EVERY_PAGE_ELEMENT_SELECTOR)].map((element) =>
    getComputedStyle(element),
  );
  const isShown = (element) => {
    const box = element.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
  };
  const describeType = (selector) => {
    const element = document.querySelector(selector);
    const isElementMissing = element == null;
    if (isElementMissing) return null;

    const style = getComputedStyle(element);
    const maximumSampleCharacterCount = 80;

    const sample = element.textContent.trim().slice(0, maximumSampleCharacterCount);
    return {
      sample,
      family: style.fontFamily,
      size: style.fontSize,
      weight: style.fontWeight,
      lineHeight: style.lineHeight,
      letterSpacing: style.letterSpacing,
    };
  };
  const pieceTags = ["a", "button", "img", "svg", "input"];
  const isPiece = (element) => {
    const style = getComputedStyle(element);
    const isFilled = style.backgroundColor !== TRANSPARENT_COLOR || style.borderRadius !== ZERO_PIXEL_LENGTH;
    const tag = element.tagName.toLowerCase();
    return hasOwnString(element) || pieceTags.includes(tag) || isFilled;
  };
  const describePiece = (element, sectionBox) => {
    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    const family = style.fontFamily.split(LIST_SEPARATOR)[0];
    const hasOwnLabel = hasOwnString(element);
    const maximumOwnLabelLength = 40;

    const ownLabel = hasOwnLabel ? element.textContent.trim().slice(0, maximumOwnLabelLength) : "";
    return {
      tag: element.tagName.toLowerCase(),
      text: ownLabel,
      box: [
        Math.round(box.left - sectionBox.left),
        Math.round(box.top - sectionBox.top),
        Math.round(box.width),
        Math.round(box.height),
      ],
      font: `${style.fontSize}/${style.lineHeight} ${style.fontWeight} ${style.letterSpacing} ${family}`,
      color: style.color,
      fill: style.backgroundColor,
      radius: style.borderRadius,
      padding: style.padding,
    };
  };
  const describeSection = (element) => {
    const heading = element.querySelector("h1, h2, h3");
    const hasHeading = heading != null;
    const maximumHeadingLabelLength = 90;

    const headingLabel = hasHeading ? heading.textContent.trim().slice(0, maximumHeadingLabelLength) : "";
    const box = element.getBoundingClientRect();
    const shownPieces = [...element.querySelectorAll("*")].filter(isShown).filter(isPiece);
    const maximumDescribedPieces = 80;

    return {
      name: element.dataset.framerName || element.id || element.tagName.toLowerCase(),
      heading: headingLabel,
      top: Math.round(box.top + window.scrollY),
      height: Math.round(box.height),
      pieces: shownPieces.slice(0, maximumDescribedPieces).map((piece) => describePiece(piece, box)),
    };
  };
  const sections = [...document.querySelectorAll("section, footer")].filter(isShown).map(describeSection);
  const describeVariant = (appearVariant) => {
    const initial = appearVariant.initial || {};
    const transition = appearVariant.animate?.transition || {};
    return JSON.stringify({
      from: { opacity: initial.opacity, x: initial.x, y: initial.y, scale: initial.scale, filter: initial.filter },
      type: transition.type,
      delay: transition.delay,
      duration: transition.duration,
      stiffness: transition.stiffness,
      damping: transition.damping,
    });
  };
  const appearScript = document.getElementById("__framer__appearAnimationsContent");
  const hasAppearScript = appearScript != null;
  const appearModules = hasAppearScript ? Object.values(JSON.parse(appearScript.textContent)) : [];
  const appearVariants = appearModules.map((appearModule) => appearModule?.default).filter(Boolean);
  const headline = document.querySelector(HEADING_ONE_TAG);
  const hasHeadline = headline != null;
  const headlineParts = hasHeadline ? headline.querySelectorAll("span[style*='inline-block']").length : 0;
  return {
    title: document.title,
    pageHeight: document.documentElement.scrollHeight,
    type: {
      h1: describeType(HEADING_ONE_TAG),
      h2: describeType("h2"),
      h3: describeType("h3"),
      body: describeType("p"),
    },
    fonts: countMostCommon(stringStyles.map((style) => style.fontFamily.split(LIST_SEPARATOR)[0])),
    textColors: countMostCommon(stringStyles.map((style) => style.color)),
    backgrounds: countMostCommon(
      allStyles.map((style) => style.backgroundColor).filter((color) => color !== TRANSPARENT_COLOR),
    ),
    radii: countMostCommon(
      allStyles.map((style) => style.borderRadius).filter((radius) => radius !== ZERO_PIXEL_LENGTH),
    ),
    shadows: countMostCommon(allStyles.map((style) => style.boxShadow).filter((shadow) => shadow !== NONE_CSS_KEYWORD)),
    sections,
    motion: {
      loadAnimations: countMostCommon(appearVariants.map(describeVariant)),
      headlineSplitParts: headlineParts,
      cssAnimations: countMostCommon(
        allStyles.map((style) => style.animationName).filter((name) => name !== NONE_CSS_KEYWORD),
      ),
      backdropBlurs: countMostCommon(
        allStyles.map((style) => style.backdropFilter).filter((filter) => filter !== NONE_CSS_KEYWORD),
      ),
    },
  };
};

const capture = async () => {
  const settleDelayMilliseconds = 5000;
  const scrollSettleDelayMilliseconds = 1800;
  const port = await waitForDebugPort();
  const socketUrl = await findPageSocketUrl(port);
  const devtools = await connectDevtools(socketUrl);
  await devtools.send("Page.enable");
  const mobileBreakpointWidth = 600;

  await devtools.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width < mobileBreakpointWidth,
  });
  await devtools.send("Page.navigate", { url: flags.url });
  for (const [index, delay] of motionFrameDelays.entries()) {
    await sleep(delay);
    await saveScreenshot(devtools, `motion-${index}.jpg`);
  }
  await sleep(settleDelayMilliseconds);
  const pageHeight = await evaluate(devtools, "document.documentElement.scrollHeight");
  const screenCount = Math.ceil(pageHeight / height);
  const screenTops = Array.from({ length: screenCount }, (_, index) => index * height);
  for (const [index, screenTop] of screenTops.entries()) {
    await evaluate(devtools, `window.scrollTo(0, ${screenTop})`);
    await sleep(scrollSettleDelayMilliseconds);
    const screenNumberDigits = 2;

    const screenNumber = String(index).padStart(screenNumberDigits, "0");
    await saveScreenshot(devtools, `screen-${screenNumber}.jpg`);
  }
  const pageStudy = await evaluate(devtools, `(${readPageStudy})()`);
  const studyPath = path.join(outFolder, "study.json");
  const indentSpaceCount = 2;

  const studyDocument = JSON.stringify(pageStudy, null, indentSpaceCount);
  writeFileSync(studyPath, studyDocument);
  devtools.close();
  return screenCount;
};

mkdirSync(profileFolder, { recursive: true });
const chrome = spawn(
  flags["chrome-path"],
  [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--remote-debugging-port=0",
    `--user-data-dir=${profileFolder}`,
    `--window-size=${width},${height}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);
const chromeExit = new Promise((fulfill) => chrome.once("exit", fulfill));

try {
  const screenCount = await capture();
  console.log(
    `Saved ${motionFrameDelays.length} motion frames, ${screenCount} screens, and study.json to ${outFolder}`,
  );
} finally {
  chrome.kill();
  await chromeExit;
  rmSync(profileFolder, { recursive: true, force: true });
}
