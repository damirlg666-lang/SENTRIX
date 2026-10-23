// Bladed weapons: knife, sword and axe models (shared by the first-person weapons and the
// physical props), and what a blade does when it meets a person.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { R } from '../engine/physics.js';
import { merge } from '../util/geo.js';
import * as TX from '../engine/textures.js';
import { nearestJoint, cutFactor, sever, breakBone } from '../entities/injury.js';

const mats = {};
const M = {
  steel: () => new THREE.MeshStandardMaterial({ color: 0xd9dee4, metalness: 1, roughness: 0.2 }),
  darkSteel: () => new THREE.MeshStandardMaterial({ color: 0x5b6066, metalness: 0.9, roughness: 0.38 }),
  polymer: () => new THREE.MeshStandardMaterial({ color: 0x1f2022, roughness: 0.7, normalMap: TX.bumpNoise(128, 40, 1.2, 51) }),
  leather: () => new THREE.MeshStandardMaterial({ color: 0x4a2c1a, roughness: 0.8, normalMap: TX.bumpNoise(128, 30, 2, 52) }),
  brass: () => new THREE.MeshStandardMaterial({ color: 0xb48a3e, metalness: 1, roughness: 0.32 }),
  wood: () => {
    const w = TX.woodPlanks(256, 1, 29);
    return new THREE.MeshStandardMaterial({ map: w.map, normalMap: w.normalMap, roughness: 0.6, color: 0xb98a5a });
  },
};
const mat = (k) => (mats[k] ??= M[k]());

/** Extrude a blade outline (x = width, y = length) so it points down -Z, thin along Y. */
function bladeGeo(shape, thick, bevel) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: true, bevelThickness: thick * 0.45, bevelSize: bevel, bevelSegments: 2, curveSegments: 10 });
  g.translate(0, 0, -thick / 2);
  g.rotateX(-Math.PI / 2);
  g.computeVertexNormals();
  return g;
}

function mesh(geo, m) {
  const o = new THREE.Mesh(geo, mat(m));
  o.castShadow = true;
  o.receiveShadow = true;
  return o;
}

// Models: grip at the origin, blade pointing down -Z, flat of the blade facing +Y.
export function knifeModel() {
  const L = 0.17, W = 0.028;
  const s = new THREE.Shape();
  s.moveTo(-W * 0.5, 0);
  s.lineTo(-W * 0.5, L * 0.8);
  s.quadraticCurveTo(-W * 0.48, L * 0.94, -W * 0.16, L);
  s.quadraticCurveTo(W * 0.52, L * 0.78, W * 0.5, L * 0.32);
  s.lineTo(W * 0.5, 0);
  const g = new THREE.Group();
  g.add(mesh(bladeGeo(s, 0.0026, 0.0012), 'steel'));
  g.add(mesh(new RoundedBoxGeometry(0.042, 0.014, 0.01, 2, 0.003), 'darkSteel'));
  g.add(mesh(new RoundedBoxGeometry(0.024, 0.02, 0.11, 2, 0.007).translate(0, 0, 0.06), 'polymer'));
  const rivets = [0.03, 0.085].map((z) => new THREE.CylinderGeometry(0.0035, 0.0035, 0.022, 10).translate(0, 0, z));
  g.add(mesh(merge(rivets), 'brass'));
  return g;
}

export function swordModel() {
  const L = 0.78, W = 0.046;
  const s = new THREE.Shape();
  s.moveTo(-W / 2, 0);
  s.lineTo(-W / 2 * 0.86, L - 0.1);
  s.lineTo(0, L);
  s.lineTo(W / 2 * 0.86, L - 0.1);
  s.lineTo(W / 2, 0);
  const g = new THREE.Group();
  g.add(mesh(bladeGeo(s, 0.004, 0.003), 'steel'));
  const guard = new RoundedBoxGeometry(0.21, 0.024, 0.026, 2, 0.008);
  const caps = [-1, 1].map((k) => new THREE.SphereGeometry(0.017, 12, 8).translate(k * 0.105, 0, 0));
  g.add(mesh(merge([guard, ...caps]), 'brass'));
  g.add(mesh(new THREE.CylinderGeometry(0.014, 0.016, 0.17, 14).rotateX(Math.PI / 2).translate(0, 0, 0.098), 'leather'));
  g.add(mesh(new THREE.SphereGeometry(0.026, 16, 12).scale(1, 0.8, 1).translate(0, 0, 0.198), 'brass'));
  return g;
}

export function axeModel() {
  const g = new THREE.Group();
  const handle = new THREE.CylinderGeometry(0.019, 0.016, 0.74, 14).rotateX(Math.PI / 2).translate(0, 0, -0.29);
  const knob = new THREE.SphereGeometry(0.022, 12, 8).scale(1, 1, 0.7).translate(0, 0, 0.075);
  g.add(mesh(merge([handle, knob]), 'wood'));
  // head profile: u runs out from the handle to the edge, v along the handle
  const s = new THREE.Shape();
  s.moveTo(-0.03, -0.045);
  s.lineTo(0.045, -0.042);
  s.quadraticCurveTo(0.1, -0.045, 0.158, -0.095);
  s.quadraticCurveTo(0.19, -0.005, 0.158, 0.075);
  s.quadraticCurveTo(0.1, 0.04, 0.045, 0.042);
  s.lineTo(-0.03, 0.045);
  s.lineTo(-0.03, -0.045);
  const head = new THREE.ExtrudeGeometry(s, { depth: 0.022, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.003, bevelSegments: 2, curveSegments: 12 });
  head.translate(0, 0, -0.011);
  // u -> -Y (the edge faces forward when the axe is raised), v -> +Z, extrusion -> -X
  head.applyMatrix4(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(-1, 0, 0)));
  head.translate(0, 0, -0.6);
  head.computeVertexNormals();
  g.add(mesh(head, 'darkSteel'));
  return g;
}

// ------------------------------------------------------------------ hitting people
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/**
 * A blade meets a person. opts: { kind: 'stab'|'slash'|'chop', damage, sever (0..1 chance on a
 * limb), breakChance, impulse }.
 */
export function bladeHit(game, e, part, point, dir, opts) {
  const kind = opts.kind;
  e.damage({ amount: opts.damage, part, point, dir, kind: 'cut', bleed: kind === 'stab' ? 1.6 : 1.2 });
  if (opts.impulse) {
    const b = e.bodies[part];
    if (b?.isDynamic()) b.applyImpulseAtPoint({ x: dir.x * opts.impulse, y: dir.y * opts.impulse, z: dir.z * opts.impulse }, { x: point.x, y: point.y, z: point.z }, true);
  }
  if (e.dummy) {
    game.fx?.debris(point, dir.clone().negate(), 8, [0.85, 0.7, 0.15]);
    game.fx?.dust(point, dir.clone().negate(), 3, [0.6, 0.55, 0.4]);
  } else {
    game.fx?.bloodBurst(point, dir.clone().negate().lerp(UP, 0.35).normalize(), kind === 'stab' ? 0.7 : 1.1);
  }
  game.audio?.blade(kind, point, e.dummy);
  if (!e.attached[part]) return;
  if (opts.sever > 0) {
    const j = nearestJoint(e, part, point);
    if (j >= 0 && Math.random() < opts.sever * cutFactor(j)) {
      sever(e, j, { impulse: dir.clone().multiplyScalar(e.ragdoll.masses[j] * 3) });
      return;
    }
  }
  if (opts.breakChance && Math.random() < opts.breakChance) breakBone(e, part);
}

function closestOnSegment(a, b, p, out) {
  const ab = _p.copy(b).sub(a);
  const t = THREE.MathUtils.clamp(new THREE.Vector3().copy(p).sub(a).dot(ab) / Math.max(1e-9, ab.lengthSq()), 0, 1);
  return out.copy(a).addScaledVector(ab, t);
}

/** Contact handler for bladed props: fast blades cut, a tip driven in point-first sticks. */
function sharpImpact(prop, dv, other, owner) {
  if (!other || other.kind !== 'person' || prop.embedded || owner?.part == null || prop.age < 0.15) return;
  if (prop.age - (prop.lastCut ?? -1) < 0.2) return;
  const s = prop.def.sharp;
  const body = prop.body;
  const t = body.translation();
  const r = body.rotation();
  _q.set(r.x, r.y, r.z, r.w);
  const pos = new THREE.Vector3(t.x, t.y, t.z);
  const a = new THREE.Vector3(...s.a).applyQuaternion(_q).add(pos);
  const tip = new THREE.Vector3(...s.b).applyQuaternion(_q).add(pos);
  const part = owner.part;
  const pb = other.bodies[part];
  const ct = pb.translation();
  const cp = closestOnSegment(a, tip, new THREE.Vector3(ct.x, ct.y, ct.z), new THREE.Vector3());
  // velocity of the blade at the contact relative to the body part, from before this step's
  // collision response (by now the solver has already bounced the blade off)
  const lv = prop.prevVel;
  const av = prop.prevAng;
  const rx = cp.x - pos.x, ry = cp.y - pos.y, rz = cp.z - pos.z;
  const pp = other.prevVel;
  const pv = { x: pp[part * 3], y: pp[part * 3 + 1], z: pp[part * 3 + 2] };
  const rel = new THREE.Vector3(lv.x + av.y * rz - av.z * ry - pv.x, lv.y + av.z * rx - av.x * rz - pv.y, lv.z + av.x * ry - av.y * rx - pv.z);
  const speed = rel.length();
  if (speed < 1) return;
  const axis = tip.clone().sub(a).normalize();
  if (s.stab && cp.distanceTo(tip) < 0.05 && rel.dot(axis) > 0.65 * speed && speed > s.stabSpeed) {
    prop.lastCut = prop.age;
    bladeHit(prop.game, other, part, tip, axis, { kind: 'stab', damage: s.damage * THREE.MathUtils.clamp(speed / 6, 0.6, 2) });
    if (other.removed || !other.attached[part]) return;
    // drive the point in and leave it stuck there
    body.setTranslation({ x: t.x + axis.x * 0.035, y: t.y + axis.y * 0.035, z: t.z + axis.z * 0.035 }, true);
    prop.embed(other, part);
    return;
  }
  if (s.cut && speed > s.cutSpeed) {
    prop.lastCut = prop.age;
    const over = THREE.MathUtils.clamp((speed - s.cutSpeed) / 5 + 0.3, 0, 1);
    bladeHit(prop.game, other, part, cp, rel.normalize(), { kind: s.chop ? 'chop' : 'slash', damage: s.damage * THREE.MathUtils.clamp(speed / s.cutSpeed, 1, 2.5), sever: s.sever * over, breakChance: s.chop ? 0.3 : 0 });
  }
}

/** Centre a model on its balance point so the physics body sits in the right place. */
function centred(model, z) {
  const g = new THREE.Group();
  model.position.z = -z;
  g.add(model);
  return g;
}

const rotX90 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
const shift = (v, z) => [v[0], v[1], v[2] - z];

const KNIFE_C = -0.03;
const SWORD_C = -0.24;
const AXE_C = -0.38;

export const MELEE_PROPS = {
  knife: {
    id: 'knife', name: 'Knife', material: 'metal', mass: 0.3, size: 0.03, ccd: true, loud: 0.5,
    sharp: { a: shift([0, 0, -0.01], KNIFE_C), b: shift([-0.004, 0, -0.17], KNIFE_C), stab: true, cut: true, stabSpeed: 3, cutSpeed: 6, damage: 22, sever: 0.12 },
    stick: { axis: [0, 0, -1], tip: shift([-0.004, 0, -0.17], KNIFE_C), depth: 0.07 },
    onStick: (prop, e, part, point, dir) => bladeHit(prop.game, e, part, point, dir, { kind: 'stab', damage: 24 }),
    build: () => ({ mesh: centred(knifeModel(), KNIFE_C), colliders: [{ desc: R.ColliderDesc.cuboid(0.014, 0.009, 0.143).setTranslation(0, 0, -0.027 - KNIFE_C) }] }),
    onImpact: sharpImpact,
  },
  sword: {
    id: 'sword', name: 'Sword', material: 'metal', mass: 1.3, size: 0.03, ccd: true, loud: 0.9,
    sharp: { a: shift([0, 0, -0.05], SWORD_C), b: shift([0, 0, -0.78], SWORD_C), stab: true, cut: true, stabSpeed: 3.5, cutSpeed: 5, damage: 30, sever: 0.8 },
    stick: { axis: [0, 0, -1], tip: shift([0, 0, -0.78], SWORD_C), depth: 0.16 },
    onStick: (prop, e, part, point, dir) => bladeHit(prop.game, e, part, point, dir, { kind: 'stab', damage: 40 }),
    build: () => ({
      mesh: centred(swordModel(), SWORD_C),
      colliders: [
        { desc: R.ColliderDesc.cuboid(0.022, 0.006, 0.39).setTranslation(0, 0, -0.39 - SWORD_C) },
        { desc: R.ColliderDesc.cuboid(0.1, 0.012, 0.013).setTranslation(0, 0, -SWORD_C) },
        { desc: R.ColliderDesc.cuboid(0.016, 0.016, 0.1).setTranslation(0, 0, 0.1 - SWORD_C) },
      ],
    }),
    onImpact: sharpImpact,
  },
  axe: {
    id: 'axe', name: 'Axe', material: 'metal', mass: 2.2, size: 0.1, ccd: true, loud: 1,
    sharp: { a: shift([0, -0.16, -0.51], AXE_C), b: shift([0, -0.16, -0.68], AXE_C), cut: true, chop: true, cutSpeed: 4.5, damage: 42, sever: 0.9 },
    stick: { axis: [0, -1, 0], tip: shift([0, -0.17, -0.6], AXE_C), depth: 0.06 },
    onStick: (prop, e, part, point, dir) => bladeHit(prop.game, e, part, point, dir, { kind: 'chop', damage: 45, breakChance: 0.4 }),
    build: () => ({
      mesh: centred(axeModel(), AXE_C),
      colliders: [
        { desc: R.ColliderDesc.capsule(0.35, 0.018).setRotation({ x: rotX90.x, y: rotX90.y, z: rotX90.z, w: rotX90.w }).setTranslation(0, 0, -0.29 - AXE_C) },
        { desc: R.ColliderDesc.cuboid(0.014, 0.09, 0.07).setTranslation(0, -0.07, -0.6 - AXE_C), mass: 1.4 },
      ],
    }),
    onImpact: sharpImpact,
  },
};
