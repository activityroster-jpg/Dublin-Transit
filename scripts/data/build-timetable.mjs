// Builds public/data/dart/timetable.json from the NTA Irish Rail GTFS feed (open data).
import { strFromU8, unzipSync } from 'fflate';
import { cachedFetch, writeJson } from './lib.mjs';

const GTFS_URL = 'https://www.transportforireland.ie/transitData/Data/GTFS_Irish_Rail.zip';

function parseCsv(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
  const head = splitLine(lines[0]);
  return lines.slice(1).map((l) => {
    const c = splitLine(l);
    const o = {};
    head.forEach((h, i) => (o[h] = c[i] ?? ''));
    return o;
  });
}
function splitLine(l) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < l.length; i++) {
    const ch = l[i];
    if (q) { if (ch === '"') { if (l[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}
const secs = (t) => { const [h, m, s] = t.split(':').map(Number); return h * 3600 + m * 60 + s; };

export async function buildTimetable() {
  const zip = unzipSync(new Uint8Array(await cachedFetch(GTFS_URL, 'gtfs/GTFS_Irish_Rail.zip', { binary: true })));
  const f = (n) => parseCsv(strFromU8(zip[n]));
  const routes = f('routes.txt').filter((r) => r.route_short_name === 'DART');
  const routeIds = new Set(routes.map((r) => r.route_id));
  const trips = f('trips.txt').filter((t) => routeIds.has(t.route_id));
  const tripIds = new Set(trips.map((t) => t.trip_id));
  const stopsAll = f('stops.txt');
  const ga = new Map(f('translations.txt').filter((t) => t.table_name === 'stops' && t.language === 'ga').map((t) => [t.record_id, t.translation]));
  const times = new Map();
  for (const st of f('stop_times.txt')) {
    if (!tripIds.has(st.trip_id)) continue;
    if (!times.has(st.trip_id)) times.set(st.trip_id, []);
    times.get(st.trip_id).push(st);
  }
  const usedStops = new Set();
  for (const v of times.values()) for (const s of v) usedStops.add(s.stop_id);
  const stations = stopsAll.filter((s) => usedStops.has(s.stop_id)).map((s) => ({ id: s.stop_id, name: s.stop_name, nameGa: ga.get(s.stop_id) || null, lat: +s.stop_lat, lon: +s.stop_lon }));
  const sIdx = new Map(stations.map((s, i) => [s.id, i]));

  const svcIds = new Set(trips.map((t) => t.service_id));
  const services = {};
  for (const c of f('calendar.txt')) {
    if (!svcIds.has(c.service_id)) continue;
    services[c.service_id] = { days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map((d) => +c[d]), start: c.start_date, end: c.end_date, add: [], remove: [] };
  }
  for (const d of f('calendar_dates.txt')) {
    if (!svcIds.has(d.service_id)) continue;
    services[d.service_id] ??= { days: [0, 0, 0, 0, 0, 0, 0], start: d.date, end: d.date, add: [], remove: [] };
    services[d.service_id][d.exception_type === '1' ? 'add' : 'remove'].push(d.date);
  }
  const outTrips = trips.map((t) => {
    const st = times.get(t.trip_id).sort((a, b) => +a.stop_sequence - +b.stop_sequence);
    return {
      id: t.trip_id, svc: t.service_id, dir: +t.direction_id, head: t.trip_headsign, code: t.trip_short_name, block: t.block_id,
      stops: st.map((s) => [sIdx.get(s.stop_id), secs(s.arrival_time), secs(s.departure_time)]),
    };
  }).sort((a, b) => a.stops[0][1] - b.stops[0][1]);
  const feed = f('feed_info.txt')[0];
  const out = { source: 'National Transport Authority GTFS (Irish Rail), CC BY 4.0', feedVersion: feed?.feed_version, feedStart: feed?.feed_start_date, feedEnd: feed?.feed_end_date, stations, services, trips: outTrips };
  const size = writeJson('dart/timetable.json', out);
  console.log(`timetable: ${stations.length} stations, ${outTrips.length} trips, ${Object.keys(services).length} services, ${(size / 1024) | 0} KB`);
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) await buildTimetable();
