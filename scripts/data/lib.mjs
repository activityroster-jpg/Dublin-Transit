// Shared helpers for the data pipeline. Runs in Node 20+ (GitHub Actions or locally).
import fs from 'node:fs';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
export const RAW = path.join(ROOT, 'data-raw');
export const OUT = path.join(ROOT, 'public', 'data');
fs.mkdirSync(RAW, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

/** Local tangent-plane projection origin (roughly the middle of the DART line). */
export const ORIGIN = { lat: 53.3, lon: -6.18 };
const R = 6378137;
const DEG = Math.PI / 180;
const kx = R * DEG * Math.cos(ORIGIN.lat * DEG);
const kz = R * DEG;
/** lat/lon -> local metres. x = east, z = south (three.js convention: north is -z). */
export function project(lat, lon) {
  return [(lon - ORIGIN.lon) * kx, -(lat - ORIGIN.lat) * kz];
}
export function unproject(x, z) {
  return [ORIGIN.lat - z / kz, ORIGIN.lon + x / kx];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Download with an on-disk cache so the pipeline can be re-run cheaply. */
export async function cachedFetch(url, file, { binary = false, retries = 4, delayMs = 0 } = {}) {
  const p = path.join(RAW, file);
  if (fs.existsSync(p)) return binary ? fs.readFileSync(p) : fs.readFileSync(p, 'utf8');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'DublinTransit-data-pipeline/0.1 (github.com/activityroster-jpg/dublin-transit)' } });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
      const buf = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(p, buf);
      if (delayMs) await sleep(delayMs);
      return binary ? buf : buf.toString('utf8');
    } catch (e) {
      lastErr = e;
      if (String(e).includes(' 400 ')) throw e;
      await sleep(2000 * 2 ** i);
    }
  }
  throw lastErr;
}

export function writeJson(name, obj) {
  const p = path.join(OUT, name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj));
  return fs.statSync(p).size;
}

export function readJson(name) {
  return JSON.parse(fs.readFileSync(path.join(OUT, name), 'utf8'));
}

/** Parse "60 mph" / "100" (km/h) -> km/h. */
export function parseMaxspeed(v) {
  if (!v) return null;
  const m = String(v).match(/([\d.]+)\s*(mph)?/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return m[2] ? n * 1.609344 : n;
}

export function round(n, d = 2) {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}
