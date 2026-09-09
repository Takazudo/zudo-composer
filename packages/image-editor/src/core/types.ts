export interface Size {
  width: number;
  height: number;
}
export interface Rect extends Size {
  x: number;
  y: number;
}
export interface RgbaImage extends Size {
  data: Uint8ClampedArray;
}
export type EditableMime = "image/png" | "image/jpeg" | "image/webp";
export interface Tone {
  brightness: number;
  contrast: number;
  saturation: number;
  hue: number;
}
export interface EditDoc {
  crop: Rect;
  rotate: 0 | 90 | 180 | 270;
  flipH: boolean;
  flipV: boolean;
  resize: Size;
  tone: Tone;
}
