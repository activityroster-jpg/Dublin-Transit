// A DART driving run: ties together world, train, cab, signalling, timetable, passengers,
// traffic, scoring, cameras, audio and input.
import * as THREE from 'three';
import type { QualitySettings } from '../core/env';
import { isTouch } from '../core/env';
import { Engine } from '../render/engine';
import { World } from '../render/world';
import { makeSea } from '../render/water';
import { PeopleRenderer } from '../render/people';
import { buildingUniforms } from '../render/buildings';
import { streetMaterials } from '../render/streets';
import { stationLampMats } from '../render/stations';
import { windUniforms } from '../render/vegetation';
import { setMaxAnisotropy } from '../render/textures';
import { WIRE_HEIGHT } from '../render/track';
import { Network, type TrackPath } from './path';
import type { DartData, StationData } from './data';
import { END_NAMES, fmtTime, pathIdFor, type RunOptions, type ServiceChoice } from './services';
import { CAR_GAP, CAR_LEN, TrainModel } from '../train/model';
import { Cab, EYE } from '../train/cab';
import { NOTCH_MAX, NOTCH_MIN, TrainPhysics, notchLabel } from '../train/physics';
import { Signalling } from '../sim/signalling';
import { Traffic } from '../sim/traffic';
import { PassengerSim } from '../sim/passengers';
import { Scorer, fmtDelta, type ScoreEvent } from '../sim/scoring';
import { TrainAudio } from '../audio/audio';
import { rng } from '../core/rand';

export type CameraMode = 'cab' | 'outside' | 'trackside' | 'passenger' | 'free';
export const CAMERA_LABELS: Record<CameraMode, string> = { cab: 'Driver cab', outside: 'Outside (orbit)', trackside: 'Trackside', passenger: 'Passenger', free: 'Free camera' };

interface Stop { st: StationData; name: string; arr: number; dep: number; s: number; side: number; arrived: boolean; departed: boolean; arrTime?: number; depTime?: number; error?: number; skipped?: boolean }

export interface HudState {
  clock: string; service: string; kmh: number; limit: number; nextLimit: { kmh: number; dist: number } | null; notch: string; notchValue: number;
  aspect: string; nextSignalDist: number | null; warning: boolean; interlock: boolean; doorsL: number; doorsR: number;
  next: { name: string; arr: string; dist: number; delta: string; side: string } | null; score: number; camera: CameraMode;
  stops: { name: string; arr: string; dep: string; actual: string; state: 'done' | 'next' | 'future' | 'missed' }[];
  boarding: string | null; paused: boolean; tunnel: boolean;
}

export class DartGame {
  readonly engine: Engine;
  readonly net: Network;
  readonly path: TrackPath;
  world: World;
  private train: TrainModel;
  private cab: Cab;
  readonly phys = new TrainPhysics();
  private sig: Signalling;
  private traffic: Traffic | null = null;
  private pax: PassengerSim;
  private people: PeopleRenderer;
  readonly score = new Scorer();
  readonly audio = new TrainAudio();
  private sea = makeSea();
  readonly stops: Stop[] = [];
  private nextStop = 1;
  clock: number;
  private cameras: Record<CameraMode, THREE.PerspectiveCamera>;
  camera: CameraMode = 'cab';
  private look = { yaw: 0, pitch: -0.06, dist: 36, az: 2.2, el: 0.45 };
  private free = { pos: new THREE.Vector3(), yaw: 0, pitch: 0, keys: new Set<string>() };
  private trackside = { s: 0 };
  private doorTarget = { left: 0, right: 0 };
  private wrongSideFlag = false;
  pantograph = true;
  headlights = true;
  private ebLatched = false;
  private cawsBrake = false;
  private atp = false;
  paused = false;
  state: 'ready' | 'driving' | 'finished' | 'failed' = 'ready';
  failReason = '';
  private t = 0;
  /** Rendered frame counter (used by tooling). */
  frames = 0;
  private last = performance.now();
  private raf = 0;
  private rnd = rng(42);
  private hornOn = false;
  private messages: { text: string; until: number; kind: string }[] = [];
  onMessage: ((text: string, kind: string) => void) | null = null;
  onScoreEvent: ((e: ScoreEvent) => void) | null = null;
  onEnd: ((g: DartGame) => void) | null = null;
  private raycaster = new THREE.Raycaster();
  private endS: number;
  private startS: number;
  private warnStart = 0;

  constructor(private container: HTMLElement, data: DartData, readonly opts: RunOptions, readonly choice: ServiceChoice, readonly q: QualitySettings) {
    this.engine = new Engine(container, q);
    setMaxAnisotropy(this.engine.renderer.capabilities.getMaxAnisotropy());
    this.net = new Network(data.network.paths);
    this.path = this.net.get(pathIdFor(opts));
    // Booked stops for this service on this path
    const tt = data.timetable;
    for (let k = choice.fromIdx; k <= choice.toIdx; k++) {
      const [si, arr, dep] = choice.trip.stops[k];
      const idx = this.path.stationIndexByGtfs(tt.stations[si].id);
      if (idx < 0) continue;
      const st = this.path.data.stations[idx];
      this.stops.push({ st, name: tt.stations[si].name.replace(/\s*\(.*\)/, ''), arr, dep, s: st.s, side: st.platform.side, arrived: k === choice.fromIdx, departed: false });
    }
    this.startS = this.stops[0].s;
    this.endS = this.stops[this.stops.length - 1].s;
    this.phys.s = this.startS;
    this.phys.passengers = 40;
    this.clock = this.stops[0].dep - 75;
    this.world = new World(data, this.net, q, this.path);
    this.engine.scene.add(this.world.group, this.sea.mesh);
    // Player train + cab
    const dest = END_NAMES[opts.to];
    this.train = new TrainModel(4, dest, true);
    this.engine.scene.add(this.train.group);
    this.cab = new Cab();
    this.train.cars[0].group.add(this.cab.group);
    this.sig = new Signalling(this.path, this.startS, this.endS);
    this.sig.onWarning = () => { this.audio.warning(true); this.warnStart = this.t; };
    this.sig.onAck = () => { this.audio.warning(false); this.audio.bell(); };
    this.sig.onClear = () => this.audio.bell();
    if (opts.traffic) { this.traffic = new Traffic(this.net, tt, opts.date, choice.trip.id); this.engine.scene.add(this.traffic.group); }
    this.pax = new PassengerSim(this.path, this.world.hf, q.maxPeople);
    this.people = new PeopleRenderer(q.maxPeople + 40);
    this.engine.scene.add(this.people.mesh);
    this.score.onEvent = (e) => this.onScoreEvent?.(e);
    // cameras
    const mk = (fov: number, near = 0.1) => new THREE.PerspectiveCamera(fov, container.clientWidth / container.clientHeight, near, 24000);
    this.cameras = { cab: mk(62, 0.03), outside: mk(50), trackside: mk(40), passenger: mk(65, 0.05), free: mk(60) };
    this.cameras.cab.rotation.order = 'YXZ';
    this.cameras.passenger.rotation.order = 'YXZ';
    this.cameras.free.rotation.order = 'YXZ';
    this.train.cars[0].group.add(this.cameras.cab);
    this.cameras.cab.position.copy(EYE);
    this.train.cars[1].group.add(this.cameras.passenger);
    this.cameras.passenger.position.set(0.75, 2.25, 2.4);
    this.setCamera('cab');
    // start at the platform with doors open on the platform side
    this.doorTarget[this.stops[0].side > 0 ? 'right' : 'left'] = 1;
    this.train.doorOpen[this.stops[0].side > 0 ? 'right' : 'left'] = 1;
    this.phys.notch = -7;
    const startDate = this.dateAt(this.clock);
    this.engine.setTime(startDate, 0.35);
    this.placeTrain(0);
  }

  private dateAt(clock: number): Date {
    const d = new Date(this.opts.date);
    d.setHours(0, 0, 0, 0);
    return new Date(d.getTime() + clock * 1000);
  }

  async load(onProgress: (label: string, f: number) => void) {
    await this.world.init();
    onProgress('Sky', 0);
    await Promise.race([this.engine.skyReady, new Promise((r) => setTimeout(r, 20000))]);
    const p = this.path.point(this.phys.s);
    await this.world.prime(p, (f) => onProgress('Building the line', f));
    this.pax.prepare(this.stops[0].st, this.clock, false, true);
    this.bindInput();
  }

  start() {
    this.audio.start();
    this.state = 'driving';
    this.message(`${fmtTime(this.stops[0].dep)} ${this.stops[0].name} → ${this.stops[this.stops.length - 1].name}. Passengers are boarding. Close the doors when boarding is complete, then depart on time.`, 'info', 9);
    this.last = performance.now();
    const loop = () => { this.raf = requestAnimationFrame(loop); this.frame(); };
    loop();
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.unbind?.();
    this.audio.stop();
    this.traffic?.dispose();
    this.engine.renderer.dispose();
    this.engine.renderer.domElement.remove();
  }

  // ---------------------------------------------------------------- controls
  notch(delta: number) {
    if (this.state !== 'driving') return;
    const n = Math.max(NOTCH_MIN, Math.min(NOTCH_MAX, this.phys.notch + delta));
    if (n !== this.phys.notch) { this.phys.notch = n; this.audio.click(); }
  }
  setNotch(n: number) { if (this.state === 'driving') { const v = Math.max(NOTCH_MIN, Math.min(NOTCH_MAX, Math.round(n))); if (v !== this.phys.notch) { this.phys.notch = v; this.audio.click(); } } }
  emergency() {
    if (this.state !== 'driving') return;
    if (this.phys.notch !== NOTCH_MIN && this.phys.v > 1) this.score.emergencyUse(this.clock);
    this.phys.notch = NOTCH_MIN; this.audio.click();
  }
  acknowledge() {
    if (this.sig.warning) {
      const rt = this.t - this.warnStart;
      this.sig.acknowledge();
      this.score.cawsAck(this.clock, rt);
    }
    if (this.cawsBrake && this.phys.v < 0.1) { this.cawsBrake = false; this.message('Brake demand reset. Continue with caution.', 'info'); }
  }
  openDoors(side: 'left' | 'right') {
    if (this.state !== 'driving') return;
    if (this.phys.v > 0.2) { this.message('Doors cannot be released while moving.', 'warn'); return; }
    if (this.doorTarget[side] === 1) return;
    const stop = this.currentStop();
    const platformSide = stop ? (stop.side > 0 ? 'right' : 'left') : null;
    if (!stop) { this.score.offPlatform(this.clock); this.message('Doors released away from a platform!', 'bad'); }
    else if (platformSide !== side) { if (!this.wrongSideFlag) { this.score.wrongSide(this.clock); this.wrongSideFlag = true; } this.message(`Wrong side! The platform at ${stop.name} is on the ${platformSide}.`, 'bad'); }
    this.doorTarget[side] = 1;
    this.audio.doorChime(false);
  }
  closeDoors(side?: 'left' | 'right') {
    const sides: ('left' | 'right')[] = side ? [side] : ['left', 'right'];
    let any = false;
    for (const s of sides) if (this.doorTarget[s] === 1) { this.doorTarget[s] = 0; any = true; }
    if (!any) return;
    this.audio.doorChime(true);
    const n = this.pax.doorsClosed();
    if (n) { this.score.leftBehind(this.clock, n); this.message(`${n} passenger${n > 1 ? 's' : ''} left on the platform.`, 'warn'); }
  }
  horn(on: boolean) { if (on !== this.hornOn) { this.hornOn = on; this.audio.horn(on); } }
  togglePantograph(up?: boolean) {
    this.pantograph = up ?? !this.pantograph;
    this.message(this.pantograph ? 'Pantograph raised.' : 'Pantograph lowered: no traction power.', 'info');
  }
  toggleHeadlights() { this.headlights = !this.headlights; }
  toggleWiper() { this.cab.wiperOn = !this.cab.wiperOn; }
  setPaused(p: boolean) { this.paused = p; if (!p) this.last = performance.now(); }

  setCamera(mode: CameraMode) {
    this.camera = mode;
    this.engine.setCamera(this.cameras[mode]);
    this.engine.resize(this.container.clientWidth, this.container.clientHeight);
    const inCab = mode === 'cab';
    this.train.setExteriorVisible(0, !inCab);
    this.cab.group.visible = inCab;
    this.audio.setInterior(inCab || mode === 'passenger');
    if (mode === 'free') { this.free.pos.copy(this.cameras[this.prevCam ?? 'outside'].getWorldPosition(new THREE.Vector3())); }
    if (mode === 'trackside') this.trackside.s = this.phys.s + 180;
    this.look.yaw = 0; this.look.pitch = mode === 'cab' ? -0.06 : 0;
    this.prevCam = mode;
  }
  private prevCam: CameraMode | null = null;
  cycleCamera() { const order: CameraMode[] = ['cab', 'outside', 'trackside', 'passenger', 'free']; this.setCamera(order[(order.indexOf(this.camera) + 1) % order.length]); }

  // ---------------------------------------------------------------- simulation
  private currentStop(): Stop | null {
    const s = this.phys.s;
    for (const st of this.stops) {
      const p = st.st.platform;
      if (s > p.s0 + 20 && s < p.s1 + 25 && Math.abs(s - st.s) < 60) return st;
    }
    return null;
  }

  message(text: string, kind = 'info', secs = 5) {
    this.messages.push({ text, kind, until: this.t + secs });
    this.onMessage?.(text, kind);
  }

  private frame() {
    const now = performance.now();
    let dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (this.paused) dt = 0;
    this.t += dt;
    this.frames++;
    if (this.state === 'driving' && dt > 0) this.simulate(dt);
    this.updateVisuals(dt);
    this.engine.render();
  }

  private simulate(dt: number) {
    this.clock += dt;
    const P = this.phys;
    // doors
    for (const side of ['left', 'right'] as const) {
      const cur = this.train.doorOpen[side], tgt = this.doorTarget[side];
      if (cur !== tgt) {
        const nv = tgt > cur ? Math.min(tgt, cur + dt / 2.6) : Math.max(tgt, cur - dt / 3.2);
        if (nv === 0 && cur > 0) { this.audio.doorSlam(); }
        this.train.doorOpen[side] = nv;
      }
    }
    const interlock = this.train.doorOpen.left === 0 && this.train.doorOpen.right === 0 && this.doorTarget.left === 0 && this.doorTarget.right === 0;
    // safety systems
    const limit = this.path.speedLimit(P.s);
    const kmh = P.kmh;
    if (kmh > limit + 10 && !this.atp) { this.atp = true; this.score.penalty(this.clock, 'safety', 8, `ATP intervention at ${Math.round(kmh)} km/h (limit ${limit})`); this.message('ATP: overspeed brake intervention!', 'bad'); }
    if (this.atp && kmh < limit) this.atp = false;
    if (this.sig.warning && this.sig.warnTimer > 7 && !this.cawsBrake) { this.cawsBrake = true; this.score.cawsMissed(this.clock); this.sig.acknowledge(); this.message('CAWS warning not acknowledged: brakes applied. Stop, then press ACK.', 'bad', 7); }
    P.forcedBrake = this.ebLatched || this.cawsBrake ? 1 : this.atp ? 0.7 : 0;
    P.tractionAvail = interlock && this.pantograph;
    if (!interlock && P.notch > 0 && Math.floor(this.t * 2) % 6 === 0 && this.messages.every((m) => !m.text.startsWith('No traction'))) this.message('No traction: doors not closed and locked.', 'warn', 2);
    // passengers on board change the mass
    P.passengers = this.pax.onboard + 40;
    // physics (sub-stepped)
    const grade = this.path.grade(P.s - 40);
    const steps = Math.ceil(dt / 0.02);
    for (let i = 0; i < steps; i++) P.step(dt / steps, grade);
    if (P.s > this.path.length - 2) { P.s = this.path.length - 2; P.v = 0; }
    this.score.speed(this.clock, dt, kmh, limit);

    // signalling
    const occ = this.traffic ? this.traffic.occupancy(this.path, P.s) : [];
    const rear = P.s - this.train.length;
    this.sig.update(dt, P.s, rear, occ.filter(([, f]) => f > P.s + 5), this.endS);
    if (this.sig.spad && !this.ebLatched) {
      this.ebLatched = true;
      this.score.spadEvent(this.clock, this.sig.spad.ref);
      this.message(`SPAD! Signal ${this.sig.spad.ref} passed at danger. Emergency brake applied.`, 'bad', 10);
      this.audio.warning(false);
    }
    if (this.ebLatched && P.v < 0.05 && this.state === 'driving') { this.state = 'failed'; this.failReason = `Signal ${this.sig.spad?.ref ?? ''} passed at danger.`; this.finish(); return; }

    // station logic
    const ns = this.stops[this.nextStop];
    if (ns) {
      const ahead = ns.s - P.s;
      if (ahead < 900 && !ns.arrived) this.pax.prepare(ns.st, this.clock, this.nextStop === this.stops.length - 1, false);
      if (!ns.arrived && P.v < 0.05 && ahead < 25 && ahead > -40) {
        ns.arrived = true; ns.arrTime = this.clock; ns.error = -ahead;
        const overran = P.s > ns.st.platform.s1 + 1;
        this.score.stop(this.clock, ns.name, ns.error, overran);
        this.score.arrival(this.clock, ns.name, this.clock - ns.arr);
        this.wrongSideFlag = false;
        this.message(`${ns.name}: ${Math.abs(ns.error) < 0.5 ? 'on the mark' : `${Math.abs(ns.error).toFixed(1)} m ${ns.error > 0 ? 'past' : 'short of'} the mark`}, ${fmtDelta(this.clock - ns.arr)}. Release the ${ns.side > 0 ? 'RIGHT' : 'LEFT'} doors.`, 'good', 7);
      } else if (!ns.arrived && ahead < -60) {
        ns.skipped = true; ns.arrived = true; ns.departed = true;
        this.score.missedStop(this.clock, ns.name);
        this.message(`You ran through ${ns.name} without stopping!`, 'bad', 7);
        this.nextStop++;
      }
      if (ns.arrived && !ns.departed && !ns.skipped && this.nextStop === this.stops.length - 1 && this.train.doorOpen[ns.side > 0 ? 'right' : 'left'] > 0.9) {
        this.terminusTimer += dt;
        if (this.terminusTimer > 10) { ns.departed = true; this.state = 'finished'; this.finish(); return; }
      }
    }
    // departure from the stop we're at (including the origin)
    const cur = this.stops[this.nextStop - 1];
    if (cur && cur.arrived && !cur.departed && P.s > cur.s + 3 && interlock) {
      cur.departed = true; cur.depTime = this.clock;
      this.score.departure(this.clock, cur.name, this.clock - cur.dep);
      if (this.clock - cur.dep < -10) this.message(`Departed ${cur.name} early: wait for the booked time.`, 'warn');
    }
    if (ns && ns.arrived && !ns.skipped && P.s > ns.s + 3 && interlock && !ns.departed) {
      ns.departed = true; ns.depTime = this.clock;
      this.score.departure(this.clock, ns.name, this.clock - ns.dep);
      if (this.clock - ns.dep < -10) this.message(`Departed ${ns.name} early: wait for the booked time.`, 'warn');
      this.nextStop++;
    }
    const doorSide = this.train.doorOpen.left > 0.95 ? -1 : this.train.doorOpen.right > 0.95 ? 1 : 0;
    this.pax.update(dt, doorSide, P.s, this.rnd);
    if (doorSide !== 0 && this.pax.boardingDone && !this.boardingAnnounced) { this.boardingAnnounced = true; this.message('Boarding complete: close the doors.', 'info', 4); }
    if (doorSide === 0) this.boardingAnnounced = false;
    if (this.cawsBrake || this.ebLatched) this.audio.warning(false);
  }
  private boardingAnnounced = false;
  private terminusTimer = 0;

  private finish() {
    this.audio.warning(false);
    this.horn(false);
    setTimeout(() => this.onEnd?.(this), 1200);
  }

  private placeTrain(dt: number) {
    this.train.placeOnPath(this.path, this.phys.s, false, this.phys.v, dt);
    this.train.updateDoors();
  }

  private updateVisuals(dt: number) {
    const P = this.phys;
    this.placeTrain(dt);
    this.train.setPantograph(WIRE_HEIGHT, this.pantograph);
    this.train.setLights(this.headlights, this.engine.night);
    // camera rigs
    const cam = this.cameras[this.camera];
    if (this.camera === 'cab') { cam.rotation.set(this.look.pitch, Math.PI + this.look.yaw, 0); }
    else if (this.camera === 'passenger') { cam.rotation.set(this.look.pitch, Math.PI / 2 + this.look.yaw, 0); }
    else if (this.camera === 'outside') {
      const c = this.path.point(P.s - this.train.length * 0.3);
      const hd = this.path.heading(P.s - this.train.length * 0.3);
      const a = hd + this.look.az, d = this.look.dist;
      cam.position.set(c.x + Math.sin(a) * Math.cos(this.look.el) * d, c.y + 2 + Math.sin(this.look.el) * d, c.z + Math.cos(a) * Math.cos(this.look.el) * d);
      const g = this.world.hf.height(cam.position.x, cam.position.z) + 1.2;
      if (cam.position.y < g) cam.position.y = g;
      cam.lookAt(c.x, c.y + 2, c.z);
    } else if (this.camera === 'trackside') {
      if (P.s > this.trackside.s + 90 || this.trackside.s - P.s > 600) this.trackside.s = P.s + 220 + this.rnd() * 120;
      const side = this.rnd() < 0 ? 1 : -1;
      const p = this.path.offsetPoint(this.trackside.s, side * 7.5, 0);
      p.y = Math.max(this.world.hf.height(p.x, p.z), p.y - 1) + 1.7;
      cam.position.copy(p);
      const tgt = this.path.point(Math.max(P.s - 30, Math.min(P.s, this.trackside.s)));
      cam.lookAt(tgt.x, tgt.y + 2, tgt.z);
    } else if (this.camera === 'free') {
      const f = this.free, sp = (f.keys.has('shift') ? 60 : 15) * dt;
      const fw = new THREE.Vector3(Math.sin(f.yaw) * -1, 0, -Math.cos(f.yaw));
      const rt = new THREE.Vector3(-fw.z, 0, fw.x);
      if (f.keys.has('w')) f.pos.addScaledVector(fw, sp); if (f.keys.has('s')) f.pos.addScaledVector(fw, -sp);
      if (f.keys.has('d')) f.pos.addScaledVector(rt, -sp); if (f.keys.has('a')) f.pos.addScaledVector(rt, sp);
      if (f.keys.has('e')) f.pos.y += sp; if (f.keys.has('q')) f.pos.y -= sp;
      cam.position.copy(f.pos); cam.rotation.set(f.pitch, f.yaw, 0);
    }
    const camPos = cam.getWorldPosition(new THREE.Vector3());
    // environment
    this.engine.setTime(this.dateAt(this.clock), 0.35);
    const night = this.engine.night;
    buildingUniforms.uNight.value = night;
    const sm = streetMaterials();
    (sm.lampHead as THREE.MeshStandardMaterial).emissiveIntensity = night * 2.5;
    for (const m of stationLampMats) m.emissiveIntensity = 0.2 + night * 2;
    windUniforms.uTime.value = this.t;
    this.sea.update(this.t, camPos);
    const camS = this.path.project(camPos.x, camPos.z, P.s, 400);
    const inTun = camS.d < 6 && this.path.inTunnel(camS.s);
    this.engine.setTunnel(this.engine.tunnelFactor + ((inTun ? 1 : 0) - this.engine.tunnelFactor) * Math.min(1, dt * 3));
    this.engine.updateShadows(camPos);
    // world streaming, traffic, signals, people
    this.world.update(camPos, this.t);
    this.traffic?.update(this.clock, dt, camPos, this.q.viewDistance, { path: this.path, s: P.s, rearS: P.s - this.train.length });
    for (const sg of this.sig.signals) this.world.playerSignals.get(sg.s)?.setAspect(sg.aspect, 4 + night * 6);
    this.people.update(this.pax.visuals(), this.t);
    // cab instruments
    if (this.camera === 'cab') {
      const ns = this.stops[this.nextStop];
      const nl = this.path.nextSpeedChange(P.s);
      this.cab.update(dt, {
        kmh: P.kmh, limitKmh: this.path.speedLimit(P.s), nextLimitKmh: nl && nl.s - P.s < 1500 ? nl.kmh : null, notch: P.notch, aspect: this.sig.cabAspect, warning: this.sig.warning,
        interlock: this.train.doorOpen.left === 0 && this.train.doorOpen.right === 0, doorsLeft: this.train.doorOpen.left, doorsRight: this.train.doorOpen.right,
        headlights: this.headlights, pantograph: this.pantograph, ebActive: P.forcedBrake > 0 || P.notch === NOTCH_MIN, ataTarget: null,
        screen: {
          clock: fmtTime(this.clock, true), next: ns ? ns.name : 'Terminus', nextArr: ns ? fmtTime(ns.arr) : '--:--', dist: ns ? `${Math.max(0, Math.round(ns.s - P.s))} m` : '',
          delta: ns ? this.lateness() : '',
          msg: this.messages.length && this.messages[this.messages.length - 1].until > this.t ? this.messages[this.messages.length - 1].text : '',
        },
      }, night);
    }
    // audio
    this.audio.update(P.v, P.tractionForce / P.spec.maxForce, P.brakeDecel, this.path.curvature(P.s), this.path.inTunnel(P.s));
  }

  private estimateRunTime(dist: number) { return dist / 15; }
  private lateness(): string {
    const ns = this.stops[this.nextStop];
    if (!ns) return '';
    if (ns.arrived) return `Depart ${fmtTime(ns.dep)}`;
    const cur = this.stops[this.nextStop - 1];
    if (cur && !cur.departed) return `Depart ${fmtTime(cur.dep)}`;
    const eta = this.clock + this.estimateRunTime(Math.max(0, ns.s - this.phys.s));
    return `Running ${fmtDelta(eta - ns.arr)}`;
  }

  hud(): HudState {
    const P = this.phys;
    const ns = this.stops[this.nextStop];
    const nl = this.path.nextSpeedChange(P.s);
    const nsig = this.sig.nextSignal(P.s);
    const nsSig = nsig ? nsig : null;
    const eta = ns ? this.clock + this.estimateRunTime(Math.max(0, ns.s - P.s)) : 0;
    return {
      clock: fmtTime(this.clock, true), service: `${fmtTime(this.stops[0].dep)} ${this.stops[0].name} → ${this.stops[this.stops.length - 1].name}`,
      kmh: P.kmh, limit: this.path.speedLimit(P.s), nextLimit: nl && nl.s - P.s < 2000 ? { kmh: nl.kmh, dist: nl.s - P.s } : null,
      notch: notchLabel(P.notch), notchValue: P.notch, aspect: this.sig.cabAspect, nextSignalDist: nsSig ? nsSig.s - P.s : null, warning: this.sig.warning,
      interlock: this.train.doorOpen.left === 0 && this.train.doorOpen.right === 0 && this.doorTarget.left === 0 && this.doorTarget.right === 0,
      doorsL: this.train.doorOpen.left, doorsR: this.train.doorOpen.right,
      next: ns ? { name: ns.name, arr: fmtTime(ns.arr), dist: ns.s - P.s, delta: this.lateness() || fmtDelta(eta - ns.arr), side: ns.side > 0 ? 'Right' : 'Left' } : null,
      score: this.score.total(), camera: this.camera,
      stops: this.stops.map((s, i) => ({
        name: s.name, arr: i === 0 ? '' : fmtTime(s.arr), dep: i === this.stops.length - 1 ? '' : fmtTime(s.dep),
        actual: s.skipped ? 'missed' : s.arrTime != null ? fmtTime(s.arrTime, true) : s.depTime != null ? fmtTime(s.depTime, true) : '',
        state: s.skipped ? 'missed' : i < this.nextStop || (i === this.nextStop && s.arrived) ? 'done' : i === this.nextStop ? 'next' : 'future',
      })),
      boarding: this.train.doorOpen.left > 0.9 || this.train.doorOpen.right > 0.9 ? (this.pax.boardingDone ? 'Boarding complete' : `Boarding… ${this.pax.pax.filter((p) => p.state === 'toDoor' || p.state === 'waiting').length} waiting, ${this.pax.alightRemaining} to alight`) : null,
      paused: this.paused, tunnel: this.path.inTunnel(P.s),
    };
  }

  // ---------------------------------------------------------------- input
  private unbind: (() => void) | null = null;
  private bindInput() {
    const el = this.engine.renderer.domElement;
    let dragging = false, lx = 0, ly = 0, moved = 0;
    const down = (e: PointerEvent) => { dragging = true; lx = e.clientX; ly = e.clientY; moved = 0; el.setPointerCapture(e.pointerId); };
    const move = (e: PointerEvent) => {
      if (!dragging) return;
      const dx = e.clientX - lx, dy = e.clientY - ly; lx = e.clientX; ly = e.clientY; moved += Math.abs(dx) + Math.abs(dy);
      const k = 0.0035;
      if (this.camera === 'outside') { this.look.az -= dx * k; this.look.el = Math.max(-0.05, Math.min(1.3, this.look.el + dy * k)); }
      else if (this.camera === 'free') { this.free.yaw -= dx * k; this.free.pitch = Math.max(-1.5, Math.min(1.5, this.free.pitch - dy * k)); }
      else { this.look.yaw = Math.max(-2.4, Math.min(2.4, this.look.yaw - dx * k)); this.look.pitch = Math.max(-1.0, Math.min(0.8, this.look.pitch - dy * k)); }
    };
    const up = (e: PointerEvent) => {
      dragging = false;
      if (moved < 6) this.click(e);
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      if (this.camera === 'outside') this.look.dist = Math.max(8, Math.min(250, this.look.dist * (1 + Math.sign(e.deltaY) * 0.1)));
      else { const c = this.cameras[this.camera]; c.fov = Math.max(20, Math.min(80, c.fov + Math.sign(e.deltaY) * 3)); c.updateProjectionMatrix(); }
    };
    const key = (e: KeyboardEvent, isDown: boolean) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      const k = e.key.toLowerCase();
      if (this.camera === 'free' && ['w', 'a', 's', 'd', 'q', 'e', 'shift'].includes(k)) { if (isDown) this.free.keys.add(k); else this.free.keys.delete(k); return; }
      if (k === 'h') { this.horn(isDown); return; }
      if (!isDown || e.repeat) return;
      switch (k) {
        case 'w': case 'arrowup': this.notch(1); break;
        case 's': case 'arrowdown': this.notch(-1); break;
        case 'x': case 'backspace': this.emergency(); break;
        case ' ': e.preventDefault(); this.acknowledge(); break;
        case 'a': this.openDoors('left'); break;
        case 'd': this.openDoors('right'); break;
        case 'c': this.closeDoors(); break;
        case 'l': this.toggleHeadlights(); break;
        case 'p': this.togglePantograph(); break;
        case 'v': this.toggleWiper(); break;
        case '1': this.setCamera('cab'); break;
        case '2': this.setCamera('outside'); break;
        case '3': this.setCamera('trackside'); break;
        case '4': this.setCamera('passenger'); break;
        case '5': this.setCamera('free'); break;
        case 'tab': e.preventDefault(); this.cycleCamera(); break;
      }
    };
    const kd = (e: KeyboardEvent) => key(e, true), ku = (e: KeyboardEvent) => key(e, false);
    const resize = () => this.engine.resize(this.container.clientWidth, this.container.clientHeight);
    el.addEventListener('pointerdown', down); el.addEventListener('pointermove', move); el.addEventListener('pointerup', up);
    el.addEventListener('wheel', wheel, { passive: false });
    window.addEventListener('keydown', kd); window.addEventListener('keyup', ku); window.addEventListener('resize', resize);
    this.unbind = () => {
      el.removeEventListener('pointerdown', down); el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('wheel', wheel);
      window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); window.removeEventListener('resize', resize);
    };
    void isTouch;
  }

  private click(e: PointerEvent) {
    if (this.camera !== 'cab') return;
    const r = this.engine.renderer.domElement.getBoundingClientRect();
    const v = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(v, this.cameras.cab);
    const hit = this.raycaster.intersectObjects(this.cab.clickables, false)[0];
    if (!hit) return;
    const a = hit.object.userData.action as string;
    switch (a) {
      case 'ack': this.acknowledge(); break;
      case 'horn': this.horn(true); setTimeout(() => this.horn(false), 700); break;
      case 'eb': this.emergency(); break;
      case 'panUp': this.togglePantograph(true); break;
      case 'panDown': this.togglePantograph(false); break;
      case 'lights': this.toggleHeadlights(); break;
      case 'wiper': this.toggleWiper(); break;
      case 'openL': this.openDoors('left'); break;
      case 'openR': this.openDoors('right'); break;
      case 'closeL': this.closeDoors('left'); break;
      case 'closeR': this.closeDoors('right'); break;
      case 'lever': {
        // upper half of the knob = push (power), lower = pull (brake)
        const local = hit.object.worldToLocal(hit.point.clone());
        this.notch(local.z < 0 ? 1 : -1);
        break;
      }
    }
    this.audio.click();
  }

  get trainLength() { return 4 * CAR_LEN + 3 * CAR_GAP; }
}
