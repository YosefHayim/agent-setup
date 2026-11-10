import type { PNG } from "pngjs";

const HEX_RADIX = 16;

export const readHexByte = (r: number, g: number, b: number): string => {
  const hexDigitsPerByte = 2;

  return `#${[r, g, b].map((position) => position.toString(HEX_RADIX).padStart(hexDigitsPerByte, "0")).join("")}`;
};

export const clamp = (position: number, maxPosition: number): number => {
  return Math.max(0, Math.min(maxPosition, position));
};

export const readColorAt = (png: PNG, column: number, y: number) => {
  const clampedColumn = clamp(column, png.width - 1);
  const clampedY = clamp(y, png.height - 1);
  const bytesPerPixel = 4;

  const pixelIndex = (clampedY * png.width + clampedColumn) * bytesPerPixel;
  const alphaChannelOffset = 3;

  const blueOffsetInRgba = 2;

  const blueChannelOffset = 2;

  return {
    x: clampedColumn,
    y: clampedY,
    hex: readHexByte(png.data[pixelIndex], png.data[pixelIndex + 1], png.data[pixelIndex + blueChannelOffset]),
    rgba: [
      png.data[pixelIndex],
      png.data[pixelIndex + 1],
      png.data[pixelIndex + blueOffsetInRgba],
      png.data[pixelIndex + alphaChannelOffset],
    ] as const,
  };
};

export const isPointInPolygon = (px: number, py: number, poly: [number, number][]): boolean => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];

    const [xj, yj] = poly[j];

    const isEdgeCrossingRay = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (isEdgeCrossingRay) inside = !inside;
  }
  return inside;
};

export const readRgbFromHex = (hex: string): [number, number, number] => {
  const hexByteLength = 2;

  const thirdHexByteStart = 5;

  const secondHexByteStart = 3;

  return [1, secondHexByteStart, thirdHexByteStart].map((k) =>
    parseInt(hex.slice(k, k + hexByteLength), HEX_RADIX),
  ) as [number, number, number];
};
