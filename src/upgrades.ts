import { BASE_STATS, type PlaneStats } from './config';

export type Branch = 'slingshot' | 'plane' | 'engines' | 'bonus';
export type Levels = Record<string, number>;

export const BRANCHES: { id: Branch; name: string }[] = [
  { id: 'slingshot', name: 'Slingshot' },
  { id: 'plane', name: 'Plane' },
  { id: 'engines', name: 'Engines' },
  { id: 'bonus', name: 'Bonus' },
];

export interface Upgrade {
  id: string;
  branch: Branch;
  name: string;
  maxLevel: number;
  /** Name of the part at each level (index = level), for upgrades that are distinct parts. */
  tiers?: string[];
  /** Short description of what buying `level` gives you. */
  describe(level: number): string;
  /** Cost to buy `level` (1-based). */
  cost(level: number): number;
  requires?: { id: string; level: number };
  apply(s: PlaneStats, level: number): void;
}

/** Scales every price in the tree; the main knob for how long the game lasts. */
const PRICE = 8;
const friendly = (raw: number) => {
  const step = raw < 100 ? 5 : raw < 1000 ? 10 : raw < 10000 ? 50 : 500;
  return Math.round(raw / step) * step;
};
/** Geometric cost curve rounded to friendly numbers. */
// Cheap first parts stay cheap so the opening flows; the scale bites from a few hundred coins up.
const priced = (raw: number) => friendly(raw * (1 + (PRICE - 1) * Math.min(1, raw / 400)));
const curve = (base: number, growth: number) => (level: number) => priced(base * growth ** (level - 1));
const table = (costs: number[]) => (level: number) => priced(costs[level - 1]);

// Wing tiers: big induced drag + high stall speed with no wings, a long glide at the top
const WINGS = [
  { name: 'No wings', liftDragK: 1500, stallSpeed: 15, maxBank: 0.3 },
  { name: 'Paper wings', liftDragK: 550, stallSpeed: 13, maxBank: 0.6 },
  { name: 'Balsa wings', liftDragK: 450, stallSpeed: 12, maxBank: 0.75 },
  { name: 'Canvas wings', liftDragK: 320, stallSpeed: 11, maxBank: 0.85 },
  { name: 'Aluminium wings', liftDragK: 240, stallSpeed: 10, maxBank: 0.9 },
  { name: 'Glider wings', liftDragK: 180, stallSpeed: 9, maxBank: 0.95 },
  { name: 'Albatross wings', liftDragK: 130, stallSpeed: 8, maxBank: 1.0 },
];
const TAIL = [
  { name: 'No tail', pitchRate: 0.6 },
  { name: 'Basic tail', pitchRate: 1.0 },
  { name: 'Elevator', pitchRate: 1.3 },
  { name: 'Precision tail', pitchRate: 1.6 },
];
const PROP = [
  { name: 'No propeller', thrust: 0, fuel: 0 },
  { name: 'Rubber-band prop', thrust: 2.5, fuel: 4 },
  { name: 'Wound-up prop', thrust: 3, fuel: 5 },
  { name: 'Clockwork prop', thrust: 3.5, fuel: 6 },
  { name: 'Electric prop', thrust: 4, fuel: 8 },
];
const ENGINE = [
  { name: 'No engine', thrust: 0 },
  { name: 'Lawnmower engine', thrust: 5 },
  { name: 'Moped engine', thrust: 6.5 },
  { name: 'Biplane engine', thrust: 8 },
  { name: 'Racing engine', thrust: 10 },
  { name: 'Jet turbine', thrust: 12 },
];
const ROCKETS = [
  { name: 'No rockets', thrust: 0, fuel: 0 },
  { name: 'Firework rockets', thrust: 20, fuel: 1.5 },
  { name: 'Hobby rockets', thrust: 25, fuel: 2 },
  { name: 'Solid boosters', thrust: 30, fuel: 2.5 },
  { name: 'Twin boosters', thrust: 36, fuel: 3 },
  { name: 'Afterburners', thrust: 45, fuel: 4 },
];

const pct = (v: number) => `${Math.round(v * 100)}%`;

export const UPGRADES: Upgrade[] = [
  // ---------- Slingshot ----------
  {
    id: 'band',
    branch: 'slingshot',
    name: 'Band power',
    maxLevel: 10,
    describe: (l) => `Max launch speed ${BASE_STATS.launchSpeed + 4 * l} m/s`,
    cost: curve(15, 1.55),
    apply: (s, l) => (s.launchSpeed = BASE_STATS.launchSpeed + 4 * l),
  },
  {
    id: 'grip',
    branch: 'slingshot',
    name: 'Steady grip',
    maxLevel: 4,
    describe: (l) => `Slower power meter, ${Math.round((BASE_STATS.perfectZone + 0.025 * l) * 100)}% perfect zone`,
    cost: curve(30, 2),
    apply: (s, l) => Object.assign(s, { meterTime: BASE_STATS.meterTime + 0.12 * l, perfectZone: BASE_STATS.perfectZone + 0.025 * l }),
  },
  {
    id: 'frame',
    branch: 'slingshot',
    name: 'Taller frame',
    maxLevel: 6,
    describe: (l) => `Launch from ${(BASE_STATS.pocketHeight + 2.5 * l).toFixed(1)}m up`,
    cost: curve(40, 1.8),
    apply: (s, l) => (s.pocketHeight = BASE_STATS.pocketHeight + 2.5 * l),
  },
  {
    id: 'aim',
    branch: 'slingshot',
    name: 'Aim guide',
    maxLevel: 3,
    describe: (l) => `${l + 1}× longer flight preview`,
    cost: table([15, 60, 200]),
    apply: (s, l) => (s.aimDots = BASE_STATS.aimDots * (l + 1)),
  },

  // ---------- Plane ----------
  {
    id: 'wings',
    branch: 'plane',
    name: 'Wings',
    maxLevel: WINGS.length - 1,
    tiers: WINGS.map((w) => w.name),
    describe: (l) => (l === 1 ? 'Lets the plane glide' : 'Longer glide, slower stall'),
    cost: table([10, 40, 120, 350, 900, 2500]),
    apply: (s, l) => Object.assign(s, { liftDragK: WINGS[l].liftDragK, stallSpeed: WINGS[l].stallSpeed, maxBank: WINGS[l].maxBank }),
  },
  {
    id: 'tail',
    branch: 'plane',
    name: 'Tail',
    maxLevel: TAIL.length - 1,
    tiers: TAIL.map((t) => t.name),
    describe: () => 'Climb and dive more responsively',
    cost: table([20, 100, 400]),
    requires: { id: 'wings', level: 1 },
    apply: (s, l) => (s.pitchRate = TAIL[l].pitchRate),
  },
  {
    id: 'nose',
    branch: 'plane',
    name: 'Streamlined nose',
    maxLevel: 5,
    describe: (l) => `${pct(1 - 0.87 ** l)} less air drag`,
    cost: curve(50, 2.2),
    apply: (s, l) => (s.dragK = BASE_STATS.dragK * 0.87 ** l),
  },

  // ---------- Engines ----------
  {
    id: 'prop',
    branch: 'engines',
    name: 'Propeller',
    maxLevel: PROP.length - 1,
    tiers: PROP.map((p) => p.name),
    describe: (l) => `+${PROP[l].thrust} thrust for ${PROP[l].fuel}s after launch`,
    cost: table([80, 200, 450, 1000]),
    requires: { id: 'tail', level: 1 },
    apply: (s, l) => Object.assign(s, { thrust: PROP[l].thrust, fuel: PROP[l].fuel }),
  },
  {
    id: 'tank',
    branch: 'engines',
    name: 'Fuel tank',
    maxLevel: 6,
    describe: (l) => `+${3 * l}s of engine time`,
    cost: curve(100, 1.8),
    requires: { id: 'prop', level: 1 },
    apply: (s, l) => (s.fuel += 3 * l),
  },
  {
    id: 'engine',
    branch: 'engines',
    name: 'Engine',
    maxLevel: ENGINE.length - 1,
    tiers: ENGINE.map((e) => e.name),
    describe: (l) => `${ENGINE[l].thrust} thrust (replaces the propeller's)`,
    cost: table([600, 1200, 2400, 4500, 8000]),
    requires: { id: 'prop', level: 2 },
    apply: (s, l) => (s.thrust = Math.max(s.thrust, ENGINE[l].thrust)),
  },
  {
    id: 'rockets',
    branch: 'engines',
    name: 'Rocket boosters',
    maxLevel: ROCKETS.length - 1,
    tiers: ROCKETS.map((r) => r.name),
    describe: (l) => `Hold BOOST: ${ROCKETS[l].thrust} thrust for ${ROCKETS[l].fuel}s`,
    cost: table([1500, 3000, 6000, 11000, 20000]),
    requires: { id: 'engine', level: 1 },
    apply: (s, l) => Object.assign(s, { rocketThrust: ROCKETS[l].thrust, rocketFuel: ROCKETS[l].fuel }),
  },

  // ---------- Bonus ----------
  {
    id: 'value',
    branch: 'bonus',
    name: 'Coin value',
    maxLevel: 8,
    describe: (l) => `×${(BASE_STATS.coinMultiplier * (1 + 0.25 * l)).toFixed(2).replace(/\.?0+$/, '')} all coins`,
    cost: curve(40, 1.7),
    apply: (s, l) => (s.coinMultiplier = BASE_STATS.coinMultiplier * (1 + 0.25 * l)),
  },
  {
    id: 'sponsor',
    branch: 'bonus',
    name: 'Sponsor deal',
    maxLevel: 6,
    describe: (l) => `${BASE_STATS.distanceCoins + 0.5 * l} coins per 10m flown`,
    cost: curve(60, 1.9),
    apply: (s, l) => (s.distanceCoins = BASE_STATS.distanceCoins + 0.5 * l),
  },
  {
    id: 'magnet',
    branch: 'bonus',
    name: 'Coin magnet',
    maxLevel: 5,
    describe: (l) => `Pull in coins from ${(BASE_STATS.magnetRadius + 2 * l).toFixed(1)}m`,
    cost: curve(50, 1.8),
    apply: (s, l) => (s.magnetRadius = BASE_STATS.magnetRadius + 2 * l),
  },
  {
    id: 'rings',
    branch: 'bonus',
    name: 'Ring power',
    maxLevel: 5,
    describe: (l) => `Boost rings give +${BASE_STATS.ringBoost + 2 * l} m/s`,
    cost: curve(40, 1.7),
    apply: (s, l) => (s.ringBoost = BASE_STATS.ringBoost + 2 * l),
  },
];

export const upgradeById = (id: string) => UPGRADES.find((u) => u.id === id)!;

export function computeStats(levels: Levels): PlaneStats {
  const s = { ...BASE_STATS };
  // UPGRADES order matters: prop sets fuel before the tank adds to it, engine compares against prop thrust
  for (const u of UPGRADES) {
    const l = levels[u.id] ?? 0;
    if (l > 0) u.apply(s, l);
  }
  // Hands-off glide speed: best-glide point of the drag polar, kept safely above stall
  s.trimSpeed = Math.max(s.stallSpeed * 1.35, (s.liftDragK / s.dragK) ** 0.25);
  return s;
}

export type UpgradeStatus = 'maxed' | 'locked' | 'expensive' | 'buyable';

export function statusOf(u: Upgrade, levels: Levels, wallet: number): UpgradeStatus {
  const l = levels[u.id] ?? 0;
  if (l >= u.maxLevel) return 'maxed';
  if (u.requires && (levels[u.requires.id] ?? 0) < u.requires.level) return 'locked';
  return wallet >= u.cost(l + 1) ? 'buyable' : 'expensive';
}

export function requirementText(u: Upgrade): string {
  if (!u.requires) return '';
  const r = upgradeById(u.requires.id);
  return `Needs ${r.tiers ? r.tiers[u.requires.level] : `${r.name} Lv ${u.requires.level}`}`;
}

/** Visual parts of the plane, derived from upgrade levels. */
export interface PlaneParts {
  wings: number;
  tail: number;
  nose: number;
  prop: number;
  engine: number;
  rockets: number;
}

export const partsOf = (levels: Levels): PlaneParts => ({
  wings: levels.wings ?? 0,
  tail: levels.tail ?? 0,
  nose: levels.nose ?? 0,
  prop: levels.prop ?? 0,
  engine: levels.engine ?? 0,
  rockets: levels.rockets ?? 0,
});
