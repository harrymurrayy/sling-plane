import * as THREE from 'three';
import { CEILING } from './config';

// Things in the air you have to fly around or through:
//  - Gates: an energy barrier from the ground to the ceiling with one window in it. Thread it.
//  - Hot-air balloons: big, slowly rising and sinking. Time your way past.
//    Under the sea they're jellyfish instead: same size and drift, pulsing as they swim.
// Clipping any of them costs most of your speed, so each one is a decision you have to make.

export interface ObstacleEvents {
  /** Flew cleanly through a gate's window. */
  gate: boolean;
  /** What you hit this frame, if anything. */
  hit: 'gate' | 'balloon' | null;
  /** Where the hit/pass happened, for effects. */
  at: THREE.Vector3;
}

const GATE_W = 34; // across the flight line
const GATE_H = CEILING + 15;

const clamp = THREE.MathUtils.clamp;

// Barrier: hex-cell energy field with a scanline, transparent in the window
const curtainVertex = /* glsl */ `
  varying vec2 vPos;
  void main() {
    vPos = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;
const curtainFragment = /* glsl */ `
  uniform float uTime, uLo, uHi, uHalfW, uFlash, uDone;
  uniform vec3 uColor;
  varying vec2 vPos;
  float hex(vec2 p) {
    p.x *= 1.1547;
    p.y += mod(floor(p.x), 2.0) * 0.5;
    p = abs(fract(p) - 0.5);
    return abs(max(p.x * 1.5 + p.y, p.y * 2.0) - 1.0);
  }
  void main() {
    float y = vPos.y;
    // Distance outside the window (negative inside)
    float out_ = max(uLo - y, y - uHi);
    if (out_ < 0.0) discard;
    float cell = 1.0 - smoothstep(0.0, 0.08, hex(vPos * 0.45));
    float scan = pow(0.5 + 0.5 * sin(y * 0.35 - uTime * 4.0), 10.0);
    float nearGap = exp(-out_ * 0.18);
    float sides = smoothstep(uHalfW - 3.0, uHalfW, abs(vPos.x));
    // Fade out high up so it doesn't wall off the sky
    float top = 1.0 - smoothstep(uHi + 25.0, uHi + 70.0, y);
    float a = (0.12 + cell * 0.28 + scan * 0.25 + nearGap * 0.35 + sides * 0.3) * mix(0.25, 1.0, top);
    a = a * (1.0 - uDone * 0.75) + uFlash * 0.6;
    vec3 col = mix(uColor, vec3(1.0), clamp(nearGap * 0.35 + uFlash, 0.0, 1.0));
    gl_FragColor = vec4(col, a);
  }`;

interface Gate {
  x: number;
  lo: number;
  hi: number;
  group: THREE.Group;
  curtain: THREE.ShaderMaterial;
  frame: THREE.Mesh[];
  done: boolean;
}

interface Balloon {
  group: THREE.Group;
  envelope: THREE.Mesh;
  /** Burner flame, or the jellyfish's inner glow. */
  flame: THREE.Sprite;
  tentacles?: THREE.Mesh[];
  baseY: number;
  phase: number;
  wobble: number;
  hit: boolean;
}

// Balloon dimensions, relative to the group origin at the envelope's centre
const ENV_R = 6;
const ENV_RY = 7.5;
const BASKET_Y = -12.5;

function glowTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.3, 'rgba(255,255,255,0.4)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/** Yellow/black hazard stripes for the gate pylons' bases. */
function hazardTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffd60a';
  ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = '#1b1b1f';
  for (let i = -64; i < 128; i += 22) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + 11, 0);
    ctx.lineTo(i + 11 - 64, 64);
    ctx.lineTo(i - 64, 64);
    ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1, 3);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Vertical gores in two colours with a band round the equator, like a real envelope. */
function envelopeTexture(a: string, b: string, band: string): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  const gores = 12;
  for (let i = 0; i < gores; i++) {
    ctx.fillStyle = i % 2 ? a : b;
    ctx.fillRect((i / gores) * 512, 0, 512 / gores + 1, 256);
  }
  ctx.fillStyle = band;
  ctx.fillRect(0, 150, 512, 22);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  for (let i = 0; i < gores * 2; i++) {
    ctx.beginPath();
    ctx.arc(((i + 0.5) / (gores * 2)) * 512, 161, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  // Seams
  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  ctx.lineWidth = 2;
  for (let i = 0; i <= gores; i++) {
    ctx.beginPath();
    ctx.moveTo((i / gores) * 512, 0);
    ctx.lineTo((i / gores) * 512, 256);
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const BALLOON_COLOURS: [string, string, string][] = [
  ['#ff453a', '#ffd60a', '#1d3a8a'],
  ['#0a84ff', '#f2f2f7', '#ff9f0a'],
  ['#30d158', '#ffd60a', '#7a1f3d'],
  ['#bf5af2', '#ff9f0a', '#f2f2f7'],
  ['#ff9f0a', '#ff375f', '#1c1c1e'],
];

const JELLY_COLOURS = [0xff7ad9, 0xb98bff, 0x7ad8ff, 0xffa36b];

/** A wavy strand hanging straight down from the origin. */
function strandGeometry(length: number, radius: number, waves: number): THREE.TubeGeometry {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    pts.push(new THREE.Vector3(Math.sin(t * Math.PI * waves) * 0.5 * t, -t * length, Math.cos(t * Math.PI * waves) * 0.3 * t));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, radius, 5, false);
}

export class Obstacles {
  private gates: Gate[] = [];
  private underwater = false;
  private balloons: Balloon[] = [];
  private nextGateX = 0;
  private nextHazardX = 0;
  private level = 0;
  private time = 0;
  private events: ObstacleEvents = { gate: false, hit: null, at: new THREE.Vector3() };

  // Gate parts
  private pylonGeo = new THREE.BoxGeometry(1.8, GATE_H, 1.8).translate(0, GATE_H / 2, 0);
  private baseGeo = new THREE.BoxGeometry(3.2, 6, 3.2).translate(0, 3, 0);
  private stripGeo = new THREE.BoxGeometry(0.25, GATE_H - 8, 0.25).translate(0, (GATE_H - 8) / 2 + 6, 0);
  private beaconGeo = new THREE.SphereGeometry(0.45, 16, 12);
  private barGeo = new THREE.BoxGeometry(0.5, 0.5, 1);
  private chevronGeo = (() => {
    const s = new THREE.Shape();
    s.moveTo(-1.2, 0.9);
    s.lineTo(0, 0);
    s.lineTo(-1.2, -0.9);
    s.lineTo(-0.7, -0.9);
    s.lineTo(0.5, 0);
    s.lineTo(-0.7, 0.9);
    return new THREE.ShapeGeometry(s).rotateY(-Math.PI / 2);
  })();
  private curtainGeo = new THREE.PlaneGeometry(GATE_W, GATE_H, 1, 1).translate(0, GATE_H / 2, 0);
  private pylonMat = new THREE.MeshStandardMaterial({ color: 0x23303f, metalness: 0.8, roughness: 0.35 });
  private baseMat = new THREE.MeshStandardMaterial({ map: hazardTexture(), metalness: 0.2, roughness: 0.6 });
  private stripMat = new THREE.MeshBasicMaterial({ color: 0xff453a, toneMapped: false });
  private beaconMat = new THREE.MeshBasicMaterial({ color: 0xff6b5e, toneMapped: false });
  private frameMat = new THREE.MeshBasicMaterial({ color: 0x5dffa0, toneMapped: false });
  private frameDoneMat = new THREE.MeshBasicMaterial({ color: 0x60707a, toneMapped: false });
  private chevronMat = new THREE.MeshBasicMaterial({ color: 0x5dffa0, toneMapped: false, transparent: true, side: THREE.DoubleSide });

  // Balloon parts
  private envGeo = (() => {
    const pts: THREE.Vector2[] = [];
    // Teardrop: round crown narrowing to the mouth at the bottom
    for (let i = 0; i <= 24; i++) {
      const t = i / 24;
      const a = -Math.PI / 2 + t * Math.PI;
      const y = Math.sin(a) * ENV_RY;
      const bulge = Math.cos(a) * ENV_R * (t < 0.5 ? 0.45 + 0.55 * Math.sin(t * Math.PI) : 1);
      pts.push(new THREE.Vector2(Math.max(t < 0.04 ? 1.1 : 0, bulge), y));
    }
    return new THREE.LatheGeometry(pts, 48);
  })();
  private basketGeo = new THREE.CylinderGeometry(1.1, 0.95, 1.4, 12);
  private rimGeo = new THREE.TorusGeometry(1.1, 0.12, 6, 16).rotateX(Math.PI / 2);
  private ropeGeo = new THREE.CylinderGeometry(0.04, 0.04, 1, 4);
  private basketMat = new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 0.9 });
  private rimMat = new THREE.MeshStandardMaterial({ color: 0x4a2f16, roughness: 0.8 });
  private ropeMat = new THREE.MeshStandardMaterial({ color: 0x3a3330, roughness: 1 });
  private envMats = BALLOON_COLOURS.map(([a, b, band]) =>
    new THREE.MeshStandardMaterial({ map: envelopeTexture(a, b, band), roughness: 0.55, side: THREE.DoubleSide }));
  private flameMat = new THREE.SpriteMaterial({
    map: glowTexture(), color: 0xffa040, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  });

  // Jellyfish parts
  private bellGeo = (() => {
    const pts: THREE.Vector2[] = [];
    // Dome with a slightly flared, scalloped-looking rim
    for (let i = 0; i <= 20; i++) {
      const t = i / 20;
      const a = t * Math.PI * 0.5;
      pts.push(new THREE.Vector2(Math.sin(a) * ENV_R * (1 + 0.08 * t * t), Math.cos(a) * ENV_RY * 0.85 - ENV_RY * 0.25));
    }
    pts.push(new THREE.Vector2(ENV_R * 0.92, -ENV_RY * 0.32));
    return new THREE.LatheGeometry(pts, 40);
  })();
  private innerGeo = new THREE.SphereGeometry(ENV_R * 0.55, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.9, 1);
  private tentacleGeo = strandGeometry(-BASKET_Y + 2, 0.09, 3);
  private armGeo = strandGeometry(-BASKET_Y * 0.65, 0.32, 1.5);
  private jellyMats = JELLY_COLOURS.map((c) => ({
    bell: new THREE.MeshStandardMaterial({
      color: c, emissive: c, emissiveIntensity: 0.35, roughness: 0.2, metalness: 0, transparent: true, opacity: 0.62, side: THREE.DoubleSide, depthWrite: false,
    }),
    inner: new THREE.MeshBasicMaterial({ color: new THREE.Color(c).lerp(new THREE.Color(0xffffff), 0.5), transparent: true, opacity: 0.5, depthWrite: false }),
    strand: new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.5, transparent: true, opacity: 0.75 }),
    glow: c,
  }));

  constructor(private scene: THREE.Scene) {
    this.reset();
  }

  /** Jellyfish instead of hot-air balloons. Applies to the next ones spawned. */
  setUnderwater(on: boolean) {
    this.underwater = on;
  }

  /** More of everything on each map. */
  setLevel(level: number) {
    this.level = level;
  }

  reset() {
    for (const g of this.gates) this.removeGate(g);
    for (const b of this.balloons) this.scene.remove(b.group);
    this.gates = [];
    this.balloons = [];
    this.nextGateX = 260 + Math.random() * 120;
    this.nextHazardX = 140 + Math.random() * 60;
  }

  /** Call once per frame while flying. `onSpawn(x0, x1)` lets other spawners keep that stretch clear. */
  update(x: number, y: number, z: number, prevX: number, dt: number, onSpawn: (x0: number, x1: number) => void): ObstacleEvents {
    this.time += dt;
    const ev = this.events;
    ev.gate = false;
    ev.hit = null;
    const lv = this.level;

    // --- Spawning ---
    while (this.nextGateX < x + 340) {
      this.spawnGate(this.nextGateX, y);
      onSpawn(this.nextGateX - 25, this.nextGateX + 25);
      this.nextGateX += (1100 - 80 * lv) + Math.random() * 300;
    }
    while (this.nextHazardX < x + 300) {
      const hx = this.nextHazardX;
      this.nextHazardX += (450 - 45 * lv) + Math.random() * 200;
      // Keep clear of gates so there's always a fair line through
      if (this.gates.some((g) => Math.abs(g.x - hx) < 70) || Math.abs(this.nextGateX - hx) < 70) continue;
      this.spawnBalloon(hx, y);
      onSpawn(hx - 25, hx + 25);
    }

    // --- Gates ---
    this.gates = this.gates.filter((g) => {
      const u = g.curtain.uniforms;
      u.uTime.value = this.time;
      u.uFlash.value = Math.max(0, u.uFlash.value - dt * 3);
      u.uDone.value = Math.min(1, u.uDone.value + (g.done ? dt * 2 : 0));
      if (!g.done && prevX < g.x && x >= g.x) {
        g.done = true;
        for (const m of g.frame) m.material = this.frameDoneMat;
        ev.at.set(g.x, y, z);
        if (y > g.lo && y < g.hi) ev.gate = true;
        else {
          ev.hit = 'gate';
          u.uFlash.value = 1;
        }
      }
      if (g.x < x - 40) {
        this.removeGate(g);
        return false;
      }
      return true;
    });
    // Chevrons pulse toward the window
    this.chevronMat.opacity = 0.45 + 0.45 * Math.max(0, Math.sin(this.time * 6));
    this.beaconMat.color.setHex(Math.sin(this.time * 5) > 0 ? 0xff6b5e : 0x5a1712);

    // --- Balloons ---
    this.balloons = this.balloons.filter((b) => {
      const t = this.time;
      const p = b.group.position;
      // Slow rise and fall: you have to pick your moment
      p.y = b.baseY + Math.sin(t * 0.7 + b.phase) * 4.5;
      p.x -= 1.5 * dt;
      b.wobble = Math.max(0, b.wobble - dt * 1.2);
      const w = Math.sin(t * 14) * b.wobble * 0.12;
      if (b.tentacles) {
        // Bell squeezes and relaxes; tentacles trail and sway
        const pulse = Math.max(0, Math.sin(t * 2.2 + b.phase)) * 0.12;
        b.envelope.scale.set(1 - pulse + w, 1 + pulse * 0.6 - w, 1 - pulse + w);
        b.flame.material.opacity = 0.35 + pulse * 3;
        b.tentacles.forEach((m, k) => {
          m.rotation.x = Math.sin(t * 1.6 + k + b.phase) * 0.12;
          m.rotation.z = Math.cos(t * 1.3 + k * 1.7 + b.phase) * 0.12;
        });
      } else {
        b.flame.material.opacity = 0.6 + Math.random() * 0.4;
        b.flame.scale.setScalar(1.6 + Math.random() * 0.5);
        b.envelope.scale.set(1 + w, 1 - w, 1 + w);
      }
      if (!b.hit && this.hitsBalloon(p, x, y, z)) {
        b.hit = true;
        b.wobble = 1;
        ev.hit = 'balloon';
        ev.at.set(x, y, z);
      }
      if (p.x < x - 60) {
        this.scene.remove(b.group);
        return false;
      }
      return true;
    });

    return ev;
  }

  private hitsBalloon(p: THREE.Vector3, x: number, y: number, z: number): boolean {
    const dx = x - p.x;
    const dy = y - p.y;
    const dz = z - p.z;
    if ((dx / ENV_R) ** 2 + (dy / ENV_RY) ** 2 + (dz / ENV_R) ** 2 < 1) return true;
    // Ropes and basket hang underneath
    return Math.abs(dx) < 1.6 && Math.abs(dz) < 1.6 && dy < -ENV_RY + 1 && dy > BASKET_Y - 1.2;
  }

  private spawnGate(x: number, planeY: number) {
    // The window shrinks on later maps
    const random = Math.random() * 2 + 1;
    const setHeight = 12 * random
    const h = setHeight - 1.2 * this.level;
    // Roughly where you'll be, a little lower since you glide down over the run-up
    const centre = clamp(planeY - 6 + (Math.random() - 0.5) * 16, h / 2 + 2.5, CEILING - 25);
    const lo = centre - h / 2;
    const hi = centre + h / 2;
    const group = new THREE.Group();
    group.position.set(x, 0, 0);

    const curtain = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 }, uLo: { value: lo }, uHi: { value: hi }, uHalfW: { value: GATE_W / 2 },
        uFlash: { value: 0 }, uDone: { value: 0 }, uColor: { value: new THREE.Color(0xff4a3a) },
      },
      vertexShader: curtainVertex,
      fragmentShader: curtainFragment,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    const field = new THREE.Mesh(this.curtainGeo, curtain);
    field.rotation.y = Math.PI / 2;
    group.add(field);

    for (const side of [-1, 1]) {
      const zz = (side * GATE_W) / 2;
      const pylon = new THREE.Mesh(this.pylonGeo, this.pylonMat);
      pylon.position.z = zz;
      const base = new THREE.Mesh(this.baseGeo, this.baseMat);
      base.position.z = zz;
      const strip = new THREE.Mesh(this.stripGeo, this.stripMat);
      strip.position.set(-0.95, 0, zz);
      const strip2 = new THREE.Mesh(this.stripGeo, this.stripMat);
      strip2.position.set(0.95, 0, zz);
      group.add(pylon, base, strip, strip2);
      for (let by = 20; by < GATE_H; by += 30) {
        const beacon = new THREE.Mesh(this.beaconGeo, this.beaconMat);
        beacon.position.set(0, by, zz - side * 1.1);
        group.add(beacon);
      }
    }

    // Glowing frame round the window, with chevrons pointing in
    const frame: THREE.Mesh[] = [];
    const bar = (yy: number, zz: number, sy: number, sz: number) => {
      const m = new THREE.Mesh(this.barGeo, this.frameMat);
      m.position.set(0, yy, zz);
      m.scale.set(1, sy, sz);
      group.add(m);
      frame.push(m);
    };
    bar(lo, 0, 1, GATE_W);
    bar(hi, 0, 1, GATE_W);
    for (const side of [-1, 1]) bar((lo + hi) / 2, (side * GATE_W) / 2 - side * 0.9, h, 1);
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const c = new THREE.Mesh(this.chevronGeo, this.chevronMat);
        // Above the window they point down, below it they point up
        c.position.set(-0.3, side > 0 ? hi + 3 + i * 2.4 : lo - 3 - i * 2.4, 0);
        c.rotation.x = side > 0 ? Math.PI / 2 : -Math.PI / 2;
        if (side < 0 && c.position.y < 0.5) continue;
        group.add(c);
      }
    }

    this.scene.add(group);
    this.gates.push({ x, lo, hi, group, curtain, frame, done: false });
  }

  private removeGate(g: Gate) {
    this.scene.remove(g.group);
    g.curtain.dispose();
  }

  private spawnJelly(x: number, planeY: number) {
    const group = new THREE.Group();
    const mats = this.jellyMats[Math.floor(Math.random() * this.jellyMats.length)];
    const envelope = new THREE.Mesh(this.bellGeo, mats.bell);
    envelope.add(new THREE.Mesh(this.innerGeo, mats.inner));
    group.add(envelope);
    const tentacles: THREE.Mesh[] = [];
    const rimY = -ENV_RY * 0.3;
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const m = new THREE.Mesh(this.tentacleGeo, mats.strand);
      m.position.set(Math.cos(a) * ENV_R * 0.8, rimY, Math.sin(a) * ENV_R * 0.8);
      m.rotation.y = a;
      group.add(m);
      tentacles.push(m);
    }
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      const m = new THREE.Mesh(this.armGeo, mats.strand);
      m.position.set(Math.cos(a) * 0.8, rimY, Math.sin(a) * 0.8);
      m.rotation.y = a;
      group.add(m);
      tentacles.push(m);
    }
    const glow = new THREE.Sprite(this.flameMat.clone());
    glow.material.color.setHex(mats.glow);
    glow.scale.setScalar(9);
    glow.position.y = 1;
    group.add(glow);

    const baseY = clamp(planeY - 3 + (Math.random() - 0.5) * 10, -BASKET_Y + 6, CEILING - 12);
    group.position.set(x, baseY, (Math.random() - 0.5) * 2);
    group.rotation.y = Math.random() * Math.PI * 2;
    this.scene.add(group);
    this.balloons.push({ group, envelope, flame: glow, tentacles, baseY, phase: Math.random() * 6, wobble: 0, hit: false });
  }

  private spawnBalloon(x: number, planeY: number) {
    if (this.underwater) return this.spawnJelly(x, planeY);
    const group = new THREE.Group();
    const envelope = new THREE.Mesh(this.envGeo, this.envMats[Math.floor(Math.random() * this.envMats.length)]);
    group.add(envelope);
    const basket = new THREE.Mesh(this.basketGeo, this.basketMat);
    basket.position.y = BASKET_Y;
    const rim = new THREE.Mesh(this.rimGeo, this.rimMat);
    rim.position.y = BASKET_Y + 0.7;
    group.add(basket, rim);
    // Ropes from the basket rim up to the envelope's mouth
    const top = -ENV_RY + 0.3;
    const bottom = BASKET_Y + 0.7;
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const from = new THREE.Vector3(Math.cos(a) * 1, bottom, Math.sin(a) * 1);
      const to = new THREE.Vector3(Math.cos(a) * 1.3, top, Math.sin(a) * 1.3);
      const rope = new THREE.Mesh(this.ropeGeo, this.ropeMat);
      rope.position.copy(from).lerp(to, 0.5);
      rope.scale.y = from.distanceTo(to);
      rope.lookAt(to);
      rope.rotateX(Math.PI / 2);
      group.add(rope);
    }
    const flame = new THREE.Sprite(this.flameMat.clone());
    flame.position.y = BASKET_Y + 2.2;
    group.add(flame);

    // Envelope centred around your height, so you choose over or under
    const baseY = clamp(planeY - 3 + (Math.random() - 0.5) * 10, -BASKET_Y + 6, CEILING - 12);
    group.position.set(x, baseY, (Math.random() - 0.5) * 2);
    group.rotation.y = Math.random() * Math.PI * 2;
    this.scene.add(group);
    this.balloons.push({ group, envelope, flame, baseY, phase: Math.random() * 6, wobble: 0, hit: false });
  }
}
