#!/usr/bin/env node
/** Rebuild an HTML viewer page embedding an optimized SVG. */
import fs from "node:fs";
import { argString, parseArgs } from "../lib/argv.js";

const args = parseArgs(process.argv.slice(2));
const svgPath = argString(args, "svg") || "out.min.svg";
const outPath = argString(args, "out") || "out.html";
const title = argString(args, "title") || "Animated SVG";

const svg = fs.readFileSync(svgPath, "utf8");
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  html,body { margin:0; height:100%; }
  body { display:grid; place-items:center; background:#ffffff; }
  .stage { width:min(80vmin,620px); aspect-ratio:1; }
  .stage svg { width:100%; height:100%; display:block; }
</style>
</head>
<body>
  <div class="stage">${svg}</div>
</body>
</html>`;
fs.writeFileSync(outPath, html);
console.log(`rebuilt ${outPath} with ${svgPath}`);
