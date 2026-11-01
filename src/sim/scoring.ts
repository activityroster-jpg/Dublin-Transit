// Driver assessment: a 0-100 score built from five sub-scores that mirror what driver selection
// looks for: safety & rule-following, reaction, concentration, stopping precision, timekeeping.
export type SubKey = 'safety' | 'reaction' | 'concentration' | 'precision' | 'timekeeping';
export const SUBS: { key: SubKey; label: string; weight: number; blurb: string }[] = [
  { key: 'safety', label: 'Safety & rules', weight: 0.3, blurb: 'Signals, speed limits, door safety' },
  { key: 'reaction', label: 'Reaction', weight: 0.2, blurb: 'How fast you acknowledge cab warnings' },
  { key: 'concentration', label: 'Concentration', weight: 0.15, blurb: 'Missed stops, missed warnings, door-side errors' },
  { key: 'precision', label: 'Stop accuracy', weight: 0.2, blurb: 'Distance from the stop mark' },
  { key: 'timekeeping', label: 'Timekeeping', weight: 0.15, blurb: 'Arrivals and departures vs. the timetable' },
];

export interface ScoreEvent { t: number; sub: SubKey; points: number; text: string }

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export class Scorer {
  readonly events: ScoreEvent[] = [];
  private penalties: Record<SubKey, number> = { safety: 0, reaction: 0, concentration: 0, precision: 0, timekeeping: 0 };
  private reactionTimes: number[] = [];
  private stopScores: number[] = [];
  private timeScores: number[] = [];
  spad = false;
  private overspeedAccum = 0; // km/h-seconds over the limit
  private inOverspeed = false;
  onEvent: ((e: ScoreEvent) => void) | null = null;

  private log(t: number, sub: SubKey, points: number, text: string) {
    const e = { t, sub, points, text };
    this.events.push(e);
    this.onEvent?.(e);
  }
  penalty(t: number, sub: SubKey, points: number, text: string) { this.penalties[sub] += points; this.log(t, sub, -points, text); }

  /** Called every frame with speed and the limit in force. */
  speed(t: number, dt: number, kmh: number, limit: number) {
    const over = kmh - (limit + 3);
    if (over > 0) {
      this.overspeedAccum += over * dt;
      if (!this.inOverspeed) { this.inOverspeed = true; this.log(t, 'safety', 0, `Overspeed: ${Math.round(kmh)} km/h in a ${Math.round(limit)} limit`); }
    } else this.inOverspeed = false;
  }
  cawsAck(t: number, reaction: number) {
    this.reactionTimes.push(reaction);
    this.log(t, 'reaction', 0, `Warning acknowledged in ${reaction.toFixed(1)} s`);
  }
  cawsMissed(t: number) { this.reactionTimes.push(7); this.penalty(t, 'concentration', 25, 'Cab warning not acknowledged: brakes applied'); this.penalty(t, 'safety', 10, 'Safety system brake intervention'); }
  spadEvent(t: number, ref: string) { this.spad = true; this.penalty(t, 'safety', 100, `SPAD: passed signal ${ref} at danger`); }
  stop(t: number, station: string, errorM: number, overranPlatform: boolean) {
    const e = Math.abs(errorM);
    let sc = e <= 1 ? 100 : e >= 10 ? 0 : 100 * (1 - (e - 1) / 9);
    if (overranPlatform) sc = 0;
    this.stopScores.push(sc);
    this.log(t, 'precision', 0, `${station}: stopped ${e < 0.5 ? 'on the mark' : `${e.toFixed(1)} m ${errorM > 0 ? 'past' : 'short of'} the mark`}${overranPlatform ? ' (overran platform)' : ''}`);
  }
  arrival(t: number, station: string, deltaS: number) {
    const sc = deltaS < -60 ? 70 : deltaS <= 30 ? 100 : deltaS >= 300 ? 0 : 100 * (1 - (deltaS - 30) / 270);
    this.timeScores.push(sc);
    this.log(t, 'timekeeping', 0, `${station}: arrived ${fmtDelta(deltaS)}`);
  }
  departure(t: number, station: string, deltaS: number) {
    if (deltaS < -10) { this.timeScores.push(Math.max(0, 100 + deltaS * 2)); this.log(t, 'timekeeping', 0, `${station}: departed early (${fmtDelta(deltaS)})`); }
    else this.timeScores.push(deltaS <= 30 ? 100 : Math.max(0, 100 * (1 - (deltaS - 30) / 270)));
  }
  missedStop(t: number, station: string) { this.penalty(t, 'concentration', 30, `Missed booked stop at ${station}`); this.stopScores.push(0); this.timeScores.push(0); }
  wrongSide(t: number) { this.penalty(t, 'safety', 20, 'Doors released on the wrong side'); this.penalty(t, 'concentration', 15, 'Door-side error'); }
  offPlatform(t: number) { this.penalty(t, 'safety', 30, 'Doors released away from a platform'); }
  leftBehind(t: number, n: number) { if (n > 0) this.penalty(t, 'concentration', Math.min(20, n * 4), `Closed doors on ${n} passenger${n > 1 ? 's' : ''}`); }
  emergencyUse(t: number) { this.penalty(t, 'safety', 5, 'Emergency brake used'); }

  sub(k: SubKey): number {
    switch (k) {
      case 'safety': return clamp01(1 - (this.penalties.safety + this.overspeedAccum * 0.6) / 100) * 100;
      case 'reaction': {
        if (!this.reactionTimes.length) return 100;
        const m = this.reactionTimes.reduce((a, b) => a + b, 0) / this.reactionTimes.length;
        return clamp01(1 - (m - 1.5) / 5.5) * 100;
      }
      case 'concentration': return clamp01(1 - this.penalties.concentration / 100) * 100;
      case 'precision': return this.stopScores.length ? this.stopScores.reduce((a, b) => a + b, 0) / this.stopScores.length : 100;
      case 'timekeeping': return this.timeScores.length ? this.timeScores.reduce((a, b) => a + b, 0) / this.timeScores.length : 100;
    }
  }
  total(): number {
    let t = 0;
    for (const s of SUBS) t += this.sub(s.key) * s.weight;
    if (this.spad) t = Math.min(t, 20);
    return Math.round(t);
  }
  grade(): string {
    const t = this.total();
    return t >= 90 ? 'Excellent' : t >= 75 ? 'Competent' : t >= 60 ? 'Needs development' : 'Not yet competent';
  }
}

export function fmtDelta(d: number): string {
  const s = Math.round(Math.abs(d));
  const txt = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  return d < -5 ? `${txt} early` : d > 5 ? `${txt} late` : 'on time';
}
