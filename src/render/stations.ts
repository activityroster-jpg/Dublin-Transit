// Platforms and platform furniture generated from the real platform positions on each track.
import * as THREE from 'three';
import type { TrackPath } from '../dart/path';
import type { StationData } from '../dart/data';
import { cisTexture, fenceTexture, stationSignTexture, tactileTexture, tex, textTexture } from './textures';
import { instance, loadModel, placement } from './models';

export const PLATFORM_EDGE = 1.65;
export const PLATFORM_H = 0.915;

let M: Record<string, THREE.Material> | null = null;
export const stationLampMats: THREE.MeshStandardMaterial[] = [];
function mats() {
  if (M) return M;
  const lampHead = new THREE.MeshStandardMaterial({ color: 0xdddddd, emissive: new THREE.Color(1, 0.92, 0.8), emissiveIntensity: 0 });
  stationLampMats.push(lampHead);
  M = {
    body: new THREE.MeshStandardMaterial({ map: tex('concrete_diff', 1), normalMap: tex('concrete_nor_gl', 1, false), roughness: 0.9, color: 0xa9a59e, side: THREE.DoubleSide }),
    top: new THREE.MeshStandardMaterial({ map: tex('paving_diff', 1), normalMap: tex('paving_nor_gl', 1, false), roughness: 0.85, color: 0xc9c4ba }),
    coping: new THREE.MeshStandardMaterial({ color: 0xe8e4dc, roughness: 0.7 }),
    yellow: new THREE.MeshStandardMaterial({ color: 0xf2c200, roughness: 0.6 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x2d4b3e, roughness: 0.5, metalness: 0.6 }),
    glass: new THREE.MeshStandardMaterial({ color: 0xbfd8e0, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false }),
    roof: new THREE.MeshStandardMaterial({ color: 0x4a5552, roughness: 0.55, metalness: 0.5, side: THREE.DoubleSide, map: tex('metal_diff', 1), normalMap: tex('metal_nor_gl', 1, false) }),
    wood: new THREE.MeshStandardMaterial({ color: 0x7a5a3c, roughness: 0.8 }),
    fence: new THREE.MeshStandardMaterial({ map: fenceTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.4 }),
    lampHead,
    tactile: new THREE.MeshStandardMaterial({ map: tactileTexture(), roughness: 0.9 }),
    valance: new THREE.MeshStandardMaterial({ color: 0x245a3c, roughness: 0.6, side: THREE.DoubleSide }),
    ironwork: new THREE.MeshStandardMaterial({ color: 0x1f4d35, roughness: 0.45, metalness: 0.5 }),
    stop: new THREE.MeshStandardMaterial({ map: textTexture('STOP', { w: 128, h: 128, bg: '#ffffff', fg: '#000000', font: 'bold 44px Arial' }), roughness: 0.6 }),
  };
  return M;
}

function sweepProfile(path: TrackPath, s0: number, s1: number, prof: [number, number][], origin: THREE.Vector3, uvScale: number): THREE.BufferGeometry {
  const n = Math.max(2, Math.ceil((s1 - s0) / 3) + 1), m = prof.length;
  const pos = new Float32Array(n * m * 3), uv = new Float32Array(n * m * 2);
  const p = new THREE.Vector3(), r = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const s = s0 + ((s1 - s0) * i) / (n - 1);
    path.point(s, p); path.right(s, r);
    let acc = 0;
    for (let k = 0; k < m; k++) {
      if (k) acc += Math.hypot(prof[k][0] - prof[k - 1][0], prof[k][1] - prof[k - 1][1]);
      const o = (i * m + k) * 3;
      pos[o] = p.x + r.x * prof[k][0] - origin.x; pos[o + 1] = p.y + prof[k][1] - origin.y; pos[o + 2] = p.z + r.z * prof[k][0] - origin.z;
      uv[(i * m + k) * 2] = acc * uvScale; uv[(i * m + k) * 2 + 1] = s * uvScale;
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < n - 1; i++) for (let k = 0; k < m - 1; k++) { const a = i * m + k, b = a + 1, c = a + m, d = c + 1; idx.push(a, b, c, b, d, c); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

const box = new THREE.BoxGeometry(1, 1, 1);
function place(g: THREE.Group, geo: THREE.BufferGeometry, mat: THREE.Material, path: TrackPath, s: number, lat: number, up: number, sx: number, sy: number, sz: number, origin: THREE.Vector3, shadow = true) {
  const m = new THREE.Mesh(geo, mat);
  m.position.copy(path.offsetPoint(s, lat, up).sub(origin));
  m.rotation.y = path.heading(s);
  m.scale.set(sx, sy, sz);
  m.castShadow = shadow; m.receiveShadow = true;
  g.add(m);
  return m;
}

export async function buildStation(path: TrackPath, st: StationData, origin: THREE.Vector3, opts: { terminus?: boolean; dest?: string; detail?: number } = {}): Promise<THREE.Group> {
  const M = mats();
  const [lampM, benchM, binM] = await Promise.all([loadModel('street_lamp_01'), loadModel('painted_wooden_bench'), loadModel('metal_trash_can')]);
  const g = new THREE.Group();
  g.position.copy(origin);
  const { s0, s1, side } = st.platform;
  const w = Math.max(3.5, Math.min(7, st.platform.width || 4));
  const e = PLATFORM_EDGE;
  const H = PLATFORM_H;
  // lateral ranges always increasing (left -> right) so faces point up/out.
  const L = (a: number) => (side > 0 ? a : -a);
  const lo = (a: number, b: number): [number, number] => (side > 0 ? [a, b] : [-b, -a]);
  // body (front face, top, back face)
  const body: [number, number][] = side > 0 ? [[e, -1.0], [e, H - 0.05], [e + w, H - 0.05], [e + w, -1.0]] : [[-e - w, -1.0], [-e - w, H - 0.05], [-e, H - 0.05], [-e, -1.0]];
  const bm = new THREE.Mesh(sweepProfile(path, s0, s1, body, origin, 0.3), M.body); bm.receiveShadow = true; g.add(bm);
  const [t0, t1] = lo(e + 1.3, e + w);
  g.add(new THREE.Mesh(sweepProfile(path, s0, s1, [[t0, H], [t1, H]], origin, 0.5), M.top));
  // coping stones, yellow line, tactile strip
  const [c0, c1] = lo(e - 0.05, e + 0.55);
  g.add(new THREE.Mesh(sweepProfile(path, s0, s1, side > 0 ? [[c0, H - 0.08], [c0, H + 0.005], [c1, H + 0.005]] : [[c0, H + 0.005], [c1, H + 0.005], [c1, H - 0.08]], origin, 1), M.coping));
  const [y0, y1] = lo(e + 0.55, e + 0.9);
  g.add(new THREE.Mesh(sweepProfile(path, s0, s1, [[y0, H + 0.004], [y1, H + 0.004]], origin, 1), M.top));
  const [z0, z1] = lo(e + 0.62, e + 0.72);
  g.add(new THREE.Mesh(sweepProfile(path, s0, s1, [[z0, H + 0.008], [z1, H + 0.008]], origin, 1), M.yellow));
  const [ta, tb] = lo(e + 0.9, e + 1.3);
  g.add(new THREE.Mesh(sweepProfile(path, s0, s1, [[ta, H + 0.006], [tb, H + 0.006]], origin, 2.5), M.tactile));
  g.children.forEach((c) => { (c as THREE.Mesh).receiveShadow = true; });
  // ramps at both ends down to ground level
  for (const [sEnd, dir] of [[s0, -1], [s1, 1]] as const) {
    const r0 = sEnd, r1 = sEnd + dir * 12;
    const prof: [number, number][] = side > 0 ? [[e + 0.3, -1], [e + 0.3, H], [e + w, H], [e + w, -1]] : [[-e - w, -1], [-e - w, H], [-e - 0.3, H], [-e - 0.3, -1]];
    const n = 8;
    for (let i = 0; i < n; i++) {
      const a = r0 + ((r1 - r0) * i) / n, b = r0 + ((r1 - r0) * (i + 1)) / n;
      const hA = H * (1 - i / n), hB = H * (1 - (i + 1) / n);
      const pr = prof.map(([x, y]) => [x, y === H ? hA : y] as [number, number]);
      void hB;
      g.add(new THREE.Mesh(sweepProfile(path, Math.min(a, b), Math.max(a, b), pr, origin, 0.3), M.body));
    }
  }
  // back fence (green palisade)
  g.add(new THREE.Mesh(sweepProfile(path, s0, s1, [[L(e + w - 0.1), H], [L(e + w - 0.1), H + 1.8]].sort((a, b) => a[0] - b[0] || a[1] - b[1]) as [number, number][], origin, 0.55), M.fence));
  const len = s1 - s0;
  const signTex = stationSignTexture(st.name, st.nameGa);
  const signMat = new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.5 });
  signMat.userData.perItem = true;
  const backLat = L(e + w - 0.9);
  const yawAt = (s: number) => path.heading(s) + (side > 0 ? Math.PI / 2 : -Math.PI / 2); // facing the track from the platform back
  // lamps (scanned street lamps) every 18 m along the back of the platform
  const lampMats: THREE.Matrix4[] = [];
  for (let s = s0 + 8; s < s1 - 4; s += 18) {
    const pt = path.offsetPoint(s, L(e + w - 0.5), H).sub(origin);
    lampMats.push(placement(pt.x, pt.y, pt.z, yawAt(s), 1.3));
  }
  g.add(instance(lampM.parts, lampMats, true));
  // canopy with cast columns and a valance over the middle of the platform (bigger stations get a longer one)
  const canopyLen = Math.min(len - 20, 36 + (st.platform.width > 6 ? 30 : 0));
  const cs0 = (s0 + s1) / 2 - canopyLen / 2, cs1 = cs0 + canopyLen;
  const [ca, cb] = lo(e + 0.6, e + w + 0.2);
  g.add(new THREE.Mesh(sweepProfile(path, cs0, cs1, [[ca, H + 3.2], [(ca + cb) / 2, H + 3.9], [cb, H + 3.3]], origin, 0.3), M.roof));
  g.add(new THREE.Mesh(sweepProfile(path, cs0, cs1, [[ca, H + 2.85], [ca, H + 3.2]], origin, 0.3), M.valance));
  for (let s = cs0 + 3; s < cs1; s += 6) {
    place(g, box, M.ironwork, path, s, L(e + 2.4), H + 1.55, 0.18, 3.1, 0.18, origin);
    place(g, box, M.ironwork, path, s, L(e + 2.4), H + 3.15, 2.6, 0.08, 0.1, origin);
    place(g, box, M.ironwork, path, s, L(e + 2.4), H + 3.25, 0.12, 0.3, 0.12, origin);
  }
  // benches and bins under the canopy and along the platform
  const benchMats: THREE.Matrix4[] = [], binMats: THREE.Matrix4[] = [];
  for (let s = s0 + 20; s < s1 - 10; s += 24) {
    const pt = path.offsetPoint(s, backLat, H).sub(origin);
    benchMats.push(placement(pt.x, pt.y, pt.z, yawAt(s), 1.15));
    const pb = path.offsetPoint(s + 2.2, L(e + w - 0.7), H).sub(origin);
    binMats.push(placement(pb.x, pb.y + 0.07, pb.z, yawAt(s), 0.9));
  }
  g.add(instance(benchM.parts, benchMats, true), instance(binM.parts, binMats, true));
  // customer information screen hanging under the canopy, and a timetable poster case
  const cis = new THREE.MeshStandardMaterial({ map: cisTexture([`1  ${opts.dest ?? 'Howth'}`.padEnd(22) + 'Due', `2  ${opts.dest ?? 'Howth'}`.padEnd(22) + '13 min', '', '  Mind the gap']), emissive: 0xffffff, emissiveMap: null, emissiveIntensity: 0.9, roughness: 0.3 });
  cis.emissiveMap = cis.map; cis.userData.perItem = true;
  const cisMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.5), cis);
  cisMesh.position.copy(path.offsetPoint((cs0 + cs1) / 2, L(e + 2.4), H + 2.6).sub(origin)); cisMesh.rotation.y = path.heading(cs0) + Math.PI; g.add(cisMesh);
  const cisBack = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.6), M.steel); cisBack.position.copy(cisMesh.position); cisBack.rotation.y = cisMesh.rotation.y + Math.PI; g.add(cisBack);
  // name boards: every ~35 m, at the back of the platform facing the track
  for (let s = s0 + 15; s < s1 - 10; s += 35) {
    const pt = path.offsetPoint(s, L(e + w - 1.6), H + 2.2).sub(origin);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 0.68), signMat);
    sign.position.copy(pt);
    sign.rotation.y = yawAt(s);
    g.add(sign);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 0.68), M.steel); back.position.copy(pt); back.rotation.y = sign.rotation.y + Math.PI; g.add(back);
    for (const d of [-1.6, 1.6]) place(g, box, M.steel, path, s + d, L(e + w - 1.62), H + 1.2, 0.06, 2.4, 0.06, origin);
  }
  // footbridge across the tracks near one end (not at termini), with stair flights down to this platform
  if (!opts.terminus && len > 120) {
    const fs = s0 + 25;
    const span: [number, number] = lo(e + 1.2, -(e + 1.2) - 3.5 - 0.5); // to beyond the opposite track
    const a = Math.min(span[0], span[1]), b = Math.max(span[0], span[1]);
    const deckY = 6.4;
    const deck = new THREE.Mesh(box, M.steel); deck.scale.set(b - a + 2, 0.35, 2.4);
    const mid = path.offsetPoint(fs, (a + b) / 2, deckY).sub(origin); deck.position.copy(mid); deck.rotation.y = path.heading(fs); deck.castShadow = true; g.add(deck);
    for (const dz of [-1.2, 1.2]) { const par = new THREE.Mesh(box, M.fence); par.scale.set(b - a + 2, 1.3, 0.04); par.position.copy(path.offsetPoint(fs + dz, (a + b) / 2, deckY + 0.8).sub(origin)); par.rotation.y = path.heading(fs); g.add(par); }
    for (const lat of [a - 0.8, b + 0.8]) { const col = new THREE.Mesh(box, M.ironwork); col.scale.set(0.3, deckY + 1, 0.3); col.position.copy(path.offsetPoint(fs, lat, (deckY - 1) / 2).sub(origin)); col.castShadow = true; g.add(col); }
    // stairs on this platform: a flight from deck level down along the platform
    const flightLen = 11;
    const stair = new THREE.Mesh(box, M.steel); stair.scale.set(1.6, 0.3, Math.hypot(flightLen, deckY - H));
    stair.position.copy(path.offsetPoint(fs + flightLen / 2 + 1.2, L(e + 2.4), (deckY + H) / 2).sub(origin));
    stair.rotation.y = path.heading(fs); stair.rotation.x = -Math.atan2(deckY - H, flightLen) * (side > 0 ? 1 : 1);
    stair.castShadow = true; g.add(stair);
    for (let k = 0; k < 4; k++) { const leg = new THREE.Mesh(box, M.ironwork); const ss = fs + 3 + k * 3; const hh = deckY - ((deckY - H) * (ss - fs - 1.2)) / flightLen; leg.scale.set(0.12, Math.max(0.5, hh - H), 0.12); leg.position.copy(path.offsetPoint(ss, L(e + 2.4), (hh + H) / 2).sub(origin)); g.add(leg); }
  }
  // Stop board at the stopping point (8-car mark), on the platform edge, facing the driver.
  place(g, box, M.steel, path, st.s + 1, L(e + 0.35), H + 0.9, 0.05, 1.8, 0.05, origin);
  const stop = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), M.stop);
  stop.position.copy(path.offsetPoint(st.s + 1, L(e + 0.35), H + 1.85).sub(origin));
  stop.rotation.y = path.heading(st.s) + Math.PI;
  g.add(stop);
  g.traverse((o) => { o.matrixAutoUpdate = false; o.updateMatrix(); });
  return g;
}
