import * as THREE from 'three';

let softTexture: THREE.Texture | null = null;
function getSoftTexture(): THREE.Texture {
  if (softTexture) return softTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  softTexture = new THREE.CanvasTexture(c);
  return softTexture;
}

interface Particle {
  sprite: THREE.Sprite;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  size: number;
  grow: number;
  opacity: number;
  gravity: number;
}

/** Pooled soft sprites: smoke, dust and sparks. */
export class Particles {
  private pool: Particle[] = [];
  private next = 0;

  constructor(scene: THREE.Scene, count: number, additive: boolean) {
    for (let i = 0; i < count; i++) {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: getSoftTexture(),
          transparent: true,
          depthWrite: false,
          blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        }),
      );
      sprite.visible = false;
      scene.add(sprite);
      this.pool.push({ sprite, vel: new THREE.Vector3(), life: 0, maxLife: 1, size: 1, grow: 1, opacity: 1, gravity: 0 });
    }
  }

  emit(
    pos: THREE.Vector3,
    vel: THREE.Vector3,
    opts: { color: number; size: number; life: number; grow?: number; opacity?: number; gravity?: number },
  ) {
    const p = this.pool[this.next];
    this.next = (this.next + 1) % this.pool.length;
    p.sprite.position.copy(pos);
    p.sprite.material.color.setHex(opts.color);
    p.sprite.visible = true;
    p.vel.copy(vel);
    p.life = p.maxLife = opts.life;
    p.size = opts.size;
    p.grow = opts.grow ?? 1;
    p.opacity = opts.opacity ?? 0.8;
    p.gravity = opts.gravity ?? 0;
  }

  /** A burst of particles flying outward. */
  burst(pos: THREE.Vector3, n: number, speed: number, opts: Parameters<Particles['emit']>[2]) {
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      v.randomDirection().multiplyScalar(speed * (0.4 + Math.random() * 0.6));
      this.emit(pos, v, opts);
    }
  }

  update(dt: number) {
    const drag = Math.exp(-2 * dt);
    for (const p of this.pool) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.sprite.visible = false;
        continue;
      }
      const t = 1 - p.life / p.maxLife;
      p.vel.multiplyScalar(drag);
      p.vel.y -= p.gravity * dt;
      p.sprite.position.addScaledVector(p.vel, dt);
      p.sprite.scale.setScalar(p.size * (1 + (p.grow - 1) * t));
      p.sprite.material.opacity = p.opacity * (1 - t);
    }
  }

  clear() {
    for (const p of this.pool) {
      p.life = 0;
      p.sprite.visible = false;
    }
  }
}
