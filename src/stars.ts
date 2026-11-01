import type { Level } from './biomes';

// Three stars per level. The first is always the finish line, the second a coin haul,
// and the third rotates so neighbouring levels ask for different skills.

export type ChallengeKind = 'finish' | 'coins' | 'rings' | 'clean' | 'perfect';

export interface Challenge {
  kind: ChallengeKind;
  n: number;
  text: string;
}

/** What one flight achieved, for checking challenges. */
export interface RunTally {
  dist: number;
  finished: boolean;
  coins: number;
  rings: number;
  hits: number;
  perfect: boolean;
}

const THIRD: ChallengeKind[] = ['perfect', 'rings', 'clean'];

export function challengesFor(l: Level): Challenge[] {
  // Coin lines give ~9 coins per 100m and rings come every ~280m: ask for about half of either
  const coins = Math.max(10, Math.round((l.target * 0.035) / 5) * 5);
  const rings = Math.max(1, Math.round((l.target / 280) * 0.5));
  const kind = THIRD[(l.n - 1) % THIRD.length];
  const third: Challenge =
    kind === 'perfect' ? { kind, n: 0, text: 'Finish after a perfect launch' }
    : kind === 'rings' ? { kind, n: rings, text: `Fly through ${rings} boost ring${rings > 1 ? 's' : ''}` }
    : { kind, n: 0, text: 'Finish without hitting anything' };
  return [
    { kind: 'finish', n: l.target, text: `Reach the finish at ${l.target.toLocaleString()}m` },
    { kind: 'coins', n: coins, text: `Collect ${coins} coins in one flight` },
    third,
  ];
}

function met(c: Challenge, r: RunTally): boolean {
  switch (c.kind) {
    case 'finish': return r.finished;
    case 'coins': return r.coins >= c.n;
    case 'rings': return r.rings >= c.n;
    case 'clean': return r.finished && r.hits === 0;
    case 'perfect': return r.finished && r.perfect;
  }
}

/** Bitmask of the stars this run earned (bit i = challenge i). */
export const starsFrom = (l: Level, r: RunTally) =>
  challengesFor(l).reduce((mask, c, i) => (met(c, r) ? mask | (1 << i) : mask), 0);

export const countStars = (mask: number) => (mask & 1) + ((mask >> 1) & 1) + ((mask >> 2) & 1);

/** Coins paid for each star the first time you earn it. */
export const starReward = (l: Level) => Math.max(20, Math.round((l.reward * 0.5) / 10) * 10);

export const STAR = `<svg class="star" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.6l2.85 5.95 6.55.85-4.8 4.55 1.2 6.5L12 17.3l-5.8 3.15 1.2-6.5-4.8-4.55 6.55-.85z"/></svg>`;

/** Three stars as markup; `on` marks earned ones, `pop` the ones just earned. */
export const starRow = (mask: number, pop = 0) =>
  [0, 1, 2].map((i) => STAR.replace('class="star"', `class="star${mask & (1 << i) ? ' on' : ''}${pop & (1 << i) ? ' pop' : ''}"`)).join('');
