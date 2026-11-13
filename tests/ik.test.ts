import { test } from "node:test";
import assert from "node:assert/strict";
import { pull, elbowFor, bendOf, type P } from "../src/model/ik.ts";

const rot = (c: P, p: P, a: number): P => { const s = Math.sin(a), k = Math.cos(a), x = p[0] - c[0], y = p[1] - c[1]; return [c[0] + x * k - y * s, c[1] + x * s + y * k]; };
const near = (a: P, b: P, tol = 1e-3) => Math.hypot(a[0] - b[0], a[1] - b[1]) < tol;

test("one joint: the held point turns to face the pointer", () => {
  const { d1 } = pull([0, 0], null, [10, 0], [0, 5]);
  assert.ok(Math.abs(d1 - Math.PI / 2) < 1e-9);
});

test("two joints: the held point reaches a target in reach, and the elbow keeps its side", () => {
  const j1: P = [0, 0], j2: P = [10, 0], e0: P = [10, 10]; // bent elbow
  const t: P = [5, 12];
  const { d1, d2 } = pull(j1, j2, e0, t);
  // apply: upper part turns d1 round j1 (carrying the lower part), lower part turns d2 round the elbow
  const el = rot(j1, j2, d1), e1 = rot(j1, e0, d1), end = rot(el, e1, d2 - d1);
  assert.ok(near(end, t), String(end));
  assert.equal(bendOf(j1, el, end), bendOf(j1, j2, e0));
});

test("two joints: out of reach the arm points straight at the target", () => {
  const el = elbowFor([0, 0], 10, 10, [100, 0], 1);
  assert.ok(near(el, [10, 0], 1e-2), String(el));
});
