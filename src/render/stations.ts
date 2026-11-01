// Platforms and platform furniture generated from the real platform positions on each track.
import * as THREE from 'three';
import type { TrackPath } from '../dart/path';
import type { StationData } from '../dart/data';
import { fenceTexture, stationSignTexture, tex, textTexture } from './textures';

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
    top: new THREE.MeshStandardMaterial({ map: tex('platform_diff', 1), normalMap: tex('platform_nor_gl', 1, false), roughness: 0.85, color: 0xd0ccc4 }),
    coping: new THREE.MeshStandardMaterial({ color: 0xe8e4dc, roughness: 0.7 }),
    yellow: new THREE.MeshStandardMaterial({ color: 0xf2c200, roughness: 0.6 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x2d4b3e, roughness: 0.5, metalness: 0.6 }),
    glass: new THREE.MeshStandardMaterial({ color: 0xbfd8e0, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false }),
    roof: new THREE.MeshStandardMaterial({ color: 0x3c4a44, roughness: 0.6, metalness: 0.5, side: THREE.DoubleSide }),
    wood: new THREE.MeshStandardMaterial({ color: 0x7a5a3c, roughness: 0.8 }),
    fence: new THREE.MeshStandardMaterial({ map: fenceTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.4 }),
    lampHead,
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

export function buildStation(path: TrackPath, st: StationData, origin: THREE.Vector3): THREE.Group {
  const M = mats();
  const g = new THREE.Group();
  g.position.copy(origin);
  const { s0, s1, side } = st.platform;
  const w = Math.max(3.5, Math.min(7, st.platform.width || 4));
  const e = PLATFORM_EDGE;
  const H = PLATFORM_H;
  // lateral ranges always increasing (left -> right) so faces point up/out.
  const L = (a: number) => (side > 0 ? a : -a);
  const lo = (a: number, b: number): [number, number] => (side > 0 ? [a, b] : [-b, -a]);
  const [bx0, bx1] = lo(e, e + w);
  // body (front face, top, back face)
  const body: [number, number][] = side > 0 ? [[e, -1.0], [e, H - 0.05], [e + w, H - 0.05], [e + w, -1.0]] : [[-e - w, -1.0], [-e - w, H - 0.05], [-e, H - 0.05], [-e, -1.0]];
  const bm = new THREE.Mesh(sweepProfile(path, s0, s1, body, origin, 0.3), M.body); bm.receiveShadow = true; g.add(bm);
  const [t0, t1] = lo(e + 0.9, e + w);
  g.add(new THREE.Mesh(sweepProfile(path, s0, s1, [[t0, H], [t1, H]], origin, 0.5), M.top));
  const [c0, c1] = lo(e - 0.05, e + 0.55);
  g.add(new THREE.Mesh(sweepProfile(path, s0, s1, side > 0 ? [[c0, H - 0.08], [c0, H + 0.005], [c1, H + 0.005]] : [[c0, H + 0.005], [c1, H + 0.005], [c1, H - 0.08]], origin, 1), M.coping));
  const [y0, y1] = lo(e + 0.55, e + 0.9);
  g.add(new THREE.Mesh(sweepProfile(path, s0, s1, [[y0, H + 0.004], [y1, H + 0.004]], origin, 1), M.top));
  const [z0, z1] = lo(e + 0.62, e + 0.72);
  g.add(new THREE.Mesh(sweepProfile(path, s0, s1, [[z0, H + 0.008], [z1, H + 0.008]], origin, 1), M.yellow));
  g.children.forEach((c) => { (c as THREE.Mesh).receiveShadow = true; });
  void bx0; void bx1;
  // back fence
  g.add(new THREE.Mesh(sweepProfile(path, s0, s1, [[L(e + w - 0.1), H], [L(e + w - 0.1), H + 1.8]].sort((a, b) => a[0] - b[0] || a[1] - b[1]) as [number, number][], origin, 0.55), M.fence));
  // shelters, benches, lamps, signs
  const len = s1 - s0;
  const signTex = stationSignTexture(st.name, st.nameGa);
  const signMat = new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.5 });
  signMat.userData.perItem = true;
  const backLat = L(e + w - 0.9);
  for (let s = s0 + 8; s < s1 - 4; s += 18) {
    // lamp post
    place(g, box, M.steel, path, s, L(e + w - 0.4), H + 2.4, 0.1, 4.8, 0.1, origin);
    const head = place(g, box, M.lampHead, path, s, L(e + w - 0.9), H + 4.75, 1.0, 0.08, 0.3, origin, false);
    head.castShadow = false;
  }
  const shelters = Math.max(1, Math.round(len / 70));
  for (let k = 0; k < shelters; k++) {
    const s = s0 + (len * (k + 0.5)) / shelters;
    // canopy shelter: 6 m long, glass back + sides, steel roof
    place(g, box, M.roof, path, s, backLat - L(0.6), H + 2.6, 2.2, 0.08, 6.2, origin);
    place(g, box, M.glass, path, s, backLat + L(0.35), H + 1.25, 0.03, 2.5, 6, origin, false);
    for (const d of [-3, 3]) {
      place(g, box, M.steel, path, s + d, backLat + L(0.35), H + 1.3, 0.08, 2.6, 0.08, origin);
      place(g, box, M.steel, path, s + d, backLat - L(1.6), H + 1.3, 0.08, 2.6, 0.08, origin);
      place(g, box, M.glass, path, s + d, backLat - L(0.6), H + 1.25, 1.9, 2.5, 0.03, origin, false);
    }
    // bench inside
    place(g, box, M.wood, path, s, backLat, H + 0.45, 0.45, 0.06, 3.5, origin);
    place(g, box, M.steel, path, s, backLat, H + 0.22, 0.4, 0.44, 0.06, origin);
  }
  // name boards: every ~35 m, at the back of the platform facing the track
  for (let s = s0 + 15; s < s1 - 10; s += 35) {
    const pt = path.offsetPoint(s, L(e + w - 1.6), H + 2.2).sub(origin);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 0.68), signMat);
    sign.position.copy(pt);
    sign.rotation.y = path.heading(s) + (side > 0 ? Math.PI / 2 : -Math.PI / 2);
    g.add(sign);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 0.68), M.steel); back.position.copy(pt); back.rotation.y = sign.rotation.y + Math.PI; g.add(back);
    for (const d of [-1.6, 1.6]) place(g, box, M.steel, path, s + d, L(e + w - 1.62), H + 1.2, 0.06, 2.4, 0.06, origin);
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
