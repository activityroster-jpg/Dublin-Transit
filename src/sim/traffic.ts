// Other DART services from the real timetable, moved along their own track between their
// timetabled stops with realistic acceleration, cruising and braking.
import * as THREE from 'three';
import type { Network, TrackPath } from '../dart/path';
import type { TimetableData, Trip } from '../dart/data';
import { pathForTrip, serviceActive } from '../dart/services';
import { TrainModel } from '../train/model';

interface Leg { s0: number; s1: number; t0: number; t1: number }
export interface AiTrain { trip: Trip; path: TrackPath; legs: Leg[]; dwells: { s: number; t0: number; t1: number }[]; tStart: number; tEnd: number; model: TrainModel | null; s: number; v: number; dest: string; active: boolean }

/** Position along a leg using a trapezoid speed profile that fits the timetabled run time. */
function legPos(leg: Leg, t: number, vmax: number): { s: number; v: number } {
  const D = leg.s1 - leg.s0, T = leg.t1 - leg.t0;
  if (D <= 0 || T <= 0) return { s: leg.s1, v: 0 };
  const a = 0.7, b = 0.7;
  // solve cruise speed vc: D = vc*T - vc^2/(2a) - vc^2/(2b)
  const k = 1 / (2 * a) + 1 / (2 * b);
  const disc = T * T - 4 * k * D;
  let vc = disc > 0 ? (T - Math.sqrt(disc)) / (2 * k) : T / (2 * k);
  vc = Math.min(vc, vmax);
  const ta = vc / a, tb = vc / b;
  const tc = Math.max(0, T - ta - tb);
  const tt = Math.max(0, Math.min(T, t - leg.t0));
  let s: number, v: number;
  if (tt < ta) { s = 0.5 * a * tt * tt; v = a * tt; }
  else if (tt < ta + tc) { s = 0.5 * a * ta * ta + vc * (tt - ta); v = vc; }
  else { const tr = Math.min(tb, tt - ta - tc); s = 0.5 * a * ta * ta + vc * tc + vc * tr - 0.5 * b * tr * tr; v = vc - b * tr; }
  const total = 0.5 * a * ta * ta + vc * tc + 0.5 * vc * tb;
  return { s: leg.s0 + Math.min(D, (s / Math.max(total, 1e-6)) * D), v: Math.max(0, v) };
}

export class Traffic {
  readonly trains: AiTrain[] = [];
  readonly group = new THREE.Group();

  constructor(net: Network, tt: TimetableData, date: Date, excludeTripId: string) {
    for (const trip of tt.trips) {
      if (trip.id === excludeTripId || !serviceActive(tt, trip.svc, date)) continue;
      const pid = pathForTrip(tt, trip);
      if (!pid) continue;
      const path = net.get(pid);
      const stopsS: { s: number; arr: number; dep: number }[] = [];
      for (const [si, arr, dep] of trip.stops) {
        const k = path.stationIndexByGtfs(tt.stations[si].id);
        if (k < 0) continue;
        stopsS.push({ s: path.data.stations[k].s, arr, dep });
      }
      if (stopsS.length < 2) continue;
      const legs: Leg[] = [], dwells: AiTrain['dwells'] = [];
      for (let i = 0; i < stopsS.length; i++) {
        dwells.push({ s: stopsS[i].s, t0: i === 0 ? stopsS[i].dep - 120 : stopsS[i].arr, t1: stopsS[i].dep });
        if (i + 1 < stopsS.length) legs.push({ s0: stopsS[i].s, s1: stopsS[i + 1].s, t0: stopsS[i].dep, t1: stopsS[i + 1].arr });
      }
      const dest = tt.stations[trip.stops[trip.stops.length - 1][0]].name.replace(/\s*\(.*\)/, '');
      this.trains.push({ trip, path, legs, dwells, tStart: dwells[0].t0, tEnd: stopsS[stopsS.length - 1].arr + 90, model: null, s: stopsS[0].s, v: 0, dest, active: false });
    }
  }

  /** Advances all services to `time` (seconds since midnight); builds/disposes models near the camera. */
  update(time: number, dt: number, cam: THREE.Vector3, viewDist: number, player: { path: TrackPath; s: number; rearS: number }) {
    const p = new THREE.Vector3();
    for (const tr of this.trains) {
      const active = time >= tr.tStart && time <= tr.tEnd;
      tr.active = active;
      if (!active) { if (tr.model) this.drop(tr); continue; }
      let s = tr.s, v = 0;
      const dw = tr.dwells.find((d) => time >= d.t0 && time < d.t1);
      if (dw) { s = dw.s; v = 0; }
      else {
        const leg = tr.legs.find((l) => time >= l.t0 && time < l.t1) ?? tr.legs[tr.legs.length - 1];
        const r = legPos(leg, time, Math.min(26, tr.path.speedLimit(tr.s) / 3.6));
        s = r.s; v = r.v;
      }
      // never run into the player's train on a shared track
      if (sameTrack(tr.path, player.path, s)) {
        const ps = player.path.project(tr.path.point(s, p).x, p.z, player.s, 3000);
        if (ps.d < 2.5 && ps.s < player.s && ps.s > player.rearS - 260) { s = tr.s; v = 0; }
      }
      tr.s = s; tr.v = v;
      tr.path.point(s, p);
      const near = p.distanceTo(cam) < viewDist;
      if (near && !tr.model) {
        tr.model = new TrainModel(4, tr.dest);
        this.group.add(tr.model.group);
      } else if (!near && tr.model) this.drop(tr);
      if (tr.model) {
        tr.model.placeOnPath(tr.path, s, false, v, dt);
        tr.model.setLights(true, 0);
        const atStop = !!dw && time > dw.t0 + 8 && time < dw.t1 - 10;
        tr.model.doorOpen.left = tr.model.doorOpen.right = 0;
        if (atStop) {
          const k = tr.path.data.stations.findIndex((st) => Math.abs(st.s - s) < 5);
          if (k >= 0) { const side = tr.path.data.stations[k].platform.side; tr.model.doorOpen[side > 0 ? 'right' : 'left'] = 1; }
        }
        tr.model.updateDoors();
      }
    }
  }

  /** Chainage ranges occupied on `path` by other trains running on the same physical track. */
  occupancy(path: TrackPath, aroundS: number): [number, number][] {
    const out: [number, number][] = [];
    const p = new THREE.Vector3();
    for (const tr of this.trains) {
      if (!tr.active) continue;
      if (tr.path.northbound !== path.northbound) continue;
      tr.path.point(tr.s, p);
      const pr = path.project(p.x, p.z, aroundS, 6000);
      if (pr.d > 2.5) continue;
      out.push([pr.s - 82, pr.s]);
    }
    return out;
  }

  private drop(tr: AiTrain) { if (!tr.model) return; this.group.remove(tr.model.group); tr.model.dispose(); tr.model = null; }
  dispose() { for (const t of this.trains) this.drop(t); }
}

function sameTrack(a: TrackPath, b: TrackPath, _s: number) { return a.northbound === b.northbound; }
