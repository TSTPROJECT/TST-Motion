// The saved shape of a TST Motion project. Times are whole frames.

export type Ease = "smooth" | "linear" | "in" | "out" | "back" | "hold" | "curve";
export type Prop = "x" | "y" | "rot" | "sx" | "sy" | "o";
export const PROPS: Prop[] = ["x", "y", "rot", "sx", "sy", "o"];
/**
 * Any value that can have keyframes: a Prop, or "turn" / "nod" (3D head turn, -1..1),
 * "swap" (which picture is shown), "type" (share of a text's letters shown, 0..1),
 * or "pin:<id>:x" / "pin:<id>:y" (how far a pin was dragged).
 */
export type Chan = string;
export const pinChan = (id: string, axis: "x" | "y") => `pin:${id}:${axis}`;

export interface Key {
  /** frame number */
  f: number;
  /** value */
  v: number;
  /** how the value travels from this key to the next one */
  e: Ease;
  /** for e = "curve": speed curve as a CSS-style cubic-bezier (x1, y1, x2, y2) */
  c?: [number, number, number, number];
}

/** A pin stuck into a picture (its own pixels). Dragging it bends the picture round the other pins. */
export interface Pin { id: string; x: number; y: number }
/** Sways by itself (hair, cloth): a spring that lags behind when the part it hangs from moves. */
export interface Sway {
  /** 0..2, how strongly it swings */
  amt: number;
  /** 0..1, 0 = loose and slow, 1 = stiff and quick */
  stiff: number;
  /** 0..1, how quickly it calms down */
  damp: number;
  /** 0..1, gentle swinging even when nothing moves */
  wind: number;
}
/** 3D head turn: the picture is treated as a ball (centre cx,cy, radii rx,ry in its own pixels). */
export interface Face { cx: number; cy: number; rx: number; ry: number }
/** A text part: its picture is drawn from this (see render/text.ts) and saved like any other picture. */
export interface TextStyle {
  s: string;
  /** font family name (bundled, installed on the computer, or added to the project) */
  font: string;
  /** letter height in composition pixels */
  size: number;
  bold: boolean;
  italic: boolean;
  color: string;
  align: "left" | "center" | "right";
  /** line height, times the size */
  line: number;
  /** extra space between letters, times the size */
  spacing: number;
  /** outline width in pixels (0 = none) */
  stroke: number;
  strokeColor: string;
  /** box behind the text: padding in pixels (0 = no box) */
  box: number;
  boxColor: string;
  /** box corner roundness 0..1 */
  boxRound: number;
}
/** A font file added to a project, so the project looks the same on any computer. */
export interface FontFile { id: string; family: string; name: string; type: string }
/** A saved pose: every part's values, by layer id. */
export interface SavedPose { id: string; name: string; values: Record<string, Record<Chan, number>> }

export interface Layer {
  id: string;
  name: string;
  /** image used by this layer; null for an empty holder */
  asset: string | null;
  /** layer this one follows (moves, turns and scales with it) */
  parent: string | null;
  /** pivot (joint) in the image's own pixels */
  px: number;
  py: number;
  /** setup pose, used by any property that has no keyframes */
  base: Record<Prop, number> & { [ch: Chan]: number | undefined };
  tracks: { [ch: Chan]: Key[] | undefined };
  visible: boolean;
  locked: boolean;
  /**
   * Soft joint: how far (image pixels) round the pivot the picture bends instead of turning stiffly.
   * Near the joint it stays with the part it follows, further out it turns with this part. 0 or missing = stiff.
   */
  bend?: number;
  /** pin warp (see Pin); offsets live in the "pin:<id>:x/y" values */
  pins?: Pin[];
  /** other pictures this part can switch to (eyes closed, mouth shapes); the "swap" value picks one */
  swaps?: string[];
  sway?: Sway;
  /** this part can turn like a 3D head; its children shift by their depth */
  face?: Face;
  /** for a child of a 3D head: how far it sits in front (+) or behind (-) the face surface, in the head's pixels */
  depth?: number;
  /** text part; the "type" value (0..1) shows that share of the letters (typewriter) */
  text?: TextStyle;
}

export interface Asset {
  id: string;
  name: string;
  /** MIME type of the stored file */
  type: string;
  /** natural size in pixels */
  w: number;
  h: number;
}

export type Background = "alpha" | "green" | "white" | "black";

export interface Project {
  format: "tst-motion";
  version: 1;
  id: string;
  name: string;
  /** composition size in pixels */
  w: number;
  h: number;
  fps: number;
  /** length in frames */
  frames: number;
  bg: Background;
  /** draw order: index 0 is at the back */
  layers: Layer[];
  assets: Asset[];
  /** pose library */
  poses?: SavedPose[];
  /** font files added to this project */
  fonts?: FontFile[];
  created: number;
  modified: number;
}

export const MAX_SECONDS = 105;
