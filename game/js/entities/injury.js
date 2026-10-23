// People Playground-style injuries: broken bones, cut-off and torn-off limbs, and what follows
// from them (slack muscles, arterial bleeding, being unable to stand).
import * as THREE from 'three';
import { B, BONE_COUNT, PARENT } from '../characters/skeleton.js';
import { splitMesh, makeCap, subtreeMask, addOrgans, vertebraStub } from '../characters/gore.js';
import { paintBind, paintDamage } from '../characters/humanModel.js';
import { GutStrand } from './guts.js';
import { GIBS } from '../catalog/gibs.js';
import { addFracture, popEye, breakJaw } from '../characters/softbones.js';

export const CHAINS = [
  [B.UARM_L, B.FARM_L, B.HAND_L],
  [B.UARM_R, B.FARM_R, B.HAND_R],
  [B.THIGH_L, B.SHIN_L, B.FOOT_L],
  [B.THIGH_R, B.SHIN_R, B.FOOT_R],
];
const LEGS = [B.THIGH_L, B.SHIN_L, B.FOOT_L, B.THIGH_R, B.SHIN_R, B.FOOT_R];
const BREAKABLE = new Set([B.HEAD, B.SPINE, B.CHEST, B.UARM_L, B.FARM_L, B.UARM_R, B.FARM_R, B.THIGH_L, B.SHIN_L, B.THIGH_R, B.SHIN_R]);

export const LIMB_NAME = {
  [B.HEAD]: 'head', [B.SPINE]: 'legs',
  [B.UARM_L]: 'left arm', [B.FARM_L]: 'left forearm', [B.HAND_L]: 'left hand',
  [B.UARM_R]: 'right arm', [B.FARM_R]: 'right forearm', [B.HAND_R]: 'right hand',
  [B.THIGH_L]: 'left leg', [B.SHIN_L]: 'left lower leg', [B.FOOT_L]: 'left foot',
  [B.THIGH_R]: 'right leg', [B.SHIN_R]: 'right lower leg', [B.FOOT_R]: 'right foot',
};
const BREAK_NAME = {
  [B.HEAD]: 'neck', [B.SPINE]: 'back', [B.CHEST]: 'back',
  [B.UARM_L]: 'left arm', [B.FARM_L]: 'left arm', [B.UARM_R]: 'right arm', [B.FARM_R]: 'right arm',
  [B.THIGH_L]: 'left leg', [B.SHIN_L]: 'left leg', [B.THIGH_R]: 'right leg', [B.SHIN_R]: 'right leg',
};
// blood lost per second right after losing the part (decays over ~25 s)
const BLEED = { [B.UARM_L]: 2.8, [B.FARM_L]: 2.2, [B.HAND_L]: 1.3, [B.UARM_R]: 2.8, [B.FARM_R]: 2.2, [B.HAND_R]: 1.3, [B.THIGH_L]: 4.5, [B.SHIN_L]: 3, [B.FOOT_L]: 1.6, [B.THIGH_R]: 4.5, [B.SHIN_R]: 3, [B.FOOT_R]: 1.6 };
// how readily a high-calibre bullet takes the part off
const BULLET_SEVER = { [B.HAND_L]: 1.4, [B.HAND_R]: 1.4, [B.FOOT_L]: 1.2, [B.FOOT_R]: 1.2, [B.FARM_L]: 1, [B.FARM_R]: 1, [B.SHIN_L]: 0.8, [B.SHIN_R]: 0.8, [B.UARM_L]: 0.6, [B.UARM_R]: 0.6, [B.THIGH_L]: 0.45, [B.THIGH_R]: 0.45 };

const UP = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

/** Joint landmark above `child`, the cut axis (towards the child) and a fallback wound radius. */
function jointInfo(sk, child) {
  const j = sk.j;
  const p = sk.params;
  const side = [B.UARM_L, B.FARM_L, B.HAND_L, B.THIGH_L, B.SHIN_L, B.FOOT_L].includes(child) ? 'L' : 'R';
  let at, r;
  switch (child) {
    case B.HEAD: at = j.neck; r = 0.052 * p.head; break;
    case B.SPINE: at = j.waist; r = 0.12 * Math.sqrt(p.waist * p.girth); break;
    case B.CHEST: at = j.chestJ; r = 0.13 * p.girth; break;
    case B.UARM_L: case B.UARM_R: at = j['shoulder' + side]; r = 0.05 * p.limb; break;
    case B.FARM_L: case B.FARM_R: at = j['elbow' + side]; r = 0.042 * p.limb; break;
    case B.HAND_L: case B.HAND_R: at = j['wrist' + side]; r = 0.032 * p.limb; break;
    case B.THIGH_L: case B.THIGH_R: at = j['hip' + side]; r = 0.08 * p.girth; break;
    case B.SHIN_L: case B.SHIN_R: at = j['knee' + side]; r = 0.055 * p.limb; break;
    default: at = j['ankle' + side]; r = 0.042 * p.limb; break;
  }
  const c = sk.centers[child];
  const axis = new THREE.Vector3(c[0] - at[0], c[1] - at[1], c[2] - at[2]).normalize();
  return { at, axis, r };
}

/** World position of a bind-space point carried by a body. */
function bindToWorld(person, bone, bind, out) {
  const b = person.ragdoll.bodies[bone];
  const c = person.sk.centers[bone];
  const t = b.translation();
  const r = b.rotation();
  _q.set(r.x, r.y, r.z, r.w);
  return out.set(bind[0] - c[0], bind[1] - c[1], bind[2] - c[2]).applyQuaternion(_q).add(_w.set(t.x, t.y, t.z));
}

export function initInjuries(p) {
  p.broken = new Uint8Array(BONE_COUNT);
  p.severed = new Uint8Array(BONE_COUNT);
  p.attached = new Uint8Array(BONE_COUNT).fill(1);
  p.spurts = [];
  p.caps = [];
  p.guts = [];
  p.tearWatch = 0;
}

function updateAttachment(p) {
  const att = p.attached;
  att[B.PELVIS] = 1;
  // parents come before children, so one pass propagates
  for (let i = 1; i < BONE_COUNT; i++) att[i] = att[PARENT[i]] && !p.severed[i] ? 1 : 0;
  let m = 0;
  for (let i = 0; i < BONE_COUNT; i++) if (att[i]) m += p.ragdoll.masses[i];
  p.mass = m;
}

/** Muscle tone per joint from the current injuries. */
function applyTone(p) {
  const tone = p.ragdoll.tone;
  tone.fill(1);
  for (let i = 0; i < BONE_COUNT; i++) {
    if (!p.attached[i]) tone[i] = 0.015;
    else if (p.broken[i]) tone[i] = Math.min(tone[i], 0.05);
  }
  // the rest of a limb below a fracture is weak too
  for (const chain of CHAINS) {
    for (let k = 0; k < 2; k++) {
      if (!p.broken[chain[k]]) continue;
      for (let m = k + 1; m < 3; m++) tone[chain[m]] *= 0.3;
    }
  }
  // a broken back paralyses the legs
  if (p.broken[B.SPINE] || p.broken[B.CHEST]) for (const b of LEGS) tone[b] = Math.min(tone[b], 0.05);
}

/** Legs can't carry the body: missing or broken leg, or a broken back. */
export function legsDisabled(p) {
  if (p.broken[B.SPINE] || p.broken[B.CHEST]) return true;
  for (const b of LEGS) if (!p.attached[b] || p.broken[b]) return true;
  return false;
}

export function injuryText(p) {
  const out = [];
  for (let i = 1; i < BONE_COUNT; i++) {
    if (p.severed[i] && p.attached[PARENT[i]]) out.push(i === B.SPINE ? 'cut in half' : `no ${LIMB_NAME[i]}`);
  }
  const broken = new Set();
  for (let i = 0; i < BONE_COUNT; i++) if (p.broken[i] && p.attached[i]) broken.add(BREAK_NAME[i]);
  for (const n of broken) out.push(`broken ${n}`);
  return out.join(' · ');
}

// ------------------------------------------------------------------ broken bones
export function breakBone(p, bone) {
  if (p.removed || !BREAKABLE.has(bone) || p.broken[bone] || !p.attached[bone]) return false;
  p.broken[bone] = 1;
  p.ragdoll.setLoose(bone, true);
  applyTone(p);
  // limb bones snap in the middle: the limb kinks there and wobbles
  addFracture(p, bone);
  const t = p.ragdoll.bodies[bone].translation();
  p.game.audio?.crack(t);
  if (bone === B.HEAD) {
    p.die('neck');
    return true;
  }
  p.pain = Math.min(1, p.pain + 0.6);
  p.stun += 0.8;
  if (p.alive && !p.dummy && p.conscious) {
    p.voiceCooldown = 0.6;
    p.game.audio?.voice(p, 1);
  }
  if (legsDisabled(p)) p.fall();
  return true;
}

// ------------------------------------------------------------------ dismemberment
/**
 * Cut the body at the joint above `bone`. opts.impulse (Vector3, N*s) throws the cut-off part.
 */
export function sever(p, bone, opts = {}) {
  if (p.removed || bone === B.PELVIS || p.severed[bone] || !p.attached[bone]) return false;
  if (!p.ragdoll.sever(bone)) return false;
  const parent = PARENT[bone];
  p.severed[bone] = 1;
  p.broken[bone] = 0;
  updateAttachment(p);
  applyTone(p);
  const game = p.game;
  const info = jointInfo(p.sk, bone);
  const blood = !p.dummy && game.settings?.blood !== false;

  // cutting through the belly leaves it open: organs show and the guts spill out
  const open = bone === B.SPINE && !p.dummy;
  if (p.ch) {
    const rings = splitMesh(p.ch, subtreeMask(bone), [info.axis.x, info.axis.y, info.axis.z]);
    const sides = [
      { bone: parent, ring: rings[0], dir: info.axis.clone(), stump: true },
      { bone, ring: rings[1], dir: info.axis.clone().negate(), stump: false },
    ];
    const ends = [];
    for (const s of sides) {
      const center = s.ring ? s.ring.center : new THREE.Vector3(...info.at);
      const r = THREE.MathUtils.clamp(s.ring ? s.ring.radius : info.r, info.r * 0.6, info.r * 1.5);
      const c = p.sk.centers[s.bone];
      const local = new THREE.Vector3(center.x - c[0], center.y - c[1], center.z - c[2]);
      let cap;
      if (open) {
        // just the backbone sticking out of the opening
        cap = vertebraStub();
        cap.position.copy(local).add(new THREE.Vector3(0, 0, -0.065));
        ends.push({ body: p.ragdoll.bodies[s.bone], local: local.clone().add(new THREE.Vector3(0, 0, 0.03)) });
      } else {
        cap = makeCap(r, p.dummy);
        cap.position.copy(local).addScaledVector(s.dir, -0.12 * r);
      }
      cap.quaternion.setFromUnitVectors(UP, s.dir);
      p.ch.bones[s.bone].add(cap);
      p.caps.push(cap);
      if (blood) paintBind(p.ch, center.x, center.y, center.z, Math.min(0.12, r * 2.4), 0.9, 0);
      if (!p.dummy) {
        p.spurts.push({ bone: s.bone, local: cap.position.clone(), dir: s.dir.clone(), t: 0, power: s.stump ? 1 : 0.3, life: s.stump ? 9 : 2.5 });
      }
    }
    if (p.ch.material.side !== THREE.DoubleSide) {
      p.ch.material.side = THREE.DoubleSide;
      p.ch.material.needsUpdate = true;
    }
    if (open) {
      addOrgans(p.ch, p.sk);
      p.guts.push(new GutStrand(game, ends[0], ends[1]));
      if (Math.random() < 0.6) p.guts.push(new GutStrand(game, ends[0], ends[1], 1.2));
    }
  }

  const at = bindToWorld(p, parent, info.at, new THREE.Vector3());
  const out = _v.copy(info.axis).applyQuaternion(_q).normalize();
  if (blood) {
    game.fx?.bloodBurst(at, out, 1.6);
    game.fx?.bloodBurst(at, out.clone().negate(), 0.8);
  } else {
    game.fx?.debris(at, out, 10, [0.85, 0.7, 0.15]);
    game.fx?.dust(at, out, 4, [0.6, 0.55, 0.4]);
  }
  game.audio?.gore(at, 1);
  if (opts.impulse) p.ragdoll.bodies[bone].applyImpulse({ x: opts.impulse.x, y: opts.impulse.y, z: opts.impulse.z }, true);

  if (bone === B.HEAD || bone === B.SPINE) {
    p.die(bone === B.HEAD ? 'decapitated' : 'cut in half');
  } else {
    if (!p.dummy) p.bleed += BLEED[bone] ?? 2;
    p.pain = 1;
    p.stun += 1.2;
    p.fear = 2;
    p.fearFrom.copy(at);
    if (p.alive && !p.dummy && p.conscious) {
      p.voiceCooldown = 0.5;
      game.audio?.voice(p, 1);
    }
    if (legsDisabled(p)) p.fall();
  }
  game.events?.emit('injury', p, bone);
  return true;
}

/** Heal mends fractures and stops the spraying, but lost parts stay lost. */
export function healInjuries(p) {
  for (let i = 0; i < BONE_COUNT; i++) {
    if (p.broken[i]) {
      p.broken[i] = 0;
      p.ragdoll.setLoose(i, false);
    }
  }
  applyTone(p);
  p.spurts.length = 0;
}

/** Fatal losses that no amount of healing fixes. */
export function fatalLoss(p) {
  return !!(p.severed[B.HEAD] || p.severed[B.SPINE]);
}

const CHILDREN = Array.from({ length: BONE_COUNT }, (_, i) => PARENT.flatMap((par, c) => (par === i ? [c] : [])));
const SEVERABLE = (b) => b !== B.PELVIS && b !== B.CHEST;

/**
 * The cuttable joint nearest a world point: the hit part's own joint or one of its children's
 * (a blade landing on the chest near the neck takes the head, near a shoulder the arm).
 */
export function nearestJoint(p, part, point) {
  const cands = [];
  if (SEVERABLE(part) && p.attached[part]) cands.push(part);
  for (const c of CHILDREN[part]) if (p.attached[c]) cands.push(c);
  let best = -1;
  let bestD = Infinity;
  const w = new THREE.Vector3();
  for (const c of cands) {
    bindToWorld(p, PARENT[c], jointInfo(p.sk, c).at, w);
    const d = w.distanceTo(point);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

/** How easily a blade cuts through at a joint (necks and waists are harder than limbs). */
export function cutFactor(joint) {
  return joint === B.HEAD ? 0.6 : joint === B.SPINE ? 0.35 : 1;
}

// ------------------------------------------------------------------ trauma sources
/** High-calibre bullets break bones and can take smaller parts clean off. */
export function bulletTrauma(p, part, amount, dir) {
  if (!p.attached[part] || part === B.PELVIS) return;
  const limb = part >= B.UARM_L;
  if (limb && Math.random() < THREE.MathUtils.clamp((amount - 22) / 90, 0, 1)) breakBone(p, part === B.HAND_L || part === B.HAND_R ? part - 1 : part);
  const sev = THREE.MathUtils.clamp((amount - 60) / 100, 0, 1) * (BULLET_SEVER[part] ?? 0);
  if (Math.random() < sev) sever(p, part, { impulse: dir.clone().multiplyScalar(4 + Math.random() * 4) });
}

/** Explosions blow limbs off people close to the blast and break bones further out. */
export function blastTrauma(p, center, power, radius) {
  p.tearWatch = 0.8;
  const bodies = p.ragdoll.bodies;
  const strength = (bone) => {
    const t = bodies[bone].translation();
    const d = Math.hypot(t.x - center.x, t.y - center.y, t.z - center.z);
    return d >= radius ? 0 : power * Math.pow(1 - d / radius, 1.5);
  };
  // right next to a big blast there is nothing left to save
  if (p.attached[B.CHEST] && Math.max(strength(B.CHEST), strength(B.SPINE)) > 1.85 && Math.random() < 0.85) {
    gib(p, center);
    return;
  }
  for (const chain of CHAINS) {
    const live = chain.filter((b) => p.attached[b]);
    if (!live.length) continue;
    const s = Math.max(...live.map(strength));
    if (s > 0.9 && Math.random() < Math.min(0.8, (s - 0.9) * 0.6)) {
      const r = Math.random();
      const pick = live[r < 0.35 ? 0 : r < 0.75 ? Math.min(1, live.length - 1) : live.length - 1];
      const t = bodies[pick].translation();
      const away = new THREE.Vector3(t.x - center.x, t.y - center.y + 0.3, t.z - center.z).normalize();
      sever(p, pick, { impulse: away.multiplyScalar(p.ragdoll.masses[pick] * 8 * Math.min(2, s)) });
    } else if (s > 0.6 && Math.random() < (s - 0.6) * 0.5) {
      breakBone(p, live[Math.floor(Math.random() * Math.min(2, live.length))]);
    }
  }
  if (p.attached[B.HEAD]) {
    const s = strength(B.HEAD);
    if (s > 2 && Math.random() < 0.35) sever(p, B.HEAD, { impulse: new THREE.Vector3(0, 6, 0) });
    else if (s > 0.7) {
      if (Math.random() < 0.35) popEye(p);
      if (Math.random() < 0.35) breakJaw(p);
    }
  }
}

/**
 * Blown apart: every remaining limb, the head and the lower body come off and chunks of the
 * torso fly out.
 */
export function gib(p, center) {
  if (p.removed || p.gibbed) return;
  p.gibbed = true;
  const game = p.game;
  const bodies = p.ragdoll.bodies;
  const away = (bone, k) => {
    const t = bodies[bone].translation();
    return new THREE.Vector3(t.x - center.x, t.y - center.y + 0.4, t.z - center.z).normalize().multiplyScalar(p.ragdoll.masses[bone] * k);
  };
  for (const b of [B.HEAD, B.UARM_L, B.UARM_R, B.SPINE, B.THIGH_L, B.THIGH_R, B.FARM_L, B.SHIN_R]) {
    if (p.attached[b] && !p.severed[b] && Math.random() < 0.9) sever(p, b, { impulse: away(b, 10) });
  }
  const { Prop } = game.classes;
  const c = bodies[B.CHEST].translation();
  const colors = p.dummy ? [0xf0b915, 0x3b3b3e] : [0x7d1414, 0x6a1010, 0xcf8580, 0xd9868c, 0x4a0f0f, 0xe8dfc9];
  for (let i = 0; i < (p.dummy ? 6 : 11); i++) {
    const pos = new THREE.Vector3(c.x + (Math.random() - 0.5) * 0.3, c.y + (Math.random() - 0.5) * 0.4, c.z + (Math.random() - 0.5) * 0.3);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6));
    const chunk = new Prop(game, GIBS.chunk, pos, q, { r: 0.03 + Math.random() * 0.05, color: colors[i % colors.length], lifetime: 40 + Math.random() * 20 });
    chunk.bloodless = p.dummy;
    const v = pos.clone().sub(center).normalize().multiplyScalar(3 + Math.random() * 5).add(new THREE.Vector3(0, 2.5, 0));
    chunk.body.setLinvel({ x: v.x, y: v.y, z: v.z }, true);
    chunk.body.setAngvel({ x: Math.random() * 20 - 10, y: Math.random() * 20 - 10, z: Math.random() * 20 - 10 }, true);
    game.add(chunk, false);
  }
  if (!p.dummy && game.settings?.blood !== false) {
    const at = new THREE.Vector3(c.x, c.y, c.z);
    for (let i = 0; i < 3; i++) game.fx?.bloodBurst(at, new THREE.Vector3(Math.random() - 0.5, 0.6, Math.random() - 0.5).normalize(), 2.5);
    if (p.ch) for (const b of [B.CHEST, B.SPINE, B.PELVIS]) paintDamage(p.ch, b, at, 0.35, 1, 0);
  }
  game.audio?.gore(new THREE.Vector3(c.x, c.y, c.z), 1);
  p.die('explosion');
}

/** Hard knocks break bones; truly violent ones rip parts away. */
export function impactTrauma(p, part, dv, limit) {
  const over = dv - limit;
  if (over <= 3) return;
  if (over > 6) p.tearWatch = 0.5;
  // feet and hands pass the shock up into the shin / forearm
  const bone = part === B.FOOT_L || part === B.FOOT_R || part === B.HAND_L || part === B.HAND_R ? part - 1 : part;
  const need = bone === B.HEAD ? 6 : 3;
  if (over > need && BREAKABLE.has(bone) && Math.random() < Math.min(1, 0.3 + (over - need) / 4)) breakBone(p, bone);
  if (over > 18 && part !== B.SPINE && part !== B.PELVIS && part !== B.CHEST && Math.random() < 0.5) sever(p, part);
}

/**
 * Pulling a body apart (pinned limbs, ropes, explosions) stretches the joints; when a joint is
 * pulled open far enough the limb tears off.
 */
export function checkTearing(p, dt) {
  const rd = p.ragdoll;
  for (const def of rd.jointDefs) {
    const child = def.child;
    if (def.severed || !p.attached[child]) continue;
    const pb = rd.bodies[PARENT[child]];
    const cb = rd.bodies[child];
    let t = pb.translation();
    let r = pb.rotation();
    _q.set(r.x, r.y, r.z, r.w);
    _v.set(def.a1.x, def.a1.y, def.a1.z).applyQuaternion(_q).add(_w.set(t.x, t.y, t.z));
    t = cb.translation();
    r = cb.rotation();
    _q.set(r.x, r.y, r.z, r.w);
    _w.set(def.a2.x, def.a2.y, def.a2.z).applyQuaternion(_q);
    const d = Math.hypot(_v.x - t.x - _w.x, _v.y - t.y - _w.y, _v.z - t.z - _w.z);
    // light hands and feet stretch their joints most, so they get more slack
    const end = child === B.HAND_L || child === B.HAND_R || child === B.FOOT_L || child === B.FOOT_R;
    const limit = child === B.SPINE ? 0.16 : child === B.HEAD || end ? 0.12 : 0.09;
    def.stretch = d > limit ? (def.stretch || 0) + dt : 0;
    if (def.stretch > 0.06 || d > limit * 2.5) {
      def.stretch = 0;
      sever(p, child);
    }
  }
}

/** Arterial spray from fresh stumps, pulsing with the heartbeat. */
export function updateSpurts(p, dt) {
  const fx = p.game.fx;
  if (!fx || !p.spurts.length || dt <= 0 || p.game.settings?.blood === false) return;
  const keep = [];
  for (const s of p.spurts) {
    s.t += dt;
    if (s.t > s.life) continue;
    keep.push(s);
    const heart = p.alive ? 1.7 : 0.6;
    const pulse = Math.max(0, Math.sin(s.t * heart * Math.PI * 2));
    const fade = 1 - s.t / s.life;
    const rate = (6 + 40 * pulse) * s.power * fade * (p.alive ? 1 : 0.3);
    s.acc = (s.acc ?? 0) + rate * dt;
    if (s.acc < 1) continue;
    const b = p.ragdoll.bodies[s.bone];
    const t = b.translation();
    const r = b.rotation();
    _q.set(r.x, r.y, r.z, r.w);
    const pos = _v.copy(s.local).applyQuaternion(_q).add(_w.set(t.x, t.y, t.z)).clone();
    const dir = s.dir.clone().applyQuaternion(_q);
    const v = b.linvel();
    while (s.acc >= 1) {
      s.acc -= 1;
      const sp = (0.6 + 2.6 * pulse * s.power) * (0.4 + 0.6 * fade);
      const d = dir.clone().multiplyScalar(sp).add(new THREE.Vector3((Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.5));
      fx.addDrop(pos, d.add(new THREE.Vector3(v.x, v.y, v.z)), 0.008 + Math.random() * 0.01);
    }
  }
  p.spurts = keep;
}
