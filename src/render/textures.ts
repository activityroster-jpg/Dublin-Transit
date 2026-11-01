// Texture loading (CC0 Poly Haven sets) and procedural canvas textures.
import * as THREE from 'three';
import { rng } from '../core/rand';

const BASE = `${import.meta.env.BASE_URL}assets/textures/`;
const loader = new THREE.TextureLoader();
const cache = new Map<string, THREE.Texture>();
let maxAniso = 8;
export function setMaxAnisotropy(a: number) { maxAniso = a; }

export function tex(name: string, repeat = 1, srgb = true): THREE.Texture {
  const key = `${name}|${repeat}|${srgb}`;
  let t = cache.get(key);
  if (!t) {
    t = loader.load(BASE + name + '.jpg');
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
    t.anisotropy = maxAniso;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    cache.set(key, t);
  }
  return t;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
}

/** Terrain layers packed into one array texture (one draw, nine materials). */
export const TERRAIN_LAYERS = ['terrain_grass', 'terrain_urban', 'terrain_forest', 'terrain_sand', 'terrain_rock', 'terrain_gravel', 'terrain_park', 'terrain_farm', 'terrain_paved'];
export async function loadTerrainArray(size = 512): Promise<THREE.DataArrayTexture> {
  const imgs = await Promise.all(TERRAIN_LAYERS.map((n) => loadImage(`${BASE}${n}_diff.jpg`)));
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;
  const data = new Uint8Array(size * size * 4 * imgs.length);
  imgs.forEach((img, i) => {
    ctx.drawImage(img, 0, 0, size, size);
    data.set(ctx.getImageData(0, 0, size, size).data, i * size * size * 4);
  });
  const t = new THREE.DataArrayTexture(data, size, size, imgs.length);
  t.format = THREE.RGBAFormat;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = maxAniso;
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')!];
}

/** A cluster of leaves with alpha, for tree crowns and bushes. */
export function leafTexture(seed: number, hue: number): THREE.Texture {
  const [c, g] = canvas(256, 256);
  const r = rng(seed);
  g.clearRect(0, 0, 256, 256);
  for (let i = 0; i < 520; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 112;
    const x = 128 + Math.cos(a) * d, y = 128 + Math.sin(a) * d;
    const l = 18 + r() * 22, s = 40 + r() * 30;
    g.fillStyle = `hsl(${hue + (r() - 0.5) * 22},${s}%,${l * (0.7 + 0.3 * (1 - d / 112))}%)`;
    g.save(); g.translate(x, y); g.rotate(r() * Math.PI * 2);
    g.beginPath(); g.ellipse(0, 0, 6 + r() * 6, 3 + r() * 3, 0, 0, Math.PI * 2); g.fill();
    g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Grass tuft card. */
export function grassTexture(seed: number): THREE.Texture {
  const [c, g] = canvas(128, 128);
  const r = rng(seed);
  for (let i = 0; i < 90; i++) {
    const x = 8 + r() * 112, h = 40 + r() * 85, lean = (r() - 0.5) * 30;
    g.strokeStyle = `hsl(${78 + r() * 30},${30 + r() * 25}%,${22 + r() * 22}%)`;
    g.lineWidth = 1.5 + r() * 2;
    g.beginPath(); g.moveTo(x, 128); g.quadraticCurveTo(x + lean * 0.3, 128 - h * 0.6, x + lean, 128 - h); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Station name board (Irish + English, white on dark green as on the line). */
export function stationSignTexture(en: string, ga: string | null): THREE.Texture {
  const [c, g] = canvas(1024, 192);
  g.fillStyle = '#0d4f3c'; g.fillRect(0, 0, 1024, 192);
  g.strokeStyle = '#ffffff'; g.lineWidth = 6; g.strokeRect(10, 10, 1004, 172);
  g.fillStyle = '#ffffff'; g.textAlign = 'center';
  const fit = (txt: string, size: number, y: number, weight: string) => {
    let s = size;
    do { g.font = `${weight} ${s}px "Segoe UI", Helvetica, Arial, sans-serif`; s -= 2; } while (g.measureText(txt).width > 960 && s > 20);
    g.fillText(txt, 512, y);
  };
  if (ga) { fit(ga, 54, 82, 'italic 500'); fit(en, 64, 158, '700'); }
  else fit(en, 80, 125, '700');
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function textTexture(text: string, opts: { w?: number; h?: number; bg?: string; fg?: string; font?: string } = {}): THREE.CanvasTexture {
  const [c, g] = canvas(opts.w ?? 256, opts.h ?? 64);
  g.fillStyle = opts.bg ?? '#000'; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = opts.fg ?? '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = opts.font ?? `bold ${Math.floor(c.height * 0.6)}px Helvetica, Arial, sans-serif`;
  g.fillText(text, c.width / 2, c.height / 2 + 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Palisade fence pattern (alpha). */
export function fenceTexture(): THREE.Texture {
  const [c, g] = canvas(128, 128);
  g.clearRect(0, 0, 128, 128);
  g.fillStyle = '#1f3a2a';
  for (let x = 4; x < 128; x += 16) { g.fillRect(x, 6, 7, 122); g.beginPath(); g.moveTo(x - 1, 8); g.lineTo(x + 3.5, 0); g.lineTo(x + 8, 8); g.fill(); }
  g.fillRect(0, 22, 128, 6); g.fillRect(0, 100, 128, 6);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Dark-orange LED destination display. */
export function destinationTexture(text: string): THREE.CanvasTexture {
  const [c, g] = canvas(512, 96);
  g.fillStyle = '#080604'; g.fillRect(0, 0, 512, 96);
  g.fillStyle = '#ffb21a'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = 'bold 54px "Courier New", monospace';
  g.shadowColor = '#ff8a00'; g.shadowBlur = 8;
  g.fillText(text, 256, 50);
  // LED dot mask
  g.globalCompositeOperation = 'destination-in';
  for (let y = 0; y < 96; y += 4) for (let x = 0; x < 512; x += 4) { g.fillRect(x, y, 3, 3); }
  g.globalCompositeOperation = 'destination-over';
  g.fillStyle = '#080604'; g.fillRect(0, 0, 512, 96);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
