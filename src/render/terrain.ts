// Near terrain (4 m grid, carved to the railway, 9 textured landcover layers) and far terrain (horizon).
import * as THREE from 'three';
import type { DartData } from '../dart/data';

const LAYERS = 9;

/** Height lookup over the baked near terrain (also used to place trees, people, etc.). */
export class HeightField {
  private size: number; private n: number;
  private index = new Map<string, number>();
  private h: Int16Array; private c: Uint8Array;
  private stride: number;
  private farSize: number; private farN: number; private farIndex = new Map<string, number>(); private farH: Int16Array;

  constructor(d: DartData) {
    this.size = d.terrain.near.size; this.n = d.terrain.near.n;
    const nn = this.n * this.n;
    this.stride = nn * 3; // bytes per tile: int16 heights + uint8 classes
    d.terrain.near.tiles.forEach(([x, z], i) => this.index.set(`${x}_${z}`, i));
    this.h = new Int16Array(d.terrain.near.tiles.length * nn);
    this.c = new Uint8Array(d.terrain.near.tiles.length * nn);
    const dv = new DataView(d.near);
    for (let t = 0; t < d.terrain.near.tiles.length; t++) {
      const off = t * this.stride;
      for (let k = 0; k < nn; k++) this.h[t * nn + k] = dv.getInt16(off + k * 2, true);
      this.c.set(new Uint8Array(d.near, off + nn * 2, nn), t * nn);
    }
    this.farSize = d.terrain.far.size; this.farN = d.terrain.far.n;
    d.terrain.far.tiles.forEach(([x, z], i) => this.farIndex.set(`${x}_${z}`, i));
    this.farH = new Int16Array(d.far.slice(0));
  }
  hasNear(ix: number, iz: number) { return this.index.has(`${ix}_${iz}`); }
  tileHeights(ix: number, iz: number): { h: Int16Array; c: Uint8Array } | null {
    const i = this.index.get(`${ix}_${iz}`);
    if (i == null) return null;
    const nn = this.n * this.n;
    return { h: this.h.subarray(i * nn, (i + 1) * nn), c: this.c.subarray(i * nn, (i + 1) * nn) };
  }
  farHeights(ix: number, iz: number): Int16Array | null {
    const i = this.farIndex.get(`${ix}_${iz}`);
    if (i == null) return null;
    const nn = this.farN * this.farN;
    return this.farH.subarray(i * nn, (i + 1) * nn);
  }
  get nearSize() { return this.size; } get nearN() { return this.n; }
  get farTileSize() { return this.farSize; } get farTileN() { return this.farN; }

  /** Ground height at world x,z (near grid if available, else far grid). */
  height(x: number, z: number): number {
    const S = this.size, N = this.n, cell = S / (N - 1);
    const ix = Math.floor(x / S), iz = Math.floor(z / S);
    const t = this.index.get(`${ix}_${iz}`);
    if (t != null) {
      const fx = (x - ix * S) / cell, fz = (z - iz * S) / cell;
      const i = Math.min(N - 2, Math.floor(fx)), j = Math.min(N - 2, Math.floor(fz)), tx = fx - i, tz = fz - j;
      const b = t * N * N, H = this.h;
      const a0 = H[b + j * N + i], a1 = H[b + j * N + i + 1], a2 = H[b + (j + 1) * N + i], a3 = H[b + (j + 1) * N + i + 1];
      return ((a0 * (1 - tx) + a1 * tx) * (1 - tz) + (a2 * (1 - tx) + a3 * tx) * tz) / 10;
    }
    const FS = this.farSize, FN = this.farN, fc = FS / (FN - 1);
    const fx0 = Math.floor(x / FS), fz0 = Math.floor(z / FS);
    const ft = this.farIndex.get(`${fx0}_${fz0}`);
    if (ft == null) return 0;
    const fx = (x - fx0 * FS) / fc, fz = (z - fz0 * FS) / fc;
    const i = Math.min(FN - 2, Math.floor(fx)), j = Math.min(FN - 2, Math.floor(fz)), tx = fx - i, tz = fz - j;
    const b = ft * FN * FN, H = this.farH;
    return ((H[b + j * FN + i] * (1 - tx) + H[b + j * FN + i + 1] * tx) * (1 - tz) + (H[b + (j + 1) * FN + i] * (1 - tx) + H[b + (j + 1) * FN + i + 1] * tx) * tz) / 10;
  }
  landClass(x: number, z: number): number {
    const S = this.size, N = this.n, cell = S / (N - 1);
    const ix = Math.floor(x / S), iz = Math.floor(z / S);
    const t = this.index.get(`${ix}_${iz}`);
    if (t == null) return 0;
    const i = Math.round((x - ix * S) / cell), j = Math.round((z - iz * S) / cell);
    return this.c[t * N * N + j * N + i];
  }
}

/** Shared material for near terrain: blends texture layers with per-vertex weights. */
export function makeTerrainMaterial(layers: THREE.DataArrayTexture, normal: THREE.Texture): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0, normalMap: normal, normalScale: new THREE.Vector2(0.6, 0.6) });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uLayers = { value: layers };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aW0; attribute vec4 aW1; attribute float aW2;\nvarying vec4 vW0; varying vec4 vW1; varying float vW2; varying vec3 vWPos; varying vec3 vNormalWorld;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvW0 = aW0; vW1 = aW1; vW2 = aW2; vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vNormalWorld = normalize(mat3(modelMatrix) * normal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform highp sampler2DArray uLayers;
varying vec4 vW0; varying vec4 vW1; varying float vW2; varying vec3 vWPos; varying vec3 vNormalWorld;
float tHash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float tNoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(tHash(i),tHash(i+vec2(1,0)),f.x), mix(tHash(i+vec2(0,1)),tHash(i+vec2(1,1)),f.x), f.y); }
vec3 layerCol(float L, vec2 uv){
  // two scales to hide tiling
  vec3 a = texture(uLayers, vec3(uv * 0.25, L)).rgb;
  vec3 b = texture(uLayers, vec3(uv * 0.043 + 0.37, L)).rgb;
  return mix(a, b, 0.35);
}`)
      .replace('#include <map_fragment>', `
  vec2 tuv = vWPos.xz;
  vec3 col = vec3(0.0); float wsum = 0.0;
  float ws[9]; ws[0]=vW0.x; ws[1]=vW0.y; ws[2]=vW0.z; ws[3]=vW0.w; ws[4]=vW1.x; ws[5]=vW1.y; ws[6]=vW1.z; ws[7]=vW1.w; ws[8]=vW2;
  for (int i = 0; i < ${LAYERS}; i++) { if (ws[i] > 0.02) { vec3 lc = layerCol(float(i), tuv); if (i == 5) lc *= vec3(0.78, 0.75, 0.72); if (i == 4) lc *= 0.8; if (i == 2) lc *= vec3(0.42, 0.5, 0.32); if (i == 0) lc *= vec3(0.95, 1.0, 0.9); if (i == 1 || i == 7) lc *= vec3(0.78, 1.0, 0.7); if (i == 6) lc *= vec3(0.85, 1.0, 0.8); col += lc * ws[i]; wsum += ws[i]; } }
  col /= max(wsum, 0.001);
  float n = tNoise(vWPos.xz * 0.05) * 0.6 + tNoise(vWPos.xz * 0.21) * 0.4;
  col *= 0.82 + n * 0.32;
  // steep ground (cuttings, embankment faces, the sea wall) shows soil and rock instead of grass
  float slope = 1.0 - clamp(vNormalWorld.y, 0.0, 1.0);
  float rocky = smoothstep(0.17, 0.42, slope + (n - 0.5) * 0.12);
  vec3 soil = layerCol(5.0, tuv) * vec3(0.62, 0.55, 0.48);
  vec3 rock = layerCol(4.0, tuv) * 0.85;
  col = mix(col, mix(soil, rock, smoothstep(0.5, 0.75, slope)), rocky);
  diffuseColor.rgb *= col;`);
  };
  m.customProgramCacheKey = () => 'terrain-v4';
  return m;
}

export function buildNearTile(hf: HeightField, ix: number, iz: number, mat: THREE.Material): THREE.Mesh | null {
  const d = hf.tileHeights(ix, iz);
  if (!d) return null;
  const N = hf.nearN, S = hf.nearSize, cell = S / (N - 1);
  const pos = new Float32Array(N * N * 3), uv = new Float32Array(N * N * 2), w0 = new Float32Array(N * N * 4), w1 = new Float32Array(N * N * 4), w2 = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i;
    pos[k * 3] = i * cell; pos[k * 3 + 1] = d.h[k] / 10; pos[k * 3 + 2] = j * cell;
    uv[k * 2] = (ix * S + i * cell) * 0.25; uv[k * 2 + 1] = (iz * S + j * cell) * 0.25;
    const c = d.c[k];
    // class -> layer: GRASS0 URBAN1 FOREST2 SAND3 ROCK4 BALLAST5 PARK6 FARM7 PAVED8 WATERBED9->sand
    const L = c === 9 ? 3 : c;
    if (L < 4) w0[k * 4 + L] = 1; else if (L < 8) w1[k * 4 + L - 4] = 1; else w2[k] = 1;
  }
  const idx: number[] = [];
  for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) {
    const a = j * N + i, b = a + 1, c = a + N, e = c + 1;
    // pick the diagonal that follows the terrain better
    const ha = pos[a * 3 + 1], hb = pos[b * 3 + 1], hc = pos[c * 3 + 1], he = pos[e * 3 + 1];
    if (Math.abs(ha - he) < Math.abs(hb - hc)) idx.push(a, c, e, a, e, b);
    else idx.push(a, c, b, b, c, e);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('aW0', new THREE.BufferAttribute(w0, 4));
  g.setAttribute('aW1', new THREE.BufferAttribute(w1, 4));
  g.setAttribute('aW2', new THREE.BufferAttribute(w2, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  const m = new THREE.Mesh(g, mat);
  m.position.set(ix * S, 0, iz * S);
  m.receiveShadow = true;
  m.matrixAutoUpdate = false; m.updateMatrix();
  return m;
}

export function makeFarMaterial(layers: THREE.DataArrayTexture): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, vertexColors: true, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 4 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uLayers = { value: layers };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPos2;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos2 = (modelMatrix * vec4(transformed,1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform highp sampler2DArray uLayers;\nvarying vec3 vWPos2;')
      .replace('#include <map_fragment>', 'diffuseColor.rgb *= texture(uLayers, vec3(vWPos2.xz * 0.02, 0.0)).rgb * 2.2;');
  };
  return m;
}

export function buildFarTile(hf: HeightField, ix: number, iz: number, mat: THREE.Material): THREE.Mesh | null {
  const h = hf.farHeights(ix, iz);
  if (!h) return null;
  const N = hf.farTileN, S = hf.farTileSize, cell = S / (N - 1);
  const g = new THREE.PlaneGeometry(S, S, N - 1, N - 1);
  g.rotateX(-Math.PI / 2);
  g.translate(S / 2, 0, S / 2);
  const p = g.attributes.position as THREE.BufferAttribute;
  const col = new Float32Array(p.count * 3);
  for (let k = 0; k < p.count; k++) {
    const i = Math.round(p.getX(k) / cell), j = Math.round(p.getZ(k) / cell);
    const y = h[j * N + i] / 10;
    p.setY(k, y);
    const c = y < 0.5 ? [0.55, 0.5, 0.4] : y > 150 ? [0.35, 0.33, 0.25] : [0.32, 0.38, 0.22];
    col.set(c, k * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat);
  m.position.set(ix * S, 0, iz * S);
  m.matrixAutoUpdate = false; m.updateMatrix();
  return m;
}
