// Pure geometry generation for characters (no three.js dependency so it can run in a worker).
// Bodies are generated per body type in bind (world) space; heads, hands and hair are generated
// in local frames and placed per body type when the template is assembled.
import { SDFModel, meshSDF, skinFromParts, roundCone, capsule, sphere, ellipsoid, roundBox, rotMat } from './sdf.js';
import { B, makeSkeleton, ARM_ANGLE } from './skeleton.js';

export const L = {
  HEAD: 1, LIPS: 2, HAIR: 4, HAND: 5, NECK: 6, TORSO: 7, UARM: 8, FARM: 9, PELVIS: 10,
  THIGH: 11, SHIN: 12, FOOT: 13, EAR: 14, NOSE: 15, GLUTE: 16, BELLY: 17,
};

export const QUALITY_CELLS = {
  high: { body: 0.0112, head: 0.0042, hand: 0.0033, hair: 0.0052 },
  medium: { body: 0.0138, head: 0.0052, hand: 0.004, hair: 0.0062 },
  low: { body: 0.018, head: 0.0068, hand: 0.0052, hair: 0.008 },
};

export const EYE = { x: 0.0315, y: 0.012, z: 0.0738, r: 0.0128 };

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sc = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const norm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / l, a[1] / l, a[2] / l];
};
const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// ------------------------------------------------------------------ body
function bodyModel(sk) {
  const p = sk.params;
  const j = sk.j;
  const h = sk.height;
  const Y = (y) => y * h;
  const g = p.girth;
  const sg = Math.sqrt(g);
  const m = new SDFModel();

  // pelvis & hips
  m.add(ellipsoid([0, Y(0.96), -0.01], [0.15 * p.hip, 0.105, 0.105 * Math.max(1, p.belly * 0.85)]), { bone: B.PELVIS, label: L.PELVIS, k: 0.04 });
  for (const s of [-1, 1]) {
    m.add(ellipsoid([s * 0.064 * p.hip, Y(0.9), -0.058 * sg], [0.073 * p.hip, 0.085, 0.066 * g]), { bone: B.PELVIS, label: L.GLUTE, k: 0.035 });
    m.add(ellipsoid([s * 0.12 * p.hip, Y(0.93), 0.0], [0.05 * p.hip, 0.08, 0.075]), { bone: B.PELVIS, label: L.PELVIS, k: 0.04 });
  }
  m.add(ellipsoid([0, Y(1.0), 0.028 * p.belly], [0.125 * p.waist, 0.08, 0.075 * p.belly]), { bone: B.PELVIS, label: L.PELVIS, k: 0.04 });
  // abdomen
  m.add(ellipsoid([0, Y(1.11), 0.006], [0.133 * p.waist, 0.13, 0.09 * Math.max(1, p.belly * 0.9)]), { bone: B.SPINE, label: L.BELLY, k: 0.05 });
  if (p.belly > 1.15) {
    m.add(ellipsoid([0, Y(1.065), 0.045 * p.belly], [0.13 * p.waist, 0.12, 0.085 * p.belly]), { bone: B.SPINE, bone2: B.PELVIS, split: [0.4, 0.9], label: L.BELLY, k: 0.06 });
  }
  // ribcage + shoulder girdle
  m.add(ellipsoid([0, Y(1.295), -0.006], [0.158 * p.shoulder * sg, 0.165, 0.106 * g]), { bone: B.CHEST, label: L.TORSO, k: 0.05 });
  m.add(capsule([-0.115 * p.shoulder, Y(1.4), -0.02], [0.115 * p.shoulder, Y(1.4), -0.02], 0.07 * sg), { bone: B.CHEST, label: L.TORSO, k: 0.05 });
  for (const s of [-1, 1]) {
    m.add(ellipsoid([s * 0.075 * p.shoulder, Y(1.35), -0.07 * g], [0.06, 0.085, 0.045]), { bone: B.CHEST, label: L.TORSO, k: 0.04 });
    m.add(roundCone([0, Y(1.47), -0.035], [s * 0.14 * p.shoulder, Y(1.425), -0.022], 0.048 * sg, 0.04 * sg), { bone: B.CHEST, label: L.TORSO, k: 0.04 });
    if (p.chest === 'female') {
      m.add(ellipsoid([s * 0.07 * p.shoulder, Y(1.305), 0.074], [0.064, 0.062, 0.056], rotMat(-0.25, 0, 0)), { bone: B.CHEST, label: L.TORSO, k: 0.045 });
    } else {
      m.add(ellipsoid([s * 0.068 * p.shoulder, Y(1.35), 0.056 * g], [0.078 * p.shoulder, 0.055, 0.03 * g], rotMat(0, 0, s * 0.12)), { bone: B.CHEST, label: L.TORSO, k: 0.05 });
    }
  }
  // neck (blends chest -> head)
  m.add(roundCone([0, Y(1.4), -0.024], [0, Y(1.575), -0.002], 0.058 * sg, 0.049), { bone: B.CHEST, bone2: B.HEAD, split: [0.45, 0.9], label: L.NECK, k: 0.035, sigma: 0.02 });

  for (const [S, s] of [['L', 1], ['R', -1]]) {
    const uarm = S === 'L' ? B.UARM_L : B.UARM_R;
    const farm = S === 'L' ? B.FARM_L : B.FARM_R;
    const sh = j['shoulder' + S];
    const el = j['elbow' + S];
    const wr = j['wrist' + S];
    const R = rotMat(0, 0, s * ARM_ANGLE);
    const lw = p.limb;
    m.add(ellipsoid(add(sh, [s * 0.012, -0.012, 0]), [0.058 * sg, 0.068, 0.06 * sg], R), { bone: uarm, label: L.UARM, k: 0.04, sigma: 0.016 });
    m.add(roundCone(sh, el, 0.047 * lw, 0.037 * lw), { bone: uarm, label: L.UARM, k: 0.03 });
    m.add(ellipsoid(add(lerp3(sh, el, 0.45), [0, 0, 0.01]), [0.04 * lw, 0.07, 0.042 * lw], R), { bone: uarm, label: L.UARM, k: 0.03 });
    m.add(roundCone(el, wr, 0.039 * lw, 0.028 * lw), { bone: farm, label: L.FARM, k: 0.03 });
    m.add(ellipsoid(lerp3(el, wr, 0.28), [0.041 * lw, 0.07, 0.036 * lw], R), { bone: farm, label: L.FARM, k: 0.03 });
  }

  for (const [S, s] of [['L', 1], ['R', -1]]) {
    const thigh = S === 'L' ? B.THIGH_L : B.THIGH_R;
    const shin = S === 'L' ? B.SHIN_L : B.SHIN_R;
    const foot = S === 'L' ? B.FOOT_L : B.FOOT_R;
    const hip = j['hip' + S];
    const knee = j['knee' + S];
    const ankle = j['ankle' + S];
    const toe = j['toe' + S];
    const lw = p.limb;
    m.add(roundCone(add(hip, [s * 0.01, 0.03, -0.004]), knee, 0.088 * g, 0.054 * lw), { bone: thigh, label: L.THIGH, k: 0.05 });
    m.add(ellipsoid(add(lerp3(hip, knee, 0.42), [s * 0.008, 0, 0.018]), [0.066 * g, 0.16, 0.064 * g]), { bone: thigh, label: L.THIGH, k: 0.04 });
    m.add(sphere(add(knee, [0, 0.0, 0.016]), 0.05 * lw), { bone: shin, label: L.SHIN, k: 0.03, sigma: 0.02 });
    m.add(roundCone(knee, add(ankle, [0, 0.03, 0]), 0.05 * lw, 0.033 * lw), { bone: shin, label: L.SHIN, k: 0.03 });
    m.add(ellipsoid(add(lerp3(knee, ankle, 0.3), [0, 0, -0.026]), [0.048 * g, 0.1, 0.05 * g]), { bone: shin, label: L.SHIN, k: 0.04 });
    const heel = [ankle[0], 0.05, ankle[2] - 0.045];
    m.add(ellipsoid(ankle, [0.042, 0.05, 0.048]), { bone: foot, label: L.FOOT, k: 0.03 });
    m.add(roundCone(heel, add(toe, [0, -0.005, 0]), 0.05, 0.04), { bone: foot, label: L.FOOT, k: 0.035 });
    const mid = lerp3(heel, toe, 0.5);
    m.add(roundBox([mid[0], 0.03, mid[2]], [0.048, 0.03, 0.12], 0.022), { bone: foot, label: L.FOOT, k: 0.02 });
  }
  m.clip = (x, y) => -y; // flat soles
  return m;
}

// ------------------------------------------------------------------ head (local frame, unit scale)
function headModel(female) {
  const m = new SDFModel();
  const o = (label, k) => ({ bone: B.HEAD, label, k });
  const jaw = female ? 0.9 : 1.0;
  const brow = female ? 0.72 : 1.0;
  m.add(ellipsoid([0, 0.03, -0.014], [0.077, 0.094, 0.1]), o(L.HEAD, 0.03));
  m.add(ellipsoid([0, -0.006, 0.03], [0.066, 0.083, 0.075]), o(L.HEAD, 0.04));
  m.add(ellipsoid([0, -0.052, 0.02], [0.057 * jaw, 0.042, 0.062]), o(L.HEAD, 0.035));
  m.add(ellipsoid([0, -0.086, 0.064], [0.021 * jaw, 0.017, 0.017]), o(L.HEAD, 0.025));
  m.add(ellipsoid([0, -0.04, 0.074], [0.036, 0.03, 0.027]), o(L.HEAD, 0.03));
  for (const s of [-1, 1]) {
    m.add(ellipsoid([s * 0.043, 0.0, 0.06], [0.022, 0.018, 0.02]), o(L.HEAD, 0.02));
    m.add(ellipsoid([s * 0.075, 0.003, -0.008], [0.012, 0.029, 0.019], rotMat(0, s * 0.35, s * 0.1)), o(L.EAR, 0.008));
  }
  m.add(capsule([-0.037, 0.035, 0.081], [0.037, 0.035, 0.081], 0.0112 * brow), o(L.HEAD, 0.02));
  m.add(roundCone([0, 0.03, 0.088], [0, -0.012, 0.108], 0.0078, 0.0102), o(L.NOSE, 0.012));
  m.add(sphere([0, -0.016, 0.106], 0.012 * (female ? 0.92 : 1)), o(L.NOSE, 0.01));
  for (const s of [-1, 1]) m.add(ellipsoid([s * 0.0125, -0.021, 0.097], [0.009, 0.0075, 0.0085]), o(L.NOSE, 0.007));
  const lip = female ? 1.18 : 1.0;
  m.add(ellipsoid([0, -0.0405, 0.093], [0.022, 0.0072 * lip, 0.009 * lip]), o(L.LIPS, 0.007));
  m.add(ellipsoid([0, -0.0525, 0.09], [0.019, 0.0078 * lip, 0.0088 * lip]), o(L.LIPS, 0.007));
  for (const s of [-1, 1]) {
    m.add(ellipsoid([s * EYE.x, EYE.y, 0.082], [0.0195, 0.0138, 0.012]), { sub: true, k: 0.01, label: L.HEAD });
    m.add(ellipsoid([s * 0.081, 0.003, -0.004], [0.006, 0.018, 0.011], rotMat(0, s * 0.35, 0)), { sub: true, k: 0.004, label: L.EAR });
  }
  m.add(roundCone([0, -0.03, -0.02], [0, -0.105, -0.028], 0.046, 0.044), o(L.NECK, 0.03));
  return m;
}

// ------------------------------------------------------------------ hand (left, local frame)
function handModel() {
  // wrist at origin, fingers toward -Y, palm facing -X, thumb toward +Z
  const m = new SDFModel();
  const o = { bone: 0, label: L.HAND };
  m.add(roundCone([0, 0.03, 0], [0, -0.012, 0], 0.029, 0.026), { ...o, k: 0.012 });
  m.add(roundBox([0.0, -0.05, 0.0], [0.0135, 0.046, 0.04], 0.012), { ...o, k: 0.012 });
  m.add(ellipsoid([-0.008, -0.034, 0.025], [0.012, 0.026, 0.017]), { ...o, k: 0.012 });
  const zs = [0.0285, 0.0095, -0.0095, -0.0275];
  const lens = [0.072, 0.08, 0.075, 0.06];
  const rads = [0.0088, 0.009, 0.0086, 0.0077];
  for (let i = 0; i < 4; i++) {
    const base = [0.0015, -0.088 + (i === 3 ? 0.006 : 0), zs[i]];
    const d1 = norm([-0.16, -1, zs[i] * 1.6]);
    const d2 = norm([-0.6, -0.8, zs[i] * 1.2]);
    const e1 = add(base, sc(d1, lens[i] * 0.55));
    const e2 = add(e1, sc(d2, lens[i] * 0.45));
    m.add(roundCone(base, e1, rads[i], rads[i] * 0.93), { ...o, k: 0.005 });
    m.add(roundCone(e1, e2, rads[i] * 0.93, rads[i] * 0.8), { ...o, k: 0.004 });
  }
  const tb = [-0.007, -0.03, 0.03];
  const t1 = add(tb, sc(norm([-0.35, -0.62, 0.55]), 0.04));
  const t2 = add(t1, sc(norm([-0.6, -0.72, 0.15]), 0.034));
  m.add(roundCone(tb, t1, 0.0125, 0.0108), { ...o, k: 0.008 });
  m.add(roundCone(t1, t2, 0.0108, 0.0092), { ...o, k: 0.004 });
  return m;
}

// ------------------------------------------------------------------ hair (head-local frame)
export const HAIR_STYLES = ['short', 'buzz', 'long', 'bob', 'ponytail', 'bun', 'afro', 'bald'];

function hairModel(style) {
  const m = new SDFModel();
  const o = { bone: B.HEAD, label: L.HAIR };
  let front = 0.06;
  let back = -0.042;
  let shell = [0.0865, 0.1035, 0.1095];
  if (style === 'buzz') {
    shell = [0.0802, 0.097, 0.1032];
    front = 0.054;
  }
  m.add(ellipsoid([0, 0.033, -0.016], shell), { ...o, k: 0.02 });
  if (style === 'short') {
    m.add(ellipsoid([0.014, 0.09, 0.04], [0.064, 0.034, 0.05]), { ...o, k: 0.035 });
    m.add(ellipsoid([0, 0.07, -0.05], [0.07, 0.045, 0.06]), { ...o, k: 0.035 });
  }
  if (style === 'long' || style === 'bob') {
    const len = style === 'long' ? 0.135 : 0.075;
    m.add(ellipsoid([0, -0.01, -0.03], [0.092, 0.07 + len * 0.6, 0.094]), { ...o, k: 0.04 });
    m.add(ellipsoid([0.0, 0.062, 0.07], [0.072, 0.032, 0.042]), { ...o, k: 0.03 });
    back = -0.05 - len;
    front = 0.052;
  }
  if (style === 'ponytail') {
    m.add(roundCone([0, 0.03, -0.112], [0, -0.13, -0.155], 0.03, 0.012), { ...o, k: 0.02 });
    m.add(sphere([0, 0.035, -0.114], 0.019), { ...o, k: 0.01 });
  }
  if (style === 'bun') {
    m.add(sphere([0, 0.098, -0.082], 0.042), { ...o, k: 0.015 });
  }
  if (style === 'afro') {
    m.add(ellipsoid([0, 0.058, -0.012], [0.118, 0.12, 0.128]), { ...o, k: 0.03 });
    front = 0.066;
  }
  const faceCut = ellipsoid([0, -0.03, 0.08], [0.064, 0.1, 0.06]);
  const longish = style === 'long' || style === 'bob' || style === 'afro';
  const clumps = style === 'afro' ? 0.004 : style === 'buzz' ? 0.0006 : 0.0018;
  m.clip = (x, y, z) => {
    const line = back + (front - back) * smoothstep(-0.07, 0.085, z);
    // dip at the temples so the hairline is not a straight cut
    const temple = 0.012 * smoothstep(0.03, 0.06, Math.abs(x)) * smoothstep(0.0, 0.07, z);
    let d = line + temple - y;
    if (!longish) {
      const ear = Math.hypot(Math.abs(x) - 0.075, y - 0.0, z + 0.006) - 0.033;
      d = Math.max(d, -ear);
    } else {
      d = Math.max(d, -faceCut(x, y, z));
    }
    d += Math.sin(x * 230 + z * 40) * Math.sin(y * 210) * Math.sin(z * 240 + x * 30) * clumps;
    return d;
  };
  return m;
}

// ------------------------------------------------------------------ meshing
function boundsOf(model, pad) {
  const mn = [1e9, 1e9, 1e9];
  const mx = [-1e9, -1e9, -1e9];
  for (const p of model.parts) {
    if (p.sub) continue;
    const b = p.fn.aabb;
    for (let i = 0; i < 3; i++) {
      mn[i] = Math.min(mn[i], b[i] - p.k - pad);
      mx[i] = Math.max(mx[i], b[i + 3] + p.k + pad);
    }
  }
  return [mn, mx];
}

function meshModel(model, cell, extraPad = 0.01) {
  const [mn, mx] = boundsOf(model, cell * 2 + extraPad);
  return meshSDF(model, mn, mx, cell);
}

function cellsFor(quality) {
  return QUALITY_CELLS[quality] || QUALITY_CELLS.high;
}

/** Skinned body for a body type, in bind space. */
export function genBody(typeName, quality) {
  const sk = makeSkeleton(typeName);
  const m = bodyModel(sk);
  const mesh = meshModel(m, cellsFor(quality).body, 0.02);
  const skin = skinFromParts(m, mesh.positions);
  return { ...mesh, ...skin };
}

/** Head in head-local space (unit scale), with labels. */
export function genHead(female, quality) {
  const m = headModel(female);
  const mesh = meshModel(m, cellsFor(quality).head, 0.004);
  const { label } = skinFromParts(m, mesh.positions);
  return { ...mesh, label };
}

/** Left hand in wrist-local space. */
export function genHand(quality) {
  return meshModel(handModel(), cellsFor(quality).hand, 0.004);
}

/** Hair in head-local space. */
export function genHair(style, quality) {
  return meshModel(hairModel(style), cellsFor(quality).hair, 0.012);
}

/** Run a generation job by name (used by the worker and the synchronous fallback). */
export function runJob(job) {
  switch (job.kind) {
    case 'body':
      return genBody(job.type, job.quality);
    case 'head':
      return genHead(job.female, job.quality);
    case 'hand':
      return genHand(job.quality);
    case 'hair':
      return genHair(job.style, job.quality);
    default:
      throw new Error('unknown job ' + job.kind);
  }
}
