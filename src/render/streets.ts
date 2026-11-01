// Roads (draped ribbons, road bridges with decks and parapets), walls/fences/hedges, street lamps.
import * as THREE from 'three';
import type { SceneryTile } from '../dart/data';
import { fenceTexture, tex } from './textures';
import { instance, loadModel, placement } from './models';

let mats: Record<string, THREE.Material> | null = null;
export const lampUniforms = { night: 0 };
export function streetMaterials() {
  if (mats) return mats;
  const asphalt = new THREE.MeshStandardMaterial({ map: tex('asphalt_diff', 1), normalMap: tex('asphalt_nor_gl', 1, false), roughness: 0.92, color: 0x9a9a9a, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  const footway = new THREE.MeshStandardMaterial({ map: tex('platform_diff', 1), roughness: 0.9, color: 0xc9c4ba, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  const marking = new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8, transparent: true });
  const fence = new THREE.MeshStandardMaterial({ map: fenceTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.4 });
  const wall = new THREE.MeshStandardMaterial({ map: tex('stonewall_diff', 1), normalMap: tex('stonewall_nor_gl', 1, false), roughness: 0.95, side: THREE.DoubleSide });
  const brickwall = new THREE.MeshStandardMaterial({ map: tex('brick_diff', 1), normalMap: tex('brick_nor_gl', 1, false), roughness: 0.95, side: THREE.DoubleSide });
  const hedge = new THREE.MeshStandardMaterial({ color: 0x2f4a22, roughness: 1, map: tex('terrain_forest_diff', 1) });
  const concrete = new THREE.MeshStandardMaterial({ map: tex('concrete_diff', 1), roughness: 0.9, side: THREE.DoubleSide });
  const kerb = new THREE.MeshStandardMaterial({ color: 0xb9b6ae, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 });
  const lampPole = new THREE.MeshStandardMaterial({ color: 0x3b3f42, roughness: 0.5, metalness: 0.6 });
  const lampHead = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: new THREE.Color(1, 0.75, 0.45), emissiveIntensity: 0 });
  mats = { asphalt, footway, marking, fence, wall, brickwall, hedge, concrete, lampPole, lampHead, kerb };
  return mats;
}

const FOOT = new Set(['footway', 'cycleway', 'path', 'steps', 'pedestrian', 'track']);
const MAJOR = new Set(['primary', 'secondary', 'tertiary', 'trunk', 'motorway']);

function ribbon(pts: number[], width: number, origin: THREE.Vector3, lift: number, pos: number[], uv: number[], idx: number[]) {
  const n = pts.length / 3;
  if (n < 2) return;
  const base = pos.length / 3;
  let along = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
    let dx = pts[b * 3] - pts[a * 3], dz = pts[b * 3 + 1] - pts[a * 3 + 1];
    const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
    if (i > 0) along += Math.hypot(pts[i * 3] - pts[i * 3 - 3], pts[i * 3 + 1] - pts[i * 3 - 2]);
    const x = pts[i * 3] - origin.x, z = pts[i * 3 + 1] - origin.z, y = pts[i * 3 + 2] - origin.y + lift;
    const rx = -dz * width / 2, rz = dx * width / 2;
    pos.push(x - rx, y, z - rz, x + rx, y, z + rz);
    uv.push(0, along / 4, width / 4, along / 4);
    if (i < n - 1) { const k = base + i * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
  }
}

function wallStrip(pts: number[], h: number, thick: number, origin: THREE.Vector3, pos: number[], uv: number[], idx: number[]) {
  const n = pts.length / 3;
  let along = 0;
  for (let i = 0; i < n - 1; i++) {
    const ax = pts[i * 3] - origin.x, az = pts[i * 3 + 1] - origin.z, ay = pts[i * 3 + 2] - origin.y;
    const bx = pts[i * 3 + 3] - origin.x, bz = pts[i * 3 + 4] - origin.z, by = pts[i * 3 + 5] - origin.y;
    const L = Math.hypot(bx - ax, bz - az); if (L < 0.01) continue;
    const base = pos.length / 3;
    const ox = (-(bz - az) / L) * thick / 2, oz = ((bx - ax) / L) * thick / 2;
    // two faces + top
    pos.push(ax + ox, ay - 0.5, az + oz, bx + ox, by - 0.5, bz + oz, bx + ox, by + h, bz + oz, ax + ox, ay + h, az + oz);
    pos.push(ax - ox, ay - 0.5, az - oz, bx - ox, by - 0.5, bz - oz, bx - ox, by + h, bz - oz, ax - ox, ay + h, az - oz);
    uv.push(along / 2, 0, (along + L) / 2, 0, (along + L) / 2, (h + 0.5) / 2, along / 2, (h + 0.5) / 2);
    uv.push(along / 2, 0, (along + L) / 2, 0, (along + L) / 2, (h + 0.5) / 2, along / 2, (h + 0.5) / 2);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3, base + 4, base + 6, base + 5, base + 4, base + 7, base + 6);
    if (thick > 0.05) { pos.push(ax + ox, ay + h, az + oz, bx + ox, by + h, bz + oz, bx - ox, by + h, bz - oz, ax - ox, ay + h, az - oz); uv.push(0, 0, L / 2, 0, L / 2, 0.15, 0, 0.15); const t = base + 8; idx.push(t, t + 2, t + 1, t, t + 3, t + 2); }
    along += L;
  }
}

function mesh(pos: number[], uv: number[], idx: number[], mat: THREE.Material, shadow = false): THREE.Mesh | null {
  if (!pos.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat);
  m.receiveShadow = true; m.castShadow = shadow;
  return m;
}

const poleGeo = new THREE.CylinderGeometry(0.06, 0.09, 8, 6); poleGeo.translate(0, 4, 0);
const headGeo = new THREE.BoxGeometry(0.3, 0.14, 0.5); headGeo.translate(0, 6.1, 0.35);

export function buildStreets(tile: SceneryTile, origin: THREE.Vector3): THREE.Group {
  const M = streetMaterials();
  const g = new THREE.Group();
  const A = { p: [] as number[], u: [] as number[], i: [] as number[] }, F = { p: [] as number[], u: [] as number[], i: [] as number[] }, K = { p: [] as number[], u: [] as number[], i: [] as number[] };
  const deck = { p: [] as number[], u: [] as number[], i: [] as number[] };
  const K2 = { p: [] as number[], u: [] as number[], i: [] as number[] };
  for (const [pts, width, kind, bridge] of tile.r) {
    const T = FOOT.has(kind) ? F : A;
    ribbon(pts, width, origin, bridge ? 0.05 : 0, T.p, T.u, T.i);
    if (!FOOT.has(kind) && kind !== 'service' && kind !== 'track' && !bridge) {
      // kerbs: a raised pale strip along each edge of the carriageway
      const n = pts.length / 3;
      for (const sideK of [-1, 1]) {
        const edge: number[] = [];
        for (let i = 0; i < n; i++) {
          const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
          let dx = pts[b * 3] - pts[a * 3], dz = pts[b * 3 + 1] - pts[a * 3 + 1]; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
          const off = sideK * (width / 2 + 0.12);
          edge.push(pts[i * 3] + dz * off, pts[i * 3 + 1] - dx * off, pts[i * 3 + 2]);
        }
        ribbon(edge, 0.25, origin, 0.1, K2.p, K2.u, K2.i);
      }
    }
    if (MAJOR.has(kind) && !bridge) {
      // dashed centre line: short ribbons
      const n = pts.length / 3;
      for (let i = 0; i < n - 1; i++) {
        const ax = pts[i * 3], az = pts[i * 3 + 1], bx = pts[i * 3 + 3], bz = pts[i * 3 + 4];
        const L = Math.hypot(bx - ax, bz - az);
        for (let d = 0; d + 3 < L; d += 9) {
          const t0 = d / L, t1 = (d + 3) / L;
          ribbon([ax + (bx - ax) * t0, az + (bz - az) * t0, pts[i * 3 + 2] + (pts[i * 3 + 5] - pts[i * 3 + 2]) * t0, ax + (bx - ax) * t1, az + (bz - az) * t1, pts[i * 3 + 2] + (pts[i * 3 + 5] - pts[i * 3 + 2]) * t1], 0.12, origin, 0.02, K.p, K.u, K.i);
        }
      }
    }
    if (bridge) {
      // deck slab and parapets
      const n = pts.length / 3;
      const left: number[] = [], right: number[] = [];
      for (let i = 0; i < n; i++) {
        const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
        let dx = pts[b * 3] - pts[a * 3], dz = pts[b * 3 + 1] - pts[a * 3 + 1]; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
        const w = width / 2 + 0.4;
        left.push(pts[i * 3] + dz * w, pts[i * 3 + 1] - dx * w, pts[i * 3 + 2]);
        right.push(pts[i * 3] - dz * w, pts[i * 3 + 1] + dx * w, pts[i * 3 + 2]);
      }
      wallStrip(left, 1.1, 0.35, origin, deck.p, deck.u, deck.i);
      wallStrip(right, 1.1, 0.35, origin, deck.p, deck.u, deck.i);
      const under = pts.slice(); for (let i = 2; i < under.length; i += 3) under[i] -= 0.9;
      ribbon(under, width + 1.2, origin, 0, deck.p, deck.u, deck.i);
    }
  }
  for (const [m, mat] of [[A, M.asphalt], [F, M.footway], [K, M.marking], [K2, M.kerb]] as const) { const x = mesh(m.p, m.u, m.i, mat); if (x) g.add(x); }
  const dm = mesh(deck.p, deck.u, deck.i, M.concrete, true); if (dm) g.add(dm);

  const W = { p: [] as number[], u: [] as number[], i: [] as number[] }, Fe = { p: [] as number[], u: [] as number[], i: [] as number[] }, H = { p: [] as number[], u: [] as number[], i: [] as number[] };
  for (const [pts, kind, hgt] of tile.f) {
    if (kind === 'fence' || kind === 'guard_rail') wallStrip(pts, hgt ?? 1.8, 0, origin, Fe.p, Fe.u, Fe.i);
    else if (kind === 'hedge') wallStrip(pts, hgt ?? 1.6, 0.8, origin, H.p, H.u, H.i);
    else wallStrip(pts, hgt ?? (kind === 'retaining_wall' ? 2.5 : 1.9), 0.4, origin, W.p, W.u, W.i);
  }
  const wm = mesh(W.p, W.u, W.i, M.wall, true); if (wm) g.add(wm);
  const fm = mesh(Fe.p, Fe.u, Fe.i, M.fence, true); if (fm) g.add(fm);
  const hm = mesh(H.p, H.u, H.i, M.hedge, true); if (hm) g.add(hm);

  if (tile.l.length) {
    // real scanned street lamps (loaded async, attached when ready) with an emissive head for night
    const heads = new THREE.InstancedMesh(headGeo, M.lampHead, tile.l.length);
    const m4 = new THREE.Matrix4();
    const mats: THREE.Matrix4[] = [];
    tile.l.forEach(([x, z, y], i) => {
      m4.makeRotationY((x * 13.7 + z) % 6.28).setPosition(x - origin.x, y - origin.y, z - origin.z);
      heads.setMatrixAt(i, m4);
      mats.push(placement(x - origin.x, y - origin.y, z - origin.z, (x * 13.7 + z) % 6.28, 1.6));
    });
    g.add(heads);
    void loadModel('street_lamp_01').then((lamp) => { const li = instance(lamp.parts, mats, true); li.traverse((o) => { o.matrixAutoUpdate = false; o.updateMatrix(); }); g.add(li); });
  }
  return g;
}
