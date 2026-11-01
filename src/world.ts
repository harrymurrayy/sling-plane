import * as THREE from 'three';
import type { Biome, TreeKind } from './biomes';

/** Gradient sky dome that follows the camera. */
export function createSky(): THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      top: { value: new THREE.Color() },
      horizon: { value: new THREE.Color() },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 top;
      uniform vec3 horizon;
      varying vec3 vDir;
      void main() {
        float h = max(vDir.y, 0.0);
        gl_FragColor = vec4(mix(horizon, top, pow(h, 0.55)), 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(2800, 32, 16), mat);
  sky.renderOrder = -2;
  sky.frustumCulled = false;
  return sky;
}

/** Ring of distant hazy mountains that follows the camera: always a horizon to judge height by. */
export function createHorizon(): THREE.Group {
  const group = new THREE.Group();
  const layers = [
    { radius: 2100, count: 46, h: [180, 420] },
    { radius: 1700, count: 40, h: [120, 300] },
  ];
  const mats: THREE.MeshBasicMaterial[] = [];
  group.userData.mats = mats;
  for (const layer of layers) {
    const mat = new THREE.MeshBasicMaterial({ fog: false });
    mats.push(mat);
    for (let i = 0; i < layer.count; i++) {
      const a = (i / layer.count) * Math.PI * 2 + Math.random() * 0.1;
      const h = layer.h[0] + Math.random() * (layer.h[1] - layer.h[0]);
      const m = new THREE.Mesh(new THREE.ConeGeometry(h * (1.2 + Math.random() * 0.8), h, 5 + Math.floor(Math.random() * 3)), mat);
      m.position.set(Math.cos(a) * layer.radius, h / 2 - 20, Math.sin(a) * layer.radius);
      m.rotation.y = Math.random() * Math.PI;
      m.renderOrder = -1;
      group.add(m);
    }
  }
  // Rainbows: hidden unless the biome asks for them
  const rainbows = new THREE.Group();
  const bands = [0xff5a6e, 0xffa04a, 0xffe25a, 0x6fe08a, 0x5ac8ff, 0x9a7aff];
  const bandMats = bands.map((c) => new THREE.MeshBasicMaterial({ color: c, fog: false, transparent: true, opacity: 0.55, depthWrite: false }));
  for (const [a, r] of [[0.15, 420], [2.3, 520], [3.9, 360]] as const) {
    const bow = new THREE.Group();
    bands.forEach((_, k) => {
      const m = new THREE.Mesh(new THREE.TorusGeometry(r - k * 16, 8.5, 6, 64, Math.PI), bandMats[k]);
      m.renderOrder = -1;
      bow.add(m);
    });
    bow.position.set(Math.cos(a) * 1500, -20, Math.sin(a) * 1500);
    bow.lookAt(0, -20, 0);
    rainbows.add(bow);
  }
  rainbows.visible = false;
  group.add(rainbows);
  group.userData.rainbows = rainbows;
  return group;
}

/** Recolour the sky, mountains and lighting for a biome. */
export function paintSky(sky: ReturnType<typeof createSky>, horizon: THREE.Group, biome: Biome) {
  sky.material.uniforms.top.value.set(biome.skyTop);
  sky.material.uniforms.horizon.value.set(biome.horizon);
  (horizon.userData.mats as THREE.MeshBasicMaterial[]).forEach((m, i) => m.color.set(biome.mountains[i]));
  (horizon.userData.rainbows as THREE.Group).visible = !!biome.rainbows;
}

export interface Slingshot {
  group: THREE.Group;
  updateBand(target: THREE.Vector3): void;
}

/** pocketHeight is where the plane sits; the frame is built to match. */
export function createSlingshot(pocketHeight: number): Slingshot {
  const group = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x8a5228, roughness: 0.8 });
  const h = pocketHeight - 0.6;

  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.18 + h * 0.01, 0.24 + h * 0.02, h - 0.6, 16), wood);
  post.position.y = (h - 0.6) / 2;
  group.add(post);
  const prongs: THREE.Vector3[] = [];
  for (const z of [-0.8, 0.8]) {
    const prong = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.15, 1.4, 12), wood);
    prong.position.set(0, h, z * 0.6);
    prong.rotation.x = z > 0 ? 0.5 : -0.5;
    group.add(prong);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), wood);
    cap.position.set(0, h + 0.62, z);
    group.add(cap);
    prongs.push(new THREE.Vector3(0, h + 0.6, z));
  }
  group.traverse((o) => (o.castShadow = true));

  const bandGeo = new THREE.BufferGeometry().setFromPoints([prongs[0], prongs[0], prongs[1]]);
  const band = new THREE.Line(bandGeo, new THREE.LineBasicMaterial({ color: 0x3b2a1a }));
  group.add(band);

  return {
    group,
    updateBand(target) {
      bandGeo.setFromPoints([prongs[0], target, prongs[1]]);
    },
  };
}

/** Ground texture: soft patches plus speckle, so the tiling isn't obvious. */
function groundTexture({ ground: pal }: Biome): THREE.CanvasTexture {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = pal.base;
  ctx.fillRect(0, 0, size, size);
  const blob = (x: number, y: number, r: number, color: string) => {
    // Draw wrapped so the texture tiles seamlessly
    for (const ox of [-size, 0, size])
      for (const oy of [-size, 0, size]) {
        const g = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
        g.addColorStop(0, color);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
      }
  };
  for (let i = 0; i < 40; i++) {
    const tone = pal.patches[Math.random() < 0.5 ? 0 : 1];
    blob(Math.random() * size, Math.random() * size, 40 + Math.random() * 90, tone);
  }
  for (let i = 0; i < 9000; i++) {
    ctx.fillStyle = pal.specks[Math.random() < 0.5 ? 0 : 1];
    ctx.fillRect(Math.random() * size, Math.random() * size, 2, 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Ground that follows the plane with a scrolling texture, so it never ends. */
const GROUND_SIZE = 5000;
const GROUND_TILE = 60;

export function createGround(): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshLambertMaterial> {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE), new THREE.MeshLambertMaterial());
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  ground.userData.tileSize = GROUND_TILE;
  return ground;
}

export function paintGround(ground: ReturnType<typeof createGround>, biome: Biome) {
  const tex = groundTexture(biome);
  tex.repeat.set(GROUND_SIZE / GROUND_TILE, GROUND_SIZE / GROUND_TILE);
  ground.material.map?.dispose();
  ground.material.map = tex;
  ground.material.needsUpdate = true;
}

export function followGround(ground: THREE.Mesh, x: number, z: number): void {
  const tile = ground.userData.tileSize;
  // Snap to whole tiles so the texture lines up without drifting
  const sx = Math.round(x / tile) * tile;
  const sz = Math.round(z / tile) * tile;
  ground.position.set(sx, 0, sz);
  const tex = (ground.material as THREE.MeshLambertMaterial).map!;
  tex.offset.set(sx / tile, -sz / tile);
}

interface Tree {
  obj: THREE.Group;
  radius: number;
  height: number;
  hit?: boolean; // already clipped this run, so it only counts once
  baseRadius: number;
  baseHeight: number;
}

const TREE_COUNT = 160;
const trunkGeo = new THREE.CylinderGeometry(0.22, 0.35, 2, 7);
const pineGeos = [new THREE.ConeGeometry(1.9, 2.6, 8), new THREE.ConeGeometry(1.5, 2.2, 8), new THREE.ConeGeometry(1.0, 1.8, 8)];
const snowCapGeos = [new THREE.ConeGeometry(1.0, 1.0, 8), new THREE.ConeGeometry(0.8, 0.9, 8), new THREE.ConeGeometry(0.55, 0.8, 8)];
const blobGeo = new THREE.IcosahedronGeometry(1.7, 1);
const cactusGeo = new THREE.CapsuleGeometry(0.45, 3.2, 4, 10);
const armGeo = new THREE.CapsuleGeometry(0.3, 1.1, 4, 8);
const rockGeo = new THREE.DodecahedronGeometry(1.4, 0);
const branchGeo = new THREE.CylinderGeometry(0.08, 0.14, 1.8, 6);
// Unicorn Land sweets
const stickGeo = new THREE.CylinderGeometry(0.09, 0.09, 3.2, 8);
const candyGeo = new THREE.CylinderGeometry(1.3, 1.3, 0.35, 28).rotateX(Math.PI / 2);
const swirlGeos = [new THREE.TorusGeometry(0.95, 0.13, 6, 28), new THREE.TorusGeometry(0.5, 0.13, 6, 24)];
const coneGeo = new THREE.ConeGeometry(0.35, 1.6, 10).rotateX(Math.PI);
const puffGeo = new THREE.IcosahedronGeometry(1.1, 2);
const stemGeo = new THREE.CylinderGeometry(0.45, 0.6, 2, 12);
const capGeo = new THREE.SphereGeometry(1.8, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);
const spotGeo = new THREE.SphereGeometry(0.22, 8, 6);

/** Builds one tree (or cactus, rock, ...) and returns its collision size. */
function buildTree(kind: TreeKind, biome: Biome, i: number): { obj: THREE.Group; radius: number; height: number } {
  const lambert = (c: number) => new THREE.MeshLambertMaterial({ color: c, flatShading: true });
  const color = biome.foliage[i % biome.foliage.length];
  const obj = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    obj.add(m);
    return m;
  };
  const trunk = () => add(trunkGeo, lambert(biome.trunk), 0, 1);

  switch (kind) {
    case 'pine':
    case 'snowPine': {
      trunk();
      const mat = lambert(biome.foliage[0]);
      pineGeos.forEach((g, k) => add(g, mat, 0, 2.4 + k * 1.2));
      if (kind === 'snowPine') {
        const snow = lambert(0xf4f8fb);
        snowCapGeos.forEach((g, k) => add(g, snow, 0, 3.0 + k * 1.2));
      }
      return { obj, radius: 1.4, height: 6.2 };
    }
    case 'broadleaf': {
      trunk();
      const mat = lambert(color);
      add(blobGeo, mat, 0, 3.4);
      add(blobGeo, mat, 0.7, 2.9, 0.4).scale.setScalar(0.7);
      return { obj, radius: 1.4, height: 5.1 };
    }
    case 'cactus': {
      const mat = lambert(biome.foliage[i % 2]);
      add(cactusGeo, mat, 0, 2.05);
      for (const side of [-1, 1]) {
        if (Math.random() < 0.3) continue;
        const h = 1.6 + Math.random() * 1.2;
        add(armGeo, mat, 0, h, side * 0.75);
        add(new THREE.CapsuleGeometry(0.3, 0.6 + Math.random() * 0.5, 4, 8), mat, 0, h + 0.7, side * 0.45).rotation.x = side * 0.6;
      }
      return { obj, radius: 0.9, height: 4.1 };
    }
    case 'rock': {
      const m = add(rockGeo, lambert(color), 0, 0.7);
      m.scale.set(1 + Math.random() * 0.6, 0.6 + Math.random() * 0.5, 1 + Math.random() * 0.4);
      return { obj, radius: 1.6, height: 1.6 };
    }
    case 'lollipop': {
      // Smooth shading for the candy so it looks glossy against the faceted trees
      const sweet = (c: number) => new THREE.MeshLambertMaterial({ color: c });
      add(stickGeo, sweet(0xffffff), 0, 1.6);
      add(candyGeo, sweet(color), 0, 3.9);
      const swirl = sweet(0xffffff);
      for (const z of [-0.18, 0.18]) swirlGeos.forEach((g) => add(g, swirl, 0, 3.9, z));
      obj.rotation.y = Math.PI / 2; // face the flight line
      return { obj, radius: 1.3, height: 5.2 };
    }
    case 'cottonCandy': {
      add(coneGeo, lambert(0xffffff), 0, 0.8);
      const fluff = new THREE.MeshLambertMaterial({ color });
      for (const [x, y, z, sc] of [[0, 2.2, 0, 1.3], [0.7, 2.7, 0.3, 1], [-0.6, 2.8, -0.2, 1.05], [0, 3.4, 0, 0.9]]) {
        add(puffGeo, fluff, x, y, z).scale.setScalar(sc);
      }
      return { obj, radius: 1.5, height: 4.4 };
    }
    case 'mushroom': {
      add(stemGeo, lambert(0xfff3e0), 0, 1);
      add(capGeo, new THREE.MeshLambertMaterial({ color }), 0, 1.9);
      const spots = lambert(0xffffff);
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2;
        const tilt = 0.5 + (k % 2) * 0.35;
        add(spotGeo, spots, Math.cos(a) * Math.sin(tilt) * 1.75, 1.9 + Math.cos(tilt) * 1.75, Math.sin(a) * Math.sin(tilt) * 1.75);
      }
      add(spotGeo, spots, 0, 3.7);
      return { obj, radius: 1.8, height: 3.7 };
    }
    case 'deadTree': {
      const mat = lambert(biome.trunk);
      add(trunkGeo, mat, 0, 1).scale.set(0.8, 2, 0.8);
      for (let k = 0; k < 4; k++) {
        const b = add(branchGeo, mat, 0, 2.4 + k * 0.6);
        b.rotation.set(0, (k / 4) * Math.PI * 2, 0.8 + Math.random() * 0.4);
        b.translateY(0.8);
      }
      return { obj, radius: 0.8, height: 4.6 };
    }
  }
}

/** Recycled trees, clouds and distance markers around the plane. */
export class Scenery {
  private trees: Tree[] = [];
  private clouds: THREE.Group[] = [];
  private cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.92 });
  private markers = new Map<number, THREE.Group>();
  private goals = new THREE.Group();
  private lineGeo = new THREE.PlaneGeometry(0.8, 400);
  private lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 });

  constructor(private scene: THREE.Scene) {
    const puff = new THREE.IcosahedronGeometry(1, 2);
    for (let i = 0; i < 34; i++) {
      const c = new THREE.Group();
      const n = 5 + Math.floor(Math.random() * 4);
      for (let j = 0; j < n; j++) {
        const m = new THREE.Mesh(puff, this.cloudMat);
        const s = 3 + Math.random() * 3.5;
        m.position.set((j - n / 2) * 3.2 + Math.random() * 2, Math.random() * 2 - (Math.abs(j - n / 2) * 0.4), Math.random() * 4 - 2);
        m.scale.set(s * 1.3, s * 0.8, s);
        c.add(m);
      }
      scene.add(c);
      this.clouds.push(c);
    }
    scene.add(this.goals);
  }

  /** Swap every tree for the biome's flora and recolour the clouds. */
  setBiome(biome: Biome) {
    for (const t of this.trees) {
      this.scene.remove(t.obj);
      t.obj.traverse((o) => {
        if (o instanceof THREE.Mesh) (o.material as THREE.Material).dispose();
      });
    }
    this.trees = [];
    for (let i = 0; i < TREE_COUNT; i++) {
      const { obj, radius, height } = buildTree(biome.trees[i % biome.trees.length], biome, i);
      obj.traverse((o) => (o.castShadow = true));
      this.scene.add(obj);
      this.trees.push({ obj, radius, height, baseRadius: radius, baseHeight: height });
    }
    this.cloudMat.color.set(biome.cloud);
    this.reset();
  }

  /** Big lines across the course: your best on this map (gold) and the finish line. */
  setGoals(best: number, finish: number, accent: number) {
    for (const g of [...this.goals.children]) {
      this.goals.remove(g);
      g.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.Sprite) {
          const mat = o.material as THREE.MeshBasicMaterial;
          mat.map?.dispose();
          mat.dispose();
          if (o instanceof THREE.Mesh) o.geometry.dispose();
        }
      });
    }
    // Free flight has no finish, only your best to chase
    if (Number.isFinite(finish)) this.goals.add(goalLine(finish, accent, `FINISH  ${finish.toLocaleString()}m`, true));
    if (best > 0 && best < finish) this.goals.add(goalLine(best, 0xffd60a, `BEST  ${best.toLocaleString()}m`, false));
  }

  private placeTree(t: Tree, x: number, nearZ: number) {
    let z = nearZ + (Math.random() - 0.5) * 300;
    // Keep the launch runway clear
    if (x < 90 && Math.abs(z) < 12) z += Math.sign(z || 1) * 16;
    const s = 0.7 + Math.random() * 0.9;
    t.obj.position.set(x, 0, z);
    t.obj.scale.setScalar(s);
    t.obj.rotation.y = Math.random() * Math.PI * 2;
    t.radius = t.baseRadius * s;
    t.height = t.baseHeight * s;
    t.hit = false;
  }

  private placeCloud(c: THREE.Group, x: number, nearZ: number) {
    c.position.set(x, 55 + Math.random() * 60, nearZ + (Math.random() - 0.5) * 600);
    c.scale.setScalar(0.8 + Math.random() * 0.8);
  }

  update(x: number, z: number) {
    for (const t of this.trees) {
      const p = t.obj.position;
      if (p.x < x - 50 || Math.abs(p.z - z) > 170) this.placeTree(t, x + 380 + Math.random() * 80, z);
    }
    for (const c of this.clouds) {
      if (c.position.x < x - 120 || Math.abs(c.position.z - z) > 330) this.placeCloud(c, x + 550 + Math.random() * 150, z);
    }

    for (const [d, m] of this.markers) {
      if (d < x - 60) {
        this.scene.remove(m);
        this.markers.delete(d);
      }
    }
    const from = Math.max(100, Math.ceil((x - 50) / 100) * 100);
    for (let d = from; d <= x + 450; d += 100) {
      if (!this.markers.has(d)) this.addMarker(d, z);
    }
  }

  private addMarker(d: number, z: number) {
    const g = new THREE.Group();
    const line = new THREE.Mesh(this.lineGeo, this.lineMat);
    line.rotation.x = -Math.PI / 2;
    line.position.y = 0.02;
    g.add(line);
    for (const side of [-12, 12]) {
      const s = makeSign(`${d}m`);
      s.position.set(0, 3, side);
      g.add(s);
    }
    g.position.set(d, 0, z);
    this.scene.add(g);
    this.markers.set(d, g);
  }

  /** Simple cylinder collision against nearby trees. */
  hitTree(x: number, y: number, z: number): boolean {
    for (const t of this.trees) {
      const p = t.obj.position;
      if (!t.hit && y < t.height && Math.abs(p.x - x) < 3 && Math.hypot(p.x - x, p.z - z) < t.radius) {
        t.hit = true;
        return true;
      }
    }
    return false;
  }

  reset() {
    for (const t of this.trees) this.placeTree(t, -40 + Math.random() * 500, 0);
    for (const c of this.clouds) this.placeCloud(c, -100 + Math.random() * 750, 0);
    for (const m of this.markers.values()) this.scene.remove(m);
    this.markers.clear();
  }
}

function makeSign(text: string, colors = { bg: '#fff4d6', border: '#8a5228', fg: '#3b2a1a' }, width = 256): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = colors.bg;
  ctx.beginPath();
  ctx.roundRect(4, 4, width - 8, 120, 18);
  ctx.fill();
  ctx.strokeStyle = colors.border;
  ctx.lineWidth = 8;
  ctx.stroke();
  ctx.fillStyle = colors.fg;
  ctx.font = '600 60px -apple-system, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, width / 2, 68);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex }));
  s.scale.set((width / 128) * 2, 2, 1);
  return s;
}

function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Checkered banner (or plain accent for the best line) with the label in a centre plate. */
function bannerTexture(label: string, hex: string, checkered: boolean): THREE.CanvasTexture {
  return canvasTexture(1024, 128, (ctx) => {
    const sq = 32;
    for (let x = 0; x < 1024; x += sq) {
      for (let y = 0; y < 128; y += sq) {
        ctx.fillStyle = checkered ? ((x + y) / sq) % 2 ? '#111' : '#fff' : ((x + y) / sq) % 2 ? hex : '#ffffff';
        ctx.fillRect(x, y, sq, sq);
      }
    }
    ctx.fillStyle = hex;
    ctx.beginPath();
    ctx.roundRect(232, 10, 560, 108, 22);
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.fillStyle = '#0d0d0d';
    ctx.font = '700 68px -apple-system, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 512, 68);
  });
}

const GATE_W = 40;
const GATE_H = 28;

/** A gate over the flight line: metal posts on plinths, neon strips, a banner, pennants,
 *  a light curtain and a stripe across the ground. */
function goalLine(x: number, color: number, label: string, checkered: boolean): THREE.Group {
  const g = new THREE.Group();
  const hex = `#${new THREE.Color(color).getHexString()}`;
  const metal = new THREE.MeshStandardMaterial({ color: 0xeef2f6, metalness: 0.6, roughness: 0.35 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2b3440, metalness: 0.7, roughness: 0.4 });
  const neon = new THREE.MeshBasicMaterial({ color, toneMapped: false });

  // Ground stripe
  const stripeTex = canvasTexture(64, 64, (ctx) => {
    ctx.fillStyle = checkered ? '#ffffff' : hex;
    ctx.fillRect(0, 0, 64, 64);
    if (!checkered) return;
    ctx.fillStyle = '#151515';
    ctx.fillRect(0, 0, 32, 32);
    ctx.fillRect(32, 32, 32, 32);
  });
  stripeTex.wrapS = stripeTex.wrapT = THREE.RepeatWrapping;
  stripeTex.magFilter = THREE.NearestFilter;
  stripeTex.repeat.set(2, 300);
  const stripe = new THREE.Mesh(new THREE.PlaneGeometry(4, 600), new THREE.MeshBasicMaterial({ map: stripeTex, transparent: true, opacity: 0.92 }));
  stripe.rotation.x = -Math.PI / 2;
  stripe.position.y = 0.04;
  g.add(stripe);

  // Light curtain: strongest at the ground, fading upward
  const curtainTex = canvasTexture(4, 128, (ctx) => {
    const grad = ctx.createLinearGradient(0, 0, 0, 128);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.6, 'rgba(255,255,255,0.25)');
    grad.addColorStop(1, 'rgba(255,255,255,0.7)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 4, 128);
  });
  const curtain = new THREE.Mesh(
    new THREE.PlaneGeometry(GATE_W, GATE_H),
    new THREE.MeshBasicMaterial({ color, map: curtainTex, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  curtain.rotation.y = Math.PI / 2;
  curtain.position.y = GATE_H / 2;
  g.add(curtain);

  for (const z of [-GATE_W / 2, GATE_W / 2]) {
    const plinth = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.6, 1.4, 40), dark);
    plinth.position.set(0, 0.7, z);
    g.add(plinth);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.75, GATE_H, 40), metal);
    post.position.set(0, GATE_H / 2 + 1.2, z);
    g.add(post);
    // Neon bands up the post
    for (let i = 1; i <= 5; i++) {
      const y = 1.2 + (GATE_H * i) / 6;
      const r = 0.75 - (0.25 * (y - 1.2)) / GATE_H + 0.04;
      const band = new THREE.Mesh(new THREE.TorusGeometry(r, 0.07, 10, 48), neon);
      band.rotation.x = Math.PI / 2;
      band.position.set(0, y, z);
      g.add(band);
    }
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.85, 32, 20), neon);
    cap.position.set(0, GATE_H + 2.6, z);
    g.add(cap);
    // Pennant on a short mast
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 4, 12), metal);
    mast.position.set(0, GATE_H + 5, z);
    g.add(mast);
    const flagShape = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(3, -0.8), new THREE.Vector2(0, -1.6)]);
    const flag = new THREE.Mesh(new THREE.ShapeGeometry(flagShape), new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide, roughness: 0.6 }));
    flag.position.set(0, GATE_H + 6.9, z);
    flag.rotation.y = Math.PI / 2 + (z < 0 ? 0.3 : -0.3);
    g.add(flag);
  }

  // Banner across the top: a dark frame with the printed face toward the oncoming plane
  const beam = new THREE.Mesh(new THREE.BoxGeometry(0.8, 4.6, GATE_W + 1.4), dark);
  beam.position.y = GATE_H + 1.2;
  g.add(beam);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(GATE_W, 4), new THREE.MeshBasicMaterial({ map: bannerTexture(label, hex, checkered) }));
  face.rotation.y = -Math.PI / 2;
  face.position.set(-0.42, GATE_H + 1.2, 0);
  g.add(face);
  for (const y of [GATE_H - 1.1, GATE_H + 3.5]) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.18, GATE_W + 1.4), neon);
    strip.position.set(-0.45, y, 0);
    g.add(strip);
  }

  g.position.x = x;
  return g;
}

/** Vapour trail off a wingtip: a ribbon of recent positions, turned to face the camera,
 *  tapering and fading toward the tail. `update` sets how strong it is (speed). */
export class Trail {
  private points: Float32Array;
  private verts: Float32Array;
  private geo = new THREE.BufferGeometry();
  private mat: THREE.MeshBasicMaterial;
  private count = 0;
  private a = new THREE.Vector3();
  private b = new THREE.Vector3();
  private side = new THREE.Vector3();

  constructor(scene: THREE.Scene, private max = 90) {
    this.points = new Float32Array(max * 3);
    this.verts = new Float32Array(max * 6);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.verts, 3));
    const colors = new Float32Array(max * 6);
    for (let i = 0; i < max; i++) {
      const f = (1 - i / max) ** 1.5;
      colors.fill(f, i * 6, i * 6 + 6);
    }
    this.geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const index: number[] = [];
    for (let i = 0; i < max - 1; i++) {
      const k = i * 2;
      index.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
    this.geo.setIndex(index);
    this.mat = new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(this.geo, this.mat);
    mesh.frustumCulled = false;
    scene.add(mesh);
  }

  push(p: THREE.Vector3) {
    this.points.copyWithin(3, 0, (this.max - 1) * 3);
    this.points[0] = p.x;
    this.points[1] = p.y;
    this.points[2] = p.z;
    this.count = Math.min(this.max, this.count + 1);
  }

  /** Rebuild the ribbon facing `cam`; `strength` 0..1 sets its width and brightness. */
  update(cam: THREE.Vector3, strength: number) {
    this.mat.opacity = 0.12 + strength * 0.55;
    const n = this.count;
    this.geo.setDrawRange(0, Math.max(0, n - 1) * 6);
    if (n < 2) return;
    const P = this.points;
    const width = 0.06 + strength * 0.22;
    for (let i = 0; i < n; i++) {
      const i0 = Math.max(0, i - 1) * 3;
      const i1 = Math.min(n - 1, i + 1) * 3;
      this.a.set(P[i0] - P[i1], P[i0 + 1] - P[i1 + 1], P[i0 + 2] - P[i1 + 2]);
      this.b.set(cam.x - P[i * 3], cam.y - P[i * 3 + 1], cam.z - P[i * 3 + 2]);
      this.side.crossVectors(this.a, this.b).normalize().multiplyScalar(width * (1 - i / this.max));
      const v = i * 6;
      this.verts[v] = P[i * 3] + this.side.x;
      this.verts[v + 1] = P[i * 3 + 1] + this.side.y;
      this.verts[v + 2] = P[i * 3 + 2] + this.side.z;
      this.verts[v + 3] = P[i * 3] - this.side.x;
      this.verts[v + 4] = P[i * 3 + 1] - this.side.y;
      this.verts[v + 5] = P[i * 3 + 2] - this.side.z;
    }
    this.geo.attributes.position.needsUpdate = true;
  }

  clear() {
    this.count = 0;
    this.geo.setDrawRange(0, 0);
  }
}
