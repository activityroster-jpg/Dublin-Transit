// Types and loaders for the baked DART data in public/data/dart/.
export const ORIGIN = { lat: 53.3, lon: -6.18 };
const BASE = `${import.meta.env.BASE_URL}data/dart/`;

export interface PlatformData { s0: number; s1: number; side: number; edge: number; width: number; ref: string | null; guessed?: boolean }
export interface StationData { name: string; nameGa: string | null; gtfs: string; gtfsIdx: number; s: number; osmS: number; platform: PlatformData }
export interface SignalData { s: number; ref: string | null; aspects?: number; pos: string; route?: boolean; repeater?: boolean; src: 'osm' | 'gen' }
export type Structure = [number, number, 'bridge' | 'viaduct' | 'tunnel' | 'cutting' | 'embankment', number];
export interface PathData {
  id: string; from: string; to: string; osmRelation: number; step: number; length: number;
  pts: number[]; ground: number[]; speed: [number, number][]; structures: Structure[];
  stations: StationData[]; signals: SignalData[]; speedSigns: [number, number][]; mileposts: [number, string][]; wayRuns: [number, number][];
}
export interface NetworkData { attribution: string; origin: { lat: number; lon: number }; paths: PathData[] }

export interface TimetableStation { id: string; name: string; nameGa: string | null; lat: number; lon: number }
export interface ServiceCal { days: number[]; start: string; end: string; add: string[]; remove: string[] }
export interface Trip { id: string; svc: string; dir: number; head: string; code: string; block: string; stops: [number, number, number][] }
export interface TimetableData { source: string; feedVersion: string; feedStart: string; feedEnd: string; stations: TimetableStation[]; services: Record<string, ServiceCal>; trips: Trip[] }

export interface TerrainIndex {
  near: { size: number; n: number; tiles: [number, number][] };
  far: { size: number; n: number; tiles: [number, number][] };
  scenery: { size: number; tiles: string[] };
  classes: Record<string, number>;
}
/** Scenery tile: b=buildings, r=roads, t=trees, f=barriers, l=lamps. */
export interface SceneryTile {
  b: [number[], number, number, number, string, string, string | null, string | null, string | null][];
  r: [number[], number, string, number, string | null][];
  t: [number, number, number, number][];
  f: [number[], string, number | null][];
  l: [number, number, number][];
  /** rocks: x, z, y, scale, yaw */
  k?: [number, number, number, number, number][];
}

async function getJson<T>(name: string): Promise<T> {
  const r = await fetch(BASE + name);
  if (!r.ok) throw new Error(`Failed to load ${name}: ${r.status}`);
  return r.json() as Promise<T>;
}
async function getBin(name: string, onProgress?: (f: number) => void): Promise<ArrayBuffer> {
  const r = await fetch(BASE + name);
  if (!r.ok || !r.body) throw new Error(`Failed to load ${name}`);
  const total = +(r.headers.get('content-length') ?? 0);
  if (!total || !onProgress) return r.arrayBuffer();
  const reader = r.body.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); got += value.length; onProgress(Math.min(1, got / total));
  }
  const out = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out.buffer;
}

export interface DartData { network: NetworkData; timetable: TimetableData; terrain: TerrainIndex; near: ArrayBuffer; far: ArrayBuffer }

export async function loadTimetable(): Promise<TimetableData> { return getJson<TimetableData>('timetable.json'); }

export async function loadDart(onProgress: (label: string, f: number) => void, timetable?: TimetableData): Promise<DartData> {
  onProgress('Track and signals', 0);
  const [network, tt, terrain] = await Promise.all([getJson<NetworkData>('network.json'), timetable ? Promise.resolve(timetable) : loadTimetable(), getJson<TerrainIndex>('terrain.json')]);
  onProgress('Terrain', 0.1);
  const near = await getBin('terrain-near.bin', (f) => onProgress('Terrain', 0.1 + f * 0.7));
  const far = await getBin('terrain-far.bin', (f) => onProgress('Horizon', 0.8 + f * 0.2));
  return { network, timetable: tt, terrain, near, far };
}

/** What is beside each track (see scripts/data/lineside.mjs). Missing file -> null (plain fences). */
export async function loadLineside(): Promise<import('../render/track').LinesideData | null> {
  try { const r = await fetch(BASE + 'lineside.json'); return r.ok ? ((await r.json()) as import('../render/track').LinesideData) : null; } catch { return null; }
}

const sceneryCache = new Map<string, Promise<SceneryTile | null>>();
export function loadSceneryTile(key: string): Promise<SceneryTile | null> {
  let p = sceneryCache.get(key);
  if (!p) {
    p = fetch(`${BASE}scenery/${key}.json`).then((r) => (r.ok ? (r.json() as Promise<SceneryTile>) : null)).catch(() => null);
    sceneryCache.set(key, p);
  }
  return p;
}
