#!/usr/bin/env node
import fs from "node:fs";

const firstArgumentIndex = 2;

const [inSvg, outHtml, sizeArg] = process.argv.slice(firstArgumentIndex);

const isSvgOrHtmlMissing = !inSvg || !outHtml;
if (isSvgOrHtmlMissing) {
  console.error("usage: tsx src/html/wrap.ts <in.svg> <out.html> [size]");
  const usageExitCode = 2;

  process.exit(usageExitCode);
}

const defaultSvgSizePixels = 1254;

const size = Number(sizeArg || defaultSvgSizePixels);

let svg = fs.readFileSync(inSvg, "utf8");

const isViewBoxMissing = !/viewBox=/.test(svg);
if (isViewBoxMissing) {
  const w = (svg.match(/width="(\d+(?:\.\d+)?)"/) || [])[1];

  const h = (svg.match(/height="(\d+(?:\.\d+)?)"/) || [])[1];

  const hasCanvasSize = w && h;
  if (hasCanvasSize) svg = svg.replace(/<svg /, `<svg viewBox="0 0 ${w} ${h}" `);
}

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0;background:#fff}
svg{width:${size}px;height:${size}px;display:block}
</style></head><body>${svg}</body></html>`;
fs.writeFileSync(outHtml, html);
console.log(`wrote ${outHtml}`);
