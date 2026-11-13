// The saved shape of a TST Motion project. Times are whole frames.

export type Ease = "smooth" | "linear" | "in" | "out" | "back" | "hold";
export type Prop = "x" | "y" | "rot" | "sx" | "sy" | "o";
export const PROPS: Prop[] = ["x", "y", "rot", "sx", "sy", "o"];

export interface Key {
  /** frame number */
  f: number;
  /** value */
  v: number;
  /** how the value travels from this key to the next one */
  e: Ease;
}

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
  base: Record<Prop, number>;
  tracks: Partial<Record<Prop, Key[]>>;
  visible: boolean;
  locked: boolean;
  /**
   * Soft joint: how far (image pixels) round the pivot the picture bends instead of turning stiffly.
   * Near the joint it stays with the part it follows, further out it turns with this part. 0 or missing = stiff.
   */
  bend?: number;
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
  created: number;
  modified: number;
}

export const MAX_SECONDS = 105;
