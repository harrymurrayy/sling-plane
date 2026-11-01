import * as THREE from 'three';
import type { PlaneParts } from './upgrades';

// Plane built from its purchased parts. Nose points along +x, up is +y, right wing is +z.

export interface PlaneModel {
  group: THREE.Group;
  propeller: THREE.Object3D | null;
  propDisc: THREE.Mesh | null; // motion-blur disc shown while the engine runs
  flames: THREE.Object3D[];
  exhausts: THREE.Object3D[]; // where engine smoke comes out
  wingtips: THREE.Vector3[]; // local positions for the trails
}

const BODY = 0xe8432a;
const ACCENT = 0xffffff;

const std = (color: number, roughness = 0.5, metalness = 0) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness });

const MATS = {
  body: std(BODY, 0.35, 0.1),
  accent: std(ACCENT, 0.4),
  metal: std(0xb8c0c8, 0.3, 0.9),
  dark: std(0x24282e, 0.6, 0.3),
  glass: new THREE.MeshStandardMaterial({ color: 0x14304a, roughness: 0.05, metalness: 0.7, envMapIntensity: 1.6 }),
};

interface WingLook {
  span: number;
  root: number;
  tip: number;
  sweep: number;
  thick: number;
  mat: THREE.Material;
  winglets?: boolean;
}

const WING_LOOK: (WingLook | null)[] = [
  null,
  { span: 1.9, root: 0.62, tip: 0.44, sweep: 0.04, thick: 0.015, mat: std(0xf6f4ee, 0.95) }, // paper
  { span: 2.5, root: 0.66, tip: 0.4, sweep: 0.08, thick: 0.03, mat: std(0xd9b27a, 0.85) }, // balsa
  { span: 3.0, root: 0.7, tip: 0.36, sweep: 0.1, thick: 0.04, mat: std(0xefe2c2, 0.75) }, // canvas
  { span: 3.5, root: 0.72, tip: 0.32, sweep: 0.14, thick: 0.045, mat: std(0xc8d0d8, 0.25, 0.85) }, // aluminium
  { span: 4.4, root: 0.66, tip: 0.24, sweep: 0.1, thick: 0.04, mat: std(0xffffff, 0.3), winglets: true }, // glider
  { span: 5.4, root: 0.7, tip: 0.2, sweep: 0.2, thick: 0.04, mat: std(0xdcefff, 0.2, 0.3), winglets: true }, // albatross
];

/** Smooth, teardrop fuselage; streamlining stretches the nose to a point. */
function fuselageGeometry(noseLevel: number): THREE.BufferGeometry {
  const nose = 0.22 + noseLevel * 0.09;
  const profile: [number, number][] = [
    [0, -1.36], [0.08, -1.3], [0.15, -1.05], [0.23, -0.6], [0.28, 0], [0.29, 0.6],
    [0.27, 1.05], [0.23, 1.1 + nose * 0.35], [0.16, 1.1 + nose * 0.7], [0.08, 1.1 + nose * 0.92], [0, 1.1 + nose],
  ];
  const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), 32);
  g.rotateZ(-Math.PI / 2); // lathe axis y → x
  g.scale(1, 1.08, 1); // slightly taller than wide
  return g;
}

/** Tapered planform with rounded tips, given a little thickness. Lies in the x/z plane. */
function wingGeometry(span: number, root: number, tip: number, sweep: number, thick: number): THREE.BufferGeometry {
  const s = span / 2;
  const r = tip * 0.3;
  const le = tip * 0.5 - sweep; // tip leading edge
  const te = -tip * 0.5 - sweep; // tip trailing edge
  const shape = new THREE.Shape();
  shape.moveTo(root * 0.5, 0);
  shape.lineTo(le, s - r);
  shape.quadraticCurveTo(le, s, -sweep, s);
  shape.quadraticCurveTo(te, s, te, s - r);
  shape.lineTo(-root * 0.5, 0);
  shape.lineTo(te, -(s - r));
  shape.quadraticCurveTo(te, -s, -sweep, -s);
  shape.quadraticCurveTo(le, -s, le, -(s - r));
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: thick,
    bevelEnabled: true,
    bevelThickness: Math.max(0.008, thick * 0.6),
    bevelSize: Math.min(0.025, tip * 0.08),
    bevelSegments: 3,
    curveSegments: 10,
  });
  g.rotateX(Math.PI / 2); // shape y → world z, extrusion → world -y
  g.translate(0, thick / 2, 0);
  return g;
}

/** Swept vertical fin with a rounded top. Lies in the x/y plane. */
function finGeometry(h: number, root: number, tip: number, thick = 0.03): THREE.BufferGeometry {
  const sw = h * 0.45;
  const back = -root / 2 - sw;
  const shape = new THREE.Shape();
  shape.moveTo(root / 2, 0);
  shape.lineTo(back + tip, h * 0.8);
  shape.quadraticCurveTo(back + tip, h, back + tip * 0.5, h);
  shape.lineTo(back, h);
  shape.lineTo(-root / 2, 0);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: thick, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.015, bevelSegments: 2, curveSegments: 8,
  });
  g.translate(0, 0, -thick / 2);
  return g;
}

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  parent.add(m);
  return m;
}

export function createPlaneMesh(parts: PlaneParts): PlaneModel {
  const group = new THREE.Group();
  group.rotation.order = 'YZX'; // yaw, then pitch, then roll

  // ---------- Fuselage, canopy, stripe ----------
  const noseTip = 1.1 + 0.22 + parts.nose * 0.09;
  mesh(fuselageGeometry(parts.nose), MATS.body, group);
  const canopy = mesh(new THREE.SphereGeometry(1, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), MATS.glass, group, 0.3, 0.17, 0);
  canopy.scale.set(0.55, 0.26, 0.2);
  const band = mesh(new THREE.CylinderGeometry(0.262, 0.262, 0.14, 32, 1, true), MATS.accent, group, -0.45, 0, 0);
  band.rotation.z = Math.PI / 2;

  // ---------- Wings ----------
  const look = WING_LOOK[parts.wings];
  if (look) {
    mesh(wingGeometry(look.span, look.root, look.tip, look.sweep, look.thick), look.mat, group, 0.12, -0.06, 0);
    if (look.winglets) {
      for (const side of [-1, 1]) {
        const w = mesh(finGeometry(0.28, look.tip * 0.9, look.tip * 0.4, 0.02), MATS.body, group, 0.12 - look.sweep + look.tip * 0.1, -0.05, (side * look.span) / 2);
        w.rotation.x = side * 0.2; // cant outward
      }
    }
  }

  // ---------- Tail ----------
  if (parts.tail > 0) {
    const t = parts.tail;
    mesh(wingGeometry(0.9 + t * 0.15, 0.42, 0.24, 0.1, 0.025), MATS.accent, group, -1.08, 0.04, 0);
    mesh(finGeometry(0.42 + t * 0.08, 0.55, 0.22), MATS.body, group, -1.0, 0.12, 0);
  } else {
    mesh(finGeometry(0.26, 0.4, 0.18), MATS.body, group, -1.0, 0.1, 0);
  }

  // ---------- Engine cowling ----------
  const exhausts: THREE.Object3D[] = [];
  if (parts.engine > 0) {
    const cowl = mesh(new THREE.CylinderGeometry(0.27, 0.3, 0.42, 32, 1, true), MATS.metal, group, 1.18, 0, 0);
    cowl.rotation.z = -Math.PI / 2;
    mesh(new THREE.CircleGeometry(0.26, 32), MATS.dark, group, 1.38, 0, 0).rotation.y = Math.PI / 2;
    for (const z of [-0.29, 0.29]) {
      const pipe = mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.5, 12), MATS.dark, group, 0.85, -0.1, z);
      pipe.rotation.z = Math.PI / 2;
      const outlet = new THREE.Object3D();
      outlet.position.set(0.6, -0.1, z);
      group.add(outlet);
      exhausts.push(outlet);
    }
  }

  // ---------- Propeller ----------
  let propeller: THREE.Object3D | null = null;
  let propDisc: THREE.Mesh | null = null;
  if (parts.prop > 0 || parts.engine > 0) {
    propeller = new THREE.Group();
    const blades = parts.engine > 0 ? 3 : 2;
    const len = 0.85 + parts.prop * 0.08 + parts.engine * 0.1;
    const bladeGeo = new THREE.SphereGeometry(1, 16, 10);
    for (let i = 0; i < blades; i++) {
      const arm = new THREE.Group();
      arm.rotation.x = (i / blades) * Math.PI * 2;
      const blade = mesh(bladeGeo, MATS.dark, arm, 0, len / 2, 0);
      blade.scale.set(0.022, len / 2, 0.075);
      blade.rotation.y = 0.35; // blade pitch
      propeller.add(arm);
    }
    const spinner = mesh(new THREE.ConeGeometry(0.13, 0.3, 24), parts.engine > 0 ? MATS.body : MATS.accent, propeller, 0.12, 0, 0);
    spinner.rotation.z = -Math.PI / 2;

    propDisc = new THREE.Mesh(
      new THREE.CircleGeometry(len, 40),
      new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide }),
    );
    propDisc.rotation.y = Math.PI / 2;
    propDisc.visible = false;
    propeller.add(propDisc);
    propeller.position.x = parts.engine > 0 ? 1.42 : noseTip - 0.08;
    group.add(propeller);
  }

  // ---------- Rocket boosters ----------
  const flames: THREE.Object3D[] = [];
  if (parts.rockets > 0) {
    const r = 0.09 + parts.rockets * 0.012;
    const boosterGeo = new THREE.LatheGeometry(
      ([[r * 0.8, -0.5], [r, -0.42], [r, 0.25], [r * 0.7, 0.42], [0, 0.55]] as const).map(([a, b]) => new THREE.Vector2(a, b)),
      20,
    );
    boosterGeo.rotateZ(-Math.PI / 2);
    const finGeo = finGeometry(0.12, 0.2, 0.08, 0.015);
    const outer = new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
    const inner = new THREE.MeshBasicMaterial({ color: 0xfff1b0, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
    for (const z of [-0.78, 0.78]) {
      const pod = new THREE.Group();
      pod.position.set(0.05, -0.2, z);
      group.add(pod);
      mesh(boosterGeo, MATS.accent, pod);
      mesh(new THREE.CylinderGeometry(r * 1.02, r * 1.02, 0.08, 20), MATS.body, pod, 0.15, 0, 0).rotation.z = Math.PI / 2;
      const nozzle = mesh(new THREE.CylinderGeometry(r * 0.7, r * 0.95, 0.14, 20, 1, true), MATS.dark, pod, -0.55, 0, 0);
      nozzle.rotation.z = Math.PI / 2;
      for (let i = 0; i < 3; i++) {
        const holder = new THREE.Group();
        holder.rotation.x = (i / 3) * Math.PI * 2;
        mesh(finGeo, MATS.body, holder, -0.3, r * 0.8, 0);
        pod.add(holder);
      }
      const flame = new THREE.Group();
      flame.position.set(-0.62, 0, 0);
      const o = new THREE.Mesh(new THREE.ConeGeometry(r * 0.9, 1.0, 16, 1, true), outer);
      o.rotation.z = Math.PI / 2;
      o.position.x = -0.5;
      const n = new THREE.Mesh(new THREE.ConeGeometry(r * 0.5, 0.55, 16, 1, true), inner);
      n.rotation.z = Math.PI / 2;
      n.position.x = -0.27;
      flame.add(o, n);
      flame.visible = false;
      pod.add(flame);
      flames.push(flame);
    }
  }

  const tipZ = look ? look.span / 2 : 0.25;
  return {
    group,
    propeller,
    propDisc,
    flames,
    exhausts,
    wingtips: [new THREE.Vector3(0.05, -0.04, -tipZ), new THREE.Vector3(0.05, -0.04, tipZ)],
  };
}
