// Builds public/data/dart/network.json: the four driving paths (direction + branch) with
// smoothed real geometry, a vertical profile, speed limits, structures, stations/platforms,
// signals, mileposts. Source: OpenStreetMap (ODbL) + AWS Terrain Tiles + NTA GTFS.
import fs from 'node:fs';
import path from 'node:path';
import { RAW, parseMaxspeed, project, round, writeJson, readJson } from './lib.mjs';
import { fetchRoutes, DART_RELATIONS } from './fetch-osm-routes.mjs';
import { assembleRelation } from './assemble.mjs';
import { Dem } from './fetch-dem.mjs';

export const STEP = 5; // metres between samples in the output

function gaussian(arr, sigma, stride = 1, comp = 0) {
  // Gaussian smoothing of a strided array, endpoint-preserving (mirror padding).
  const n = arr.length / stride, r = Math.ceil(sigma * 3), w = [];
  for (let i = -r; i <= r; i++) w.push(Math.exp((-i * i) / (2 * sigma * sigma)));
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0, ws = 0;
    for (let k = -r; k <= r; k++) {
      let j = i + k;
      if (j < 0) j = -j; if (j >= n) j = 2 * n - j - 2;
      j = Math.max(0, Math.min(n - 1, j));
      s += arr[j * stride + comp] * w[k + r]; ws += w[k + r];
    }
    out[i] = s / ws;
  }
  return out;
}
function median(arr, half) {
  const out = new Float64Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    const win = [];
    for (let k = Math.max(0, i - half); k <= Math.min(arr.length - 1, i + half); k++) win.push(arr[k]);
    win.sort((a, b) => a - b);
    out[i] = win[win.length >> 1];
  }
  return out;
}

/** Resample a polyline at a fixed step, carrying the way id of each segment. */
function resample(points, step) {
  const out = [];
  let acc = 0;
  out.push({ x: points[0].x, z: points[0].z, wayId: points[0].wayId });
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const L = Math.hypot(b.x - a.x, b.z - a.z);
    let t = step - acc;
    while (t <= L) {
      out.push({ x: a.x + ((b.x - a.x) * t) / L, z: a.z + ((b.z - a.z) * t) / L, wayId: a.wayId });
      t += step;
    }
    acc = L - (t - step);
  }
  const last = points[points.length - 1];
  out.push({ x: last.x, z: last.z, wayId: last.wayId });
  return out;
}

/** Projects a point onto a sampled path. Returns { s, lat (signed lateral, +right), i }. */
export function projectOnto(samples, x, z, hint = null, window = 400) {
  let best = { d: Infinity };
  const lo = hint == null ? 0 : Math.max(0, hint - window), hi = hint == null ? samples.length - 1 : Math.min(samples.length - 1, hint + window);
  for (let i = lo; i < hi; i++) {
    const a = samples[i], b = samples[i + 1];
    const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz || 1;
    let t = ((x - a.x) * dx + (z - a.z) * dz) / L2;
    t = Math.max(0, Math.min(1, t));
    const px = a.x + dx * t, pz = a.z + dz * t;
    const d = Math.hypot(x - px, z - pz);
    if (d < best.d) {
      const L = Math.sqrt(L2), rx = -dz / L, rz = dx / L;
      best = { d, i, t, s: (i + t) * STEP, lat: (x - px) * rx + (z - pz) * rz };
    }
  }
  return best;
}

function loadCorridorElements() {
  const dir = path.join(RAW, 'osm', 'map');
  const nodes = new Map(), ways = new Map();
  for (const f of fs.readdirSync(dir)) {
    const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    for (const e of j.elements) {
      if (e.type === 'node') nodes.set(e.id, e);
      else if (e.type === 'way') ways.set(e.id, e);
    }
  }
  return { nodes, ways };
}

const norm = (s) => s.toLowerCase().replace(/[^a-z]/g, '');

export async function buildNetwork() {
  const routes = await fetchRoutes();
  const timetable = readJson('dart/timetable.json');
  const corridor = loadCorridorElements();
  const dem = new Dem(14);
  const paths = [];

  // Pass 1: geometry of all four paths.
  const geo = {};
  for (const [key, relId] of Object.entries(DART_RELATIONS)) {
    const A = assembleRelation(routes[key], relId);
    // densify to 1 m, smooth out digitising kinks (sigma 8 m), resample at STEP.
    const dense = resample(A.points, 1);
    const flat = new Float64Array(dense.length * 2);
    dense.forEach((p, i) => { flat[i * 2] = p.x; flat[i * 2 + 1] = p.z; });
    const sx = gaussian(flat, 8, 2, 0), sz = gaussian(flat, 8, 2, 1);
    const smoothed = dense.map((p, i) => ({ x: sx[i], z: sz[i], wayId: p.wayId }));
    geo[key] = { A, relId, S: resample(smoothed, STEP) };
  }
  // Pass 2: where OSM maps a double-track line as a single centreline, both directions share
  // a way. Split them: every path moves 1.75 m to its own left (left-hand running), so the
  // two directions end up 3.5 m apart. Bray-Greystones is genuinely single track and is left alone.
  const northbound = (k) => k.startsWith('greystones');
  for (const [key, G] of Object.entries(geo)) {
    const opp = Object.entries(geo).filter(([k]) => northbound(k) !== northbound(key)).map(([, v]) => v.S);
    const brayIdx = (() => { const st = G.A.stops.find((q) => /bray/i.test(q.tags?.name ?? '')); if (!st) return -1; const [x, z] = project(st.lat, st.lon); return projectOnto(G.S, x, z).i; })();
    const off = new Float64Array(G.S.length);
    const hints = opp.map(() => null);
    for (let i = 0; i < G.S.length; i++) {
      const south = northbound(key) ? i < brayIdx - 10 : i > brayIdx + 10;
      if (south) continue;
      const p = G.S[i];
      let dmin = Infinity;
      opp.forEach((O, k) => {
        let q = projectOnto(O, p.x, p.z, hints[k], 60);
        if (q.d > 30) q = projectOnto(O, p.x, p.z);
        hints[k] = q.i; dmin = Math.min(dmin, q.d);
      });
      if (dmin < 1.2) off[i] = -1.75;
    }
    const sm = gaussian(off, 12);
    G.S = G.S.map((p, i) => {
      const a = G.S[Math.max(0, i - 1)], b = G.S[Math.min(G.S.length - 1, i + 1)];
      const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 1;
      return { x: p.x + (-dz / L) * sm[i], z: p.z + (dx / L) * sm[i], wayId: p.wayId };
    });
    const shared = off.reduce((a, v) => a + (v ? 1 : 0), 0);
    console.log(`  ${key}: ${(shared * STEP / 1000).toFixed(1)} km of shared centreline split into two tracks`);
  }

  for (const [key, { A, relId, S }] of Object.entries(geo)) {
    const n = S.length;
    const length = (n - 1) * STEP; // approximate; last segment shorter
    // geo bounds for DEM
    let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
    for (const p of A.points) { minLat = Math.min(minLat, p.lat); maxLat = Math.max(maxLat, p.lat); minLon = Math.min(minLon, p.lon); maxLon = Math.max(maxLon, p.lon); }
    await dem.load(minLat - 0.01, minLon - 0.015, maxLat + 0.01, maxLon + 0.015);

    // 2) per-sample way tags
    const tagOf = (i) => A.ways.get(S[i].wayId)?.tags ?? {};
    const ground = new Float64Array(n);
    const { unproject } = await import('./lib.mjs');
    for (let i = 0; i < n; i++) { const [la, lo] = unproject(S[i].x, S[i].z); ground[i] = dem.height(la, lo); }

    // 3) vertical profile: robust smoothing + structure constraints.
    const layer = new Int8Array(n), kind = new Array(n);
    for (let i = 0; i < n; i++) {
      const t = tagOf(i);
      layer[i] = parseInt(t.layer || '0', 10) || 0;
      kind[i] = t.tunnel ? 'tunnel' : t.bridge ? (t.bridge === 'viaduct' ? 'viaduct' : 'bridge') : t.cutting ? 'cutting' : t.embankment ? 'embankment' : null;
    }
    // Ground for the profile ignores bridge/tunnel samples (DEM there is the river/hill, not the line).
    const g = Float64Array.from(ground);
    let y = median(g, 30);
    y = gaussian(y, 25);
    for (let it = 0; it < 30; it++) {
      for (let i = 0; i < n; i++) {
        if ((kind[i] === 'bridge' || kind[i] === 'viaduct') && layer[i] >= 1) y[i] = Math.max(y[i], ground[i] + 4.5 + 2.5 * layer[i]);
        if (kind[i] === 'tunnel') y[i] = Math.min(y[i], ground[i] - 6);
        y[i] = Math.max(y[i], 1.8); // nothing below the sea wall
      }
      y = gaussian(y, 12);
    }

    // 4) speed limits (change points)
    const speed = [];
    let last = null;
    for (let i = 0; i < n; i++) {
      const v = parseMaxspeed(tagOf(i).maxspeed);
      const kmh = v ? Math.round(v) : last ?? 64;
      if (kmh !== last) { speed.push([i * STEP, kmh]); last = kmh; }
    }
    // 5) structures (ranges)
    const structures = [];
    for (let i = 0; i < n; ) {
      if (!kind[i]) { i++; continue; }
      let j = i; while (j + 1 < n && kind[j + 1] === kind[i]) j++;
      structures.push([i * STEP, (j + 1) * STEP, kind[i], layer[i]]);
      i = j + 1;
    }
    // 6) stations: OSM stop nodes, matched to GTFS stations by proximity; platform from relation members.
    const stations = [];
    let hint = null;
    A.stops.forEach((stop, k) => {
      const [x, z] = project(stop.lat, stop.lon);
      const pr = projectOnto(S, x, z, hint, 2000); hint = pr.i;
      let gt = null, gd = Infinity;
      timetable.stations.forEach((st, si) => { const [gx, gz] = project(st.lat, st.lon); const d = Math.hypot(gx - x, gz - z); if (d < gd) { gd = d; gt = si; } });
      const name = stop.tags?.name ?? timetable.stations[gt].name;
      // platform: the relation platform whose centroid is closest
      let plat = null;
      for (const w of A.platforms) {
        const ns = w.nodes.map((id) => A.nodes.get(id)).filter(Boolean);
        const prj = ns.map((nd) => { const [px, pz] = project(nd.lat, nd.lon); return projectOnto(S, px, pz, pr.i, 120); }).filter((q) => q.d < 40);
        if (!prj.length) continue;
        const s0 = Math.min(...prj.map((q) => q.s)), s1 = Math.max(...prj.map((q) => q.s));
        if (pr.s < s0 - 150 || pr.s > s1 + 150) continue;
        const lats = prj.map((q) => q.lat).sort((a, b) => a - b);
        const medLat = lats[lats.length >> 1];
        const side = Math.sign(medLat) || -1;
        const edge = Math.min(...prj.map((q) => Math.abs(q.lat)));
        const width = Math.max(3, Math.min(12, Math.max(...prj.map((q) => Math.abs(q.lat))) - edge));
        const cand = { s0: round(s0, 1), s1: round(s1, 1), side, edge: round(Math.max(1.6, Math.min(edge, 6)), 2), width: round(width, 1), ref: w.tags?.ref ?? null };
        if (!plat || Math.abs((s0 + s1) / 2 - pr.s) < Math.abs((plat.s0 + plat.s1) / 2 - pr.s)) plat = cand;
      }
      if (plat && plat.s1 - plat.s0 < 60) plat = { ...plat, s0: Math.max(0, pr.s - 80), s1: pr.s + 80 };
      if (!plat) plat = { s0: Math.max(0, pr.s - 80), s1: pr.s + 80, side: -1, edge: 1.6, width: 4, ref: null, guessed: true };
      // Stop mark: front of an 8-car train stops a few metres short of the platform end.
      const stopS = Math.min(plat.s1 - 6, length - 15);
      stations.push({ name, nameGa: timetable.stations[gt].nameGa, gtfs: timetable.stations[gt].id, gtfsIdx: gt, s: round(stopS, 1), osmS: round(pr.s, 1), platform: plat });
    });

    // 7) signals and lineside signs from OSM nodes on this path's ways.
    const nodeIdx = new Map();
    for (let i = 0; i < A.points.length; i++) nodeIdx.set(A.points[i].nodeId, i);
    const signals = [], mileposts = [], speedSigns = [];
    for (const [id, nd] of corridor.nodes) {
      const t = nd.tags; if (!t) continue;
      const isSig = t.railway === 'signal' || t.railway === 'buffer_stop;signal';
      const isMp = t.railway === 'milestone';
      if (!isSig && !isMp) continue;
      const [x, z] = project(nd.lat, nd.lon);
      const pr = projectOnto(S, x, z);
      if (!(pr.d < 3.5)) continue; // must be on this track
      // Direction: compare the way's node order to the path order.
      let fwdPath = true;
      const pi = nodeIdx.get(id);
      if (pi != null) {
        const w = corridor.ways.get(A.points[pi].wayId) ?? A.ways.get(A.points[pi].wayId);
        if (w) {
          const k = w.nodes.indexOf(id);
          const nb = w.nodes[k + 1] ?? w.nodes[k - 1];
          const sign = w.nodes[k + 1] != null ? 1 : -1;
          const ni = nodeIdx.get(nb);
          if (ni != null) fwdPath = (ni - pi) * sign > 0;
        }
      }
      const dir = t['railway:signal:direction'];
      const facesUs = dir === 'both' || (dir === 'forward' ? fwdPath : dir === 'backward' ? !fwdPath : true);
      if (isMp) { mileposts.push([round(pr.s, 1), t['railway:position'] ?? '']); continue; }
      if (!facesUs) continue;
      if (t['railway:signal:main']) {
        const states = t['railway:signal:main:states'] ?? 'red;amber;green';
        signals.push({ s: round(pr.s, 1), ref: t.ref ?? null, aspects: states.split(';').length >= 4 ? 4 : states.includes('amber') ? 3 : 2, pos: t['railway:signal:position'] ?? 'left', route: !!t['railway:signal:route'], src: 'osm' });
      } else if (t['railway:signal:main_repeated']) {
        signals.push({ s: round(pr.s, 1), ref: t.ref ?? null, repeater: true, pos: t['railway:signal:position'] ?? 'left', src: 'osm' });
      } else if (t['railway:signal:speed_limit']) {
        speedSigns.push([round(pr.s, 1), +(t['railway:signal:speed_limit:speed'] ?? 0)]);
      }
    }
    signals.sort((a, b) => a.s - b.s);
    // Fill gaps so the line is fully signalled (generated signals are flagged src:'gen').
    // Every platform gets a starting signal just beyond its end if there is none within 60 m.
    const mains = () => signals.filter((q) => !q.repeater).map((q) => q.s);
    for (const st of stations) {
      const want = st.platform.s1 + 15;
      if (want > length - 30) continue;
      if (!mains().some((s) => Math.abs(s - want) < 70)) signals.push({ s: round(want, 1), ref: null, aspects: 4, pos: 'left', src: 'gen' });
    }
    signals.sort((a, b) => a.s - b.s);
    const filled = [];
    let prev = 0;
    const allMain = signals.filter((q) => !q.repeater);
    for (const q of [...allMain, { s: length - 30 }]) {
      const gap = q.s - prev;
      if (gap > 1300) {
        const k = Math.ceil(gap / 1100);
        for (let j = 1; j < k; j++) filled.push({ s: round(prev + (gap * j) / k, 1), ref: null, aspects: 4, pos: 'left', src: 'gen' });
      }
      prev = q.s;
    }
    signals.push(...filled);
    signals.sort((a, b) => a.s - b.s);
    mileposts.sort((a, b) => a[0] - b[0]);
    speedSigns.sort((a, b) => a[0] - b[0]);

    // 8) way change points (used by the renderer to draw each physical track only once).
    const wayRuns = [];
    for (let i = 0; i < n; i++) if (i === 0 || S[i].wayId !== S[i - 1].wayId) wayRuns.push([i, S[i].wayId]);

    const pts = [];
    for (let i = 0; i < n; i++) pts.push(round(S[i].x, 2), round(y[i], 2), round(S[i].z, 2));
    const gnd = Array.from(ground, (v) => round(v, 1));
    const [from, to] = key.split('-');
    paths.push({ id: key, from, to, osmRelation: relId, step: STEP, length: round(length, 1), pts, ground: gnd, speed, structures, stations, signals, speedSigns, mileposts, wayRuns });
    console.log(`${key}: ${(length / 1000).toFixed(2)} km, ${stations.length} stations, ${signals.length} signals (${signals.filter((q) => q.src === 'osm').length} from OSM), ${structures.length} structures, ${speed.length} speed changes`);
  }
  const size = writeJson('dart/network.json', { attribution: '© OpenStreetMap contributors (ODbL); elevation: AWS Terrain Tiles; timetable: NTA GTFS', origin: { lat: 53.3, lon: -6.18 }, paths });
  console.log(`network.json ${(size / 1024) | 0} KB`);
}

if (import.meta.url === `file://${process.argv[1]}`) await buildNetwork();
