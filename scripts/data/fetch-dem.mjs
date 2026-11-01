// Elevation from the open AWS Terrain Tiles (Terrarium encoding; SRTM/GMTED/ETOPO sources).
// height(m) = R*256 + G + B/256 - 32768
import { PNG } from 'pngjs';
import { cachedFetch } from './lib.mjs';

const TILE = 256;
export function lonLatToTile(lon, lat, z) {
  const n = 2 ** z;
  const x = ((lon + 180) / 360) * n;
  const r = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
  return [x, y];
}

export class Dem {
  constructor(z) { this.z = z; this.tiles = new Map(); }
  async load(minLat, minLon, maxLat, maxLon) {
    const [x0, y0] = lonLatToTile(minLon, maxLat, this.z);
    const [x1, y1] = lonLatToTile(maxLon, minLat, this.z);
    for (let ty = Math.floor(y0); ty <= Math.floor(y1); ty++) {
      for (let tx = Math.floor(x0); tx <= Math.floor(x1); tx++) {
        const key = `${tx}/${ty}`;
        if (this.tiles.has(key)) continue;
        const buf = await cachedFetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${this.z}/${tx}/${ty}.png`, `dem/${this.z}/${tx}_${ty}.png`, { binary: true });
        const png = PNG.sync.read(buf);
        const h = new Float32Array(TILE * TILE);
        for (let i = 0; i < TILE * TILE; i++) h[i] = png.data[i * 4] * 256 + png.data[i * 4 + 1] + png.data[i * 4 + 2] / 256 - 32768;
        this.tiles.set(key, h);
      }
    }
  }
  /** Bilinear height in metres at lat/lon. Missing tiles -> 0. */
  height(lat, lon) {
    const [fx, fy] = lonLatToTile(lon, lat, this.z);
    const px = fx * TILE - 0.5, py = fy * TILE - 0.5;
    const x0 = Math.floor(px), y0 = Math.floor(py);
    const tx = px - x0, ty = py - y0;
    const g = (x, y) => {
      const t = this.tiles.get(`${Math.floor(x / TILE)}/${Math.floor(y / TILE)}`);
      if (!t) return 0;
      return t[(((y % TILE) + TILE) % TILE) * TILE + (((x % TILE) + TILE) % TILE)];
    };
    const a = g(x0, y0), b = g(x0 + 1, y0), c = g(x0, y0 + 1), d = g(x0 + 1, y0 + 1);
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  }
}
