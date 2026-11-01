// Lineside classification: what is beside each track, every STEP metres, on each side.
// Derived only from data (LiDAR heights, OSM coastline, OSM building footprints, OSM structures,
// platform positions), so it applies equally to every part of the network. The *look* of each
// class (fence type, wall stone, vegetation density, overhead-line structures) was set by
// reviewing reference footage of Greystones -> Connolly; see docs/LINESIDE.md.
import { SegHash } from './geom.mjs';

export const LS_STEP = 25;
const URBAN_FRAC = Number(process.env.LS_URBAN_FRAC ?? 0.15), URBAN_SIZE = Number(process.env.LS_URBAN_SIZE ?? 600);
export const LS = {
  OPEN: 0,    // grass verge to a fence line (green weld-mesh or post-and-wire)
  BANK: 1,    // vegetated cutting side or embankment slope: dense scrub, brambles, trees
  WALL: 2,    // masonry retaining wall (granite rubble), ground behind it is high
  SEA: 3,     // sea wall / rock armour, open water beyond
  URBAN: 4,   // city or industrial: tall grey palisade, concrete walls, building backs
  STATION: 5, // platform zone: handled by the station builder
  STRUCT: 6,  // tunnel, viaduct or bridge deck: handled by the structure builder
  NONE: 7,    // the other running line is on this side: it draws its own boundary
  CLIFF: 8,   // very high, steep natural ground (Bray Head): bare rock and gorse, no fence
};

/**
 * @param net        baked network (paths with pts, step, structures, stations)
 * @param natural    (x, z) -> ground height from the DTM (no buildings)
 * @param coastInfo  (x, z) -> { d, sea } | null
 * @param buildings  polygons with ring (flat x,z) and tags
 */
export function classifyLineside(net, natural, coastInfo, buildings) {
  // --- building coverage grid (footprint area and mean height per 20 m cell) ---
  const CELL = 20;
  const cov = new Map();
  for (const b of buildings) {
    const r = b.ring; let a = 0, cx = 0, cz = 0;
    const n = r.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const f = r[i * 2] * r[j * 2 + 1] - r[j * 2] * r[i * 2 + 1];
      a += f; cx += (r[i * 2] + r[j * 2]) * f; cz += (r[i * 2 + 1] + r[j * 2 + 1]) * f;
    }
    if (Math.abs(a) < 1e-6) continue;
    cx /= 3 * a; cz /= 3 * a; a = Math.abs(a / 2);
    const h = parseFloat(b.tags.height) || (b.tags['building:levels'] ? parseFloat(b.tags['building:levels']) * 3.1 : 7);
    const k = `${Math.floor(cx / CELL)}_${Math.floor(cz / CELL)}`;
    const c = cov.get(k) ?? { a: 0, ah: 0, aa: 0 };
    c.a += a; c.ah += a * h; c.aa += a * a; cov.set(k, c);
  }
  /** Built-up fraction, area-weighted mean height and area-weighted mean footprint within R of (x, z).
   *  OSM rarely has heights here, so footprint size separates city blocks from houses. */
  const builtUp = (x, z, R) => {
    const r = Math.ceil(R / CELL), cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    let a = 0, ah = 0, aa = 0;
    for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
      if ((i * CELL) ** 2 + (j * CELL) ** 2 > (R + CELL) ** 2) continue;
      const c = cov.get(`${cx + i}_${cz + j}`); if (c) { a += c.a; ah += c.ah; aa += c.aa; }
    }
    return { frac: a / (Math.PI * R * R), h: a ? ah / a : 0, size: a ? aa / a : 0 };
  };

  // --- track hashes per running direction (to find the other line) ---
  const north = new SegHash(16), south = new SegHash(16);
  for (const p of net.paths) {
    const H = p.id.startsWith('greystones') ? north : south;
    const n = p.pts.length / 3;
    for (let i = 0; i < n - 1; i++) H.add(p.pts[i * 3], p.pts[i * 3 + 2], p.pts[i * 3 + 3], p.pts[i * 3 + 5], { path: p.id, s: i * p.step });
  }

  const out = {};
  for (const p of net.paths) {
    const isNorth = p.id.startsWith('greystones');
    const other = isNorth ? south : north;
    const n = p.pts.length / 3, len = (n - 1) * p.step;
    const m = Math.floor(len / LS_STEP) + 1;
    const L = new Uint8Array(m), R = new Uint8Array(m), hL = new Uint8Array(m), hR = new Uint8Array(m), urban = new Uint8Array(m);
    const dbgFrac = new Uint8Array(m), dbgH = new Uint8Array(m);
    const adj = new Int8Array(m); // signed lateral distance to the other running line, decimetres (0 = none/shared)
    const pt = (s) => { const f = Math.min(n - 1.001, s / p.step), i = Math.floor(f), t = f - i; return [0, 1, 2].map((k) => p.pts[i * 3 + k] + (p.pts[i * 3 + 3 + k] - p.pts[i * 3 + k]) * t); };
    const zones = p.stations.map((st) => [st.platform.s0 - 15, st.platform.s1 + 15]);
    for (let j = 0; j < m; j++) {
      const s = Math.min(len - 0.5, j * LS_STEP);
      const [x, y, z] = pt(s);
      const [ax, , az] = pt(Math.max(0, s - 5)), [bx, , bz] = pt(Math.min(len, s + 5));
      let dx = bx - ax, dz = bz - az; const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
      const rx = -dz, rz = dx; // right of the direction of travel
      const st = p.structures.find((q) => s >= q[0] && s <= q[1] && q[2] !== 'cutting' && q[2] !== 'embankment');
      const inStation = zones.some(([a, b]) => s >= a && s <= b);
      // the other running line: shared (single track), or adjacent on one side
      const o = other.nearest(x, z, 7);
      let adjSide = 0, shared = false;
      if (o) {
        if (o.d < 1.2) shared = true;
        else if (o.d < 6.5) {
          const qx = o.seg.ax + (o.seg.bx - o.seg.ax) * o.t, qz = o.seg.az + (o.seg.bz - o.seg.az) * o.t;
          const lat = (qx - x) * rx + (qz - z) * rz;
          adjSide = Math.sign(lat);
          adj[j] = Math.max(-127, Math.min(127, Math.round(lat * 10)));
        }
      }
      const bu = builtUp(x, z, 60);
      const isUrban = bu.frac > URBAN_FRAC && bu.size > URBAN_SIZE;
      urban[j] = isUrban ? 1 : 0;
      dbgFrac[j] = Math.round(bu.frac * 100); dbgH[j] = Math.min(255, Math.round(bu.size / 20));
      for (const side of [-1, 1]) {
        let code;
        let wallH = 0;
        if (!shared && adjSide === side) code = LS.NONE;
        else if (st) code = LS.STRUCT;
        else if (inStation) code = LS.STATION;
        else {
          const at = (lat) => { const px = x + rx * side * lat, pz = z + rz * side * lat; return { h: natural(px, pz) - y, c: coastInfo(px, pz) }; };
          const a7 = at(7), a12 = at(12), a20 = at(20), a35 = at(35), a50 = at(50);
          const seaNear = (a12.c && a12.c.sea) || (a20.c && a20.c.sea && a20.c.d > 3);
          // a ledge or embankment falling to the shore (Bray Head, Killiney beach): sea side too
          const seaBelow = a12.h < -1 && ((a35.c && a35.c.sea) || (a50.c && a50.c.sea));
          const remote = builtUp(x + rx * side * 40, z + rz * side * 40, 60).frac < 0.02;
          if (seaNear || seaBelow) code = LS.SEA;
          // bare rock only where the ground is very high and nobody lives (Bray Head); elsewhere a
          // steep rise next to the cess is a masonry retaining wall with the bank above it (Killiney, Dalkey)
          else if (a20.h > 9 && a35.h > 16 && remote) code = LS.CLIFF;
          else if (a7.h > 2.4) { code = LS.WALL; wallH = Math.min(4.5, Math.max(2, a7.h + 0.6)); }
          else if (a12.h > 1.8 || a12.h < -2.5) code = LS.BANK;  // cutting side or embankment slope
          else if (isUrban) code = LS.URBAN;
          else code = LS.OPEN;
        }
        if (side < 0) { L[j] = code; hL[j] = Math.round(wallH * 10); } else { R[j] = code; hR[j] = Math.round(wallH * 10); }
      }
    }
    // smooth single-sample flickers (keep runs of >= 3 samples, i.e. 75 m)
    for (const A of [L, R]) {
      for (let j = 1; j < m - 1; j++) if (A[j - 1] === A[j + 1] && A[j] !== A[j - 1]) A[j] = A[j - 1];
    }
    out[p.id] = { L, R, hL, hR, urban, isNorth, dbgFrac, dbgH, adj };
  }

  // Overhead line: portal gantries over both tracks in urban double-track sections (built by the
  // northbound line), and no separate masts on the southbound line there.
  const result = { step: LS_STEP, codes: LS, paths: {} };
  for (const p of net.paths) {
    const o = out[p.id];
    const m = o.L.length;
    const portal = new Uint8Array(m), noMast = new Uint8Array(m);
    for (let j = 0; j < m; j++) {
      const dbl = o.adj[j] !== 0;
      if (o.isNorth && dbl && o.urban[j]) portal[j] = 1;
    }
    // drop runs shorter than 200 m (a single large building is not a city)
    for (let j = 0; j < m; ) {
      if (!portal[j]) { j++; continue; }
      let k = j; while (k < m && portal[k]) k++;
      if (k - j < 8) portal.fill(0, j, k);
      j = k;
    }
    o.portal = portal; o.noMast = noMast;
  }
  for (const p of net.paths) {
    const o = out[p.id];
    if (o.isNorth) continue;
    const n = p.pts.length / 3;
    for (let j = 0; j < o.L.length; j++) {
      const i = Math.min(n - 1, Math.round((j * LS_STEP) / p.step));
      const hit = north.nearest(p.pts[i * 3], p.pts[i * 3 + 2], 7);
      if (!hit) continue;
      const src = out[hit.seg.data.path];
      const k = Math.round(hit.seg.data.s / LS_STEP);
      if (src && src.portal[k]) o.noMast[j] = 1;
    }
  }
  const enc = (a) => Array.from(a).map((v) => String.fromCharCode(48 + v)).join(''); // compact: one char per sample
  for (const p of net.paths) {
    const o = out[p.id];
    result.paths[p.id] = { L: enc(o.L), R: enc(o.R), hL: Array.from(o.hL), hR: Array.from(o.hR), adj: Array.from(o.adj), portal: enc(o.portal), noMast: enc(o.noMast) };
    if (process.env.LS_DEBUG) result.paths[p.id].dbg = { frac: Array.from(o.dbgFrac), h: Array.from(o.dbgH) };
  }
  return result;
}
