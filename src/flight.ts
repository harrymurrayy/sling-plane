import { CEILING, MAX_SPEED, THIN_AIR, type PlaneStats } from './config';

// Arcade energy-based flight model. The plane always flies where its nose points;
// the interesting part is the speed budget: diving gains speed, climbing and
// turning spend it, and drag is lowest around the best glide speed.
//
// World axes: +x is "distance", +y is up, +z is to the plane's right at launch.

export interface FlightInput {
  x: number; // -1..1, + = turn right
  y: number; // -1..1, + = climb; 0 = let go
  boost: boolean; // rockets
  /** Let go means an ideal autopilot glide instead of the nose dropping (used for range estimates). */
  auto?: boolean;
  /** Turbulence: a pitch disturbance in rad/s (+ = nose up). */
  gust?: number;
}

export interface FlightState {
  x: number;
  y: number;
  z: number;
  speed: number;
  gamma: number; // flight path angle (pitch), + = climbing
  gammaRate: number;
  psi: number; // heading, 0 = +x, + = left
  bank: number; // + = left wing down
  grounded: boolean;
  stopped: boolean;
  stalled: boolean;
  impact: number; // set for one step after a bounce/landing, 0..1 strength
  fuel: number; // seconds of engine left
  rocketFuel: number; // seconds of rocket left
  engineOn: boolean;
  rocketOn: boolean;
  touchedDown: boolean; // once the plane touches the ground, the engine and rockets are dead for the run
  bounces: number;
  skimming: boolean; // in ground effect: low enough that drag drops
  fall: number; // m/s of extra sink once the wings can't hold the weight (slow flight)
  /** Highest you can climb back to: the top of your last climb. Only engines, rockets and rings lift it. */
  capY: number;
  peakY: number; // climbing: top of this climb so far. Descending: lowest point so far
  descending: boolean;
  /** Energy was added (engine, rockets, ring) since the cap was last set. */
  powered: boolean;
}

/** Steepest the nose drops to on its own when you let go (rad, about 49° down). */
const DIVE_FLOOR = -0.85;
/** Share of the tail's pitch rate used when holding to climb, and when the nose drops. */
// Tuned so tapping by feel (climb when fast, let go when slowing) gets 70-90% of an ideal glide
const CLIMB = 1.0;
const DROP = 0.8;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function createFlight(
  stats: PlaneStats, x: number, y: number, z: number, speed: number, gamma: number, psi: number,
): FlightState {
  return {
    x, y, z, speed, gamma, psi,
    gammaRate: 0, bank: 0,
    grounded: false, stopped: false, stalled: false, impact: 0,
    fuel: stats.fuel, rocketFuel: stats.rocketFuel, engineOn: false, rocketOn: false,
    touchedDown: false, bounces: 0, skimming: false, fall: 0, capY: Infinity, peakY: y, descending: false, powered: false,
  };
}

function dragAccel(stats: PlaneStats, speed: number, n: number): number {
  // Induced drag keeps climbing below stall speed (capped at 70% of it), plus a mushing
  // penalty: the slower you go, the faster the rest of your speed bleeds away
  const vi = Math.max(speed, stats.stallSpeed * 0.7);
  // It kicks in from 1.4x stall speed and ramps up on a curve
  const slow = clamp((stats.stallSpeed * 1.4 - speed) / (stats.stallSpeed * 0.9), 0, 1);
  const mush = 3 * slow ** 1.5;
  return stats.dragK * speed * speed + (stats.liftDragK * n * n) / (vi * vi) + mush;
}

/** Below this height the plane is in ground effect: much less drag, but touching down ends the run. */
export const SKIM_HEIGHT = 4;

function move(s: FlightState, dt: number) {
  const h = s.speed * Math.cos(s.gamma);
  s.x += h * Math.cos(s.psi) * dt;
  s.z -= h * Math.sin(s.psi) * dt;
  s.y += s.speed * Math.sin(s.gamma) * dt;
}

/**
 * Flying through a boost ring. Flat boost, no share of current speed (that compounded),
 * each ring in a run gives less than the last, and rings can't push you past a cap
 * above cruising speed, so they extend a good flight rather than making it endless.
 */
/** `quality` rewards a clean line: about 1.8 through the centre, 0.5 clipping the edge. */
export function ringBoost(s: FlightState, stats: PlaneStats, ringsHit: number, quality = 1): void {
  const cap = Math.min(MAX_SPEED, stats.trimSpeed * (1.4 + 0.2 * quality));
  const gain = stats.ringBoost * quality * 0.6 ** ringsHit;
  if (s.speed < cap) s.speed = Math.min(cap, s.speed + gain);
  // New energy: you've earned the right to climb higher
  s.capY = Infinity;
  s.peakY = s.y;
  s.descending = false;
  s.powered = true;
}

export function stepFlight(s: FlightState, stats: PlaneStats, input: FlightInput, dt: number): void {
  s.impact = 0;
  if (s.stopped) return;
  const g = stats.gravity;

  if (s.grounded) {
    // Short, heavy slide: friction grows with speed so even a fast landing stops within about a second
    s.speed = Math.max(0, s.speed - Math.max(10, s.speed * 2.2) * dt);
    s.bank *= 1 - Math.min(1, 8 * dt);
    move(s, dt);
    if (s.speed < 0.3) s.stopped = true;
    return;
  }

  // Hysteresis: once stalled, stay in recovery until there's real airspeed again,
  // otherwise holding climb just re-stalls it every frame and it hangs in the air
  if (s.speed < stats.stallSpeed) s.stalled = true;
  else if (s.speed > stats.stallSpeed * 1.1) s.stalled = false;

  // --- Propulsion: engine runs by itself until the fuel is gone, rockets while boost is held ---
  // Thin air: engines and rockets fade above THIN_AIR, nothing left at CEILING
  const air = clamp((CEILING - s.y) / (CEILING - THIN_AIR), 0, 1);
  let thrust = 0;
  s.engineOn = !s.touchedDown && s.fuel > 0 && stats.thrust > 0;
  if (s.engineOn) {
    // The engine splutters out over its last couple of seconds rather than cutting dead
    thrust += stats.thrust * air * Math.min(1, 0.25 + s.fuel / 2.5);
    s.fuel = Math.max(0, s.fuel - dt);
  }
  s.rocketOn = !s.touchedDown && input.boost && s.rocketFuel > 0;
  if (s.rocketOn) {
    thrust += stats.rocketThrust * air;
    s.rocketFuel = Math.max(0, s.rocketFuel - dt);
  }
  if (thrust > 0) {
    s.capY = Infinity;
    s.peakY = s.y;
    s.descending = false;
    s.powered = true;
  }

  // --- Pitch ---
  let targetRate: number;
  if (input.y !== 0) {
    targetRate = input.y * stats.pitchRate * (input.auto === undefined ? CLIMB : 1);
    // Climbing needs airspeed, but you always keep some authority so you're never stuck
    if (targetRate > 0) targetRate *= clamp((s.speed - stats.stallSpeed) / stats.stallSpeed, 0.3, 1);
  } else if (!input.auto) {
    // One-button flying: let go and the nose drops, which builds speed.
    // It never settles: the further it's pointing down, the faster it drops, so holding a
    // line takes constant small taps. Eases out at DIVE_FLOOR so it's always recoverable.
    const heavy = 1 + Math.max(0, -s.gamma) * 1.5;
    targetRate = Math.max(-stats.pitchRate * DROP * heavy, (DIVE_FLOOR - s.gamma) * 2);
  } else {
    // Autopilot: settle on the path angle that eases speed toward trimSpeed
    // (with thrust to spare, that means climbing)
    const n0 = Math.cos(s.gamma) / Math.cos(s.bank);
    const want = dragAccel(stats, s.speed, n0) - thrust + 0.6 * (stats.trimSpeed - s.speed);
    const targetGamma = -Math.asin(clamp(want / g, -0.5, 0.9));
    targetRate = (targetGamma - s.gamma) * 1.5;
  }
  // Stall: climb input is ignored and the nose drops, steeper the slower you are, until
  // gravity has rebuilt the speed. Never a vertical nosedive.
  // Holding the button still softens the drop, so you can nurse a slow glide.
  if (s.stalled && !s.touchedDown) {
    const slow = clamp(1 - s.speed / stats.stallSpeed, 0, 1);
    // Steepens as speed bleeds away, so even holding it can't hang in the air
    const floor = input.y > 0 ? -0.35 - 0.55 * slow : -0.5 - 0.6 * slow;
    targetRate = clamp((floor - s.gamma) * 2, -1, 0.2);
  }
  // After a bounce the plane is done flying: it just arcs back down
  if (s.touchedDown) targetRate = Math.min(targetRate, -0.8);
  // Wings stop climbing in thin air; above the ceiling the nose gently tips over
  if (targetRate > 0) targetRate *= air;
  if (s.y > CEILING && s.gamma > -0.15) targetRate = Math.min(targetRate, -0.4);
  s.gammaRate += (targetRate - s.gammaRate) * Math.min(1, 12 * dt);
  // Thin air also limits how steeply you can point up, so momentum can't zoom you past the ceiling
  const maxGamma = s.y > CEILING ? -0.1 : 0.9 * air;
  // Turbulence knocks the nose about; you have to keep correcting
  if (input.gust && !s.touchedDown) s.gamma += input.gust * dt;
  s.gamma = clamp(s.gamma + s.gammaRate * dt, s.stalled ? -1.2 : -0.9, Math.max(-0.1, maxGamma));
  if (s.gamma >= maxGamma) s.gammaRate = Math.min(s.gammaRate, 0);

  // --- Bank & turn (coordinated turn: yaw rate = g·tan(bank)/v) ---
  s.bank += (-input.x * stats.maxBank - s.bank) * Math.min(1, 4 * dt);
  s.psi = clamp(s.psi + ((g * Math.tan(s.bank)) / Math.max(s.speed, 8)) * dt, -1.4, 1.4);

  // --- Energy: gravity along the path, drag grows with load factor (pulling/turning) ---
  const n = clamp((Math.cos(s.gamma) + (s.speed * s.gammaRate) / g) / Math.cos(s.bank), 0, 4);
  // Ground effect: skimming low cuts drag by up to half, the closer the bigger the saving
  s.skimming = !s.touchedDown && s.y < SKIM_HEIGHT;
  const ground = s.skimming ? 1 - 0.5 * (1 - s.y / SKIM_HEIGHT) : 1;
  s.speed += (thrust - g * Math.sin(s.gamma) - dragAccel(stats, s.speed, n) * ground) * dt;
  // Diving then pulling up never gets you above the top of your last climb. While climbing,
  // any speed beyond what would coast you up to the old height at stall speed bleeds away,
  // so a zoom climb stalls out right at the cap. Speed that can't take you past it is left alone.
  // Only while actually gaining height: nose-up but sinking (thin air, a stall) isn't a zoom
  const thinSink = s.y > THIN_AIR ? (1 - air) * 6 : 0;
  if (s.speed * Math.sin(s.gamma) - s.fall - thinSink > 0 && s.y > s.capY - 40) {
    const allowed = Math.sqrt(stats.stallSpeed ** 2 + 2 * g * Math.max(0, s.capY - s.y));
    if (s.speed > allowed) s.speed -= (s.speed - allowed) * Math.min(1, 3 * dt);
  }
  s.speed = clamp(s.speed, 0, MAX_SPEED);

  move(s, dt);
  // Slow wings can't hold the weight: below 1.5x stall speed gravity takes back over and the
  // plane drops, building up like a falling stone the slower it goes. Airspeed back = lift back.
  if (!s.touchedDown) {
    const support = clamp(s.speed / (stats.stallSpeed * 1.5), 0, 1) ** 2;
    s.fall += g * (1 - support) * dt;
    s.fall *= Math.exp(-2 * support * dt);
    s.y -= s.fall * dt;
  }
  // Backstop only; the pitch steering above normally stops you well before this
  if (s.y > s.capY + 0.5) {
    s.y = s.capY + 0.5;
    s.speed = Math.min(s.speed, stats.stallSpeed * 0.9);
  }
  // Once you've dropped a couple of metres below the top of a climb, that top is the new cap.
  // Small wobbles from turbulence or tapping don't count either way, so the cap doesn't creep.
  if (!s.descending) {
    if (s.y > s.peakY) s.peakY = s.y;
    else if (!s.touchedDown && s.y < s.peakY - 2) {
      // Right after a boost, the cap is as high as your speed could carry you (that energy was
      // earned); after that it's strictly the top of each climb
      const reach = s.y + Math.max(0, s.speed ** 2 - stats.stallSpeed ** 2) / (2 * g);
      s.capY = Math.min(s.capY, s.powered ? Math.max(s.peakY, reach) : s.peakY);
      s.powered = false;
      s.descending = true;
      s.peakY = s.y;
    }
  } else if (s.y < s.peakY) s.peakY = s.y;
  else if (s.y > s.peakY + 2) {
    // Climbing again: start measuring this climb's top
    s.descending = false;
    s.peakY = s.y;
  }
  // Thin air can't hold the plane up: no loitering along the ceiling
  if (!s.touchedDown) s.y -= thinSink * dt;

  // --- Ground: first touch kills all power; up to two shrinking bounces, then a short slide ---
  if (s.y <= 0) {
    s.y = 0;
    s.touchedDown = true;
    s.engineOn = s.rocketOn = false;
    s.gammaRate = 0;
    const vy = s.speed * Math.sin(s.gamma) - s.fall;
    s.fall = 0;
    if (vy < -4 && s.bounces < 2) {
      s.bounces++;
      s.impact = clamp(-vy / 25, 0.3, 1);
      s.gamma = Math.min(0.35, -s.gamma * 0.45);
      s.speed *= 0.5;
    } else {
      s.impact = 0.25;
      s.speed *= Math.cos(s.gamma) * 0.6;
      s.gamma = 0;
      s.grounded = true;
    }
  }
}
