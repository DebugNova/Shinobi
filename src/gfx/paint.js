// Hand-painted-looking textures, generated at load on canvases (no download): soft value noise for colour
// variation, brush dabs, and pen strokes. Each returns a THREE.CanvasTexture (sRGB, repeat wrapping, mipmapped).
import * as THREE from 'three';
import { mulberry32 } from '../shared/rng.js';

function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function texture(c, { repeat = true, srgb = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

/** Tileable value noise field [0,1] of size n (periodic). */
function noiseField(n, cells, rng) {
  const g = new Float32Array(cells * cells);
  for (let i = 0; i < g.length; i++) g[i] = rng();
  const out = new Float32Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const fx = (x / n) * cells, fy = (y / n) * cells;
      const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j;
      const su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
      const a = g[(j % cells) * cells + (i % cells)], b = g[(j % cells) * cells + ((i + 1) % cells)];
      const c = g[((j + 1) % cells) * cells + (i % cells)], d = g[((j + 1) % cells) * cells + ((i + 1) % cells)];
      out[y * n + x] = a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv;
    }
  }
  return out;
}

function fbmField(n, rng, oct = 4, base = 4) {
  const out = new Float32Array(n * n);
  let amp = 0.5, tot = 0;
  for (let o = 0; o < oct; o++) {
    const f = noiseField(n, base << o, rng);
    for (let i = 0; i < out.length; i++) out[i] += f[i] * amp;
    tot += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= tot;
  return out;
}

const hex = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

/** Fills a canvas from a colour ramp over an fbm field (cel-ish: the ramp is quantised a little). */
function paintField(ctx, n, rng, ramp, { oct = 4, base = 4, steps = 6 } = {}) {
  const f = fbmField(n, rng, oct, base);
  const img = ctx.createImageData(n, n);
  for (let i = 0; i < n * n; i++) {
    let t = Math.min(0.999, Math.max(0, (f[i] - 0.25) * 2));
    t = Math.floor(t * steps) / (steps - 1) * 0.7 + t * 0.3; // soft posterisation: painted, not photographic
    const k = t * (ramp.length - 1), j = Math.floor(k);
    const c = mix(ramp[j], ramp[Math.min(ramp.length - 1, j + 1)], k - j);
    img.data.set([c[0], c[1], c[2], 255], i * 4);
  }
  ctx.putImageData(img, 0, 0);
}

/** Wrapped drawing: a stroke near an edge is drawn again on the other side (tileable). */
function wrapped(ctx, n, x, y, draw) {
  for (const dx of [-n, 0, n]) for (const dy of [-n, 0, n]) {
    if (x + dx < -n * 0.3 || x + dx > n * 1.3 || y + dy < -n * 0.3 || y + dy > n * 1.3) continue;
    ctx.save();
    ctx.translate(x + dx, y + dy);
    draw();
    ctx.restore();
  }
}

export const Paint = {
  /** Grass: saturated greens with lighter brush dabs and a few dark blade strokes. */
  grass(seed = 1) {
    const n = 512, c = canvas(n), x = c.getContext('2d'), r = mulberry32(seed);
    paintField(x, n, r, [hex(0x3f8a2c), hex(0x4f9f33), hex(0x62b33c), hex(0x74c246)], { base: 3 });
    for (let i = 0; i < 900; i++) {
      const px = r() * n, py = r() * n, s = 3 + r() * 7;
      wrapped(x, n, px, py, () => {
        x.rotate(-0.4 + r() * 0.8);
        x.fillStyle = r() < 0.5 ? 'rgba(150,215,90,0.35)' : 'rgba(40,100,30,0.3)';
        x.fillRect(-s * 0.15, -s, s * 0.3, s * 2);
      });
    }
    return texture(c);
  },

  /** Packed dirt: warm browns, pebbles, footprint-ish smudges. */
  dirt(seed = 2) {
    const n = 512, c = canvas(n), x = c.getContext('2d'), r = mulberry32(seed);
    paintField(x, n, r, [hex(0xb08857), hex(0xbd9463), hex(0xc9a16f), hex(0xd6b07c)], { base: 4 });
    for (let i = 0; i < 160; i++) {
      const px = r() * n, py = r() * n, s = 1.5 + r() * 3.5;
      wrapped(x, n, px, py, () => {
        x.fillStyle = r() < 0.5 ? 'rgba(120,85,50,0.45)' : 'rgba(235,212,165,0.5)';
        x.beginPath();
        x.ellipse(0, 0, s, s * 0.7, r() * 3, 0, Math.PI * 2);
        x.fill();
      });
    }
    return texture(c);
  },

  /** Bark: vertical ridged strokes, dark cracks (the hatching comes from the shader in shadow). */
  bark(seed = 3) {
    const n = 512, c = canvas(n), x = c.getContext('2d'), r = mulberry32(seed);
    paintField(x, n, r, [hex(0x5b3f2a), hex(0x6d4b31), hex(0x7f5a3a), hex(0x8f6843)], { base: 3 });
    x.lineCap = 'round';
    for (let i = 0; i < 160; i++) {
      const px = r() * n, len = 40 + r() * 160, w = 1 + r() * 3;
      let y = r() * n;
      wrapped(x, n, px, y, () => {
        x.strokeStyle = r() < 0.55 ? 'rgba(40,26,16,0.55)' : 'rgba(170,130,90,0.3)';
        x.lineWidth = w;
        x.beginPath();
        x.moveTo(0, 0);
        x.bezierCurveTo((r() - 0.5) * 12, len * 0.33, (r() - 0.5) * 12, len * 0.66, (r() - 0.5) * 8, len);
        x.stroke();
      });
    }
    // faint moss specks along the ridges (the big moss comes from the trees' vertex colours: tops of limbs, the foot;
    // round patches here read as green polka dots on a trunk)
    for (let i = 0; i < 70; i++) {
      const px = r() * n, py = r() * n, s = 2 + r() * 6;
      wrapped(x, n, px, py, () => {
        x.fillStyle = 'rgba(110,150,55,0.18)';
        x.beginPath();
        x.ellipse(0, 0, s, s * 3, 0, 0, Math.PI * 2);
        x.fill();
      });
    }
    return texture(c);
  },

  /**
   * Rock: neutral light grey (the cliffs' vertex colours paint the strata tints, the terrain cools it), fine
   * sediment lines running across (horizontal on a cliff face: the texture is mapped triplanar in world space) with a
   * pale edge under each, thin jagged cracks mostly downward with a highlight beside them, a few pits.
   */
  rock(seed = 4) {
    const n = 512, c = canvas(n), x = c.getContext('2d'), r = mulberry32(seed);
    paintField(x, n, r, [hex(0xa7a299), hex(0xafa9a0), hex(0xb7b1a7), hex(0xbfb9ae)], { base: 4, steps: 4 });
    x.lineCap = 'round';
    let y = 0;
    while (y < n) {
      y += 14 + r() * 26;
      const dark = r() < 0.7;
      for (let seg = 0; seg < 3; seg++) {
        const x0 = r() * n, len = 80 + r() * 260;
        wrapped(x, n, x0, y, () => {
          const wob = (r() - 0.5) * 6;
          x.strokeStyle = dark ? 'rgba(70,62,54,0.28)' : 'rgba(90,80,70,0.16)';
          x.lineWidth = 1 + r() * 1.4;
          x.beginPath();
          x.moveTo(0, 0);
          x.bezierCurveTo(len * 0.33, wob, len * 0.66, -wob, len, wob * 0.5);
          x.stroke();
          x.strokeStyle = 'rgba(245,240,230,0.2)';
          x.lineWidth = 1;
          x.beginPath();
          x.moveTo(0, 2);
          x.bezierCurveTo(len * 0.33, wob + 2, len * 0.66, 2 - wob, len, wob * 0.5 + 2);
          x.stroke();
        });
      }
    }
    for (let i = 0; i < 26; i++) {
      const px = r() * n, py = r() * n;
      wrapped(x, n, px, py, () => {
        const pts = [[0, 0]];
        let cx = 0, cy = 0;
        for (let k = 0; k < 5; k++) {
          cx += (r() - 0.5) * 16;
          cy += 8 + r() * 18;
          pts.push([cx, cy]);
        }
        x.strokeStyle = 'rgba(245,240,230,0.25)';
        x.lineWidth = 1.2;
        x.beginPath();
        pts.forEach(([a, b], k) => (k ? x.lineTo(a + 1.5, b) : x.moveTo(a + 1.5, b)));
        x.stroke();
        x.strokeStyle = 'rgba(55,46,40,0.6)';
        x.lineWidth = 1 + r() * 1.2;
        x.beginPath();
        pts.forEach(([a, b], k) => (k ? x.lineTo(a, b) : x.moveTo(a, b)));
        x.stroke();
      });
    }
    for (let i = 0; i < 90; i++) {
      const px = r() * n, py = r() * n, s2 = 1 + r() * 2.5;
      wrapped(x, n, px, py, () => {
        x.fillStyle = r() < 0.6 ? 'rgba(80,70,60,0.3)' : 'rgba(240,235,225,0.3)';
        x.beginPath();
        x.ellipse(0, 0, s2, s2 * 0.7, 0, 0, Math.PI * 2);
        x.fill();
      });
    }
    return texture(c);
  },

  /** Plaster: warm off-white with water stains toward the bottom. */
  plaster(seed = 5) {
    const n = 512, c = canvas(n), x = c.getContext('2d'), r = mulberry32(seed);
    paintField(x, n, r, [hex(0xd8cbb0), hex(0xe4d8bf), hex(0xeee3cc), hex(0xf5ecd9)], { base: 3, steps: 5 });
    for (let i = 0; i < 30; i++) {
      const px = r() * n, py = r() * n, s = 8 + r() * 28;
      wrapped(x, n, px, py, () => {
        x.fillStyle = 'rgba(160,140,110,0.14)';
        x.beginPath();
        x.ellipse(0, 0, s, s * 0.5, r(), 0, Math.PI * 2);
        x.fill();
      });
    }
    return texture(c);
  },

  /** Dark stained timber (beams, planks). */
  wood(seed = 6, light = false) {
    const n = 256, c = canvas(n), x = c.getContext('2d'), r = mulberry32(seed);
    paintField(x, n, r, light ? [hex(0x8a6340), hex(0x9c7249), hex(0xaf8356), hex(0xbd9161)] : [hex(0x3a2718), hex(0x46301e), hex(0x533924), hex(0x5f422a)], { base: 2 });
    for (let i = 0; i < 90; i++) {
      const py = r() * n;
      x.strokeStyle = light ? 'rgba(80,50,28,0.35)' : 'rgba(20,12,6,0.4)';
      x.lineWidth = 1;
      x.beginPath();
      x.moveTo(0, py);
      x.bezierCurveTo(n * 0.3, py + (r() - 0.5) * 6, n * 0.7, py + (r() - 0.5) * 6, n, py);
      x.stroke();
    }
    return texture(c);
  },

  /** Roof tiles: rows of curved tiles (u along the ridge, v down the slope). */
  tiles(seed = 7, base = 0x5a3a36) {
    const n = 256, c = canvas(n), x = c.getContext('2d'), r = mulberry32(seed);
    const b = hex(base);
    x.fillStyle = `rgb(${b})`;
    x.fillRect(0, 0, n, n);
    const rows = 8, cols = 8;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const w = n / cols, h = n / rows, px = i * w + (j % 2) * w * 0.5, py = j * h;
        const k = 0.85 + r() * 0.3;
        wrapped(x, n, px, py, () => {
          const g = x.createLinearGradient(0, 0, w, 0);
          g.addColorStop(0, `rgb(${b.map((v) => v * 0.7 * k)})`);
          g.addColorStop(0.5, `rgb(${b.map((v) => Math.min(255, v * 1.35 * k))})`);
          g.addColorStop(1, `rgb(${b.map((v) => v * 0.75 * k)})`);
          x.fillStyle = g;
          x.beginPath();
          x.roundRect(1, 0, w - 2, h * 1.05, [0, 0, w * 0.45, w * 0.45]);
          x.fill();
          x.strokeStyle = 'rgba(20,10,8,0.5)';
          x.lineWidth = 1.5;
          x.stroke();
        });
      }
    }
    return texture(c);
  },

  /** Stone paving / steps. */
  stone(seed = 8) {
    const n = 256, c = canvas(n), x = c.getContext('2d'), r = mulberry32(seed);
    paintField(x, n, r, [hex(0x8f8a80), hex(0x9e998e), hex(0xada89c), hex(0xbcb7aa)], { base: 3, steps: 4 });
    x.strokeStyle = 'rgba(60,55,48,0.55)';
    x.lineWidth = 2;
    for (let j = 0; j < 4; j++) {
      const y = (j / 4) * n;
      x.beginPath();
      x.moveTo(0, y);
      x.lineTo(n, y);
      x.stroke();
      for (let i = 0; i < 3; i++) {
        const xx = ((i + (j % 2) * 0.5) / 3) * n + (r() - 0.5) * 10;
        x.beginPath();
        x.moveTo(xx, y);
        x.lineTo(xx, y + n / 4);
        x.stroke();
      }
    }
    return texture(c);
  },

  /** Pen-stroke hatching (grey lines on white, tileable), multiplied in the shadows by the toon shader. */
  hatch(seed = 9) {
    const n = 256, c = canvas(n), x = c.getContext('2d'), r = mulberry32(seed);
    x.fillStyle = '#fff';
    x.fillRect(0, 0, n, n);
    x.lineCap = 'round';
    // two layers of strokes: diagonals (every shadow) and cross strokes (the darkest shadows use the green channel)
    const layer = (ang, count, color, width) => {
      x.strokeStyle = color;
      for (let i = 0; i < count; i++) {
        const px = r() * n, py = r() * n, len = 14 + r() * 26;
        wrapped(x, n, px, py, () => {
          x.rotate(ang + (r() - 0.5) * 0.25);
          x.lineWidth = width * (0.6 + r() * 0.8);
          x.beginPath();
          x.moveTo(-len / 2, 0);
          x.quadraticCurveTo(0, (r() - 0.5) * 3, len / 2, 0);
          x.stroke();
        });
      }
    };
    layer(-0.8, 260, 'rgb(90,255,255)', 1.4); // red channel: main hatch
    layer(0.75, 200, 'rgb(255,110,255)', 1.2); // green channel: cross hatch
    return texture(c, { srgb: false });
  },

  /** Chain-link fence (alpha). */
  chainlink() {
    const n = 128, c = canvas(n), x = c.getContext('2d');
    x.clearRect(0, 0, n, n);
    x.strokeStyle = 'rgba(120,85,60,1)';
    x.lineWidth = 3;
    for (let i = -n; i < n * 2; i += 16) {
      x.beginPath();
      x.moveTo(i, 0);
      x.lineTo(i + n, n);
      x.stroke();
      x.beginPath();
      x.moveTo(i + n, 0);
      x.lineTo(i, n);
      x.stroke();
    }
    return texture(c);
  },

  /** Foliage: leaf-shaped dabs in two greens over a mid green. */
  leaves(seed = 10) {
    const n = 256, c = canvas(n), x = c.getContext('2d'), r = mulberry32(seed);
    paintField(x, n, r, [hex(0x3d7f2c), hex(0x4a9335), hex(0x58a43d), hex(0x66b246)], { base: 3 });
    for (let i = 0; i < 500; i++) {
      const px = r() * n, py = r() * n, s = 4 + r() * 6;
      wrapped(x, n, px, py, () => {
        x.rotate(r() * 6.28);
        x.fillStyle = r() < 0.5 ? 'rgba(130,200,80,0.45)' : 'rgba(30,80,25,0.4)';
        x.beginPath();
        x.ellipse(0, 0, s, s * 0.45, 0, 0, Math.PI * 2);
        x.fill();
      });
    }
    return texture(c);
  },

  /** Cherry blossom: petal-shaped dabs in pinks and white over a soft pink (tinted per tree by vertex colours). */
  blossom(seed = 13) {
    const n = 256, c = canvas(n), x = c.getContext('2d'), r = mulberry32(seed);
    paintField(x, n, r, [hex(0xeebccb), hex(0xf2c6d2), hex(0xf6d0da), hex(0xf9dbe2)], { base: 6 });
    for (let i = 0; i < 900; i++) {
      const px = r() * n, py = r() * n, s = 3 + r() * 5;
      wrapped(x, n, px, py, () => {
        x.rotate(r() * 6.28);
        x.fillStyle = r() < 0.45 ? 'rgba(255,245,248,0.55)' : r() < 0.6 ? 'rgba(214,110,145,0.45)' : 'rgba(236,150,175,0.4)';
        x.beginPath();
        x.ellipse(0, 0, s, s * 0.6, 0, 0, Math.PI * 2);
        x.fill();
      });
    }
    return texture(c);
  },

  /** Shoji: translucent paper in a thin wooden lattice (one panel per texture). */
  shoji() {
    const w = 128, h = 256, c = canvas(w, h), x = c.getContext('2d');
    x.fillStyle = '#f4ecd6';
    x.fillRect(0, 0, w, h);
    x.strokeStyle = '#5a4030';
    x.lineWidth = 5;
    x.strokeRect(2, 2, w - 4, h - 4);
    x.lineWidth = 2.5;
    for (let i = 1; i < 3; i++) {
      x.beginPath();
      x.moveTo((i * w) / 3, 0);
      x.lineTo((i * w) / 3, h);
      x.stroke();
    }
    for (let j = 1; j < 6; j++) {
      x.beginPath();
      x.moveTo(0, (j * h) / 6);
      x.lineTo(w, (j * h) / 6);
      x.stroke();
    }
    return texture(c, { repeat: false });
  },

  /** Awning cloth: vertical stripes (colour and cream). */
  stripes(color) {
    const n = 128, c = canvas(n, 32), x = c.getContext('2d');
    x.fillStyle = '#f6ecd4';
    x.fillRect(0, 0, n, 32);
    x.fillStyle = color;
    x.fillRect(0, 0, n / 2, 32);
    x.fillStyle = 'rgba(0,0,0,0.12)';
    x.fillRect(n / 2 - 3, 0, 3, 32);
    return texture(c);
  },

  /** Noren curtain: indigo cloth with a white character. */
  noren(text = '一楽') {
    const w = 512, h = 160, c = canvas(w, h), x = c.getContext('2d');
    x.fillStyle = '#23305e';
    x.fillRect(0, 0, w, h);
    x.fillStyle = '#f6f1e2';
    x.font = '110px "Yuji Syuku", serif';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText(text, w / 2, h / 2 + 6);
    return texture(c, { repeat: false });
  },

  /** A target: red and white rings. */
  target() {
    const n = 256, c = canvas(n), x = c.getContext('2d');
    const rings = ['#f6f1e2', '#c8281e', '#f6f1e2', '#c8281e', '#f6f1e2', '#1a1a1a'];
    rings.forEach((col, i) => {
      x.fillStyle = col;
      x.beginPath();
      x.arc(n / 2, n / 2, (n / 2) * (1 - i / rings.length), 0, Math.PI * 2);
      x.fill();
    });
    return texture(c, { repeat: false });
  },

  /** Crate planks with dark gaps and a cross brace. */
  crate(seed = 11) {
    const n = 256, c = canvas(n), x = c.getContext('2d'), r = mulberry32(seed);
    paintField(x, n, r, [hex(0x9a7048), hex(0xa97c52), hex(0xb88a5c), hex(0xc69866)], { base: 2 });
    x.strokeStyle = 'rgba(50,30,15,0.7)';
    x.lineWidth = 4;
    x.strokeRect(4, 4, n - 8, n - 8);
    for (let i = 1; i < 4; i++) {
      x.beginPath();
      x.moveTo(0, (i * n) / 4);
      x.lineTo(n, (i * n) / 4);
      x.stroke();
    }
    x.lineWidth = 10;
    x.beginPath();
    x.moveTo(10, 10);
    x.lineTo(n - 10, n - 10);
    x.stroke();
    return texture(c);
  },

  /**
   * A building facade, one bay by one storey (4 m x 3.1 m; tiles both ways): pale plaster (vertex colours tint it per
   * building), a dark floor beam, a window in a timber frame with a sill, glass with a sky glint, a grime streak.
   */
  facade(seed = 12) {
    const w = 256, h = 200, c = canvas(w, h), x = c.getContext('2d'), r = mulberry32(seed);
    const px = (m) => (m / 4) * w, py = (m) => h - (m / 3.1) * h; // metres -> canvas (v up)
    const f = fbmField(w, r, 3, 3);
    const img = x.createImageData(w, h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const v = 236 + (f[(j % w) * w + i] - 0.5) * 26;
      img.data.set([v, v - 3, v - 8, 255], (j * w + i) * 4);
    }
    x.putImageData(img, 0, 0);
    // grime under the sill
    const gr = x.createLinearGradient(0, py(0.9), 0, py(0.2));
    gr.addColorStop(0, 'rgba(120,105,85,0.25)');
    gr.addColorStop(1, 'rgba(120,105,85,0)');
    x.fillStyle = gr;
    x.fillRect(px(1.3), py(0.9), px(1.4), py(0.2) - py(0.9));
    // floor beam
    x.fillStyle = '#4a3526';
    x.fillRect(0, py(0.2), w, py(0) - py(0.2));
    x.fillStyle = 'rgba(255,255,255,0.12)';
    x.fillRect(0, py(0.2), w, 2);
    // window: frame, glass, glint, mullions, sill
    const X0 = 1.1, X1 = 2.9, Y0 = 0.95, Y1 = 2.4;
    x.fillStyle = '#4a3526';
    x.fillRect(px(X0 - 0.1), py(Y1 + 0.1), px(X1 - X0 + 0.2), py(Y0 - 0.1) - py(Y1 + 0.1));
    const gl = x.createLinearGradient(0, py(Y1), 0, py(Y0));
    gl.addColorStop(0, '#5a7394');
    gl.addColorStop(1, '#2c3a52');
    x.fillStyle = gl;
    x.fillRect(px(X0), py(Y1), px(X1 - X0), py(Y0) - py(Y1));
    x.fillStyle = 'rgba(210,235,255,0.35)';
    x.beginPath();
    x.moveTo(px(X0 + 0.2), py(Y1));
    x.lineTo(px(X0 + 0.55), py(Y1));
    x.lineTo(px(X0 + 0.15), py(Y0));
    x.lineTo(px(X0 - 0.0), py(Y0));
    x.closePath();
    x.fill();
    x.fillStyle = '#4a3526';
    x.fillRect(px((X0 + X1) / 2 - 0.04), py(Y1), px(0.08), py(Y0) - py(Y1));
    x.fillRect(px(X0), py(Y0 + 0.62), px(X1 - X0), py(Y0) - py(Y0 + 0.07));
    x.fillStyle = '#d9cfc0';
    x.fillRect(px(X0 - 0.2), py(Y0 - 0.1), px(X1 - X0 + 0.4), py(Y0 - 0.22) - py(Y0 - 0.1));
    return texture(c);
  },

  /**
   * Every vertical shop sign in one texture (one material, one draw for all of them): n boards side by side, each
   * 128 x 384, in four colour schemes (cream / black / red / indigo). A board's plane maps u from i/n to (i+1)/n.
   */
  signAtlas(texts) {
    const cw = 128, ch = 384, n = texts.length, c = canvas(cw * n, ch), x = c.getContext('2d');
    const schemes = [['#f1e6c8', '#2b1d12'], ['#2b2b30', '#f1e6c8'], ['#b3261e', '#fff4dc'], ['#23305e', '#f6f1e2']];
    texts.forEach((t, i) => {
      const [bg, fg] = schemes[i % schemes.length];
      const x0 = i * cw;
      x.fillStyle = bg;
      x.fillRect(x0, 0, cw, ch);
      x.strokeStyle = 'rgba(0,0,0,0.35)';
      x.lineWidth = 6;
      x.strokeRect(x0 + 5, 5, cw - 10, ch - 10);
      x.strokeStyle = 'rgba(255,255,255,0.25)';
      x.lineWidth = 2;
      x.strokeRect(x0 + 11, 11, cw - 22, ch - 22);
      x.fillStyle = fg;
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      const chars = [...t], size = Math.min(92, (ch - 50) / chars.length);
      x.font = `${size}px "Yuji Syuku", serif`;
      chars.forEach((k, j) => x.fillText(k, x0 + cw / 2, 25 + ((ch - 50) / chars.length) * (j + 0.5)));
    });
    const tex = texture(c, { repeat: false });
    tex.userData = { n };
    return tex;
  },

  /**
   * Noren curtains, several designs in one texture (one material): each design a 512 x 128 cell of dyed cloth with a
   * white character across its strips and a darker hem; cells stacked vertically (v from i/n to (i+1)/n).
   */
  norenAtlas(designs) {
    const cw = 512, ch = 128, n = designs.length, c = canvas(cw, ch * n), x = c.getContext('2d');
    designs.forEach(([text, bg], i) => {
      const y0 = (n - 1 - i) * ch; // v up: design i at v i/n
      x.fillStyle = bg;
      x.fillRect(0, y0, cw, ch);
      x.fillStyle = 'rgba(0,0,0,0.22)';
      x.fillRect(0, y0 + ch - 14, cw, 14);
      x.fillStyle = '#f6f1e2';
      x.font = '92px "Yuji Syuku", serif';
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      x.fillText(text, cw / 2, y0 + ch / 2);
    });
    const tex = texture(c, { repeat: false });
    tex.userData = { n };
    return tex;
  },

  /** A painted sign: text on a coloured board (the ramen shop, the noren curtain). */
  sign(text, { w = 256, h = 96, bg = '#b3261e', fg = '#fff6e0', font = '"Yuji Syuku", serif', size = 64, vertical = false } = {}) {
    const c = canvas(w, h), x = c.getContext('2d');
    x.fillStyle = bg;
    x.fillRect(0, 0, w, h);
    x.strokeStyle = 'rgba(0,0,0,0.35)';
    x.lineWidth = 6;
    x.strokeRect(3, 3, w - 6, h - 6);
    x.fillStyle = fg;
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.font = `${size}px ${font}`;
    if (vertical) {
      const chars = [...text];
      chars.forEach((ch, i) => x.fillText(ch, w / 2, (h / (chars.length + 1)) * (i + 1)));
    } else x.fillText(text, w / 2, h / 2 + 4);
    return texture(c, { repeat: false });
  },
};
