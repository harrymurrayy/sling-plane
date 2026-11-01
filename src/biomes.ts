export type TreeKind = 'pine' | 'snowPine' | 'broadleaf' | 'cactus' | 'rock' | 'deadTree' | 'lollipop' | 'cottonCandy' | 'mushroom';

export interface Biome {
  id: string;
  name: string;
  /** Multiplies everything earned while flying here. */
  coinBonus: number;
  accent: number;

  skyTop: number;
  horizon: number; // sky horizon + fog
  mountains: [far: number, near: number];
  hemi: [sky: number, ground: number];
  sun: number;
  cloud: number;
  ground: { base: string; patches: [string, string]; specks: [string, string] };

  trunk: number;
  /** Foliage / body colours, picked per tree. */
  foliage: number[];
  /** Repeat a kind to make it more common. */
  trees: TreeKind[];
  /** Rainbows arching over the horizon. */
  rainbows?: boolean;
}

// Visual themes. Each one hosts several levels (see LEVELS below).
export const BIOMES: Biome[] = [
  {
    id: 'meadow',
    name: 'Meadow',
    coinBonus: 1,
    accent: 0x30d158,
    skyTop: 0x3d8fe0,
    horizon: 0xbfe3f7,
    mountains: [0xa9cde6, 0x8fb8d2],
    hemi: [0xdff1ff, 0x4a7a3a],
    sun: 0xfff2dd,
    cloud: 0xffffff,
    ground: { base: '#6cb646', patches: ['rgba(88,160,52,0.55)', 'rgba(130,196,84,0.45)'], specks: ['rgba(60,120,40,0.35)', 'rgba(170,220,110,0.3)'] },
    trunk: 0x7a4b26,
    foliage: [0x2d7a3c, 0x3f9a3a, 0x58a83a, 0x2f8a4a],
    trees: ['pine', 'broadleaf'],
  },
  {
    id: 'desert',
    name: 'Desert',
    coinBonus: 1.1,
    accent: 0xff9f0a,
    skyTop: 0x4a9be0,
    horizon: 0xf3dfba,
    mountains: [0xe2c39a, 0xcfa577],
    hemi: [0xfff3dc, 0xb08a4a],
    sun: 0xffe6bf,
    cloud: 0xfff8ee,
    ground: { base: '#e3c27e', patches: ['rgba(214,170,100,0.5)', 'rgba(240,214,150,0.45)'], specks: ['rgba(170,120,60,0.3)', 'rgba(255,240,200,0.3)'] },
    trunk: 0x8a6a3a,
    foliage: [0x4f8f3a, 0x5a9a44, 0xb98b5e, 0xa47a50],
    trees: ['cactus', 'cactus', 'rock', 'deadTree'],
  },
  {
    id: 'autumn',
    name: 'Autumn Woods',
    coinBonus: 1.2,
    accent: 0xff6b2c,
    skyTop: 0x5a8fd0,
    horizon: 0xf2d9c0,
    mountains: [0xc9a99a, 0xa98a80],
    hemi: [0xffeedd, 0x7a5a2a],
    sun: 0xffd9a8,
    cloud: 0xfff4ea,
    ground: { base: '#a39a42', patches: ['rgba(190,130,50,0.45)', 'rgba(150,150,60,0.45)'], specks: ['rgba(200,90,40,0.35)', 'rgba(230,190,90,0.3)'] },
    trunk: 0x5e3a20,
    foliage: [0x3a6a3a, 0xd9622b, 0xe8a02e, 0xb83a2a],
    trees: ['broadleaf', 'broadleaf', 'pine'],
  },
  {
    id: 'tundra',
    name: 'Tundra',
    coinBonus: 1.3,
    accent: 0x64d2ff,
    skyTop: 0x6fa8dc,
    horizon: 0xe6f0f7,
    mountains: [0xd6e2ec, 0xb9cad8],
    hemi: [0xeaf4ff, 0x9fb4c8],
    sun: 0xffffff,
    cloud: 0xffffff,
    ground: { base: '#e9f0f5', patches: ['rgba(196,212,228,0.6)', 'rgba(255,255,255,0.6)'], specks: ['rgba(170,190,210,0.4)', 'rgba(255,255,255,0.5)'] },
    trunk: 0x5a4030,
    foliage: [0x2f5e4a, 0x3a6a54, 0x9aa8b4],
    trees: ['snowPine', 'snowPine', 'rock'],
  },
  {
    id: 'volcano',
    name: 'Volcano',
    coinBonus: 1.4,
    accent: 0xff453a,
    skyTop: 0x4a3a5a,
    horizon: 0xd99a7a,
    mountains: [0x8a5a50, 0x5e3a38],
    hemi: [0xffd0b0, 0x3a2a2a],
    sun: 0xffb080,
    cloud: 0x8a8080,
    ground: { base: '#4a4040', patches: ['rgba(30,25,25,0.5)', 'rgba(110,80,70,0.4)'], specks: ['rgba(255,110,40,0.35)', 'rgba(20,15,15,0.4)'] },
    trunk: 0x2e2420,
    foliage: [0x3a3434, 0x4a3e3a, 0x2a2222],
    trees: ['rock', 'deadTree', 'rock'],
  },
];

export interface Level extends Biome {
  /** 1-based level number. */
  n: number;
  /** Index into BIOMES for the scenery. */
  theme: number;
  /** 0 on the first level to 4 on the last: obstacle density and turbulence. */
  difficulty: number;
  /** Finish line: flying past it completes the level and unlocks the next one. */
  target: number;
  /** One-off coins for the first time you cross the finish line. */
  reward: number;
}

export const LEVELS_PER_BIOME = 5;

// Finish lines fitted to the progression sim: each sits just past the range a typical player
// has after the planned play time (about 1 min for level 1, rising to ~7 min by level 25).
const TARGETS = [250, 550, 700, 800, 1050, 1250, 1400, 1450, 1500, 1550, 1600, 1650, 1700,
  1850, 1900, 2000, 2050, 2100, 2150, 2250, 2300, 2400, 2450, 2650, 2700];
export const LEVELS: Level[] = BIOMES.flatMap((b, theme) =>
  Array.from({ length: LEVELS_PER_BIOME }, (_, k) => {
    const i = theme * LEVELS_PER_BIOME + k;
    const t = i / (BIOMES.length * LEVELS_PER_BIOME - 1);
    const target = TARGETS[i];
    return {
      ...b,
      id: `L${i + 1}`,
      n: i + 1,
      theme,
      difficulty: 4 * t,
      target,
      reward: Math.round((target * 0.12 * b.coinBonus) / 10) * 10,
    };
  }),
);

/** Free flight: unlocked after the last level. No finish line, just your best, and fuel cans keep the engine going. */
export const FREE: Level = {
  id: 'free',
  name: 'Unicorn Land',
  coinBonus: 1.4,
  accent: 0xff6fd8,
  skyTop: 0x7fb2ff,
  horizon: 0xffd3f0,
  mountains: [0xe9c9ff, 0xc7a3f7],
  hemi: [0xfff0fb, 0xa98fd6],
  sun: 0xfff2f8,
  cloud: 0xfff0fb,
  ground: { base: '#86dea6', patches: ['rgba(255,170,220,0.5)', 'rgba(150,225,255,0.45)'], specks: ['rgba(255,120,200,0.45)', 'rgba(120,200,255,0.45)'] },
  trunk: 0xfff6fb,
  foliage: [0xff9ad5, 0x9fdcff, 0xfff08a, 0xc9a6ff, 0x9af0c4],
  trees: ['lollipop', 'cottonCandy', 'mushroom', 'cottonCandy'],
  rainbows: true,
  n: LEVELS.length + 1,
  theme: BIOMES.length,
  difficulty: 2,
  target: Infinity,
  reward: 0,
};
