// Racing-game speed lines: thin streaks rushing outward around the screen edges.
// They only appear when you're fast, so the middle of the screen stays clear.

const COUNT = 70;

interface Streak {
  angle: number;
  r: number; // distance from centre as a fraction of the half-diagonal
  speed: number;
  len: number;
  width: number;
}

export class SpeedLines {
  private ctx: CanvasRenderingContext2D;
  private streaks: Streak[] = [];
  private strength = 0;
  private kickT = 0;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    for (let i = 0; i < COUNT; i++) this.streaks.push(this.spawn(Math.random()));
    this.resize();
  }

  resize() {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
  }

  /** A burst of lines, e.g. flying through a boost ring. */
  kick() {
    this.kickT = 1;
  }

  /** `speed` in m/s; `active` false fades them out (landed, menus). */
  update(dt: number, speed: number, active: boolean) {
    const target = active && !this.reduced.matches ? Math.min(1, Math.max(0, (speed - 32) / 40)) : 0;
    this.strength += (target - this.strength) * Math.min(1, dt * 3);
    this.kickT = Math.max(0, this.kickT - dt * 1.6);
    const s = Math.min(1, this.strength + this.kickT * 0.9);

    const { ctx, w, h } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (s < 0.01) return;

    // Lines radiate from just above centre, roughly where the camera is looking
    const cx = w / 2;
    const cy = h * 0.45;
    const reach = Math.hypot(w, h) / 2;
    ctx.lineCap = 'round';
    for (let i = 0; i < this.streaks.length; i++) {
      const st = this.streaks[i];
      st.r += st.speed * (0.5 + s) * dt;
      if (st.r > 1.05) this.streaks[i] = this.spawn(0);
      // Keep the middle clear: lines only show in the outer band
      const fade = Math.min(1, Math.max(0, (st.r - 0.45) / 0.25)) * Math.min(1, (1.05 - st.r) / 0.15);
      const alpha = fade * s * 0.5;
      if (alpha < 0.01) continue;
      const len = st.len * (0.4 + s);
      const x0 = cx + Math.cos(st.angle) * st.r * reach;
      const y0 = cy + Math.sin(st.angle) * st.r * reach;
      const x1 = cx + Math.cos(st.angle) * (st.r + len) * reach;
      const y1 = cy + Math.sin(st.angle) * (st.r + len) * reach;
      const g = ctx.createLinearGradient(x0, y0, x1, y1);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(1, `rgba(255,255,255,${alpha})`);
      ctx.strokeStyle = g;
      ctx.lineWidth = st.width;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }
  }

  private spawn(r: number): Streak {
    return {
      angle: Math.random() * Math.PI * 2,
      r: 0.35 + r * 0.7,
      speed: 0.9 + Math.random() * 1.2,
      len: 0.06 + Math.random() * 0.12,
      width: 1 + Math.random() * 1.5,
    };
  }
}
