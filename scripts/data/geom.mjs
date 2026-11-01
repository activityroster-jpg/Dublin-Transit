// Small 2-D geometry helpers for the pipeline.
export function pointInRing(x, z, ring) {
  // ring: flat [x0,z0,x1,z1,...]
  let inside = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const xi = ring[i], zi = ring[i + 1], xj = ring[j], zj = ring[j + 1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
export function ringBBox(r) {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (let i = 0; i < r.length; i += 2) { a = Math.min(a, r[i]); b = Math.min(b, r[i + 1]); c = Math.max(c, r[i]); d = Math.max(d, r[i + 1]); }
  return [a, b, c, d];
}
export function ringArea(r) {
  let s = 0;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) s += (r[j] - r[i]) * (r[j + 1] + r[i + 1]);
  return s / 2;
}
/** Join open ways (arrays of node ids) into closed rings. */
export function joinRings(wayNodeLists) {
  const segs = wayNodeLists.map((w) => w.slice());
  const rings = [];
  while (segs.length) {
    let cur = segs.shift();
    let guard = 0;
    while (cur[0] !== cur[cur.length - 1] && guard++ < 1000) {
      const end = cur[cur.length - 1];
      const k = segs.findIndex((s) => s[0] === end || s[s.length - 1] === end);
      if (k < 0) break;
      const s = segs.splice(k, 1)[0];
      cur = cur.concat(s[0] === end ? s.slice(1) : s.reverse().slice(1));
    }
    if (cur[0] === cur[cur.length - 1] && cur.length >= 4) rings.push(cur);
  }
  return rings;
}
/** Uniform grid spatial hash over segments. */
export class SegHash {
  constructor(cell) { this.cell = cell; this.map = new Map(); this.segs = []; }
  key(ix, iz) { return ix * 100003 + iz; }
  add(ax, az, bx, bz, data) {
    const id = this.segs.length;
    this.segs.push({ ax, az, bx, bz, data });
    const c = this.cell;
    for (let ix = Math.floor(Math.min(ax, bx) / c); ix <= Math.floor(Math.max(ax, bx) / c); ix++)
      for (let iz = Math.floor(Math.min(az, bz) / c); iz <= Math.floor(Math.max(az, bz) / c); iz++) {
        const k = this.key(ix, iz);
        if (!this.map.has(k)) this.map.set(k, []);
        this.map.get(k).push(id);
      }
  }
  /** Nearest segment within radius; returns {d, t, seg, side(+1 right of a->b)} or null. */
  nearest(x, z, radius) {
    const c = this.cell, r = Math.ceil(radius / c);
    const cx = Math.floor(x / c), cz = Math.floor(z / c);
    let best = null;
    const seen = new Set();
    for (let ix = cx - r; ix <= cx + r; ix++) for (let iz = cz - r; iz <= cz + r; iz++) {
      const list = this.map.get(this.key(ix, iz));
      if (!list) continue;
      for (const id of list) {
        if (seen.has(id)) continue; seen.add(id);
        const s = this.segs[id];
        const dx = s.bx - s.ax, dz = s.bz - s.az, L2 = dx * dx + dz * dz || 1e-9;
        let t = ((x - s.ax) * dx + (z - s.az) * dz) / L2; t = Math.max(0, Math.min(1, t));
        const px = s.ax + dx * t, pz = s.az + dz * t, d = Math.hypot(x - px, z - pz);
        if (d <= radius && (!best || d < best.d)) {
          const cross = dx * (z - s.az) - dz * (x - s.ax);
          best = { d, t, seg: s, side: cross > 0 ? 1 : -1 };
        }
      }
    }
    return best;
  }
}
/** Deterministic PRNG. */
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
