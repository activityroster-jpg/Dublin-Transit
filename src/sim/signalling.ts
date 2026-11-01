// Automatic colour-light signalling on the player's path, with a CAWS-style cab warning system:
//  - each main signal protects the block up to the next one;
//  - aspects: R if the block is occupied, Y if the next is, YY if the one after is, else G;
//  - the last signal before the buffers shows Y; a red protects the end of the line;
//  - passing a signal updates the cab display; a downgrade sounds the warning, which must be
//    acknowledged within 7 s or the brakes apply; passing a red is a SPAD.
import type { TrackPath } from '../dart/path';
import type { Aspect } from '../render/signals';

export interface SignalState { s: number; ref: string; aspect: Aspect; repeater: boolean; side: number; src: 'osm' | 'gen' }

const RANK: Record<Aspect, number> = { R: 0, Y: 1, YY: 2, G: 3, OFF: 3 };

export class Signalling {
  readonly signals: SignalState[];
  private mains: SignalState[];
  cabAspect: Aspect = 'G';
  warning = false;
  warnTimer = 0;
  lastPassed = -1;
  spad: SignalState | null = null;
  onWarning: (() => void) | null = null;
  onAck: (() => void) | null = null;
  onClear: (() => void) | null = null;

  constructor(readonly path: TrackPath, startS: number, endS: number) {
    const prefix = path.id.startsWith('greystones') ? 'DN' : 'UP';
    let gen = 0;
    this.signals = path.data.signals
      .filter((q) => q.s > startS - 400 && q.s < endS + 50)
      .map((q) => ({ s: q.s, ref: q.ref ?? `${prefix} ${Math.round(q.s / 100) + 100 + (gen++ % 1)}`, aspect: 'G' as Aspect, repeater: !!q.repeater, side: q.pos === 'right' ? 1 : -1, src: q.src }));
    this.mains = this.signals.filter((q) => !q.repeater);
    this.lastPassed = this.mains.findIndex((q) => q.s > startS) - 1;
  }

  /** occupied: chainage ranges [rear, front] of other trains on this path (projected). */
  update(dt: number, trainS: number, trainRearS: number, occupied: [number, number][], endS: number) {
    const M = this.mains;
    const blockOcc = (i: number) => {
      const a = M[i].s, b = i + 1 < M.length ? M[i + 1].s : endS + 60;
      // the player's own train occupies blocks behind its rear; only others count ahead
      return occupied.some(([r, f]) => f > a && r < b);
    };
    for (let i = 0; i < M.length; i++) {
      let asp: Aspect;
      if (M[i].s > endS - 5) asp = 'R';
      else if (blockOcc(i)) asp = 'R';
      else if (i + 1 >= M.length || M[i + 1].s > endS - 5 || blockOcc(i + 1)) asp = 'Y';
      else if (i + 2 >= M.length || M[i + 2].s > endS - 5 || blockOcc(i + 2)) asp = 'YY';
      else asp = 'G';
      // a signal the player's train is currently standing over/past shows red behind it
      if (M[i].s < trainS && M[i].s > trainRearS - 400) asp = 'R';
      M[i].aspect = asp;
    }
    // repeaters show the aspect of the next main signal (Y if restrictive)
    for (const r of this.signals) if (r.repeater) { const nx = M.find((q) => q.s > r.s); r.aspect = nx && nx.aspect === 'G' ? 'G' : 'Y'; }

    // Passing signals with the leading end
    const next = M[this.lastPassed + 1];
    if (next && trainS >= next.s) {
      // aspect at the moment of passing = the aspect the driver saw (before our own train turned it red)
      const seen = this.aspectAhead(next, occupied, endS);
      this.lastPassed++;
      if (seen === 'R') this.spad = next;
      const prev = this.cabAspect;
      this.cabAspect = seen;
      if (RANK[seen] < 3 && (RANK[seen] < RANK[prev] || seen === 'Y' || seen === 'R')) { this.warning = true; this.warnTimer = 0; this.onWarning?.(); }
      else if (RANK[seen] === 3) this.onClear?.();
    }
    if (this.warning) this.warnTimer += dt;
  }

  private aspectAhead(sig: SignalState, occupied: [number, number][], endS: number): Aspect {
    const M = this.mains; const i = M.indexOf(sig);
    const occ = (k: number) => { if (k >= M.length) return M[M.length - 1].s > endS - 5; const a = M[k].s, b = k + 1 < M.length ? M[k + 1].s : endS + 60; return M[k].s > endS - 5 || occupied.some(([r, f]) => f > a && r < b); };
    if (occ(i)) return 'R';
    if (i + 1 >= M.length || occ(i + 1)) return 'Y';
    if (i + 2 >= M.length || occ(i + 2)) return 'YY';
    return 'G';
  }

  acknowledge(): boolean {
    if (!this.warning) return false;
    this.warning = false; this.warnTimer = 0; this.onAck?.();
    return true;
  }

  /** The next main signal ahead of the train. */
  nextSignal(trainS: number): SignalState | null { return this.mains.find((q) => q.s > trainS) ?? null; }
}
