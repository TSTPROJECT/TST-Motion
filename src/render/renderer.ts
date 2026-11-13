// Draws the composition with WebGL (works on built-in laptop graphics and phones).
// Falls back to Canvas 2D when WebGL is not available.
import type { Mat } from "../model/anim";
import type { Background, Project } from "../model/types";
import { getLoaded } from "../io/assets";

/** bg: override the project background. "none" = fully transparent (export), "#rrggbb" = any colour. */
export interface Frame {
  project: Project; world: Map<string, Mat>; alpha: Map<string, number>; bg?: Background | "none" | string;
  /** soft joints (see Layer.bend): where each such picture would be without its own turn. The 2D fallback draws them stiff. */
  follow?: Map<string, Mat>;
}
export interface RendererOptions {
  /** keep the picture after drawing (needed when reading it back later, e.g. export) */
  preserve?: boolean;
  /** where to get each part's image; defaults to the preview-sized images */
  image?: (assetId: string) => ImageBitmap | undefined;
}
type Canvas = HTMLCanvasElement | OffscreenCanvas;
/** view: composition pixels -> canvas pixels */
export interface Renderer { draw(f: Frame, view: Mat, w: number, h: number): void; forget(assetId: string): void; kind: "webgl" | "2d" }

// Each picture is a fine grid, so a soft joint can bend it: points near the pivot go where the part it
// follows would put them (mf), points further than "rad" go with the part itself (m), and in between blend.
const VS = `#version 300 es
in vec2 a; uniform mat3 m; uniform mat3 mf; uniform vec2 piv; uniform float rad; uniform vec2 size; uniform vec2 res; out vec2 uv;
void main(){
  uv = a; vec2 q = a * size; vec3 p = m * vec3(q, 1.0);
  if (rad > 0.0) { float w = 1.0 - smoothstep(0.0, rad, distance(q, piv)); p = mix(p, mf * vec3(q, 1.0), w); }
  gl_Position = vec4(p.x / res.x * 2.0 - 1.0, 1.0 - p.y / res.y * 2.0, 0.0, 1.0);
}`;
const GRID = 32;
const FS = `#version 300 es
precision highp float; in vec2 uv; uniform sampler2D tex; uniform int mode; uniform vec4 color; uniform float alpha; uniform vec2 size; out vec4 o;
void main(){
  if (mode == 0) { o = texture(tex, uv) * alpha; }
  else if (mode == 1) { o = color; }
  else { vec2 c = floor(uv * size / 16.0); float k = mod(c.x + c.y, 2.0); o = vec4(mix(vec3(0.96), vec3(0.84), k), 1.0); }
}`;

const BG: Record<Exclude<Background, "alpha">, [number, number, number]> = { green: [0, 0.694, 0.251], white: [1, 1, 1], black: [0, 0, 0] };
/** null = transparent, "checker" = checkerboard, else an RGB colour 0..1 */
function bgColor(bg: string): null | "checker" | [number, number, number] {
  if (bg === "none") return null;
  if (bg === "alpha") return "checker";
  if (bg in BG) return BG[bg as keyof typeof BG];
  const m = /^#?([0-9a-f]{6})$/i.exec(bg);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
const css = (c: [number, number, number]) => `rgb(${c.map((v) => Math.round(v * 255)).join(",")})`;

function program(gl: WebGL2RenderingContext) {
  const sh = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { console.warn("WebGL program failed:", gl.getProgramInfoLog(prog)); return null; }
  return prog;
}
const GL_OPTS: WebGLContextAttributes = { premultipliedAlpha: true, alpha: true, antialias: true, preserveDrawingBuffer: false };
/** Try WebGL on a spare canvas first: once a canvas has a WebGL context it can never give a 2D one. */
function webglWorks() {
  try {
    const gl = document.createElement("canvas").getContext("webgl2");
    if (!gl) return false;
    const ok = !!program(gl);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return ok;
  } catch { return false; }
}

export function createRenderer(canvas: Canvas, opts: RendererOptions = {}): Renderer {
  const image = opts.image ?? ((id: string) => getLoaded(id)?.bitmap);
  const gl = webglWorks() ? (canvas.getContext("webgl2", { ...GL_OPTS, preserveDrawingBuffer: !!opts.preserve }) as WebGL2RenderingContext | null) : null;
  const prog = gl && program(gl);
  if (!gl || !prog) return create2d(canvas, opts);
  gl.useProgram(prog);
  const verts = new Float32Array((GRID + 1) * (GRID + 1) * 2), idx = new Uint16Array(GRID * GRID * 6);
  for (let y = 0, k = 0; y <= GRID; y++) for (let x = 0; x <= GRID; x++) { verts[k++] = x / GRID; verts[k++] = y / GRID; }
  for (let y = 0, k = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {
    const i = y * (GRID + 1) + x; idx.set([i, i + 1, i + GRID + 1, i + 1, i + GRID + 2, i + GRID + 1], k); k += 6;
  }
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
  const ibuf = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibuf); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
  const mesh = () => gl.drawElements(gl.TRIANGLES, idx.length, gl.UNSIGNED_SHORT, 0);
  const loc = gl.getAttribLocation(prog, "a"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const U = (n: string) => gl.getUniformLocation(prog, n);
  const uM = U("m"), uSize = U("size"), uRes = U("res"), uMode = U("mode"), uColor = U("color"), uAlpha = U("alpha");
  const uMf = U("mf"), uPiv = U("piv"), uRad = U("rad");
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  const textures = new Map<string, { tex: WebGLTexture; bmp: ImageBitmap }>();

  function texFor(id: string) {
    const bmp = image(id); if (!bmp) return null;
    const have = textures.get(id);
    if (have && have.bmp === bmp) return have.tex;
    if (have) gl!.deleteTexture(have.tex);
    const tex = gl!.createTexture()!;
    gl!.bindTexture(gl!.TEXTURE_2D, tex);
    gl!.pixelStorei(gl!.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA, gl!.RGBA, gl!.UNSIGNED_BYTE, bmp);
    gl!.generateMipmap(gl!.TEXTURE_2D);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, gl!.LINEAR_MIPMAP_LINEAR);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, gl!.LINEAR);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, gl!.CLAMP_TO_EDGE);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, gl!.CLAMP_TO_EDGE);
    textures.set(id, { tex, bmp });
    return tex;
  }
  const m3 = (m: Mat) => new Float32Array([m[0], m[1], 0, m[2], m[3], 0, m[4], m[5], 1]);

  return {
    kind: "webgl",
    forget(id) { const t = textures.get(id); if (t) { gl.deleteTexture(t.tex); textures.delete(id); } },
    draw({ project: p, world, alpha, bg, follow }, view, w, h) {
      gl.viewport(0, 0, w, h); gl.uniform1f(uRad, 0);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(uRes, w, h);
      // composition background
      const back = bgColor(bg ?? p.bg);
      if (back) {
        gl.uniformMatrix3fv(uM, false, m3(view)); gl.uniform2f(uSize, p.w, p.h);
        if (back === "checker") gl.uniform1i(uMode, 2);
        else { gl.uniform1i(uMode, 1); gl.uniform4f(uColor, back[0], back[1], back[2], 1); }
        mesh();
      }
      gl.uniform1i(uMode, 0);
      for (const l of p.layers) {
        if (!l.visible || !l.asset) continue;
        const a = p.assets.find((x) => x.id === l.asset); const tex = a && texFor(a.id); const op = alpha.get(l.id) ?? 1;
        if (!a || !tex || op <= 0) continue;
        const m = world.get(l.id)!;
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.uniformMatrix3fv(uM, false, m3(mulView(view, m)));
        gl.uniform2f(uSize, a.w, a.h); gl.uniform1f(uAlpha, op);
        const f = l.bend && l.bend > 0 ? follow?.get(l.id) : undefined;
        if (f) { gl.uniformMatrix3fv(uMf, false, m3(mulView(view, f))); gl.uniform2f(uPiv, l.px, l.py); gl.uniform1f(uRad, l.bend!); }
        else gl.uniform1f(uRad, 0);
        mesh();
      }
    },
  };
}

function mulView(v: Mat, m: Mat): Mat {
  return [v[0] * m[0] + v[2] * m[1], v[1] * m[0] + v[3] * m[1], v[0] * m[2] + v[2] * m[3], v[1] * m[2] + v[3] * m[3], v[0] * m[4] + v[2] * m[5] + v[4], v[1] * m[4] + v[3] * m[5] + v[5]];
}

export function create2d(canvas: Canvas, opts: RendererOptions = {}): Renderer {
  const image = opts.image ?? ((id: string) => getLoaded(id)?.bitmap);
  const g = canvas.getContext("2d") as CanvasRenderingContext2D;
  let pattern: CanvasPattern | null = null;
  return {
    kind: "2d",
    forget() {},
    draw({ project: p, world, alpha, bg }, view, w, h) {
      g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, w, h);
      g.setTransform(...view);
      const back = bgColor(bg ?? p.bg);
      if (back === "checker") {
        if (!pattern) { const c = new OffscreenCanvas(32, 32); const cg = c.getContext("2d")!; cg.fillStyle = "#f5f5f5"; cg.fillRect(0, 0, 32, 32); cg.fillStyle = "#d6d6d6"; cg.fillRect(16, 0, 16, 16); cg.fillRect(0, 16, 16, 16); pattern = g.createPattern(c, "repeat"); }
        g.fillStyle = pattern!;
      } else if (back) g.fillStyle = css(back);
      if (back) g.fillRect(0, 0, p.w, p.h);
      for (const l of p.layers) {
        if (!l.visible || !l.asset) continue;
        const a = p.assets.find((x) => x.id === l.asset); const bmp = a && image(a.id);
        if (!a || !bmp) continue;
        g.setTransform(...mulView(view, world.get(l.id)!)); g.globalAlpha = alpha.get(l.id) ?? 1;
        g.drawImage(bmp, 0, 0, a.w, a.h);
      }
      g.globalAlpha = 1;
    },
  };
}
