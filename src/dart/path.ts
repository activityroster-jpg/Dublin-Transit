import * as THREE from 'three';
import type { PathData, Structure } from './data';

export interface PathSample { pos: THREE.Vector3; tangent: THREE.Vector3; right: THREE.Vector3; grade: number; curvature: number }

/** One driveable track (a direction + branch) with chainage-based sampling. */
export class TrackPath {
  readonly id: string;
  readonly data: PathData;
  readonly step: number;
  readonly length: number;
  readonly n: number;
  readonly pts: Float32Array;

  constructor(data: PathData) {
    this.data = data;
    this.id = data.id;
    this.step = data.step;
    this.pts = Float32Array.from(data.pts);
    this.n = this.pts.length / 3;
    this.length = (this.n - 1) * this.step;
  }

  get northbound() { return this.id.startsWith('greystones'); }

  private idx(s: number): [number, number] {
    const f = Math.max(0, Math.min(this.n - 1.0001, s / this.step));
    const i = Math.floor(f);
    return [i, f - i];
  }
  point(s: number, out = new THREE.Vector3()): THREE.Vector3 {
    const [i, t] = this.idx(s), p = this.pts, a = i * 3, b = a + 3;
    return out.set(p[a] + (p[b] - p[a]) * t, p[a + 1] + (p[b + 1] - p[a + 1]) * t, p[a + 2] + (p[b + 2] - p[a + 2]) * t);
  }
  /** Unit tangent, smoothly interpolated (central differences). */
  tangent(s: number, out = new THREE.Vector3()): THREE.Vector3 {
    const h = this.step;
    const a = this.point(Math.max(0, s - h), _a), b = this.point(Math.min(this.length, s + h), _b);
    return out.subVectors(b, a).normalize();
  }
  /** Horizontal right vector (y-up world). */
  right(s: number, out = new THREE.Vector3()): THREE.Vector3 {
    const t = this.tangent(s, _t);
    return out.set(-t.z, 0, t.x).normalize();
  }
  heading(s: number): number { const t = this.tangent(s, _t); return Math.atan2(t.x, t.z); }
  grade(s: number): number {
    const a = this.point(Math.max(0, s - 20), _a), b = this.point(Math.min(this.length, s + 20), _b);
    const d = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    return (b.y - a.y) / d;
  }
  /** Signed curvature 1/R (positive = curving right). */
  curvature(s: number): number {
    const h = 25;
    const t0 = this.tangent(Math.max(0, s - h), _a), t1 = this.tangent(Math.min(this.length, s + h), _b);
    const cross = t0.x * t1.z - t0.z * t1.x;
    return -cross / (2 * h);
  }
  /** Lateral offset point: positive = right of direction of travel. */
  offsetPoint(s: number, lateral: number, up = 0, out = new THREE.Vector3()): THREE.Vector3 {
    this.point(s, out);
    const r = this.right(s, _r);
    return out.set(out.x + r.x * lateral, out.y + up, out.z + r.z * lateral);
  }
  speedLimit(s: number): number {
    const sp = this.data.speed;
    let v = sp[0][1];
    for (const [s0, kmh] of sp) { if (s0 > s) break; v = kmh; }
    return v;
  }
  /** Next speed change ahead (for the cab display). */
  nextSpeedChange(s: number): { s: number; kmh: number } | null {
    for (const [s0, kmh] of this.data.speed) if (s0 > s) return { s: s0, kmh };
    return null;
  }
  structure(s: number): Structure | null {
    for (const st of this.data.structures) if (s >= st[0] && s <= st[1]) return st;
    return null;
  }
  inTunnel(s: number): boolean { const st = this.structure(s); return !!st && st[2] === 'tunnel' && st[1] - st[0] > 40; }
  stationIndexByGtfs(gtfs: string): number { return this.data.stations.findIndex((st) => st.gtfs === gtfs); }

  /** Nearest chainage to a world point (coarse scan + refine). */
  project(x: number, z: number, hintS?: number, window = 600): { s: number; d: number } {
    const p = this.pts;
    let lo = 0, hi = this.n - 2;
    if (hintS != null) { lo = Math.max(0, Math.floor((hintS - window) / this.step)); hi = Math.min(this.n - 2, Math.ceil((hintS + window) / this.step)); }
    let best = Infinity, bs = 0;
    for (let i = lo; i <= hi; i++) {
      const ax = p[i * 3], az = p[i * 3 + 2], bx = p[i * 3 + 3], bz = p[i * 3 + 5];
      const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1;
      let t = ((x - ax) * dx + (z - az) * dz) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = ax + dx * t - x, qz = az + dz * t - z, d = qx * qx + qz * qz;
      if (d < best) { best = d; bs = (i + t) * this.step; }
    }
    return { s: bs, d: Math.sqrt(best) };
  }
}
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _t = new THREE.Vector3(), _r = new THREE.Vector3();

/** The four DART paths, with knowledge of which samples duplicate an earlier path (shared track). */
export class Network {
  readonly paths: TrackPath[];
  /** For each path: per-sample flag "this sample is the first rendering of this physical track". */
  readonly owner: Map<string, Uint8Array> = new Map();

  constructor(paths: PathData[]) {
    this.paths = paths.map((p) => new TrackPath(p));
    const cell = 8;
    const grid = new Map<number, [number, number][]>();
    const key = (x: number, z: number) => Math.floor(x / cell) * 73856093 ^ Math.floor(z / cell) * 19349663;
    for (const path of this.paths) {
      const own = new Uint8Array(path.n);
      for (let i = 0; i < path.n; i++) {
        const x = path.pts[i * 3], z = path.pts[i * 3 + 2];
        let dup = false;
        for (let a = -1; a <= 1 && !dup; a++) for (let b = -1; b <= 1 && !dup; b++) {
          const list = grid.get(key(x + a * cell, z + b * cell));
          if (list) for (const q of list) if ((q[0] - x) ** 2 + (q[1] - z) ** 2 < 0.8 * 0.8) { dup = true; break; }
        }
        own[i] = dup ? 0 : 1;
      }
      for (let i = 0; i < path.n; i++) {
        const x = path.pts[i * 3], z = path.pts[i * 3 + 2], k = key(x, z);
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k)!.push([x, z]);
      }
      this.owner.set(path.id, own);
    }
  }
  get(id: string): TrackPath { const p = this.paths.find((q) => q.id === id); if (!p) throw new Error(`no path ${id}`); return p; }
}
