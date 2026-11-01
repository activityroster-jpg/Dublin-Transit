// Downloads all OSM map data in a corridor around the DART network via the OSM API (map.json in tiles).
import { cachedFetch, project } from './lib.mjs';
import { fetchRoutes, DART_RELATIONS } from './fetch-osm-routes.mjs';
import { assembleRelation } from './assemble.mjs';

export const TILE_LAT = 0.006, TILE_LON = 0.01;
export const CORRIDOR_M = 650;

export async function corridorTiles() {
  const routes = await fetchRoutes();
  const pts = [];
  for (const [k, id] of Object.entries(DART_RELATIONS)) {
    const a = assembleRelation(routes[k], id);
    for (let i = 1; i < a.points.length; i++) {
      const p = a.points[i - 1], q = a.points[i];
      const n = Math.ceil(Math.hypot(q.x - p.x, q.z - p.z) / 100);
      for (let j = 0; j < n; j++) pts.push([p.lat + (q.lat - p.lat) * (j / n), p.lon + (q.lon - p.lon) * (j / n)]);
    }
  }
  const tiles = new Set();
  const dLat = CORRIDOR_M / 111320, dLon = CORRIDOR_M / (111320 * Math.cos(53.3 * Math.PI / 180));
  for (const [lat, lon] of pts) {
    for (const a of [-dLat, 0, dLat]) for (const b of [-dLon, 0, dLon]) {
      tiles.add(`${Math.floor((lat + a) / TILE_LAT)},${Math.floor((lon + b) / TILE_LON)}`);
    }
  }
  return [...tiles].map((t) => t.split(',').map(Number)).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

async function fetchBox(s, w, n, e, name, depth = 0) {
  const url = `https://api.openstreetmap.org/api/0.6/map.json?bbox=${w.toFixed(5)},${s.toFixed(5)},${e.toFixed(5)},${n.toFixed(5)}`;
  try {
    return [JSON.parse(await cachedFetch(url, `osm/map/${name}.json`, { delayMs: 300 }))];
  } catch (err) {
    if (depth > 2 || !String(err).includes(' 400 ')) throw err;
    const mLat = (s + n) / 2, mLon = (w + e) / 2;
    const parts = [];
    let k = 0;
    for (const [a, b, c, d] of [[s, w, mLat, mLon], [s, mLon, mLat, e], [mLat, w, n, mLon], [mLat, mLon, n, e]]) parts.push(...(await fetchBox(a, b, c, d, `${name}_${k++}`, depth + 1)));
    return parts;
  }
}

export async function fetchCorridor(onTile) {
  const tiles = await corridorTiles();
  console.log(`corridor: ${tiles.length} OSM tiles`);
  let i = 0;
  for (const [ty, tx] of tiles) {
    const s = ty * TILE_LAT, w = tx * TILE_LON;
    const parts = await fetchBox(s, w, s + TILE_LAT, w + TILE_LON, `${ty}_${tx}`);
    for (const p of parts) onTile?.(p);
    if (++i % 20 === 0) console.log(`  ${i}/${tiles.length}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await fetchCorridor();
  console.log('done');
}
