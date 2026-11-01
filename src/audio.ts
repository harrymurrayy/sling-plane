// Every sound is synthesised with WebAudio, so there are no audio files to load.
// Browsers only allow audio after a user gesture, so call unlock() from a tap.

export class Sound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private musicBus!: GainNode;
  private wind!: { gain: GainNode; filter: BiquadFilterNode };
  private engine!: { gain: GainNode; body: OscillatorNode; firing: OscillatorNode; blade: OscillatorNode };
  private rocket!: { gain: GainNode };
  private lastStretch = 0;
  private creakAcc = 0;
  muted = false;
  musicOn = true;
  private music: Music | null = null;
  private musicMood: Mood = 'off';

  unlock() {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    // iOS: respect the silent switch and play alongside the player's own music
    const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
    if (session) session.type = 'ambient';
    const ctx = (this.ctx = new Ctx());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    this.master.connect(ctx.destination);
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = this.musicOn ? MUSIC_VOL : 0;
    this.musicBus.connect(ctx.destination);

    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    // Wind: looping noise through a gentle low-pass that opens up with speed. Kept low and soft:
    // a bright band-pass here is what made it sound like a computer fan
    const windSrc = this.loopNoise();
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'lowpass';
    windFilter.Q.value = 0.4;
    const windGain = ctx.createGain();
    windGain.gain.value = 0;
    windSrc.connect(windFilter).connect(windGain).connect(this.master);
    this.wind = { gain: windGain, filter: windFilter };

    // Engine: a small piston engine and propeller rather than a steady drone.
    // A low sawtooth is chopped into putts at the firing rate, and filtered noise is
    // swept by the blades for the whup-whup of the prop.
    const engGain = ctx.createGain();
    engGain.gain.value = 0;
    engGain.connect(this.master);

    const body = ctx.createOscillator();
    body.type = 'sawtooth';
    const bodyFilter = ctx.createBiquadFilter();
    bodyFilter.type = 'lowpass';
    bodyFilter.frequency.value = 320;
    bodyFilter.Q.value = 1.2;
    const putts = ctx.createGain();
    putts.gain.value = 0.35;
    body.connect(bodyFilter).connect(putts).connect(engGain);
    // Square wave rounded off, so each putt has a soft attack
    const firing = ctx.createOscillator();
    firing.type = 'square';
    const firingSoft = ctx.createBiquadFilter();
    firingSoft.type = 'lowpass';
    firingSoft.frequency.value = 80;
    const firingDepth = ctx.createGain();
    firingDepth.gain.value = 0.55;
    firing.connect(firingSoft).connect(firingDepth).connect(putts.gain);

    const propSrc = this.loopNoise();
    const propFilter = ctx.createBiquadFilter();
    propFilter.type = 'bandpass';
    propFilter.frequency.value = 220;
    propFilter.Q.value = 1.4;
    const propAmp = ctx.createGain();
    propAmp.gain.value = 0.5;
    propSrc.connect(propFilter).connect(propAmp).connect(engGain);
    const blade = ctx.createOscillator();
    blade.type = 'sine';
    const bladeDepth = ctx.createGain();
    bladeDepth.gain.value = 0.45;
    blade.connect(bladeDepth).connect(propAmp.gain);

    for (const o of [body, firing, blade]) o.start();
    this.engine = { gain: engGain, body, firing, blade };

    // Rocket: low rumbling noise
    const rocketSrc = this.loopNoise();
    const rocketFilter = ctx.createBiquadFilter();
    rocketFilter.type = 'lowpass';
    rocketFilter.frequency.value = 700;
    const rocketGain = ctx.createGain();
    rocketGain.gain.value = 0;
    rocketSrc.connect(rocketFilter).connect(rocketGain).connect(this.master);
    this.rocket = { gain: rocketGain };
    this.setMood(this.musicMood);
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  setMusic(on: boolean) {
    this.musicOn = on;
    if (this.ctx) this.musicBus.gain.setTargetAtTime(on ? MUSIC_VOL : 0, this.ctx.currentTime, 0.3);
  }

  /** Background music: calm in menus, with drums in the air. */
  setMood(mood: Mood) {
    this.musicMood = mood;
    if (!this.ctx) return;
    this.music ??= new Music(this.ctx, this.musicBus, this.noise);
    this.music.setMood(mood);
  }

  /** Call every frame with the current flight state (active = false silences the loops). */
  update(active: boolean, speed: number, engineOn: boolean, rocketOn: boolean) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const v = active ? Math.min(1, speed / 70) : 0;
    this.wind.gain.gain.setTargetAtTime(v * v * 0.35, t, 0.15);
    this.wind.filter.frequency.setTargetAtTime(220 + v * 900, t, 0.15);
    this.engine.gain.gain.setTargetAtTime(active && engineOn ? 0.16 : 0, t, 0.12);
    // Revs climb a little with airspeed, but stay low and chunky
    const rev = 18 + Math.min(1, speed / 80) * 14; // firing pulses per second
    this.engine.firing.frequency.setTargetAtTime(rev, t, 0.2);
    this.engine.body.frequency.setTargetAtTime(rev * 2.5, t, 0.2);
    this.engine.blade.frequency.setTargetAtTime(rev * 1.5, t, 0.2);
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

const MUSIC_VOL = 0.32;
export type Mood = 'off' | 'menu' | 'flight';

// A bouncy four-chord loop (C, Am, F, G) with two melody variations, scheduled ahead
// on the audio clock so it never drifts. 16 steps per bar.
const BPM = 112;
const STEP = 60 / BPM / 4;
const CHORDS = [[60, 64, 67], [57, 60, 64], [53, 57, 60], [55, 59, 62]];
const BASS = [36, 33, 29, 31];
const _ = 0;
const MELODY = [
  [72, _, 76, _, 79, _, 76, _, 74, _, 72, _, 74, _, 76, _],
  [72, _, _, 69, _, 72, _, 76, _, 74, _, 72, _, _, 69, _],
  [69, _, 72, _, 77, _, 76, _, 74, _, 72, _, 69, _, 72, _],
  [71, _, 74, _, 79, _, 77, _, 76, _, 74, _, 71, _, _, _],
  [79, _, _, _, 76, _, _, _, 74, _, 76, _, 72, _, _, _],
  [76, _, 74, _, 72, _, _, _, 69, _, 72, _, 76, _, _, _],
  [77, _, _, _, 76, _, 74, _, 72, _, 74, _, 77, _, 76, _],
  [74, _, 76, _, 74, _, 71, _, 67, _, _, _, _, _, _, _],
];
const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

class Music {
  private mood: Mood = 'off';
  private step = 0;
  private next = 0;
  private timer = 0;

  constructor(private ctx: AudioContext, private out: GainNode, private noise: AudioBuffer) {}

  setMood(mood: Mood) {
    if (mood === this.mood) return;
    const wasOff = this.mood === 'off';
    this.mood = mood;
    if (mood === 'off') {
      clearInterval(this.timer);
      this.timer = 0;
      return;
    }
    if (wasOff) {
      this.step = 0;
      this.next = this.ctx.currentTime + 0.1;
      this.timer = window.setInterval(() => this.schedule(), 25);
    }
  }

  private schedule() {
    while (this.next < this.ctx.currentTime + 0.15) {
      this.play(this.step, this.next);
      this.step = (this.step + 1) % (16 * 8);
      this.next += STEP;
    }
  }

  private play(step: number, t: number) {
    const bar = Math.floor(step / 16);
    const s = step % 16;
    const chord = bar % 4;
    const flying = this.mood === 'flight';

    if (s === 0 || s === 8 || s === 11) this.note('triangle', hz(BASS[chord] + (s === 11 ? 12 : 0)), t, 0.28, 0.22);
    // Off-beat chord plucks, like a ukulele strum
    if (s % 4 === 2) for (const n of CHORDS[chord]) this.note('triangle', hz(n), t, 0.16, 0.045, 2400);
    const m = MELODY[bar][s];
    if (m) this.note('square', hz(m), t, STEP * 1.8, flying ? 0.035 : 0.028, 1800);

    if (!flying) return;
    if (s % 8 === 0) this.kick(t);
    if (s % 8 === 4) this.hit(t, 1800, 0.09, 0.12);
    if (s % 2 === 0) this.hit(t, 7000, 0.03, 0.03);
  }

  private note(type: OscillatorType, f: number, t: number, dur: number, vol: number, cutoff = 0) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node: AudioNode = o;
    if (cutoff) {
      const f2 = this.ctx.createBiquadFilter();
      f2.type = 'lowpass';
      f2.frequency.value = cutoff;
      node = o.connect(f2);
    }
    node.connect(g).connect(this.out);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private kick(t: number) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.frequency.setValueAtTime(130, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    g.gain.setValueAtTime(0.35, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    o.connect(g).connect(this.out);
    o.start(t);
    o.stop(t + 0.2);
  }

  /** Noise hit: snare (mid band) or hi-hat (high band). */
  private hit(t: number, freq: number, vol: number, dur: number) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = freq > 4000 ? 'highpass' : 'bandpass';
    f.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.out);
    src.start(t, Math.random());
    src.stop(t + dur);
  }
}
