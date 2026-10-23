// Signed distance field modelling + surface-nets meshing.
// Characters are sculpted from smooth-blended primitives and meshed once at load time.

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Rotation matrix (row-major 3x3) from Euler XYZ, used to rotate primitives. */
export function rotMat(rx = 0, ry = 0, rz = 0) {
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const cz = Math.cos(rz), sz = Math.sin(rz);
  // R = Rz * Ry * Rx
  return [
    cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx,
    sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx,
    -sy, cy * sx, cy * cx,
  ];
}

/** Tapered capsule between points a and b with radii r1 (at a) and r2 (at b). */
export function roundCone(a, b, r1, r2) {
  const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
  const l2 = bax * bax + bay * bay + baz * baz;
  const rr = r1 - r2;
  const a2 = l2 - rr * rr;
  const il2 = 1 / l2;
  const srr = Math.sign(rr) * rr * rr;
  const f = (x, y, z) => {
    const pax = x - a[0], pay = y - a[1], paz = z - a[2];
    const yv = pax * bax + pay * bay + paz * baz;
    const zv = yv - l2;
    const qx = pax * l2 - bax * yv, qy = pay * l2 - bay * yv, qz = paz * l2 - baz * yv;
    const x2 = qx * qx + qy * qy + qz * qz;
    const y2 = yv * yv * l2;
    const z2 = zv * zv * l2;
    const k = srr * x2;
    if (Math.sign(zv) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
    if (Math.sign(yv) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
    return (Math.sqrt(x2 * a2 * il2) + yv * rr) * il2 - r1;
  };
  f.t = (x, y, z) => clamp01(((x - a[0]) * bax + (y - a[1]) * bay + (z - a[2]) * baz) * il2);
  f.aabb = [
    Math.min(a[0] - r1, b[0] - r2), Math.min(a[1] - r1, b[1] - r2), Math.min(a[2] - r1, b[2] - r2),
    Math.max(a[0] + r1, b[0] + r2), Math.max(a[1] + r1, b[1] + r2), Math.max(a[2] + r1, b[2] + r2),
  ];
  return f;
}

export function capsule(a, b, r) {
  return roundCone(a, b, r, r);
}

export function sphere(c, r) {
  const f = (x, y, z) => {
    const dx = x - c[0], dy = y - c[1], dz = z - c[2];
    return Math.sqrt(dx * dx + dy * dy + dz * dz) - r;
  };
  f.aabb = [c[0] - r, c[1] - r, c[2] - r, c[0] + r, c[1] + r, c[2] + r];
  return f;
}

/** Ellipsoid (approximate distance) with optional rotation matrix. */
export function ellipsoid(c, r, R = null) {
  const [rx, ry, rz] = r;
  const minR = Math.min(rx, ry, rz);
  const f = (x, y, z) => {
    let px = x - c[0], py = y - c[1], pz = z - c[2];
    if (R) {
      // local = R^T * p
      const lx = R[0] * px + R[3] * py + R[6] * pz;
      const ly = R[1] * px + R[4] * py + R[7] * pz;
      const lz = R[2] * px + R[5] * py + R[8] * pz;
      px = lx; py = ly; pz = lz;
    }
    const ax = px / rx, ay = py / ry, az = pz / rz;
    const k0 = Math.sqrt(ax * ax + ay * ay + az * az);
    const bx = ax / rx, by = ay / ry, bz = az / rz;
    const k1 = Math.sqrt(bx * bx + by * by + bz * bz);
    if (k1 < 1e-9) return -minR;
    return (k0 * (k0 - 1)) / k1;
  };
  const m = Math.max(rx, ry, rz);
  f.aabb = [c[0] - m, c[1] - m, c[2] - m, c[0] + m, c[1] + m, c[2] + m];
  return f;
}

/** Rounded box with half extents h and rounding radius rad. */
export function roundBox(c, h, rad, R = null) {
  const hx = h[0] - rad, hy = h[1] - rad, hz = h[2] - rad;
  const f = (x, y, z) => {
    let px = x - c[0], py = y - c[1], pz = z - c[2];
    if (R) {
      const lx = R[0] * px + R[3] * py + R[6] * pz;
      const ly = R[1] * px + R[4] * py + R[7] * pz;
      const lz = R[2] * px + R[5] * py + R[8] * pz;
      px = lx; py = ly; pz = lz;
    }
    const qx = Math.abs(px) - hx, qy = Math.abs(py) - hy, qz = Math.abs(pz) - hz;
    const mx = Math.max(qx, 0), my = Math.max(qy, 0), mz = Math.max(qz, 0);
    return Math.sqrt(mx * mx + my * my + mz * mz) + Math.min(Math.max(qx, qy, qz), 0) - rad;
  };
  const m = Math.sqrt(h[0] * h[0] + h[1] * h[1] + h[2] * h[2]);
  f.aabb = [c[0] - m, c[1] - m, c[2] - m, c[0] + m, c[1] + m, c[2] + m];
  return f;
}

export function smin(a, b, k) {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

export function smax(a, b, k) {
  return -smin(-a, -b, k);
}

/**
 * A model is an ordered list of parts that are smoothly unioned (or subtracted).
 * Each part carries metadata used later for skinning and coloring.
 */
export class SDFModel {
  constructor() {
    this.parts = [];
    this.clip = null; // optional extra field intersected at the end: d = max(d, clip(p))
  }

  add(fn, opts = {}) {
    const part = {
      fn,
      k: opts.k ?? 0.02,
      sub: !!opts.sub,
      bone: opts.bone ?? 0,
      bone2: opts.bone2 ?? -1, // optional second bone blended along fn.t
      split: opts.split ?? [0.35, 0.65],
      label: opts.label ?? 0,
      sigma: opts.sigma ?? 0.012,
      weightOnly: !!opts.weightOnly,
      noWeight: !!opts.noWeight,
    };
    const bb = fn.aabb;
    const pad = part.k + 1e-4;
    part.box = [bb[0] - pad, bb[1] - pad, bb[2] - pad, bb[3] + pad, bb[4] + pad, bb[5] + pad];
    this.parts.push(part);
    return part;
  }

  field(x, y, z) {
    let d = 1e9;
    const parts = this.parts;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (p.weightOnly) continue;
      const b = p.box;
      // lower bound of the part distance from its padded box
      const ox = x < b[0] ? b[0] - x : x > b[3] ? x - b[3] : 0;
      const oy = y < b[1] ? b[1] - y : y > b[4] ? y - b[4] : 0;
      const oz = z < b[2] ? b[2] - z : z > b[5] ? z - b[5] : 0;
      if (p.sub) {
        if (ox + oy + oz > 0) continue; // outside a subtractive part's box: no effect
        d = smax(d, -p.fn(x, y, z), p.k);
      } else {
        if (ox + oy + oz > 0) {
          const lb = Math.sqrt(ox * ox + oy * oy + oz * oz);
          if (lb > d + p.k) continue;
        }
        d = smin(d, p.fn(x, y, z), p.k);
      }
    }
    if (this.clip) d = Math.max(d, this.clip(x, y, z));
    return d;
  }
}

/**
 * Mesh an SDF with naive surface nets. Returns { positions, normals, indices }.
 * Uses a coarse pre-pass so only samples near the surface are evaluated exactly.
 */
export function meshSDF(model, min, max, cell) {
  const f = (x, y, z) => model.field(x, y, z);
  const nx = Math.ceil((max[0] - min[0]) / cell) + 1;
  const ny = Math.ceil((max[1] - min[1]) / cell) + 1;
  const nz = Math.ceil((max[2] - min[2]) / cell) + 1;
  const N = nx * ny * nz;
  const vals = new Float32Array(N).fill(NaN);
  const idx = (i, j, k) => i + nx * (j + ny * k);

  // coarse pass
  const C = 4;
  const cnx = Math.ceil((nx - 1) / C) + 1;
  const cny = Math.ceil((ny - 1) / C) + 1;
  const cnz = Math.ceil((nz - 1) / C) + 1;
  const cvals = new Float32Array(cnx * cny * cnz);
  for (let k = 0; k < cnz; k++) {
    const z = min[2] + Math.min(k * C, nz - 1) * cell;
    for (let j = 0; j < cny; j++) {
      const y = min[1] + Math.min(j * C, ny - 1) * cell;
      for (let i = 0; i < cnx; i++) {
        const x = min[0] + Math.min(i * C, nx - 1) * cell;
        cvals[i + cnx * (j + cny * k)] = f(x, y, z);
      }
    }
  }
  const thresh = C * cell * 1.9;
  for (let k = 0; k < cnz - 1; k++) {
    for (let j = 0; j < cny - 1; j++) {
      for (let i = 0; i < cnx - 1; i++) {
        let near = false;
        let pos = false, neg = false;
        for (let c = 0; c < 8; c++) {
          const v = cvals[(i + (c & 1)) + cnx * ((j + ((c >> 1) & 1)) + cny * (k + ((c >> 2) & 1)))];
          if (Math.abs(v) < thresh) near = true;
          if (v > 0) pos = true;
          else neg = true;
        }
        if (!near && !(pos && neg)) continue;
        const i0 = i * C, j0 = j * C, k0 = k * C;
        const i1 = Math.min(i0 + C, nx - 1), j1 = Math.min(j0 + C, ny - 1), k1 = Math.min(k0 + C, nz - 1);
        for (let kk = k0; kk <= k1; kk++) {
          const z = min[2] + kk * cell;
          for (let jj = j0; jj <= j1; jj++) {
            const y = min[1] + jj * cell;
            for (let ii = i0; ii <= i1; ii++) {
              const id = idx(ii, jj, kk);
              if (vals[id] === vals[id]) continue; // already evaluated
              vals[id] = f(min[0] + ii * cell, y, z);
            }
          }
        }
      }
    }
  }
  // fill the rest with the sign of the nearest coarse sample
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const id = idx(i, j, k);
        if (vals[id] === vals[id]) continue;
        const ci = Math.min(Math.round(i / C), cnx - 1);
        const cj = Math.min(Math.round(j / C), cny - 1);
        const ck = Math.min(Math.round(k / C), cnz - 1);
        const v = cvals[ci + cnx * (cj + cny * ck)];
        vals[id] = v > 0 ? Math.max(v, cell * 2) : Math.min(v, -cell * 2);
      }
    }
  }

  // vertices: one per cell crossing the surface
  const cx = nx - 1, cy = ny - 1, cz = nz - 1;
  const cellVert = new Int32Array(cx * cy * cz).fill(-1);
  const positions = [];
  const EDGES = [
    [0, 1], [2, 3], [4, 5], [6, 7], // x edges
    [0, 2], [1, 3], [4, 6], [5, 7], // y edges
    [0, 4], [1, 5], [2, 6], [3, 7], // z edges
  ];
  const cv = new Float32Array(8);
  for (let k = 0; k < cz; k++) {
    for (let j = 0; j < cy; j++) {
      for (let i = 0; i < cx; i++) {
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          const v = vals[idx(i + (c & 1), j + ((c >> 1) & 1), k + ((c >> 2) & 1))];
          cv[c] = v;
          if (v < 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;
        let sx = 0, sy = 0, sz = 0, n = 0;
        for (const [a, b] of EDGES) {
          const va = cv[a], vb = cv[b];
          if ((va < 0) === (vb < 0)) continue;
          const t = va / (va - vb);
          const ax = a & 1, ay = (a >> 1) & 1, az = (a >> 2) & 1;
          const bx = b & 1, by = (b >> 1) & 1, bz = (b >> 2) & 1;
          sx += ax + (bx - ax) * t;
          sy += ay + (by - ay) * t;
          sz += az + (bz - az) * t;
          n++;
        }
        cellVert[i + cx * (j + cy * k)] = positions.length / 3;
        positions.push(min[0] + (i + sx / n) * cell, min[1] + (j + sy / n) * cell, min[2] + (k + sz / n) * cell);
      }
    }
  }

  // faces: one quad per grid edge with a sign change
  const indices = [];
  const cvi = (i, j, k) => cellVert[i + cx * (j + cy * k)];
  const quad = (a, b, c, d) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    indices.push(a, b, c, a, c, d);
  };
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const v0 = vals[idx(i, j, k)];
        const in0 = v0 < 0;
        // x edge
        if (i < nx - 1 && j > 0 && k > 0 && j < ny - 1 && k < nz - 1) {
          const in1 = vals[idx(i + 1, j, k)] < 0;
          if (in0 !== in1) {
            const a = cvi(i, j - 1, k - 1), b = cvi(i, j, k - 1), c = cvi(i, j, k), d = cvi(i, j - 1, k);
            if (in0) quad(a, b, c, d);
            else quad(a, d, c, b);
          }
        }
        // y edge
        if (j < ny - 1 && i > 0 && k > 0 && i < nx - 1 && k < nz - 1) {
          const in1 = vals[idx(i, j + 1, k)] < 0;
          if (in0 !== in1) {
            const a = cvi(i - 1, j, k - 1), b = cvi(i - 1, j, k), c = cvi(i, j, k), d = cvi(i, j, k - 1);
            if (in0) quad(a, b, c, d);
            else quad(a, d, c, b);
          }
        }
        // z edge
        if (k < nz - 1 && i > 0 && j > 0 && i < nx - 1 && j < ny - 1) {
          const in1 = vals[idx(i, j, k + 1)] < 0;
          if (in0 !== in1) {
            const a = cvi(i - 1, j - 1, k), b = cvi(i, j - 1, k), c = cvi(i, j, k), d = cvi(i - 1, j, k);
            if (in0) quad(a, b, c, d);
            else quad(a, d, c, b);
          }
        }
      }
    }
  }

  // one Newton step projects each vertex onto the surface; its gradient doubles as the normal
  const nv = positions.length / 3;
  const pos = new Float32Array(positions);
  const nrm = new Float32Array(nv * 3);
  const e = cell * 0.35;
  for (let v = 0; v < nv; v++) {
    const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
    const d = f(x, y, z);
    const gx = f(x + e, y, z) - f(x - e, y, z);
    const gy = f(x, y + e, z) - f(x, y - e, z);
    const gz = f(x, y, z + e) - f(x, y, z - e);
    const l = Math.sqrt(gx * gx + gy * gy + gz * gz);
    if (l < 1e-9) continue;
    const nx = gx / l, ny = gy / l, nz = gz / l;
    const grad = l / (2 * e);
    const step = Math.max(-cell * 0.6, Math.min(cell * 0.6, d / grad));
    pos[v * 3] = x - nx * step;
    pos[v * 3 + 1] = y - ny * step;
    pos[v * 3 + 2] = z - nz * step;
    nrm[v * 3] = nx;
    nrm[v * 3 + 1] = ny;
    nrm[v * 3 + 2] = nz;
  }
  // split quads along the better diagonal
  const ind = new Uint32Array(indices);
  for (let q = 0; q < ind.length; q += 6) {
    const a = ind[q], b = ind[q + 1], c = ind[q + 2], d = ind[q + 5];
    const dac = dist2(pos, a, c);
    const dbd = dist2(pos, b, d);
    if (dbd < dac) {
      ind[q] = a; ind[q + 1] = b; ind[q + 2] = d;
      ind[q + 3] = b; ind[q + 4] = c; ind[q + 5] = d;
    }
  }
  return { positions: pos, normals: nrm, indices: ind };
}

function dist2(p, a, b) {
  const dx = p[a * 3] - p[b * 3], dy = p[a * 3 + 1] - p[b * 3 + 1], dz = p[a * 3 + 2] - p[b * 3 + 2];
  return dx * dx + dy * dy + dz * dz;
}

/**
 * Compute skin weights for a mesh from the model's parts.
 * Returns { skinIndex: Uint16Array, skinWeight: Float32Array, label: Uint8Array, param: Float32Array }.
 */
export function skinFromParts(model, positions) {
  const nv = positions.length / 3;
  const skinIndex = new Uint16Array(nv * 4);
  const skinWeight = new Float32Array(nv * 4);
  const label = new Uint8Array(nv);
  const param = new Float32Array(nv);
  const parts = model.parts.filter((p) => !p.sub && !p.noWeight);
  const dists = new Float32Array(parts.length);
  const boneW = new Float32Array(32);
  for (let v = 0; v < nv; v++) {
    const x = positions[v * 3], y = positions[v * 3 + 1], z = positions[v * 3 + 2];
    let dmin = 1e9;
    let best = 0;
    for (let i = 0; i < parts.length; i++) {
      const d = parts[i].fn(x, y, z);
      dists[i] = d;
      if (d < dmin) {
        dmin = d;
        best = i;
      }
    }
    boneW.fill(0);
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      const w = Math.exp(-Math.max(0, dists[i] - dmin) / p.sigma);
      if (w < 1e-3) continue;
      if (p.bone2 >= 0 && p.fn.t) {
        const t = p.fn.t(x, y, z);
        const s = smooth(p.split[0], p.split[1], t);
        boneW[p.bone] += w * (1 - s);
        boneW[p.bone2] += w * s;
      } else {
        boneW[p.bone] += w;
      }
    }
    // top 4
    const top = [];
    for (let b = 0; b < 32; b++) if (boneW[b] > 0) top.push([b, boneW[b]]);
    top.sort((a, b) => b[1] - a[1]);
    let sum = 0;
    for (let i = 0; i < Math.min(4, top.length); i++) sum += top[i][1];
    for (let i = 0; i < 4; i++) {
      if (i < top.length) {
        skinIndex[v * 4 + i] = top[i][0];
        skinWeight[v * 4 + i] = top[i][1] / sum;
      }
    }
    label[v] = parts[best].label;
    param[v] = parts[best].fn.t ? parts[best].fn.t(x, y, z) : 0;
  }
  return { skinIndex, skinWeight, label, param };
}

function smooth(a, b, x) {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}
