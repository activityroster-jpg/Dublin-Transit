// Elevation from the open AWS Terrain Tiles (Terrarium encoding; SRTM/GMTED/ETOPO sources).
// height(m) = R*256 + G + B/256 - 32768
import { PNG } from 'pngjs';
import fs from 'node:fs';
import path from 'node:path';
import { RAW, cachedFetch } from './lib.mjs';

const TILE = 256;
export function lonLatToTile(lon, lat, z) {
  const n = 2 ** z;
  const x = ((lon + 180) / 360) * n;
  const r = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
  return [x, y];
}

/** Removes SRTM spikes (tall buildings, masts, data errors): clamps any sample more than 6 m above
 *  the median of its 7x7 neighbourhood down to that median + 1.5 m. */
function despike(h, n) {
  const src = Float32Array.from(h);
  const win = new Float32Array(49);
  for (let y = 3; y < n - 3; y++) for (let x = 3; x < n - 3; x++) {
    let k = 0;
    for (let j = -3; j <= 3; j++) for (let i = -3; i <= 3; i++) win[k++] = src[(y + j) * n + x + i];
    const sorted = win.slice().sort();
    const med = sorted[24];
    if (src[y * n + x] > med + 6) h[y * n + x] = med + 1.5;
  }
}

export class Dem {
  /** local = true: only use tiles already in data-raw (e.g. LiDAR from lidar-to-tiles.py); voids are NaN. */
  constructor(z, local = false) { this.z = z; this.local = local; this.tiles = new Map(); this.missing = new Set(); }
  async load(minLat, minLon, maxLat, maxLon) {
    const [x0, y0] = lonLatToTile(minLon, maxLat, this.z);
    const [x1, y1] = lonLatToTile(maxLon, minLat, this.z);
    for (let ty = Math.floor(y0); ty <= Math.floor(y1); ty++) {
      for (let tx = Math.floor(x0); tx <= Math.floor(x1); tx++) {
        const key = `${tx}/${ty}`;
        if (this.tiles.has(key) || this.missing.has(key)) continue;
        const file = `dem/${this.z}/${tx}_${ty}.png`;
        let buf;
        if (this.local) {
          const p = path.join(RAW, file);
          if (!fs.existsSync(p)) { this.missing.add(key); continue; }
          buf = fs.readFileSync(p);
        } else buf = await cachedFetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${this.z}/${tx}/${ty}.png`, file, { binary: true });
        const png = PNG.sync.read(buf);
        const h = new Float32Array(TILE * TILE);
        for (let i = 0; i < TILE * TILE; i++) {
          const v = png.data[i * 4] * 256 + png.data[i * 4 + 1] + png.data[i * 4 + 2] / 256 - 32768;
          h[i] = this.local && v < -32000 ? NaN : v;
        }
        if (this.z >= 13 && !this.local) despike(h, TILE);
        this.tiles.set(key, h);
      }
    }
  }
  /** Bilinear height in metres at lat/lon. Missing tiles -> 0 (remote) or NaN (local). */
  height(lat, lon) {
    const [fx, fy] = lonLatToTile(lon, lat, this.z);
    const px = fx * TILE - 0.5, py = fy * TILE - 0.5;
    const x0 = Math.floor(px), y0 = Math.floor(py);
    const tx = px - x0, ty = py - y0;
    const g = (x, y) => {
      const t = this.tiles.get(`${Math.floor(x / TILE)}/${Math.floor(y / TILE)}`);
      if (!t) return this.local ? NaN : 0;
      return t[(((y % TILE) + TILE) % TILE) * TILE + (((x % TILE) + TILE) % TILE)];
    };
    const a = g(x0, y0), b = g(x0 + 1, y0), c = g(x0, y0 + 1), d = g(x0 + 1, y0 + 1);
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  }
}

/** LiDAR where we have it, satellite elsewhere. Blends across the seam over ~40 m. */
export class LayeredDem {
  constructor(fineZ = 16, coarseZ = 14) { this.fine = new Dem(fineZ, true); this.coarse = new Dem(coarseZ); }
  async load(minLat, minLon, maxLat, maxLon) { await this.fine.load(minLat, minLon, maxLat, maxLon); await this.coarse.load(minLat, minLon, maxLat, maxLon); }
  get fineTileCount() { return this.fine.tiles.size; }
  height(lat, lon) {
    // LiDAR DTMs keep hedgerow and kerb-scale lumps that read as noise on a 4 m mesh: average a
    // small cross (±2 m) to take the edge off while keeping cuttings and embankments.
    const dLat = 2 / 111320, dLon = 2 / (111320 * Math.cos((lat * Math.PI) / 180));
    const f0 = this.fine.height(lat, lon);
    if (Number.isNaN(f0)) return this.coarse.height(lat, lon);
    let sum = f0 * 2, n = 2;
    for (const [a, b] of [[dLat, 0], [-dLat, 0], [0, dLon], [0, -dLon]]) { const v = this.fine.height(lat + a, lon + b); if (!Number.isNaN(v)) { sum += v; n++; } }
    return sum / n;
  }
}
