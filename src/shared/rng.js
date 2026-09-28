// Seeded random numbers and value noise. Anything that produces a collider must use these (never Math.random):
// every client and the server build the same map from the same seed.

export function mulberry32(seed) {
  let a = seed >>> 0;
  const f = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  f.range = (a0, b0) => a0 + (b0 - a0) * f();
  f.int = (a0, b0) => Math.floor(a0 + (b0 - a0 + 1) * f());
  f.pick = (arr) => arr[Math.floor(f() * arr.length)];
  f.sign = () => (f() < 0.5 ? -1 : 1);
  return f;
}

/** Deterministic hash of two integers -> [0, 1). */
export function hash2(i, j, seed = 0) {
  let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(seed, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Smooth value noise in [-1, 1]. */
export function vnoise(x, z, seed = 0) {
  const i = Math.floor(x), j = Math.floor(z);
  const u = x - i, v = z - j;
  const su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
  const a = hash2(i, j, seed), b = hash2(i + 1, j, seed), c = hash2(i, j + 1, seed), d = hash2(i + 1, j + 1, seed);
  return (a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv) * 2 - 1;
}

/** Fractal value noise (octaves), roughly in [-1, 1]. */
export function fbm(x, z, oct = 4, seed = 0) {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let o = 0; o < oct; o++) {
    s += vnoise(x * f, z * f, seed + o * 17) * a;
    n += a;
    a *= 0.5;
    f *= 2.03;
  }
  return s / n;
}

// Deterministic sine/cosine (range reduction + Taylor to x^15: ~1e-12 error). Math.sin/cos may differ between
// JavaScript engines in the last bit; map colliders must come out identical on every browser and the server.
const TAU = 6.283185307179586;
export function dsin(a) {
  let x = a - TAU * Math.round(a / TAU); // [-pi, pi]
  if (x > 1.5707963267948966) x = 3.141592653589793 - x;
  else if (x < -1.5707963267948966) x = -3.141592653589793 - x;
  const x2 = x * x;
  return x * (1 + x2 * (-1 / 6 + x2 * (1 / 120 + x2 * (-1 / 5040 + x2 * (1 / 362880 + x2 * (-1 / 39916800 + x2 * (1 / 6227020800 - x2 / 1307674368000)))))));
}
export const dcos = (a) => dsin(a + 1.5707963267948966);

export const smoothstep = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
