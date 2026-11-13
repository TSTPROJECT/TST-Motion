// Posing by pulling a part: the parts above it turn so the point you hold follows the pointer
// ("inverse kinematics"). Pure maths, no screen code, so it can be tested.

export type P = [number, number];

/** Angle (radians) of the line from a to b. */
export const angle = (a: P, b: P) => Math.atan2(b[1] - a[1], b[0] - a[0]);
/** An angle difference brought into -π..π, so a turn never jumps the long way round. */
export const wrap = (a: number) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
/** Which way the chain bends at the middle joint: 1, -1, or 0 when straight. */
export function bendOf(j1: P, j2: P, e: P) {
  const c = (j2[0] - j1[0]) * (e[1] - j2[1]) - (j2[1] - j1[1]) * (e[0] - j2[0]);
  return Math.abs(c) < 1e-9 ? 0 : Math.sign(c);
}

/**
 * Two joints in a row (shoulder j1, elbow; the held point is `l2` past the elbow, the elbow is `l1` past
 * the shoulder). Where the elbow goes so the held point reaches `t`, bending the same way (`bend`) as
 * before. Out of reach: the arm points straight at `t`.
 */
export function elbowFor(j1: P, l1: number, l2: number, t: P, bend: number): P {
  let dx = t[0] - j1[0], dy = t[1] - j1[1], d = Math.hypot(dx, dy);
  if (d < 1e-9) { dx = 1; dy = 0; d = 1; }
  const ux = dx / d, uy = dy / d;
  const dc = Math.min(Math.max(d, Math.abs(l1 - l2) + 1e-6), l1 + l2 - 1e-6);
  const a = (l1 * l1 - l2 * l2 + dc * dc) / (2 * dc), h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const bx = j1[0] + ux * a, by = j1[1] + uy * a;
  const c1: P = [bx - uy * h, by + ux * h], c2: P = [bx + uy * h, by - ux * h];
  const end: P = [j1[0] + ux * dc, j1[1] + uy * dc];
  return bend === 0 || bendOf(j1, c1, end) === bend ? c1 : c2;
}

/**
 * New turns (radians, on screen) for a chain held at point `e0`, pulled to `t`.
 * One joint (`j2` null): the part turns round `j1`. Two joints: the upper part turns round `j1`, the
 * lower round `j2`. Returns how much each part's own direction changes on screen.
 */
export function pull(j1: P, j2: P | null, e0: P, t: P): { d1: number; d2: number } {
  if (!j2) return { d1: wrap(angle(j1, t) - angle(j1, e0)), d2: 0 };
  const l1 = Math.hypot(j2[0] - j1[0], j2[1] - j1[1]), l2 = Math.hypot(e0[0] - j2[0], e0[1] - j2[1]);
  if (l1 < 1 || l2 < 1) {
    // held right on a joint: just turn the part that was held
    const k = l2 < 1 ? j1 : j2;
    return l2 < 1 ? { d1: wrap(angle(k, t) - angle(k, e0)), d2: 0 } : { d1: 0, d2: wrap(angle(j2, t) - angle(j2, e0)) };
  }
  const el = elbowFor(j1, l1, l2, t, bendOf(j1, j2, e0));
  return { d1: wrap(angle(j1, el) - angle(j1, j2)), d2: wrap(angle(el, t) - angle(j2, e0)) };
}
