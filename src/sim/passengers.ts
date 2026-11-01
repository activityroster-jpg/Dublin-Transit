// Passengers waiting on platforms, alighting and boarding through the open doors.
import * as THREE from 'three';
import type { TrackPath } from '../dart/path';
import type { StationData } from '../dart/data';
import type { HeightField } from '../render/terrain';
import { PLATFORM_EDGE, PLATFORM_H } from '../render/stations';
import { CAR_GAP, CAR_LEN, DOOR_Z } from '../train/model';
import type { PersonVisual } from '../render/people';
import { rng } from '../core/rand';

type State = 'waiting' | 'toDoor' | 'boarded' | 'alighting' | 'leaving' | 'gone';
interface Pax { vis: PersonVisual; state: State; tx: number; tz: number; speed: number; door: number; delay: number }

const TOPS = [0x1b2a3a, 0x2c2c2c, 0x6b1d1d, 0x2f4f2f, 0x8a6d3b, 0x3b4d6b, 0xb8b8b0, 0x553366, 0x1f1f1f, 0x9b2335, 0xd6b25e, 0x264653];
const LEGS = [0x1c2433, 0x222222, 0x3a3a3a, 0x4a3b2a, 0x2d3a4a, 0x111111];
const SKIN = [0xf1c7a5, 0xe0ac8a, 0xc68e6a, 0x8d5a3c, 0xf5d0b5, 0x6b4430];
const HAIR = [0x2b1d14, 0x5a3b22, 0x111111, 0x9a6b3c, 0xc9a66b, 0x777777];

export function demandFactor(timeSec: number): number {
  const h = timeSec / 3600;
  const peak = Math.exp(-(((h - 8.1) / 1.0) ** 2)) * 1.0 + Math.exp(-(((h - 17.6) / 1.2) ** 2)) * 0.9;
  return 0.25 + peak + (h > 10 && h < 16 ? 0.25 : 0) - (h < 6.5 || h > 22 ? 0.15 : 0);
}
const BUSY = /connolly|tara|pearse|grand canal|dun laoghaire|bray|howth junction|blackrock|malahide|lansdowne/i;

export class PassengerSim {
  pax: Pax[] = [];
  private station: StationData | null = null;
  onboard = 0;
  alightRemaining = 0;
  boardingDone = true;
  leftBehind = 0;

  constructor(private path: TrackPath, private hf: HeightField, private maxPeople: number) {}

  /** Populate the platform of the next station. */
  prepare(st: StationData, time: number, isTerminus: boolean, isOrigin: boolean) {
    if (this.station === st) return;
    this.clear();
    this.station = st;
    const r = rng(Math.floor(st.s * 13 + time));
    const base = BUSY.test(st.name) ? 30 : 12;
    let n = Math.round(base * demandFactor(time) * (0.6 + r() * 0.8));
    if (isTerminus) n = Math.round(n * 0.25);
    n = Math.min(n, this.maxPeople - 10);
    this.alightRemaining = isOrigin ? 0 : isTerminus ? Math.min(this.onboard, 30) : Math.min(this.onboard, Math.round(this.onboard * (0.15 + r() * 0.25)));
    const side = st.platform.side, w = Math.max(3.5, Math.min(7, st.platform.width || 4));
    const trainRear = st.s - 4 * CAR_LEN - 3 * CAR_GAP;
    for (let i = 0; i < n; i++) {
      const s = Math.max(st.platform.s0 + 6, Math.min(st.platform.s1 - 6, trainRear - 15 + r() * (st.s - trainRear + 20)));
      const lat = side * (PLATFORM_EDGE + 1.6 + r() * (w - 2.4));
      const p = this.path.offsetPoint(s, lat, 0);
      const heading = this.path.heading(s) + (side > 0 ? -Math.PI / 2 : Math.PI / 2) + (r() - 0.5) * 1.5;
      this.pax.push({
        vis: { x: p.x, y: p.y + PLATFORM_H, z: p.z, heading, walking: false, phase: r() * 6, colours: [LEGS[(r() * LEGS.length) | 0], TOPS[(r() * TOPS.length) | 0], SKIN[(r() * SKIN.length) | 0], HAIR[(r() * HAIR.length) | 0]] },
        state: 'waiting', tx: p.x, tz: p.z, speed: 1.1 + r() * 0.5, door: -1, delay: 1 + r() * 4,
      });
    }
    this.boardingDone = n === 0 && this.alightRemaining === 0;
  }

  clear() { this.pax = []; this.station = null; }

  /** Door world positions for the side facing the platform. */
  private doorPositions(frontS: number, side: number): THREE.Vector3[] {
    const out: THREE.Vector3[] = [];
    for (let c = 0; c < 4; c++) {
      const cs = frontS - CAR_LEN / 2 - c * (CAR_LEN + CAR_GAP);
      for (const dz of DOOR_Z) out.push(this.path.offsetPoint(cs + dz, side * (PLATFORM_EDGE + 0.15), PLATFORM_H));
    }
    return out;
  }

  update(dt: number, doorsOpenSide: number, frontS: number, rnd: () => number) {
    const st = this.station;
    if (!st) return;
    const side = st.platform.side;
    const doors = doorsOpenSide === side ? this.doorPositions(frontS, side) : null;
    // spawn alighting passengers at doors
    if (doors && this.alightRemaining > 0 && rnd() < dt * 3) {
      const d = doors[(rnd() * doors.length) | 0];
      const exitS = rnd() < 0.5 ? st.platform.s0 + 3 : st.platform.s1 - 3;
      const target = this.path.offsetPoint(exitS, side * (PLATFORM_EDGE + 2 + rnd() * 1.5), 0);
      this.pax.push({ vis: { x: d.x, y: d.y, z: d.z, heading: 0, walking: true, phase: rnd() * 6, colours: [LEGS[(rnd() * LEGS.length) | 0], TOPS[(rnd() * TOPS.length) | 0], SKIN[(rnd() * SKIN.length) | 0], HAIR[(rnd() * HAIR.length) | 0]] }, state: 'alighting', tx: target.x, tz: target.z, speed: 1.3, door: -1, delay: 0 });
      this.alightRemaining--;
      this.onboard = Math.max(0, this.onboard - 1);
    }
    let pending = 0;
    for (const p of this.pax) {
      if (p.state === 'waiting' && doors) {
        p.delay -= dt;
        if (p.delay <= 0) {
          let best = 0, bd = Infinity;
          doors.forEach((d, i) => { const dd = (d.x - p.vis.x) ** 2 + (d.z - p.vis.z) ** 2; if (dd < bd) { bd = dd; best = i; } });
          p.door = best; p.state = 'toDoor';
        }
      }
      if (p.state === 'toDoor') {
        if (!doors) { p.state = 'waiting'; p.vis.walking = false; p.delay = 0.5; continue; }
        const d = doors[p.door];
        p.tx = d.x; p.tz = d.z;
      }
      if (p.state === 'toDoor' || p.state === 'alighting' || p.state === 'leaving') {
        const dx = p.tx - p.vis.x, dz = p.tz - p.vis.z, L = Math.hypot(dx, dz);
        p.vis.walking = true;
        p.vis.heading = Math.atan2(dx, dz);
        if (L < 0.35) {
          if (p.state === 'toDoor') { p.state = 'boarded'; this.onboard++; }
          else p.state = 'gone';
          p.vis.walking = false;
        } else {
          const st2 = Math.min(L, p.speed * dt);
          p.vis.x += (dx / L) * st2; p.vis.z += (dz / L) * st2;
          p.vis.y = this.path.point(this.path.project(p.vis.x, p.vis.z, frontS, 300).s).y + PLATFORM_H;
        }
      }
      if (p.state === 'waiting' || p.state === 'toDoor') pending++;
    }
    this.pax = this.pax.filter((p) => p.state !== 'boarded' && p.state !== 'gone');
    this.boardingDone = pending === 0 && this.alightRemaining === 0;
    void this.hf;
  }

  /** Called when the doors close: anyone still waiting/walking is left behind. */
  doorsClosed(): number {
    const n = this.pax.filter((p) => p.state === 'toDoor').length;
    for (const p of this.pax) if (p.state === 'toDoor') { p.state = 'waiting'; p.vis.walking = false; p.delay = 2; }
    this.leftBehind += n;
    return n;
  }

  visuals(): PersonVisual[] { return this.pax.map((p) => p.vis); }
}
