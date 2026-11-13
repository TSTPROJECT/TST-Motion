// Lip sync: from loudness per frame to a mouth shape per frame (no browser needed, so it can be tested).
/** Which mouth to show per frame: 0 closed, 1 half, 2 open (-1 = outside the sound). `sens` 0..1: higher opens more easily. */
export function mouthPlan(loud: Float32Array, sens = 0.5): Int8Array {
  const lo = 0.32 - sens * 0.24, hi = lo + 0.3 - sens * 0.1;
  const out = new Int8Array(loud.length);
  let cur = 0, held = 0;
  for (let f = 0; f < loud.length; f++) {
    if (loud[f] < 0) { out[f] = -1; cur = 0; held = 0; continue; }
    const want = loud[f] < lo ? 0 : loud[f] < hi ? 1 : 2;
    // a mouth shape stays at least 2 frames, so it does not flicker
    if (want !== cur && held >= 2) { cur = want; held = 0; }
    held++; out[f] = cur;
  }
  return out;
}
