// Track (rails, sleepers, ballast), structures (viaducts, bridges, tunnels) and overhead line
// equipment, generated along the real track geometry in chunks.
import * as THREE from 'three';
import type { TrackPath } from '../dart/path';
import { chainlinkTexture, palisadeTexture, pbrMaterial, weldMeshTexture } from './textures';

export const CHUNK = 200;
const GAUGE_HALF = 0.8 + 0.036; // Irish gauge 1600 mm, measured to rail centres
const RAIL_H = 0.16;
const SLEEPER_SPACING = 0.65;
export const WIRE_HEIGHT = 4.9;

export interface TrackMaterials {
  railTop: THREE.Material; railSide: THREE.Material; sleeper: THREE.Material; ballast: THREE.Material;
  masonry: THREE.Material; steel: THREE.Material; mast: THREE.Material; wire: THREE.Material; tunnel: THREE.Material; concrete: THREE.Material;
  trough: THREE.Material; chainlink: THREE.Material; post: THREE.Material; insulator: THREE.Material; cabinet: THREE.Material;
  mesh: THREE.Material; palisade: THREE.Material; granite: THREE.Material; coping: THREE.Material;
}

export function makeTrackMaterials(): TrackMaterials {
  // UV conventions: sweep() writes metres * uScale; textures are tiled to their real-world size
  // (AmbientCG metadata in public/assets/textures/materials.json).
  return {
    railTop: new THREE.MeshStandardMaterial({ color: 0xd8dde2, metalness: 1, roughness: 0.22 }),
    railSide: pbrMaterial('rustmetal', 1, { color: 0x8a6a58, metal: false, roughness: 1 }),
    sleeper: pbrMaterial('concrete', 1, { color: 0xb8b4ac }),
    // ballast sweep uv = 0.5/m; Rocks006 is a 1 m tile -> 1.5 m stones read right
    ballast: pbrMaterial('ballast', 1.33, { color: 0xb4b0aa, normalStrength: 1.6, aoStrength: 1 }),
    masonry: pbrMaterial('stonewall', 2, { side: THREE.DoubleSide, color: 0xc8c2b8 }),
    steel: new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, color: 0x3f5560, roughness: 0.6, metalness: 0.6 }),
    mast: pbrMaterial('galvanised', 1, { color: 0xb8bec2, metal: true }),
    wire: new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 0.5, metalness: 0.8 }),
    tunnel: pbrMaterial('stonewall', 2, { color: 0x6f665c, side: THREE.DoubleSide }),
    concrete: pbrMaterial('concrete', 1, { color: 0xb4b0a8 }),
    trough: pbrMaterial('concrete', 1, { color: 0x9a978f }),
    chainlink: new THREE.MeshStandardMaterial({ map: chainlinkTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.6, color: 0xb8bcb8 }),
    post: pbrMaterial('galvanised', 1, { color: 0x6f7672, metal: true }),
    insulator: new THREE.MeshStandardMaterial({ color: 0x5a3b2a, roughness: 0.35 }),
    cabinet: pbrMaterial('galvanised', 1, { color: 0x7a8a7e, metal: true }),
    // boundary treatments seen along the line: dark green weld-mesh on open verges, tall grey
    // palisade in urban/industrial sections, granite rubble retaining and sea walls with a coping
    mesh: new THREE.MeshStandardMaterial({ map: weldMeshTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.55, metalness: 0.3, color: 0x2e4a38 }),
    palisade: new THREE.MeshStandardMaterial({ map: palisadeTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.6, color: 0x9aa2a4 }),
    granite: pbrMaterial('stonewall', 2, { color: 0xbab3a8, side: THREE.DoubleSide }),
    coping: pbrMaterial('concrete', 1, { color: 0xa8a49c }),
  };
}

/** Sweeps a 2-D profile (lateral, vertical) along the path between s0 and s1. */
function sweep(path: TrackPath, s0: number, s1: number, step: number, profile: [number, number][], origin: THREE.Vector3, uScale = 1, closed = false, vScaleByLen = true): THREE.BufferGeometry {
  const n = Math.max(2, Math.ceil((s1 - s0) / step) + 1);
  const m = profile.length;
  const pos = new Float32Array(n * m * 3), uv = new Float32Array(n * m * 2);
  const p = new THREE.Vector3(), r = new THREE.Vector3();
  // cumulative profile length for v
  const pl = [0];
  for (let k = 1; k < m; k++) pl.push(pl[k - 1] + Math.hypot(profile[k][0] - profile[k - 1][0], profile[k][1] - profile[k - 1][1]));
  for (let i = 0; i < n; i++) {
    const s = Math.min(s1, s0 + ((s1 - s0) * i) / (n - 1));
    path.point(s, p); path.right(s, r);
    for (let k = 0; k < m; k++) {
      const [lx, ly] = profile[k];
      const o = (i * m + k) * 3;
      pos[o] = p.x + r.x * lx - origin.x; pos[o + 1] = p.y + ly - origin.y; pos[o + 2] = p.z + r.z * lx - origin.z;
      uv[(i * m + k) * 2] = vScaleByLen ? pl[k] * uScale : k / (m - 1);
      uv[(i * m + k) * 2 + 1] = s * uScale;
    }
  }
  const idx: number[] = [];
  const segs = closed ? m : m - 1;
  for (let i = 0; i < n - 1; i++) for (let k = 0; k < segs; k++) {
    const k2 = (k + 1) % m;
    const a = i * m + k, b = i * m + k2, c = (i + 1) * m + k, d = (i + 1) * m + k2;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const unitBox = new THREE.BoxGeometry(1, 1, 1);
const sleeperGeo = new THREE.BoxGeometry(2.6, 0.2, 0.26);
sleeperGeo.translate(0, -RAIL_H - 0.1, 0);
const clipGeo = new THREE.BoxGeometry(0.16, 0.05, 0.1);

/** Ranges [s0,s1] within this chunk where this path owns the physical track. */
function ownedRanges(path: TrackPath, owner: Uint8Array, s0: number, s1: number): [number, number][] {
  const out: [number, number][] = [];
  let start: number | null = null;
  const i0 = Math.floor(s0 / path.step), i1 = Math.min(path.n - 1, Math.ceil(s1 / path.step));
  for (let i = i0; i <= i1; i++) {
    const own = owner[i] === 1;
    if (own && start == null) start = i * path.step;
    if ((!own || i === i1) && start != null) { const e = own ? i * path.step : (i - 1) * path.step; if (e - start > 1) out.push([Math.max(s0, start), Math.min(s1, e + (own ? 0 : path.step * 0.5))]); start = null; }
  }
  return out;
}

/** Lineside classes from public/data/dart/lineside.json (see scripts/data/lineside.mjs). */
export const LS = { OPEN: 0, BANK: 1, WALL: 2, SEA: 3, URBAN: 4, STATION: 5, STRUCT: 6, NONE: 7, CLIFF: 8 } as const;
export interface LinesidePath { L: string; R: string; hL: number[]; hR: number[]; adj: number[]; portal: string; noMast: string }
export interface LinesideData { step: number; paths: Record<string, LinesidePath> }
export interface TrackExtras { groundAt?: (x: number, z: number) => number; noFence?: [number, number][]; lineside?: LinesidePath; lsStep?: number }
const postGeo = new THREE.CylinderGeometry(0.035, 0.04, 1.9, 8); postGeo.translate(0, 0.95, 0);

export function buildTrackChunk(path: TrackPath, owner: Uint8Array, ci: number, M: TrackMaterials, detail: number, extras: TrackExtras = {}): THREE.Group | null {
  const s0 = ci * CHUNK, s1 = Math.min(path.length, (ci + 1) * CHUNK);
  if (s1 - s0 < 1) return null;
  const ranges = ownedRanges(path, owner, s0, s1);
  if (!ranges.length) return null;
  const g = new THREE.Group();
  const origin = path.point((s0 + s1) / 2);
  g.position.copy(origin);
  const p = new THREE.Vector3(), r = new THREE.Vector3(), t = new THREE.Vector3();
  const mat4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3();

  for (const [a, b] of ranges) {
    const st = path.structure((a + b) / 2);
    const onDeck = st && (st[2] === 'viaduct' || st[2] === 'bridge');
    // Rails: head (bright running surface) + web/foot (rusty)
    for (const side of [-1, 1]) {
      const c = side * GAUGE_HALF;
      g.add(new THREE.Mesh(sweep(path, a, b, 2.5, [[c - 0.036, -0.012], [c - 0.036, 0], [c + 0.036, 0], [c + 0.036, -0.012]], origin, 1, false), M.railTop));
      g.add(new THREE.Mesh(sweep(path, a, b, 2.5, [[c + 0.036, -0.012], [c + 0.036, -0.045], [c + 0.01, -0.05], [c + 0.009, -0.135], [c + 0.075, -0.15], [c + 0.075, -RAIL_H], [c - 0.075, -RAIL_H], [c - 0.075, -0.15], [c - 0.009, -0.135], [c - 0.01, -0.05], [c - 0.036, -0.045], [c - 0.036, -0.012]], origin, 1, false), M.railSide));
    }
    // Ballast bed
    const ballastProfile: [number, number][] = onDeck
      ? [[-1.8, -0.3], [1.8, -0.3]]
      : [[-2.75, -0.8], [-1.7, -0.26], [-1.3, -0.2], [1.3, -0.2], [1.7, -0.26], [2.75, -0.8]];
    const bg = sweep(path, a, b, 4, ballastProfile, origin, 0.5, false);
    const bm = new THREE.Mesh(bg, M.ballast); bm.receiveShadow = true; g.add(bm);
    // Sleepers + clips (instanced)
    const count = Math.floor((b - a) / SLEEPER_SPACING);
    const sl = new THREE.InstancedMesh(sleeperGeo, M.sleeper, count);
    const clips = detail > 0 ? new THREE.InstancedMesh(clipGeo, M.steel, count * 4) : null;
    let ci2 = 0;
    for (let k = 0; k < count; k++) {
      const s = a + (k + 0.5) * SLEEPER_SPACING;
      path.point(s, p); path.tangent(s, t);
      q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(t.x, 0, t.z).normalize());
      mat4.compose(p.sub(origin), q, sc.set(1, 1, 1));
      sl.setMatrixAt(k, mat4);
      if (clips) {
        path.right(s, r);
        for (const off of [-GAUGE_HALF - 0.1, -GAUGE_HALF + 0.1, GAUGE_HALF - 0.1, GAUGE_HALF + 0.1]) {
          path.point(s, p).addScaledVector(r, off).sub(origin); p.y -= RAIL_H - 0.02;
          mat4.compose(p, q, sc.set(1, 1, 1));
          clips.setMatrixAt(ci2++, mat4);
        }
      }
    }
    sl.receiveShadow = true;
    g.add(sl);
    if (clips) g.add(clips);
    // Lineside cable trough on the cess (outer side of this track) and the boundary fence.
    if (!onDeck && !(st && st[2] === 'tunnel')) {
      g.add(new THREE.Mesh(sweep(path, a, b, 4, [[-3.35, -0.78], [-3.35, -0.5], [-2.9, -0.5], [-2.9, -0.78]], origin, 1, false), M.trough));
      if (extras.groundAt) buildBoundaries(g, path, a, b, origin, M, extras);
    }

    // Structures
    if (st) {
      const [ss0, ss1, kind] = st;
      const x0 = Math.max(a, ss0), x1 = Math.min(b, ss1);
      if (x1 - x0 > 1) {
        if (kind === 'viaduct' || kind === 'bridge') {
          const deck = sweep(path, x0, x1, 4, [[2.6, -0.3], [2.6, -1.4], [-2.6, -1.4], [-2.6, -0.3]], origin, 0.25, false);
          g.add(new THREE.Mesh(deck, kind === 'viaduct' ? M.masonry : M.steel));
          for (const side of [-1, 1]) {
            const wall = sweep(path, x0, x1, 4, [[side * 2.6, -1.4], [side * 2.6, 1.0], [side * 2.9, 1.0], [side * 2.9, -1.4]], origin, 0.25, false);
            const wm = new THREE.Mesh(wall, kind === 'viaduct' ? M.masonry : M.steel); wm.castShadow = true; g.add(wm);
          }
          // skirt walls from the deck down to the ground (arched viaducts read as a continuous wall)
          if (kind === 'viaduct') {
            for (const side of [-1, 1]) {
              const n = Math.max(2, Math.ceil((x1 - x0) / 4) + 1);
              const pos = new Float32Array(n * 2 * 3), uv = new Float32Array(n * 2 * 2), idx: number[] = [];
              for (let i = 0; i < n; i++) {
                const s = x0 + ((x1 - x0) * i) / (n - 1);
                path.offsetPoint(s, side * 2.6, -1.4, p);
                const ground = (path.data.ground[Math.round(s / path.step)] ?? p.y - 8) - 1.5;
                pos.set([p.x - origin.x, p.y - origin.y, p.z - origin.z, p.x - origin.x, ground - origin.y, p.z - origin.z], i * 6);
                uv.set([s * 0.25, p.y * 0.25, s * 0.25, ground * 0.25], i * 4);
                if (i) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
              }
              const sg = new THREE.BufferGeometry();
              sg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); sg.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); sg.setIndex(idx); sg.computeVertexNormals();
              const sm = new THREE.Mesh(sg, M.masonry); sm.castShadow = true; g.add(sm);
            }
          }
        } else if (kind === 'tunnel' && ss1 - ss0 > 40) {
          // Horseshoe-profile tube, wide enough for double track
          const prof: [number, number][] = [];
          for (let k = 0; k <= 16; k++) { const ang = Math.PI * (k / 16); prof.push([Math.cos(ang) * 4.4 + 0, Math.sin(ang) * 4.2 + 2.0]); }
          prof.unshift([4.4, -0.8]); prof.push([-4.4, -0.8]);
          const tube = new THREE.Mesh(sweep(path, x0, x1, 3, prof, origin, 0.3, false), M.tunnel);
          g.add(tube);
          // Portals
          for (const ps of [ss0, ss1]) {
            if (ps < a - 0.1 || ps > b + 0.1) continue;
            path.point(ps, p); path.tangent(ps, t);
            const shape = new THREE.Shape();
            shape.moveTo(-9, -1); shape.lineTo(9, -1); shape.lineTo(9, 10); shape.lineTo(-9, 10); shape.lineTo(-9, -1);
            const hole = new THREE.Path();
            hole.moveTo(-4.4, -0.8);
            hole.lineTo(-4.4, 2.0);
            hole.absarc(0, 2.0, 4.4, Math.PI, 0, true);
            hole.lineTo(4.4, -0.8);
            hole.lineTo(-4.4, -0.8);
            shape.holes.push(hole);
            const pg = new THREE.ExtrudeGeometry(shape, { depth: 1.2, bevelEnabled: false });
            pg.translate(0, 0, -0.6);
            const pm = new THREE.Mesh(pg, M.masonry);
            pm.position.set(p.x - origin.x, p.y - origin.y, p.z - origin.z);
            pm.rotation.y = Math.atan2(t.x, t.z);
            pm.castShadow = true;
            g.add(pm);
          }
        }
      }
    }
  }
  g.traverse((o) => { o.matrixAutoUpdate = false; o.updateMatrix(); });
  g.updateMatrix();
  return g;
}

/** Boundary on each side of the line, by lineside class: fence, palisade, retaining wall or sea wall. */
function buildBoundaries(g: THREE.Group, path: TrackPath, a: number, b: number, origin: THREE.Vector3, M: TrackMaterials, extras: TrackExtras) {
  const ls = extras.lineside, step = extras.lsStep ?? 25, groundAt = extras.groundAt!;
  const codeAt = (side: number, s: number): number => {
    if (!ls) return side < 0 ? LS.OPEN : LS.NONE;
    const j = Math.max(0, Math.min(ls.L.length - 1, Math.round(s / step)));
    return (side < 0 ? ls.L : ls.R).charCodeAt(j) - 48;
  };
  const wallH = (side: number, s: number): number => {
    if (!ls) return 3;
    const j = Math.max(0, Math.min(ls.L.length - 1, Math.round(s / step)));
    return ((side < 0 ? ls.hL : ls.hR)[j] ?? 30) / 10;
  };
  const blocked = (s: number) => (extras.noFence ?? []).some(([x0, x1]) => s > x0 && s < x1) || !!path.structure(s);
  // [lateral, height or null for wall height, material, ground-following?]
  const style: Record<number, { lat: number; h: number | null; mat: THREE.Material; follow: boolean; thick: number }> = {
    [LS.OPEN]: { lat: 4.9, h: 1.9, mat: M.mesh, follow: true, thick: 0 },
    [LS.URBAN]: { lat: 4.6, h: 2.4, mat: M.palisade, follow: true, thick: 0 },
    [LS.WALL]: { lat: 4.1, h: null, mat: M.granite, follow: false, thick: 0.55 },
    [LS.SEA]: { lat: 4.0, h: 1.15, mat: M.granite, follow: false, thick: 0.6 },
  };
  const p = new THREE.Vector3(), t = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1);
  for (const side of [-1, 1]) {
    // runs of identical class
    const runs: [number, number, number][] = [];
    let r0 = a, rc = -1;
    for (let s = a; s <= b + 0.01; s += 5) {
      const c = blocked(s) ? -2 : codeAt(side, s);
      if (c !== rc) { if (rc >= 0 && s - r0 > 4) runs.push([r0, s, rc]); r0 = s; rc = c; }
    }
    if (rc >= 0 && b - r0 > 4) runs.push([r0, b, rc]);
    const posts: THREE.Matrix4[] = [];
    for (const [f0, f1, code] of runs) {
      const st = style[code]; if (!st) continue;
      const n = Math.max(2, Math.ceil((f1 - f0) / 2.5) + 1);
      const lat = side * st.lat;
      const faces = st.thick ? 3 : 1; // walls: front, back and top; fences: one double-sided sheet
      const pos = new Float32Array(n * 2 * 3 * faces), uv = new Float32Array(n * 2 * 2 * faces), idx: number[] = [];
      for (let i = 0; i < n; i++) {
        const s = f0 + ((f1 - f0) * i) / (n - 1);
        path.offsetPoint(s, lat, 0, p);
        const railY = p.y;
        const base = st.follow ? groundAt(p.x, p.z) : railY - 1.2;
        const top = st.h != null ? (st.follow ? base + st.h : railY - 0.6 + st.h) : railY - 0.8 + wallH(side, s);
        const r = path.right(s, t);
        const ox = r.x * side * st.thick, oz = r.z * side * st.thick;
        const put = (f: number, k: number, x: number, y: number, z: number, u: number, v: number) => {
          const o = (f * n * 2 + i * 2 + k);
          pos.set([x - origin.x, y - origin.y, z - origin.z], o * 3); uv.set([u, v], o * 2);
        };
        const u = s / (st.thick ? 2 : 2);
        put(0, 0, p.x, base, p.z, u, 0); put(0, 1, p.x, top, p.z, u, (top - base) / (st.follow ? 1.9 : 2));
        if (faces === 3) {
          put(1, 0, p.x + ox, base, p.z + oz, u, 0); put(1, 1, p.x + ox, top, p.z + oz, u, (top - base) / 2);
          put(2, 0, p.x, top, p.z, u, 0); put(2, 1, p.x + ox, top, p.z + oz, u, st.thick / 2);
        }
        if (i) for (let f = 0; f < faces; f++) {
          const k = f * n * 2 + (i - 1) * 2;
          // wind so the face toward the track is front-facing
          if ((side < 0) !== (f === 1)) idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); else idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
        }
        if (st.follow && i < n - 1) { path.tangent(s, t); q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(t.x, t.z)); posts.push(new THREE.Matrix4().compose(new THREE.Vector3(p.x - origin.x, base - origin.y, p.z - origin.z), q, sc.set(1, (st.h ?? 1.9) / 1.9, 1))); }
      }
      const fg = new THREE.BufferGeometry();
      fg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); fg.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); fg.setIndex(idx); fg.computeVertexNormals();
      const mesh = new THREE.Mesh(fg, st.mat); mesh.castShadow = !!st.thick; mesh.receiveShadow = true; g.add(mesh);
    }
    if (posts.length) { const pm = new THREE.InstancedMesh(postGeo, M.post, posts.length); posts.forEach((m, i) => pm.setMatrixAt(i, m)); pm.castShadow = true; g.add(pm); }
  }
}

/** Overhead line: masts, cantilevers, contact + catenary wires, droppers. */
export function buildOleChunk(path: TrackPath, owner: Uint8Array, ci: number, M: TrackMaterials, ls?: { data: LinesidePath; step: number }): THREE.Group | null {
  const s0 = ci * CHUNK, s1 = Math.min(path.length, (ci + 1) * CHUNK);
  const ranges = ownedRanges(path, owner, s0, s1);
  if (!ranges.length) return null;
  const g = new THREE.Group();
  const origin = path.point((s0 + s1) / 2);
  g.position.copy(origin);
  const SPAN = 50;
  const p = new THREE.Vector3(), r = new THREE.Vector3(), t = new THREE.Vector3();
  const wires: THREE.Matrix4[] = [];
  const masts: THREE.Matrix4[] = [], arms: THREE.Matrix4[] = [], plinths: THREE.Matrix4[] = [], insul: THREE.Matrix4[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  const segment = (a: THREE.Vector3, b: THREE.Vector3, thick: number, list: THREE.Matrix4[]) => {
    const d = new THREE.Vector3().subVectors(b, a); const L = d.length();
    if (L < 0.01) return;
    const qq = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), d.normalize());
    list.push(new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), qq, new THREE.Vector3(thick, thick, L)));
  };
  const local = (s: number, lat: number, h: number) => path.offsetPoint(s, lat, h).sub(origin);
  for (const [a, b] of ranges) {
    const first = Math.ceil(a / SPAN) * SPAN;
    for (let s = first; s <= b; s += SPAN) {
      const inTun = path.inTunnel(s);
      const k = Math.round(s / SPAN);
      const stagger = (k % 2 ? 1 : -1) * 0.2;
      const sN = s + SPAN;
      const staggerN = -stagger;
      const pyNow = path.point(s, p).y;
      // lineside: portal gantry over both tracks (urban double track), or no mast of our own
      const j = ls ? Math.max(0, Math.min(ls.data.L.length - 1, Math.round(s / ls.step))) : -1;
      const noMast = !!ls && ls.data.noMast[j] === '1';
      const adj = ls ? ls.data.adj[j] / 10 : 0;
      const portal = !!ls && ls.data.portal[j] === '1' && Math.abs(adj) > 2.5;
      // mast + cantilever
      if (!inTun && !noMast) {
        path.point(s, p); path.right(s, r); path.tangent(s, t);
        const yaw = Math.atan2(t.x, t.z);
        const rot = new THREE.Quaternion().setFromAxisAngle(up, yaw);
        // H-section mast: two flanges and a web, on a concrete plinth
        const mast = (lat: number) => {
          const base = local(s, lat, -0.8);
          const fl = new THREE.Vector3(0.24, 8.3, 0.02);
          for (const dz of [-0.13, 0.13]) masts.push(new THREE.Matrix4().compose(base.clone().add(new THREE.Vector3(Math.cos(yaw) * dz, 4.15, -Math.sin(yaw) * dz)), rot, fl));
          masts.push(new THREE.Matrix4().compose(base.clone().add(new THREE.Vector3(0, 4.15, 0)), rot, new THREE.Vector3(0.02, 8.3, 0.24)));
          plinths.push(new THREE.Matrix4().compose(base.clone().add(new THREE.Vector3(0, 0.2, 0)), rot, new THREE.Vector3(0.55, 0.5, 0.55)));
        };
        mast(-3.3);
        if (portal) {
          // portal: second mast beyond the other track, a box girder across, and a drop tube with
          // a registration arm over each track
          const far = adj + Math.sign(adj) * 3.3;
          mast(far);
          segment(local(s, -3.42, 7.2), local(s, far + Math.sign(far) * 0.12, 7.2), 0.42, masts);
          for (const [tl, sg] of [[0, stagger], [adj, -stagger]] as const) {
            const x = tl + sg + 0.35;
            segment(local(s, x, 7.0), local(s, x, 4.95), 0.07, arms);
            segment(local(s, tl + sg, WIRE_HEIGHT), local(s, x, 5.05), 0.03, arms);
            insul.push(new THREE.Matrix4().compose(local(s, x, 6.65), rot, new THREE.Vector3(0.09, 0.28, 0.09)));
          }
        } else {
          // insulators at the mast end of each arm and at the registration point
          for (const [lat, h] of [[-2.9, 6.3], [-2.9, 5.0], [stagger + 0.45, 5.05]] as const) insul.push(new THREE.Matrix4().compose(local(s, lat, h), rot, new THREE.Vector3(0.09, 0.09, 0.28)));
          // cantilever tube (upper) and registration arm (lower)
          segment(local(s, -3.2, 6.3), local(s, stagger + 0.4, 6.3), 0.07, arms);
          segment(local(s, -3.2, 5.0), local(s, stagger + 0.6, 5.05), 0.06, arms);
          segment(local(s, -3.2, 5.0), local(s, -1.2, 6.3), 0.05, arms);
          segment(local(s, stagger, WIRE_HEIGHT), local(s, stagger + 0.6, 5.05), 0.03, arms);
        }
      }
      void pyNow;
      if (sN > path.length) continue;
      // contact wire (straight between registrations, zig-zag stagger)
      const ca = local(s, stagger, WIRE_HEIGHT), cb = local(sN, staggerN, WIRE_HEIGHT);
      // follow curvature: split the span in 5 parts
      const parts = 5;
      let prev = ca;
      for (let k2 = 1; k2 <= parts; k2++) {
        const f = k2 / parts;
        const ss = s + SPAN * f;
        const lat = stagger + (staggerN - stagger) * f;
        const cur = k2 === parts ? cb : local(ss, lat, WIRE_HEIGHT);
        segment(prev, cur, 0.014, wires);
        // catenary wire with sag
        const sag = 4 * f * (1 - f) * 1.05;
        const fp = (k2 - 1) / parts, sagp = 4 * fp * (1 - fp) * 1.05;
        const m0 = local(s + SPAN * fp, stagger + (staggerN - stagger) * fp, WIRE_HEIGHT + 1.3 - sagp);
        const m1 = local(ss, lat, WIRE_HEIGHT + 1.3 - sag);
        segment(m0, m1, 0.012, wires);
        // dropper
        if (k2 < parts) segment(local(ss, lat, WIRE_HEIGHT), m1, 0.006, wires);
        prev = cur;
      }
    }
  }
  const inst = (list: THREE.Matrix4[], mat: THREE.Material, castShadow: boolean) => {
    if (!list.length) return;
    const im = new THREE.InstancedMesh(unitBox, mat, list.length);
    list.forEach((m, i) => im.setMatrixAt(i, m));
    im.castShadow = castShadow;
    g.add(im);
  };
  inst(masts, M.mast, true);
  inst(arms, M.mast, true);
  inst(wires, M.wire, false);
  inst(plinths, M.concrete, true);
  inst(insul, M.insulator, false);
  g.traverse((o) => { o.matrixAutoUpdate = false; o.updateMatrix(); });
  return g;
}
