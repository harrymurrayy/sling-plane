// Cartoon sky shared by the app icon and the launch screen.
export const S = 1024;

export type Variant = 'light' | 'dark' | 'tinted';

export function background(ctx: CanvasRenderingContext2D, v: Variant, S = 1024) {
  const sun = { x: S * 0.66, y: S * 0.34 };
  if (v === 'tinted') {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, S, S);
    return sun;
  }
  const sky = ctx.createLinearGradient(0, 0, 0, S);
  if (v === 'light') {
    sky.addColorStop(0, '#2f8cff');
    sky.addColorStop(0.55, '#62c2ff');
    sky.addColorStop(1, '#b8ecff');
  } else {
    sky.addColorStop(0, '#0d1236');
    sky.addColorStop(0.6, '#1d2766');
    sky.addColorStop(1, '#2d3d8f');
  }
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, S, S);

  // Sunburst rays
  ctx.save();
  ctx.translate(sun.x, sun.y);
  ctx.fillStyle = v === 'light' ? 'rgba(255,255,255,0.13)' : 'rgba(140,170,255,0.08)';
  const rays = 14;
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, S * 1.2, a, a + Math.PI / rays);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  const glow = ctx.createRadialGradient(sun.x, sun.y, 0, sun.x, sun.y, S * 0.42);
  glow.addColorStop(0, v === 'light' ? 'rgba(255,248,210,0.95)' : 'rgba(150,180,255,0.35)');
  glow.addColorStop(1, 'rgba(255,248,210,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, S, S);

  // Puffy clouds along the bottom: a shaded back row, then a bright front row
  const rows: [string, number, [number, number, number][]][] = [
    [v === 'light' ? '#cfeaff' : '#28357a', -0.05, [[-0.02, 0.9, 0.1], [0.14, 0.86, 0.09], [0.3, 0.9, 0.08], [0.5, 0.87, 0.1], [0.7, 0.9, 0.08], [0.88, 0.85, 0.1], [1.04, 0.88, 0.09]]],
    [v === 'light' ? '#ffffff' : '#3b4c9e', 0, [[0.04, 0.97, 0.11], [0.22, 0.95, 0.09], [0.4, 0.98, 0.1], [0.6, 0.95, 0.09], [0.78, 0.97, 0.1], [0.96, 0.95, 0.1]]],
  ];
  for (const [col, , puffs] of rows) {
    ctx.fillStyle = col;
    for (const [x, y, r] of puffs) {
      ctx.beginPath();
      ctx.arc(x * S, y * S, r * S, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillRect(0, S * 0.97, S, S * 0.03);
  }
  return sun;
}

