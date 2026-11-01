// Every number the upgrade tree modifies lives here. BASE_STATS is the plane
// with nothing bought; computeStats() in upgrades.ts layers purchases on top.
export interface PlaneStats {
  // Slingshot
  launchSpeed: number; // m/s at full pull
  meterTime: number; // seconds for the power meter to sweep from empty to full
  perfectZone: number; // top fraction of the meter that counts as a perfect release
  pocketHeight: number; // launch height
  aimDots: number; // length of the trajectory preview

  // Airframe
  gravity: number; // m/s²
  // Drag polar: drag = dragK·v² + liftDragK·n²/v²  (n = load factor)
  // Best glide is where the two terms are equal: v* = (liftDragK/dragK)^¼
  dragK: number; // parasitic drag (body shape) – dominates at high speed
  liftDragK: number; // induced drag (wings) – dominates at low speed and in hard turns
  trimSpeed: number; // speed the plane settles to when you let go (derived from the polar)
  stallSpeed: number; // below this the nose drops and climbing is weak
  pitchRate: number; // rad/s climb/dive rate at full stick
  maxBank: number; // rad, max bank angle at full stick

  // Propulsion
  thrust: number; // m/s² from propeller/engine while fuel lasts (runs automatically)
  fuel: number; // seconds of engine time
  rocketThrust: number; // m/s² while holding boost
  rocketFuel: number; // seconds of rocket time

  // Economy
  coinMultiplier: number;
  distanceCoins: number; // coins per 10m flown
  magnetRadius: number; // coins within this distance get pulled in
  ringBoost: number; // m/s gained flying through a boost ring
}

/** Launch speed multiplier for releasing in the perfect zone. */
export const PERFECT_BONUS = 1.15;

export const BASE_STATS: PlaneStats = {
  launchSpeed: 30,
  meterTime: 0.75,
  perfectZone: 0.06,
  pocketHeight: 3.6,
  aimDots: 10,

  gravity: 9.8,
  dragK: 0.00153,
  liftDragK: 1500,
  trimSpeed: 20,
  stallSpeed: 15,
  pitchRate: 0.6,
  maxBank: 0.3,

  thrust: 0,
  fuel: 0,
  rocketThrust: 0,
  rocketFuel: 0,

  coinMultiplier: 1,
  distanceCoins: 1,
  magnetRadius: 2.4,
  ringBoost: 6,
};

export const MAX_SPEED = 90;
// Altitude ceiling: from THIN_AIR up, engines/rockets fade and climbing gets weaker,
// reaching zero at CEILING. Keeps every flight low enough to see the world.
export const THIN_AIR = 110;
export const CEILING = 160;

export const LAUNCH = {
  pitch: 0.38, // rad (~22°) launch angle
  maxYaw: 0.6, // rad, how far left/right you can aim
  maxPullWorld: 2.5, // how far back the plane visually moves at full pull
  minPower: 0.15, // releases weaker than this are cancelled
};
