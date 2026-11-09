#!/usr/bin/env node
/** Wrap an SVG file in a margin-free HTML sized to the canvas, for pixel-diffing. */
import fs from "node:fs";

const [inSvg, outHtml, sizeArg] = process.argv.slice(2);
if (!inSvg || !outHtml) {
  console.error("usage: tsx src/html/wrap.ts <in.svg> <out.html> [size]");
  process.exit(2);
}

const size = Number(sizeArg || 1254);
let svg = fs.readFileSync(inSvg, "utf8");

if (!/viewBox=/.test(svg)) {
  const w = (svg.match(/width="(\d+(?:\.\d+)?)"/) || [])[1];
  const h = (svg.match(/height="(\d+(?:\.\d+)?)"/) || [])[1];
  if (w && h) svg = svg.replace(/<svg /, `<svg viewBox="0 0 ${w} ${h}" `);
}

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0;background:#fff}
svg{width:${size}px;height:${size}px;display:block}
</style></head><body>${svg}</body></html>`;
fs.writeFileSync(outHtml, html);
console.log(`wrote ${outHtml}`);
