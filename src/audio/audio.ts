// Procedural train audio with Web Audio: traction inverter + motor whine, rolling noise,
// brake hiss, flange squeal, door chimes, cab warning horn/bell, horn, wind, tunnel boom.
export class TrainAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private motor!: { osc: OscillatorNode; osc2: OscillatorNode; gain: GainNode; filt: BiquadFilterNode };
  private roll!: { gain: GainNode; filt: BiquadFilterNode };
  private hiss!: { gain: GainNode };
  private squeal!: { osc: OscillatorNode; gain: GainNode };
  private wind!: { gain: GainNode; filt: BiquadFilterNode };
  private warnNode: { osc: OscillatorNode; gain: GainNode } | null = null;
  private hornNode: { o1: OscillatorNode; o2: OscillatorNode; gain: GainNode } | null = null;
  private interiorMuffle!: BiquadFilterNode;
  enabled = true;

  start() {
    if (this.ctx) { void this.ctx.resume(); return; }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain(); this.master.gain.value = 0.7;
    this.interiorMuffle = ctx.createBiquadFilter(); this.interiorMuffle.type = 'lowpass'; this.interiorMuffle.frequency.value = 2600;
    this.interiorMuffle.connect(this.master); this.master.connect(ctx.destination);
    const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noise.getChannelData(0); let b = 0;
    for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; b = 0.98 * b + 0.02 * w; d[i] = b * 6 + w * 0.15; }
    const noiseSrc = () => { const s = ctx.createBufferSource(); s.buffer = noise; s.loop = true; s.start(); return s; };
    // motor/inverter
    const osc = ctx.createOscillator(); osc.type = 'sawtooth';
    const osc2 = ctx.createOscillator(); osc2.type = 'square';
    const filt = ctx.createBiquadFilter(); filt.type = 'bandpass'; filt.Q.value = 3;
    const gain = ctx.createGain(); gain.gain.value = 0;
    osc.connect(filt); osc2.connect(filt); filt.connect(gain); gain.connect(this.interiorMuffle); osc.start(); osc2.start();
    this.motor = { osc, osc2, gain, filt };
    // rolling
    const rf = ctx.createBiquadFilter(); rf.type = 'lowpass'; rf.frequency.value = 400;
    const rg = ctx.createGain(); rg.gain.value = 0;
    noiseSrc().connect(rf); rf.connect(rg); rg.connect(this.interiorMuffle);
    this.roll = { gain: rg, filt: rf };
    // brake hiss
    const hf = ctx.createBiquadFilter(); hf.type = 'highpass'; hf.frequency.value = 3000;
    const hg = ctx.createGain(); hg.gain.value = 0;
    noiseSrc().connect(hf); hf.connect(hg); hg.connect(this.interiorMuffle);
    this.hiss = { gain: hg };
    // flange squeal
    const so = ctx.createOscillator(); so.type = 'sine'; so.frequency.value = 3200;
    const sg = ctx.createGain(); sg.gain.value = 0; so.connect(sg); sg.connect(this.interiorMuffle); so.start();
    this.squeal = { osc: so, gain: sg };
    // wind
    const wf = ctx.createBiquadFilter(); wf.type = 'bandpass'; wf.frequency.value = 800; wf.Q.value = 0.5;
    const wg = ctx.createGain(); wg.gain.value = 0;
    noiseSrc().connect(wf); wf.connect(wg); wg.connect(this.master);
    this.wind = { gain: wg, filt: wf };
  }

  setInterior(inside: boolean) { if (this.ctx) this.interiorMuffle.frequency.setTargetAtTime(inside ? 1800 : 9000, this.ctx.currentTime, 0.2); }

  update(speed: number, tractionFrac: number, brakeDecel: number, curvature: number, tunnel: boolean) {
    const ctx = this.ctx; if (!ctx || !this.enabled) return;
    const t = ctx.currentTime;
    const kmh = speed * 3.6;
    // Inverter "singing" rises in steps at low speed, then motor whine proportional to speed.
    const base = kmh < 25 ? 220 + Math.floor(kmh / 5) * 90 + (kmh % 5) * 18 : 120 + kmh * 9;
    this.motor.osc.frequency.setTargetAtTime(base, t, 0.05);
    this.motor.osc2.frequency.setTargetAtTime(base * 1.5, t, 0.05);
    this.motor.filt.frequency.setTargetAtTime(base * 1.2, t, 0.05);
    this.motor.gain.gain.setTargetAtTime(Math.min(0.05, tractionFrac * 0.05 + (brakeDecel > 0.1 && kmh > 5 ? 0.012 : 0)), t, 0.1);
    this.roll.gain.gain.setTargetAtTime(Math.min(0.5, kmh / 140) * (tunnel ? 1.8 : 1), t, 0.2);
    this.roll.filt.frequency.setTargetAtTime(200 + kmh * 6, t, 0.2);
    this.hiss.gain.gain.setTargetAtTime(brakeDecel > 0.05 && kmh < 15 && kmh > 0.5 ? 0.03 : 0, t, 0.2);
    const sq = Math.abs(curvature) > 1 / 350 && kmh > 10 && kmh < 70 ? Math.min(0.025, (Math.abs(curvature) - 1 / 350) * 6) : 0;
    this.squeal.gain.gain.setTargetAtTime(sq, t, 0.3);
    this.squeal.osc.frequency.setTargetAtTime(2800 + Math.sin(t * 3) * 300, t, 0.1);
    this.wind.gain.gain.setTargetAtTime(Math.min(0.12, (kmh / 100) ** 2 * 0.12) * (tunnel ? 2 : 1), t, 0.3);
  }

  private beep(freq: number, dur: number, vol = 0.12, type: OscillatorType = 'sine', when = 0) {
    const ctx = this.ctx; if (!ctx) return;
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq;
    const g = ctx.createGain(); g.gain.value = 0;
    const t0 = ctx.currentTime + when;
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(vol, t0 + 0.01); g.gain.setValueAtTime(vol, t0 + dur - 0.03); g.gain.linearRampToValueAtTime(0, t0 + dur);
    o.connect(g); g.connect(this.master); o.start(t0); o.stop(t0 + dur + 0.05);
  }
  doorChime(closing: boolean) {
    if (closing) for (let i = 0; i < 6; i++) this.beep(1050, 0.12, 0.08, 'square', i * 0.3);
    else { this.beep(880, 0.25, 0.1); this.beep(660, 0.35, 0.1, 'sine', 0.25); }
  }
  doorSlam() { this.beep(90, 0.15, 0.25, 'triangle'); }
  /** Continuous cab warning horn until acknowledged. */
  warning(on: boolean) {
    const ctx = this.ctx; if (!ctx) return;
    if (on && !this.warnNode) {
      const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = 760;
      const g = ctx.createGain(); g.gain.value = 0.06; o.connect(g); g.connect(this.master); o.start();
      this.warnNode = { osc: o, gain: g };
    } else if (!on && this.warnNode) { this.warnNode.osc.stop(); this.warnNode = null; }
  }
  bell() { this.beep(1800, 0.35, 0.08); this.beep(1350, 0.5, 0.06, 'sine', 0.05); }
  horn(on: boolean) {
    const ctx = this.ctx; if (!ctx) return;
    if (on && !this.hornNode) {
      const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(); o1.type = o2.type = 'sawtooth'; o1.frequency.value = 370; o2.frequency.value = 311;
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1500;
      const g = ctx.createGain(); g.gain.value = 0.09; o1.connect(f); o2.connect(f); f.connect(g); g.connect(this.master); o1.start(); o2.start();
      this.hornNode = { o1, o2, gain: g };
    } else if (!on && this.hornNode) { this.hornNode.o1.stop(); this.hornNode.o2.stop(); this.hornNode = null; }
  }
  click() { this.beep(2400, 0.03, 0.05, 'square'); }
  setVolume(v: number) { if (this.ctx) this.master.gain.value = v; }
  stop() { void this.ctx?.close(); this.ctx = null; this.warnNode = null; this.hornNode = null; }
}
