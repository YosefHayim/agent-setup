#!/usr/bin/env node
import fs from "node:fs";
import { parseArgumentList, readStringArgument } from "#src/argv.js";

const firstArgumentIndex = 2;

const argumentList = parseArgumentList(process.argv.slice(firstArgumentIndex));
const svgPath = readStringArgument(argumentList, "svg") || "out.min.svg";
const outPath = readStringArgument(argumentList, "out") || "out.html";
const title = readStringArgument(argumentList, "title") || "Animated SVG";

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
