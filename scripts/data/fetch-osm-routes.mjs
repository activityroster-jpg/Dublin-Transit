// Downloads the four OSM DART route relations (each direction/branch), with all member ways + nodes.
import { cachedFetch } from './lib.mjs';

export const DART_RELATIONS = {
  'greystones-malahide': 6979125,
  'malahide-greystones': 6979124,
  'greystones-howth': 6979126,
  'howth-greystones': 6979127,
};

export async function fetchRoutes() {
  const out = {};
  for (const [key, id] of Object.entries(DART_RELATIONS)) {
    const txt = await cachedFetch(`https://api.openstreetmap.org/api/0.6/relation/${id}/full.json`, `osm/relation-${id}.json`, { delayMs: 500 });
    out[key] = JSON.parse(txt);
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await fetchRoutes();
  for (const [k, v] of Object.entries(r)) console.log(k, v.elements.length, 'elements');
}
