// Quadric-error mesh simplification using half-edge collapses (a vertex merges into one of
// its neighbours, so surviving vertices keep their original position, normal and skinning).
// Runs inside the model worker; no three.js dependency.

class Heap {
  constructor() {
    this.cost = [];
    this.u = [];
    this.v = [];
    this.su = [];
    this.sv = [];
  }

  get size() {
    return this.cost.length;
  }

  push(cost, u, v, su, sv) {
    const c = this.cost, U = this.u, V = this.v, SU = this.su, SV = this.sv;
    let i = c.length;
    c.push(cost);
    U.push(u);
    V.push(v);
    SU.push(su);
    SV.push(sv);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (c[p] <= c[i]) break;
      this.swap(i, p);
      i = p;
    }
  }

  swap(a, b) {
    for (const arr of [this.cost, this.u, this.v, this.su, this.sv]) {
      const t = arr[a];
      arr[a] = arr[b];
      arr[b] = t;
    }
  }

  pop() {
    const c = this.cost;
    const top = { cost: c[0], u: this.u[0], v: this.v[0], su: this.su[0], sv: this.sv[0] };
    const last = c.length - 1;
    if (last > 0) this.swap(0, last);
    for (const arr of [this.cost, this.u, this.v, this.su, this.sv]) arr.pop();
    let i = 0;
    const n = c.length;
    for (;;) {
      const l = i * 2 + 1;
      const r = l + 1;
      let m = i;
      if (l < n && c[l] < c[m]) m = l;
      if (r < n && c[r] < c[m]) m = r;
      if (m === i) break;
      this.swap(i, m);
      i = m;
    }
    return top;
  }
}

/**
 * Simplify a closed triangle mesh.
 * opts: { ratio: keep fraction of vertices, maxError: max distance (m), penalty(u, v) }
 * Returns { remap: Int32Array (old vertex -> new index or -1), indices: Uint32Array, count }.
 */
export function decimate(positions, indices, opts = {}) {
  const nv = positions.length / 3;
  const nf = indices.length / 3;
  const P = positions;
  const F = new Int32Array(indices);
  const faceAlive = new Uint8Array(nf).fill(1);
  const vAlive = new Uint8Array(nv).fill(1);
  const stamp = new Int32Array(nv);
  const vf = new Array(nv);
  for (let i = 0; i < nv; i++) vf[i] = [];
  for (let f = 0; f < nf; f++) for (let k = 0; k < 3; k++) vf[F[f * 3 + k]].push(f);

  // per-vertex quadrics (symmetric 4x4 stored as 10 values)
  const Q = new Float64Array(nv * 10);
  const fn = new Float64Array(3);
  const faceNormal = (a, b, c, out) => {
    const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
    const ux = P[b * 3] - ax, uy = P[b * 3 + 1] - ay, uz = P[b * 3 + 2] - az;
    const vx = P[c * 3] - ax, vy = P[c * 3 + 1] - ay, vz = P[c * 3 + 2] - az;
    out[0] = uy * vz - uz * vy;
    out[1] = uz * vx - ux * vz;
    out[2] = ux * vy - uy * vx;
    const l = Math.hypot(out[0], out[1], out[2]);
    if (l > 0) {
      out[0] /= l;
      out[1] /= l;
      out[2] /= l;
    }
    return l;
  };
  for (let f = 0; f < nf; f++) {
    const a = F[f * 3], b = F[f * 3 + 1], c = F[f * 3 + 2];
    if (faceNormal(a, b, c, fn) === 0) continue;
    const [x, y, z] = fn;
    const d = -(x * P[a * 3] + y * P[a * 3 + 1] + z * P[a * 3 + 2]);
    const q = [x * x, x * y, x * z, x * d, y * y, y * z, y * d, z * z, z * d, d * d];
    for (const v of [a, b, c]) for (let k = 0; k < 10; k++) Q[v * 10 + k] += q[k];
  }
  const vertexError = (u, v, target) => {
    // error of placing the merged vertex at `target` under Q_u + Q_v
    const x = P[target * 3], y = P[target * 3 + 1], z = P[target * 3 + 2];
    const qa = u * 10, qb = v * 10;
    const q = (k) => Q[qa + k] + Q[qb + k];
    return (
      q(0) * x * x + 2 * q(1) * x * y + 2 * q(2) * x * z + 2 * q(3) * x +
      q(4) * y * y + 2 * q(5) * y * z + 2 * q(6) * y +
      q(7) * z * z + 2 * q(8) * z + q(9)
    );
  };
  const penalty = opts.penalty || (() => 0);
  const heap = new Heap();
  const pushEdge = (a, b) => {
    const cAB = vertexError(a, b, b) + penalty(a, b); // a collapses into b
    const cBA = vertexError(a, b, a) + penalty(b, a);
    if (cAB <= cBA) heap.push(cAB, a, b, stamp[a], stamp[b]);
    else heap.push(cBA, b, a, stamp[b], stamp[a]);
  };
  const seen = new Set();
  for (let f = 0; f < nf; f++) {
    for (let k = 0; k < 3; k++) {
      const a = F[f * 3 + k], b = F[f * 3 + ((k + 1) % 3)];
      const key = a < b ? a * nv + b : b * nv + a;
      if (seen.has(key)) continue;
      seen.add(key);
      pushEdge(a, b);
    }
  }

  const liveFaces = (v) => {
    const list = vf[v];
    let w = 0;
    for (let i = 0; i < list.length; i++) if (faceAlive[list[i]]) list[w++] = list[i];
    list.length = w;
    return list;
  };
  const neighbours = (v, out) => {
    out.clear();
    for (const f of liveFaces(v)) for (let k = 0; k < 3; k++) {
      const w = F[f * 3 + k];
      if (w !== v) out.add(w);
    }
    return out;
  };

  const target = Math.max(8, Math.floor(nv * (opts.ratio ?? 0.4)));
  const maxCost = (opts.maxError ?? Infinity) ** 2;
  let alive = nv;
  const nu = new Set();
  const nvv = new Set();
  const nOld = new Float64Array(3);
  const nNew = new Float64Array(3);
  while (alive > target && heap.size) {
    const e = heap.pop();
    const { u, v } = e;
    if (!vAlive[u] || !vAlive[v] || e.su !== stamp[u] || e.sv !== stamp[v]) continue;
    if (e.cost > maxCost) break;
    // shared faces must be exactly two (manifold interior edge)
    const fu = liveFaces(u);
    let shared = 0;
    const opp = [];
    for (const f of fu) {
      const a = F[f * 3], b = F[f * 3 + 1], c = F[f * 3 + 2];
      if (a === v || b === v || c === v) {
        shared++;
        opp.push(a !== u && a !== v ? a : b !== u && b !== v ? b : c);
      }
    }
    if (shared !== 2) continue;
    // link condition keeps the surface manifold
    neighbours(u, nu);
    neighbours(v, nvv);
    let common = 0;
    for (const w of nu) if (nvv.has(w)) common++;
    if (common !== 2) continue;
    // reject collapses that fold triangles over
    let ok = true;
    for (const f of fu) {
      const a = F[f * 3], b = F[f * 3 + 1], c = F[f * 3 + 2];
      if (a === v || b === v || c === v) continue;
      faceNormal(a, b, c, nOld);
      const na = a === u ? v : a, nb = b === u ? v : b, nc = c === u ? v : c;
      const area = faceNormal(na, nb, nc, nNew);
      if (area < 1e-12 || nOld[0] * nNew[0] + nOld[1] * nNew[1] + nOld[2] * nNew[2] < 0.35) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    // collapse u -> v
    for (const f of fu) {
      const a = F[f * 3], b = F[f * 3 + 1], c = F[f * 3 + 2];
      if (a === v || b === v || c === v) {
        faceAlive[f] = 0;
        continue;
      }
      for (let k = 0; k < 3; k++) if (F[f * 3 + k] === u) F[f * 3 + k] = v;
      vf[v].push(f);
    }
    vAlive[u] = 0;
    alive--;
    for (let k = 0; k < 10; k++) Q[v * 10 + k] += Q[u * 10 + k];
    // only edges touching v changed cost; bumping v's stamp invalidates their old entries
    stamp[u]++;
    stamp[v]++;
    for (const w of neighbours(v, nvv)) pushEdge(v, w);
  }

  const remap = new Int32Array(nv).fill(-1);
  let count = 0;
  for (let i = 0; i < nv; i++) if (vAlive[i]) remap[i] = count++;
  const out = [];
  for (let f = 0; f < nf; f++) {
    if (!faceAlive[f]) continue;
    const a = remap[F[f * 3]], b = remap[F[f * 3 + 1]], c = remap[F[f * 3 + 2]];
    if (a < 0 || b < 0 || c < 0 || a === b || b === c || a === c) continue;
    out.push(a, b, c);
  }
  return { remap, indices: new Uint32Array(out), count };
}

/** Apply a remap to a per-vertex attribute array with `size` components. */
export function compact(array, size, remap, count) {
  const out = new array.constructor(count * size);
  for (let i = 0; i < remap.length; i++) {
    const j = remap[i];
    if (j < 0) continue;
    for (let k = 0; k < size; k++) out[j * size + k] = array[i * size + k];
  }
  return out;
}
