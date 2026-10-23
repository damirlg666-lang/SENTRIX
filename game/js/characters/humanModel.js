// Character templates, per-person painting (layered clothing) and the skinned mesh.
import * as THREE from 'three';
import { runJob, L, EYE, HAIR_STYLES, hairlineAt } from './modelGen.js';
import { B, BONE_COUNT, makeSkeleton, BODY_TYPES } from './skeleton.js';
import { eyeTexture } from '../engine/textures.js';

export { L, EYE, HAIR_STYLES };

// material detail channel
const D = { SKIN: 0, FABRIC: 1, HAIR: 2, DENIM: 3, LEATHER: 4 };
const PIECE = { BODY: 0, HEAD: 1, HAND: 2, HAIR: 3 };

// ------------------------------------------------------------------ generation (worker pool)
const parts = new Map();
const jobKey = (j) => `${j.kind}|${j.type ?? ''}|${j.female ?? ''}|${j.style ?? ''}|${j.quality}`;

class WorkerPool {
  constructor(n) {
    this.workers = [];
    this.queue = [];
    this.nextId = 1;
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL('./modelWorker.js', import.meta.url), { type: 'module' });
      w.busy = false;
      w.onmessage = (e) => this._done(w, e.data);
      w.onerror = (e) => {
        e.preventDefault?.();
        this._fail(w, new Error('worker failed: ' + (e.message || 'error')));
      };
      this.workers.push(w);
    }
  }

  run(job) {
    return new Promise((resolve, reject) => {
      this.queue.push({ id: this.nextId++, job, resolve, reject });
      this._pump();
    });
  }

  _pump() {
    for (const w of this.workers) {
      if (w.busy || w.dead || !this.queue.length) continue;
      const task = this.queue.shift();
      w.busy = true;
      w.task = task;
      w.postMessage({ id: task.id, job: task.job });
    }
  }

  _done(w, data) {
    const task = w.task;
    w.busy = false;
    w.task = null;
    if (data.error) task.reject(new Error(data.error));
    else task.resolve(data.out);
    this._pump();
  }

  _fail(w, err) {
    w.dead = true;
    if (w.task) w.task.reject(err);
    w.task = null;
    if (this.workers.every((x) => x.dead)) {
      for (const t of this.queue) t.reject(err);
      this.queue.length = 0;
    } else this._pump();
  }

  terminate() {
    for (const w of this.workers) w.terminate();
  }
}

/** Generate all character parts for a quality level, in parallel worker threads when possible. */
export async function prepareModels(quality, onProgress) {
  const jobs = [];
  for (const type of Object.keys(BODY_TYPES)) jobs.push({ kind: 'body', type, quality });
  jobs.push({ kind: 'head', female: false, quality }, { kind: 'head', female: true, quality }, { kind: 'hand', quality });
  for (const style of HAIR_STYLES) if (style !== 'bald') jobs.push({ kind: 'hair', style, quality });
  const todo = jobs.filter((j) => !parts.has(jobKey(j)));
  if (!todo.length) return;
  let pool = null;
  try {
    if (typeof Worker !== 'undefined') pool = new WorkerPool(Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1)));
  } catch (e) {
    console.warn('Model workers unavailable, generating on main thread', e);
  }
  let done = 0;
  await Promise.all(
    todo.map(async (job) => {
      let out;
      if (pool) {
        try {
          out = await pool.run(job);
        } catch (e) {
          console.warn('worker job failed, falling back', e);
          out = runJob(job);
        }
      } else {
        await new Promise((r) => setTimeout(r, 0));
        out = runJob(job);
      }
      parts.set(jobKey(job), out);
      done++;
      onProgress?.(done / todo.length);
    })
  );
  pool?.terminate();
}

function getPart(job) {
  const k = jobKey(job);
  if (!parts.has(k)) parts.set(k, runJob(job));
  return parts.get(k);
}

// ------------------------------------------------------------------ templates
const templateCache = new Map();

export function getTemplate(type, hairStyle, quality) {
  const key = `${type}|${hairStyle}|${quality}`;
  if (templateCache.has(key)) return templateCache.get(key);
  const sk = makeSkeleton(type);
  const female = sk.params.chest === 'female';
  const body = getPart({ kind: 'body', type, quality });
  const head = getPart({ kind: 'head', female, quality });
  const hand = getPart({ kind: 'hand', quality });
  const pieces = [
    bodyPiece(body),
    headLocalPiece(head, sk, head.label, PIECE.HEAD),
    handPiece(hand, sk, 'L'),
    handPiece(hand, sk, 'R'),
  ];
  if (hairStyle !== 'bald') {
    const hair = getPart({ kind: 'hair', style: hairStyle, quality });
    pieces.push(headLocalPiece(hair, sk, null, PIECE.HAIR));
  }
  const tpl = assemble(pieces, sk);
  tpl.type = type;
  tpl.hairStyle = hairStyle;
  templateCache.set(key, tpl);
  return tpl;
}

function bodyPiece(b) {
  const nv = b.positions.length / 3;
  return { ...b, piece: new Uint8Array(nv).fill(PIECE.BODY) };
}

function headLocalPiece(src, sk, labels, piece) {
  const nv = src.positions.length / 3;
  const c = sk.j.headC;
  const hs = sk.params.head;
  const pos = new Float32Array(nv * 3);
  for (let v = 0; v < nv; v++) {
    pos[v * 3] = src.positions[v * 3] * hs + c[0];
    pos[v * 3 + 1] = src.positions[v * 3 + 1] * hs + c[1];
    pos[v * 3 + 2] = src.positions[v * 3 + 2] * hs + c[2];
  }
  const skinIndex = new Uint16Array(nv * 4);
  const skinWeight = new Float32Array(nv * 4);
  for (let v = 0; v < nv; v++) {
    skinIndex[v * 4] = B.HEAD;
    skinWeight[v * 4] = 1;
  }
  const label = labels ? labels : new Uint8Array(nv).fill(L.HAIR);
  return {
    positions: pos, normals: src.normals, indices: src.indices, skinIndex, skinWeight, label,
    param: new Float32Array(nv), piece: new Uint8Array(nv).fill(piece),
  };
}

function handPiece(mesh, sk, S) {
  const s = S === 'L' ? 1 : -1;
  const bone = S === 'L' ? B.HAND_L : B.HAND_R;
  const wr = sk.j['wrist' + S];
  const dir = sk.j['armDir' + S];
  // rotation about Z mapping local -Y onto the arm direction
  const ca = -dir[1];
  const sa = dir[0];
  const hs = sk.params.limb * 0.12 + 0.88;
  const nv = mesh.positions.length / 3;
  const pos = new Float32Array(nv * 3);
  const nrm = new Float32Array(nv * 3);
  for (let v = 0; v < nv; v++) {
    const x = mesh.positions[v * 3] * s * hs;
    const y = mesh.positions[v * 3 + 1] * hs;
    const z = mesh.positions[v * 3 + 2] * hs;
    const nx = mesh.normals[v * 3] * s;
    const ny = mesh.normals[v * 3 + 1];
    pos[v * 3] = x * ca - y * sa + wr[0];
    pos[v * 3 + 1] = x * sa + y * ca + wr[1];
    pos[v * 3 + 2] = z + wr[2];
    nrm[v * 3] = nx * ca - ny * sa;
    nrm[v * 3 + 1] = nx * sa + ny * ca;
    nrm[v * 3 + 2] = mesh.normals[v * 3 + 2];
  }
  let idx = mesh.indices;
  if (s < 0) {
    idx = new Uint32Array(mesh.indices);
    for (let i = 0; i < idx.length; i += 3) {
      const t = idx[i + 1];
      idx[i + 1] = idx[i + 2];
      idx[i + 2] = t;
    }
  }
  const skinIndex = new Uint16Array(nv * 4);
  const skinWeight = new Float32Array(nv * 4);
  for (let v = 0; v < nv; v++) {
    skinIndex[v * 4] = bone;
    skinWeight[v * 4] = 1;
  }
  return {
    positions: pos, normals: nrm, indices: idx, skinIndex, skinWeight,
    label: new Uint8Array(nv).fill(L.HAND), param: new Float32Array(nv), piece: new Uint8Array(nv).fill(PIECE.HAND),
  };
}

function assemble(pieces, sk) {
  let nv = 0;
  let ni = 0;
  for (const p of pieces) {
    nv += p.positions.length / 3;
    ni += p.indices.length;
  }
  const pos = new Float32Array(nv * 3);
  const nrm = new Float32Array(nv * 3);
  const si = new Uint16Array(nv * 4);
  const sw = new Float32Array(nv * 4);
  const label = new Uint8Array(nv);
  const param = new Float32Array(nv);
  const piece = new Uint8Array(nv);
  const index = new Uint32Array(ni);
  let vo = 0;
  let io = 0;
  for (const p of pieces) {
    const n = p.positions.length / 3;
    pos.set(p.positions, vo * 3);
    nrm.set(p.normals, vo * 3);
    si.set(p.skinIndex, vo * 4);
    sw.set(p.skinWeight, vo * 4);
    label.set(p.label, vo);
    param.set(p.param, vo);
    piece.set(p.piece, vo);
    for (let i = 0; i < p.indices.length; i++) index[io + i] = p.indices[i] + vo;
    vo += n;
    io += p.indices.length;
  }
  return {
    sk,
    positions: pos,
    normals: nrm,
    label,
    param,
    piece,
    skinIndex: si,
    normalAttr: new THREE.BufferAttribute(nrm, 3),
    skinIndexAttr: new THREE.BufferAttribute(si, 4),
    skinWeightAttr: new THREE.BufferAttribute(sw, 4),
    indexAttr: new THREE.BufferAttribute(index, 1),
    vertexCount: nv,
  };
}

// ------------------------------------------------------------------ outfits
const SKIN_TONES = [0xf3d2bd, 0xeac0a2, 0xe0b090, 0xd9a582, 0xc68863, 0xa86b47, 0x8a5536, 0x6b3f26, 0x4e2d1c];
const HAIR_COLORS = [0x1c1612, 0x2b1d14, 0x3a2618, 0x4a3020, 0x6e4a2c, 0x9a6b3c, 0xc9a26a, 0xd8c7a0, 0x8f3b1f, 0x8a8a88, 0x101010];
const TOP_COLORS = [0xd8dde3, 0x26303d, 0xb3261e, 0x2e5ea8, 0x3f7a3a, 0xe0a526, 0x6b3a8c, 0x1d1d1f, 0xe7e2d6, 0x2f8f8a, 0xc4561f, 0x7a1f2c, 0x5a6b7a, 0xf0f0ee, 0x93a8c4];
const PANTS_COLORS = [0x2c3e57, 0x1f2a3a, 0x3b4b63, 0x1b1b1d, 0x6b5a45, 0x8c7b5f, 0x4a4f55, 0x2f3a2a, 0x575c63, 0x7c8691];
const SHOE_COLORS = [0x1a1a1a, 0xece9e2, 0x5a3a24, 0x2b2f38, 0x8a1f1f, 0x3a4a6a, 0x6b6f75];
const IRIS = [0x5b3a1e, 0x3a2412, 0x4f7da8, 0x5f8a4e, 0x7a6a3a, 0x6f8d9c];

export function randomOutfit(type, rnd = Math.random) {
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const female = BODY_TYPES[type]?.chest === 'female';
  const hairStyles = female
    ? ['long', 'bob', 'ponytail', 'bun', 'long', 'afro', 'short', 'bob']
    : ['short', 'short', 'buzz', 'bald', 'afro', 'short', 'buzz', 'ponytail'];
  const tops = ['tshirt', 'tshirt', 'vneck', 'longsleeve', 'jacket', 'hoodie', 'tank', 'polo'];
  const bottoms = female ? ['jeans', 'pants', 'shorts', 'skirt', 'jeans', 'skirt'] : ['jeans', 'pants', 'shorts', 'jeans', 'pants'];
  const top = { type: pick(tops), color: pick(TOP_COLORS), color2: pick(TOP_COLORS), trim: rnd() < 0.35 };
  if (top.color2 === top.color) top.color2 = 0xf2f2f0;
  return {
    female,
    skin: pick(SKIN_TONES),
    hair: pick(HAIR_COLORS),
    hairStyle: pick(hairStyles),
    iris: pick(IRIS),
    top,
    bottom: { type: pick(bottoms), color: pick(PANTS_COLORS) },
    shoes: { color: pick(SHOE_COLORS), sole: rnd() < 0.6 ? 0xeeeae2 : 0x2a2a2a },
    socks: rnd() < 0.7 ? 0xf2f2f2 : 0x222222,
    belt: rnd() < 0.55,
    beard: female ? 'none' : pick(['none', 'none', 'stubble', 'beard', 'mustache']),
  };
}

// ------------------------------------------------------------------ painting
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Per-instance vertex data. Clothing is described by signed coverage distances per layer
 * (metres, positive = covered) so the shader can draw crisp hems at any mesh resolution.
 */
export function paintCharacter(tpl, outfit) {
  const sk = tpl.sk;
  const j = sk.j;
  const nv = tpl.vertexCount;
  const P = tpl.positions;
  const N = tpl.normals;
  const pos = new Float32Array(P);
  const col = new Float32Array(nv * 3);
  const mat = new Float32Array(nv * 2);
  const layer = new Float32Array(nv * 4).fill(-1);
  const layer2 = new Float32Array(nv * 2).fill(-1);
  const cloth = new Float32Array(nv * 2).fill(1);
  const face = new Float32Array(nv * 2).fill(-1);

  const skin = new THREE.Color(outfit.skin);
  const hair = new THREE.Color(outfit.hair);
  const shoe = new THREE.Color(outfit.shoes.color);
  const lips = skin.clone().multiply(new THREE.Color(0.88, 0.62, 0.62)).lerp(new THREE.Color(0xa0525a), outfit.female ? 0.4 : 0.18);
  const cheekC = new THREE.Color(0xd77a6a);
  const earC = new THREE.Color(0xd06a5a);
  const c = new THREE.Color();

  const h = sk.height;
  const waistY = j.waist[1] + 0.008;
  const neckY = j.neck[1];
  const hc = j.headC;
  const hs = sk.params.head;
  const sw = sk.params.shoulder;
  const tt = outfit.top.type;
  const bt = outfit.bottom.type;
  const tucked = outfit.belt && (tt === 'tshirt' || tt === 'polo' || tt === 'tank' || tt === 'vneck');
  const hemY = tucked ? waistY + 0.004 : waistY - 0.035;
  const beltY = waistY - 0.012;
  const sleeveU = tt === 'tank' ? -1 : tt === 'longsleeve' || tt === 'jacket' || tt === 'hoodie' ? 0.52 * h : tt === 'polo' ? 0.12 * h : 0.135 * h;
  const legHem = bt === 'shorts' ? j.kneeL[1] + 0.12 : bt === 'skirt' ? j.kneeL[1] + 0.07 : 0.1;
  const topThick = tt === 'jacket' ? 0.0085 : tt === 'hoodie' ? 0.0065 : 0.0034;
  const armpitY = j.chestC[1];
  const strapX = 0.095 * sw;

  const neckLine = (x, z) => {
    let y = neckY - 0.028 + 0.016 * smooth(0.0, -0.05, z);
    const ax = Math.abs(x);
    if (tt === 'vneck') y -= Math.max(0, 0.075 - ax * 1.5) * smooth(0.0, 0.04, z);
    if (tt === 'tank') y -= 0.06 * smooth(0.0, 0.05, z) * (1 - smooth(0.05, 0.09, ax));
    if (tt === 'hoodie') y = neckY + 0.01 - 0.03 * smooth(0.02, 0.06, z) * (1 - smooth(0.0, 0.05, ax));
    if (tt === 'jacket') y = neckY + 0.004 - 0.02 * smooth(0.0, 0.05, z);
    if (tt === 'polo') y = neckY - 0.008 + 0.01 * smooth(0.0, -0.05, z);
    return y;
  };

  for (let v = 0; v < nv; v++) {
    const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
    const lab = tpl.label[v];
    const pc = tpl.piece[v];
    let rough = 0.5;
    let det = D.SKIN;
    let off = 0;
    c.copy(skin);

    if (pc === PIECE.HAIR) {
      c.copy(hair);
      rough = 0.5;
      det = D.HAIR;
    } else if (pc === PIECE.HEAD) {
      const lx = (x - hc[0]) / hs, ly = (y - hc[1]) / hs, lz = (z - hc[2]) / hs;
      if (lab === L.EAR || lab === L.NOSE) c.lerp(earC, 0.08);
      const ck = Math.max(0, 1 - Math.hypot(Math.abs(lx) - 0.044, ly + 0.018, (lz - 0.07) * 0.7) / 0.024);
      c.lerp(cheekC, ck * 0.14);
      if (lab === L.LIPS) {
        c.copy(lips);
        rough = 0.36;
        if (Math.abs(ly + 0.0465) < 0.0017 && Math.abs(lx) < 0.021) c.multiplyScalar(0.42);
      }
      const ax = Math.abs(lx);
      // soften the hairline: skin right under the hair edge picks up some hair colour
      if (outfit.hairStyle !== 'bald' && lab === L.HEAD) {
        const below = hairlineAt(outfit.hairStyle, lx, lz) - ly;
        if (below > -0.02) c.lerp(hair, 0.45 * (1 - smooth(0.0, 0.014, below)));
      }
      // eyebrows: signed coverage (head units scaled to metres)
      const k = Math.min(1, Math.max(0, (ax - 0.011) / 0.042));
      const arch = 0.033 + 0.0075 * Math.sin(Math.PI * k) - k * 0.002;
      const thick = (outfit.female ? 0.0027 : 0.004) * (1 - k * 0.55);
      face[v * 2] = Math.min(thick - Math.abs(ly - arch), ax - 0.011, 0.053 - ax, lz - 0.06) * hs;
      // beard / stubble / mustache region
      if (outfit.beard !== 'none' && lab !== L.LIPS && lab !== L.NOSE) {
        const hole = 1 - Math.hypot(lx / 0.028, (ly + 0.047) / 0.017);
        let jaw = -0.004 - Math.max(0, 0.052 - ax) * 0.85 - ly;
        jaw = Math.min(jaw, lz + 0.015, -hole * 0.01, ly + 0.098);
        const must = Math.min(0.03 - ax, ly + 0.038, -0.026 - ly, lz - 0.08);
        const sBeard = outfit.beard === 'mustache' ? must : Math.max(jaw, must);
        face[v * 2 + 1] = sBeard * hs;
        if (outfit.beard === 'beard' || outfit.beard === 'mustache') off = 0.0032 * smooth(-0.002, 0.003, sBeard * hs);
      }
    } else if (pc === PIECE.BODY) {
      const bone = tpl.skinIndex[v * 4];
      const isArmL = bone === B.UARM_L || bone === B.FARM_L || bone === B.HAND_L;
      const isArmR = bone === B.UARM_R || bone === B.FARM_R || bone === B.HAND_R;
      const isLeg = bone >= B.THIGH_L;
      if (lab === L.FOOT) c.copy(shoe);
      // Coverage is split into linear fields (hem, neckline, sleeve end...) that the shader
      // combines per pixel, so hems stay crisp even where they cross mesh triangles.
      let sBottom = -1, sTopRest = 1, sTop2 = -1, torso = -1, leg = -1, neck = 1, sleeve = 1;
      if (isLeg) {
        sBottom = y - legHem;
        sTopRest = -1;
        leg = 1;
      } else if (isArmL || isArmR) {
        const S = isArmL ? 'L' : 'R';
        const sh = j['shoulder' + S];
        const d = j['armDir' + S];
        const u = (x - sh[0]) * d[0] + (y - sh[1]) * d[1] + (z - sh[2]) * d[2];
        sleeve = sleeveU - u;
      } else {
        sBottom = waistY - y;
        sTopRest = y - hemY;
        neck = neckLine(x, z) - y;
        if (tt === 'tank') sTopRest = Math.min(sTopRest, Math.max(strapX - Math.abs(x), armpitY - y));
        const sTop = Math.min(sTopRest, neck);
        if (tt === 'jacket') sTop2 = Math.min(0.034 - Math.abs(x), z - 0.012, sTop + 0.02);
        else if (tt === 'hoodie') sTop2 = Math.min(sTop, hemY + 0.045 - y);
        else if (tt === 'polo') sTop2 = Math.min(0.012 - Math.abs(x), y - (j.chestC[1] + 0.045), z - 0.03, sTop + 0.01);
        if (tucked) torso = 1;
      }
      layer[v * 4] = sBottom;
      layer[v * 4 + 1] = sTopRest;
      layer[v * 4 + 2] = sTop2;
      layer[v * 4 + 3] = torso;
      layer2[v * 2] = leg;
      cloth[v * 2] = neck;
      cloth[v * 2 + 1] = sleeve;
      const sTop = Math.min(sTopRest, neck, sleeve);
      const sBelt = torso > 0 ? 0.0115 - Math.abs(y - beltY) : -1;
      const sSock = leg > 0 ? 0.2 - y : -1;
      // cloth thickness: cumulative over covering layers, ramped so hems form a soft step
      let bottomThick = bt === 'jeans' ? 0.0042 : 0.0038;
      if (bt === 'skirt' && isLeg) bottomThick += Math.max(0, waistY - 0.1 - y) * 0.06;
      off += 0.0012 * smooth(-0.004, 0.004, sSock);
      off += bottomThick * smooth(-0.004, 0.005, sBottom);
      off += topThick * smooth(-0.004, 0.005, sTop);
      off += 0.0045 * smooth(-0.003, 0.003, sBelt);
    }
    col[v * 3] = c.r;
    col[v * 3 + 1] = c.g;
    col[v * 3 + 2] = c.b;
    mat[v * 2] = rough;
    mat[v * 2 + 1] = det;
    if (off) {
      pos[v * 3] += N[v * 3] * off;
      pos[v * 3 + 1] += N[v * 3 + 1] * off;
      pos[v * 3 + 2] += N[v * 3 + 2] * off;
    }
  }
  return { pos, col, mat, layer, layer2, cloth, face };
}

// ------------------------------------------------------------------ material
const LAYER_COUNT = 6; // socks, shoes, bottom, top, top2, belt

function layerSettings(outfit) {
  const bt = outfit.bottom.type;
  const tt = outfit.top.type;
  const whiteShoe = outfit.shoes.color === 0xece9e2;
  const colors = [
    new THREE.Color(outfit.socks),
    new THREE.Color(outfit.shoes.color),
    new THREE.Color(outfit.bottom.color),
    new THREE.Color(outfit.top.color),
    new THREE.Color(outfit.top.color2),
    new THREE.Color(0x2a1c12),
  ];
  const mats = [
    new THREE.Vector2(0.9, D.FABRIC),
    new THREE.Vector2(whiteShoe ? 0.7 : 0.4, whiteShoe ? D.FABRIC : D.LEATHER),
    new THREE.Vector2(bt === 'jeans' ? 0.82 : 0.86, bt === 'jeans' ? D.DENIM : D.FABRIC),
    new THREE.Vector2(tt === 'jacket' ? 0.48 : 0.9, D.FABRIC),
    new THREE.Vector2(0.9, D.FABRIC),
    new THREE.Vector2(0.38, D.LEATHER),
  ];
  return { colors, mats, sole: new THREE.Color(outfit.shoes.sole) };
}

const VERT_HEAD = `#include <common>
attribute vec2 aMat;
attribute vec4 aLayer;
attribute vec2 aLayer2;
attribute vec2 aDamage;
attribute vec2 aFace;
attribute vec2 aCloth;
varying vec2 vFace;
varying vec2 vCloth;
varying vec2 vMat;
varying vec4 vLayer;
varying vec2 vLayer2;
varying vec2 vDamage;
varying vec3 vBind;`;

const FRAG_HEAD = `#include <common>
uniform vec3 uLayerColor[${LAYER_COUNT}];
uniform vec2 uLayerMat[${LAYER_COUNT}];
uniform vec3 uSole;
uniform float uPale;
uniform vec3 uHair;
uniform float uBeard;
uniform vec2 uTrim;
uniform float uBeltY;
varying vec2 vFace;
varying vec2 vCloth;
varying vec2 vMat;
varying vec4 vLayer;
varying vec2 vLayer2;
varying vec2 vDamage;
varying vec3 vBind;
vec2 gMat;
float h3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float n3(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float cover(float s) { return clamp(0.5 + s / max(fwidth(s), 1e-5), 0.0, 1.0); }
vec3 perturbN(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection) {
  vec3 vSigmaX = normalize(dFdx(surf_pos.xyz));
  vec3 vSigmaY = normalize(dFdy(surf_pos.xyz));
  vec3 vN = surf_norm;
  vec3 R1 = cross(vSigmaY, vN);
  vec3 R2 = cross(vN, vSigmaX);
  float fDet = dot(vSigmaX, R1) * faceDirection;
  vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
  return normalize(abs(fDet) * surf_norm - vGrad);
}`;

const FRAG_COLOR = `
vec3 col = vColor.rgb;
gMat = vMat;
float skinAmt = 1.0 - step(0.5, vMat.y);
col = mix(col, col * vec3(0.78, 0.8, 0.86) + vec3(0.03, 0.03, 0.05), uPale * skinAmt * 0.55);
float a;
a = cover(vFace.x); col = mix(col, uHair * 0.85, a); gMat = mix(gMat, vec2(0.6, 2.0), a);
a = cover(vFace.y) * uBeard; col = mix(col, uHair * 0.92, a); gMat = mix(gMat, vec2(0.6, 2.0), step(0.5, uBeard) * a);
// every coverage value is a min/max of linearly interpolated fields, evaluated per pixel
float legs = vLayer2.x;
a = cover(min(legs, 0.2 - vBind.y)); col = mix(col, uLayerColor[0], a); gMat = mix(gMat, uLayerMat[0], a);
a = cover(min(legs, 0.113 - vBind.y));
float sole = cover(0.022 - vBind.y);
col = mix(col, mix(uLayerColor[1], uSole, sole), a); gMat = mix(gMat, mix(uLayerMat[1], vec2(0.85, 1.0), sole), a);
a = cover(vLayer.x); col = mix(col, uLayerColor[2], a); gMat = mix(gMat, uLayerMat[2], a);
float top = min(vLayer.y, min(vCloth.x, vCloth.y));
a = cover(top); col = mix(col, uLayerColor[3], a); gMat = mix(gMat, uLayerMat[3], a);
float top2 = max(vLayer.z, min(top, max(uTrim.x - vCloth.x, uTrim.y - vCloth.y)));
a = cover(top2); col = mix(col, uLayerColor[4], a); gMat = mix(gMat, uLayerMat[4], a);
a = cover(min(vLayer.w, 0.0115 - abs(vBind.y - uBeltY))); col = mix(col, uLayerColor[5], a); gMat = mix(gMat, uLayerMat[5], a);
float blood = clamp(vDamage.x, 0.0, 1.0);
float burn = clamp(vDamage.y, 0.0, 1.0);
col = mix(col, vec3(0.28, 0.015, 0.02), blood * 0.92);
col *= 1.0 - burn * 0.82;
gMat.x = mix(gMat.x, 0.22, blood * 0.85);
diffuseColor.rgb *= col;`;

const FRAG_DETAIL = `#include <normal_fragment_maps>
{
  float det = gMat.y;
  float fp = max(length(fwidth(vBind)), 1e-5);
  float hgt = 0.0;
  if (det > 0.5 && det < 1.5) {
    hgt = 0.0016 * n3(vBind * vec3(16.0, 34.0, 16.0)) * (1.0 - smoothstep(0.15, 0.45, 34.0 * fp));
    hgt += 0.00012 * n3(vBind * 380.0) * (1.0 - smoothstep(0.15, 0.45, 380.0 * fp));
  } else if (det > 1.5 && det < 2.5) {
    hgt = 0.00022 * n3(vBind * vec3(700.0, 60.0, 700.0)) * (1.0 - smoothstep(0.15, 0.45, 700.0 * fp));
    hgt += 0.0009 * n3(vBind * vec3(110.0, 20.0, 110.0)) * (1.0 - smoothstep(0.15, 0.45, 110.0 * fp));
  } else if (det > 2.5 && det < 3.5) {
    hgt = 0.0013 * n3(vBind * vec3(14.0, 28.0, 14.0)) * (1.0 - smoothstep(0.15, 0.45, 28.0 * fp));
    hgt += 0.00011 * n3(vBind * vec3(520.0, 260.0, 520.0)) * (1.0 - smoothstep(0.15, 0.45, 520.0 * fp));
  } else if (det > 3.5) {
    hgt = 0.00008 * n3(vBind * 300.0) * (1.0 - smoothstep(0.15, 0.45, 300.0 * fp));
  } else {
    hgt = 0.00004 * n3(vBind * 600.0) * (1.0 - smoothstep(0.15, 0.45, 600.0 * fp));
  }
  vec2 dH = vec2(dFdx(hgt), dFdy(hgt)) / fp;
  normal = perturbN(-vViewPosition, normal, dH, faceDirection);
}`;

function patchShader(shader) {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', VERT_HEAD)
    .replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\nvMat = aMat;\nvLayer = aLayer;\nvLayer2 = aLayer2;\nvDamage = aDamage;\nvFace = aFace;\nvCloth = aCloth;\nvBind = position;'
    );
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', FRAG_HEAD)
    .replace('#include <color_fragment>', FRAG_COLOR)
    .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = roughness * gMat.x;')
    .replace('#include <normal_fragment_maps>', FRAG_DETAIL);
}

function trimWidths(outfit) {
  const tt = outfit.top.type;
  if (tt === 'hoodie') return new THREE.Vector2(-1, 0.045);
  if (outfit.top.trim && tt === 'tshirt') return new THREE.Vector2(0.013, 0.013);
  if (outfit.top.trim && tt === 'vneck') return new THREE.Vector2(0.013, -1);
  return new THREE.Vector2(-1, -1);
}

function beltHeight(outfit) {
  // must match paintCharacter: belts sit just under the waistline of tucked tops
  const sk = makeSkeleton(outfit.bodyType || 'male');
  return sk.j.waist[1] + 0.008 - 0.012;
}

/** Per-person material (the compiled program is shared; uniforms are per instance). */
export function makeCharacterMaterial(outfit) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  const ls = layerSettings(outfit);
  m.userData.uniforms = {
    uLayerColor: { value: ls.colors },
    uLayerMat: { value: ls.mats },
    uSole: { value: ls.sole },
    uPale: { value: 0 },
    uHair: { value: new THREE.Color(outfit.hair) },
    uBeard: { value: outfit.beard === 'stubble' ? 0.3 : outfit.beard === 'none' ? 0 : 1 },
    uTrim: { value: trimWidths(outfit) },
    uBeltY: { value: beltHeight(outfit) },
  };
  m.onBeforeCompile = function (shader) {
    Object.assign(shader.uniforms, this.userData.uniforms);
    patchShader(shader);
  };
  m.customProgramCacheKey = () => 'ragdoll-character-v4';
  return m;
}

const eyeMats = new Map();
function eyeMaterial(iris) {
  if (!eyeMats.has(iris)) {
    eyeMats.set(iris, new THREE.MeshPhysicalMaterial({ map: eyeTexture(iris), roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.03 }));
  }
  return eyeMats.get(iris);
}

let eyeGeo = null;
let lidGeo = null;

function lidGeometry(skinHex) {
  if (!lidGeo) lidGeo = new THREE.SphereGeometry(EYE.r * 1.12, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  const n = lidGeo.attributes.position.count;
  const colors = new Float32Array(n * 3);
  const skinC = new THREE.Color(skinHex).multiplyScalar(0.93);
  for (let i = 0; i < n; i++) {
    colors[i * 3] = skinC.r;
    colors[i * 3 + 1] = skinC.g;
    colors[i * 3 + 2] = skinC.b;
  }
  const mat = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) mat[i * 2] = 0.55;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', lidGeo.attributes.position);
  g.setAttribute('normal', lidGeo.attributes.normal);
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.setAttribute('aMat', new THREE.BufferAttribute(mat, 2));
  g.setAttribute('aLayer', new THREE.BufferAttribute(new Float32Array(n * 4).fill(-1), 4));
  g.setAttribute('aLayer2', new THREE.BufferAttribute(new Float32Array(n * 2).fill(-1), 2));
  g.setAttribute('aDamage', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  g.setAttribute('aFace', new THREE.BufferAttribute(new Float32Array(n * 2).fill(-1), 2));
  g.setAttribute('aCloth', new THREE.BufferAttribute(new Float32Array(n * 2).fill(1), 2));
  g.setIndex(lidGeo.index);
  return g;
}

/**
 * Build the renderable character: root group with flat bones (driven by physics bodies),
 * skinned mesh, eyes and eyelids.
 */
export function createCharacterMesh(type, outfit, quality = 'high') {
  const tpl = getTemplate(type, outfit.hairStyle, quality);
  const sk = tpl.sk;
  const painted = paintCharacter(tpl, outfit);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(painted.pos, 3));
  geo.setAttribute('normal', tpl.normalAttr);
  geo.setAttribute('color', new THREE.BufferAttribute(painted.col, 3));
  geo.setAttribute('aMat', new THREE.BufferAttribute(painted.mat, 2));
  geo.setAttribute('aLayer', new THREE.BufferAttribute(painted.layer, 4));
  geo.setAttribute('aLayer2', new THREE.BufferAttribute(painted.layer2, 2));
  geo.setAttribute('aFace', new THREE.BufferAttribute(painted.face, 2));
  geo.setAttribute('aCloth', new THREE.BufferAttribute(painted.cloth, 2));
  const damage = new THREE.BufferAttribute(new Float32Array(tpl.vertexCount * 2), 2);
  damage.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aDamage', damage);
  geo.setAttribute('skinIndex', tpl.skinIndexAttr);
  geo.setAttribute('skinWeight', tpl.skinWeightAttr);
  geo.setIndex(tpl.indexAttr);
  geo.computeBoundingSphere();

  const material = makeCharacterMaterial({ ...outfit, bodyType: type });
  const root = new THREE.Group();
  const bones = [];
  const inverses = [];
  for (let i = 0; i < BONE_COUNT; i++) {
    const b = new THREE.Bone();
    const c = sk.centers[i];
    b.position.set(c[0], c[1], c[2]);
    bones.push(b);
    root.add(b);
    inverses.push(new THREE.Matrix4().makeTranslation(-c[0], -c[1], -c[2]));
  }
  const skeleton = new THREE.Skeleton(bones, inverses);
  const mesh = new THREE.SkinnedMesh(geo, material);
  mesh.bind(skeleton, new THREE.Matrix4());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  root.add(mesh);

  if (!eyeGeo) eyeGeo = new THREE.SphereGeometry(EYE.r, 24, 16).rotateX(Math.PI / 2);
  const head = bones[B.HEAD];
  const hs = sk.params.head;
  const eyeMat = eyeMaterial(outfit.iris);
  const lg = lidGeometry(outfit.skin);
  const eyes = [];
  const lids = [];
  for (const s of [-1, 1]) {
    const e = new THREE.Mesh(eyeGeo, eyeMat);
    e.position.set(s * EYE.x * hs, EYE.y * hs, EYE.z * hs);
    e.scale.setScalar(hs);
    head.add(e);
    eyes.push(e);
    const lid = new THREE.Mesh(lg, material);
    lid.position.copy(e.position);
    lid.scale.setScalar(hs);
    lid.rotation.x = -0.45;
    head.add(lid);
    lids.push(lid);
  }
  return { root, mesh, bones, skeleton, eyes, lids, template: tpl, outfit, geometry: geo, material, damage };
}

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();

/**
 * Paint blood (channel 0) or burns (channel 1) around a world-space point on a bone.
 */
export function paintDamage(ch, bone, worldPoint, radius, amount, channel = 0) {
  const tpl = ch.template;
  const c = tpl.sk.centers[bone];
  _m.copy(ch.bones[bone].matrixWorld).invert();
  _p.copy(worldPoint).applyMatrix4(_m);
  const bx = _p.x + c[0], by = _p.y + c[1], bz = _p.z + c[2];
  const pos = ch.geometry.attributes.position.array;
  const dmg = ch.damage.array;
  const r2 = radius * radius;
  let changed = false;
  for (let v = 0, n = tpl.vertexCount; v < n; v++) {
    const dx = pos[v * 3] - bx;
    const dy = pos[v * 3 + 1] - by;
    const dz = pos[v * 3 + 2] - bz;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > r2) continue;
    const f = 1 - Math.sqrt(d2) / radius;
    const i = v * 2 + channel;
    dmg[i] = Math.min(1, dmg[i] + amount * (0.35 + f * 0.65) * (channel === 0 ? 1 : f));
    changed = true;
  }
  if (changed) ch.damage.needsUpdate = true;
  return changed;
}

export function clearDamage(ch) {
  ch.damage.array.fill(0);
  ch.damage.needsUpdate = true;
}
