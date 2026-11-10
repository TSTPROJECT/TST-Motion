// QuickTime .mov writer with PNG frames: lossless and keeps transparency.
// Read by After Effects, Premiere Pro, Final Cut and ffmpeg-based tools.
// The file is written straight to disk frame by frame, so long 4K videos do not fill the RAM.

export interface Sink {
  write(data: Uint8Array, position: number): Promise<void>;
}

const enc = new TextEncoder();
type Part = Uint8Array | number[] | string;

function bytes(...parts: Part[]): Uint8Array {
  const arrs = parts.map((p) => (typeof p === "string" ? enc.encode(p) : p instanceof Uint8Array ? p : Uint8Array.from(p)));
  const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0));
  let o = 0; for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}
const u8 = (v: number) => [v & 255];
const u16 = (v: number) => [(v >>> 8) & 255, v & 255];
const u32 = (v: number) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
const u64 = (v: number) => [...u32(Math.floor(v / 2 ** 32)), ...u32(v >>> 0)];
const box = (type: string, ...parts: Part[]) => { const body = bytes(...parts); return bytes(u32(body.length + 8), type, body); };
const full = (type: string, version: number, flags: number, ...parts: Part[]) => box(type, u8(version), [(flags >> 16) & 255, (flags >> 8) & 255, flags & 255], ...parts);
const MATRIX = [...u32(0x10000), ...u32(0), ...u32(0), ...u32(0), ...u32(0x10000), ...u32(0), ...u32(0), ...u32(0), ...u32(0x40000000)];
const pascal = (s: string, size: number) => { const b = new Uint8Array(size); const t = enc.encode(s).slice(0, size - 1); b[0] = t.length; b.set(t, 1); return b; };

export class MovPngWriter {
  private sizes: number[] = [];
  private offsets: number[] = [];
  private pos = 0;
  private mdatAt = 0;
  private readonly scale: number;

  constructor(private out: Sink, private w: number, private h: number, fps: number) {
    this.scale = Math.round(fps * 100); // timescale; each frame lasts 100 units
  }

  async start() {
    const ftyp = box("ftyp", "qt  ", u32(0x20050300), "qt  ");
    await this.out.write(ftyp, 0);
    this.mdatAt = ftyp.length;
    // 64-bit mdat header; the real size is filled in by finish()
    await this.out.write(bytes(u32(1), "mdat", u64(0)), this.mdatAt);
    this.pos = this.mdatAt + 16;
  }

  async add(png: Uint8Array) {
    this.offsets.push(this.pos); this.sizes.push(png.length);
    await this.out.write(png, this.pos);
    this.pos += png.length;
  }

  async finish() {
    await this.out.write(bytes(u64(this.pos - this.mdatAt)), this.mdatAt + 8);
    await this.out.write(this.moov(), this.pos);
  }

  private moov() {
    const n = this.sizes.length, dur = n * 100, { w, h, scale } = this;
    const now = Math.floor(Date.now() / 1000) + 2082844800; // seconds since 1904
    const mvhd = full("mvhd", 0, 0, u32(now), u32(now), u32(scale), u32(dur), u32(0x10000), u16(0x100), new Uint8Array(10), MATRIX,
      u32(0), u32(0), u32(0), u32(0), u32(0), u32(0), u32(2));
    const tkhd = full("tkhd", 0, 0xf, u32(now), u32(now), u32(1), u32(0), u32(dur), new Uint8Array(8), u16(0), u16(0), u16(0), u16(0), MATRIX, u32(w * 0x10000), u32(h * 0x10000));
    const mdhd = full("mdhd", 0, 0, u32(now), u32(now), u32(scale), u32(dur), u16(0), u16(0));
    const hdlr = full("hdlr", 0, 0, "mhlr", "vide", u32(0), u32(0), u32(0), pascal("VideoHandler", 13));
    const vmhd = full("vmhd", 0, 1, u16(0x40), u16(0x8000), u16(0x8000), u16(0x8000));
    const dhlr = full("hdlr", 0, 0, "dhlr", "alis", u32(0), u32(0), u32(0), pascal("DataHandler", 12));
    const dinf = box("dinf", full("dref", 0, 0, u32(1), full("alis", 0, 1)));
    const entry = box("png ", new Uint8Array(6), u16(1), u16(0), u16(0), "FFMP", u32(0), u32(0x200), u16(w), u16(h),
      u32(0x480000), u32(0x480000), u32(0), u16(1), pascal("PNG", 32), u16(32), u16(0xffff));
    const stsd = full("stsd", 0, 0, u32(1), entry);
    const stts = full("stts", 0, 0, u32(1), u32(n), u32(100));
    const stsc = full("stsc", 0, 0, u32(1), u32(1), u32(1), u32(1));
    const stsz = full("stsz", 0, 0, u32(0), u32(n), ...this.sizes.map(u32));
    const co64 = full("co64", 0, 0, u32(n), ...this.offsets.map(u64));
    const stbl = box("stbl", stsd, stts, stsc, stsz, co64);
    const minf = box("minf", vmhd, dhlr, dinf, stbl);
    const mdia = box("mdia", mdhd, hdlr, minf);
    return box("moov", mvhd, box("trak", tkhd, mdia));
  }
}
