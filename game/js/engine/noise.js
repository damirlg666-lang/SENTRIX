// Small deterministic noise helpers used for procedural textures and terrain.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(ix, iy, seed) {
  let h = (ix * 374761393 + iy * 668265263 + seed * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

/**
 * Periodic 2D value noise in [0,1]. `period` makes the noise tile every `period` units
 * (pass 0 for non-tiling noise).
 */
export function valueNoise(x, y, period = 0, seed = 1) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = fade(x - x0);
  const fy = fade(y - y0);
  let ax = x0, bx = x0 + 1, ay = y0, by = y0 + 1;
  if (period > 0) {
    ax = ((ax % period) + period) % period;
    bx = ((bx % period) + period) % period;
    ay = ((ay % period) + period) % period;
    by = ((by % period) + period) % period;
  }
  const v00 = hash2(ax, ay, seed);
  const v10 = hash2(bx, ay, seed);
  const v01 = hash2(ax, by, seed);
  const v11 = hash2(bx, by, seed);
  const a = v00 + (v10 - v00) * fx;
  const b = v01 + (v11 - v01) * fx;
  return a + (b - a) * fy;
}

/** Fractal value noise, tiling over `period` (in base-frequency units). Returns ~[0,1]. */
export function fbm(x, y, octaves = 5, period = 0, seed = 1, lacunarity = 2, gain = 0.5) {
  let amp = 0.5;
  let sum = 0;
  let norm = 0;
  let freq = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(x * freq, y * freq, period > 0 ? period * freq : 0, seed + i * 17);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

/** Ridged variant, good for cracks and veins. */
export function ridged(x, y, octaves = 4, period = 0, seed = 1) {
  let amp = 0.5;
  let sum = 0;
  let norm = 0;
  let freq = 1;
  for (let i = 0; i < octaves; i++) {
    const n = valueNoise(x * freq, y * freq, period > 0 ? period * freq : 0, seed + i * 31);
    sum += amp * (1 - Math.abs(n * 2 - 1));
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

export function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export function clamp(x, a, b) {
  return x < a ? a : x > b ? b : x;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}
