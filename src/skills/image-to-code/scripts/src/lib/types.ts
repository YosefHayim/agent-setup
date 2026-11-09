export type MaskBox = [number, number, number, number] | [number, number, number, number, string];

export interface MaskConfig {
  input: string;
  output: string;
  mode: "erase" | "keep";
  polygon?: [number, number][];
  boxes?: MaskBox[];
  outsideColor?: string;
}

export interface HotspotCell {
  count: number;
  pct: number;
  bbox: { x: number; y: number; w: number; h: number };
}

export interface DiffReport {
  target: string;
  input: string;
  dimensions: { width: number; height: number };
  diffPixels: number;
  ratio: number;
  ratioPct: number;
  maxRatio: number;
  pass: boolean;
  threshold: number;
  diffImage: string;
  hotspots: HotspotCell[];
}
