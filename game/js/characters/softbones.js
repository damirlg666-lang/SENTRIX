// Damage that changes a body's shape: a broken jaw that hangs open, fractured limbs that kink
// and wobble in the middle of the bone, eyes knocked out of their sockets dangling on the
// optic nerve, and wound holes sitting on the skin. Jaw and fractures are extra skin bones
// added to that person's skeleton; everything is cosmetic on top of the ragdoll physics.
import * as THREE from 'three';
import { B, BONE_COUNT } from './skeleton.js';
import { ensureOwnSkin, wetMaterial } from './gore.js';
import { PIECE, L, EYE, paintBind } from './humanModel.js';
import { merge } from '../util/geo.js';
import { woundHole } from '../engine/textures.js';

const _q = new THREE.Quaternion();
const _qi = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function bodyFrame(person, bone) {
  const b = person.ragdoll.bodies[bone];
  const t = b.translation();
  const r = b.rotation();
  _q.set(r.x, r.y, r.z, r.w);
  _qi.copy(_q).invert();
  return { b, t: new THREE.Vector3(t.x, t.y, t.z) };
}

// ------------------------------------------------------------------ extra skin bones
/**
 * Add a bone to one person's skeleton. It hangs off `parent` (a ragdoll bone) and turns about
 * `pivot` (bind space); `weightOf(v)` says how much of each vertex it takes over.
 */
export function addSkinBone(ch, parent, pivot, weightOf) {
  ensureOwnSkin(ch);
  const index = ch.bones.length;
  const bone = new THREE.Bone();
  ch.root.add(bone);
  ch.bones.push(bone);
  const inverses = ch.skeleton.boneInverses.map((m) => m.clone());
  inverses.push(new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z));
  const old = ch.skeleton;
  ch.skeleton = new THREE.Skeleton(ch.bones, inverses);
  ch.mesh.bind(ch.skeleton, ch.mesh.bindMatrix);
  old.dispose();
  const si = ch.geometry.attributes.skinIndex.array;
  const sw = ch.geometry.attributes.skinWeight.array;
  for (let v = 0, n = ch.template.vertexCount; v < n; v++) {
    let w = weightOf(v);
    if (!(w > 0.002)) continue;
    w = Math.min(1, w);
    let lo = 0;
    let hi = 0;
    for (let k = 0; k < 4; k++) {
      sw[v * 4 + k] *= 1 - w;
      if (sw[v * 4 + k] < sw[v * 4 + lo]) lo = k;
      if (sw[v * 4 + k] > sw[v * 4 + hi]) hi = k;
    }
    // the new bone takes the weakest slot; whatever weight that slot had goes to the strongest
    if (lo !== hi) sw[v * 4 + hi] += sw[v * 4 + lo];
    si[v * 4 + lo] = index;
    sw[v * 4 + lo] = w;
  }
  ch.geometry.attributes.skinIndex.needsUpdate = true;
  ch.geometry.attributes.skinWeight.needsUpdate = true;
  const e = { index, parent, pivot: pivot.clone(), bone, offset: new THREE.Vector3(), rot: new THREE.Quaternion() };
  (ch.extra ??= []).push(e);
  return e;
}

/** Where a bone's local frame sits in bind space (main bones: their centre; extra: their pivot). */
function boneOrigin(person, index) {
  if (index < BONE_COUNT) {
    const c = person.sk.centers[index];
    return new THREE.Vector3(c[0], c[1], c[2]);
  }
  return person.ch.extra[index - BONE_COUNT].pivot.clone();
}

function syncExtraBones(person) {
  const ch = person.ch;
  for (const e of ch.extra) {
    const { t } = bodyFrame(person, e.parent);
    const c = person.sk.centers[e.parent];
    _v.set(e.pivot.x - c[0] + e.offset.x, e.pivot.y - c[1] + e.offset.y, e.pivot.z - c[2] + e.offset.z).applyQuaternion(_q);
    e.bone.position.copy(t).add(_v);
    e.bone.quaternion.copy(_q).multiply(e.rot);
  }
}

// ------------------------------------------------------------------ broken jaw
let teethGeo = null;
const teethMat = () => (teethGeo.mat ??= new THREE.MeshStandardMaterial({ color: 0xeee6d2, roughness: 0.35 }));
function teethRow(y) {
  const parts = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 9 - 0.5) * 2.2;
    const g = new THREE.BoxGeometry(0.0065, 0.008, 0.004);
    g.rotateY(a);
    g.translate(Math.sin(a) * 0.026, y, 0.034 + Math.cos(a) * 0.026);
    parts.push(g);
  }
  return merge(parts);
}

export function breakJaw(person) {
  const ch = person.ch;
  if (!ch || ch.jaw) return false;
  const sk = person.sk;
  const tpl = ch.template;
  const hc = sk.j.headC;
  const hs = sk.params.head;
  const P = ch.geometry.attributes.position.array;
  const pivot = new THREE.Vector3(hc[0], hc[1] - 0.012 * hs, hc[2] - 0.014 * hs);
  const jaw = addSkinBone(ch, B.HEAD, pivot, (v) => {
    if (tpl.piece[v] !== PIECE.HEAD || tpl.label[v] === L.NECK) return 0;
    const ly = (P[v * 3 + 1] - hc[1]) / hs;
    const lz = (P[v * 3 + 2] - hc[2]) / hs;
    return smooth(-0.04, -0.053, ly) * smooth(-0.04, -0.005, lz);
  });
  if (!teethGeo) teethGeo = { upper: teethRow(-0.041), lower: teethRow(-0.051) };
  const upper = new THREE.Mesh(teethGeo.upper, teethMat());
  upper.scale.setScalar(hs);
  ch.bones[B.HEAD].add(upper);
  const lower = new THREE.Mesh(teethGeo.lower, teethMat());
  lower.scale.setScalar(hs);
  // jaw bone frame: origin at the pivot
  lower.position.set(hc[0] - pivot.x, hc[1] - pivot.y, hc[2] - pivot.z);
  jaw.bone.add(lower);
  jaw.th = 0.1;
  jaw.w = 2.5;
  jaw.parts = [upper, lower];
  ch.jaw = jaw;
  if (ch.material.side !== THREE.DoubleSide) {
    ch.material.side = THREE.DoubleSide;
    ch.material.needsUpdate = true;
  }
  return true;
}

function updateJaw(person, dt) {
  const j = person.ch.jaw;
  const { b } = bodyFrame(person, B.HEAD);
  // the hanging jaw lags behind the head's movement
  const v = b.linvel();
  const a = _w.set(v.x - (j.pv?.x ?? v.x), v.y - (j.pv?.y ?? v.y), v.z - (j.pv?.z ?? v.z)).multiplyScalar(1 / Math.max(dt, 1e-3)).applyQuaternion(_qi);
  j.pv = { x: v.x, y: v.y, z: v.z };
  const g = _v.set(0, -1, 0).applyQuaternion(_qi);
  const target = j.healed ? 0 : 0.42 + 0.3 * Math.max(0, -g.z) - 0.25 * Math.max(0, g.z);
  const acc = 70 * (target - j.th) - 5 * j.w + (j.healed ? 0 : -a.y * 0.05 + a.z * 0.03);
  j.w += acc * dt;
  j.th = THREE.MathUtils.clamp(j.th + j.w * dt, 0, 1.1);
  j.rot.setFromAxisAngle(X, j.th);
}

// ------------------------------------------------------------------ fractures
const LIMB_RADIUS = { [B.UARM_L]: 0.045, [B.UARM_R]: 0.045, [B.FARM_L]: 0.037, [B.FARM_R]: 0.037, [B.THIGH_L]: 0.07, [B.THIGH_R]: 0.07, [B.SHIN_L]: 0.05, [B.SHIN_R]: 0.05 };

function boneEnds(sk, bone) {
  const j = sk.j;
  const S = [B.UARM_L, B.FARM_L, B.THIGH_L, B.SHIN_L].includes(bone) ? 'L' : 'R';
  const pairs = {
    [B.UARM_L]: ['shoulder', 'elbow'], [B.UARM_R]: ['shoulder', 'elbow'],
    [B.FARM_L]: ['elbow', 'wrist'], [B.FARM_R]: ['elbow', 'wrist'],
    [B.THIGH_L]: ['hip', 'knee'], [B.THIGH_R]: ['hip', 'knee'],
    [B.SHIN_L]: ['knee', 'ankle'], [B.SHIN_R]: ['knee', 'ankle'],
  }[bone];
  return pairs.map((k) => new THREE.Vector3(...j[k + S]));
}

let shardGeo = null;

/** A fracture in the middle of a limb bone: the limb kinks there and wobbles like jelly. */
export function addFracture(person, bone) {
  const ch = person.ch;
  if (!ch || !(bone in LIMB_RADIUS) || (ch.fractures ??= []).some((f) => f.parent === bone)) return null;
  const [a, b] = boneEnds(person.sk, bone);
  const axis = b.clone().sub(a);
  const len2 = axis.lengthSq();
  const P = ch.geometry.attributes.position.array;
  const si = ch.geometry.attributes.skinIndex.array;
  const sw = ch.geometry.attributes.skinWeight.array;
  const c = person.sk.centers[bone];
  const e = addSkinBone(ch, bone, new THREE.Vector3(c[0], c[1], c[2]), (v) => {
    let wb = 0;
    for (let k = 0; k < 4; k++) if (si[v * 4 + k] === bone) wb += sw[v * 4 + k];
    if (wb < 0.25) return 0;
    const t = ((P[v * 3] - a.x) * axis.x + (P[v * 3 + 1] - a.y) * axis.y + (P[v * 3 + 2] - a.z) * axis.z) / len2;
    const tent = 1 - Math.abs(2 * t - 1);
    return tent > 0 ? wb * Math.pow(tent, 1.3) : 0;
  });
  e.axis = axis.normalize();
  const perp = new THREE.Vector3().crossVectors(e.axis, new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)).normalize();
  e.rest = perp.clone().multiplyScalar(0.045 + Math.random() * 0.02);
  e.offset.copy(e.rest);
  e.vel = new THREE.Vector3();
  // bruising around the break
  const mid0 = a.clone().add(b).multiplyScalar(0.5);
  if (!person.dummy) {
    paintBind(ch, mid0.x, mid0.y, mid0.z, 0.07, 0.3, 0);
    paintBind(ch, mid0.x, mid0.y, mid0.z, 0.06, 0.35, 1);
  }
  // sometimes the bone breaks through the skin
  if (Math.random() < 0.4 && !person.dummy) {
    shardGeo ??= new THREE.ConeGeometry(0.007, 0.05, 6).translate(0, 0.025, 0);
    const shard = new THREE.Mesh(shardGeo, wetMaterial(0xe8dfc9));
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const r = LIMB_RADIUS[bone] * (bone === B.THIGH_L || bone === B.THIGH_R ? person.sk.params.girth : person.sk.params.limb);
    shard.position.set(mid.x - c[0], mid.y - c[1], mid.z - c[2]).addScaledVector(perp, r * 0.75);
    shard.quaternion.setFromUnitVectors(Y, perp.clone().addScaledVector(e.axis, 0.4).normalize());
    e.bone.add(shard);
    e.shard = shard;
  }
  ch.fractures.push(e);
  return e;
}

function updateFractures(person, dt) {
  for (const f of person.ch.fractures) {
    const { b } = bodyFrame(person, f.parent);
    const v = b.linvel();
    // the loose middle of the bone swings against the limb's own acceleration and sags under gravity
    const acc = _w.set(v.x - (f.pv?.x ?? v.x), v.y - (f.pv?.y ?? v.y), v.z - (f.pv?.z ?? v.z)).multiplyScalar(1 / Math.max(dt, 1e-3)).applyQuaternion(_qi);
    f.pv = { x: v.x, y: v.y, z: v.z };
    const g = _v.set(0, -9.81, 0).applyQuaternion(_qi);
    const rest = f.healed ? _v.set(0, 0, 0) : f.rest;
    const force = new THREE.Vector3()
      .subVectors(rest, f.offset).multiplyScalar(110)
      .addScaledVector(f.vel, -6)
      .addScaledVector(acc, f.healed ? 0 : -0.35)
      .addScaledVector(g, f.healed ? 0 : 0.35);
    force.addScaledVector(f.axis, -force.dot(f.axis));
    f.vel.addScaledVector(force, Math.min(dt, 1 / 30));
    f.offset.addScaledVector(f.vel, Math.min(dt, 1 / 30));
    f.offset.addScaledVector(f.axis, -f.offset.dot(f.axis));
    if (f.offset.length() > 0.09) f.offset.setLength(0.09);
  }
}

// ------------------------------------------------------------------ eyes
let nerveGeo = null;
let socketGeo = null;

/** Knock an eye out of its socket; it hangs on the optic nerve. */
export function popEye(person, i = Math.random() < 0.5 ? 0 : 1) {
  const ch = person.ch;
  if (!ch) return false;
  ch.popped ??= [];
  if (ch.popped.some((p) => p.i === i)) i = 1 - i;
  if (ch.popped.some((p) => p.i === i)) return false;
  const eye = ch.eyes[i];
  const hs = person.sk.params.head;
  const socket = eye.position.clone();
  nerveGeo ??= new THREE.CylinderGeometry(0.0022, 0.0028, 1, 6).translate(0, 0.5, 0);
  socketGeo ??= new THREE.SphereGeometry(1, 12, 8);
  const hole = new THREE.Mesh(socketGeo, wetMaterial(0x2a0404));
  hole.scale.setScalar(EYE.r * hs * 0.95);
  hole.position.copy(socket).addScaledVector(Z, -0.003 * hs);
  const nerve = new THREE.Mesh(nerveGeo, wetMaterial(0x9a3232));
  const head = ch.bones[B.HEAD];
  head.add(hole, nerve);
  const { t } = bodyFrame(person, B.HEAD);
  const pos = socket.clone().addScaledVector(Z, 0.01).applyQuaternion(_q).add(t);
  const fwd = Z.clone().applyQuaternion(_q);
  const vel = fwd.multiplyScalar(1.4).add(new THREE.Vector3((Math.random() - 0.5) * 0.8, 0.4, (Math.random() - 0.5) * 0.8));
  ch.popped.push({ i, eye, socket, len: (0.045 + Math.random() * 0.03) * hs, pos, vel, hole, nerve });
  if (!person.dummy && person.game.settings?.blood !== false) person.game.fx?.bloodBurst(pos, fwd, 0.4);
  return true;
}

function updateEyes(person, dt) {
  const { t } = bodyFrame(person, B.HEAD);
  const step = Math.min(dt, 1 / 30);
  for (const p of person.ch.popped) {
    const S = _w.copy(p.socket).applyQuaternion(_q).add(t);
    p.vel.y -= 9.81 * step;
    p.vel.multiplyScalar(Math.exp(-1.6 * step));
    p.pos.addScaledVector(p.vel, step);
    const d = _v.subVectors(p.pos, S);
    const l = d.length();
    if (l > p.len) {
      d.multiplyScalar(1 / l);
      p.pos.copy(S).addScaledVector(d, p.len);
      const out = p.vel.dot(d);
      if (out > 0) p.vel.addScaledVector(d, -out);
    }
    const local = p.pos.clone().sub(t).applyQuaternion(_qi);
    p.eye.position.copy(local);
    const dir = local.clone().sub(p.socket);
    const dl = dir.length();
    if (dl > 1e-4) {
      dir.multiplyScalar(1 / dl);
      p.eye.quaternion.setFromUnitVectors(Z, dir);
      p.nerve.position.copy(p.socket);
      p.nerve.quaternion.setFromUnitVectors(Y, dir);
    }
    p.nerve.scale.set(1, Math.max(0.001, dl - EYE.r * person.sk.params.head * 0.8), 1);
  }
}

// ------------------------------------------------------------------ wound holes
let holeGeo = null;
let holeMat = null;

/**
 * Find where a shot along `dir` actually meets the skin (the physics capsules only roughly
 * follow the mesh): the first front-facing vertex close to the ray, in bind space.
 */
function skinHit(person, part, point, dir) {
  const ch = person.ch;
  const { t } = bodyFrame(person, part);
  const c = person.sk.centers[part];
  const o = point.clone().sub(t).applyQuaternion(_qi).add(_v.set(c[0], c[1], c[2]));
  const d = dir.clone().applyQuaternion(_qi).normalize();
  const origin = o.clone().addScaledVector(d, -0.15);
  const P = ch.geometry.attributes.position.array;
  const N = ch.template.normals;
  let best = Infinity;
  let bi = -1;
  let near = Infinity;
  let ni = -1;
  for (let v = 0, n = ch.template.vertexCount; v < n; v++) {
    const wx = P[v * 3] - origin.x, wy = P[v * 3 + 1] - origin.y, wz = P[v * 3 + 2] - origin.z;
    const along = wx * d.x + wy * d.y + wz * d.z;
    if (along < 0 || along > 0.35) continue;
    const perp2 = wx * wx + wy * wy + wz * wz - along * along;
    if (perp2 < near) {
      near = perp2;
      ni = v;
    }
    if (perp2 > 0.00012 || along >= best) continue;
    if (N[v * 3] * d.x + N[v * 3 + 1] * d.y + N[v * 3 + 2] * d.z > -0.05) continue;
    best = along;
    bi = v;
  }
  const v = bi >= 0 ? bi : ni;
  if (v < 0) return null;
  const si = ch.geometry.attributes.skinIndex.array;
  const sw = ch.geometry.attributes.skinWeight.array;
  let bone = si[v * 4];
  for (let k = 1; k < 4; k++) if (sw[v * 4 + k] > sw[v * 4]) bone = si[v * 4 + k];
  return { p: new THREE.Vector3(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]), n: new THREE.Vector3(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]), bone };
}

/** A hole where a bullet (or blade, `slit`) went in or out. `dir` points into the body. */
export function addWoundHole(person, part, point, dir, size = 0.02, slit = false) {
  const ch = person.ch;
  if (!ch || !point || !dir) return;
  const hit = skinHit(person, part, point, dir);
  if (!hit) return;
  holeGeo ??= new THREE.PlaneGeometry(1, 1);
  holeMat ??= new THREE.MeshStandardMaterial({ map: woundHole(), transparent: true, depthWrite: false, roughness: 0.3, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const m = new THREE.Mesh(holeGeo, holeMat);
  m.renderOrder = 2;
  m.castShadow = false;
  m.position.copy(hit.p).sub(boneOrigin(person, hit.bone)).addScaledVector(hit.n, 0.0012);
  m.quaternion.setFromUnitVectors(Z, hit.n).multiply(new THREE.Quaternion().setFromAxisAngle(Z, Math.random() * Math.PI * 2));
  m.scale.set(size * (slit ? 1.8 : 1), size * (slit ? 0.45 : 1), 1);
  ch.bones[hit.bone].add(m);
  (ch.holes ??= []).push(m);
  if (ch.holes.length > 40) ch.holes.shift().removeFromParent();
}

// ------------------------------------------------------------------ per frame / healing
export function updateSoft(person, dt) {
  const ch = person.ch;
  if (!ch || dt <= 0) return;
  if (ch.jaw) updateJaw(person, dt);
  if (ch.fractures?.length) updateFractures(person, dt);
  if (ch.extra) syncExtraBones(person);
  if (ch.popped?.length) updateEyes(person, dt);
}

/** Healing sets the jaw and bones straight, puts eyes back and closes the holes. */
export function healSoft(person) {
  const ch = person.ch;
  if (!ch) return;
  if (ch.jaw) ch.jaw.healed = true;
  for (const f of ch.fractures ?? []) {
    f.healed = true;
    f.shard?.removeFromParent();
  }
  for (const p of ch.popped ?? []) {
    p.eye.position.copy(p.socket);
    p.eye.quaternion.identity();
    p.hole.removeFromParent();
    p.nerve.removeFromParent();
  }
  if (ch.popped) ch.popped.length = 0;
  for (const h of ch.holes ?? []) h.removeFromParent();
  if (ch.holes) ch.holes.length = 0;
}

/** Which part of the head a world point is on (head-local units). */
export function headLocal(person, point) {
  const { t } = bodyFrame(person, B.HEAD);
  return point.clone().sub(t).applyQuaternion(_qi).multiplyScalar(1 / person.sk.params.head);
}
