// Builds the static world around the DART network:
//   public/data/dart/terrain-near.bin (+ terrain.json index): 256 m tiles, 4 m grid, carved to the railway
//   public/data/dart/terrain-far.bin: 2048 m tiles, 32 m grid, for the horizon
//   public/data/dart/scenery/<ix>_<iz>.json: buildings, roads, trees, walls, lamps in 512 m tiles
// Sources: OpenStreetMap (ODbL), AWS Terrain Tiles.
import fs from 'node:fs';
import path from 'node:path';
import { OUT, RAW, project, unproject, readJson, round } from './lib.mjs';
import { Dem } from './fetch-dem.mjs';
import { SegHash, joinRings, pointInRing, ringBBox, ringArea, mulberry32 } from './geom.mjs';

export const NEAR = { size: 256, n: 65 };   // 4 m grid
export const FAR = { size: 2048, n: 65 };   // 32 m grid
export const SCN = 512;                     // scenery tile size
const NEAR_RADIUS = 520;
export const CLS = { GRASS: 0, URBAN: 1, FOREST: 2, SAND: 3, ROCK: 4, BALLAST: 5, PARK: 6, FARM: 7, PAVED: 8, WATERBED: 9 };

function loadOsm() {
  const dir = path.join(RAW, 'osm', 'map');
  const nodes = new Map(), ways = new Map(), rels = new Map();
  for (const f of fs.readdirSync(dir)) {
    for (const e of JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).elements) {
      (e.type === 'node' ? nodes : e.type === 'way' ? ways : rels).set(e.id, e);
    }
  }
  return { nodes, ways, rels };
}

export async function buildWorld() {
  const net = readJson('dart/network.json');
  const osm = loadOsm();
  console.log(`osm: ${osm.nodes.size} nodes, ${osm.ways.size} ways, ${osm.rels.size} relations`);
  const P = (id) => { const n = osm.nodes.get(id); return n ? project(n.lat, n.lon) : null; };

  // ---- Track index (all four paths) ----
  const track = new SegHash(32);
  const structAt = (p, s) => { for (const st of p.structures) if (s >= st[0] && s <= st[1]) return st; return null; };
  let bx0 = Infinity, bz0 = Infinity, bx1 = -Infinity, bz1 = -Infinity;
  for (const p of net.paths) {
    const n = p.pts.length / 3;
    for (let i = 0; i < n - 1; i++) {
      const ax = p.pts[i * 3], ay = p.pts[i * 3 + 1], az = p.pts[i * 3 + 2], bx = p.pts[i * 3 + 3], by = p.pts[i * 3 + 4], bz = p.pts[i * 3 + 5];
      const st = structAt(p, i * p.step);
      track.add(ax, az, bx, bz, { ya: ay, yb: by, kind: st ? st[2] : null, path: p.id, s: i * p.step });
      bx0 = Math.min(bx0, ax); bz0 = Math.min(bz0, az); bx1 = Math.max(bx1, ax); bz1 = Math.max(bz1, az);
    }
  }
  const trackInfo = (x, z, r) => {
    const h = track.nearest(x, z, r);
    if (!h) return null;
    return { d: h.d, y: h.seg.data.ya + (h.seg.data.yb - h.seg.data.ya) * h.t, kind: h.seg.data.kind, side: h.side, seg: h.seg };
  };

  // ---- DEMs ----
  const [la0, lo0] = unproject(bx0 - 7000, bz1 + 7000), [la1, lo1] = unproject(bx1 + 7000, bz0 - 7000);
  const demNear = new Dem(14);
  const [nla0, nlo0] = unproject(bx0 - 800, bz1 + 800), [nla1, nlo1] = unproject(bx1 + 800, bz0 - 800);
  await demNear.load(nla0, nlo0, nla1, nlo1);
  const demFar = new Dem(11);
  await demFar.load(la0, lo0, la1, lo1);
  const natural = (x, z) => { const [la, lo] = unproject(x, z); return demNear.height(la, lo); };
  const naturalFar = (x, z) => { const [la, lo] = unproject(x, z); return demFar.height(la, lo); };

  // ---- Polygons: landcover, water, buildings ----
  const polys = []; // {ring:[flat], tags, kind}
  const addPoly = (ring, tags, src) => { if (ring.length >= 8) polys.push({ ring, tags, bbox: ringBBox(ring), src }); };
  for (const w of osm.ways.values()) {
    if (!w.tags || w.nodes[0] !== w.nodes[w.nodes.length - 1]) continue;
    const ring = []; let ok = true;
    for (const id of w.nodes) { const q = P(id); if (!q) { ok = false; break; } ring.push(q[0], q[1]); }
    if (ok) addPoly(ring, w.tags, w.id);
  }
  for (const r of osm.rels.values()) {
    if (r.tags?.type !== 'multipolygon') continue;
    const outers = r.members.filter((m) => m.type === 'way' && m.role === 'outer').map((m) => osm.ways.get(m.ref));
    if (outers.some((w) => !w)) continue;
    for (const ringIds of joinRings(outers.map((w) => w.nodes))) {
      const ring = []; let ok = true;
      for (const id of ringIds) { const q = P(id); if (!q) { ok = false; break; } ring.push(q[0], q[1]); }
      if (ok) addPoly(ring, r.tags, 'r' + r.id);
    }
  }
  const landClass = (t) => {
    const lu = t.landuse, na = t.natural, le = t.leisure;
    if (na === 'water' || t.waterway === 'riverbank' || lu === 'reservoir' || lu === 'basin') return 'water';
    if (na === 'wood' || lu === 'forest' || na === 'scrub' || na === 'heath') return CLS.FOREST;
    if (na === 'beach' || na === 'sand' || na === 'mud' || na === 'wetland') return CLS.SAND;
    if (na === 'bare_rock' || na === 'scree' || na === 'shingle' || na === 'cliff') return CLS.ROCK;
    if (le === 'park' || le === 'garden' || le === 'pitch' || le === 'golf_course' || le === 'recreation_ground' || lu === 'grass' || lu === 'cemetery' || lu === 'village_green' || le === 'common') return CLS.PARK;
    if (lu === 'farmland' || lu === 'meadow' || lu === 'orchard' || lu === 'allotments') return CLS.FARM;
    if (lu === 'residential' || lu === 'commercial' || lu === 'retail' || lu === 'industrial' || lu === 'construction' || lu === 'brownfield' || lu === 'garages') return CLS.URBAN;
    if (t.amenity === 'parking' || t.highway === 'pedestrian' || t.place === 'square' || lu === 'railway') return CLS.PAVED;
    return null;
  };
  const land = [], water = [], buildings = [], woods = [];
  for (const p of polys) {
    if (p.tags.building || p.tags['building:part']) { if (p.tags.building) buildings.push(p); continue; }
    const c = landClass(p.tags);
    if (c === 'water') water.push(p);
    else if (c != null) { land.push({ ...p, cls: c, area: Math.abs(ringArea(p.ring)) }); if (c === CLS.FOREST || c === CLS.PARK) woods.push({ ...p, cls: c }); }
  }
  land.sort((a, b) => b.area - a.area); // big first, small (more specific) last wins
  console.log(`polygons: ${land.length} landcover, ${water.length} water, ${buildings.length} buildings`);

  // Coastline (OSM: land on the left of the way, sea on the right). A jump-flood distance
  // transform on a 32 m grid gives every point its nearest coast sample, so the sea side is
  // known at any distance (SRTM is garbage over water: Killiney Bay reads 30 m).
  const coastSeeds = []; // [x, z, dirx, dirz]
  for (const w of osm.ways.values()) {
    if (w.tags?.natural !== 'coastline') continue;
    for (let i = 0; i < w.nodes.length - 1; i++) {
      const a = P(w.nodes[i]), b = P(w.nodes[i + 1]); if (!a || !b) continue;
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 0.01) continue;
      const dx = (b[0] - a[0]) / L, dz = (b[1] - a[1]) / L;
      for (let t = 0; t < L; t += 12) coastSeeds.push([a[0] + dx * t, a[1] + dz * t, dx, dz]);
    }
  }
  const CG = 32;
  const gx0 = Math.floor((bx0 - 7000) / CG), gz0 = Math.floor((bz0 - 7000) / CG), gw = Math.ceil((bx1 - bx0 + 14000) / CG), gh = Math.ceil((bz1 - bz0 + 14000) / CG);
  const nearest = new Int32Array(gw * gh).fill(-1);
  for (let i = 0; i < coastSeeds.length; i++) {
    const [x, z] = coastSeeds[i];
    const cx = Math.floor(x / CG) - gx0, cz = Math.floor(z / CG) - gz0;
    if (cx >= 0 && cx < gw && cz >= 0 && cz < gh) nearest[cz * gw + cx] = i;
  }
  const d2 = (i, cx, cz) => { const sd = coastSeeds[i]; const px = (gx0 + cx + 0.5) * CG, pz = (gz0 + cz + 0.5) * CG; return (sd[0] - px) ** 2 + (sd[1] - pz) ** 2; };
  for (let step = 1 << Math.ceil(Math.log2(Math.max(gw, gh))); step >= 1; step >>= 1) {
    const prev = Int32Array.from(nearest);
    for (let cz = 0; cz < gh; cz++) for (let cx = 0; cx < gw; cx++) {
      let best = prev[cz * gw + cx], bd = best >= 0 ? d2(best, cx, cz) : Infinity;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
        if (!i && !j) continue;
        const nx = cx + i * step, nz = cz + j * step;
        if (nx < 0 || nz < 0 || nx >= gw || nz >= gh) continue;
        const c = prev[nz * gw + nx];
        if (c < 0) continue;
        const dd = d2(c, cx, cz);
        if (dd < bd) { bd = dd; best = c; }
      }
      nearest[cz * gw + cx] = best;
    }
  }
  console.log(`coast: ${coastSeeds.length} samples, grid ${gw}x${gh}`);
  /** { d: distance to the coast, sea: boolean } or null far from any coast. */
  const coastInfo = (x, z) => {
    const cx = Math.floor(x / CG) - gx0, cz = Math.floor(z / CG) - gz0;
    if (cx < 0 || cz < 0 || cx >= gw || cz >= gh) return null;
    const i = nearest[cz * gw + cx];
    if (i < 0) return null;
    const sd = coastSeeds[i];
    const rx = x - sd[0], rz = z - sd[1];
    const cross = sd[2] * rz - sd[3] * rx;
    return { d: Math.hypot(rx, rz), sea: cross > 0 };
  };

  // ---- Near terrain tiles ----
  const nearTiles = new Set();
  for (const s of track.segs) {
    const r = Math.ceil(NEAR_RADIUS / NEAR.size);
    const cx = Math.floor(s.ax / NEAR.size), cz = Math.floor(s.az / NEAR.size);
    for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
      const tx = (cx + i + 0.5) * NEAR.size, tz = (cz + j + 0.5) * NEAR.size;
      if (Math.hypot(tx - s.ax, tz - s.az) < NEAR_RADIUS + NEAR.size * 0.71) nearTiles.add(`${cx + i}_${cz + j}`);
    }
  }
  const nearList = [...nearTiles].map((k) => k.split('_').map(Number)).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  console.log(`near terrain: ${nearList.length} tiles`);
  const N = NEAR.n, cell = NEAR.size / (N - 1);
  const nearBuf = Buffer.alloc(nearList.length * N * N * 3);
  const heightCache = new Map(); // key -> Float32Array for road/building draping
  const tunnelPortals = [];
  let off = 0;
  for (const [ix, iz] of nearList) {
    const x0 = ix * NEAR.size, z0 = iz * NEAR.size;
    const H = new Float32Array(N * N), C = new Uint8Array(N * N);
    // landcover raster
    const tb = [x0, z0, x0 + NEAR.size, z0 + NEAR.size];
    const overl = (b) => b[0] <= tb[2] && b[2] >= tb[0] && b[1] <= tb[3] && b[3] >= tb[1];
    const myLand = land.filter((p) => overl(p.bbox)), myWater = water.filter((p) => overl(p.bbox)), myBld = buildings.filter((p) => overl(p.bbox));
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = x0 + i * cell, z = z0 + j * cell, k = j * N + i;
      let h = natural(x, z), c = CLS.GRASS;
      for (const p of myLand) if (x >= p.bbox[0] && x <= p.bbox[2] && z >= p.bbox[1] && z <= p.bbox[3] && pointInRing(x, z, p.ring)) c = p.cls;
      for (const p of myBld) if (x >= p.bbox[0] && x <= p.bbox[2] && z >= p.bbox[1] && z <= p.bbox[3] && pointInRing(x, z, p.ring)) { c = CLS.PAVED; break; }
      let inWater = false;
      for (const p of myWater) if (x >= p.bbox[0] && x <= p.bbox[2] && z >= p.bbox[1] && z <= p.bbox[3] && pointInRing(x, z, p.ring)) { inWater = true; break; }
      if (h < -50) h = -3; // DEM void
      // coastline: crisp shore
      const cs = coastInfo(x, z);
      if (cs) {
        if (cs.sea) { h = Math.min(h, -0.6 - cs.d * 0.04); c = CLS.SAND; }
        else if (cs.d < 100) {
          // shore: ease the land down to a beach/shingle slope rather than a wall (SRTM smears
          // hills onto beaches); genuine cliffs above ~35 m are kept
          const shore = 0.5 + cs.d * 0.16;
          if (h > shore && h < 35) h = shore + (h - shore) * (cs.d / 100) ** 2;
          h = Math.max(h, 0.4 + cs.d * 0.02);
          if (cs.d < 18 && c === CLS.GRASS) c = CLS.SAND;
        }
      }
      if (inWater) { h = Math.min(h, -1.2); c = CLS.WATERBED; }
      // carve to the railway formation
      const ti = trackInfo(x, z, 70);
      if (ti) {
        const form = ti.y - 0.8;
        if (ti.kind === 'bridge' || ti.kind === 'viaduct') {
          if (ti.d < 14) h = Math.min(h, ti.y - 5.5);
        } else if (ti.kind === 'tunnel') {
          h = Math.max(h, ti.y + 7.5);
        } else {
          const core = 2.7;
          if (ti.d < core) { h = form; c = CLS.BALLAST; }
          else {
            const w = Math.max(2.5, Math.abs(h - form) * 1.6);
            if (ti.d < core + w) {
              const t = (ti.d - core) / w, sm = t * t * (3 - 2 * t);
              const nh = form + (h - form) * sm;
              if (h < form - 0.3 && h < 1.0 && ti.d < core + 6) c = CLS.ROCK; // sea-wall rock armour
              else if (ti.d < core + 0.7) c = CLS.BALLAST;
              h = nh;
            }
          }
        }
      }
      H[k] = h; C[k] = c;
    }
    heightCache.set(`${ix}_${iz}`, H);
    for (let k = 0; k < N * N; k++) { nearBuf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(H[k] * 10))), off); off += 2; }
    for (let k = 0; k < N * N; k++) nearBuf[off++] = C[k];
  }
  fs.writeFileSync(path.join(OUT, 'dart', 'terrain-near.bin'), nearBuf);

  // Height lookup on carved near terrain (falls back to natural DEM)
  const heightAt = (x, z) => {
    const ix = Math.floor(x / NEAR.size), iz = Math.floor(z / NEAR.size);
    const H = heightCache.get(`${ix}_${iz}`);
    if (!H) return natural(x, z);
    const fx = (x - ix * NEAR.size) / cell, fz = (z - iz * NEAR.size) / cell;
    const i = Math.min(N - 2, Math.floor(fx)), j = Math.min(N - 2, Math.floor(fz)), tx = fx - i, tz = fz - j;
    const a = H[j * N + i], b = H[j * N + i + 1], c = H[(j + 1) * N + i], d = H[(j + 1) * N + i + 1];
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  };

  // ---- Far terrain ----
  const farList = [];
  for (let iz = Math.floor((bz0 - 6000) / FAR.size); iz <= Math.floor((bz1 + 6000) / FAR.size); iz++)
    for (let ix = Math.floor((bx0 - 6000) / FAR.size); ix <= Math.floor((bx1 + 6000) / FAR.size); ix++) farList.push([ix, iz]);
  const FN = FAR.n, fcell = FAR.size / (FN - 1);
  const farBuf = Buffer.alloc(farList.length * FN * FN * 2);
  off = 0;
  for (const [ix, iz] of farList) {
    for (let j = 0; j < FN; j++) for (let i = 0; i < FN; i++) {
      const x = ix * FAR.size + i * fcell, z = iz * FAR.size + j * fcell;
      let h = naturalFar(x, z);
      if (h < -50) h = -3;
      const cs = coastInfo(x, z);
      if (cs && cs.sea) h = Math.min(h, -1 - cs.d * 0.03);
      // Where detailed tiles exist, follow the carved near terrain (slightly below it) so the
      // backdrop never pokes through cuttings or the carved coast.
      const covered = [[-1, -1], [1, -1], [-1, 1], [1, 1]].every(([a, b]) => nearTiles.has(`${Math.floor((x + a * fcell) / NEAR.size)}_${Math.floor((z + b * fcell) / NEAR.size)}`));
      if (covered) h = heightAt(x, z) - 1.5;
      farBuf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(h * 10))), off); off += 2;
    }
  }
  fs.writeFileSync(path.join(OUT, 'dart', 'terrain-far.bin'), farBuf);

  // ---- Scenery ----
  const tiles = new Map();
  const tileOf = (x, z) => { const k = `${Math.floor(x / SCN)}_${Math.floor(z / SCN)}`; if (!tiles.has(k)) tiles.set(k, { b: [], r: [], t: [], f: [], l: [], w: [] }); return tiles.get(k); };
  const nearTrack = (x, z, r) => track.nearest(x, z, r);
  const q = (v) => Math.round(v * 10) / 10;

  // Buildings
  const bKind = (t) => {
    const b = t.building;
    if (['house', 'detached', 'semidetached_house', 'terrace', 'bungalow', 'residential'].includes(b)) return 'house';
    if (['apartments', 'flats', 'dormitory', 'hotel'].includes(b)) return 'apartments';
    if (['commercial', 'retail', 'office', 'supermarket', 'shop'].includes(b)) return 'commercial';
    if (['industrial', 'warehouse', 'factory', 'depot', 'hangar', 'service', 'transformer_tower'].includes(b)) return 'industrial';
    if (['church', 'cathedral', 'chapel', 'religious'].includes(b)) return 'church';
    if (['garage', 'garages', 'shed', 'hut', 'cabin', 'carport', 'kiosk', 'toilets'].includes(b)) return 'shed';
    if (['roof', 'canopy'].includes(b)) return 'roof';
    if (['train_station', 'transportation', 'station'].includes(b)) return 'station';
    if (['school', 'college', 'university', 'public', 'civic', 'government', 'hospital', 'library'].includes(b)) return 'civic';
    return 'generic';
  };
  const defH = { house: 7.5, apartments: 13, commercial: 11, industrial: 8, church: 16, shed: 3, roof: 4, station: 7, civic: 11, generic: 8 };
  let nb = 0;
  for (const p of buildings) {
    const [x0, z0, x1, z1] = p.bbox, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    if (!nearTrack(cx, cz, 600)) continue;
    const t = p.tags, kind = bKind(t);
    let h = parseFloat(t.height) || (t['building:levels'] ? parseFloat(t['building:levels']) * 3.1 + (kind === 'house' ? 1.6 : 1) : defH[kind]);
    let minH = parseFloat(t.min_height) || (t['building:min_level'] ? parseFloat(t['building:min_level']) * 3.1 : 0);
    if (kind === 'roof' && !minH) { minH = Math.max(0, h - 1.2); }
    let base = Infinity;
    for (let i = 0; i < p.ring.length; i += 2) base = Math.min(base, heightAt(p.ring[i], p.ring[i + 1]));
    const ring = []; for (let i = 0; i < p.ring.length - 2; i += 2) ring.push(q(p.ring[i]), q(p.ring[i + 1]));
    const roof = t['roof:shape'] ?? (kind === 'house' && Math.abs(ringArea(p.ring)) < 260 ? 'gabled' : kind === 'church' ? 'gabled' : 'flat');
    tileOf(cx, cz).b.push([ring, round(base, 1), round(h, 1), round(minH, 1), kind, roof, t['building:colour'] ?? null, t['roof:colour'] ?? null, t.name ?? null]);
    nb++;
  }

  // Roads, paths, rail sidings and barriers (draped)
  const roadW = { motorway: 11, trunk: 10, primary: 9, secondary: 8, tertiary: 7, unclassified: 6, residential: 6, service: 4, living_street: 5, pedestrian: 6, footway: 2, cycleway: 2.2, path: 1.6, track: 3, steps: 2, motorway_link: 6, trunk_link: 6, primary_link: 6, secondary_link: 6 };
  let nr = 0, nf = 0;
  const drape = (pts, lift, bridgeY) => {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      if (i > 0) {
        const b = pts[i - 1], L = Math.hypot(a[0] - b[0], a[1] - b[1]), k = Math.floor(L / 8);
        for (let s = 1; s < k; s++) { const x = b[0] + ((a[0] - b[0]) * s) / k, z = b[1] + ((a[1] - b[1]) * s) / k; out.push(q(x), q(z), q((bridgeY ?? heightAt(x, z)) + lift)); }
      }
      out.push(q(a[0]), q(a[1]), q((bridgeY ?? heightAt(a[0], a[1])) + lift));
    }
    return out;
  };
  for (const w of osm.ways.values()) {
    const t = w.tags; if (!t) continue;
    const pts = w.nodes.map(P).filter(Boolean);
    if (pts.length < 2) continue;
    const mid = pts[pts.length >> 1];
    if (!nearTrack(mid[0], mid[1], 560)) continue;
    if (t.highway && roadW[t.highway] != null && !t.tunnel && t.area !== 'yes') {
      let bridgeY = null;
      if (t.bridge && t.bridge !== 'no') {
        // A road bridge: over the railway it must clear the wires; otherwise use natural ground.
        let over = null;
        for (const p of pts) { const ti = trackInfo(p[0], p[1], 25); if (ti && ti.kind !== 'tunnel' && ti.kind !== 'bridge' && ti.kind !== 'viaduct') over = Math.max(over ?? -Infinity, ti.y + 6.2); }
        const ends = [natural(pts[0][0], pts[0][1]), natural(pts[pts.length - 1][0], pts[pts.length - 1][1])];
        bridgeY = Math.max(over ?? -Infinity, ...ends);
      }
      const width = parseFloat(t.width) || roadW[t.highway] * (t.lanes ? Math.max(0.7, +t.lanes / 2) : 1);
      tileOf(mid[0], mid[1]).r.push([drape(pts, bridgeY != null ? 0 : 0.12, bridgeY), round(width, 1), t.highway, bridgeY != null ? 1 : 0, t.name ?? null]);
      nr++;
    } else if (t.barrier && ['wall', 'fence', 'retaining_wall', 'hedge', 'city_wall', 'guard_rail'].includes(t.barrier)) {
      tileOf(mid[0], mid[1]).f.push([drape(pts, 0, null), t.barrier, parseFloat(t.height) || null]);
      nf++;
    } else if (t.natural === 'tree_row') {
      const d = drape(pts, 0, null);
      for (let i = 0; i < d.length; i += 3) tileOf(d[i], d[i + 1]).t.push([d[i], d[i + 2], d[i + 1], 1]);
    }
  }
  // Trees: mapped single trees + scatter in woods/parks
  const rnd = mulberry32(1234567);
  let nt = 0;
  for (const n of osm.nodes.values()) {
    const t = n.tags; if (!t) continue;
    const [x, z] = project(n.lat, n.lon);
    if (t.natural === 'tree') { if (nearTrack(x, z, 560)) { tileOf(x, z).t.push([q(x), q(z), q(heightAt(x, z)), 0]); nt++; } }
    else if (t.highway === 'street_lamp') { if (nearTrack(x, z, 400)) tileOf(x, z).l.push([q(x), q(z), q(heightAt(x, z))]); }
  }
  for (const p of woods) {
    const [x0, z0, x1, z1] = p.bbox;
    const area = (x1 - x0) * (z1 - z0);
    const dens = p.cls === CLS.FOREST ? 1 / 28 : 1 / 300;
    const count = Math.min(6000, Math.floor(area * dens));
    for (let k = 0; k < count; k++) {
      const x = x0 + rnd() * (x1 - x0), z = z0 + rnd() * (z1 - z0);
      if (!pointInRing(x, z, p.ring)) continue;
      const ti = nearTrack(x, z, 560); if (!ti || ti.d < 9) continue;
      tileOf(x, z).t.push([q(x), q(z), q(heightAt(x, z)), p.cls === CLS.FOREST ? 2 : 3]); nt++;
    }
  }
  // Lineside vegetation: the dense bushes and self-seeded trees along cuttings and embankments.
  const bldHash = new SegHash(32);
  for (const p of buildings) for (let i = 0; i < p.ring.length - 2; i += 2) bldHash.add(p.ring[i], p.ring[i + 1], p.ring[i + 2], p.ring[i + 3], null);
  const roadHash = new SegHash(32);
  for (const w of osm.ways.values()) { if (!w.tags?.highway || roadW[w.tags.highway] == null) continue; for (let i = 0; i < w.nodes.length - 1; i++) { const a = P(w.nodes[i]), b = P(w.nodes[i + 1]); if (a && b) roadHash.add(a[0], a[1], b[0], b[1], roadW[w.tags.highway]); } }
  const stationRanges = net.paths.flatMap((p) => p.stations.map((st) => ({ p: p.id, s0: st.platform.s0 - 30, s1: st.platform.s1 + 30 })));
  let nv = 0;
  for (const p of net.paths) {
    const n = p.pts.length / 3;
    for (let i = 1; i < n - 1; i++) {
      const s = i * p.step;
      if (stationRanges.some((r) => r.p === p.id && s >= r.s0 && s <= r.s1)) continue;
      const st = structAt(p, s);
      if (st && (st[2] === 'tunnel' || st[2] === 'viaduct')) continue;
      const x = p.pts[i * 3], z = p.pts[i * 3 + 2];
      const dx = p.pts[i * 3 + 3] - p.pts[i * 3 - 3], dz = p.pts[i * 3 + 5] - p.pts[i * 3 - 1], L = Math.hypot(dx, dz) || 1;
      const rx = -dz / L, rz = dx / L;
      for (let k = 0; k < 3; k++) {
        if (rnd() > 0.6) continue;
        const side = rnd() < 0.5 ? -1 : 1;
        const dist = 6.5 + rnd() * rnd() * 38;
        const px = x + rx * side * dist + (rnd() - 0.5) * 4, pz = z + rz * side * dist + (rnd() - 0.5) * 4;
        const ti = trackInfo(px, pz, 30);
        if (ti && ti.d < 6.5) continue;
        if (bldHash.nearest(px, pz, 4)) continue;
        const rd = roadHash.nearest(px, pz, 12); if (rd && rd.d < rd.seg.data / 2 + 1.5) continue;
        const h = heightAt(px, pz);
        if (h < 0.3) continue;
        tileOf(px, pz).t.push([q(px), q(pz), q(h), rnd() < 0.7 ? 4 : 2]);
        nv++;
      }
    }
  }
  // Dedupe trees (paths overlap) and write tiles
  if (fs.existsSync(path.join(OUT, 'dart', 'scenery'))) fs.rmSync(path.join(OUT, 'dart', 'scenery'), { recursive: true });
  fs.mkdirSync(path.join(OUT, 'dart', 'scenery'), { recursive: true });
  let total = 0;
  for (const [k, v] of tiles) {
    const seen = new Set();
    v.t = v.t.filter((t) => { const key = `${Math.round(t[0] / 2)}_${Math.round(t[1] / 2)}`; if (seen.has(key)) return false; seen.add(key); return true; });
    const file = path.join(OUT, 'dart', 'scenery', `${k}.json`);
    fs.writeFileSync(file, JSON.stringify(v));
    total += fs.statSync(file).size;
  }
  fs.writeFileSync(path.join(OUT, 'dart', 'terrain.json'), JSON.stringify({
    near: { size: NEAR.size, n: NEAR.n, tiles: nearList }, far: { size: FAR.size, n: FAR.n, tiles: farList }, scenery: { size: SCN, tiles: [...tiles.keys()] }, classes: CLS,
  }));
  console.log(`scenery: ${tiles.size} tiles, ${nb} buildings, ${nr} roads, ${nf} barriers, ${nt} trees, ${nv} lineside plants, ${(total / 1e6).toFixed(1)} MB`);
  console.log(`terrain: near ${(nearBuf.length / 1e6).toFixed(1)} MB, far ${(farBuf.length / 1e6).toFixed(1)} MB`);
}

if (import.meta.url === `file://${process.argv[1]}`) await buildWorld();
