import { CEILING, THIN_AIR } from './config';

const SVG = 'http://www.w3.org/2000/svg';
const START = 150; // degrees, SVG angles run clockwise from +x
const SWEEP = 240;
const MAX_KMH = 350;
const CX = 80;
const CY = 80;
const R = 62;

const polar = (deg: number, r: number) => {
  const a = (deg * Math.PI) / 180;
  return [CX + r * Math.cos(a), CY + r * Math.sin(a)];
};

function el<K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string | number>, parent: Element) {
  const e = document.createElementNS(SVG, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent.appendChild(e);
  return e;
}

/** Analogue speedometer in km/h. */
export class Speedo {
  private needle: SVGGElement;
  private fill: SVGPathElement;
  private value: SVGTextElement;
  private shown = 0;
  private stallArc: SVGPathElement;
  private stallAt = -1;

  constructor(private svg: SVGSVGElement) {
    svg.setAttribute('viewBox', '0 0 160 160');
    const [sx, sy] = polar(START, R);
    const [ex, ey] = polar(START + SWEEP, R);
    const arc = `M ${sx} ${sy} A ${R} ${R} 0 1 1 ${ex} ${ey}`;
    el('circle', { cx: CX, cy: CY, r: R + 12, class: 'speedo-bg' }, svg);
    el('path', { d: arc, class: 'speedo-track' }, svg);
    this.fill = el('path', { d: arc, class: 'speedo-fill', pathLength: 100, 'stroke-dasharray': '0 100' }, svg);

    // Red zone near the top end
    const [rx, ry] = polar(START + SWEEP * (280 / MAX_KMH), R);
    el('path', { d: `M ${rx} ${ry} A ${R} ${R} 0 0 1 ${ex} ${ey}`, class: 'speedo-red' }, svg);

    for (let kmh = 0; kmh <= MAX_KMH; kmh += 25) {
      const major = kmh % 50 === 0;
      const deg = START + SWEEP * (kmh / MAX_KMH);
      const [x1, y1] = polar(deg, R - 9);
      const [x2, y2] = polar(deg, R - (major ? 17 : 13));
      el('line', { x1, y1, x2, y2, class: major ? 'tick major' : 'tick' }, svg);
      if (major && kmh % 100 === 0) {
        const [tx, ty] = polar(deg, R - 27);
        el('text', { x: tx, y: ty + 4, class: 'tick-label' }, svg).textContent = String(kmh);
      }
    }

    // Stall band: the low-speed end of the dial where climbing stops working
    this.stallArc = el('path', { class: 'speedo-stall' }, svg);

    this.needle = el('g', {}, svg);
    el('line', { x1: CX - 8, y1: CY, x2: CX + R - 12, y2: CY, class: 'needle' }, this.needle);
    el('circle', { cx: CX, cy: CY, r: 5, class: 'hub' }, svg);
    this.value = el('text', { x: CX, y: 112, class: 'speedo-value' }, svg);
    el('text', { x: CX, y: 124, class: 'speedo-unit' }, svg).textContent = 'km/h';
    this.set(0);
  }

  set(mps: number) {
    const kmh = Math.max(0, mps * 3.6);
    this.shown += (kmh - this.shown) * 0.25; // smooth the needle
    const frac = Math.min(1, this.shown / MAX_KMH);
    this.needle.setAttribute('transform', `rotate(${START + SWEEP * frac} ${CX} ${CY})`);
    this.fill.setAttribute('stroke-dasharray', `${frac * 100} 100`);
    this.value.textContent = String(Math.round(kmh));
  }

  /** Mark the stall speed on the dial. */
  setStall(mps: number) {
    if (mps === this.stallAt) return;
    this.stallAt = mps;
    const [sx, sy] = polar(START, R + 6);
    const deg = START + SWEEP * Math.min(1, (mps * 3.6) / MAX_KMH);
    const [ex, ey] = polar(deg, R + 6);
    this.stallArc.setAttribute('d', `M ${sx} ${sy} A ${R + 6} ${R + 6} 0 0 1 ${ex} ${ey}`);
  }

  /** Amber when closing in on stall speed, red while stalled. */
  setWarning(level: 'none' | 'near' | 'stall') {
    this.svg.classList.toggle('near', level === 'near');
    this.svg.classList.toggle('stalled', level === 'stall');
  }
}

const ALT_MAX = 180;

/** Vertical altitude strip with the thin-air zone marked. */
export class Altimeter {
  private marker: HTMLElement;
  private label: HTMLElement;
  private cap: HTMLElement;

  constructor(root: HTMLElement) {
    root.innerHTML = `
      <div class="alt-track">
        <div class="alt-thin" style="bottom:${(THIN_AIR / ALT_MAX) * 100}%;height:${((CEILING - THIN_AIR) / ALT_MAX) * 100}%"></div>
        <div class="alt-ceiling" style="bottom:${(CEILING / ALT_MAX) * 100}%"></div>
        <div class="alt-cap hidden"></div>
        <div class="alt-marker"><span></span></div>
      </div>
      <div class="alt-title">ALT</div>`;
    this.marker = root.querySelector('.alt-marker')!;
    this.label = root.querySelector('.alt-marker span')!;
    this.cap = root.querySelector('.alt-cap')!;
  }

  set(y: number) {
    this.marker.style.bottom = `${Math.min(1, Math.max(0, y) / ALT_MAX) * 100}%`;
    this.label.textContent = `${Math.round(y)}m`;
  }

  /** The highest you can climb back to without new energy (Infinity = no limit). */
  setCap(capY: number) {
    const on = Number.isFinite(capY);
    this.cap.classList.toggle('hidden', !on);
    if (on) this.cap.style.bottom = `${Math.min(1, Math.max(0, capY) / ALT_MAX) * 100}%`;
  }
}
