// The Uchiha HUD theme (a character's `hud: 'uchiha'`; Itachi's): a Sharingan medallion for the portrait (three
// tomoe turning, the Mangekyō taking over while the ultimate is ready), black flames with a crimson rim streaming
// off it along the health bar, and the kit's skill icons painted for it. hud.css (`#hud.t-uchiha`) frames the bar
// and the icons. Every animated piece is its own <svg> element moved by CSS transform/opacity only: the compositor
// runs them (no repaint, no main-thread work per frame).

const f = (n) => n.toFixed(1);

/** A seeded 0..1 generator (the art is the same on every load). */
function rnd(seed) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}

// Itachi's Mangekyō: three curved blades round the pupil, in a 100 box centred on (50, 50), iris radius 34
export const MANGEKYO = 'M52.6,54.7L52.6,57.7L51.5,60.7L49.4,63.5L46.3,65.8L42.4,67.3L37.8,67.8L32.8,67.2L27.7,65.3L29.0,67.0L37.3,70.7L45.5,71.1L52.5,68.7L57.3,64.4L59.8,59.3L59.9,54.4L58.1,50.6L55.2,48.6ZM44.6,49.9L42.1,48.4L40.0,46.0L38.6,42.7L38.2,38.9L38.8,34.8L40.6,30.5L43.7,26.5L47.9,23.1L45.8,23.3L38.4,28.7L33.9,35.6L32.5,42.8L33.8,49.1L37.1,53.8L41.3,56.3L45.4,56.7L48.6,55.2ZM52.8,45.4L55.3,43.9L58.5,43.3L62.0,43.8L65.5,45.3L68.8,47.9L71.5,51.6L73.5,56.3L74.4,61.6L75.2,59.7L74.3,50.6L70.5,43.3L65.0,38.5L58.8,36.4L53.2,36.9L48.9,39.3L46.5,42.7L46.2,46.2Z';

// one tomoe, its head at the origin, the tail trailing along the orbit (-x, bending toward the eye's centre)
const TOMOE = 'M0,-5.6A5.6,5.6 0 1,1 -5.6,0Q-8.6,4.6 -15.5,4.6Q-7.6,-3.4 0,-5.6Z';

// ---- the portrait: a Sharingan

/** The medallion's layers (inside .h-eye, a 90 px circle): iris, turning tomoe, the Mangekyō, glow, gloss. */
export function sharingan() {
  let fibres = '';
  for (let i = 0; i < 56; i++) {
    const a = (i / 56) * Math.PI * 2, r0 = 11 + (i % 3) * 2, r1 = i % 2 ? 44 : 38;
    fibres += `M${f(50 + Math.cos(a) * r0)},${f(50 + Math.sin(a) * r0)}L${f(50 + Math.cos(a) * r1)},${f(50 + Math.sin(a) * r1)}`;
  }
  const tomoe = [0, 120, 240].map((d) => `<path transform="rotate(${d} 50 50) translate(50 23)" d="${TOMOE}"/>`).join('');
  return `
    <svg class="u-eye-base" viewBox="0 0 100 100"><defs><radialGradient id="ue-iris"><stop offset="0" stop-color="#ff6a44"/><stop offset=".42" stop-color="#e8141c"/><stop offset=".8" stop-color="#a0040c"/><stop offset="1" stop-color="#3c0004"/></radialGradient></defs>
      <circle cx="50" cy="50" r="50" fill="#050000"/><circle cx="50" cy="50" r="47" fill="url(#ue-iris)"/>
      <path d="${fibres}" stroke="#5a0008" stroke-width=".7" opacity=".4"/><circle cx="50" cy="50" r="13" fill="none" stroke="#ff7a5a" stroke-width="1.2" opacity=".35"/></svg>
    <svg class="u-eye-tomoe" viewBox="0 0 100 100"><circle cx="50" cy="50" r="27" fill="none" stroke="#300003" stroke-width="1.6" opacity=".9"/>
      <g fill="#070001">${tomoe}<circle cx="50" cy="50" r="8.5"/></g></svg>
    <svg class="u-eye-mk" viewBox="0 0 100 100"><g transform="translate(50 50) scale(1.34) translate(-50 -50)" fill="#070001"><path d="${MANGEKYO}"/><circle cx="50" cy="50" r="6.5"/></g>
      <circle cx="50" cy="50" r="45.5" fill="none" stroke="#070001" stroke-width="2.4"/></svg>
    <i class="u-eye-glow"></i>
    <svg class="u-eye-gloss" viewBox="0 0 100 100"><defs><radialGradient id="ue-vig"><stop offset=".7" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".72"/></radialGradient></defs>
      <circle cx="50" cy="50" r="47" fill="url(#ue-vig)"/><ellipse cx="35" cy="27" rx="13" ry="6.5" fill="#fff" opacity=".3" transform="rotate(-32 35 27)"/><circle cx="66" cy="72" r="2.4" fill="#fff" opacity=".22"/></svg>`;
}

/** The portrait's ring (in .h-port-frame's 120 box: the portrait's edge is at r 42): black, crimson hairlines. */
export const FRAME = `<defs><linearGradient id="ue-ring" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff5a44"/><stop offset=".5" stop-color="#b80c16"/><stop offset="1" stop-color="#ff3a2e"/></linearGradient></defs>
  <circle cx="60" cy="60" r="47.6" fill="none" stroke="#070102" stroke-width="11"/><circle cx="60" cy="60" r="42.9" fill="none" stroke="url(#ue-ring)" stroke-width="1.5"/>
  <circle cx="60" cy="60" r="53.4" fill="none" stroke="url(#ue-ring)" stroke-width="1.3"/>`;

// ---- the black flames round the portrait

// the flames' box (px, positioned by hud.css): the portrait's centre at (100, 104), the bar from x 140, y 85-123
const W = 460, H = 208, CX = 100, CY = 104;

/** Flame tongues licking off the circle (cx, cy, r) between angles a0..a1 (radians), bent by the wind (1, -0.25). */
function crown(seed, n, r, len, a0, a1) {
  const R = rnd(seed);
  let d = '';
  for (let i = 0; i < n; i++) {
    const a = a0 + ((i + 0.2 + R() * 0.6) / n) * (a1 - a0), w = 0.22 + R() * 0.16, L = len * (0.6 + R() * 0.6);
    const ox = Math.cos(a), oy = Math.sin(a), wx = 0.42, wy = -0.2;
    const x1 = CX + Math.cos(a - w) * r, y1 = CY + Math.sin(a - w) * r, x2 = CX + Math.cos(a + w) * r, y2 = CY + Math.sin(a + w) * r;
    const bend = 0.25 + R() * 0.35; // every tip curls the same way (with the wind round the circle)
    const tx = (x1 + x2) / 2 + (ox + wx - oy * bend) * L, ty = (y1 + y2) / 2 + (oy + wy + ox * bend) * L;
    // the edges bow out below the tip and pinch into it: a flame, not a spike
    d += `M${f(x1)},${f(y1)}C${f(x1 + ox * L * 0.45)},${f(y1 + oy * L * 0.45)} ${f(tx - (ox + wx) * L * 0.1 - oy * L * 0.18)},${f(ty - (oy + wy) * L * 0.1 + ox * L * 0.18)} ${f(tx)},${f(ty)}`;
    d += `C${f(tx - (ox + wx) * L * 0.25 + oy * L * 0.1)},${f(ty - (oy + wy) * L * 0.25 - ox * L * 0.1)} ${f(x2 + ox * L * 0.5 + wx * L * 0.2)},${f(y2 + oy * L * 0.5 + wy * L * 0.2)} ${f(x2)},${f(y2)}Z`;
  }
  return d;
}

/** A closed outline through points, smoothed (quadratic curves through the midpoints: no corners but the tips). */
function smooth(pts) {
  const m = (a, b) => `${f((a[0] + b[0]) / 2)},${f((a[1] + b[1]) / 2)}`;
  let d = `M${m(pts[0], pts[1])}`;
  for (let i = 1; i <= pts.length; i++) d += `Q${f(pts[i % pts.length][0])},${f(pts[i % pts.length][1])} ${m(pts[i % pts.length], pts[(i + 1) % pts.length])}`;
  return `${d}Z`;
}

/** A streamer of flame blown along the bar from (x0, y0): tapering, wavering, licks peeling off its outer edge
 *  (side -1 = the top edge, 1 = the bottom). */
function streamer(seed, x0, y0, L, th, amp, lift, side, licks) {
  const top = [], bot = [], N = 40;
  for (let i = 0; i <= N; i++) {
    const t = i / N, x = x0 + t * L, y = y0 + Math.sin(t * 4.5 + seed) * amp * t + lift * t * t;
    const hw = th * Math.pow(1 - t, 0.8) * (1 + 0.14 * Math.sin(t * 8 + seed * 2.3));
    // a lick: a saw-tooth hump (slow rise, sharp fall) leaning back along the wind, like a flame tip torn off
    const ph = (t * 5 + seed * 0.37) % 1, lick = licks * Math.pow(ph, 2.2) * (1 - t * 0.6) * (ph < 0.92 ? 1 : (1 - ph) / 0.08);
    top.push([x + (side < 0 ? lick * 1.3 : 0), y - hw - (side < 0 ? lick : 0)]);
    bot.push([x + (side > 0 ? lick * 1.3 : 0), y + hw + (side > 0 ? lick : 0)]);
  }
  return smooth([...top, ...bot.reverse()]);
}

/** Small torn-off flames drifting away along the bar (animated by CSS). */
function shards(seed, n, y0, y1, x0, x1) {
  const R = rnd(seed);
  let d = '';
  for (let i = 0; i < n; i++) {
    const x = x0 + R() * (x1 - x0), y = y0 + R() * (y1 - y0), s = 3 + R() * 5;
    d += `M${f(x)},${f(y + s * 0.4)}Q${f(x + s * 0.9)},${f(y - s * 0.2)} ${f(x + s * 2.6)},${f(y - s * 0.9)}Q${f(x + s * 1.1)},${f(y + s * 0.5)} ${f(x + s * 0.2)},${f(y + s)}Z`;
  }
  return d;
}

/** One flame layer: a soft crimson glow, the rim, the black body on top (the rim shows only round the outside). */
function layer(cls, d, rim = '#b00c16') {
  return `<svg class="u-fl ${cls}" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" fill="none" stroke-linejoin="round">
    <path d="${d}" stroke="#ff1e2a" stroke-width="9" opacity=".12"/><path d="${d}" stroke="#ff2a30" stroke-width="5" opacity=".25"/>
    <path d="${d}" stroke="${rim}" stroke-width="2.6"/><path d="${d}" fill="#060102"/></svg>`;
}

/** Every flame layer, back to front (inside .h-theme). */
export function uchihaFlames() {
  const disc = `M${CX - 50},${CY}a50,50 0 1,0 100,0a50,50 0 1,0 -100,0Z`;
  const back = disc + crown(11, 9, 50, 34, Math.PI * 0.62, Math.PI * 1.9) +
    streamer(1.3, 112, 74, 270, 14, 6, -12, -1, 12) + streamer(4.1, 124, 84, 180, 8, 4, 3, -1, 8) +
    streamer(2.2, 112, 134, 250, 12, 5, 9, 1, 10) + streamer(5.4, 124, 127, 150, 7, 3, -3, 1, 6);
  const front = disc + crown(23, 7, 50, 26, Math.PI * 0.72, Math.PI * 1.85) + streamer(3.7, 118, 79, 200, 9, 7, -16, -1, 13) + streamer(6.6, 116, 131, 180, 8, 4, 11, 1, 9);
  return layer('u-fl-a', back) + layer('u-fl-b', front, '#d0141c') + layer('u-fl-c', shards(5, 7, 60, 82, 250, 360)) + layer('u-fl-d', shards(9, 6, 126, 146, 230, 330));
}

// ---- the kit's icons (100 box; the circle clips them)

/** A fireball flying up-right, its flame tail trailing down-left. */
function comet(x, y, r, L, seed) {
  const dx = Math.cos(-0.72), dy = Math.sin(-0.72), nx = -dy, ny = dx, N = 22;
  const a = [], b = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N, cx = x - dx * t * L, cy = y - dy * t * L;
    const hw = r * 1.05 * Math.pow(1 - t, 1.1) * (1 + 0.3 * Math.sin(t * 16 + seed));
    const hb = r * 1.05 * Math.pow(1 - t, 1.1) * (1 + 0.3 * Math.sin(t * 13 + seed * 1.7 + 2));
    a.push(`${f(cx + nx * hw)},${f(cy + ny * hw)}`);
    b.unshift(`${f(cx - nx * hb)},${f(cy - ny * hb)}`);
  }
  return `<path d="M${a.join('L')}L${b.join('L')}Z" fill="url(#uq-tail)"/><circle cx="${x}" cy="${y}" r="${f(r * 1.9)}" fill="url(#uq-glow)"/><circle cx="${x}" cy="${y}" r="${r}" fill="url(#uq-ball)"/>`;
}

/** A crow seen from below, wings up: the right half's outline, mirrored (unit: wingspan ~100). */
const CROW_HALF = [[0, -16], [3, -15], [4.5, -12], [4, -9], [9, -10], [20, -18], [32, -28], [42, -36], [51, -41], [46, -33], [50, -30], [42, -25], [46, -21], [37, -16], [39, -12], [30, -9], [20, -4], [10, 0], [7, 6], [5, 12], [9, 21], [4, 19], [3, 23], [0, 21]];
function crow(x, y, s, rot, flip = 1, eye = false) {
  const pts = [...CROW_HALF, ...CROW_HALF.slice(1, -1).reverse().map(([px, py]) => [-px, py])];
  const d = `M${pts.map(([px, py]) => `${f(px)},${f(py)}`).join('L')}ZM-3,-14.5L-10.5,-12.6L-3,-11Z`;
  return `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${s * flip} ${s})"><path d="${d}"/>${eye ? '<circle cx="-1.3" cy="-13" r="1.3" fill="#ff1a1a"/>' : ''}</g>`;
}

/** A row of flames rising from the bottom edge: tongues at xs with heights hs, their tips leaning by lean. */
function flameRow(seed, base, xs, hs, lean) {
  const R = rnd(seed);
  let d = `M-5,105L-5,${base}`;
  xs.forEach((x, i) => {
    const h = hs[i], w = 9 + R() * 5, l = lean + (R() - 0.5) * 6;
    d += `Q${f(x - w * 0.9)},${f(base - h * 0.35)} ${f(x - w * 0.5)},${f(base - h * 0.55)}Q${f(x - w * 0.2 + l * 0.3)},${f(base - h * 0.85)} ${f(x + l)},${f(base - h)}`;
    d += `Q${f(x + w * 0.1 + l * 0.2)},${f(base - h * 0.6)} ${f(x + w * 0.6)},${f(base - h * 0.4)}Q${f(x + w)},${f(base - h * 0.2)} ${f(x + w * 1.1)},${f(base - h * 0.05)}`;
  });
  return `${d}L105,${base}L105,105Z`;
}

export const ITACHI_ICONS = {
  // Q: Phoenix Sage Fire, a volley of fireballs
  fireballs: `<defs><radialGradient id="uq-bg" cx=".3" cy=".8" r=".95"><stop offset="0" stop-color="#8a2208"/><stop offset=".5" stop-color="#3a0804"/><stop offset="1" stop-color="#110203"/></radialGradient>
    <radialGradient id="uq-ball"><stop offset="0" stop-color="#fffdf0"/><stop offset=".3" stop-color="#ffe98a"/><stop offset=".62" stop-color="#ff9420"/><stop offset=".88" stop-color="#e0400c"/><stop offset="1" stop-color="#a01806"/></radialGradient>
    <radialGradient id="uq-glow"><stop offset=".45" stop-color="#ffb040" stop-opacity=".6"/><stop offset="1" stop-color="#ff5a10" stop-opacity="0"/></radialGradient>
    <linearGradient id="uq-tail" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd35a"/><stop offset=".3" stop-color="#ff7a14" stop-opacity=".95"/><stop offset=".7" stop-color="#c82a08" stop-opacity=".6"/><stop offset="1" stop-color="#6a0a04" stop-opacity="0"/></linearGradient></defs>
    <rect width="100" height="100" fill="url(#uq-bg)"/>${comet(25, 27, 5.5, 22, 4)}${comet(76, 66, 7, 28, 2)}${comet(36, 60, 9, 34, 7)}${comet(64, 34, 12.5, 46, 1)}
    <g fill="#ffd35a"><circle cx="18" cy="48" r="1.3"/><circle cx="52" cy="84" r="1.1"/><circle cx="86" cy="44" r="1.2"/><circle cx="48" cy="16" r=".9"/><circle cx="12" cy="72" r=".9"/></g>`,
  // E: Tsukuyomi, the bound figure on the cross before the Mangekyō moon
  tsukuyomi: `<defs><linearGradient id="ue-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#170003"/><stop offset=".55" stop-color="#6a040c"/><stop offset="1" stop-color="#c0161a"/></linearGradient>
    <radialGradient id="ue-moon"><stop offset="0" stop-color="#ff6a48"/><stop offset=".68" stop-color="#d8141c"/><stop offset=".94" stop-color="#7a040a"/><stop offset="1" stop-color="#ff5a40"/></radialGradient></defs>
    <rect width="100" height="100" fill="url(#ue-sky)"/><circle cx="50" cy="42" r="40" fill="#ff3a2a" opacity=".16"/><circle cx="50" cy="42" r="31" fill="url(#ue-moon)"/>
    <g transform="translate(50 42) scale(.88) translate(-50 -50)" fill="#1a0003" opacity=".9"><path d="${MANGEKYO}"/></g>
    <path d="M0 82Q50 73 100 82V100H0Z" fill="#0a0002"/>
    <g stroke="#e8d8d8" stroke-width="1.3" stroke-linecap="round"><path d="M22 84L33 66M80 85L68 64M14 90L20 78"/></g><g fill="#0a0002"><rect x="31" y="66.5" width="4.2" height="2" transform="rotate(-58 33 67.5)"/><rect x="66" y="64" width="4.2" height="2" transform="rotate(58 68 65)"/></g>
    <g fill="#040001" stroke="#ff4a3a" stroke-width=".9" stroke-opacity=".55" paint-order="stroke"><path d="M47 30H53V86H47Z M22 36.5H78V41.5H22Z"/>
      <circle cx="50" cy="31.5" r="4.6"/><path d="M42.5 37H57.5L55 58H45Z M45 57H55L52.5 78H47.5Z"/></g>
    <path d="M42 39.5H58M44.5 50H55.5M46 66H54" stroke="#8a0a10" stroke-width="1.2"/>`,
  // G: Crow Clone Escape, a burst of crows against the moon
  crows: `<defs><radialGradient id="ug-bg" cx=".62" cy=".3" r=".85"><stop offset="0" stop-color="#5a5f8a"/><stop offset=".5" stop-color="#23263e"/><stop offset="1" stop-color="#0a0b14"/></radialGradient>
    <radialGradient id="ug-moon"><stop offset="0" stop-color="#fbf8ff"/><stop offset=".8" stop-color="#d9d3ea"/><stop offset="1" stop-color="#b8b0d0"/></radialGradient></defs>
    <rect width="100" height="100" fill="url(#ug-bg)"/><circle cx="64" cy="31" r="27" fill="#e8e2ff" opacity=".12"/><circle cx="64" cy="31" r="19" fill="url(#ug-moon)"/>
    <g fill="#07080c">${crow(44, 58, 0.66, -12, 1, true)}${crow(80, 72, 0.24, 18, -1)}${crow(20, 30, 0.2, -24)}${crow(84, 16, 0.15, 10, -1)}${crow(16, 78, 0.17, -30)}${crow(36, 18, 0.12, 6, -1)}
      <path d="M72 88q4-6 10-6-3 5-10 6zM10 55q5-3 10-1-5 3-10 1zM90 46q-2-5 1-9 1 5-1 9z"/></g>`,
  // R: Amaterasu, black flames with a crimson rim under the Mangekyō
  amaterasu: `<defs><radialGradient id="ua-bg" cx=".5" cy=".3" r=".9"><stop offset="0" stop-color="#5a0620"/><stop offset=".55" stop-color="#22020c"/><stop offset="1" stop-color="#070003"/></radialGradient>
    <radialGradient id="ua-iris"><stop offset="0" stop-color="#ff3a3a"/><stop offset=".75" stop-color="#a0040e"/><stop offset="1" stop-color="#3a0006"/></radialGradient></defs>
    <rect width="100" height="100" fill="url(#ua-bg)"/><circle cx="50" cy="34" r="24" fill="url(#ua-iris)" opacity=".9"/>
    <g transform="translate(50 34) scale(.7) translate(-50 -50)" fill="#080002"><path d="${MANGEKYO}"/><circle cx="50" cy="50" r="6.5"/></g>
    <g fill="none" stroke-linejoin="round"><path d="${flameRow(3, 100, [8, 30, 52, 74, 94], [40, 58, 66, 52, 38], 6)}" stroke="#ff2a6a" stroke-width="6" opacity=".25"/></g>
    <path d="${flameRow(3, 100, [8, 30, 52, 74, 94], [40, 58, 66, 52, 38], 6)}" fill="#2a0414" stroke="#ff3a78" stroke-width="1.6"/>
    <path d="${flameRow(8, 102, [0, 20, 42, 62, 84, 102], [26, 40, 48, 42, 34, 22], -4)}" fill="#030002" stroke="#c0104a" stroke-width="1.4"/>`,
};
