import type { PNG } from "pngjs";

export function toHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

export function clamp(v: number, max: number): number {
  return Math.max(0, Math.min(max, v));
}

export function colorAt(png: PNG, x: number, y: number) {
  const cx = clamp(x, png.width - 1);
  const cy = clamp(y, png.height - 1);
  const idx = (cy * png.width + cx) * 4;
  return {
    x: cx,
    y: cy,
    hex: toHex(png.data[idx], png.data[idx + 1], png.data[idx + 2]),
    rgba: [png.data[idx], png.data[idx + 1], png.data[idx + 2], png.data[idx + 3]] as const,
  };
}

export function inPoly(px: number, py: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function hexToRgb(h: string): [number, number, number] {
  return [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16)) as [number, number, number];
}
