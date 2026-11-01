// CC0 scanned models (Poly Haven, glTF) with a cache and helpers to scatter them as instances.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { windUniforms } from './vegetation';

const BASE = `${import.meta.env.BASE_URL}assets/models/`;
const loader = new GLTFLoader();

export interface ModelPart { geometry: THREE.BufferGeometry; material: THREE.Material }
export interface Model { id: string; parts: ModelPart[]; bbox: THREE.Box3; variants: ModelPart[][]; names: string[] }

const cache = new Map<string, Promise<Model>>();

/** Adds wind sway to a foliage material (instanced). */
function foliage(m: THREE.MeshStandardMaterial, strength: number) {
  m.alphaTest = 0.45; m.side = THREE.DoubleSide; m.transparent = false; m.depthWrite = true;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = windUniforms.uTime;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
  #ifdef USE_INSTANCING
  vec3 ip = instanceMatrix[3].xyz;
  #else
  vec3 ip = vec3(0.0);
  #endif
  float sw = sin(uTime * 1.4 + ip.x * 0.2 + ip.z * 0.13) * 0.6 + sin(uTime * 2.9 + ip.z * 0.4) * 0.3;
  transformed.xz += vec2(sw, sw * 0.5) * ${strength.toFixed(3)} * max(0.0, transformed.y);`);
  };
  m.customProgramCacheKey = () => 'gltf-foliage' + strength;
}

const FOLIAGE: Record<string, number> = { shrub_02: 0.02, shrub_03: 0.03, shrub_04: 0.02, grass_medium_01: 0.05, grass_medium_02: 0.05, weed_plant_02: 0.04, nettle_plant: 0.04 };

/**
 * Loads a model. `variants` groups the top-level meshes of "set" assets (grass clumps, rock sets)
 * so each can be scattered individually; `parts` is everything merged by material.
 */
export function loadModel(id: string): Promise<Model> {
  let p = cache.get(id);
  if (!p) {
    p = new Promise<Model>((resolve, reject) => {
      loader.load(`${BASE}${id}/${id}.gltf`, (gltf) => {
        gltf.scene.updateMatrixWorld(true);
        const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
        const variants: ModelPart[][] = [];
        const topLevel = new Map<THREE.Object3D, Map<THREE.Material, THREE.BufferGeometry[]>>();
        gltf.scene.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          const g = m.geometry.clone();
          g.applyMatrix4(m.matrixWorld);
          if (m.material instanceof THREE.MeshStandardMaterial) {
            m.material.side = THREE.FrontSide;
            if (FOLIAGE[id] != null) foliage(m.material, FOLIAGE[id]);
          }
          const mat = m.material as THREE.Material;
          if (!byMat.has(mat)) byMat.set(mat, []);
          byMat.get(mat)!.push(g);
          // top-level ancestor under the scene
          let top: THREE.Object3D = m;
          while (top.parent && top.parent !== gltf.scene) top = top.parent;
          if (!topLevel.has(top)) topLevel.set(top, new Map());
          const tm = topLevel.get(top)!;
          if (!tm.has(mat)) tm.set(mat, []);
          tm.get(mat)!.push(g.clone());
        });
        const normalise = (g: THREE.BufferGeometry) => {
          // a uniform attribute set (merge needs it) and non-indexed geometry (instancing doesn't care)
          const ng = g.index ? g.toNonIndexed() : g;
          for (const k of Object.keys(ng.attributes)) if (!['position', 'normal', 'uv'].includes(k)) ng.deleteAttribute(k);
          if (!ng.attributes.normal) ng.computeVertexNormals();
          if (!ng.attributes.uv) ng.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(ng.attributes.position.count * 2), 2));
          ng.morphAttributes = {};
          return ng;
        };
        const merge = (map: Map<THREE.Material, THREE.BufferGeometry[]>): ModelPart[] => {
          const out: ModelPart[] = [];
          for (const [material, geos] of map) {
            const flat = geos.map(normalise);
            const merged = flat.length === 1 ? flat[0] : mergeGeometries(flat, false);
            if (!merged) { console.warn('model merge failed', id); continue; }
            const geometry = merged;
            geometry.userData.keep = true;
            geometry.computeBoundingSphere();
            out.push({ geometry, material });
          }
          return out;
        };
        const parts = merge(byMat);
        const names: string[] = [];
        for (const [top, tm] of topLevel) { variants.push(merge(tm)); names.push(top.name); }
        const bbox = new THREE.Box3();
        for (const p of parts) { p.geometry.computeBoundingBox(); bbox.union(p.geometry.boundingBox!); }
        // Re-centre variants on their own footprint so each sits on the ground at its origin.
        for (const v of variants) {
          const b = new THREE.Box3();
          for (const p of v) { p.geometry.computeBoundingBox(); b.union(p.geometry.boundingBox!); }
          const c = b.getCenter(new THREE.Vector3());
          for (const p of v) { p.geometry.translate(-c.x, -b.min.y, -c.z); p.geometry.computeBoundingSphere(); }
        }
        resolve({ id, parts, bbox, variants, names });
      }, undefined, reject);
    });
    cache.set(id, p);
  }
  return p;
}

/** Instances every part of a model at the given matrices (local to the returned group). */
export function instance(parts: ModelPart[], matrices: THREE.Matrix4[], castShadow = true, colours?: THREE.Color[]): THREE.Group {
  const g = new THREE.Group();
  if (!matrices.length) return g;
  for (const p of parts) {
    const im = new THREE.InstancedMesh(p.geometry, p.material, matrices.length);
    matrices.forEach((m, i) => im.setMatrixAt(i, m));
    if (colours) colours.forEach((c, i) => im.setColorAt(i, c));
    im.castShadow = castShadow; im.receiveShadow = true;
    im.frustumCulled = true;
    g.add(im);
  }
  return g;
}

/** Instances variant k of a "set" model (grass clumps, rocks, bench modules). */
export function instanceVariant(model: Model, k: number | string, matrices: THREE.Matrix4[], castShadow = true, colours?: THREE.Color[]): THREE.Group {
  const i = typeof k === 'string' ? Math.max(0, model.names.indexOf(k)) : k % model.variants.length;
  return instance(model.variants[i], matrices, castShadow, colours);
}

const _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
export function placement(x: number, y: number, z: number, yaw: number, scale: number, out = new THREE.Matrix4()): THREE.Matrix4 {
  return out.compose(_p.set(x, y, z), _q.setFromAxisAngle(_up, yaw), _s.set(scale, scale, scale));
}

/** Preloads the models the world needs so builders don't stall. */
export function preloadWorldModels(): Promise<Model[]> {
  return Promise.all(['shrub_02', 'shrub_03', 'shrub_04', 'grass_medium_02', 'weed_plant_02', 'nettle_plant', 'street_lamp_01', 'painted_wooden_bench', 'metal_trash_can', 'rock_moss_set_01'].map(loadModel));
}
