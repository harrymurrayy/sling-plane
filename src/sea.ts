import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CEILING } from './config';

// Under-the-sea dressing, only shown on underwater maps: rippling caustics on the seabed,
// light shafts from the surface, the surface itself overhead, rising bubbles and schools of fish.

const SURFACE_Y = CEILING + 45;

const causticsVertex = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;
// Classic iterated-sine water caustics, in world space so they stay put as the ground scrolls
const causticsFragment = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColor, uCam;
  uniform float uStrength;
  varying vec3 vWorld;
  void main() {
    // The iteration wants large coordinates; offset keeps them well away from zero
    vec2 p = vWorld.xz * 0.12 + 250.0;
    vec2 i = p;
    float c = 1.0;
    float inten = 0.005;
    for (int n = 0; n < 4; n++) {
      float t = uTime * 0.6 * (1.0 - (3.5 / float(n + 1)));
      i = p + vec2(cos(t - i.x) + sin(t + i.y), sin(t - i.y) + cos(t + i.x));
      c += 1.0 / length(vec2(p.x / (sin(i.x + t) / inten), p.y / (cos(i.y + t) / inten)));
    }
    c /= 4.0;
    c = 1.17 - pow(c, 1.4);
    float v = clamp(pow(abs(c), 8.0), 0.0, 1.0);
    float fade = 1.0 - smoothstep(90.0, 320.0, distance(vWorld.xz, uCam.xz));
    gl_FragColor = vec4(uColor * v * uStrength * fade, 1.0);
  }`;

/** Vertical gradient for a light shaft: bright at the top, gone by the seabed, soft at the sides. */
function shaftTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  const v = ctx.createLinearGradient(0, 0, 0, 256);
  v.addColorStop(0, 'rgba(255,255,255,0.9)');
  v.addColorStop(0.6, 'rgba(255,255,255,0.25)');
  v.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, 64, 256);
  // Soften the edges
  ctx.globalCompositeOperation = 'destination-in';
  const h = ctx.createLinearGradient(0, 0, 64, 0);
  h.addColorStop(0, 'rgba(0,0,0,0)');
  h.addColorStop(0.5, 'rgba(0,0,0,1)');
  h.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = h;
  ctx.fillRect(0, 0, 64, 256);
  return new THREE.CanvasTexture(c);
}

/** A bubble: a thin bright ring with a highlight. */
function bubbleTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 18, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,255,255,0.08)');
  g.addColorStop(0.75, 'rgba(255,255,255,0.35)');
  g.addColorStop(0.92, 'rgba(255,255,255,0.95)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(32, 32, 30, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.beginPath();
  ctx.ellipse(23, 22, 6, 4, -0.7, 0, Math.PI * 2);
  ctx.fill();
  return new THREE.CanvasTexture(c);
}

/** Wobbly bright ripples seen from below, tiled across the surface. */
function surfaceTexture(): THREE.Texture {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.globalAlpha = 0.18;
  ctx.fillRect(0, 0, size, size);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.lineCap = 'round';
  for (let i = 0; i < 70; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 8 + Math.random() * 26;
    ctx.lineWidth = 1.5 + Math.random() * 2.5;
    // Draw wrapped so the texture tiles seamlessly
    for (const ox of [-size, 0, size])
      for (const oy of [-size, 0, size]) {
        ctx.beginPath();
        ctx.ellipse(x + ox, y + oy, r, r * 0.6, Math.random() * Math.PI, 0.3, Math.PI * (0.8 + Math.random() * 0.8));
        ctx.stroke();
      }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** One fish: a plump body with a forked tail, nose along +x. */
function fishGeometry(): THREE.BufferGeometry {
  const body = new THREE.SphereGeometry(0.5, 10, 8).scale(1.3, 0.75, 0.42);
  const tail = new THREE.ConeGeometry(0.42, 0.7, 4).rotateZ(Math.PI / 2).scale(1, 1, 0.25).translate(-0.85, 0, 0);
  const fin = new THREE.ConeGeometry(0.2, 0.45, 3).scale(1, 1, 0.3).translate(-0.05, 0.42, 0);
  return mergeGeometries([body.toNonIndexed(), tail.toNonIndexed(), fin.toNonIndexed()])!;
}

const FISH_COLOURS = [0xff8a2a, 0xffd23a, 0x3ab8ff, 0xff5a7a, 0x8a7aff, 0xfff1d0];

interface School {
  x: number;
  y: number;
  z: number;
  dir: number;
  speed: number;
  phase: number;
  offsets: THREE.Vector3[];
}

export class Sea {
  readonly group = new THREE.Group();
  private time = 0;
  private caustics: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private surface: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private shafts: THREE.Mesh[] = [];
  private shaftMat: THREE.MeshBasicMaterial;
  private bubbles: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private bubbleSpeed: Float32Array;
  private fish: THREE.InstancedMesh;
  private schools: School[] = [];
  private fishPerSchool = 12;
  private tmp = new THREE.Object3D();
  private anchor = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    // Caustics sit just above the seabed and add light to it
    this.caustics = new THREE.Mesh(
      new THREE.PlaneGeometry(700, 700),
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 }, uColor: { value: new THREE.Color(0xd8fff8) }, uCam: { value: new THREE.Vector3() }, uStrength: { value: 0.32 },
        },
        vertexShader: causticsVertex,
        fragmentShader: causticsFragment,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.caustics.rotation.x = -Math.PI / 2;
    this.caustics.position.y = 0.06;
    this.caustics.renderOrder = 1;
    this.group.add(this.caustics);

    // The surface overhead, rippling
    const surfTex = surfaceTexture();
    surfTex.repeat.set(30, 30);
    this.surface = new THREE.Mesh(
      new THREE.PlaneGeometry(3000, 3000),
      new THREE.MeshBasicMaterial({ map: surfTex, color: 0xc8fbff, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.surface.rotation.x = Math.PI / 2;
    this.surface.position.y = SURFACE_Y;
    this.group.add(this.surface);

    // Light shafts slanting down from the surface
    this.shaftMat = new THREE.MeshBasicMaterial({
      map: shaftTexture(), color: 0xcffaff, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    });
    const shaftGeo = new THREE.PlaneGeometry(1, 1).translate(0, -0.5, 0);
    for (let i = 0; i < 14; i++) {
      const m = new THREE.Mesh(shaftGeo, this.shaftMat);
      m.scale.set(10 + Math.random() * 22, SURFACE_Y + 10, 1);
      m.userData.phase = Math.random() * 6;
      m.userData.offset = new THREE.Vector3((Math.random() - 0.2) * 500, SURFACE_Y, (Math.random() - 0.5) * 360);
      m.rotation.z = -0.28;
      this.shafts.push(m);
      this.group.add(m);
    }

    // Bubbles: one draw call, recycled round the plane
    const n = 260;
    const pos = new Float32Array(n * 3);
    this.bubbleSpeed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.3) * 260;
      pos[i * 3 + 1] = Math.random() * SURFACE_Y;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 160;
      this.bubbleSpeed[i] = 2 + Math.random() * 5;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.bubbles = new THREE.Points(geo, new THREE.PointsMaterial({
      map: bubbleTexture(), size: 1.1, transparent: true, depthWrite: false, color: 0xe8ffff,
    }));
    this.bubbles.frustumCulled = false;
    this.group.add(this.bubbles);

    // Schools of fish drifting across the course
    const schools = 12;
    this.fish = new THREE.InstancedMesh(fishGeometry(), new THREE.MeshLambertMaterial({ flatShading: true }), schools * this.fishPerSchool);
    this.fish.frustumCulled = false;
    const col = new THREE.Color();
    for (let s = 0; s < schools; s++) {
      const tint = FISH_COLOURS[s % FISH_COLOURS.length];
      const offsets = Array.from({ length: this.fishPerSchool }, () =>
        new THREE.Vector3((Math.random() - 0.5) * 9, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 7));
      this.schools.push({ x: 0, y: 0, z: 0, dir: 1, speed: 0, phase: Math.random() * 6, offsets });
      for (let k = 0; k < this.fishPerSchool; k++) this.fish.setColorAt(s * this.fishPerSchool + k, col.setHex(tint));
    }
    this.group.add(this.fish);

    this.group.visible = false;
    scene.add(this.group);
    this.reset(0, 0);
  }

  get active() {
    return this.group.visible;
  }

  setActive(on: boolean) {
    this.group.visible = on;
  }

  private placeSchool(s: School, x: number, z: number) {
    s.x = x;
    s.y = 12 + Math.random() * 110;
    // Off to the sides, never across the flight line where they'd swim through the camera
    s.z = z + (Math.random() < 0.5 ? -1 : 1) * (35 + Math.random() * 130);
    s.dir = Math.random() < 0.6 ? -1 : 1;
    s.speed = 2 + Math.random() * 3;
  }

  reset(x: number, z: number) {
    for (const s of this.schools) this.placeSchool(s, x - 100 + Math.random() * 700, z);
  }

  /** Call every frame with the plane (or camera focus) position. */
  update(dt: number, at: THREE.Vector3, camera: THREE.Camera) {
    if (!this.group.visible) return;
    this.time += dt;
    const t = this.time;
    this.anchor.copy(at);

    this.caustics.position.x = Math.round(at.x / 10) * 10;
    this.caustics.position.z = Math.round(at.z / 10) * 10;
    this.caustics.material.uniforms.uTime.value = t;
    this.caustics.material.uniforms.uCam.value.copy(at);

    this.surface.position.x = Math.round(at.x / 100) * 100;
    this.surface.position.z = Math.round(at.z / 100) * 100;
    const map = this.surface.material.map!;
    map.offset.set(t * 0.012 + this.surface.position.x / 100, t * 0.007 - this.surface.position.z / 100);

    // Shafts hang ahead of the plane, turn to face the camera and slowly breathe
    for (const m of this.shafts) {
      const o = m.userData.offset as THREE.Vector3;
      // Recycle each shaft once it's well behind, so they stream past like scenery
      let wx = m.userData.wx as number | undefined;
      if (wx === undefined || wx < at.x - 150) wx = m.userData.wx = at.x + (wx === undefined ? o.x : 300 + Math.random() * 250);
      m.position.set(wx, o.y, at.z + o.z);
      m.rotation.y = Math.atan2(camera.position.x - m.position.x, camera.position.z - m.position.z);
      m.scale.x = (m.userData.w ??= m.scale.x) * (0.85 + 0.15 * Math.sin(t * 0.5 + m.userData.phase));
    }
    this.shaftMat.opacity = 0.2 + 0.04 * Math.sin(t * 0.7);

    // Bubbles rise with a little wobble and wrap around the plane
    const pos = this.bubbles.geometry.attributes.position as THREE.BufferAttribute;
    const a = pos.array as Float32Array;
    for (let i = 0; i < this.bubbleSpeed.length; i++) {
      const k = i * 3;
      a[k + 1] += this.bubbleSpeed[i] * dt;
      a[k] += Math.sin(t * 2 + i) * 0.3 * dt;
      if (a[k + 1] > SURFACE_Y || a[k] < at.x - 80 || a[k] > at.x + 260 || Math.abs(a[k + 2] - at.z) > 90) {
        a[k] = at.x - 40 + Math.random() * 300;
        a[k + 1] = Math.random() < 0.7 ? Math.random() * 6 : Math.random() * SURFACE_Y;
        a[k + 2] = at.z + (Math.random() - 0.5) * 160;
      }
    }
    pos.needsUpdate = true;

    // Fish: each school swims as a loose, swaying group
    const o = this.tmp;
    this.schools.forEach((s, si) => {
      s.x += s.dir * s.speed * dt;
      if (s.x < at.x - 120 || Math.abs(s.z - at.z) > 330) this.placeSchool(s, at.x + 450 + Math.random() * 250, at.z);
      s.offsets.forEach((off, k) => {
        const wig = Math.sin(t * 6 + k + s.phase);
        o.position.set(s.x + off.x + Math.sin(t * 0.8 + k) * 0.6, s.y + off.y + Math.sin(t * 1.3 + k * 2 + s.phase) * 0.7, s.z + off.z);
        o.rotation.set(0, s.dir > 0 ? 0 : Math.PI, 0);
        o.rotateY(wig * 0.18);
        o.scale.setScalar(1.8 + (k % 3) * 0.35);
        o.updateMatrix();
        this.fish.setMatrixAt(si * this.fishPerSchool + k, o.matrix);
      });
    });
    this.fish.instanceMatrix.needsUpdate = true;
  }
}
