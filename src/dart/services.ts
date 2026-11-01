// Picks real timetabled DART services for the options chosen on the set-up screen.
import type { TimetableData, Trip } from './data';

export type Direction = 'north' | 'south';
export type End = 'greystones' | 'bray' | 'howth' | 'malahide';
export const END_NAMES: Record<End, string> = { greystones: 'Greystones', bray: 'Bray', howth: 'Howth', malahide: 'Malahide' };
const GTFS_NAME: Record<End, RegExp> = { greystones: /^greystones/i, bray: /^bray/i, howth: /^howth$/i, malahide: /^malahide/i };

export interface RunOptions { direction: Direction; from: End; to: End; date: Date; timeMin: number; traffic: boolean }

export function pathIdFor(o: Pick<RunOptions, 'direction' | 'from' | 'to'>): string {
  return o.direction === 'north' ? `greystones-${o.to}` : `${o.from}-greystones`;
}

export function ymd(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}
export function serviceActive(tt: TimetableData, svc: string, date: Date): boolean {
  const c = tt.services[svc];
  if (!c) return false;
  const d = ymd(date);
  if (c.remove.includes(d)) return false;
  if (c.add.includes(d)) return true;
  if (d < c.start || d > c.end) return false;
  return c.days[(date.getDay() + 6) % 7] === 1;
}

export interface ServiceChoice { trip: Trip; fromIdx: number; toIdx: number; dep: number; arr: number }

/** All trips that run on `date` and call at `from` then `to` in order. */
export function findServices(tt: TimetableData, o: RunOptions): ServiceChoice[] {
  const isFrom = (i: number) => GTFS_NAME[o.from].test(tt.stations[i].name);
  const isTo = (i: number) => GTFS_NAME[o.to].test(tt.stations[i].name);
  const out: ServiceChoice[] = [];
  for (const trip of tt.trips) {
    if (!serviceActive(tt, trip.svc, o.date)) continue;
    const fi = trip.stops.findIndex((s) => isFrom(s[0]));
    if (fi < 0) continue;
    const ti = trip.stops.findIndex((s, k) => k > fi && isTo(s[0]));
    if (ti < 0) continue;
    out.push({ trip, fromIdx: fi, toIdx: ti, dep: trip.stops[fi][2], arr: trip.stops[ti][1] });
  }
  return out.sort((a, b) => a.dep - b.dep);
}

/** Services from `timeMin` onwards (wrapping to the first of the day). */
export function servicesNear(list: ServiceChoice[], timeMin: number, count = 6): ServiceChoice[] {
  const t = timeMin * 60;
  const i = list.findIndex((c) => c.dep >= t - 60);
  const start = i < 0 ? Math.max(0, list.length - count) : i;
  return list.slice(start, start + count);
}

export function fmtTime(sec: number, withSec = false): string {
  const s = ((Math.round(sec) % 86400) + 86400) % 86400;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}${withSec ? ':' + String(ss).padStart(2, '0') : ''}`;
}

/** Which of the four paths a trip runs on (for traffic), or null if it can't be placed. */
export function pathForTrip(tt: TimetableData, trip: Trip): string | null {
  const names = trip.stops.map((s) => tt.stations[s[0]].name.toLowerCase());
  const has = (re: RegExp) => names.some((n) => re.test(n));
  const first = names[0], last = names[names.length - 1];
  // Direction from the order of two well-known stations.
  const iA = names.findIndex((n) => /tara street/.test(n)), iB = names.findIndex((n) => /connolly/.test(n));
  let north: boolean;
  if (iA >= 0 && iB >= 0) north = iA < iB;
  else if (/greystones|bray|grand canal|lansdowne|pearse/.test(first)) north = true;
  else if (/howth|malahide|connolly/.test(first)) north = false;
  else return null;
  const branch = has(/^howth$|sutton|bayside/) ? 'howth' : has(/malahide|portmarnock|clongriffin/) ? 'malahide' : (/howth/.test(last) || /howth/.test(first)) ? 'howth' : 'malahide';
  return north ? `greystones-${branch}` : `${branch}-greystones`;
}
