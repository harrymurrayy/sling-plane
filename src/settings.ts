export type Quality = 'low' | 'medium' | 'high';

export interface Settings {
  sound: boolean;
  music: boolean;
  haptics: boolean;
  quality: Quality;
  /** No camera shake, speed streaks, screen flashes or looping UI animations. */
  reduceMotion: boolean;
}

/** Phones start on medium graphics; the OS reduced-motion setting carries over. */
export const defaultSettings = (): Settings => ({
  sound: true,
  music: true,
  haptics: true,
  quality: matchMedia('(pointer: coarse)').matches ? 'medium' : 'high',
  reduceMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
});

const TOGGLES: { key: 'sound' | 'music' | 'haptics' | 'reduceMotion'; label: string; note?: string }[] = [
  { key: 'sound', label: 'Sound effects' },
  { key: 'music', label: 'Music' },
  { key: 'haptics', label: 'Vibration' },
  { key: 'reduceMotion', label: 'Reduce motion', note: 'No camera shake, speed streaks or screen flashes' },
];
const QUALITIES: { id: Quality; label: string }[] = [
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
];

/** The settings sheet: a list of switches plus a graphics picker. Changes apply straight away. */
export class SettingsPanel {
  private list: HTMLElement;

  constructor(private root: HTMLElement, private get: () => Settings, private set: (patch: Partial<Settings>) => void) {
    this.list = root.querySelector('.settings-list')!;
    this.list.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-key], button[data-quality]');
      if (!el) return;
      if (el.dataset.quality) this.set({ quality: el.dataset.quality as Quality });
      else {
        const key = el.dataset.key as (typeof TOGGLES)[number]['key'];
        this.set({ [key]: !this.get()[key] });
      }
      this.render();
    });
    // Tapping the dimmed backdrop closes it too
    root.addEventListener('click', (e) => e.target === root && this.close());
    root.querySelector('#settings-close')!.addEventListener('click', () => this.close());
  }

  get isOpen() {
    return !this.root.classList.contains('hidden');
  }

  open() {
    this.render();
    this.root.classList.remove('hidden');
  }

  close() {
    this.root.classList.add('hidden');
  }

  private render() {
    const s = this.get();
    const toggles = TOGGLES.map((t) => `<div class="setting">
        <div class="setting-text"><span>${t.label}</span>${t.note ? `<small>${t.note}</small>` : ''}</div>
        <button class="switch ${s[t.key] ? 'on' : ''}" data-key="${t.key}" role="switch" aria-checked="${s[t.key]}" aria-label="${t.label}"><i></i></button>
      </div>`).join('');
    const quality = `<div class="setting setting-col">
        <div class="setting-text"><span>Graphics</span><small>Lower is smoother on older phones and saves battery</small></div>
        <div class="segmented" role="radiogroup" aria-label="Graphics">${QUALITIES.map((q) =>
          `<button data-quality="${q.id}" role="radio" aria-checked="${s.quality === q.id}" class="${s.quality === q.id ? 'on' : ''}">${q.label}</button>`).join('')}</div>
      </div>`;
    this.list.innerHTML = toggles + quality;
  }
}
