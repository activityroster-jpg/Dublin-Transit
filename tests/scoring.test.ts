import { describe, expect, it } from 'vitest';
import { Scorer, SUBS } from '../src/sim/scoring';

describe('driver assessment scoring', () => {
  it('starts at 100 and weights sum to 1', () => {
    expect(new Scorer().total()).toBe(100);
    expect(SUBS.reduce((a, s) => a + s.weight, 0)).toBeCloseTo(1);
  });
  it('caps the score after a SPAD', () => {
    const s = new Scorer(); s.spadEvent(0, 'BR 48');
    expect(s.total()).toBeLessThanOrEqual(20);
    expect(s.grade()).toBe('Not yet competent');
  });
  it('rewards accurate stops and punishes overruns', () => {
    const a = new Scorer(); a.stop(0, 'Dalkey', 0.4, false);
    const b = new Scorer(); b.stop(0, 'Dalkey', 6, false);
    const c = new Scorer(); c.stop(0, 'Dalkey', 2, true);
    expect(a.sub('precision')).toBe(100);
    expect(b.sub('precision')).toBeGreaterThan(30); expect(b.sub('precision')).toBeLessThan(60);
    expect(c.sub('precision')).toBe(0);
  });
  it('scores reaction time from acknowledgements', () => {
    const fast = new Scorer(); fast.cawsAck(0, 1.0);
    const slow = new Scorer(); slow.cawsAck(0, 6.0);
    expect(fast.sub('reaction')).toBe(100);
    expect(slow.sub('reaction')).toBeLessThan(30);
  });
  it('timekeeping tolerates up to 30 s late and penalises early departures', () => {
    const s = new Scorer(); s.arrival(0, 'Bray', 20); expect(s.sub('timekeeping')).toBe(100);
    const l = new Scorer(); l.arrival(0, 'Bray', 200); expect(l.sub('timekeeping')).toBeLessThan(50);
    const e = new Scorer(); e.departure(0, 'Bray', -40); expect(e.sub('timekeeping')).toBeLessThan(40);
  });
  it('accumulates overspeed into the safety score', () => {
    const s = new Scorer();
    for (let t = 0; t < 30; t += 0.1) s.speed(t, 0.1, 90, 64);
    expect(s.sub('safety')).toBeLessThan(80);
  });
});
