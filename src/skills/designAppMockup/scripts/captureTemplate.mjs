#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

const usage =
  "Usage: node captureTemplate.mjs --url <preview url> --out-folder <folder> [--width 1440] [--height 900] [--chrome-path <path>]";
const macChromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const motionFrameDelays = [350, 500, 700, 1200];
const settleDelay = 5000;
const scrollSettleDelay = 1800;

const { values: flags } = parseArgs({
  options: {
    url: { type: "string" },
    "out-folder": { type: "string" },
    width: { type: "string", default: "1440" },
    height: { type: "string", default: "900" },
    "chrome-path": { type: "string", default: process.env.CHROME_PATH || macChromePath },
  },
});

const isMissingFlag = !flags.url || !flags["out-folder"];
if (isMissingFlag) {
  console.error(usage);
  process.exit(2);
}

const width = Number(flags.width);
const height = Number(flags.height);
const outFolder = path.resolve(flags["out-folder"]);
const profileFolder = path.join(outFolder, "chrome-profile");

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const readPortLine = (portFile) => {
  if (!existsSync(portFile)) return "";
  const portText = readFileSync(portFile, "utf8");
  return portText.split("\n")[0];
};

const waitForDebugPort = async () => {
  const portFile = path.join(profileFolder, "DevToolsActivePort");
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const portLine = readPortLine(portFile);
    if (portLine) return portLine;
    await sleep(100);
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
  await new Promise((resolve) => socket.addEventListener("open", resolve));
  const waiting = new Map();
  let lastId = 0;
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    const pending = waiting.get(message.id);
    if (!pending) return;
    waiting.delete(message.id);
    if (message.error) {
      pending.reject(new Error(message.error.message));
      return;
    }
    pending.resolve(message.result);
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      lastId += 1;
      waiting.set(lastId, { resolve, reject });
      socket.send(JSON.stringify({ id: lastId, method, params }));
    });
  return { send, close: () => socket.close() };
};

const evaluate = async (devtools, expression) => {
  const evaluation = await devtools.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  return evaluation.result.value;
};

const saveScreenshot = async (devtools, fileName) => {
  const screenshot = await devtools.send("Page.captureScreenshot", { format: "jpeg", quality: 75 });
  const imageBytes = Buffer.from(screenshot.data, "base64");
  const filePath = path.join(outFolder, fileName);
  writeFileSync(filePath, imageBytes);
};

const studyPage = () => {
  const topCounts = (values) => {
    const counts = new Map();
    for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
    const sorted = [...counts.entries()].sort((first, second) => second[1] - first[1]);
    return sorted.slice(0, 12);
  };
  const hasOwnText = (element) =>
    [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
  const textElements = [...document.querySelectorAll("body *")].filter(hasOwnText);
  const textStyles = textElements.map((element) => getComputedStyle(element));
  const allStyles = [...document.querySelectorAll("body *")].map((element) => getComputedStyle(element));
  const isShown = (element) => {
    const box = element.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
  };
  const describeType = (selector) => {
    const element = document.querySelector(selector);
    if (!element) return null;
    const style = getComputedStyle(element);
    const sample = element.textContent.trim().slice(0, 80);
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
    const isFilled = style.backgroundColor !== "rgba(0, 0, 0, 0)" || style.borderRadius !== "0px";
    const tag = element.tagName.toLowerCase();
    return hasOwnText(element) || pieceTags.includes(tag) || isFilled;
  };
  const describePiece = (element, sectionBox) => {
    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    const family = style.fontFamily.split(",")[0];
    const text = hasOwnText(element) ? element.textContent.trim().slice(0, 40) : "";
    return {
      tag: element.tagName.toLowerCase(),
      text,
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
    const headingText = heading ? heading.textContent.trim().slice(0, 90) : "";
    const box = element.getBoundingClientRect();
    const shownPieces = [...element.querySelectorAll("*")].filter(isShown).filter(isPiece);
    return {
      name: element.dataset.framerName || element.id || element.tagName.toLowerCase(),
      heading: headingText,
      top: Math.round(box.top + window.scrollY),
      height: Math.round(box.height),
      pieces: shownPieces.slice(0, 80).map((piece) => describePiece(piece, box)),
    };
  };
  const sections = [...document.querySelectorAll("section, footer")].filter(isShown).map(describeSection);
  const describeVariant = (variant) => {
    const initial = variant.initial || {};
    const transition = variant.animate?.transition || {};
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
  const appearEntries = appearScript ? Object.values(JSON.parse(appearScript.textContent)) : [];
  const appearVariants = appearEntries.map((entry) => entry?.default).filter(Boolean);
  const headline = document.querySelector("h1");
  const headlineParts = headline ? headline.querySelectorAll("span[style*='inline-block']").length : 0;
  return {
    title: document.title,
    pageHeight: document.documentElement.scrollHeight,
    type: { h1: describeType("h1"), h2: describeType("h2"), h3: describeType("h3"), body: describeType("p") },
    fonts: topCounts(textStyles.map((style) => style.fontFamily.split(",")[0])),
    textColors: topCounts(textStyles.map((style) => style.color)),
    backgrounds: topCounts(
      allStyles.map((style) => style.backgroundColor).filter((color) => color !== "rgba(0, 0, 0, 0)"),
    ),
    radii: topCounts(allStyles.map((style) => style.borderRadius).filter((radius) => radius !== "0px")),
    shadows: topCounts(allStyles.map((style) => style.boxShadow).filter((shadow) => shadow !== "none")),
    sections,
    motion: {
      loadAnimations: topCounts(appearVariants.map(describeVariant)),
      headlineSplitParts: headlineParts,
      cssAnimations: topCounts(allStyles.map((style) => style.animationName).filter((name) => name !== "none")),
      backdropBlurs: topCounts(allStyles.map((style) => style.backdropFilter).filter((filter) => filter !== "none")),
    },
  };
};

const capture = async () => {
  const port = await waitForDebugPort();
  const socketUrl = await findPageSocketUrl(port);
  const devtools = await connectDevtools(socketUrl);
  await devtools.send("Page.enable");
  await devtools.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width < 600,
  });
  await devtools.send("Page.navigate", { url: flags.url });
  for (const [index, delay] of motionFrameDelays.entries()) {
    await sleep(delay);
    await saveScreenshot(devtools, `motion-${index}.jpg`);
  }
  await sleep(settleDelay);
  const pageHeight = await evaluate(devtools, "document.documentElement.scrollHeight");
  const screenCount = Math.ceil(pageHeight / height);
  const screenTops = Array.from({ length: screenCount }, (_, index) => index * height);
  for (const [index, top] of screenTops.entries()) {
    await evaluate(devtools, `window.scrollTo(0, ${top})`);
    await sleep(scrollSettleDelay);
    const screenNumber = String(index).padStart(2, "0");
    await saveScreenshot(devtools, `screen-${screenNumber}.jpg`);
  }
  const study = await evaluate(devtools, `(${studyPage})()`);
  const studyPath = path.join(outFolder, "study.json");
  const studyText = JSON.stringify(study, null, 2);
  writeFileSync(studyPath, studyText);
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
const chromeExit = new Promise((resolve) => chrome.once("exit", resolve));

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
