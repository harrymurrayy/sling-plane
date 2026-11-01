// Cartoon icons for the upgrade cards: flat fills, one ink outline weight and a white
// highlight on each, so they read as one set at card size.

const svg = (body: string) =>
  `<svg viewBox="0 0 48 48" aria-hidden="true" fill="none" stroke="#1a1f3d" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const shine = (d: string) => `<path d="${d}" stroke="#fff" stroke-width="2.5" stroke-opacity="0.7"/>`;

export const ICONS: Record<string, string> = {
  // Slingshot fork with a stretched band
  band: svg(`
    <path d="M24 44V28M24 28 13 12M24 28l11-16" stroke-width="9"/>
    <path d="M24 44V28M24 28 13 12M24 28l11-16" stroke="#c9773a" stroke-width="5"/>
    <path d="M13 12q11 22 22 0" stroke="#1a1f3d" stroke-width="6"/>
    <path d="M13 12q11 22 22 0" stroke="#ff5a5a" stroke-width="3"/>
    <circle cx="24" cy="22.5" r="4.5" fill="#8b5a2b"/>`),

  // Power meter with the green perfect zone
  grip: svg(`
    <path d="M7 32a17 17 0 0 1 34 0z" fill="#2c3a78"/>
    <path d="M30 17.5a17 17 0 0 1 11 14.5H31z" fill="#5fd52b"/>
    <path d="M7 32a17 17 0 0 1 34 0z"/>
    <path d="M24 32 35 20" stroke-width="4"/>
    <circle cx="24" cy="32" r="4" fill="#ffd23f"/>
    <rect x="6" y="36" width="36" height="6" rx="3" fill="#ffd23f"/>`),

  // Tall fork with an up arrow
  frame: svg(`
    <path d="M18 44V22M18 22 11 6M18 22l7-16" stroke-width="8"/>
    <path d="M18 44V22M18 22 11 6M18 22l7-16" stroke="#c9773a" stroke-width="4"/>
    <path d="M37 40V12" stroke-width="8"/>
    <path d="M37 40V12" stroke="#5fd52b" stroke-width="4"/>
    <path d="m29 18 8-9 8 9z" fill="#5fd52b"/>`),

  // Dotted trajectory to a target
  aim: svg(`
    <circle cx="36" cy="14" r="9" fill="#ff5a5a"/>
    <circle cx="36" cy="14" r="4" fill="#fff"/>
    <circle cx="8" cy="40" r="3" fill="#3fe0ff"/>
    <circle cx="13" cy="30" r="3" fill="#3fe0ff"/>
    <circle cx="19" cy="22" r="3" fill="#3fe0ff"/>
    <circle cx="26" cy="17" r="3" fill="#3fe0ff"/>`),

  // Swept wing
  wings: svg(`
    <path d="M4 30 30 10h8l-6 12h12v8H22l-8 8H6l6-8z" fill="#f4f7ff"/>
    <path d="M12 30h32" />
    <path d="M38 22h-6" stroke="#ff5a5a" stroke-width="4"/>
    ${shine('M30 13 22 19')}`),

  // Tail fin and stabiliser
  tail: svg(`
    <path d="M10 36h32l-4-6H24L18 8h-6l2 22z" fill="#ff7a3d"/>
    <path d="M6 36h36v6H6z" fill="#f4f7ff"/>
    ${shine('M15 12l1.5 14')}`),

  // Nose cone
  nose: svg(`
    <path d="M6 14h18q18 0 18 10T24 34H6z" fill="#ff7a3d"/>
    <path d="M6 14v20" />
    <path d="M14 14v20" stroke-width="2.5"/>
    ${shine('M24 18q10 0 13 4')}`),

  // Three-blade propeller
  prop: svg(`
    <g fill="#ffd23f">
      <path d="M24 24c-3-9-2-17 0-20 2 3 3 11 0 20z"/>
      <path d="M24 24c-3-9-2-17 0-20 2 3 3 11 0 20z" transform="rotate(120 24 24)"/>
      <path d="M24 24c-3-9-2-17 0-20 2 3 3 11 0 20z" transform="rotate(240 24 24)"/>
    </g>
    <circle cx="24" cy="24" r="6" fill="#ff5a5a"/>
    ${shine('M22 8q-1 6 0 10')}`),

  // Fuel can
  tank: svg(`
    <path d="M10 14h22l6 6v22H10z" fill="#ff5a5a"/>
    <path d="M30 6h8v8" />
    <path d="M18 7h8v7h-8z" fill="#2c3a78"/>
    <path d="m16 24 16 12M32 24 16 36" stroke="#fff" stroke-opacity="0.8"/>`),

  // Engine block with a cog
  engine: svg(`
    <path d="M6 18h28v20H6z" fill="#7d8bb8"/>
    <path d="M10 10h8v8h-8zM22 10h8v8h-8z" fill="#5a6696"/>
    <path d="M34 22h6v4h4v8h-4v4h-6z" fill="#5a6696"/>
    <circle cx="20" cy="28" r="6" fill="#ffd23f"/>
    <circle cx="20" cy="28" r="2" fill="#1a1f3d"/>`),

  // Rocket with flame
  rockets: svg(`
    <path d="M13 35c-4 2-6 6-6 9 3 0 7-2 9-6z" fill="#ffd23f"/>
    <path d="M14 34 34 14q6-6 10-10-4 4-10 10" />
    <path d="M44 4 30 8 12 26l10 10 18-18z" fill="#f4f7ff"/>
    <path d="m12 26-6-1 7-8 6 2zM22 36l1 6 8-7-2-6z" fill="#ff5a5a"/>
    <circle cx="32" cy="16" r="4" fill="#3fe0ff"/>`),

  // Stack of coins
  value: svg(`
    <ellipse cx="22" cy="36" rx="14" ry="5" fill="#e09a00"/>
    <path d="M8 30v6c0 3 6 5 14 5s14-2 14-5v-6" fill="#ffd23f"/>
    <ellipse cx="22" cy="30" rx="14" ry="5" fill="#ffd23f"/>
    <path d="M14 22v8M30 22v8" stroke-width="2.5"/>
    <ellipse cx="22" cy="22" rx="14" ry="5" fill="#ffe27a"/>
    <path d="M36 6l2 4 4 2-4 2-2 4-2-4-4-2 4-2z" fill="#fff"/>`),

  // Sponsor rosette
  sponsor: svg(`
    <path d="m16 28-6 16 7-3 4 6 4-14zM32 28l6 16-7-3-4 6-4-14z" fill="#3fa4ff"/>
    <circle cx="24" cy="20" r="14" fill="#ffd23f"/>
    <path d="m24 11 2.8 5.7 6.2.9-4.5 4.4 1 6.2-5.5-2.9-5.5 2.9 1-6.2-4.5-4.4 6.2-.9z" fill="#fff"/>`),

  // Horseshoe magnet
  magnet: svg(`
    <path d="M10 8h10v16a4 4 0 0 0 8 0V8h10v16a14 14 0 0 1-28 0z" fill="#ff5a5a"/>
    <path d="M10 8h10v6H10zM28 8h10v6H28z" fill="#f4f7ff"/>
    <path d="M6 40l4-4M24 44v-5M42 40l-4-4" stroke="#3fe0ff"/>`),

  // Boost ring
  rings: svg(`
    <ellipse cx="24" cy="24" rx="12" ry="18" stroke-width="10"/>
    <ellipse cx="24" cy="24" rx="12" ry="18" stroke="#3fe0ff" stroke-width="5"/>
    <path d="M4 24h12M36 24h8m-6-5 6 5-6 5" stroke-width="3.5"/>
    ${shine('M15 14q2-6 7-8')}`),
};
