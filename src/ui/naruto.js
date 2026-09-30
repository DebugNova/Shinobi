// Naruto's HUD theme (a character's `hud: 'naruto'`; Naruto and Sage Naruto): his own face stays in the portrait (no
// eye stands in for it, unlike the Uchiha) inside a black ring with orange hairlines and the Uzumaki crest pinned to it;
// dark chakra flames with an orange rim and rising chakra bubbles stream off it along a headband health bar (navy
// cloth, orange piping, a steel Leaf plate at its end). While the ultimate is ready the flames turn into Kurama's
// red-orange cloak. Built like the Uchiha theme (uchiha.js: the same flame generators; hud.css `#hud.t-naruto`):
// every animated piece is its own element moved by CSS transform/opacity only.
import { f, rnd, BOX, crown, streamer, layer } from './uchiha.js';

// ---- the portrait: his face (hud.js renders it), a glass gloss over it, the Uzumaki crest

/** The Uzumaki swirl: a spiral from the centre out, closed by a ring (unit circle, stroke drawn). */
function swirl(cx, cy, r, turns = 1.6) {
  let d = '';
  const N = 48;
  for (let i = 0; i <= N; i++) {
    const t = i / N, a = -Math.PI / 2 + t * turns * Math.PI * 2, q = r * (0.08 + t * 0.62);
    d += `${i ? 'L' : 'M'}${f(cx + Math.cos(a) * q)},${f(cy + Math.sin(a) * q)}`;
  }
  return d;
}

/** The Leaf village's mark (the headband's), in a unit circle round (cx, cy): the spiral, the leaf's outline ending
 *  in a point at the upper right, the stem's triangle at the lower left. Stroke it. */
export function leafMark(cx, cy, r) {
  const P = (a, q) => `${f(cx + Math.cos(a) * q * r)},${f(cy + Math.sin(a) * q * r)}`;
  const d2r = Math.PI / 180, tip = `${f(cx + 0.98 * r)},${f(cy - 0.98 * r)}`;
  const outline = `M${P(-12 * d2r, 0.8)}A${f(0.8 * r)},${f(0.8 * r)} 0 1,1 ${P(-78 * d2r, 0.8)}Q${f(cx + 0.45 * r)},${f(cy - 0.95 * r)} ${tip}Q${f(cx + 0.95 * r)},${f(cy - 0.45 * r)} ${P(-12 * d2r, 0.8)}`;
  const stem = `M${P(122 * d2r, 0.78)}L${P(135 * d2r, 1.2)}L${P(148 * d2r, 0.78)}`;
  let sp = '';
  for (let i = 0; i <= 40; i++) {
    const t = i / 40, a = Math.PI * 0.1 + t * Math.PI * 2 * 1.45, q = 0.06 + t * 0.5;
    sp += `${i ? 'L' : 'M'}${P(a, q)}`;
  }
  return outline + stem + sp;
}

/** The portrait's overlays (inside .h-eye, over the face): the Kurama glow at the edge, the glass, the crest, the
 *  outer glow while the ultimate is ready. */
export function narutoEye() {
  return `
    <i class="n-eye-kyu"></i>
    <svg class="n-eye-gloss" viewBox="0 0 100 100"><defs><radialGradient id="ne-vig"><stop offset=".74" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#140600" stop-opacity=".62"/></radialGradient>
      <linearGradient id="ne-sheen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".34"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>
      <circle cx="50" cy="50" r="50" fill="url(#ne-vig)"/><path d="M16 34C22 16 40 7 58 8C44 12 30 20 24 38Z" fill="url(#ne-sheen)"/><circle cx="70" cy="76" r="2.2" fill="#fff" opacity=".2"/></svg>
    <i class="n-eye-glow"></i>
    <svg class="n-crest" viewBox="0 0 40 40"><defs><radialGradient id="ne-crest" cx=".38" cy=".32"><stop offset="0" stop-color="#ffe2b0"/><stop offset=".55" stop-color="#ff8a1f"/><stop offset="1" stop-color="#b8420a"/></radialGradient></defs>
      <circle cx="20" cy="20" r="17.5" fill="#0b0604"/><circle cx="20" cy="20" r="14.6" fill="url(#ne-crest)"/><circle cx="20" cy="20" r="14.6" fill="none" stroke="#ffe8c0" stroke-width=".9" opacity=".7"/>
      <path d="${swirl(20, 20, 13, 2.1)}" fill="none" stroke="#a8100e" stroke-width="2.6" stroke-linecap="round"/>
      <path d="M11 13C14 9 19 8 23 9" fill="none" stroke="#fff" stroke-width="1.4" stroke-linecap="round" opacity=".55"/></svg>`;
}

/** The portrait's ring (in .h-port-frame's 120 box: the portrait's edge is at r 42): black, orange hairlines. */
export const NARUTO_FRAME = `<defs><linearGradient id="nf-ring" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe0a0"/><stop offset=".5" stop-color="#ff7a14"/><stop offset="1" stop-color="#ffc060"/></linearGradient></defs>
  <circle cx="60" cy="60" r="47.6" fill="none" stroke="#0a0503" stroke-width="11"/><circle cx="60" cy="60" r="42.9" fill="none" stroke="url(#nf-ring)" stroke-width="1.5"/>
  <circle cx="60" cy="60" r="53.4" fill="none" stroke="url(#nf-ring)" stroke-width="1.3"/>`;

/** The headband's steel plate capping the health bar (in .h-cap): brushed steel, rivets, the Leaf engraved. */
export const NARUTO_CAP = `<svg viewBox="0 0 46 34"><defs><linearGradient id="nc-steel" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f4f7fb"/><stop offset=".3" stop-color="#c3cbd6"/><stop offset=".62" stop-color="#8a95a6"/><stop offset="1" stop-color="#d6dde6"/></linearGradient>
    <linearGradient id="nc-brush" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".45" stop-color="#fff" stop-opacity=".35"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>
  <rect x="1.5" y="1.5" width="43" height="31" rx="5" fill="#0a0e1a"/><rect x="3.5" y="3.5" width="39" height="27" rx="3.5" fill="url(#nc-steel)"/>
  <rect x="3.5" y="3.5" width="39" height="27" rx="3.5" fill="url(#nc-brush)"/><rect x="5" y="5" width="36" height="24" rx="2.5" fill="none" stroke="#fff" stroke-width=".8" opacity=".55"/>
  <g fill="#4a5466"><circle cx="7.5" cy="7.5" r="1.3"/><circle cx="38.5" cy="7.5" r="1.3"/><circle cx="7.5" cy="26.5" r="1.3"/><circle cx="38.5" cy="26.5" r="1.3"/></g>
  <path d="${leafMark(23, 17.5, 8.4)}" fill="none" stroke="#fff" stroke-width="1.9" stroke-linejoin="round" stroke-linecap="round" opacity=".55" transform="translate(.5 .7)"/>
  <path d="${leafMark(23, 17.5, 8.4)}" fill="none" stroke="#2a3140" stroke-width="1.9" stroke-linejoin="round" stroke-linecap="round"/></svg>`;

// ---- chakra flames round the portrait (same box as the Uchiha flames), bubbles instead of torn-off shards

/** Chakra bubbles drifting away along the bar (animated by CSS): rings of several sizes. */
function bubbles(seed, n, y0, y1, x0, x1) {
  const R = rnd(seed);
  let d = '';
  for (let i = 0; i < n; i++) {
    const x = x0 + R() * (x1 - x0), y = y0 + R() * (y1 - y0), r = 1.8 + R() * 3.6;
    d += `M${f(x - r)},${f(y)}a${f(r)},${f(r)} 0 1,0 ${f(r * 2)},0a${f(r)},${f(r)} 0 1,0 ${f(-r * 2)},0Z`;
  }
  return d;
}

const CHAKRA = { rim: '#ff7a14', rim2: '#ffa040', glow: ['#ff5a0a', '#ff9a2a'], body: '#170803', bubble: 'rgba(255, 150, 50, 0.22)' };
const KYUUBI = { rim: '#ffd27a', rim2: '#fff0c0', glow: ['#ff2a0a', '#ff6a14'], body: '#c8300a', bubble: 'rgba(255, 220, 140, 0.3)' };

function flameSet(P, cls) {
  const { CX, CY } = BOX;
  const disc = `M${CX - 50},${CY}a50,50 0 1,0 100,0a50,50 0 1,0 -100,0Z`;
  // softer, rounder tongues than Itachi's (fewer, wider), the streamers a little shorter
  const back = disc + crown(71, 8, 50, 36, Math.PI * 0.66, Math.PI * 1.9) +
    streamer(1.7, 112, 74, 260, 14, 6, -12, -1, 10) + streamer(4.6, 124, 84, 170, 8, 4, 3, -1, 7) +
    streamer(2.9, 112, 134, 240, 12, 5, 9, 1, 9) + streamer(5.8, 124, 127, 140, 7, 3, -3, 1, 5);
  const front = disc + crown(83, 6, 50, 28, Math.PI * 0.76, Math.PI * 1.85) + streamer(3.2, 118, 79, 190, 9, 7, -16, -1, 11) + streamer(6.9, 116, 131, 170, 8, 4, 11, 1, 8);
  return `<div class="${cls}">` + layer('u-fl-a', back, P.rim, P.glow, P.body) + layer('u-fl-b', front, P.rim2, P.glow, P.body) +
    layer('u-fl-c', bubbles(15, 8, 56, 84, 240, 360), P.rim2, P.glow, P.bubble) + layer('u-fl-d', bubbles(29, 7, 124, 148, 220, 330), P.rim2, P.glow, P.bubble) + '</div>';
}

/** Every flame layer (inside .h-theme): his chakra, and Kurama's cloak over it (shown while the ultimate is ready). */
export function narutoFlames() {
  return flameSet(CHAKRA, 'n-fl') + flameSet(KYUUBI, 'n-fl n-kyuubi');
}

// ---- the kit's icons (100 box; the circle clips them)

/** Naruto's head and shoulders, front on: spiky hair, the headband's tails blowing to his left (x, y = the head's
 *  centre, s = scale: the head ~24 wide at 1). */
function bust(x, y, s, fill, rim, tails = 1) {
  const d = 'M-11.5,-1L-17,-5L-12.5,-7.5L-16.5,-15L-8.5,-12.5L-8,-21L-1.5,-14L3.5,-22.5L6.5,-14L13.5,-18.5L11,-9.5L17.5,-7L11.5,-1' +
    'Q11.5,9.5 0,11Q-11.5,9.5 -11.5,-1Z' + // hair + face
    'M-4.5,10L-5,14L5,14L4.5,10Z' + // neck
    'M-22,31Q-21,16 -5,13.5L5,13.5Q21,16 22,31Z' + // shoulders
    (tails ? 'M10.5,-6L22,-9L27,-5.5L19,-5.5L25,-1L11.5,-2Z' : ''); // the headband's tails
  return `<g transform="translate(${x} ${y}) scale(${s})"><path d="${d}" fill="${fill}" stroke="${rim}" stroke-width="${f(1.6 / s)}" stroke-linejoin="round" paint-order="stroke"/></g>`;
}

/** A cluster of cel-shaded smoke balls (the game's poof): ink outline round the whole cluster, shade, lit caps. */
function smoke(balls, lit = '#fbf9f2', shade = '#b9b6cf', ink = '#2a2238') {
  const c = (k, fill, extra = '') => balls.map(([x, y, r]) => `<circle cx="${f(x + r * k)}" cy="${f(y + r * k)}" r="${f(r * (k ? 0.8 : 1))}" fill="${fill}"${extra}/>`).join('');
  return `<g>${c(0, ink, ` stroke="${ink}" stroke-width="3.2"`)}${c(0, shade)}${c(-0.16, lit)}</g>`;
}

/** Wind strokes swirling into a sphere (log spirals, clipped by the caller). */
function spiralArcs(cx, cy, r, n, turns, rot = 0) {
  let d = '';
  for (let k = 0; k < n; k++) {
    for (let i = 0; i <= 24; i++) {
      const t = i / 24, a = rot + (k / n) * Math.PI * 2 + t * turns * Math.PI * 2, q = r * (0.12 + 0.9 * t);
      d += `${i ? 'L' : 'M'}${f(cx + Math.cos(a) * q)},${f(cy + Math.sin(a) * q * 0.92)}`;
    }
  }
  return d;
}

/** Manga speed lines converging on (cx, cy): n wedges from the edge in to radius r0. */
function speedLines(seed, cx, cy, n, r0, w = 2.2) {
  const R = rnd(seed);
  let d = '';
  for (let i = 0; i < n; i++) {
    const a = ((i + R() * 0.7) / n) * Math.PI * 2, q = r0 + R() * 14, hw = (0.5 + R()) * w * 0.012;
    d += `M${f(cx + Math.cos(a - hw) * 80)},${f(cy + Math.sin(a - hw) * 80)}L${f(cx + Math.cos(a) * q)},${f(cy + Math.sin(a) * q)}L${f(cx + Math.cos(a + hw) * 80)},${f(cy + Math.sin(a + hw) * 80)}Z`;
  }
  return d;
}

/** One blade of the Rasenshuriken, pointing up from the centre and sweeping back (unit ~46 long). */
const BLADE = 'M-6,-6C-2,-20 2,-32 -2,-47C8,-36 13,-22 8,-6Z';

export const NARUTO_ICONS = {
  // Q: Shadow Clone Jutsu, clones bursting out of the smoke round him, rows of them fading back
  shadowClones: `<defs><radialGradient id="nq-bg" cx=".5" cy=".3" r=".85"><stop offset="0" stop-color="#ffd27a"/><stop offset=".45" stop-color="#f07a18"/><stop offset="1" stop-color="#5a1a04"/></radialGradient></defs>
    <rect width="100" height="100" fill="url(#nq-bg)"/>
    <path d="${speedLines(3, 50, 40, 22, 30)}" fill="#fff4d8" opacity=".35"/>
    <g opacity=".55">${bust(24, 30, 0.48, '#4a1a06', '#ffc060', 0)}${bust(76, 30, 0.48, '#4a1a06', '#ffc060', 0)}${bust(50, 24, 0.44, '#4a1a06', '#ffc060', 0)}</g>
    ${smoke([[12, 50, 9], [88, 50, 9], [34, 44, 7], [66, 44, 7]])}
    ${bust(17, 56, 0.66, '#2a0e04', '#ffb040')}${bust(83, 56, 0.66, '#2a0e04', '#ffb040')}
    ${smoke([[4, 84, 13], [20, 92, 14], [80, 92, 14], [96, 84, 13], [30, 74, 8], [70, 74, 8]])}
    ${bust(50, 54, 1.02, '#140602', '#fff0b0')}
    ${smoke([[36, 97, 11], [50, 100, 12], [64, 97, 11]])}
    <g fill="#fffbe8"><path d="M8 18l3 6 6 1-5 3 1 6-5-4-5 3 2-6-4-4h6z" opacity=".8"/><path d="M90 14l2 4 4 1-3 2 1 4-4-3-3 2 1-4-3-3h4z" opacity=".7"/></g>`,
  // E: Rasengan, the spinning sphere on his palm
  rasengan: `<defs><radialGradient id="ne-bg" cx=".5" cy=".45" r=".75"><stop offset="0" stop-color="#2a6ad8"/><stop offset=".5" stop-color="#0c2458"/><stop offset="1" stop-color="#030818"/></radialGradient>
    <radialGradient id="ne-ball" cx=".42" cy=".38"><stop offset="0" stop-color="#ffffff"/><stop offset=".25" stop-color="#c8f4ff"/><stop offset=".6" stop-color="#4ab8ff"/><stop offset=".88" stop-color="#1a5ad0"/><stop offset="1" stop-color="#0a2a80"/></radialGradient>
    <radialGradient id="ne-halo"><stop offset=".5" stop-color="#7ad8ff" stop-opacity=".55"/><stop offset="1" stop-color="#2a8aff" stop-opacity="0"/></radialGradient>
    <clipPath id="ne-clip"><circle cx="50" cy="44" r="26"/></clipPath></defs>
    <rect width="100" height="100" fill="url(#ne-bg)"/><circle cx="50" cy="44" r="42" fill="url(#ne-halo)"/>
    <g fill="none" stroke="#bfefff" stroke-linecap="round"><ellipse cx="50" cy="44" rx="40" ry="13" transform="rotate(-18 50 44)" stroke-width="1.6" opacity=".55" stroke-dasharray="30 8 14 10"/><ellipse cx="50" cy="44" rx="36" ry="10" transform="rotate(24 50 44)" stroke-width="1.1" opacity=".4" stroke-dasharray="18 12"/></g>
    <circle cx="50" cy="44" r="26" fill="url(#ne-ball)"/>
    <g clip-path="url(#ne-clip)" fill="none" stroke-linecap="round"><path d="${spiralArcs(50, 44, 27, 5, 0.75, 0.4)}" stroke="#0e3aa0" stroke-width="2.2" opacity=".45"/><path d="${spiralArcs(50, 44, 27, 5, 0.75, 0.75)}" stroke="#ffffff" stroke-width="1.8" opacity=".85"/></g>
    <circle cx="50" cy="44" r="7" fill="#fff"/><circle cx="50" cy="44" r="26" fill="none" stroke="#e6fbff" stroke-width="1.4" opacity=".8"/>
    <g stroke="#dff8ff" stroke-width="1.6" stroke-linecap="round" opacity=".8"><path d="M16 30l-6-3M86 26l6-4M14 58l-6 2M88 56l6 3"/></g>
    <path d="M14 100C16 86 22 78 30 74L30 66C30 62 36 62 36 66L37 72C40 70 44 70 47 71L48 63C48 59 54 59 54 63L54 71C57 70 61 71 63 72L64 65C64 61 70 61 70 65L70 74C72 73 75 73 77 75L79 70C80 66 86 67 85 71L82 84C80 92 82 96 86 100Z" fill="#0a1426" stroke="#6ac8ff" stroke-width="1.4" stroke-linejoin="round"/>`,
  // G: Shadow Clone Substitution, a kunai striking the clone as it bursts into smoke, him slipping away
  cloneDefense: `<defs><radialGradient id="ng-bg" cx=".6" cy=".35" r=".85"><stop offset="0" stop-color="#9ad8ff"/><stop offset=".5" stop-color="#2a70b8"/><stop offset="1" stop-color="#081c3a"/></radialGradient></defs>
    <rect width="100" height="100" fill="url(#ng-bg)"/>
    <g fill="#e8f6ff" opacity=".5"><path d="M44 30L88 18L88 21L46 32Z"/><path d="M46 42L92 40L92 43L46 44Z"/><path d="M44 54L86 62L85 65L44 56Z"/></g>
    ${bust(76, 38, 0.95, '#0a1424', '#ff9a2a')}
    <g opacity=".42">${bust(34, 50, 0.95, '#0a1424', '#0a1424')}</g>
    ${smoke([[22, 56, 14], [38, 50, 15], [30, 70, 14], [48, 66, 11], [14, 74, 10], [42, 82, 9], [26, 40, 8]])}
    <g transform="translate(62 84) rotate(-150)"><path d="M0-3L15-2.2L28 0L15 2.2L0 3Z" fill="#dfe6ef" stroke="#1a2230" stroke-width="1.3" stroke-linejoin="round"/><path d="M0 0H28" stroke="#8a95a6" stroke-width=".9"/>
      <rect x="-12" y="-1.8" width="12" height="3.6" fill="#2a1a14"/><circle cx="-15" cy="0" r="3.2" fill="none" stroke="#1a2230" stroke-width="1.5"/></g>
    <g stroke="#fff6c0" stroke-width="1.5" stroke-linecap="round"><path d="M50 70l6 3M52 64l7-1M48 76l4 5"/></g>`,
  // X: Shadow Clone Rush, three clones charging in, the lead's fist coming at you
  rush: `<defs><radialGradient id="nx-bg" cx=".5" cy=".42" r=".8"><stop offset="0" stop-color="#fff2b0"/><stop offset=".35" stop-color="#ffa030"/><stop offset=".75" stop-color="#c8400a"/><stop offset="1" stop-color="#4a1204"/></radialGradient>
    <radialGradient id="nx-fist" cx=".4" cy=".35"><stop offset="0" stop-color="#ffe8cc"/><stop offset=".7" stop-color="#f0b486"/><stop offset="1" stop-color="#b8784c"/></radialGradient></defs>
    <rect width="100" height="100" fill="url(#nx-bg)"/>
    <path d="${speedLines(7, 50, 42, 26, 24, 2.6)}" fill="#fff8e0" opacity=".55"/>
    <g transform="rotate(-16 22 50)">${bust(22, 50, 0.62, '#1c0a04', '#ffd070')}</g><g transform="rotate(16 78 50)">${bust(78, 50, 0.62, '#1c0a04', '#ffd070')}</g>
    <g transform="rotate(-6 50 40)">${bust(50, 38, 0.9, '#140602', '#fff0b0')}</g>
    <path d="M34 100L37 86C39 82 61 82 63 86L66 100Z" fill="#ff7a14" stroke="#140602" stroke-width="2"/><path d="M36 86H64V91H36Z" fill="#1a1a2a"/>
    <g stroke="#3a1606" stroke-width="2" stroke-linejoin="round">
      <path d="M31 70C30 62 33 57 38 57C40 54 45 54 47 56C49 53 54 53 56 56C58 54 63 54 65 57C69 57 71 61 70 66L69 76C68 82 62 85 54 85L42 85C35 85 31 80 31 70Z" fill="url(#nx-fist)"/>
      <path d="M38 57C38 62 39 65 41 67M47 56V66M56 56V66M65 57C65 61 64 64 62 66" fill="none" stroke-width="1.4"/>
      <path d="M33 71C38 67 48 67 56 70C60 72 60 77 55 77L40 77" fill="url(#nx-fist)"/></g>
    <path d="M39 60C40 58 42 57 44 58M48 59C49 57 51 56 53 57M57 59C58 57 60 57 62 58" stroke="#fff" stroke-width="1.3" fill="none" stroke-linecap="round" opacity=".65"/>`,
  // R: Rasenshuriken, the Rasengan's core inside four blades of wind, spinning
  ult: `<defs><radialGradient id="nr-bg" cx=".5" cy=".5" r=".72"><stop offset="0" stop-color="#e8faff"/><stop offset=".22" stop-color="#5ab8f0"/><stop offset=".6" stop-color="#123a82"/><stop offset="1" stop-color="#040a20"/></radialGradient>
    <linearGradient id="nr-blade" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#bfeaff"/><stop offset=".6" stop-color="#ffffff"/><stop offset="1" stop-color="#e8fbff" stop-opacity=".7"/></linearGradient>
    <radialGradient id="nr-core" cx=".42" cy=".38"><stop offset="0" stop-color="#fff"/><stop offset=".4" stop-color="#a8e8ff"/><stop offset=".85" stop-color="#2a7ae0"/><stop offset="1" stop-color="#0c3aa0"/></radialGradient></defs>
    <rect width="100" height="100" fill="url(#nr-bg)"/>
    <circle cx="50" cy="50" r="43" fill="none" stroke="#dff6ff" stroke-width="1.4" opacity=".55" stroke-dasharray="40 6 18 8"/>
    <g transform="translate(50 50) rotate(-14)" opacity=".28">${[0, 90, 180, 270].map((a) => `<path transform="rotate(${a})" d="${BLADE}" fill="#e8fbff"/>`).join('')}</g>
    <g transform="translate(50 50) rotate(12)">${[0, 90, 180, 270].map((a) => `<path transform="rotate(${a})" d="${BLADE}" fill="url(#nr-blade)" stroke="#2a78d0" stroke-width="1.3" stroke-linejoin="round"/>`).join('')}</g>
    <circle cx="50" cy="50" r="13" fill="#8adcff" opacity=".45"/><circle cx="50" cy="50" r="10.5" fill="url(#nr-core)" stroke="#e8fbff" stroke-width="1"/>
    <path d="${spiralArcs(50, 50, 10, 3, 0.7)}" fill="none" stroke="#fff" stroke-width="1.1" opacity=".8"/><circle cx="50" cy="50" r="3" fill="#fff"/>`,
  // tools (every character): the scroll and the shuriken, painted to match
  scroll: `<defs><radialGradient id="ns-bg" cx=".4" cy=".3" r=".9"><stop offset="0" stop-color="#e8c486"/><stop offset=".5" stop-color="#9a6630"/><stop offset="1" stop-color="#2e1606"/></radialGradient>
    <linearGradient id="ns-paper" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fffaea"/><stop offset=".45" stop-color="#efe2c0"/><stop offset="1" stop-color="#b8a47c"/></linearGradient>
    <linearGradient id="ns-wood" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8a5a34"/><stop offset=".5" stop-color="#4a2a14"/><stop offset="1" stop-color="#2a1608"/></linearGradient></defs>
    <rect width="100" height="100" fill="url(#ns-bg)"/>
    <g transform="rotate(-28 50 50)"><rect x="16" y="37" width="68" height="26" rx="3" fill="url(#ns-paper)" stroke="#2a1608" stroke-width="2.2"/>
      <rect x="42" y="37" width="16" height="26" fill="#c8201c"/><rect x="42" y="37" width="16" height="26" fill="url(#ns-paper)" opacity=".25"/>
      <path d="M46 44h8M46 50h8M46 56h8" stroke="#fff0d0" stroke-width="1.6"/><path d="M22 45h14M22 52h11M64 45h14M66 52h10" stroke="#8a7a5a" stroke-width="1.4"/>
      <path d="M40 37v26M60 37v26" stroke="#2a1608" stroke-width="1.6"/><path d="M20 40h60" stroke="#fff" stroke-width="1.6" opacity=".6"/>
      <ellipse cx="14" cy="50" rx="5" ry="15" fill="url(#ns-wood)" stroke="#1a0c04" stroke-width="2"/><ellipse cx="86" cy="50" rx="5" ry="15" fill="url(#ns-wood)" stroke="#1a0c04" stroke-width="2"/>
      <ellipse cx="86" cy="50" rx="2.4" ry="8" fill="#b88454"/></g>`,
  shuriken: `<defs><radialGradient id="nh-bg" cx=".4" cy=".35" r=".85"><stop offset="0" stop-color="#8ab4d8"/><stop offset=".5" stop-color="#2c4a6e"/><stop offset="1" stop-color="#08121e"/></radialGradient></defs>
    <rect width="100" height="100" fill="url(#nh-bg)"/>
    <g fill="none" stroke="#e8f4ff" stroke-linecap="round"><path d="M18 30A36 36 0 0 1 40 14" stroke-width="2.4" opacity=".6"/><path d="M82 70A36 36 0 0 1 60 86" stroke-width="2.4" opacity=".6"/><path d="M14 44A36 36 0 0 1 20 26" stroke-width="1.3" opacity=".35"/></g>
    <g transform="rotate(18 50 50)" stroke="#0e1620" stroke-width="2" stroke-linejoin="round">
      ${[0, 90, 180, 270].map((a) => `<g transform="rotate(${a} 50 50)"><path d="M50 10L57 43L50 50Z" fill="#eef3f9"/><path d="M50 10L43 43L50 50Z" fill="#8a97aa"/></g>`).join('')}
      <circle cx="50" cy="50" r="9" fill="#5a6678"/><circle cx="50" cy="50" r="4.4" fill="#0e1620"/></g>
    <circle cx="36" cy="30" r="2.4" fill="#fff"/><path d="M36 24v12M30 30h12" stroke="#fff" stroke-width="1.2" stroke-linecap="round"/>`,
};
