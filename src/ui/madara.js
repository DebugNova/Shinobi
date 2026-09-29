// Madara's HUD theme (a character's `hud: 'madara'`): a Rinnegan medallion for the portrait (ripples running out
// through its rings; the Rinne Sharingan's red and nine turning tomoe take over while the ultimate is ready),
// Susanoo flames (near-black indigo, an electric-blue rim) streaming off it along a lamellar-armour health bar with a
// crimson fill, and the kit's skill icons painted for it. Built like the Uchiha theme (uchiha.js: the same flame
// generators; hud.css `#hud.t-madara`): every animated piece is its own <svg> moved by CSS transform/opacity only.
import { f, rnd, TOMOE, BOX, crown, streamer, shards, flameRow, layer } from './uchiha.js';

// ---- the portrait: a Rinnegan

const RINGS = [8, 15.5, 23, 30.5, 38]; // the ripple rings' radii (100 box, iris radius 47)

/** Radial fibres between r0 and r1 (a little texture in the iris). */
function fibres(n, r0, r1) {
  let d = '';
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, q0 = r0 + (i % 3) * 1.5, q1 = r1 - (i % 2) * 5;
    d += `M${f(50 + Math.cos(a) * q0)},${f(50 + Math.sin(a) * q0)}L${f(50 + Math.cos(a) * q1)},${f(50 + Math.sin(a) * q1)}`;
  }
  return d;
}

/** The medallion's layers (inside .h-eye): Rinnegan, two ripples, the Rinne Sharingan (iris + turning tomoe), glow, gloss. */
export function rinnegan() {
  const rings = (c, w) => RINGS.map((r, i) => `<circle cx="50" cy="50" r="${r}" fill="none" stroke="${c}" stroke-width="${f(w + i * 0.12)}"/>`).join('');
  // nine tomoe, three on each of the middle rings, heads leading clockwise (the layer spins clockwise)
  const tomoe = [[RINGS[1], 0.5, 20], [RINGS[2], 0.6, 60], [RINGS[3], 0.7, 0]]
    .flatMap(([r, s, a0]) => [0, 120, 240].map((d) => `<path transform="rotate(${d + a0} 50 50) translate(50 ${f(50 - r)}) scale(${s})" d="${TOMOE}"/>`)).join('');
  return `
    <svg class="m-eye-base" viewBox="0 0 100 100"><defs><radialGradient id="mi-iris"><stop offset="0" stop-color="#f1e9ff"/><stop offset=".3" stop-color="#cdb8ee"/><stop offset=".72" stop-color="#9478cc"/><stop offset=".94" stop-color="#5a3e92"/><stop offset="1" stop-color="#2c1a52"/></radialGradient></defs>
      <circle cx="50" cy="50" r="50" fill="#07051a"/><circle cx="50" cy="50" r="47" fill="url(#mi-iris)"/>
      <path d="${fibres(64, 6, 46)}" stroke="#fff" stroke-width=".5" opacity=".16"/>${rings('#35205f', 1.7)}
      <circle cx="50" cy="50" r="4.6" fill="#140828"/><circle cx="50" cy="50" r="46" fill="none" stroke="#1c0f38" stroke-width="2"/></svg>
    <svg class="m-eye-rip" viewBox="0 0 100 100"><circle cx="50" cy="50" r="12" fill="none" stroke="#fbf6ff" stroke-width="1.5"/></svg>
    <svg class="m-eye-rip m-eye-rip2" viewBox="0 0 100 100"><circle cx="50" cy="50" r="12" fill="none" stroke="#fbf6ff" stroke-width="1.5"/></svg>
    <svg class="m-eye-rs" viewBox="0 0 100 100"><defs><radialGradient id="mi-rs"><stop offset="0" stop-color="#ff8a66"/><stop offset=".4" stop-color="#ec1c22"/><stop offset=".8" stop-color="#a0060e"/><stop offset="1" stop-color="#3a0004"/></radialGradient></defs>
      <circle cx="50" cy="50" r="47" fill="url(#mi-rs)"/><path d="${fibres(64, 6, 46)}" stroke="#5a0008" stroke-width=".6" opacity=".35"/>${rings('#2a0004', 1.7)}
      <circle cx="50" cy="50" r="4.8" fill="#070001"/><circle cx="50" cy="50" r="46" fill="none" stroke="#1a0002" stroke-width="2"/></svg>
    <svg class="m-eye-rt" viewBox="0 0 100 100"><g fill="#070001">${tomoe}</g></svg>
    <i class="m-eye-glow"></i>
    <svg class="m-eye-gloss" viewBox="0 0 100 100"><defs><radialGradient id="mi-vig"><stop offset=".68" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".7"/></radialGradient></defs>
      <circle cx="50" cy="50" r="47" fill="url(#mi-vig)"/><ellipse cx="35" cy="27" rx="13" ry="6.5" fill="#fff" opacity=".3" transform="rotate(-32 35 27)"/><circle cx="66" cy="72" r="2.4" fill="#fff" opacity=".22"/></svg>`;
}

/** The portrait's ring (in .h-port-frame's 120 box: the portrait's edge is at r 42): indigo-black, blue hairlines. */
export const MADARA_FRAME = `<defs><linearGradient id="mf-ring" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d4deff"/><stop offset=".5" stop-color="#4a5ee0"/><stop offset="1" stop-color="#aebfff"/></linearGradient></defs>
  <circle cx="60" cy="60" r="47.6" fill="none" stroke="#04050e" stroke-width="11"/><circle cx="60" cy="60" r="42.9" fill="none" stroke="url(#mf-ring)" stroke-width="1.5"/>
  <circle cx="60" cy="60" r="53.4" fill="none" stroke="url(#mf-ring)" stroke-width="1.3"/>`;

// ---- Susanoo flames round the portrait (same box as the Uchiha flames)

const SUSANOO = { glow: ['#2a5cff', '#4a7cff'], body: '#060818' };

/** Every flame layer, back to front (inside .h-theme). Taller tongues over the top than Itachi's (a Susanoo's
 *  aura rises), thinner streamers along the bar. */
export function madaraFlames() {
  const { CX, CY } = BOX;
  const disc = `M${CX - 50},${CY}a50,50 0 1,0 100,0a50,50 0 1,0 -100,0Z`;
  const back = disc + crown(31, 8, 50, 42, Math.PI * 0.8, Math.PI * 1.95) +
    streamer(2.7, 112, 75, 280, 12, 5, -14, -1, 14) + streamer(6.1, 124, 85, 170, 7, 4, 2, -1, 9) +
    streamer(1.9, 112, 133, 230, 10, 4, 8, 1, 9) + streamer(4.8, 124, 126, 140, 6, 3, -2, 1, 5);
  const front = disc + crown(47, 6, 50, 32, Math.PI * 0.95, Math.PI * 1.85) + streamer(8.3, 118, 79, 210, 8, 6, -18, -1, 14) + streamer(3.3, 116, 131, 170, 7, 4, 10, 1, 8);
  const S = SUSANOO;
  return layer('u-fl-a', back, '#3a64f0', S.glow, S.body) + layer('u-fl-b', front, '#7fa4ff', S.glow, S.body) +
    layer('u-fl-c', shards(13, 7, 58, 82, 250, 370), '#6a90ff', S.glow, S.body) + layer('u-fl-d', shards(17, 6, 126, 146, 230, 340), '#6a90ff', S.glow, S.body);
}

// ---- the kit's icons (100 box; the circle clips them)

/** Madara from the side, facing right (a black cut-out rim-lit by rim): the mane down his back, hands at the mouth. */
function madaraFigure(x, y, s, rim) {
  const d = 'M-8,0L-6,-14L-8,-20L-6,-30L6,-30L6,-20L8,-14L10,0Z' + // robe + armour skirt
    'M-5,-29L-4,-40L5,-40L6,-29Z' + // chest
    'M-3.2,-41.5A4.3,4.3 0 1,1 5.4,-43A4.3,4.3 0 1,1 -3.2,-41.5Z' + // head
    'M-1,-47L-9,-45L-6,-43L-13,-38L-8,-38L-13,-31L-7,-33L-10,-24L-4,-31L-2,-38L1,-43Z' + // the mane
    'M3,-38L11,-42L12,-40L5,-35Z'; // forearms up to the mouth (the seal)
  return `<g transform="translate(${x} ${y}) scale(${s})"><path d="${d}" fill="#0a0404" stroke="${rim}" stroke-width="1.2" stroke-linejoin="round" paint-order="stroke"/></g>`;
}

/** A wooden stake bursting out of the ground: base at (x, y), leaning ang degrees, lit on its left. */
function stake(x, y, len, w, ang) {
  const outline = `M${-w},0Q${f(-w * 0.75)},${f(-len * 0.55)} 0,${-len}Q${f(w * 0.75)},${f(-len * 0.55)} ${w},0Z`;
  const shade = `M0,${-len}Q${f(w * 0.75)},${f(-len * 0.55)} ${w},0L${f(w * 0.15)},0Q${f(w * 0.2)},${f(-len * 0.5)} 0,${-len}Z`;
  const grain = `M${f(-w * 0.45)},0Q${f(-w * 0.4)},${f(-len * 0.4)} ${f(-w * 0.12)},${f(-len * 0.72)}M${f(w * 0.5)},0Q${f(w * 0.45)},${f(-len * 0.35)} ${f(w * 0.2)},${f(-len * 0.6)}`;
  const tip = `M0,${-len}Q${f(-w * 0.28)},${f(-len * 0.86)} ${f(-w * 0.33)},${f(-len * 0.78)}L${f(w * 0.3)},${f(-len * 0.78)}Q${f(w * 0.25)},${f(-len * 0.86)} 0,${-len}Z`;
  return `<g transform="translate(${x} ${y}) rotate(${ang})"><path d="${outline}" fill="url(#me-wood)" stroke="#1a0d05" stroke-width="2.2" stroke-linejoin="round"/>
    <path d="${shade}" fill="#5a3418" opacity=".85"/><path d="${grain}" stroke="#4a2a12" stroke-width="1" fill="none" opacity=".75"/><path d="${tip}" fill="#f6e2b8"/></g>`;
}

/** A rough rock outline round (cx, cy) (seeded bumps). */
function rock(cx, cy, r, seed, n = 20) {
  const R = rnd(seed), pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, k = r * (0.92 + R() * 0.12 + 0.04 * Math.sin(a * 3 + seed));
    pts.push(`${f(cx + Math.cos(a) * k)},${f(cy + Math.sin(a) * k)}`);
  }
  return `M${pts.join('L')}Z`;
}

/** A meteor falling toward the bottom left: the heat trail behind it, the rock, its glowing lower-left face. */
function meteor(id, cx, cy, r, seed, craters = true) {
  const dx = 0.62, dy = -0.78, nx = -dy, ny = dx, L = r * 3.4; // (dx, dy) = back along the trail
  const trail = `M${f(cx + nx * r)},${f(cy + ny * r)}L${f(cx + dx * L + nx * r * 0.35)},${f(cy + dy * L + ny * r * 0.35)}L${f(cx + dx * L - nx * r * 0.35)},${f(cy + dy * L - ny * r * 0.35)}L${f(cx - nx * r)},${f(cy - ny * r)}Z`;
  const body = rock(cx, cy, r, seed);
  const R = rnd(seed + 7);
  let pits = '', cracks = '';
  if (craters) {
    for (let i = 0; i < 5; i++) {
      const a = R() * Math.PI * 2, q = R() * r * 0.6, s = r * (0.09 + R() * 0.1), x = cx + Math.cos(a) * q, y = cy + Math.sin(a) * q;
      pits += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(s)}" fill="#1c1210"/><path d="M${f(x - s)},${f(y + s * 0.2)}A${f(s)},${f(s)} 0 0,0 ${f(x + s)},${f(y + s * 0.2)}" stroke="#8a6a5a" stroke-width=".9" fill="none"/>`;
    }
    // molten fissures across the leading face
    const c = [[-0.6, 0.3, -0.2, 0.05, 0.15, 0.4, 0.05, 0.75], [-0.25, -0.3, 0.05, -0.1, 0.4, -0.2], [-0.75, -0.05, -0.45, 0.55]];
    cracks = c.map((p) => `M${p.map((v, i) => f(i % 2 ? cy + v * r : cx + v * r)).reduce((s, v, i) => s + (i % 2 ? `,${v}` : `${i ? 'L' : ''}${v}`), '')}`).join('');
    cracks = `<path d="${cracks}" stroke="#ff5a10" stroke-width="3.2" fill="none" opacity=".35" stroke-linejoin="round"/><path d="${cracks}" stroke="#ffc450" stroke-width="1.3" fill="none" stroke-linejoin="round"/>`;
  }
  return `<path d="${trail}" fill="url(#mr-trail)"/><circle cx="${f(cx - r * 0.25)}" cy="${f(cy + r * 0.3)}" r="${f(r * 1.45)}" fill="url(#mr-halo)"/>
    <clipPath id="${id}"><path d="${body}"/></clipPath><path d="${body}" fill="url(#mr-rock)" stroke="#0e0806" stroke-width="2"/>
    <g clip-path="url(#${id})">${pits}${cracks}<rect x="${f(cx - r * 1.2)}" y="${f(cy - r * 1.2)}" width="${f(r * 2.4)}" height="${f(r * 2.4)}" fill="url(#mr-hot)"/></g>`;
}

/** A wind stroke: a tapered arc (a thick faint pass under a thin bright one). */
const gust = (d, w, o = 0.85) => `<path d="${d}" stroke="#9fb8ff" stroke-width="${w * 2.2}" opacity="${o * 0.25}"/><path d="${d}" stroke="#eef3ff" stroke-width="${w}" opacity="${o}"/>`;

export const MADARA_ICONS = {
  // Q: Great Fire Annihilation, a sea of fire rolling over the horizon, Madara small before it
  fire: `<defs><linearGradient id="mq-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#120203"/><stop offset=".45" stop-color="#5a0e06"/><stop offset=".7" stop-color="#c0360a"/><stop offset="1" stop-color="#ff8a1a"/></linearGradient>
    <radialGradient id="mq-heat" cx=".6" cy=".95" r=".7"><stop offset="0" stop-color="#fff2b0" stop-opacity=".85"/><stop offset=".5" stop-color="#ffb030" stop-opacity=".35"/><stop offset="1" stop-color="#ff6a10" stop-opacity="0"/></radialGradient></defs>
    <rect width="100" height="100" fill="url(#mq-sky)"/>
    <path d="${flameRow(21, 102, [4, 20, 36, 52, 68, 84, 100], [58, 76, 64, 84, 70, 80, 60], 9)}" fill="#8a1406" stroke="#2a0402" stroke-width="1.6"/>
    <path d="${flameRow(22, 102, [10, 28, 46, 64, 82, 98], [46, 58, 66, 56, 64, 48], 7)}" fill="#e2400c" stroke="#5a0c04" stroke-width="1.3"/>
    <path d="${flameRow(23, 102, [2, 20, 40, 58, 76, 94], [30, 40, 46, 38, 44, 32], 5)}" fill="#ff9a1e"/>
    <path d="${flameRow(24, 104, [12, 32, 52, 70, 90], [18, 24, 26, 22, 20], 4)}" fill="#ffe06a"/>
    <rect width="100" height="100" fill="url(#mq-heat)"/>
    <g fill="#ffe7a0"><circle cx="22" cy="20" r="1.3"/><circle cx="60" cy="12" r="1.1"/><circle cx="84" cy="24" r="1.4"/><circle cx="44" cy="28" r=".9"/><circle cx="74" cy="8" r=".8"/></g>
    ${madaraFigure(19, 100, 0.62, '#ffb040')}`,
  // E: Wood Release: Cutting Technique, a line of stakes tearing out of the earth
  stakes: `<defs><radialGradient id="me-bg" cx=".6" cy=".2" r=".9"><stop offset="0" stop-color="#d6e39a"/><stop offset=".45" stop-color="#5f7a34"/><stop offset="1" stop-color="#16200c"/></radialGradient>
    <linearGradient id="me-wood" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#e6b87a"/><stop offset=".55" stop-color="#b07a44"/><stop offset="1" stop-color="#7a4a24"/></linearGradient></defs>
    <rect width="100" height="100" fill="url(#me-bg)"/>
    <path d="M0 74Q30 62 62 62T100 56V100H0Z" fill="#2e1c10"/><path d="M0 84Q40 72 100 66V100H0Z" fill="#1c1008"/>
    ${stake(92, 62, 18, 3, 4)}${stake(80, 67, 26, 4, 6)}${stake(64, 75, 38, 5.2, 9)}${stake(9, 99, 30, 4.6, -12)}${stake(44, 86, 50, 6.6, 13)}${stake(32, 98, 34, 5, 34)}${stake(20, 100, 64, 8.4, 19)}
    <g fill="#3e2616" stroke="#120904" stroke-width="1"><path d="M8 96l6-5 5 3-2 5z"/><path d="M34 86l5-3 3 3-4 3z"/><path d="M56 78l4-2 2 3-4 1z"/><path d="M27 92l4-1 1 3-4 1z"/></g>
    <g fill="#e8d8b0" opacity=".55"><circle cx="30" cy="74" r="1.2"/><circle cx="54" cy="58" r="1"/><circle cx="12" cy="70" r=".9"/><circle cx="70" cy="50" r=".8"/></g>`,
  // G: Uchiha Return, the gunbai (black rim, cream face, three red tomoe) in a wind barrier, a shuriken glancing off
  gunbai: `<defs><radialGradient id="mg-bg" cx=".45" cy=".42" r=".75"><stop offset="0" stop-color="#5a6ee8"/><stop offset=".5" stop-color="#1c2466"/><stop offset="1" stop-color="#05060f"/></radialGradient>
    <radialGradient id="mg-face" cx=".4" cy=".35"><stop offset="0" stop-color="#fffaf0"/><stop offset=".75" stop-color="#eee2c6"/><stop offset="1" stop-color="#c8b690"/></radialGradient></defs>
    <rect width="100" height="100" fill="url(#mg-bg)"/>
    <g fill="none" stroke-linecap="round">${gust('M10 70C4 44 22 16 52 12', 2.4)}${gust('M88 30C96 56 80 84 50 90', 2.4)}${gust('M18 84C10 74 8 62 10 54', 1.4, 0.6)}</g>
    <g transform="rotate(-18 50 46)">
      <path d="M46.5 66L53.5 66L54.5 97L45.5 97Z" fill="#1c1210" stroke="#050304" stroke-width="1.6"/><path d="M45.8 74H54.2M45.6 81H54.4M45.4 88H54.6" stroke="#5a3a26" stroke-width="2"/>
      <path d="M50 12C75 12 83 32 81 45C79 59 63 68 55 71L45 71C37 68 21 59 19 45C17 32 25 12 50 12Z" fill="#0c0b12" stroke="#000" stroke-width="1.5"/>
      <path d="M50 18C70 18 76 34 75 44C73.5 55 61 62 54 65L46 65C39 62 26.5 55 25 44C24 34 30 18 50 18Z" fill="url(#mg-face)"/>
      <g fill="#b8101a"><path transform="translate(38 31) rotate(-40) scale(.78)" d="${TOMOE}"/><path transform="translate(63 31) rotate(80) scale(.78)" d="${TOMOE}"/><path transform="translate(50 53) rotate(200) scale(.78)" d="${TOMOE}"/></g>
      <path d="M30 26C35 20 42 18 48 18" stroke="#fff" stroke-width="2" fill="none" opacity=".7" stroke-linecap="round"/></g>
    <g fill="none" stroke-linecap="round">${gust('M24 92C44 100 74 94 90 72', 1.8)}${gust('M6 40C8 28 14 18 22 12', 1.3, 0.55)}</g>
    <g transform="translate(84 17) rotate(25)"><path d="M0-7L1.6-1.6L7 0L1.6 1.6L0 7L-1.6 1.6L-7 0L-1.6-1.6Z" fill="#d8dee8" stroke="#1a1e28" stroke-width="1"/></g>
    <path d="M70 26l4 3M76 22l3 4M72 21l1 3" stroke="#fff6c0" stroke-width="1.4" stroke-linecap="round"/><circle cx="73" cy="27" r="2.6" fill="#fff6c0" opacity=".9"/>`,
  // R: Tengai Shinsei, a meteor as big as the sky falling over the horizon, a second one behind it
  meteor: `<defs><linearGradient id="mr-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0c0616"/><stop offset=".45" stop-color="#3a1438"/><stop offset=".78" stop-color="#b0402a"/><stop offset="1" stop-color="#ffb050"/></linearGradient>
    <linearGradient id="mr-trail" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff7a20" stop-opacity="0"/><stop offset=".6" stop-color="#ff8a2a" stop-opacity=".55"/><stop offset="1" stop-color="#ffe08a" stop-opacity=".95"/></linearGradient>
    <radialGradient id="mr-halo"><stop offset=".55" stop-color="#ff9a3a" stop-opacity=".55"/><stop offset="1" stop-color="#ff5a10" stop-opacity="0"/></radialGradient>
    <radialGradient id="mr-rock" cx=".62" cy=".32"><stop offset="0" stop-color="#7a5e52"/><stop offset=".6" stop-color="#3e2c26"/><stop offset="1" stop-color="#1a110e"/></radialGradient>
    <linearGradient id="mr-hot" x1="0" y1="1" x2=".62" y2=".3"><stop offset="0" stop-color="#fff0a0" stop-opacity=".95"/><stop offset=".22" stop-color="#ff9a2a" stop-opacity=".75"/><stop offset=".5" stop-color="#e0400c" stop-opacity=".2"/><stop offset=".62" stop-color="#e0400c" stop-opacity="0"/></linearGradient></defs>
    <rect width="100" height="100" fill="url(#mr-sky)"/>
    <g fill="#fff" opacity=".7"><circle cx="12" cy="10" r=".7"/><circle cx="30" cy="6" r=".5"/><circle cx="8" cy="30" r=".6"/><circle cx="92" cy="80" r=".5"/></g>
    ${meteor('mr-c2', 24, 30, 8, 5, false)}${meteor('mr-c1', 60, 40, 29, 2)}
    <path d="M0 86Q14 80 26 84T52 82T78 85T100 80V100H0Z" fill="#12080c"/><path d="M0 92Q30 88 60 92T100 90V100H0Z" fill="#070305"/>
    <path d="M18 84L22 76L24 84M70 84L73 78L75 84M84 82L86 77L88 82" fill="#12080c"/>`,
};
