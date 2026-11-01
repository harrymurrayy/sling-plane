import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CEILING } from './config';

const RING_RADIUS = 4.5;
// Forgiving hit zone: clipping the outside of the ring still counts
const RING_HIT = RING_RADIUS + 3;
const COIN_RADIUS = 2.4; // collection distance
const FUEL_RADIUS = 4; // generous: you have to plan your height to reach a can, not thread it

// Free flight fuel cans: the first comes early, then each gap is longer than the last,
// so even a perfect flight eventually runs dry
const FUEL_FIRST = 700;
const FUEL_GAP = 450;
const FUEL_GAP_GROWTH = 1.2;

export interface PickupEvents {
  coins: number;
  /** 0 = no ring; otherwise the boost quality (bullseye 1.8, clean 1, edge clip 0.5). */
  boost: number;
  bullseye: boolean;
  /** Picked up a fuel can (free flight only). */
  fuel: boolean;
}

const CYAN = 0x48e5ff;

/** A minted coin: raised rim, recessed face and an embossed star on both sides. */
function coinGeometry(): THREE.BufferGeometry {
  const profile = [
    [0, -0.05], [0.5, -0.05], [0.56, -0.1], [0.66, -0.11], [0.72, -0.07],
    [0.72, 0.07], [0.66, 0.11], [0.56, 0.1], [0.5, 0.05], [0, 0.05],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const body = new THREE.LatheGeometry(profile, 48).toNonIndexed();
  body.computeVertexNormals();

  const star = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 0.15 : 0.36;
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    if (i === 0) star.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else star.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const extrude = { depth: 0.02, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 2 };
  const top = new THREE.ExtrudeGeometry(star, extrude).rotateX(-Math.PI / 2).translate(0, 0.035, 0);
  const bottom = new THREE.ExtrudeGeometry(star, extrude).rotateX(Math.PI / 2).translate(0, -0.035, 0);
  const coin = mergeGeometries([body, top, bottom])!;
  body.dispose();
  top.dispose();
  bottom.dispose();
  return coin;
}

/** Soft round glow for sprites. */
function glowTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

// Energy field inside a boost ring: glow hugging the frame plus ripples drawn inward
const fieldVertex = /* glsl */ `
  varying vec2 vPos;
  void main() {
    vPos = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;
const fieldFragment = /* glsl */ `
  uniform float uTime, uR, uOuter, uUsed, uFlash;
  uniform vec3 uColor;
  varying vec2 vPos;
  void main() {
    float d = length(vPos);
    float inside = 1.0 - smoothstep(uR - 0.2, uR, d);
    float edge = d - uR;
    float rim = exp(-edge * edge * 2.5);
    float ripple = inside * pow(0.5 + 0.5 * sin(d * 2.4 + uTime * 6.0), 8.0) * 0.4 * smoothstep(0.0, uR, d);
    float a = (rim * 0.75 + ripple + inside * 0.07) * (1.0 - uUsed * 0.85) + uFlash * inside * 0.7;
    a *= 1.0 - smoothstep(uOuter - 1.0, uOuter, d);
    vec3 col = mix(uColor, vec3(1.0), clamp(uFlash * 0.8 + rim * 0.25, 0.0, 1.0));
    gl_FragColor = vec4(col, a);
  }`;

interface Ring {
  group: THREE.Group;
  field: THREE.ShaderMaterial;
  spinners: THREE.Group[];
  used: boolean;
}

/** Boost rings and coin lines spawned ahead of the plane. */
export class Pickups {
  private rings: Ring[] = [];
  private coins: THREE.Mesh[] = [];
  private cans: THREE.Group[] = [];
  private fuelOn = false;
  private nextCanX = 0;
  private canGap = 0;
  private nextRingX = 0;
  private nextCoinX = 0;
  private time = 0;

  private frameGeo = new THREE.TorusGeometry(RING_RADIUS, 0.38, 24, 128);
  private trimGeo = new THREE.TorusGeometry(RING_RADIUS, 0.09, 10, 128);
  private lipGeo = new THREE.TorusGeometry(RING_RADIUS - 0.4, 0.07, 8, 128);
  private fieldGeo = new THREE.CircleGeometry(RING_RADIUS + 1.6, 96);
  private segGeo = new THREE.BoxGeometry(0.16, 0.9, 0.14);
  private frameMat = new THREE.MeshStandardMaterial({ color: 0x1f3247, metalness: 0.85, roughness: 0.3 });
  private trimMat = new THREE.MeshBasicMaterial({ color: CYAN, toneMapped: false });
  private trimUsedMat = new THREE.MeshBasicMaterial({ color: 0x6f8797, toneMapped: false });
  private segMat = new THREE.MeshBasicMaterial({ color: 0xc9f8ff, toneMapped: false });

  private coinGeo = coinGeometry();
  private coinMat = new THREE.MeshStandardMaterial({ color: 0xffc23a, metalness: 1, roughness: 0.26, emissive: 0x5a3a00 });
  private coinGlow = new THREE.SpriteMaterial({
    map: glowTexture(), color: 0xffd65a, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false,
  });

  private canBodyMat = new THREE.MeshStandardMaterial({ color: 0xff3b30, metalness: 0.3, roughness: 0.4 });
  private canTrimMat = new THREE.MeshStandardMaterial({ color: 0xffd23a, metalness: 0.6, roughness: 0.3 });
  private canBodyGeo = roundedBox(1.6, 2.1, 0.8, 0.22);
  private canHandleGeo = new THREE.TorusGeometry(0.32, 0.1, 8, 20, Math.PI);
  private canCapGeo = new THREE.CylinderGeometry(0.2, 0.24, 0.35, 16);
  private canBandGeo = new THREE.BoxGeometry(1.64, 0.18, 0.84);
  private canGlow = new THREE.SpriteMaterial({
    map: this.coinGlow.map, color: 0xff8a3a, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false,
  });

  constructor(private scene: THREE.Scene) {
    this.reset();
  }

  reset() {
    for (const r of this.rings) this.removeRing(r);
    for (const c of this.coins) this.scene.remove(c);
    for (const c of this.cans) this.scene.remove(c);
    this.rings = [];
    this.coins = [];
    this.cans = [];
    this.nextCanX = FUEL_FIRST;
    this.canGap = FUEL_GAP;
    this.nextRingX = 150;
    this.nextCoinX = 35;
  }

  /** Free flight scatters fuel cans along the route. */
  setFuel(on: boolean) {
    this.fuelOn = on;
  }

  /** Remove anything spawned in [x0, x1] so obstacles get a clear run-up. */
  clearSpan(x0: number, x1: number) {
    this.rings = this.rings.filter((r) => {
      const inside = r.group.position.x > x0 && r.group.position.x < x1;
      if (inside) this.removeRing(r);
      return !inside;
    });
    this.coins = this.coins.filter((c) => {
      const inside = c.position.x > x0 && c.position.x < x1;
      if (inside) this.scene.remove(c);
      return !inside;
    });    // Fuel is too precious to delete: slide the can out past the obstacle instead
    for (const c of this.cans) if (c.position.x > x0 - 10 && c.position.x < x1 + 10) c.position.x = x1 + 25;
  }

  update(x: number, y: number, z: number, prevX: number, dt: number, magnetRadius: number): PickupEvents {
    const events: PickupEvents = { coins: 0, boost: 0, bullseye: false, fuel: false };

    while (this.nextRingX < x + 350) {
      this.spawnRing(this.nextRingX, y);
      this.nextRingX += 220 + Math.random() * 120;
    }
    while (this.nextCoinX < x + 300) {
      this.spawnCoinLine(this.nextCoinX, y);
      this.nextCoinX += 40 + Math.random() * 50;
    }

    while (this.fuelOn && this.nextCanX < x + 400) {
      this.spawnCan(this.nextCanX, y);
      this.nextCanX += this.canGap * (0.85 + Math.random() * 0.3);
      this.canGap *= FUEL_GAP_GROWTH;
    }

    this.time += dt;
    this.cans = this.cans.filter((c) => {
      c.rotation.y += 1.5 * dt;
      const p = c.position;
      // Swept along the flight path so a fast plane can't skip over one between frames
      const crossed = prevX < p.x + FUEL_RADIUS && x > p.x - FUEL_RADIUS;
      if (crossed && Math.hypot(y - p.y, z - p.z) < FUEL_RADIUS) {
        events.fuel = true;
        this.scene.remove(c);
        return false;
      }
      if (p.x < x - 30) {
        this.scene.remove(c);
        return false;
      }
      return true;
    });
    this.rings = this.rings.filter((r) => {
      const p = r.group.position;
      const off = Math.hypot(y - p.y, z - p.z);
      if (!r.used && prevX < p.x && x >= p.x && off < RING_HIT) {
        r.used = true;
        r.field.uniforms.uFlash.value = 1;
        // Threading the centre is worth far more than clipping the frame
        events.bullseye = off < RING_RADIUS * 0.45;
        events.boost = events.bullseye ? 1.8 : off < RING_RADIUS ? 1 : 0.5;
        r.group.traverse((o) => {
          if ((o as THREE.Mesh).material === this.trimMat) (o as THREE.Mesh).material = this.trimUsedMat;
        });
      }
      const u = r.field.uniforms;
      u.uTime.value = this.time;
      u.uFlash.value = Math.max(0, u.uFlash.value - dt * 2.5);
      u.uUsed.value = Math.min(1, u.uUsed.value + (r.used ? dt * 2 : 0));
      // Light segments chase round the frame; they wind down once the ring is spent
      const spin = r.used ? 0.3 : 1.6;
      r.spinners[0].rotation.z += spin * dt;
      r.spinners[1].rotation.z -= spin * dt;
      if (p.x < x - 30) {
        this.removeRing(r);
        return false;
      }
      return true;
    });

    this.coins = this.coins.filter((c) => {
      c.rotation.y += 3 * dt;
      const p = c.position;
      const d = Math.hypot(x - p.x, y - p.y, z - p.z);
      if (d < COIN_RADIUS) {
        events.coins++;
        this.scene.remove(c);
        return false;
      }
      if (d < magnetRadius) {
        // Magnet: fly toward the plane
        const pull = Math.min(1, (45 * dt) / d);
        p.set(p.x + (x - p.x) * pull, p.y + (y - p.y) * pull, p.z + (z - p.z) * pull);
      }
      if (p.x < x - 30) {
        this.scene.remove(c);
        return false;
      }
      return true;
    });

    return events;
  }

  private spawnRing(x: number, nearY: number) {
    // Built facing down the z axis, then turned to face the oncoming plane
    const group = new THREE.Group();
    group.add(new THREE.Mesh(this.frameGeo, this.frameMat));
    for (const z of [-0.36, 0.36]) {
      const trim = new THREE.Mesh(this.trimGeo, this.trimMat);
      trim.position.z = z;
      group.add(trim);
    }
    group.add(new THREE.Mesh(this.lipGeo, this.trimMat));
    const spinners: THREE.Group[] = [];
    for (const z of [-0.5, 0.5]) {
      const spinner = new THREE.Group();
      spinner.position.z = z;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const seg = new THREE.Mesh(this.segGeo, this.segMat);
        seg.position.set(Math.cos(a) * RING_RADIUS, Math.sin(a) * RING_RADIUS, 0);
        seg.rotation.z = a;
        spinner.add(seg);
      }
      group.add(spinner);
      spinners.push(spinner);
    }
    const field = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 }, uR: { value: RING_RADIUS - 0.3 }, uOuter: { value: RING_RADIUS + 1.6 },
        uUsed: { value: 0 }, uFlash: { value: 0 }, uColor: { value: new THREE.Color(CYAN) },
      },
      vertexShader: fieldVertex,
      fragmentShader: fieldFragment,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    group.add(new THREE.Mesh(this.fieldGeo, field));

    // No steering, so everything sits on the flight line
    group.position.set(x, spawnHeight(nearY, 22), 0);
    group.rotation.y = Math.PI / 2;
    this.scene.add(group);
    this.rings.push({ group, field, spinners, used: false });
  }

  private spawnCan(x: number, nearY: number) {
    const can = new THREE.Group();
    can.add(new THREE.Mesh(this.canBodyGeo, this.canBodyMat));
    for (const y of [-0.55, 0.55]) {
      const band = new THREE.Mesh(this.canBandGeo, this.canTrimMat);
      band.position.y = y;
      can.add(band);
    }
    const handle = new THREE.Mesh(this.canHandleGeo, this.canTrimMat);
    handle.position.set(-0.3, 1.05, 0);
    can.add(handle);
    const cap = new THREE.Mesh(this.canCapGeo, this.canTrimMat);
    cap.position.set(0.5, 1.2, 0);
    cap.rotation.z = -0.5;
    can.add(cap);
    const glow = new THREE.Sprite(this.canGlow);
    glow.scale.setScalar(7);
    can.add(glow);
    can.scale.setScalar(1.7);
    // Wider spread than coins: reaching a can means spending or saving height for it
    can.position.set(x, spawnHeight(nearY, 34), 0);
    this.scene.add(can);
    this.cans.push(can);
  }

  private removeRing(r: Ring) {
    this.scene.remove(r.group);
    r.field.dispose();
  }

  private spawnCoinLine(x: number, nearY: number) {
    const baseY = spawnHeight(nearY, 18) - 3;
    const z = 0;
    const count = 6;
    for (let i = 0; i < count; i++) {
      const c = new THREE.Mesh(this.coinGeo, this.coinMat);
      c.rotation.x = Math.PI / 2;
      c.rotation.order = 'YXZ';
      c.position.set(x + i * 3, baseY + Math.sin((i / (count - 1)) * Math.PI) * 3, z);
      c.rotation.y = i * 0.5;
      const glow = new THREE.Sprite(this.coinGlow);
      glow.scale.setScalar(2.6);
      c.add(glow);
      this.scene.add(c);
      this.coins.push(c);
    }
  }
}

/** Pickups spawn around the height the plane is flying at now, so they stay in reach as upgrades take you higher. */
function spawnHeight(planeY: number, spread: number): number {
  const centre = Math.max(planeY, spread / 2 + 4);
  return THREE.MathUtils.clamp(centre + (Math.random() - 0.5) * spread, 4, CEILING - 8);
}

/** Box with rounded vertical edges, for the fuel can body. */
function roundedBox(w: number, h: number, d: number, r: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const x = w / 2 - r, y = d / 2 - r;
  shape.moveTo(-x, -d / 2);
  shape.lineTo(x, -d / 2);
  shape.quadraticCurveTo(w / 2, -d / 2, w / 2, -y);
  shape.lineTo(w / 2, y);
  shape.quadraticCurveTo(w / 2, d / 2, x, d / 2);
  shape.lineTo(-x, d / 2);
  shape.quadraticCurveTo(-w / 2, d / 2, -w / 2, y);
  shape.lineTo(-w / 2, -y);
  shape.quadraticCurveTo(-w / 2, -d / 2, -x, -d / 2);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: 2 });
  return geo.rotateX(-Math.PI / 2).translate(0, -h / 2, 0);
}
