// Dev-only: renders the App Store icon (light, dark, tinted) from the in-game plane.
// Open http://localhost:5173/tools/icon.html; window.icons holds the PNG data URLs.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { createPlaneMesh } from '../src/planeModel';

const S = 1024;
const params = new URLSearchParams(location.search);
const num = (k: string, d: number) => (params.has(k) ? Number(params.get(k)) : d);

type Variant = 'light' | 'dark' | 'tinted';

function background(ctx: CanvasRenderingContext2D, v: Variant) {
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

/** Swooshing speed trail from the bottom-left corner up to the plane. */
function trail(ctx: CanvasRenderingContext2D, v: Variant) {
  const col = v === 'tinted' ? 'rgba(255,255,255,0.55)' : v === 'light' ? 'rgba(255,255,255,0.9)' : 'rgba(170,195,255,0.55)';
  ctx.lineCap = 'round';
  const lines: [number, number, number][] = [
    [0, 0, 34],
    [-70, 60, 18],
    [70, -60, 14],
  ];
  for (const [ox, oy, w] of lines) {
    ctx.strokeStyle = col;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(S * 0.0 + ox, S * 0.86 + oy);
    ctx.quadraticCurveTo(S * 0.18 + ox, S * 0.62 + oy, S * 0.38 + ox * 0.5, S * 0.56 + oy * 0.5);
    ctx.stroke();
  }
}

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(S, S);
renderer.setClearColor(0x000000, 0);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.6;
scene.add(new THREE.HemisphereLight(0xeaf6ff, 0x5a6aa0, 1.4));
const key = new THREE.DirectionalLight(0xfff4e0, 2.6);
key.position.set(4, 6, 6);
scene.add(key);
const rim = new THREE.DirectionalLight(0xbfe4ff, 1.6);
rim.position.set(-5, 3, -4);
scene.add(rim);

const plane = createPlaneMesh({ wings: num('wings', 5), tail: 2, nose: 2, prop: 2, engine: 0, rockets: 0 });
plane.group.rotation.set(num('rx', 0.5), num('ry', 0.6), num('rz', 0.45));
plane.group.position.set(num('px', 0.1), num('py', 0.2), 0);
plane.group.scale.setScalar(num('s', 0.86));
scene.add(plane.group);

const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
camera.position.set(0, 0, num('cz', 8.6));
camera.lookAt(0, 0, 0);

function render(v: Variant): string {
  const out = document.createElement('canvas');
  out.width = out.height = S;
  const ctx = out.getContext('2d')!;
  background(ctx, v);
  trail(ctx, v);
  renderer.render(scene, camera);
  // Soft drop shadow under the plane so it pops off the sky
  ctx.save();
  ctx.shadowColor = v === 'light' ? 'rgba(20,40,110,0.45)' : 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 24;
  ctx.drawImage(renderer.domElement, 0, 0);
  ctx.restore();
  if (v === 'tinted') {
    const img = ctx.getImageData(0, 0, S, S);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      d[i] = d[i + 1] = d[i + 2] = Math.min(255, l * 1.25);
    }
    ctx.putImageData(img, 0, 0);
  }
  document.body.appendChild(out);
  return out.toDataURL('image/png');
}

(window as unknown as { icons: Record<Variant, string> }).icons = {
  light: render('light'),
  dark: render('dark'),
  tinted: render('tinted'),
};
