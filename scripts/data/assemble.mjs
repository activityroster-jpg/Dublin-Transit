// Turns an OSM route relation into an ordered polyline of track nodes, preserving per-segment way tags.
import { project } from './lib.mjs';

export function indexElements(json) {
  const nodes = new Map(), ways = new Map(), rels = new Map();
  for (const e of json.elements) {
    if (e.type === 'node') nodes.set(e.id, e);
    else if (e.type === 'way') ways.set(e.id, e);
    else if (e.type === 'relation') rels.set(e.id, e);
  }
  return { nodes, ways, rels };
}

/**
 * Returns { points: [{x,z,lat,lon,nodeId,wayId}], stops: [nodeIds], platforms: [wayIds] }.
 * Each point carries the way it belongs to (the way of the segment that STARTS at it).
 */
export function assembleRelation(json, relId) {
  const { nodes, ways, rels } = indexElements(json);
  const rel = rels.get(relId);
  const trackWays = rel.members.filter((m) => m.type === 'way' && (m.role === '' || m.role === undefined)).map((m) => ways.get(m.ref)).filter(Boolean);
  const stops = rel.members.filter((m) => m.type === 'node' && m.role.startsWith('stop')).map((m) => nodes.get(m.ref)).filter(Boolean);
  const platforms = rel.members.filter((m) => m.role.startsWith('platform')).map((m) => (m.type === 'way' ? ways.get(m.ref) : null)).filter(Boolean);

  // Orient and chain ways.
  const chain = [];
  for (let i = 0; i < trackWays.length; i++) {
    const w = trackWays[i];
    let ids = w.nodes.slice();
    if (chain.length === 0) {
      const next = trackWays[i + 1];
      if (next && (ids[0] === next.nodes[0] || ids[0] === next.nodes[next.nodes.length - 1])) ids.reverse();
    } else {
      const last = chain[chain.length - 1].nodeId;
      if (ids[ids.length - 1] === last) ids.reverse();
      else if (ids[0] !== last) {
        // Gap in the relation: connect to whichever end is closer.
        const L = nodes.get(last), a = nodes.get(ids[0]), b = nodes.get(ids[ids.length - 1]);
        const d = (n) => (n.lat - L.lat) ** 2 + (n.lon - L.lon) ** 2;
        if (d(b) < d(a)) ids.reverse();
        console.warn(`  gap before way ${w.id} (${Math.sqrt(Math.min(d(a), d(b))) * 111000 | 0} m)`);
      }
    }
    for (let k = 0; k < ids.length; k++) {
      if (chain.length && k === 0 && chain[chain.length - 1].nodeId === ids[0]) {
        chain[chain.length - 1].wayId = w.id;
        continue;
      }
      const n = nodes.get(ids[k]);
      const [x, z] = project(n.lat, n.lon);
      chain.push({ x, z, lat: n.lat, lon: n.lon, nodeId: n.id, wayId: w.id });
    }
  }
  return { points: chain, stops, platforms, ways, nodes, rel };
}
