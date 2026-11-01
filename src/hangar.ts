import { BIOMES, LEVELS } from './biomes';
import { ICONS } from './icons';
import { LAUNCH, PERFECT_BONUS, type PlaneStats } from './config';
import { createFlight, stepFlight } from './flight';
import {
  BRANCHES, UPGRADES, computeStats, requirementText, statusOf, upgradeById,
  type Branch, type Levels, type Upgrade, type UpgradeStatus,
} from './upgrades';

export interface Career {
  flights: number;
  distance: number;
  coins: number;
  perfects: number;
  rings: number;
  longest: number;
}

export interface HangarHooks {
  levels(): Levels;
  wallet(): number;
  buy(u: Upgrade): void;
  stats(): PlaneStats;
  bests(): Record<string, number>;
  levelIndex(): number;
  career(): Career;
}

type Tab = Branch | 'stats';

const MAXED = computeStats(Object.fromEntries(UPGRADES.map((u) => [u.id, u.maxLevel])));
const kmh = (mps: number) => `${Math.round(mps * 3.6)} km/h`;
const num = (v: number) => Math.round(v).toLocaleString();
const pct = (v: number) => `${Math.round(v * 100)}%`;
const mult = (v: number) => `×${v.toFixed(2).replace(/\.?0+$/, '')}`;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** How far this build goes with a perfect launch, rockets fired straight away and an ideal glide. */
function estimateRange(s: PlaneStats): number {
  const f = createFlight(s, 0, s.pocketHeight, 0, s.launchSpeed * PERFECT_BONUS, LAUNCH.pitch, 0);
  const dt = 1 / 60;
  for (let t = 0; !f.stopped && t < 900; t += dt) stepFlight(f, s, { x: 0, y: 0, boost: true, auto: true }, dt);
  return Math.max(0, f.x);
}
const rangeCache = new Map<string, number>();
function rangeOf(levels: Levels): number {
  const key = JSON.stringify(Object.entries(levels).filter(([, v]) => v).sort());
  let r = rangeCache.get(key);
  if (r === undefined) rangeCache.set(key, (r = estimateRange(computeStats(levels))));
  return r;
}

// What an upgrade changes, in player terms. Only the rows that differ are shown.
const METRICS: { label: string; get(s: PlaneStats): number; fmt(v: number): string }[] = [
  { label: 'Launch speed', get: (s) => s.launchSpeed, fmt: kmh },
  { label: 'Power meter speed', get: (s) => 1 / s.meterTime, fmt: (v) => `${(1 / v).toFixed(2)}s sweep` },
  { label: 'Perfect zone', get: (s) => s.perfectZone, fmt: (v) => `Top ${pct(v)}` },
  { label: 'Aim guide', get: (s) => s.aimDots, fmt: (v) => `${num(v)} dots` },
  { label: 'Launch height', get: (s) => s.pocketHeight, fmt: (v) => `${v.toFixed(1)}m` },
  { label: 'Cruise speed', get: (s) => s.trimSpeed, fmt: kmh },
  { label: 'Stall speed', get: (s) => -s.stallSpeed, fmt: (v) => kmh(-v) },
  { label: 'Climb control', get: (s) => s.pitchRate / MAXED.pitchRate, fmt: pct },
  { label: 'Engine power', get: (s) => s.thrust / MAXED.thrust, fmt: (v) => (v ? pct(v) : 'None') },
  { label: 'Engine fuel', get: (s) => s.fuel, fmt: (v) => (v ? `${num(v)}s` : 'None') },
  { label: 'Rocket power', get: (s) => s.rocketThrust / MAXED.rocketThrust, fmt: (v) => (v ? pct(v) : 'None') },
  { label: 'Rocket fuel', get: (s) => s.rocketFuel, fmt: (v) => (v ? `${v.toFixed(1)}s` : 'None') },
  { label: 'Coin multiplier', get: (s) => s.coinMultiplier, fmt: mult },
  { label: 'Coins per 100m', get: (s) => s.distanceCoins * 10, fmt: num },
  { label: 'Magnet reach', get: (s) => s.magnetRadius, fmt: (v) => `${v.toFixed(1)}m` },
  { label: 'Boost ring', get: (s) => s.ringBoost, fmt: (v) => `+${num(v)} m/s` },
];

const LOCK = `<svg class="icon" viewBox="0 0 24 24"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>`;
const ARROW = `<svg class="arrow" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>`;

/** Upgrade shop: a tab per branch, every upgrade in the branch as a card. */
export class Hangar {
  private tab: Tab = 'plane';
  private selected: Record<string, string> = {};
  private tabsEl: HTMLElement;
  private cardsEl: HTMLElement;
  private walletEl: HTMLElement;
  private subEl: HTMLElement;

  constructor(root: HTMLElement, private hooks: HangarHooks) {
    this.tabsEl = root.querySelector('.tabs')!;
    this.cardsEl = root.querySelector('.cards')!;
    this.walletEl = root.querySelector('.wallet-amount')!;
    this.subEl = root.querySelector('.hangar-sub')!;

    for (const t of [...BRANCHES, { id: 'stats' as const, name: 'Stats' }]) {
      const btn = document.createElement('button');
      btn.dataset.tab = t.id;
      btn.className = `tab tab-${t.id}`;
      btn.innerHTML = `<span>${t.name}</span><span class="badge hidden"></span>`;
      btn.addEventListener('click', () => this.show(t.id));
      this.tabsEl.appendChild(btn);
    }

    this.cardsEl.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');
      if (el) {
        if (el.disabled) return;
        if (el.dataset.action === 'buy') this.buy(upgradeById(el.dataset.id!));
        if (el.dataset.action === 'goto') this.select(el.dataset.id!, true);
        return;
      }
      // Tapping a card highlights it
      const card = (e.target as HTMLElement).closest<HTMLElement>('[data-card]');
      if (card && card.dataset.card !== this.current(this.tab as Branch).id) this.select(card.dataset.card!);
    });
  }

  /** Number of upgrades the player can afford right now (for badges). */
  affordable(branch?: Branch): number {
    const levels = this.hooks.levels();
    const wallet = this.hooks.wallet();
    return UPGRADES.filter((u) => (!branch || u.branch === branch) && statusOf(u, levels, wallet) === 'buyable').length;
  }

  /** Call when the hangar opens. */
  open() {
    this.render(true);
  }

  private show(tab: Tab) {
    if (tab === this.tab) return;
    this.tab = tab;
    this.render(true);
    this.cardsEl.scrollTop = 0;
  }

  private select(id: string, reveal = false) {
    const u = upgradeById(id);
    const switched = this.tab !== u.branch;
    this.tab = u.branch;
    this.selected[u.branch] = id;
    this.render();
    if (switched) this.cardsEl.scrollTop = 0;
    if (reveal) this.cardsEl.querySelector(`[data-card="${id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  /** Pick a sensible upgrade to show when a tab opens: something you can buy, else the next one to work towards. */
  private current(branch: Branch): Upgrade {
    const list = UPGRADES.filter((u) => u.branch === branch);
    const chosen = this.selected[branch];
    if (chosen) return upgradeById(chosen);
    const levels = this.hooks.levels();
    const wallet = this.hooks.wallet();
    const by = (st: UpgradeStatus) => list.find((u) => statusOf(u, levels, wallet) === st);
    return by('buyable') ?? by('expensive') ?? list[0];
  }

  private buy(u: Upgrade) {
    this.hooks.buy(u);
    this.render();
    const card = this.cardsEl.querySelector<HTMLElement>(`[data-card="${u.id}"]`);
    card?.classList.add('bought');
    card?.querySelector('.stamp')?.classList.add('show');
  }

  /** `fresh` replays the cards' entrance, for opening the shop or switching tab. */
  render(fresh = false) {
    this.cardsEl.classList.toggle('fresh', fresh);
    const levels = this.hooks.levels();
    const wallet = this.hooks.wallet();
    this.walletEl.textContent = wallet.toLocaleString();
    const mk = UPGRADES.reduce((n, u) => n + (levels[u.id] ?? 0), 0);
    this.subEl.innerHTML = `Mk ${mk + 1} <i></i> <b>${num(rangeOf(levels))}m</b> range`;

    for (const btn of this.tabsEl.querySelectorAll<HTMLButtonElement>('button')) {
      const tab = btn.dataset.tab as Tab;
      btn.classList.toggle('active', tab === this.tab);
      const n = tab === 'stats' ? 0 : this.affordable(tab);
      const badge = btn.querySelector('.badge')!;
      badge.textContent = String(n);
      badge.classList.toggle('hidden', n === 0);
    }

    if (this.tab === 'stats') {
      this.cardsEl.innerHTML = this.statsView();
      return;
    }

    const branch = this.tab;
    const sel = this.current(branch);
    // Every upgrade in the branch on one page, each with its own button
    this.cardsEl.innerHTML = UPGRADES.filter((u) => u.branch === branch)
      .map((u) => this.inspector(u, levels, wallet, u.id === sel.id))
      .join('');
  }

  private inspector(u: Upgrade, levels: Levels, wallet: number, active: boolean): string {
    const level = levels[u.id] ?? 0;
    const status = statusOf(u, levels, wallet);
    const next = Math.min(u.maxLevel, level + 1);
    const nextLevels = { ...levels, [u.id]: next };

    const gauge = Array.from({ length: u.maxLevel }, (_, i) =>
      `<i class="${i < level ? 'on' : i === level && status !== 'maxed' ? 'next' : ''}"></i>`).join('');

    const tier = u.tiers
      ? status === 'maxed'
        ? `<div class="insp-tier"><b>${u.tiers[level]}</b></div>`
        : `<div class="insp-tier"><span>${u.tiers[level]}</span>${ARROW}<b>${u.tiers[next]}</b></div>`
      : '';

    // Before → after for everything this level changes, led by how much further you'd fly
    let deltas = '';
    if (status !== 'maxed') {
      const now = this.hooks.stats();
      const then = computeStats(nextLevels);
      const r0 = rangeOf(levels);
      const r1 = rangeOf(nextLevels);
      const rows = METRICS.filter((m) => Math.abs(m.get(then) - m.get(now)) > 1e-6).map((m) => {
        const up = m.get(then) > m.get(now);
        return `<div class="delta"><span>${m.label}</span><span class="from">${m.fmt(m.get(now))}</span>${ARROW}<b class="${up ? 'up' : 'down'}">${m.fmt(m.get(then))}</b></div>`;
      });
      if (Math.round(r1) !== Math.round(r0)) {
        const gain = r1 - r0;
        rows.unshift(`<div class="delta range"><span>Range</span><span class="from">${num(r0)}m</span>${ARROW}<b class="up">${num(r1)}m</b><em>${gain > 0 ? '+' : ''}${num(gain)}m</em></div>`);
      }
      deltas = rows.length ? `<div class="deltas">${rows.join('')}</div>` : '';
    }

    let action: string;
    if (status === 'maxed') {
      action = `<div class="insp-maxed">Fully upgraded</div>`;
    } else if (status === 'locked') {
      const req = u.requires!;
      action = `<div class="insp-locked">${LOCK}<span>${requirementText(u)}</span>
        <button data-action="goto" data-id="${req.id}" class="ghost-btn btn btn-blue">Show</button></div>`;
    } else {
      const cost = u.cost(next);
      const short = cost - wallet;
      action = `<button data-action="buy" data-id="${u.id}" class="install btn btn-yellow" ${status === 'expensive' ? 'disabled' : ''}>
          <span>${level === 0 ? 'Install' : 'Upgrade'}</span><span class="price"><span class="coin-icon"></span>${num(cost)}</span>
        </button>
        ${status === 'expensive' ? `<div class="saving"><i style="width:${clamp01(wallet / cost) * 100}%"></i></div><div class="saving-note">${num(short)} more coins needed</div>` : ''}`;
    }

    return `<div class="inspector branch-${u.branch} ${status} ${active ? 'active' : ''}" data-card="${u.id}">
      <div class="insp-top">
        <div class="insp-icon">${ICONS[u.id] ?? ''}<span class="insp-lv">${level}</span></div>
        <div class="insp-main">
          <div class="insp-head">
            <div class="insp-name">${u.name}</div>
            <div class="insp-level">${level}/${u.maxLevel}</div>
          </div>
          ${tier}
          <div class="gauge">${gauge}</div>
        </div>
      </div>
      ${status === 'maxed' ? '' : `<div class="insp-desc">${u.describe(next)}</div>`}
      ${deltas}
      <div class="insp-action">${action}</div>
      <div class="stamp">Upgraded!</div>
    </div>`;
  }

  private statsView(): string {
    const s = this.hooks.stats();
    const c = this.hooks.career();
    const bests = this.hooks.bests();
    const current = LEVELS[this.hooks.levelIndex()];
    const range = rangeOf(this.hooks.levels());
    const reach = range / current.target;

    // One row per stat, with a bar showing how close it is to fully upgraded
    const row = (label: string, value: string, frac?: number) => `<div class="stat-row">
      <span class="stat-label">${label}</span><span class="stat-value">${value}</span>
      ${frac === undefined ? '' : `<div class="stat-bar"><i style="width:${clamp01(frac) * 100}%"></i></div>`}
    </div>`;
    const section = (title: string, rows: string) => `<section class="stat-group"><h3>${title}</h3>${rows}</section>`;

    const hero = `<div class="stat-hero">
      <div>
        <div class="stat-label">Estimated range</div>
        <div class="stat-big">${num(range)}<small>m</small></div>
        <div class="stat-note">Perfect launch, ideal glide</div>
      </div>
      <div class="stat-reach ${reach >= 1 ? 'ok' : ''}">
        <span>${reach >= 1 ? 'Reaches' : `${Math.round(reach * 100)}% of`}</span>
        <b>Level ${current.n} finish</b>
        <span>${num(current.target)}m</span>
      </div>
    </div>`;

    const plane = section('Plane', [
      row('Launch speed', kmh(s.launchSpeed), s.launchSpeed / MAXED.launchSpeed),
      row('Cruise speed', kmh(s.trimSpeed), s.trimSpeed / MAXED.trimSpeed),
      row('Engine', s.thrust > 0 ? `${Math.round(s.fuel)}s of fuel` : 'None', s.thrust > 0 ? (s.thrust * s.fuel) / (MAXED.thrust * MAXED.fuel) : 0),
      row('Rockets', s.rocketFuel > 0 ? `${s.rocketFuel.toFixed(1)}s of boost` : 'None', s.rocketFuel > 0 ? (s.rocketThrust * s.rocketFuel) / (MAXED.rocketThrust * MAXED.rocketFuel) : 0),
      row('Perfect zone', `Top ${pct(s.perfectZone)}`, s.perfectZone / MAXED.perfectZone),
    ].join(''));

    const coins = section('Coins', [
      row('Multiplier', mult(s.coinMultiplier), s.coinMultiplier / MAXED.coinMultiplier),
      row('Per 100m flown', num(s.distanceCoins * 10), s.distanceCoins / MAXED.distanceCoins),
      row('Magnet reach', `${s.magnetRadius.toFixed(1)}m`, s.magnetRadius / MAXED.magnetRadius),
      row('Boost ring', `+${s.ringBoost} m/s`, s.ringBoost / MAXED.ringBoost),
    ].join(''));

    // One row per biome: how many of its levels are cleared
    const at = this.hooks.levelIndex();
    const maps = section('Maps', BIOMES.map((b, theme) => {
      const levels = LEVELS.filter((l) => l.theme === theme);
      const cleared = levels.filter((l) => (bests[l.id] ?? 0) >= l.target).length;
      const locked = levels[0].n - 1 > at;
      const done = cleared === levels.length;
      const value = locked ? 'Locked' : done ? 'Finished' : `${cleared} / ${levels.length} levels`;
      return `<div class="stat-row map ${locked ? 'locked' : ''} ${done ? 'done' : ''}" style="--accent:#${b.accent.toString(16).padStart(6, '0')}">
        <span class="stat-label"><i class="dot"></i>${b.name}</span><span class="stat-value">${value}</span>
        <div class="stat-bar"><i style="width:${(cleared / levels.length) * 100}%"></i></div>
      </div>`;
    }).join(''));

    const careerRows = section('Career', [
      row('Flights', num(c.flights)),
      row('Longest flight', `${num(c.longest)}m`),
      row('Total distance', c.distance >= 10000 ? `${(c.distance / 1000).toFixed(1)} km` : `${num(c.distance)}m`),
      row('Coins earned', num(c.coins)),
      row('Perfect launches', num(c.perfects)),
      row('Boost rings', num(c.rings)),
    ].join(''));

    return hero + plane + coins + maps + careerRows;
  }
}
