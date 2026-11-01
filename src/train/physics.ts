// Longitudinal train dynamics for a 4-car EMU: traction (constant-force then constant-power),
// lagged electro-pneumatic brake steps, Davis running resistance, gradients.
export const NOTCH_MIN = -8; // EB
export const NOTCH_MAX = 4;  // P4
export function notchLabel(n: number): string {
  if (n === -8) return 'EB';
  if (n < 0) return `B${-n}`;
  if (n === 0) return 'OFF';
  return `P${n}`;
}

export interface TrainSpec { tareMass: number; maxForce: number; power: number; maxBrakeDecel: number; ebDecel: number; vmax: number; rotFactor: number }
export const DART_SPEC: TrainSpec = { tareMass: 158_000, maxForce: 165_000, power: 1_300_000, maxBrakeDecel: 1.05, ebDecel: 1.35, vmax: 100 / 3.6, rotFactor: 1.08 };

export class TrainPhysics {
  s = 0;              // chainage of the leading end (m)
  v = 0;              // speed (m/s)
  a = 0;              // acceleration (m/s^2)
  notch = -7;         // controller position
  passengers = 0;
  tractionAvail = true;  // false when doors open, pantograph down, ATP intervening...
  forcedBrake = 0;       // 0..1 extra demand from safety systems (1 = emergency)
  private tractionF = 0; // lagged traction force (N)
  private brakeD = 0;    // lagged brake deceleration (m/s^2)
  odometer = 0;
  energyKWh = 0;
  constructor(public spec: TrainSpec = DART_SPEC) {}

  get mass() { return this.spec.tareMass + this.passengers * 75; }
  get tractionForce() { return this.tractionF; }
  get brakeDecel() { return this.brakeD; }
  get kmh() { return this.v * 3.6; }

  step(dt: number, grade: number) {
    const sp = this.spec;
    // demand
    let fDemand = 0, bDemand = 0;
    if (this.notch > 0 && this.tractionAvail && this.forcedBrake === 0) {
      const v = Math.max(this.v, 0.5);
      fDemand = (this.notch / NOTCH_MAX) * Math.min(sp.maxForce, sp.power / v);
      if (this.v > sp.vmax) fDemand = 0;
    } else if (this.notch < 0) {
      bDemand = this.notch === NOTCH_MIN ? sp.ebDecel : (-this.notch / 7) * sp.maxBrakeDecel;
    }
    if (this.forcedBrake > 0) bDemand = Math.max(bDemand, this.forcedBrake >= 1 ? sp.ebDecel : sp.maxBrakeDecel * this.forcedBrake);
    // Holding brake at standstill (prevents creeping on gradients)
    if (this.v < 0.05 && this.notch <= 0) bDemand = Math.max(bDemand, 0.4);
    // lags: traction ramps (jerk limit), brake cylinders fill/vent
    const fRate = sp.maxForce * 0.9; // N/s
    this.tractionF += Math.max(-fRate * 2 * dt, Math.min(fRate * dt, fDemand - this.tractionF));
    const tau = bDemand > this.brakeD ? 0.7 : 1.3;
    this.brakeD += (bDemand - this.brakeD) * Math.min(1, dt / tau);
    // forces
    const m = this.mass, me = m * sp.rotFactor;
    const vkmh = this.v * 3.6;
    const davis = (m / 1000) * (15 + 0.15 * vkmh + 0.004 * vkmh * vkmh); // N (Davis: per-tonne rolling + speed + aero)
    const resist = this.v > 0.01 ? davis : 0;
    const gravity = -m * 9.81 * grade;
    let acc = (this.tractionF - resist + gravity) / me;
    // brakes oppose motion only
    if (this.v > 0.001) acc -= this.brakeD;
    else if (acc < 0 || this.brakeD > 0.05) {
      // at rest: brakes hold the train unless gravity exceeds brake force
      const hold = this.brakeD * me + resist;
      if (Math.abs(gravity + this.tractionF) <= hold) acc = 0;
    }
    this.v = Math.max(0, this.v + acc * dt);
    if (this.v === 0 && acc < 0) acc = 0;
    this.a = acc;
    const ds = this.v * dt;
    this.s += ds;
    this.odometer += ds;
    if (this.tractionF > 0) this.energyKWh += (this.tractionF * this.v * dt) / 3.6e6 / 0.85;
  }
}
