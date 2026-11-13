// Draws the composition with WebGL (works on built-in laptop graphics and phones).
// Falls back to Canvas 2D when WebGL is not available.
//
// Each part is drawn as a fine grid (so it can bend). Plain parts go straight to the screen with their
// colour changes and blend mode. A part with a mask samples a picture of its mask part's shape.
// A part with blur, shadow or glow is first drawn into an off-screen picture, blurred there, and then
// put on the screen (shadow and glow first, then the part itself).
import type { Mat } from "../model/anim";
import type { Background, Blend, Layer, Project } from "../model/types";
import { getLoaded } from "../io/assets";
import { GRID } from "../model/warp";
import { baseId, valueAt } from "../model/anim";
import { partialText } from "./text";

type Pic = ImageBitmap | OffscreenCanvas;

/** bg: override the project background. "none" = fully transparent (export), "#rrggbb" = any colour. */
export interface Frame {
  project: Project; world: Map<string, Mat>; alpha: Map<string, number>; bg?: Background | "none" | string;
  /** frame number, for the effect amounts (blur, shadow, colours...) */
  frame?: number;
  /** soft joints (see Layer.bend): where each such picture would be without its own turn. The 2D fallback draws them stiff. */
  follow?: Map<string, Mat>;
  /** bent pictures (pins, 3D turn): grid points in the picture's own pixels. The 2D fallback draws them unbent. */
  deform?: Map<string, Float32Array>;
  /** picture shown by each part (image swap); null = hidden; missing = the layer's own */
  pic?: Map<string, string | null>;
  /** onion skin: nearby frames drawn faintly in one colour, behind the current one */
  ghosts?: Ghost[];
}
export interface Ghost { world: Map<string, Mat>; alpha: Map<string, number>; follow?: Map<string, Mat>; deform?: Map<string, Float32Array>; pic?: Map<string, string | null>; tint: [number, number, number]; k: number }
export interface RendererOptions {
  /** keep the picture after drawing (needed when reading it back later, e.g. export) */
  preserve?: boolean;
  /** where to get each part's image; defaults to the preview-sized images */
  image?: (assetId: string) => Pic | undefined;
}
type Canvas = HTMLCanvasElement | OffscreenCanvas;
/** view: composition pixels -> canvas pixels */
export interface Renderer { draw(f: Frame, view: Mat, w: number, h: number): void; forget(assetId: string): void; kind: "webgl" | "2d" }

/** Effect amounts of a part at a frame. */
export interface FxNow { blur: number; shadow: number; glow: number; bright: number; contrast: number; sat: number; hue: number; tint: number; blend: Blend }
export function fxAt(l: Layer, f: number): FxNow | null {
  if (!l.fx && !Object.keys(l.tracks).some((k) => k.startsWith("fx:")) && !Object.keys(l.base).some((k) => k.startsWith("fx:"))) return null;
  const v = (ch: string) => valueAt(l, "fx:" + ch, f);
  return {
    blur: Math.max(0, v("blur")), shadow: l.fx?.shadow ? clamp(v("shadow"), 0, 1) : 0, glow: l.fx?.glow ? clamp(v("glow"), 0, 1) : 0,
    bright: v("bright"), contrast: v("contrast"), sat: v("sat"), hue: v("hue"), tint: l.fx?.tint ? clamp(v("tint"), 0, 1) : 0, blend: l.fx?.blend ?? "normal",
  };
}
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export function hexRgb(hex: string | undefined, def: [number, number, number] = [0, 0, 0]): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? ""); if (!m) return def;
  const n = parseInt(m[1], 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

// ---------- shaders ----------
// The grid: near the pivot of a soft joint, points go where the part it follows would put them (mf);
// a bent picture also sends where each grid point moved to ("d", in its own pixels).
const VS = `#version 300 es
in vec2 a; in vec2 d; uniform int bent; uniform mat3 m; uniform mat3 mf; uniform vec2 piv; uniform float rad; uniform vec2 size; uniform vec2 res; out vec2 uv;
void main(){
  uv = a; vec2 q0 = a * size; vec2 q = bent == 1 ? d : q0; vec3 p = m * vec3(q, 1.0);
  if (rad > 0.0) { float w = 1.0 - smoothstep(0.0, rad, distance(q0, piv)); p = mix(p, mf * vec3(q, 1.0), w); }
  gl_Position = vec4(p.x / res.x * 2.0 - 1.0, 1.0 - p.y / res.y * 2.0, 0.0, 1.0);
}`;
// mode 0 picture (with colour changes), 1 flat colour, 2 checkerboard, 3 onion ghost, 4 shape only (for masks)
const FS = `#version 300 es
precision highp float; in vec2 uv; uniform sampler2D tex; uniform sampler2D maskTex; uniform int mode; uniform int maskOn;
uniform vec4 color; uniform float alpha; uniform vec2 size; uniform vec2 res; uniform vec4 adj; uniform vec4 tint; out vec4 o;
vec3 hue(vec3 c, float a){ const vec3 k = vec3(0.57735); float ca = cos(a); return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca); }
void main(){
  if (mode == 0) {
    vec4 c = texture(tex, uv);
    if (adj != vec4(0.0) || tint.a > 0.0) {
      vec3 rgb = c.a > 0.0 ? c.rgb / c.a : vec3(0.0);
      rgb += adj.x;
      rgb = (rgb - 0.5) * (1.0 + adj.y) + 0.5;
      float l = dot(rgb, vec3(0.299, 0.587, 0.114)); rgb = mix(vec3(l), rgb, 1.0 + adj.z);
      if (adj.w != 0.0) rgb = hue(rgb, adj.w);
      rgb = mix(rgb, tint.rgb, tint.a);
      c = vec4(clamp(rgb, 0.0, 1.0) * c.a, c.a);
    }
    o = c * alpha;
  }
  else if (mode == 1) { o = color; }
  else if (mode == 3) { float k = texture(tex, uv).a * alpha; o = vec4(color.rgb * k, k); }
  else if (mode == 4) { o = vec4(texture(tex, uv).a); }
  else { vec2 c = floor(uv * size / 16.0); float k = mod(c.x + c.y, 2.0); o = vec4(mix(vec3(0.96), vec3(0.84), k), 1.0); }
  if (maskOn > 0) { float mk = texture(maskTex, gl_FragCoord.xy / res).a; o *= maskOn == 2 ? 1.0 - mk : mk; }
}`;
// screen passes over an off-screen picture: 0 copy, 1 blur along dir, 2 shape in one colour (shadow / glow)
const VS2 = `#version 300 es
in vec2 p; out vec2 uv; void main(){ uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;
const FS2 = `#version 300 es
precision highp float; in vec2 uv; uniform sampler2D tex; uniform sampler2D maskTex; uniform int mode; uniform int maskOn;
uniform vec2 dir; uniform vec2 off; uniform vec4 color; uniform float amt; out vec4 o;
void main(){
  if (mode == 1) {
    vec4 s = vec4(0.0); float ws = 0.0;
    for (int i = -12; i <= 12; i++) { float x = float(i) / 12.0; float w = exp(-x * x * 2.5); s += texture(tex, uv + dir * float(i)) * w; ws += w; }
    o = s / ws; return;
  }
  if (mode == 2) { float a = texture(tex, uv - off).a * amt; o = vec4(color.rgb * a, a); }
  else o = texture(tex, uv) * amt;
  if (maskOn > 0) { float mk = texture(maskTex, uv).a; o *= maskOn == 2 ? 1.0 - mk : mk; }
}`;

const BG: Record<Exclude<Background, "alpha">, [number, number, number]> = { green: [0, 0.694, 0.251], white: [1, 1, 1], black: [0, 0, 0] };
/** null = transparent, "checker" = checkerboard, else an RGB colour 0..1 */
function bgColor(bg: string): null | "checker" | [number, number, number] {
  if (bg === "none") return null;
  if (bg === "alpha") return "checker";
  if (bg in BG) return BG[bg as keyof typeof BG];
  if (!/^#?([0-9a-f]{6})$/i.test(bg)) return null;
  return hexRgb(bg);
}
const css = (c: [number, number, number]) => `rgb(${c.map((v) => Math.round(v * 255)).join(",")})`;

function program(gl: WebGL2RenderingContext, vs: string, fs: string) {
  const sh = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { console.warn("WebGL program failed:", gl.getProgramInfoLog(prog)); return null; }
  return prog;
}
const GL_OPTS: WebGLContextAttributes = { premultipliedAlpha: true, alpha: true, antialias: true, preserveDrawingBuffer: false };
/** Try WebGL on a spare canvas first: once a canvas has a WebGL context it can never give a 2D one. */
function webglWorks() {
  try {
    const gl = document.createElement("canvas").getContext("webgl2");
    if (!gl) return false;
    const ok = !!program(gl, VS, FS) && !!program(gl, VS2, FS2);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return ok;
  } catch { return false; }
}

type Parts = { world: Map<string, Mat>; alpha: Map<string, number>; follow?: Map<string, Mat>; deform?: Map<string, Float32Array>; pic?: Map<string, string | null> };

export function createRenderer(canvas: Canvas, opts: RendererOptions = {}): Renderer {
  const image = opts.image ?? ((id: string) => getLoaded(id)?.bitmap);
  const gl = webglWorks() ? (canvas.getContext("webgl2", { ...GL_OPTS, preserveDrawingBuffer: !!opts.preserve }) as WebGL2RenderingContext | null) : null;
  const prog = gl && program(gl, VS, FS), prog2 = gl && program(gl, VS2, FS2);
  if (!gl || !prog || !prog2) return create2d(canvas, opts);

  // grid mesh
  const verts = new Float32Array((GRID + 1) * (GRID + 1) * 2), idx = new Uint16Array(GRID * GRID * 6);
  for (let y = 0, k = 0; y <= GRID; y++) for (let x = 0; x <= GRID; x++) { verts[k++] = x / GRID; verts[k++] = y / GRID; }
  for (let y = 0, k = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {
    const i = y * (GRID + 1) + x; idx.set([i, i + 1, i + GRID + 1, i + 1, i + GRID + 2, i + GRID + 1], k); k += 6;
  }
  const vaoMesh = gl.createVertexArray(); gl.bindVertexArray(vaoMesh);
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "a"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const dbuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, dbuf); gl.bufferData(gl.ARRAY_BUFFER, verts.byteLength, gl.DYNAMIC_DRAW);
  const dloc = gl.getAttribLocation(prog, "d"); gl.enableVertexAttribArray(dloc); gl.vertexAttribPointer(dloc, 2, gl.FLOAT, false, 0, 0);
  const ibuf = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibuf); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
  // full-screen triangle for the screen passes
  const vaoQuad = gl.createVertexArray(); gl.bindVertexArray(vaoQuad);
  const qbuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, qbuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const ploc = gl.getAttribLocation(prog2, "p"); gl.enableVertexAttribArray(ploc); gl.vertexAttribPointer(ploc, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  const U = (n: string) => gl.getUniformLocation(prog, n), U2 = (n: string) => gl.getUniformLocation(prog2, n);
  const uM = U("m"), uSize = U("size"), uRes = U("res"), uMode = U("mode"), uColor = U("color"), uAlpha = U("alpha");
  const uMf = U("mf"), uPiv = U("piv"), uRad = U("rad"), uBent = U("bent"), uAdj = U("adj"), uTint = U("tint"), uMaskOn = U("maskOn");
  const u2Mode = U2("mode"), u2Dir = U2("dir"), u2Off = U2("off"), u2Color = U2("color"), u2Amt = U2("amt"), u2MaskOn = U2("maskOn");
  gl.useProgram(prog); gl.uniform1i(U("tex"), 0); gl.uniform1i(U("maskTex"), 1);
  gl.useProgram(prog2); gl.uniform1i(U2("tex"), 0); gl.uniform1i(U2("maskTex"), 1);
  gl.enable(gl.BLEND);

  // off-screen pictures: A = the part, B = blur scratch, C = blurred copy, M = mask shape
  type Target = { fb: WebGLFramebuffer; tex: WebGLTexture };
  let targets: Record<"A" | "B" | "C" | "M", Target> | null = null, tw = 0, th = 0;
  function target(): Target {
    const tex = gl!.createTexture()!; gl!.activeTexture(gl!.TEXTURE0); gl!.bindTexture(gl!.TEXTURE_2D, tex);
    gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA, tw, th, 0, gl!.RGBA, gl!.UNSIGNED_BYTE, null);
    for (const [k, v] of [[gl!.TEXTURE_MIN_FILTER, gl!.LINEAR], [gl!.TEXTURE_MAG_FILTER, gl!.LINEAR], [gl!.TEXTURE_WRAP_S, gl!.CLAMP_TO_EDGE], [gl!.TEXTURE_WRAP_T, gl!.CLAMP_TO_EDGE]]) gl!.texParameteri(gl!.TEXTURE_2D, k, v);
    const fb = gl!.createFramebuffer()!; gl!.bindFramebuffer(gl!.FRAMEBUFFER, fb);
    gl!.framebufferTexture2D(gl!.FRAMEBUFFER, gl!.COLOR_ATTACHMENT0, gl!.TEXTURE_2D, tex, 0);
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, null);
    return { fb, tex };
  }
  function targetsFor(w: number, h: number) {
    if (targets && tw === w && th === h) return targets;
    if (targets) for (const t of Object.values(targets)) { gl!.deleteFramebuffer(t.fb); gl!.deleteTexture(t.tex); }
    tw = w; th = h; targets = { A: target(), B: target(), C: target(), M: target() };
    return targets;
  }

  const textures = new Map<string, { tex: WebGLTexture; bmp: Pic }>();
  const partIds: string[] = [];
  function texFor(p: Project, id: string) {
    const bmp = id.includes("#") ? partialText(p, id) : image(id); if (!bmp) return null;
    const have = textures.get(id);
    if (have && have.bmp === bmp) return have.tex;
    if (have) gl!.deleteTexture(have.tex);
    if (id.includes("#") && !have) {
      // typewriter pictures are many and short-lived: keep only the latest few on the graphics card
      partIds.push(id);
      while (partIds.length > 12) { const old = partIds.shift()!; const t = textures.get(old); if (t) { gl!.deleteTexture(t.tex); textures.delete(old); } }
    }
    const tex = gl!.createTexture()!;
    gl!.activeTexture(gl!.TEXTURE0);
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
  const blendFor = (b: Blend) => {
    if (b === "add") gl!.blendFunc(gl!.ONE, gl!.ONE);
    else if (b === "screen") gl!.blendFunc(gl!.ONE, gl!.ONE_MINUS_SRC_COLOR);
    else if (b === "multiply") gl!.blendFunc(gl!.DST_COLOR, gl!.ONE_MINUS_SRC_ALPHA);
    else gl!.blendFunc(gl!.ONE, gl!.ONE_MINUS_SRC_ALPHA);
  };

  return {
    kind: "webgl",
    forget(id) { const t = textures.get(id); if (t) { gl.deleteTexture(t.tex); textures.delete(id); } },
    draw({ project: p, world, alpha, bg, follow, deform, pic, ghosts, frame = 0 }, view, w, h) {
      const T = targetsFor(w, h), vs = Math.hypot(view[0], view[1]); // canvas pixels per composition pixel
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, w, h); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(prog); gl.bindVertexArray(vaoMesh);
      gl.uniform2f(uRes, w, h); gl.uniform1f(uRad, 0); gl.uniform1i(uBent, 0); gl.uniform1i(uMaskOn, 0);
      gl.uniform4f(uAdj, 0, 0, 0, 0); gl.uniform4f(uTint, 0, 0, 0, 0);
      // composition background
      const back = bgColor(bg ?? p.bg);
      if (back) {
        gl.uniformMatrix3fv(uM, false, m3(view)); gl.uniform2f(uSize, p.w, p.h);
        if (back === "checker") gl.uniform1i(uMode, 2);
        else { gl.uniform1i(uMode, 1); gl.uniform4f(uColor, back[0], back[1], back[2], 1); }
        gl.drawElements(gl.TRIANGLES, idx.length, gl.UNSIGNED_SHORT, 0);
      }
      for (const g of ghosts ?? []) {
        gl.uniform4f(uColor, g.tint[0], g.tint[1], g.tint[2], 1);
        for (const l of p.layers) if (l.visible && !l.camera) mesh(g, l, 3, (g.alpha.get(l.id) ?? 1) * g.k);
      }
      const F: Parts = { world, alpha, follow, deform, pic };
      for (const l of p.layers) {
        if (!l.visible || l.camera) continue;
        const op = alpha.get(l.id) ?? 1; if (op <= 0) continue;
        const fx = fxAt(l, frame);
        const maskBy = l.mask ? p.layers.find((x) => x.id === l.mask!.by && x.id !== l.id) : undefined;
        const maskOn = maskBy ? (l.mask!.invert ? 2 : 1) : 0;
        if (maskBy) drawMask(F, maskBy);
        const heavy = !!fx && (fx.blur > 0.05 || fx.shadow > 0 || fx.glow > 0);
        if (!heavy) {
          setAdjust(fx, l);
          gl.uniform1i(uMaskOn, maskOn); blendFor(fx?.blend ?? "normal");
          mesh(F, l, 0, op);
          gl.uniform1i(uMaskOn, 0);
          continue;
        }
        // 1. the part alone, off screen
        gl.bindFramebuffer(gl.FRAMEBUFFER, T.A.fb); gl.clear(gl.COLOR_BUFFER_BIT);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); setAdjust(fx, l); gl.uniform1i(uMaskOn, 0);
        mesh(F, l, 0, op);
        // 2. its own blur
        if (fx!.blur > 0.05) blur(T.A, T.B, T.A, fx!.blur * vs);
        // 3. shadow and glow behind it
        if (fx!.shadow > 0 && l.fx?.shadow) {
          const s = l.fx.shadow; blur(T.A, T.B, T.C, Math.max(0, s.blur) * vs);
          // the offset follows the view only: a shadow keeps falling the same way when the part turns
          screen(T.C, 2, fx!.shadow, hexRgb(s.color), [(view[0] * s.dx + view[2] * s.dy) / w, -(view[1] * s.dx + view[3] * s.dy) / h], maskOn, "normal");
        }
        if (fx!.glow > 0 && l.fx?.glow) {
          const gw = l.fx.glow; blur(T.A, T.B, T.C, Math.max(1, gw.size) * vs);
          const col = hexRgb(gw.color, [1, 1, 1]);
          screen(T.C, 2, Math.min(1, fx!.glow * 1.6), col, [0, 0], maskOn, "normal");
          if (fx!.glow > 0.6) screen(T.C, 2, (fx!.glow - 0.6) * 2, col, [0, 0], maskOn, "add");
        }
        // 4. the part itself
        screen(T.A, 0, 1, [0, 0, 0], [0, 0], maskOn, fx!.blend);
        gl.useProgram(prog); gl.bindVertexArray(vaoMesh);
      }
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

      function setAdjust(fx: FxNow | null, l: Layer) {
        if (!fx) { gl!.uniform4f(uAdj, 0, 0, 0, 0); gl!.uniform4f(uTint, 0, 0, 0, 0); return; }
        gl!.uniform4f(uAdj, fx.bright, fx.contrast, fx.sat, (fx.hue * Math.PI) / 180);
        const tc = hexRgb(l.fx?.tint, [1, 1, 1]); gl!.uniform4f(uTint, tc[0], tc[1], tc[2], fx.tint);
      }
      /** The mask part's shape into M (with its own bending and picture swaps, ignoring its opacity). */
      function drawMask(Fm: Parts, m: Layer) {
        // never draw into a picture that is still bound for reading (WebGL refuses such a loop)
        gl!.activeTexture(gl!.TEXTURE1); gl!.bindTexture(gl!.TEXTURE_2D, null); gl!.activeTexture(gl!.TEXTURE0);
        gl!.bindFramebuffer(gl!.FRAMEBUFFER, T.M.fb); gl!.clear(gl!.COLOR_BUFFER_BIT);
        gl!.blendFunc(gl!.ONE, gl!.ONE_MINUS_SRC_ALPHA); gl!.uniform1i(uMaskOn, 0);
        mesh(Fm, m, 4, 1);
        gl!.bindFramebuffer(gl!.FRAMEBUFFER, null);
        gl!.activeTexture(gl!.TEXTURE1); gl!.bindTexture(gl!.TEXTURE_2D, T.M.tex); gl!.activeTexture(gl!.TEXTURE0);
      }
      /** Gaussian blur of `src` (radius in canvas pixels) into `dst`, through `tmp`. */
      function blur(src: Target, tmp: Target, dst: Target, r: number) {
        gl!.useProgram(prog2); gl!.bindVertexArray(vaoQuad); gl!.blendFunc(gl!.ONE, gl!.ZERO); gl!.uniform1i(u2MaskOn, 0);
        gl!.activeTexture(gl!.TEXTURE0);
        if (r <= 0.05) {
          if (dst !== src) { gl!.bindFramebuffer(gl!.FRAMEBUFFER, dst.fb); gl!.bindTexture(gl!.TEXTURE_2D, src.tex); gl!.uniform1i(u2Mode, 0); gl!.uniform1f(u2Amt, 1); gl!.drawArrays(gl!.TRIANGLES, 0, 3); }
        } else {
          gl!.uniform1i(u2Mode, 1);
          // wide blurs: several passes, each within what 25 taps can cover smoothly
          const passes = Math.max(1, Math.ceil(r / 24)), rr = r / Math.sqrt(passes);
          let from = src;
          for (let i = 0; i < passes; i++) {
            gl!.bindFramebuffer(gl!.FRAMEBUFFER, tmp.fb); gl!.bindTexture(gl!.TEXTURE_2D, from.tex);
            gl!.uniform2f(u2Dir, rr / 12 / w, 0); gl!.drawArrays(gl!.TRIANGLES, 0, 3);
            gl!.bindFramebuffer(gl!.FRAMEBUFFER, dst.fb); gl!.bindTexture(gl!.TEXTURE_2D, tmp.tex);
            gl!.uniform2f(u2Dir, 0, rr / 12 / h); gl!.drawArrays(gl!.TRIANGLES, 0, 3);
            from = dst;
          }
        }
        gl!.bindFramebuffer(gl!.FRAMEBUFFER, null);
        gl!.useProgram(prog); gl!.bindVertexArray(vaoMesh);
      }
      /** Put an off-screen picture on the canvas. */
      function screen(src: Target, mode: 0 | 2, amt: number, color: [number, number, number], off: [number, number], maskOn: number, blend: Blend) {
        gl!.bindFramebuffer(gl!.FRAMEBUFFER, null);
        gl!.useProgram(prog2); gl!.bindVertexArray(vaoQuad); blendFor(blend);
        gl!.activeTexture(gl!.TEXTURE0); gl!.bindTexture(gl!.TEXTURE_2D, src.tex);
        gl!.uniform1i(u2Mode, mode); gl!.uniform1f(u2Amt, amt); gl!.uniform4f(u2Color, color[0], color[1], color[2], 1);
        gl!.uniform2f(u2Off, off[0], off[1]); gl!.uniform1i(u2MaskOn, maskOn);
        gl!.drawArrays(gl!.TRIANGLES, 0, 3);
      }
      /** One part as a grid. */
      function mesh(Fp: Parts, l: Layer, mode: number, op: number) {
        const id = Fp.pic?.has(l.id) ? Fp.pic.get(l.id)! : l.asset; if (!id) return;
        const a = p.assets.find((x) => x.id === baseId(id)); const tex = a && texFor(p, id);
        if (!a || !tex || op <= 0) return;
        let m = Fp.world.get(l.id); if (!m) return;
        // a swapped picture of another size sits centred where the part's own picture is
        const own = baseId(id) !== l.asset ? p.assets.find((x) => x.id === l.asset) : undefined;
        if (own && (own.w !== a.w || own.h !== a.h)) m = mulView(m, [1, 0, 0, 1, (own.w - a.w) / 2, (own.h - a.h) / 2]);
        gl!.activeTexture(gl!.TEXTURE0); gl!.bindTexture(gl!.TEXTURE_2D, tex);
        gl!.uniform1i(uMode, mode);
        gl!.uniformMatrix3fv(uM, false, m3(mulView(view, m)));
        gl!.uniform2f(uSize, a.w, a.h); gl!.uniform1f(uAlpha, op);
        const f = l.bend && l.bend > 0 ? Fp.follow?.get(l.id) : undefined;
        if (f) { gl!.uniformMatrix3fv(uMf, false, m3(mulView(view, f))); gl!.uniform2f(uPiv, l.px, l.py); gl!.uniform1f(uRad, l.bend!); }
        else gl!.uniform1f(uRad, 0);
        const dg = id === l.asset ? Fp.deform?.get(l.id) : undefined;
        if (dg) { gl!.bindBuffer(gl!.ARRAY_BUFFER, dbuf); gl!.bufferSubData(gl!.ARRAY_BUFFER, 0, dg); gl!.uniform1i(uBent, 1); }
        gl!.drawElements(gl!.TRIANGLES, idx.length, gl!.UNSIGNED_SHORT, 0);
        if (dg) gl!.uniform1i(uBent, 0);
      }
    },
  };
}

function mulView(v: Mat, m: Mat): Mat {
  return [v[0] * m[0] + v[2] * m[1], v[1] * m[0] + v[3] * m[1], v[0] * m[2] + v[2] * m[3], v[1] * m[2] + v[3] * m[3], v[0] * m[4] + v[2] * m[5] + v[4], v[1] * m[4] + v[3] * m[5] + v[5]];
}

/** Canvas 2D fallback: no bending; effects through canvas filters, masks through a scratch canvas. */
export function create2d(canvas: Canvas, opts: RendererOptions = {}): Renderer {
  const image = opts.image ?? ((id: string) => getLoaded(id)?.bitmap);
  const g = canvas.getContext("2d") as CanvasRenderingContext2D;
  let pattern: CanvasPattern | null = null, scratch: OffscreenCanvas | null = null, maskC: OffscreenCanvas | null = null;
  const sized = (c: OffscreenCanvas | null, w: number, h: number) => (c && c.width === w && c.height === h ? c : new OffscreenCanvas(w, h));
  const OPS: Record<Blend, GlobalCompositeOperation> = { normal: "source-over", multiply: "multiply", screen: "screen", add: "lighter" };
  return {
    kind: "2d",
    forget() {},
    draw({ project: p, world, alpha, bg, pic, frame = 0 }, view, w, h) {
      g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, w, h); g.globalCompositeOperation = "source-over"; g.filter = "none"; g.globalAlpha = 1;
      g.setTransform(...view);
      const back = bgColor(bg ?? p.bg);
      if (back === "checker") {
        if (!pattern) { const c = new OffscreenCanvas(32, 32); const cg = c.getContext("2d")!; cg.fillStyle = "#f5f5f5"; cg.fillRect(0, 0, 32, 32); cg.fillStyle = "#d6d6d6"; cg.fillRect(16, 0, 16, 16); cg.fillRect(0, 16, 16, 16); pattern = g.createPattern(c, "repeat"); }
        g.fillStyle = pattern!;
      } else if (back) g.fillStyle = css(back);
      if (back) g.fillRect(0, 0, p.w, p.h);
      const vs = Math.hypot(view[0], view[1]);
      const put = (ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, l: Layer) => {
        const id = pic?.has(l.id) ? pic.get(l.id)! : l.asset; if (!id) return;
        const a = p.assets.find((x) => x.id === baseId(id)); const bmp = a && (id.includes("#") ? partialText(p, id) : image(a.id));
        if (!a || !bmp) return;
        const own = baseId(id) !== l.asset ? p.assets.find((x) => x.id === l.asset) : undefined;
        const m = own && (own.w !== a.w || own.h !== a.h) ? mulView(world.get(l.id)!, [1, 0, 0, 1, (own.w - a.w) / 2, (own.h - a.h) / 2]) : world.get(l.id)!;
        ctx.setTransform(...mulView(view, m)); ctx.drawImage(bmp, 0, 0, a.w, a.h);
      };
      for (const l of p.layers) {
        if (!l.visible || l.camera) continue;
        const fx = fxAt(l, frame), maskBy = l.mask ? p.layers.find((x) => x.id === l.mask!.by && x.id !== l.id) : undefined;
        const filters: string[] = [];
        if (fx) {
          if (fx.blur > 0.05) filters.push(`blur(${(fx.blur * vs).toFixed(1)}px)`);
          if (fx.bright) filters.push(`brightness(${(1 + fx.bright).toFixed(3)})`);
          if (fx.contrast) filters.push(`contrast(${(1 + fx.contrast).toFixed(3)})`);
          if (fx.sat) filters.push(`saturate(${(1 + fx.sat).toFixed(3)})`);
          if (fx.hue) filters.push(`hue-rotate(${fx.hue.toFixed(1)}deg)`);
          if (fx.glow > 0 && l.fx?.glow) filters.push(`drop-shadow(0 0 ${(l.fx.glow.size * vs).toFixed(1)}px ${l.fx.glow.color})`);
          if (fx.shadow > 0 && l.fx?.shadow) { const s = l.fx.shadow; filters.push(`drop-shadow(${(s.dx * vs).toFixed(1)}px ${(s.dy * vs).toFixed(1)}px ${(s.blur * vs).toFixed(1)}px ${s.color}${Math.round(fx.shadow * 255).toString(16).padStart(2, "0")})`); }
        }
        const op = alpha.get(l.id) ?? 1, blend = OPS[fx?.blend ?? "normal"];
        if (!maskBy) {
          g.globalAlpha = op; g.filter = filters.join(" ") || "none"; g.globalCompositeOperation = blend;
          put(g, l);
          g.filter = "none"; g.globalAlpha = 1; g.globalCompositeOperation = "source-over";
          continue;
        }
        scratch = sized(scratch, w, h); maskC = sized(maskC, w, h);
        const sg = scratch.getContext("2d")!, mg = maskC.getContext("2d")!;
        sg.setTransform(1, 0, 0, 1, 0, 0); sg.clearRect(0, 0, w, h); mg.setTransform(1, 0, 0, 1, 0, 0); mg.clearRect(0, 0, w, h);
        sg.globalAlpha = op; sg.filter = filters.join(" ") || "none"; put(sg, l); sg.filter = "none"; sg.globalAlpha = 1;
        put(mg, maskBy);
        sg.setTransform(1, 0, 0, 1, 0, 0); sg.globalCompositeOperation = l.mask!.invert ? "destination-out" : "destination-in"; sg.drawImage(maskC, 0, 0); sg.globalCompositeOperation = "source-over";
        g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = blend; g.drawImage(scratch, 0, 0); g.globalCompositeOperation = "source-over";
      }
      g.globalAlpha = 1; g.filter = "none"; g.setTransform(1, 0, 0, 1, 0, 0);
    },
  };
}
