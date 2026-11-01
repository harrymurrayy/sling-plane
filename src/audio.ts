// Every sound is synthesised with WebAudio, so there are no audio files to load.
// Browsers only allow audio after a user gesture, so call unlock() from a tap.

export class Sound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private wind!: { gain: GainNode; filter: BiquadFilterNode };
  private engine!: { gain: GainNode; osc: OscillatorNode[] };
  private rocket!: { gain: GainNode };
  private lastStretch = 0;
  private creakAcc = 0;
  muted = false;

  unlock() {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = (this.ctx = new Ctx());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    this.master.connect(ctx.destination);

    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    // Wind: looping noise through a band-pass that opens up with speed
    const windSrc = this.loopNoise();
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.Q.value = 0.8;
    const windGain = ctx.createGain();
    windGain.gain.value = 0;
    windSrc.connect(windFilter).connect(windGain).connect(this.master);
    this.wind = { gain: windGain, filter: windFilter };

    // Engine: two detuned buzzy oscillators through a low-pass
    const engGain = ctx.createGain();
    engGain.gain.value = 0;
    const engFilter = ctx.createBiquadFilter();
    engFilter.type = 'lowpass';
    engFilter.frequency.value = 900;
    engFilter.connect(engGain).connect(this.master);
    const osc = [ctx.createOscillator(), ctx.createOscillator()];
    osc[0].type = 'sawtooth';
    osc[1].type = 'square';
    osc[1].detune.value = 12;
    for (const o of osc) {
      o.frequency.value = 60;
      o.connect(engFilter);
      o.start();
    }
    this.engine = { gain: engGain, osc };

    // Rocket: low rumbling noise
    const rocketSrc = this.loopNoise();
    const rocketFilter = ctx.createBiquadFilter();
    rocketFilter.type = 'lowpass';
    rocketFilter.frequency.value = 700;
    const rocketGain = ctx.createGain();
    rocketGain.gain.value = 0;
    rocketSrc.connect(rocketFilter).connect(rocketGain).connect(this.master);
    this.rocket = { gain: rocketGain };
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  /** Call every frame with the current flight state (active = false silences the loops). */
  update(active: boolean, speed: number, engineOn: boolean, rocketOn: boolean) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const v = active ? Math.min(1, speed / 70) : 0;
    this.wind.gain.gain.setTargetAtTime(v * v * 0.5, t, 0.1);
    this.wind.filter.frequency.setTargetAtTime(300 + v * 1800, t, 0.1);
    this.engine.gain.gain.setTargetAtTime(active && engineOn ? 0.07 : 0, t, 0.08);
    const pitch = 55 + speed * 1.6;
    this.engine.osc[0].frequency.setTargetAtTime(pitch, t, 0.1);
    this.engine.osc[1].frequency.setTargetAtTime(pitch * 0.5, t, 0.1);
    this.rocket.gain.gain.setTargetAtTime(active && rocketOn ? 0.5 : 0, t, 0.05);
  }

  /** Slingshot tension, 0 (slack) to 1 (full). Creaks as the band tightens, silent as it eases off. */
  stretch(power: number) {
    const rise = power - this.lastStretch;
    this.lastStretch = power;
    if (rise <= 0) return;
    this.creakAcc += rise;
    if (this.creakAcc < 0.09) return;
    this.creakAcc = 0;
    this.creak(power);
  }

  /** One creak: a few rapid stick-slip clicks through a resonant band, like wood and rubber under load. */
  private creak(power: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const freq = 380 + 520 * power + Math.random() * 60;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    filter.Q.value = 9;
    const out = ctx.createGain();
    out.gain.value = 0.35 + 0.35 * power;
    filter.connect(out).connect(this.master);
    const clicks = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < clicks; i++) {
      const t = t0 + i * (0.007 + Math.random() * 0.006);
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(1, t + 0.001);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.006);
      src.connect(g).connect(filter);
      src.start(t, Math.random());
      src.stop(t + 0.008);
    }
  }

  launch() {
    this.tone('triangle', 260, 70, 0.35, 0.5);
    this.burst(0.25, 2000, 0.25);
  }
  coin() {
    this.tone('square', 1320, 1320, 0.06, 0.08);
    this.tone('square', 1760, 1760, 0.12, 0.08, 0.06);
  }
  ring() {
    this.tone('sine', 400, 1400, 0.4, 0.25);
    this.burst(0.4, 3000, 0.15);
  }
  thud(strength: number) {
    this.tone('sine', 140, 40, 0.3, 0.5 * strength + 0.2);
    this.burst(0.2, 600, 0.4 * strength);
  }
  /** Clipping an obstacle: a crunch with a falling tone. */
  smash() {
    this.tone('sawtooth', 220, 50, 0.35, 0.35);
    this.burst(0.35, 900, 0.6);
  }
  /** Threading a gate: a bright two-note chime. */
  gate() {
    this.tone('sine', 880, 880, 0.12, 0.2);
    this.tone('sine', 1320, 1320, 0.25, 0.2, 0.08);
  }
  buy() {
    [660, 880, 1320].forEach((f, i) => this.tone('triangle', f, f, 0.15, 0.2, i * 0.07));
  }
  perfect() {
    [1320, 1760, 2640].forEach((f, i) => this.tone('sine', f, f, 0.18, 0.18, i * 0.06));
  }
  click() {
    this.tone('sine', 900, 700, 0.05, 0.1);
  }

  private loopNoise(): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.start();
    return src;
  }

  private tone(type: OscillatorType, from: number, to: number, dur: number, vol: number, delay = 0) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(from, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private burst(dur: number, cutoff: number, vol: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + dur);
  }
}
