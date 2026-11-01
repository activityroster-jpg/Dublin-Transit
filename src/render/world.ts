// Streams the world around the camera: terrain, track, wires, stations, signals, buildings,
// streets, trees and lineside grass. Builds a few items per frame to avoid hitches.
import * as THREE from 'three';
import type { DartData } from '../dart/data';
import { loadSceneryTile } from '../dart/data';
import type { Network, TrackPath } from '../dart/path';
import type { QualitySettings } from '../core/env';
import { HeightField, buildFarTile, buildNearTile, makeFarMaterial, makeTerrainMaterial } from './terrain';
import { CHUNK, buildOleChunk, buildTrackChunk, makeTrackMaterials, type TrackMaterials } from './track';
import { buildStation } from './stations';
import { buildBuildings } from './buildings';
import { buildStreets } from './streets';
import { buildGrass, buildTrees } from './vegetation';
import { SignalMesh, speedBoard } from './signals';
import { loadTerrainArray, tex } from './textures';
import { rng } from '../core/rand';

interface Item { obj: THREE.Object3D | null; pending?: boolean }

function disposeObj(o: THREE.Object3D) {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    // Shared module-level geometries (unit boxes, tree crowns) are kept; per-item ones are freed.
    if (m.geometry && m.geometry.userData.keep !== true && (m.geometry.type === 'BufferGeometry' || m.geometry.type === 'ExtrudeGeometry' || m.geometry.type === 'PlaneGeometry')) m.geometry.dispose();
    const mat = m.material as THREE.MeshStandardMaterial | undefined;
    if (mat && mat.userData?.perItem) { mat.map?.dispose(); mat.dispose(); }
    if (m instanceof THREE.InstancedMesh) m.dispose();
  });
}

export class World {
  readonly group = new THREE.Group();
  readonly hf: HeightField;
  private items = new Map<string, Item>();
  private queue: { key: string; dist: number; build: () => THREE.Object3D | null | Promise<THREE.Object3D | null> }[] = [];
  private terrainMat!: THREE.Material;
  private farMat!: THREE.Material;
  private trackMats: TrackMaterials;
  private lastCheck = -1;
  readonly playerSignals = new Map<number, SignalMesh>();
  private ready = false;

  constructor(private data: DartData, private net: Network, private q: QualitySettings, private playerPath: TrackPath) {
    this.hf = new HeightField(data);
    this.trackMats = makeTrackMaterials();
  }

  async init() {
    const layers = await loadTerrainArray(this.q.quality === 'low' ? 256 : 512);
    this.terrainMat = makeTerrainMaterial(layers, tex('groundnormal_nor_gl', 1, false));
    this.farMat = makeFarMaterial(layers);
    this.ready = true;
  }

  /** Build everything near a point immediately (used while the loading screen is up). */
  async prime(cam: THREE.Vector3, onProgress: (f: number) => void) {
    this.update(cam, 0, true);
    const total = this.queue.length;
    while (this.queue.length) {
      await this.process(12);
      onProgress(1 - this.queue.length / Math.max(1, total));
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  private want(key: string, dist: number, build: () => THREE.Object3D | null | Promise<THREE.Object3D | null>, needed: Set<string>) {
    needed.add(key);
    if (this.items.has(key)) return;
    this.items.set(key, { obj: null, pending: true });
    this.queue.push({ key, dist, build });
  }

  update(cam: THREE.Vector3, time: number, force = false) {
    if (!this.ready) return;
    if (!force && time - this.lastCheck < 0.4) { void this.process(this.q.quality === 'low' ? 2 : 4); return; }
    this.lastCheck = time;
    const needed = new Set<string>();
    const VD = this.q.viewDistance;
    const hf = this.hf;
    // near terrain
    const S = hf.nearSize, r = Math.ceil(VD / S);
    const cx = Math.floor(cam.x / S), cz = Math.floor(cam.z / S);
    for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
      const ix = cx + i, iz = cz + j;
      const d = Math.hypot((ix + 0.5) * S - cam.x, (iz + 0.5) * S - cam.z);
      if (d > VD + S || !hf.hasNear(ix, iz)) continue;
      this.want(`tn${ix}_${iz}`, d, () => buildNearTile(hf, ix, iz, this.terrainMat), needed);
    }
    // far terrain within 14 km
    const FS = hf.farTileSize, fr = Math.ceil(14000 / FS);
    const fx = Math.floor(cam.x / FS), fz = Math.floor(cam.z / FS);
    for (let i = -fr; i <= fr; i++) for (let j = -fr; j <= fr; j++) {
      const ix = fx + i, iz = fz + j;
      const d = Math.hypot((ix + 0.5) * FS - cam.x, (iz + 0.5) * FS - cam.z);
      if (d > 14000 + FS) continue;
      this.want(`tf${ix}_${iz}`, d + 3000, () => buildFarTile(hf, ix, iz, this.farMat), needed);
    }
    // track, wires, stations, signals, speed boards
    for (const path of this.net.paths) {
      const own = this.net.owner.get(path.id)!;
      const pr = path.project(cam.x, cam.z);
      if (pr.d > VD + 400) continue;
      const lo = Math.max(0, Math.floor((pr.s - VD - 400) / CHUNK)), hi = Math.min(Math.floor(path.length / CHUNK), Math.floor((pr.s + VD + 400) / CHUNK));
      for (let ci = lo; ci <= hi; ci++) {
        const mid = path.point((ci + 0.5) * CHUNK);
        const d = mid.distanceTo(cam);
        if (d > VD) continue;
        this.want(`tr${path.id}${ci}`, d, () => buildTrackChunk(path, own, ci, this.trackMats, d < 600 ? 1 : 0), needed);
        if (d < Math.min(VD, 1500)) this.want(`ol${path.id}${ci}`, d + 50, () => buildOleChunk(path, own, ci, this.trackMats), needed);
        if (this.q.grassDensity > 0 && path === this.playerPath && d < 350) this.want(`gr${path.id}${ci}`, d + 100, () => this.buildGrassChunk(path, ci), needed);
      }
      path.data.stations.forEach((st, k) => {
        const i = Math.round(((st.platform.s0 + st.platform.s1) / 2) / path.step);
        if (!own[Math.min(i, own.length - 1)]) return;
        const p = path.point(st.s);
        const d = p.distanceTo(cam);
        if (d < VD) this.want(`st${path.id}${k}`, d, () => buildStation(path, st, path.point((st.platform.s0 + st.platform.s1) / 2)), needed);
      });
      path.data.signals.forEach((sg, k) => {
        const p = path.point(sg.s), d = p.distanceTo(cam);
        if (d > Math.min(VD, 1400)) return;
        this.want(`sg${path.id}${k}`, d, () => {
          const m = new SignalMesh(path, sg.s, sg.pos === 'right' ? 1 : -1, sg.ref ?? `${path.northbound ? 'DN' : 'UP'} ${Math.round(sg.s / 100) + 100}`, !!sg.repeater);
          if (path === this.playerPath) this.playerSignals.set(sg.s, m); else m.setAspect('G', 3);
          return m.group;
        }, needed);
      });
      path.data.speed.forEach(([s0, kmh], k) => {
        if (k === 0) return;
        const d = path.point(s0).distanceTo(cam);
        if (d < 900) this.want(`sp${path.id}${k}`, d, () => speedBoard(path, Math.max(0, s0 - 10), Math.round(kmh / 1.609344 / 5) * 5), needed);
      });
    }
    // scenery tiles
    const SC = this.data.terrain.scenery.size;
    const sr = Math.ceil(VD / SC);
    const sx = Math.floor(cam.x / SC), sz = Math.floor(cam.z / SC);
    const have = new Set(this.data.terrain.scenery.tiles);
    for (let i = -sr; i <= sr; i++) for (let j = -sr; j <= sr; j++) {
      const key = `${sx + i}_${sz + j}`;
      if (!have.has(key)) continue;
      const d = Math.hypot((sx + i + 0.5) * SC - cam.x, (sz + j + 0.5) * SC - cam.z);
      if (d > VD + SC * 0.7) continue;
      this.want(`sc${key}`, d, async () => {
        const tile = await loadSceneryTile(key);
        if (!tile) return null;
        const origin = new THREE.Vector3((sx + i + 0.5) * SC, 0, (sz + j + 0.5) * SC);
        const g = new THREE.Group(); g.position.copy(origin);
        g.add(buildBuildings(tile.b, origin), buildStreets(tile, origin));
        if (d < this.q.treeDistance + SC) g.add(buildTrees(tile.t, origin, this.q.quality !== 'low'));
        g.traverse((o) => { o.matrixAutoUpdate = false; o.updateMatrix(); });
        return g;
      }, needed);
    }
    // drop items out of range (with the needed set as hysteresis)
    for (const [key, it] of this.items) {
      if (needed.has(key)) continue;
      if (it.obj) { this.group.remove(it.obj); disposeObj(it.obj); }
      this.items.delete(key);
      if (key.startsWith('sg') && key.startsWith(`sg${this.playerPath.id}`)) {
        const k = +key.slice(2 + this.playerPath.id.length);
        const sgs = this.playerPath.data.signals[k];
        if (sgs) this.playerSignals.delete(sgs.s);
      }
    }
    this.queue = this.queue.filter((q) => needed.has(q.key));
    this.queue.sort((a, b) => a.dist - b.dist);
    void this.process(4);
  }

  private async process(n: number) {
    for (let k = 0; k < n && this.queue.length; k++) {
      const job = this.queue.shift()!;
      const it = this.items.get(job.key);
      if (!it) continue;
      const res = job.build();
      const obj = res instanceof Promise ? await res : res;
      if (!this.items.has(job.key)) { if (obj) disposeObj(obj); continue; }
      it.obj = obj; it.pending = false;
      if (obj) this.group.add(obj);
    }
  }

  get pendingCount() { return this.queue.length; }

  private buildGrassChunk(path: TrackPath, ci: number): THREE.Object3D | null {
    const s0 = ci * CHUNK, s1 = Math.min(path.length, s0 + CHUNK);
    const r = rng(ci * 7919 + path.id.length);
    const dens = this.q.grassDensity;
    const n = Math.floor((s1 - s0) * 9 * dens);
    const pts = new Float32Array(n * 4);
    let k = 0;
    const p = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const s = s0 + r() * (s1 - s0);
      const st = path.structure(s);
      if (st && st[2] !== 'cutting' && st[2] !== 'embankment') continue;
      if (path.data.stations.some((q) => s > q.platform.s0 - 5 && s < q.platform.s1 + 5)) continue;
      const side = r() < 0.5 ? -1 : 1;
      const lat = side * (3.6 + r() * r() * 9);
      path.offsetPoint(s, lat, 0, p);
      const cls = this.hf.landClass(p.x, p.z);
      if (cls === 3 || cls === 4 || cls === 8 || cls === 9) continue;
      const y = this.hf.height(p.x, p.z);
      if (y < 0.4) continue;
      pts[k * 4] = p.x; pts[k * 4 + 1] = y; pts[k * 4 + 2] = p.z; pts[k * 4 + 3] = r();
      k++;
    }
    if (!k) return null;
    const origin = path.point((s0 + s1) / 2);
    const g = new THREE.Group(); g.position.copy(origin);
    g.add(buildGrass(pts, k, origin));
    return g;
  }
}
