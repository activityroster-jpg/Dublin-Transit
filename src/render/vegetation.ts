// Trees, bushes and grass: card-based crowns with wind sway, instanced per scenery tile.
import * as THREE from 'three';
import { rng } from '../core/rand';
import { grassTexture, leafTexture, tex } from './textures';

export const windUniforms = { uTime: { value: 0 } };

function swayMaterial(map: THREE.Texture, strength: number): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ map, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.85, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = windUniforms.uTime;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
  #ifdef USE_INSTANCING
  vec3 ip = instanceMatrix[3].xyz;
  #else
  vec3 ip = vec3(0.0);
  #endif
  float sw = sin(uTime * 1.3 + ip.x * 0.15 + ip.z * 0.11) * 0.6 + sin(uTime * 2.7 + ip.x * 0.5) * 0.25;
  transformed.xz += vec2(sw, sw * 0.6) * ${strength.toFixed(3)} * max(0.0, transformed.y);`);
  };
  m.customProgramCacheKey = () => 'sway' + strength;
  return m;
}

interface TreeKind { geo: THREE.BufferGeometry; leaf: THREE.Material; trunk: THREE.BufferGeometry | null }
let kinds: TreeKind[] | null = null;
let barkMat: THREE.Material;
let grassMat: THREE.Material;
let grassGeo: THREE.BufferGeometry;

/** Builds a crown from leaf cards with normals pointing away from the crown centre. */
function crown(seed: number, cards: number, rx: number, ry: number, cy: number, size: number): THREE.BufferGeometry {
  const r = rng(seed);
  const pos: number[] = [], nor: number[] = [], uv: number[] = [];
  for (let i = 0; i < cards; i++) {
    const u = r() * 2 - 1, th = r() * Math.PI * 2, rad = Math.cbrt(r());
    const c = new THREE.Vector3(Math.sqrt(1 - u * u) * Math.cos(th) * rx * rad, u * ry * rad + cy, Math.sqrt(1 - u * u) * Math.sin(th) * rx * rad);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(r() * Math.PI, r() * Math.PI, r() * Math.PI));
    const s = size * (0.7 + r() * 0.6);
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => new THREE.Vector3(a * s, b * s, 0).applyQuaternion(q).add(c));
    const nrm = new THREE.Vector3(c.x / rx, (c.y - cy) / ry + 0.4, c.z / rx).normalize();
    for (const k of [0, 1, 2, 0, 2, 3]) {
      pos.push(corners[k].x, corners[k].y, corners[k].z); nor.push(nrm.x, nrm.y, nrm.z);
      uv.push(k === 0 || k === 3 ? 0 : 1, k < 2 ? 0 : 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.userData.keep = true;
  return g;
}

function trunk(h: number, r0: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r0 * 0.6, r0, h, 7, 1, true);
  g.translate(0, h / 2, 0);
  return g;
}

export function initVegetation(grassDensity: number) {
  if (kinds) return;
  barkMat = new THREE.MeshStandardMaterial({ map: tex('bark_diff', 1), roughness: 1 });
  const leafA = swayMaterial(leafTexture(11, 95), 0.012);
  const leafB = swayMaterial(leafTexture(23, 80), 0.014);
  const leafC = swayMaterial(leafTexture(37, 105), 0.02);
  kinds = [
    { geo: crown(1, 130, 3.6, 3.2, 7.5, 0.95), leaf: leafA, trunk: trunk(6.5, 0.28) }, // 0 mapped tree (mature)
    { geo: crown(2, 110, 2.8, 3.4, 6.5, 0.85), leaf: leafB, trunk: trunk(5.5, 0.22) }, // 1 tree row
    { geo: crown(3, 120, 3.0, 4.0, 8.0, 0.9), leaf: leafB, trunk: trunk(7, 0.25) }, // 2 woodland
    { geo: crown(4, 130, 3.8, 3.0, 6.8, 0.95), leaf: leafA, trunk: trunk(5.8, 0.3) }, // 3 park
    { geo: crown(5, 44, 1.7, 1.2, 1.0, 0.65), leaf: leafC, trunk: null }, // 4 lineside bush/bramble
  ];
  grassMat = swayMaterial(grassTexture(5), 0.05);
  (grassMat as THREE.MeshStandardMaterial).alphaTest = 0.35;
  const gq = new THREE.PlaneGeometry(0.9, 0.55); gq.translate(0, 0.27, 0);
  const gq2 = gq.clone().rotateY(Math.PI / 2);
  grassGeo = mergeGeos([gq, gq2]);
  // grass normals up for soft lighting
  const n = grassGeo.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  void grassDensity;
}

function mergeGeos(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], uv: number[] = [];
  for (const g0 of list) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    pos.push(...(g.attributes.position.array as Float32Array)); nor.push(...(g.attributes.normal.array as Float32Array)); uv.push(...(g.attributes.uv.array as Float32Array));
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  out.userData.keep = true;
  return out;
}

/** Trees in one scenery tile, instanced per kind. */
export function buildTrees(trees: [number, number, number, number][], origin: THREE.Vector3, castShadow: boolean): THREE.Group {
  initVegetation(1);
  const g = new THREE.Group();
  const byKind: number[][] = [[], [], [], [], []];
  trees.forEach((t, i) => byKind[Math.min(4, t[3])].push(i));
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
  byKind.forEach((list, k) => {
    if (!list.length) return;
    const K = kinds![k];
    const leaves = new THREE.InstancedMesh(K.geo, K.leaf, list.length);
    const tr = K.trunk ? new THREE.InstancedMesh(K.trunk, barkMat, list.length) : null;
    list.forEach((ti, j) => {
      const [x, z, y] = trees[ti];
      const r = rng(Math.floor(x * 31 + z * 17));
      const sc = k === 4 ? 0.6 + r() * 0.9 : 0.65 + r() * 0.6;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * Math.PI * 2);
      m4.compose(p.set(x - origin.x, y - origin.y - 0.15, z - origin.z), q, s.set(sc * (0.85 + r() * 0.3), sc, sc * (0.85 + r() * 0.3)));
      leaves.setMatrixAt(j, m4);
      tr?.setMatrixAt(j, m4);
      c.setHSL(0.24 + (r() - 0.5) * 0.06, 0.3 + r() * 0.2, 0.55 + r() * 0.3);
      leaves.setColorAt(j, c);
    });
    leaves.castShadow = castShadow; leaves.receiveShadow = true;
    g.add(leaves);
    if (tr) { tr.castShadow = castShadow; g.add(tr); }
  });
  return g;
}

/** Grass tufts on the cess and lineside slopes of a track chunk. */
export function buildGrass(points: Float32Array, count: number, origin: THREE.Vector3): THREE.InstancedMesh {
  initVegetation(1);
  const im = new THREE.InstancedMesh(grassGeo, grassMat, count);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < count; i++) {
    const x = points[i * 4], y = points[i * 4 + 1], z = points[i * 4 + 2], r = points[i * 4 + 3];
    q.setFromAxisAngle(up, r * 6.283);
    const sc = 0.6 + r * 0.9;
    m4.compose(p.set(x - origin.x, y - origin.y, z - origin.z), q, s.set(sc, sc * (0.8 + r * 0.5), sc));
    im.setMatrixAt(i, m4);
    c.setHSL(0.2 + r * 0.06, 0.3, 0.75 + r * 0.3);
    im.setColorAt(i, c);
  }
  im.receiveShadow = true;
  return im;
}
