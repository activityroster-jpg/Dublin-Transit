// Buildings from real OSM footprints and heights, with procedural facades (windows, doors,
// shopfronts, lit windows at night) on brick, pebble-dash, render or cladding.
import * as THREE from 'three';
import type { SceneryTile } from '../dart/data';
import { hash2 } from '../core/rand';
import { tex } from './textures';

type B = SceneryTile['b'][number];

// Wall texture ids: 0 pebble-dash/render, 1 brick, 2 concrete, 3 cladding (no texture), 4 stone
const PALETTE: Record<string, { cols: number[]; tex: number[]; floorH: number; win: number }> = {
  house: { cols: [0xf0ebe0, 0xe8e2d4, 0xd9d4c8, 0xcfc6b4, 0xf3efe6, 0xb8b2a6, 0xe9dcc5], tex: [0, 0, 0, 1, 0], floorH: 2.9, win: 3.2 },
  apartments: { cols: [0xd6cfc4, 0xb98e72, 0xe2ddd3, 0xa8806a], tex: [1, 0, 2, 1], floorH: 3.0, win: 2.6 },
  commercial: { cols: [0xcfcac2, 0xb4b0aa, 0xe0dcd4, 0x9fa4a8], tex: [2, 0, 1, 2], floorH: 3.6, win: 2.4 },
  industrial: { cols: [0x8d969b, 0x7e8a91, 0xa7a9a3, 0x6d7a6e, 0x93897b], tex: [3, 3, 2], floorH: 5, win: 7 },
  church: { cols: [0xb9b1a3, 0xa79f92], tex: [4], floorH: 6, win: 5 },
  shed: { cols: [0x9a948a, 0x7f7a70, 0xb3ada2], tex: [2, 3], floorH: 3, win: 0 },
  roof: { cols: [0x8f9599], tex: [3], floorH: 4, win: 0 },
  station: { cols: [0xb98e72, 0xd8cfbf], tex: [1, 4], floorH: 3.5, win: 2.8 },
  civic: { cols: [0xc9b49a, 0xd5cdc0, 0xb98e72], tex: [1, 0, 4], floorH: 3.4, win: 2.8 },
  generic: { cols: [0xd9d2c5, 0xc4bcae, 0xb98e72, 0xe6e1d7], tex: [0, 1, 2], floorH: 3, win: 3 },
};
const KIND_ID: Record<string, number> = { house: 0, apartments: 1, commercial: 2, industrial: 3, church: 4, shed: 5, roof: 6, station: 7, civic: 8, generic: 9 };

let wallMat: THREE.MeshStandardMaterial | null = null;
let roofMats: { tiles: THREE.MeshStandardMaterial; flat: THREE.MeshStandardMaterial } | null = null;
export const buildingUniforms = { uNight: { value: 0 } };

function wallMaterial(): THREE.MeshStandardMaterial {
  if (wallMat) return wallMat;
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
  const dash = tex('pebbledash_diff', 1), brick = tex('brick_diff', 1), conc = tex('concrete_diff', 1), stone = tex('stonewall_diff', 1);
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { tDash: { value: dash }, tBrick: { value: brick }, tConc: { value: conc }, tStone: { value: stone }, uNight: buildingUniforms.uNight });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aP; attribute vec2 aUV; varying vec4 vP; varying vec2 vUV2;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvP = aP; vUV2 = aUV;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D tDash, tBrick, tConc, tStone; uniform float uNight;
varying vec4 vP; varying vec2 vUV2;
float bh(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }`)
      .replace('#include <map_fragment>', `
  // vP: x = kind, y = floor height, z = window spacing, w = wall texture id + seed*10
  float texId = mod(vP.w, 10.0); float seed = floor(vP.w / 10.0);
  vec2 wuv = vUV2;
  vec3 wt = texId < 0.5 ? texture2D(tDash, wuv * 0.5).rgb * 1.25 : texId < 1.5 ? texture2D(tBrick, wuv * vec2(0.5, 0.5)).rgb * 1.6 : texId < 2.5 ? texture2D(tConc, wuv * 0.3).rgb * 1.3 : texId < 3.5 ? vec3(0.85 + 0.15 * step(0.5, fract(wuv.x * 2.5))) : texture2D(tStone, wuv * 0.4).rgb * 1.4;
  diffuseColor.rgb *= texId < 1.5 && texId > 0.5 ? wt * vec3(1.0) : wt;
  float isWin = 0.0; float lit = 0.0;
  if (vP.z > 0.5 && vUV2.y > 0.6) {
    float fl = floor(vUV2.y / vP.y);
    float fy = fract(vUV2.y / vP.y);
    float cx = floor(vUV2.x / vP.z);
    float fx = fract(vUV2.x / vP.z);
    float shop = (vP.x > 1.5 && vP.x < 2.5 && fl < 0.5) ? 1.0 : 0.0;
    float wx = shop > 0.5 ? 0.08 : 0.28, wy0 = shop > 0.5 ? 0.12 : 0.3, wy1 = shop > 0.5 ? 0.85 : 0.82;
    float r = bh(vec2(cx, fl) + seed);
    if (fx > wx && fx < 1.0 - wx && fy > wy0 && fy < wy1 && r > 0.06) {
      isWin = 1.0;
      lit = step(0.55, bh(vec2(cx * 1.7, fl * 3.1) + seed * 0.37));
      // frame
      float fr = step(fx, wx + 0.025) + step(1.0 - wx - 0.025, fx) + step(fy, wy0 + 0.03) + step(wy1 - 0.03, fy);
      if (fr > 0.5) { isWin = 0.0; diffuseColor.rgb = vec3(0.92); }
      // ground floor door on houses
    } else if (vP.x < 0.5 && fl < 0.5 && fx > 0.36 && fx < 0.64 && fy < 0.75 && r < 0.18) {
      diffuseColor.rgb = vec3(0.25, 0.12, 0.08) + vec3(r) * 0.8;
    }
  }
  if (isWin > 0.5) diffuseColor.rgb = mix(vec3(0.06, 0.08, 0.1), vec3(0.18, 0.22, 0.26), bh(floor(vUV2) + seed));
  float shade = 0.92 + 0.08 * bh(vec2(seed, 3.1));
  diffuseColor.rgb *= shade;`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  if (isWin > 0.5) roughnessFactor = 0.08;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  if (isWin > 0.5) totalEmissiveRadiance += vec3(1.0, 0.78, 0.45) * lit * uNight * 0.55;');
  };
  m.customProgramCacheKey = () => 'bld-wall-v3';
  wallMat = m;
  return m;
}
function roofMaterials() {
  if (roofMats) return roofMats;
  roofMats = {
    tiles: new THREE.MeshStandardMaterial({ map: tex('roof_diff', 1), normalMap: tex('roof_nor_gl', 1, false), roughness: 0.85, vertexColors: true }),
    flat: new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, color: 0x77736c, roughness: 0.95, map: tex('concrete_diff', 1) }),
  };
  return roofMats;
}

/** Oriented bounding rectangle of a footprint: centre, axis (unit), half-lengths. */
function obb(ring: number[]) {
  let best: { area: number; c: [number, number]; ax: [number, number]; hl: number; hw: number } | null = null;
  const n = ring.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    let ex = ring[j * 2] - ring[i * 2], ez = ring[j * 2 + 1] - ring[i * 2 + 1];
    const L = Math.hypot(ex, ez); if (L < 0.5) continue;
    ex /= L; ez /= L;
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (let k = 0; k < n; k++) {
      const x = ring[k * 2], z = ring[k * 2 + 1];
      const a = x * ex + z * ez, b = -x * ez + z * ex;
      a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b);
    }
    const area = (a1 - a0) * (b1 - b0);
    if (!best || area < best.area) {
      const ca = (a0 + a1) / 2, cb = (b0 + b1) / 2;
      best = { area, c: [ca * ex - cb * ez, ca * ez + cb * ex], ax: [ex, ez], hl: (a1 - a0) / 2, hw: (b1 - b0) / 2 };
    }
  }
  return best;
}
function polyArea(r: number[]) { let s = 0; const n = r.length / 2; for (let i = 0; i < n; i++) { const j = (i + 1) % n; s += r[i * 2] * r[j * 2 + 1] - r[j * 2] * r[i * 2 + 1]; } return s / 2; }

export function buildBuildings(list: B[], origin: THREE.Vector3): THREE.Group {
  const wp: number[] = [], wn: number[] = [], wc: number[] = [], wP: number[] = [], wUV: number[] = [];
  const rp: number[] = [], rn: number[] = [], ruv: number[] = [], rc: number[] = [];
  const fp: number[] = [];
  const col = new THREE.Color();
  for (const b of list) {
    const [ringIn, base, hIn, minH, kind, roofShape, bcol, rcol] = b;
    let ring = ringIn.slice();
    const n = ring.length / 2;
    if (n < 3) continue;
    if (polyArea(ring) < 0) { const r2: number[] = []; for (let i = n - 1; i >= 0; i--) r2.push(ring[i * 2], ring[i * 2 + 1]); ring = r2; } // make CCW so the right of each edge is outside
    const pal = PALETTE[kind] ?? PALETTE.generic;
    const hsh = hash2(Math.round(ring[0] * 10), Math.round(ring[1] * 10));
    let colorSet = false;
    if (bcol) { try { col.set(bcol); colorSet = true; } catch { /* ignore */ } }
    if (!colorSet) col.setHex(pal.cols[Math.floor(hsh * pal.cols.length)]);
    col.convertSRGBToLinear();
    const texId = pal.tex[Math.floor(hash2(n, Math.round(base * 7)) * pal.tex.length)];
    const brickish = texId === 1;
    if (brickish && !bcol) col.setRGB(1, 1, 1);
    const seed = Math.floor(hsh * 997);
    const y0 = base - origin.y + minH - (minH > 0 ? 0 : 1.0); // sink 1 m so slopes don't show gaps
    const h = Math.max(2.5, hIn);
    const y1 = base - origin.y + h;
    // Walls
    let u = 0;
    for (let i = 0; i < ring.length / 2; i++) {
      const j = (i + 1) % (ring.length / 2);
      const ax = ring[i * 2] - origin.x, az = ring[i * 2 + 1] - origin.z, bx = ring[j * 2] - origin.x, bz = ring[j * 2 + 1] - origin.z;
      const L = Math.hypot(bx - ax, bz - az); if (L < 0.05) continue;
      const nx = (bz - az) / L, nz = -(bx - ax) / L;
      const vBase = minH > 0 ? 0 : -1.0;
      const quad = [[ax, y0, az, u, vBase], [bx, y0, bz, u + L, vBase], [bx, y1, bz, u + L, h], [ax, y1, az, u, h]];
      for (const k of [0, 2, 1, 0, 3, 2]) {
        const q = quad[k];
        wp.push(q[0], q[1], q[2]); wn.push(nx, 0, nz); wc.push(col.r, col.g, col.b);
        wP.push(KIND_ID[kind] ?? 9, pal.floorH, pal.win, texId + seed * 10); wUV.push(q[3], q[4]);
      }
      u += L;
    }
    // Roofs
    const area = Math.abs(polyArea(ring));
    const box = obb(ring);
    const pitched = (roofShape === 'gabled' || roofShape === 'hipped' || (kind === 'house' && area < 260)) && box && area / box.area > 0.78 && box.hw < 9;
    if (pitched && box) {
      const rh = Math.min(box.hw * 0.75, 4);
      const [cx, cz] = box.c, [ex, ez] = box.ax;
      const P = (a: number, b: number, y: number) => [cx + ex * a - ez * b - origin.x, y, cz + ez * a + ex * b - origin.z];
      const hl = box.hl + 0.25, hw = box.hw + 0.3;
      const hip = roofShape === 'hipped' || (roofShape !== 'gabled' && hsh > 0.45);
      const ridge = hip ? Math.max(0.2, hl - hw * 0.9) : hl;
      const e1 = P(-hl, -hw, y1), e2 = P(hl, -hw, y1), e3 = P(hl, hw, y1), e4 = P(-hl, hw, y1);
      const r1 = P(-ridge, 0, y1 + rh), r2 = P(ridge, 0, y1 + rh);
      const rcolor = new THREE.Color(rcol ?? (hsh > 0.7 ? '#6b4a3c' : hsh > 0.35 ? '#4a4d52' : '#5d5f63'));
      try { rcolor.convertSRGBToLinear(); } catch { /* */ }
      const tri = (a: number[], b2: number[], c: number[]) => {
        const v1 = new THREE.Vector3(b2[0] - a[0], b2[1] - a[1], b2[2] - a[2]), v2 = new THREE.Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
        const nn = v1.cross(v2).normalize();
        if (nn.y < 0) { [b2, c] = [c, b2]; nn.negate(); }
        for (const q of [a, b2, c]) { rp.push(q[0], q[1], q[2]); rn.push(nn.x, nn.y, nn.z); ruv.push((q[0] + origin.x) * 0.5 + (q[1]) * 0.3, (q[2] + origin.z) * 0.5 + q[1] * 0.7); rc.push(rcolor.r, rcolor.g, rcolor.b); }
      };
      tri(e1, e2, r2); tri(e1, r2, r1); tri(e3, e4, r1); tri(e3, r1, r2);
      if (hip) { tri(e2, e3, r2); tri(e4, e1, r1); }
      else {
        // gable ends as walls (use flat material list via fp: draw as roof-coloured)
        tri(e2, e3, r2); tri(e4, e1, r1);
      }
      // soffit cap under eaves (flat) so the roof isn't see-through from below
      const cap = [e1, e2, e3, e1, e3, e4];
      for (const q of cap) fp.push(q[0], q[1] - 0.05, q[2]);
    } else {
      // flat roof: triangulate
      const contour = []; for (let i = 0; i < ring.length / 2; i++) contour.push(new THREE.Vector2(ring[i * 2] - origin.x, ring[i * 2 + 1] - origin.z));
      const tris = THREE.ShapeUtils.triangulateShape(contour, []);
      for (const t of tris) for (const k of [t[0], t[2], t[1]]) fp.push(contour[k].x, y1, contour[k].y);
      if (minH > 0) for (const t of tris) for (const k of t) fp.push(contour[k].x, y0, contour[k].y);
    }
  }
  const g = new THREE.Group();
  if (wp.length) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(wn, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(wc, 3));
    geo.setAttribute('aP', new THREE.Float32BufferAttribute(wP, 4));
    geo.setAttribute('aUV', new THREE.Float32BufferAttribute(wUV, 2));
    const m = new THREE.Mesh(geo, wallMaterial()); m.castShadow = true; m.receiveShadow = true; g.add(m);
  }
  const rm = roofMaterials();
  if (rp.length) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(rn, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(ruv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(rc, 3));
    const m = new THREE.Mesh(geo, rm.tiles); m.castShadow = true; m.receiveShadow = true; g.add(m);
  }
  if (fp.length) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3));
    const uv: number[] = []; for (let i = 0; i < fp.length; i += 3) uv.push((fp[i] + origin.x) * 0.2, (fp[i + 2] + origin.z) * 0.2);
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, rm.flat); m.castShadow = true; m.receiveShadow = true; g.add(m);
  }
  return g;
}
