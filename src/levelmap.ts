import { BIOMES, LEVELS } from './biomes';
import { STAR, challengesFor, countStars, starRow, starReward } from './stars';

export interface MapHooks {
  stars(): Record<string, number>;
  bests(): Record<string, number>;
  /** Highest level index you can play. */
  unlocked(): number;
  /** Level index the next flight uses. */
  selected(): number;
  select(index: number): void;
}

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const LOCK = `<svg class="icon" viewBox="0 0 24 24"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>`;

/** Level select: each biome as a postcard with its levels along a path, details for the picked one below. */
export class LevelMap {
  private listEl: HTMLElement;
  private detailEl: HTMLElement;
  private totalEl: HTMLElement;
  private subEl: HTMLElement;

  constructor(root: HTMLElement, private hooks: MapHooks) {
    this.listEl = root.querySelector('.map-list')!;
    this.detailEl = root.querySelector('.map-detail')!;
    this.totalEl = root.querySelector('.map-total')!;
    this.subEl = root.querySelector('.map-sub')!;
    this.listEl.addEventListener('click', (e) => {
      const node = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-level]');
      if (!node || node.disabled) return;
      this.hooks.select(Number(node.dataset.level));
      this.render();
    });
  }

  open() {
    this.render(true);
    // Bring the level you're on into view
    this.listEl.querySelector('.node.selected')?.closest('section')?.scrollIntoView({ block: 'center' });
  }

  render(fresh = false) {
    const stars = this.hooks.stars();
    const bests = this.hooks.bests();
    const unlocked = this.hooks.unlocked();
    const sel = this.hooks.selected();
    const total = LEVELS.reduce((n, l) => n + countStars(stars[l.id] ?? 0), 0);
    this.totalEl.textContent = `${total}/${LEVELS.length * 3}`;
    this.subEl.innerHTML = `${LEVELS.filter((l) => (bests[l.id] ?? 0) >= l.target).length} of ${LEVELS.length} cleared`;

    this.listEl.classList.toggle('fresh', fresh);
    this.listEl.innerHTML = BIOMES.map((b, theme) => {
      const levels = LEVELS.filter((l) => l.theme === theme);
      const got = levels.reduce((n, l) => n + countStars(stars[l.id] ?? 0), 0);
      const locked = levels[0].n - 1 > unlocked;
      const nodes = levels.map((l) => {
        const i = l.n - 1;
        const mask = stars[l.id] ?? 0;
        const state = i > unlocked ? 'locked' : (bests[l.id] ?? 0) >= l.target ? 'done' : 'open';
        return `<button class="node ${state} ${i === sel ? 'selected' : ''}" data-level="${i}" ${i > unlocked ? 'disabled' : ''} aria-label="Level ${l.n}">
          <span class="node-disc">${i > unlocked ? LOCK : l.n}</span>
          <span class="node-stars">${starRow(mask)}</span>
        </button>`;
      }).join('');
      return `<section class="map-biome ${locked ? 'locked' : ''}" style="--sky:${hex(b.skyTop)};--haze:${hex(b.horizon)};--hill:${hex(b.mountains[1])};--ground:${b.ground.base};--accent:${hex(b.accent)}">
        <header><h3>${b.name}</h3><span class="biome-stars">${STAR.replace('class="star"', 'class="star on"')}${got}/${levels.length * 3}</span></header>
        <div class="map-path">${nodes}</div>
      </section>`;
    }).join('');

    // The picked level: its challenges, which stars you have, your best
    const l = LEVELS[sel];
    const mask = stars[l.id] ?? 0;
    const best = bests[l.id] ?? 0;
    const reward = starReward(l);
    const rows = challengesFor(l).map((c, i) => `<li class="${mask & (1 << i) ? 'got' : ''}">
        ${STAR.replace('class="star"', `class="star${mask & (1 << i) ? ' on' : ''}"`)}<span>${c.text}</span>${mask & (1 << i) ? '' : `<b>+${reward}</b>`}
      </li>`).join('');
    this.detailEl.innerHTML = `<div class="map-card">
        <div class="map-card-head">
          <div><div class="map-card-title">Level ${l.n}</div><div class="map-card-sub">${l.name} · Finish ${l.target.toLocaleString()}m</div></div>
          <div class="map-card-best">${best > 0 ? `<span>Best</span><b>${best.toLocaleString()}m</b>` : '<span>Not flown yet</span>'}</div>
        </div>
        <ul class="challenges">${rows}</ul>
        <div class="challenge-note">Stars count from your best single flight</div>
      </div>`;
    const fly = document.getElementById('map-fly')!;
    fly.textContent = `Fly level ${l.n}`;
  }
}
