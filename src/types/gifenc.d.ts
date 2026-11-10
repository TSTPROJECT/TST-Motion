// Minimal types for gifenc (MIT, https://github.com/mattdesl/gifenc)
declare module "gifenc" {
  export type Palette = number[][];
  export type Format = "rgb565" | "rgb444" | "rgba4444";
  export interface FrameOptions { palette?: Palette; delay?: number; transparent?: boolean; transparentIndex?: number; repeat?: number; dispose?: number; first?: boolean }
  export interface Encoder {
    writeFrame(index: Uint8Array, width: number, height: number, opts?: FrameOptions): void;
    finish(): void;
    bytes(): Uint8Array;
    bytesView(): Uint8Array;
    reset(): void;
  }
  export function GIFEncoder(opts?: { auto?: boolean; initialCapacity?: number }): Encoder;
  export function quantize(rgba: Uint8Array | Uint8ClampedArray, maxColors: number, opts?: { format?: Format; oneBitAlpha?: boolean | number; clearAlpha?: boolean; clearAlphaColor?: number; clearAlphaThreshold?: number }): Palette;
  export function applyPalette(rgba: Uint8Array | Uint8ClampedArray, palette: Palette, format?: Format): Uint8Array;
}
