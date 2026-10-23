// Procedural texture library. Everything is generated at load time so the game ships
// without any image assets.
import * as THREE from 'three';
import { fbm, ridged, valueNoise, mulberry32, smoothstep, clamp } from './noise.js';

const cache = new Map();
let maxAniso = 8;

export function setMaxAnisotropy(a) {
  maxAniso = a;
}

function dataTexture(data, size, srgb) {
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = maxAniso;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

function canvasTexture(canvas, srgb = true) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = maxAniso;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  return t;
}

function heightToNormal(h, size, strength) {
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    const yu = ((y + 1) % size) * size;
    const yd = ((y - 1 + size) % size) * size;
    const row = y * size;
    for (let x = 0; x < size; x++) {
      const xl = h[row + ((x - 1 + size) % size)];
      const xr = h[row + ((x + 1) % size)];
      const dn = h[yd + x];
      const up = h[yu + x];
      let nx = (xl - xr) * strength;
      let ny = (dn - up) * strength;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      const i = (row + x) * 4;
      out[i] = (nx * inv * 0.5 + 0.5) * 255;
      out[i + 1] = (ny * inv * 0.5 + 0.5) * 255;
      out[i + 2] = (inv * 0.5 + 0.5) * 255;
      out[i + 3] = 255;
    }
  }
  return out;
}

function grayToRGBA(v, size) {
  const out = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const g = clamp(v[i], 0, 1) * 255;
    out[i * 4] = g;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = g;
    out[i * 4 + 3] = 255;
  }
  return out;
}

function memo(key, fn) {
  if (!cache.has(key)) cache.set(key, fn());
  return cache.get(key);
}

/** Concrete slabs: 3x3 slabs per tile, each 2m. Returns {map, normalMap, roughnessMap}. */
export function concrete(size = 1024) {
  return memo('concrete' + size, () => {
    const rnd = mulberry32(7);
    const slabTone = [];
    for (let i = 0; i < 9; i++) slabTone.push((rnd() - 0.5) * 0.07);
    const col = new Uint8Array(size * size * 4);
    const h = new Float32Array(size * size);
    const r = new Float32Array(size * size);
    const slabs = 3;
    const slabPx = size / slabs;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = x / size;
        const v = y / size;
        const sx = Math.floor(x / slabPx);
        const sy = Math.floor(y / slabPx);
        const lx = (x % slabPx) / slabPx;
        const ly = (y % slabPx) / slabPx;
        const edge = Math.min(lx, 1 - lx, ly, 1 - ly) * 2; // meters to seam
        const seam = 1 - smoothstep(0.0035, 0.009, edge);
        const blotch = fbm(u * 6, v * 6, 4, 6, 3);
        const fine = fbm(u * 64, v * 64, 3, 64, 11);
        const grain = valueNoise(u * 420, v * 420, 420, 5);
        const crack = ridged(u * 9 + 0.3, v * 9, 4, 9, 21);
        const crackLine = smoothstep(0.93, 0.985, crack) * smoothstep(0.45, 0.7, fbm(u * 3, v * 3, 2, 3, 41));
        const stain = smoothstep(0.58, 0.8, fbm(u * 4 + 5, v * 4, 5, 4, 77));
        const pit = grain > 0.93 ? 1 : 0;
        let base = 0.5 + slabTone[sy * slabs + sx] + (blotch - 0.5) * 0.16 + (fine - 0.5) * 0.06 + (grain - 0.5) * 0.05;
        base -= stain * 0.12;
        base -= seam * 0.22 + crackLine * 0.2 + pit * 0.06;
        const i = y * size + x;
        col[i * 4] = clamp(base * 1.0, 0, 1) * 255;
        col[i * 4 + 1] = clamp(base * 0.99, 0, 1) * 255;
        col[i * 4 + 2] = clamp(base * 0.955, 0, 1) * 255;
        col[i * 4 + 3] = 255;
        h[i] = fine * 0.4 + grain * 0.25 - seam * 1.6 - crackLine * 0.9 - pit * 0.4;
        r[i] = 0.84 + (fine - 0.5) * 0.12 - stain * 0.12 + seam * 0.08;
      }
    }
    return {
      map: dataTexture(col, size, true),
      normalMap: dataTexture(heightToNormal(h, size, 2.2), size, false),
      roughnessMap: dataTexture(grayToRGBA(r, size), size, false),
    };
  });
}

/** Grass ground texture drawn with thousands of blade strokes. */
export function grass(size = 1024) {
  return memo('grass' + size, () => {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    // base layer from noise
    const img = g.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = x / size;
        const v = y / size;
        const n = fbm(u * 8, v * 8, 5, 8, 9);
        const dirt = smoothstep(0.62, 0.78, fbm(u * 3 + 2, v * 3, 4, 3, 13));
        const i = (y * size + x) * 4;
        const gr = [52 + n * 40, 84 + n * 50, 30 + n * 18];
        const dr = [96 + n * 30, 78 + n * 24, 52 + n * 16];
        img.data[i] = gr[0] + (dr[0] - gr[0]) * dirt;
        img.data[i + 1] = gr[1] + (dr[1] - gr[1]) * dirt;
        img.data[i + 2] = gr[2] + (dr[2] - gr[2]) * dirt;
        img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    const rnd = mulberry32(42);
    const blades = Math.round(size * size * 0.06);
    g.lineCap = 'round';
    for (let k = 0; k < blades; k++) {
      const x = rnd() * size;
      const y = rnd() * size;
      const len = 3 + rnd() * size * 0.012;
      const ang = rnd() * Math.PI * 2;
      const shade = rnd();
      const hue = 78 + rnd() * 30;
      const light = 18 + shade * 30;
      g.strokeStyle = `hsla(${hue}, ${45 + rnd() * 25}%, ${light}%, ${0.55 + rnd() * 0.4})`;
      g.lineWidth = 0.8 + rnd() * 1.6;
      const dx = Math.cos(ang) * len;
      const dy = Math.sin(ang) * len;
      for (const ox of [0, -size, size]) {
        for (const oy of [0, -size, size]) {
          const px = x + ox;
          const py = y + oy;
          if (px + len < 0 || px - len > size || py + len < 0 || py - len > size) continue;
          g.beginPath();
          g.moveTo(px, py);
          g.quadraticCurveTo(px + dx * 0.5 + dy * 0.2, py + dy * 0.5 - dx * 0.2, px + dx, py + dy);
          g.stroke();
        }
      }
    }
    // derive height + roughness from luminance
    const data = g.getImageData(0, 0, size, size).data;
    const h = new Float32Array(size * size);
    const r = new Float32Array(size * size);
    for (let i = 0; i < size * size; i++) {
      const l = (data[i * 4] * 0.3 + data[i * 4 + 1] * 0.6 + data[i * 4 + 2] * 0.1) / 255;
      h[i] = l;
      r[i] = 0.92 - l * 0.25;
    }
    return {
      map: canvasTexture(c, true),
      normalMap: dataTexture(heightToNormal(h, size, 3.0), size, false),
      roughnessMap: dataTexture(grayToRGBA(r, size), size, false),
    };
  });
}

/** Low-frequency grayscale noise used to break up texture tiling over large areas. */
export function macroNoise(size = 256) {
  return memo('macro' + size, () => {
    const v = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        v[y * size + x] = fbm((x / size) * 5, (y / size) * 5, 5, 5, 99);
      }
    }
    return dataTexture(grayToRGBA(v, size), size, false);
  });
}

/** Wood planks (grain runs along V). */
export function woodPlanks(size = 512, planks = 4, seed = 3) {
  return memo(`wood${size}_${planks}_${seed}`, () => {
    const rnd = mulberry32(seed);
    const tones = [];
    for (let i = 0; i < planks; i++) tones.push({ t: (rnd() - 0.5) * 0.18, off: rnd() * 10 });
    const col = new Uint8Array(size * size * 4);
    const h = new Float32Array(size * size);
    const r = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = x / size;
        const v = y / size;
        const p = Math.floor(u * planks);
        const lu = u * planks - p;
        const tone = tones[p];
        const warp = fbm(u * 6, v * 2 + tone.off, 3, 0, 5) * 3;
        const rings = Math.sin((u * planks * 7 + warp + tone.off) * Math.PI * 2) * 0.5 + 0.5;
        const streak = fbm(u * 40, v * 3 + tone.off, 4, 0, 8);
        const gap = 1 - smoothstep(0.0, 0.025, Math.min(lu, 1 - lu));
        const knot = smoothstep(0.86, 0.95, valueNoise(u * 9 + tone.off, v * 3, 0, 31));
        let t = 0.55 + tone.t + rings * 0.12 + (streak - 0.5) * 0.25 - knot * 0.25;
        t -= gap * 0.45;
        const i = y * size + x;
        col[i * 4] = clamp(t * 0.78 + 0.1, 0, 1) * 255;
        col[i * 4 + 1] = clamp(t * 0.55 + 0.05, 0, 1) * 255;
        col[i * 4 + 2] = clamp(t * 0.32 + 0.02, 0, 1) * 255;
        col[i * 4 + 3] = 255;
        h[i] = rings * 0.3 + streak * 0.3 - gap * 1.5 - knot * 0.2;
        r[i] = 0.62 + (1 - streak) * 0.2 + gap * 0.15;
      }
    }
    return {
      map: dataTexture(col, size, true),
      normalMap: dataTexture(heightToNormal(h, size, 1.6), size, false),
      roughnessMap: dataTexture(grayToRGBA(r, size), size, false),
    };
  });
}

/** Painted metal with scratches/edge wear. Albedo is near-white so material color tints it. */
export function paintedMetal(size = 512, seed = 1) {
  return memo('metal' + size + '_' + seed, () => {
    const col = new Uint8Array(size * size * 4);
    const h = new Float32Array(size * size);
    const r = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = x / size;
        const v = y / size;
        const n = fbm(u * 8, v * 8, 4, 8, seed);
        const scratch = smoothstep(0.965, 0.995, ridged(u * 30, v * 4, 3, 30, seed + 4)) * smoothstep(0.4, 0.6, fbm(u * 4, v * 4, 2, 4, seed + 9));
        const rust = smoothstep(0.68, 0.82, fbm(u * 5 + 3, v * 5, 5, 5, seed + 13));
        const dirt = fbm(u * 3, v * 12, 3, 3, seed + 21);
        const i = y * size + x;
        let c = 0.92 + (n - 0.5) * 0.12 - dirt * 0.12;
        let cr = c, cg = c, cb = c;
        // rust: brown
        cr = cr * (1 - rust) + 0.45 * rust;
        cg = cg * (1 - rust) + 0.26 * rust;
        cb = cb * (1 - rust) + 0.14 * rust;
        // scratches: bare grey metal
        cr = cr * (1 - scratch) + 0.55 * scratch;
        cg = cg * (1 - scratch) + 0.55 * scratch;
        cb = cb * (1 - scratch) + 0.57 * scratch;
        col[i * 4] = clamp(cr, 0, 1) * 255;
        col[i * 4 + 1] = clamp(cg, 0, 1) * 255;
        col[i * 4 + 2] = clamp(cb, 0, 1) * 255;
        col[i * 4 + 3] = 255;
        h[i] = n * 0.2 - scratch * 0.6 + rust * 0.4;
        r[i] = 0.42 + (n - 0.5) * 0.15 + rust * 0.4 - scratch * 0.15;
      }
    }
    return {
      map: dataTexture(col, size, true),
      normalMap: dataTexture(heightToNormal(h, size, 1.2), size, false),
      roughnessMap: dataTexture(grayToRGBA(r, size), size, false),
    };
  });
}

/** Corrugated sheet metal normal map (ridges along V). */
export function corrugated(size = 512) {
  return memo('corr' + size, () => {
    const h = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = x / size;
        const s = Math.sin(u * Math.PI * 2 * 16);
        h[y * size + x] = Math.sign(s) * Math.pow(Math.abs(s), 0.6) * 1.2 + fbm(u * 10, (y / size) * 10, 3, 10, 2) * 0.2;
      }
    }
    return dataTexture(heightToNormal(h, size, 3.5), size, false);
  });
}

/** Generic rough noise normal map for subtle surface detail. */
export function bumpNoise(size = 256, scale = 16, strength = 1.5, seed = 4) {
  return memo(`bump${size}_${scale}_${strength}_${seed}`, () => {
    const h = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        h[y * size + x] = fbm((x / size) * scale, (y / size) * scale, 4, scale, seed);
      }
    }
    return dataTexture(heightToNormal(h, size, strength), size, false);
  });
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Explosive barrel wrap label. */
export function explosiveLabel() {
  return memo('exlabel', () => {
    const c = canvas(1024, 256);
    const g = c.getContext('2d');
    g.fillStyle = '#b3121b';
    g.fillRect(0, 0, 1024, 256);
    for (let k = 0; k < 2; k++) {
      const cx = 256 + k * 512;
      // hazard diamond
      g.save();
      g.translate(cx, 128);
      g.rotate(Math.PI / 4);
      g.fillStyle = '#f2b705';
      g.fillRect(-70, -70, 140, 140);
      g.lineWidth = 8;
      g.strokeStyle = '#111';
      g.strokeRect(-62, -62, 124, 124);
      g.restore();
      // flame
      g.fillStyle = '#111';
      g.beginPath();
      g.moveTo(cx, 70);
      g.bezierCurveTo(cx + 40, 110, cx + 42, 150, cx + 20, 170);
      g.bezierCurveTo(cx + 22, 145, cx + 10, 135, cx + 5, 125);
      g.bezierCurveTo(cx + 2, 150, cx - 10, 160, cx - 20, 170);
      g.bezierCurveTo(cx - 45, 140, cx - 25, 105, cx, 70);
      g.fill();
      g.fillRect(cx - 30, 172, 60, 8);
    }
    g.fillStyle = '#f5f0e6';
    g.font = 'bold 44px Arial, sans-serif';
    g.textAlign = 'center';
    g.fillText('FLAMMABLE', 512, 110);
    g.font = 'bold 26px Arial, sans-serif';
    g.fillText('KEEP AWAY FROM HEAT', 512, 160);
    g.fillText('UN 1203', 512, 200);
    return canvasTexture(c);
  });
}

export function tntLabel() {
  return memo('tnt', () => {
    const c = canvas(512, 256);
    const g = c.getContext('2d');
    g.fillStyle = '#f1e7cf';
    g.fillRect(0, 0, 512, 256);
    g.fillStyle = '#c8241c';
    g.fillRect(0, 0, 512, 40);
    g.fillRect(0, 216, 512, 40);
    g.fillStyle = '#1a1a1a';
    g.font = 'bold 130px Impact, Arial Black, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('TNT', 256, 132);
    return canvasTexture(c);
  });
}

export function crateStencil() {
  return memo('stencil', () => {
    const c = canvas(512, 512);
    const g = c.getContext('2d');
    g.clearRect(0, 0, 512, 512);
    g.fillStyle = 'rgba(25,20,15,0.75)';
    g.font = 'bold 64px Arial Black, Arial, sans-serif';
    g.textAlign = 'center';
    g.fillText('FRAGILE', 256, 230);
    g.font = 'bold 40px Arial, sans-serif';
    g.fillText('THIS SIDE UP', 256, 300);
    g.beginPath();
    g.moveTo(256, 340);
    g.lineTo(226, 380);
    g.lineTo(286, 380);
    g.fill();
    g.fillRect(248, 378, 16, 40);
    return canvasTexture(c);
  });
}

/** Soft round sprite, used for smoke/dust/blood mist. */
export function particleAtlas() {
  return memo('patlas', () => {
    // 4x4 atlas: 0 smoke puffs (4 variants), 1 fire (4), 2 spark/glow (4), 3 blood/debris (4)
    const S = 128;
    const c = canvas(S * 4, S * 4);
    const g = c.getContext('2d');
    const rnd = mulberry32(5);
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 4; col++) {
        const x0 = col * S;
        const y0 = row * S;
        const img = g.createImageData(S, S);
        const seed = row * 4 + col + 1;
        for (let y = 0; y < S; y++) {
          for (let x = 0; x < S; x++) {
            const dx = (x + 0.5) / S - 0.5;
            const dy = (y + 0.5) / S - 0.5;
            const d = Math.sqrt(dx * dx + dy * dy) * 2;
            const n = fbm(x / S * 4 + seed * 3, y / S * 4, 4, 0, seed);
            let a = 0;
            let L = 255;
            if (row === 0) {
              a = smoothstep(1.0, 0.35, d + (n - 0.5) * 0.7);
              L = 200 + n * 55;
            } else if (row === 1) {
              a = smoothstep(1.0, 0.2, d + (n - 0.5) * 0.9) * (0.6 + n * 0.4);
              L = 255;
            } else if (row === 2) {
              a = Math.pow(Math.max(0, 1 - d), 2.2);
              L = 255;
            } else {
              const blob = d + (n - 0.5) * 0.8;
              a = smoothstep(0.85, 0.55, blob);
              L = 255;
            }
            const i = (y * S + x) * 4;
            img.data[i] = L;
            img.data[i + 1] = L;
            img.data[i + 2] = L;
            img.data[i + 3] = clamp(a, 0, 1) * 255;
          }
        }
        g.putImageData(img, x0, y0);
      }
    }
    rnd();
    const t = canvasTexture(c, false);
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  });
}

/** Blood splat decal textures (4 variants in a 2x2 atlas), alpha in A, color baked red. */
export function bloodDecals() {
  return memo('blood', () => {
    const S = 256;
    const c = canvas(S * 2, S * 2);
    const g = c.getContext('2d');
    const rnd = mulberry32(77);
    for (let k = 0; k < 4; k++) {
      const x0 = (k % 2) * S;
      const y0 = Math.floor(k / 2) * S;
      g.save();
      g.beginPath();
      g.rect(x0, y0, S, S);
      g.clip();
      const cx = x0 + S / 2;
      const cy = y0 + S / 2;
      const drawBlob = (x, y, r, a) => {
        const grd = g.createRadialGradient(x, y, 0, x, y, r);
        grd.addColorStop(0, `rgba(120,4,6,${a})`);
        grd.addColorStop(0.7, `rgba(95,2,4,${a})`);
        grd.addColorStop(1, 'rgba(70,0,2,0)');
        g.fillStyle = grd;
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.fill();
      };
      drawBlob(cx, cy, S * 0.3, 0.95);
      const n = 6 + Math.floor(rnd() * 10);
      for (let i = 0; i < n; i++) {
        const a = rnd() * Math.PI * 2;
        const d = S * (0.12 + rnd() * 0.28);
        drawBlob(cx + Math.cos(a) * d, cy + Math.sin(a) * d, S * (0.03 + rnd() * 0.09), 0.9);
      }
      // streaks
      for (let i = 0; i < 5; i++) {
        const a = rnd() * Math.PI * 2;
        const len = S * (0.25 + rnd() * 0.2);
        g.strokeStyle = 'rgba(100,3,5,0.85)';
        g.lineWidth = 2 + rnd() * 5;
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(cx, cy);
        g.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len);
        g.stroke();
      }
      g.restore();
    }
    const t = canvasTexture(c, true);
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  });
}

/** Scorch mark decal for explosions. */
export function scorchDecal() {
  return memo('scorch', () => {
    const S = 256;
    const c = canvas(S, S);
    const g = c.getContext('2d');
    const img = g.createImageData(S, S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const dx = (x + 0.5) / S - 0.5;
        const dy = (y + 0.5) / S - 0.5;
        const ang = Math.atan2(dy, dx);
        const d = Math.sqrt(dx * dx + dy * dy) * 2;
        const n = fbm(Math.cos(ang) * 2 + 3, Math.sin(ang) * 2 + 3, 4, 0, 3);
        const a = smoothstep(1.0, 0.25, d + (n - 0.5) * 0.6) * 0.92;
        const i = (y * S + x) * 4;
        img.data[i] = 12;
        img.data[i + 1] = 10;
        img.data[i + 2] = 9;
        img.data[i + 3] = a * 255;
      }
    }
    g.putImageData(img, 0, 0);
    const t = canvasTexture(c, true);
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  });
}

/** Bullet hole decal. */
export function bulletHole() {
  return memo('hole', () => {
    const S = 64;
    const c = canvas(S, S);
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    grd.addColorStop(0, 'rgba(5,5,5,1)');
    grd.addColorStop(0.22, 'rgba(15,14,12,0.95)');
    grd.addColorStop(0.35, 'rgba(40,36,30,0.6)');
    grd.addColorStop(1, 'rgba(40,36,30,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, S, S);
    const t = canvasTexture(c, true);
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  });
}

/** Iris texture for eyeballs: vertical gradient that maps to latitude on a sphere. */
export function eyeTexture(irisColor) {
  return memo('eye' + irisColor, () => {
    const W = 64;
    const H = 256;
    const c = canvas(W, H);
    const g = c.getContext('2d');
    // sphere v=1 (top row in canvas when flipY) is the front pole after rotation
    g.fillStyle = '#f2efe9';
    g.fillRect(0, 0, W, H);
    const iris = new THREE.Color(irisColor);
    const ir = `rgb(${iris.r * 255},${iris.g * 255},${iris.b * 255})`;
    const dark = `rgb(${iris.r * 120},${iris.g * 120},${iris.b * 120})`;
    const grd = g.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0.0, '#050505');
    grd.addColorStop(0.045, '#080808');
    grd.addColorStop(0.06, dark);
    grd.addColorStop(0.1, ir);
    grd.addColorStop(0.145, ir);
    grd.addColorStop(0.162, '#2a2420');
    grd.addColorStop(0.18, '#efe9e2');
    grd.addColorStop(0.6, '#f2efe9');
    grd.addColorStop(1.0, '#e6d6cf');
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);
    // subtle radial iris streaks
    for (let i = 0; i < 40; i++) {
      const x = Math.random() * W;
      g.strokeStyle = `rgba(255,255,255,${0.08 + Math.random() * 0.1})`;
      g.beginPath();
      g.moveTo(x, H * 0.06);
      g.lineTo(x, H * 0.15);
      g.stroke();
    }
    const t = canvasTexture(c, true);
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  });
}

/** Clay brick with mortar-free edges (one brick per texture). */
export function brick() {
  return memo('brick', () => {
    const S = 256;
    const col = new Uint8Array(S * S * 4);
    const h = new Float32Array(S * S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const u = x / S, v = y / S;
        const n = fbm(u * 6, v * 6, 4, 6, 71);
        const sp = valueNoise(u * 90, v * 90, 90, 3);
        const edge = Math.min(u, 1 - u, v, 1 - v);
        const e = smoothstep(0.0, 0.04, edge);
        const i = y * S + x;
        const k = (0.75 + n * 0.35 - (sp > 0.85 ? 0.15 : 0)) * (0.75 + 0.25 * e);
        col[i * 4] = clamp(0.62 * k, 0, 1) * 255;
        col[i * 4 + 1] = clamp(0.27 * k, 0, 1) * 255;
        col[i * 4 + 2] = clamp(0.18 * k, 0, 1) * 255;
        col[i * 4 + 3] = 255;
        h[i] = n * 0.5 + sp * 0.2 + e * 0.6;
      }
    }
    return { map: dataTexture(col, S, true), normalMap: dataTexture(heightToNormal(h, S, 2.5), S, false) };
  });
}

/** Ticking fabric stripes (mattress). */
export function stripes(c1 = '#e9ecf2', c2 = '#5f86b8', n = 14) {
  return memo('stripes' + c1 + c2 + n, () => {
    const c = canvas(256, 256);
    const g = c.getContext('2d');
    g.fillStyle = c1;
    g.fillRect(0, 0, 256, 256);
    g.fillStyle = c2;
    for (let i = 0; i < n; i++) g.fillRect((i * 256) / n, 0, 256 / n / 3, 256);
    return canvasTexture(c);
  });
}

export function beachBall() {
  return memo('beach', () => {
    const c = canvas(512, 256);
    const g = c.getContext('2d');
    const cols = ['#e63b2e', '#f5f2ea', '#2c79d6', '#f5f2ea', '#f2c12e', '#f5f2ea'];
    for (let i = 0; i < 6; i++) {
      g.fillStyle = cols[i];
      g.fillRect((i * 512) / 6, 0, 512 / 6 + 1, 256);
    }
    g.fillStyle = '#f5f2ea';
    g.fillRect(0, 0, 512, 18);
    g.fillRect(0, 238, 512, 18);
    return canvasTexture(c);
  });
}

export function bowlingBall(hue = 225) {
  return memo('bowl' + hue, () => {
    const S = 256;
    const c = canvas(S * 2, S);
    const g = c.getContext('2d');
    const img = g.createImageData(S * 2, S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S * 2; x++) {
        const u = x / (S * 2), v = y / S;
        const w = fbm(u * 4 + fbm(u * 3, v * 3, 3, 3, 5) * 2, v * 3, 4, 4, 9);
        const i = (y * S * 2 + x) * 4;
        const col = new THREE.Color().setHSL(hue / 360, 0.75, 0.08 + w * 0.22);
        img.data[i] = col.r * 255;
        img.data[i + 1] = col.g * 255;
        img.data[i + 2] = col.b * 255;
        img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    // finger holes near the "top"
    g.fillStyle = '#050505';
    for (const [x, y, r] of [[250, 40, 9], [270, 40, 9], [260, 62, 11]]) {
      g.beginPath();
      g.ellipse(x, y, r * 1.6, r, 0, 0, Math.PI * 2);
      g.fill();
    }
    return canvasTexture(c);
  });
}

export function watermelon() {
  return memo('melon', () => {
    const W = 512, H = 256;
    const c = canvas(W, H);
    const g = c.getContext('2d');
    const img = g.createImageData(W, H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const u = x / W, v = y / H;
        const wob = (fbm(u * 6, v * 8, 3, 6, 4) - 0.5) * 0.08;
        const stripe = Math.sin((u + wob) * Math.PI * 2 * 14);
        const dark = smoothstep(-0.2, 0.3, stripe);
        const n = fbm(u * 30, v * 30, 3, 30, 8);
        const i = (y * W + x) * 4;
        const L = 0.12 + (1 - dark) * 0.25 + n * 0.08;
        img.data[i] = L * 0.55 * 255;
        img.data[i + 1] = (L + 0.12) * 255;
        img.data[i + 2] = L * 0.35 * 255;
        img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return canvasTexture(c);
  });
}

export function domino() {
  return memo('domino', () => {
    const c = canvas(256, 512);
    const g = c.getContext('2d');
    g.fillStyle = '#f4f1ea';
    g.fillRect(0, 0, 256, 512);
    g.fillStyle = '#151515';
    g.fillRect(20, 250, 216, 10);
    const pip = (x, y) => {
      g.beginPath();
      g.arc(x, y, 22, 0, Math.PI * 2);
      g.fill();
    };
    for (const [x, y] of [[70, 70], [186, 70], [128, 128], [70, 186], [186, 186]]) pip(x, y);
    for (const [x, y] of [[70, 326], [186, 446], [128, 386]]) pip(x, y);
    return canvasTexture(c);
  });
}
