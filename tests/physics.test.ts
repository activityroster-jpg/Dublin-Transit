import { describe, expect, it } from 'vitest';
import { DART_SPEC, NOTCH_MAX, NOTCH_MIN, TrainPhysics } from '../src/train/physics';

function run(p: TrainPhysics, secs: number, grade = 0) { for (let t = 0; t < secs; t += 0.02) p.step(0.02, grade); }

describe('train physics', () => {
  it('accelerates to ~50 km/h in a realistic time on the level', () => {
    const p = new TrainPhysics(); p.notch = NOTCH_MAX;
    run(p, 20);
    expect(p.kmh).toBeGreaterThan(45);
    expect(p.kmh).toBeLessThan(75);
  });
  it('never exceeds the maximum speed', () => {
    const p = new TrainPhysics(); p.notch = NOTCH_MAX;
    run(p, 240);
    expect(p.v).toBeLessThanOrEqual(DART_SPEC.vmax + 0.5);
  });
  it('stops from 80 km/h within ~300 m in full service brake', () => {
    const p = new TrainPhysics(); p.v = 80 / 3.6; p.notch = -7;
    const s0 = p.s; run(p, 60);
    expect(p.v).toBe(0);
    expect(p.s - s0).toBeLessThan(330);
    expect(p.s - s0).toBeGreaterThan(220);
  });
  it('emergency brake stops shorter than full service', () => {
    const a = new TrainPhysics(); a.v = 20; a.notch = -7; run(a, 40);
    const b = new TrainPhysics(); b.v = 20; b.notch = NOTCH_MIN; run(b, 40);
    expect(b.s).toBeLessThan(a.s);
  });
  it('holds on a gradient with the brake applied and rolls back without it', () => {
    const held = new TrainPhysics(); held.notch = -3; run(held, 5, 0.02);
    expect(held.v).toBe(0);
    const p = new TrainPhysics(); p.notch = 0; p.v = 0.1; run(p, 5, -0.02);
    expect(p.v).toBeGreaterThan(0.1);
  });
  it('gives no traction when the interlock is open', () => {
    const p = new TrainPhysics(); p.notch = NOTCH_MAX; p.tractionAvail = false; run(p, 5);
    expect(p.v).toBe(0);
  });
});
