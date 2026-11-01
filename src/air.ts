// Turbulence along the course: calm stretches broken up by bumpy patches. A smooth
// function of distance, so it's the same air whatever the frame rate.

export interface Air {
  phases: number[];
  /** Pitch kick at full strength, rad/s. Grows with each map. */
  strength: number;
}

export function makeAir(strength: number, rand = Math.random): Air {
  return { phases: Array.from({ length: 6 }, () => rand() * 1000), strength };
}

/** How rough the air is at `x`, 0 (calm) to 1 (a bumpy patch). */
export function roughness(air: Air, x: number): number {
  const p = air.phases;
  const e = 0.5 + 0.5 * Math.sin(x * 0.006 + p[0]) * 0.7 + 0.5 * Math.sin(x * 0.0023 + p[1]) * 0.3;
  return Math.min(1, Math.max(0, (e - 0.35) / 0.4));
}

/** Pitch disturbance at `x` in rad/s (+ = nose up). */
export function gustAt(air: Air, x: number): number {
  const p = air.phases;
  // A slow swell that's always there, plus sharper chop inside rough patches
  const swell = Math.sin(x * 0.021 + p[2]) * 0.6 + Math.sin(x * 0.053 + p[3]) * 0.4;
  const chop = Math.sin(x * 0.17 + p[4]) * 0.6 + Math.sin(x * 0.41 + p[5]) * 0.4;
  return air.strength * (swell * 0.35 + chop * roughness(air, x));
}
