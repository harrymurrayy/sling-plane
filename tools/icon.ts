// Dev-only: renders the App Store icon (light, dark, tinted) from the in-game plane.
// Open http://localhost:5173/tools/icon.html; window.icons holds the PNG data URLs.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { createPlaneMesh } from '../src/planeModel';
import { background, S, type Variant } from './sky';

const params = new URLSearchParams(location.search);
const num = (k: string, d: number) => (params.has(k) ? Number(params.get(k)) : d);

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
