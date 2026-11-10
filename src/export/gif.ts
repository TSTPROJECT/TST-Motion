// Animated GIF. GIF has 256 colours and on/off transparency only, so soft edges become hard.
import { GIFEncoder, quantize, applyPalette } from "gifenc";

export class GifWriter {
  private enc = GIFEncoder();
  private n = 0;
  constructor(private w: number, private h: number, private fps: number, private transparent: boolean) {}

  /** rgba: straight (not premultiplied) pixels of one frame */
  add(rgba: Uint8ClampedArray) {
    const data = new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength);
    if (this.transparent) {
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] < 128) { data[i - 3] = data[i - 2] = data[i - 1] = 0; data[i] = 0; } else data[i] = 255;
      }
    }
    const format = this.transparent ? "rgba4444" : "rgb565";
    const palette = quantize(data, 256, this.transparent ? { format, oneBitAlpha: true, clearAlpha: true, clearAlphaColor: 0 } : { format });
    const index = applyPalette(data, palette, format);
    const ti = this.transparent ? palette.findIndex((c) => c[3] === 0) : -1;
    // GIF counts time in 1/100 s; spread the rounding so the total length stays right
    const cs = Math.round(((this.n + 1) * 100) / this.fps) - Math.round((this.n * 100) / this.fps);
    this.enc.writeFrame(index, this.w, this.h, {
      palette, delay: cs * 10, repeat: 0,
      transparent: ti >= 0, transparentIndex: Math.max(0, ti),
      dispose: this.transparent ? 2 : 1, // clear the previous frame when see-through
    });
    this.n++;
  }

  finish(): Uint8Array {
    this.enc.finish();
    return this.enc.bytes();
  }
}
