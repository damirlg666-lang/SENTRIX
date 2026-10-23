// A simulated person: procedural mesh + active ragdoll with a simple brain.
// Muscles (joint motors) track procedural poses; a balance controller keeps the pelvis up and
// the torso upright while the person is conscious and on their feet.
import * as THREE from 'three';
import { Entity } from './entity.js';
import { GROUPS } from '../engine/physics.js';
import { B, BONE_COUNT, BONE_NAMES, makeSkeleton } from '../characters/skeleton.js';
import { Ragdoll } from '../characters/ragdoll.js';
import { createCharacterMesh, randomOutfit, dummyOutfit, paintDamage, clearDamage } from '../characters/humanModel.js';
import {
  initInjuries, legsDisabled, injuryText, bulletTrauma, impactTrauma, checkTearing, updateSpurts, healInjuries, fatalLoss,
} from './injury.js';
import { initChem, updateChem, chemBoost, chemStatus, clearChem } from './chem.js';

export const ST = {
  ACTIVE: 'active',
  FALLING: 'falling',
  DOWN: 'down',
  GETUP: 'getup',
  UNCONSCIOUS: 'unconscious',
  DEAD: 'dead',
};

const TUNE = { fp: 0.9, gp: 40, fs: 0.8, fc: 0.9, gs: 40 };

// velocity change (m/s) a body part tolerates before taking impact damage
const IMPACT_LIMIT = [5.5, 5.5, 5.5, 5, 7, 8, 9.5, 7, 8, 9.5, 6.5, 8, 10, 6.5, 8, 10];

const PUNCH_BOOST = {
  [B.HAND_R]: { [B.UARM_R]: 3.5, [B.FARM_R]: 3, [B.CHEST]: 1.5 },
  [B.HAND_L]: { [B.UARM_L]: 3.5, [B.FARM_L]: 3, [B.CHEST]: 1.5 },
};

const PART_MULT = [1.0, 1.0, 1.25, 3.2, 0.45, 0.4, 0.25, 0.45, 0.4, 0.25, 0.6, 0.5, 0.3, 0.6, 0.5, 0.3];
const FIRST_NAMES = ['Alex', 'Sam', 'Jordan', 'Taylor', 'Casey', 'Riley', 'Morgan', 'Jamie', 'Quinn', 'Avery', 'Drew', 'Robin', 'Kai', 'Noa', 'Mika', 'Sasha', 'Rene', 'Toni', 'Charlie', 'Dana'];

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _euler = new THREE.Euler();
const UP = new THREE.Vector3(0, 1, 0);

function newPose() {
  const p = [];
  for (let i = 0; i < BONE_COUNT; i++) p.push([0, 0, 0]);
  return p;
}

function set(p, bone, x, y = 0, z = 0) {
  const a = p[bone];
  a[0] = x;
  a[1] = y;
  a[2] = z;
}

function lerpPose(out, a, b, t) {
  for (let i = 0; i < BONE_COUNT; i++) {
    for (let k = 0; k < 3; k++) out[i][k] = a[i][k] + (b[i][k] - a[i][k]) * t;
  }
}

/** Neutral standing pose (relative to the A-pose bind). */
function standPose(p, armDown = 0.57) {
  set(p, B.SPINE, 0.02);
  set(p, B.CHEST, 0.0);
  set(p, B.HEAD, 0.04);
  set(p, B.UARM_L, -0.1, 0.1, -armDown);
  set(p, B.UARM_R, -0.1, -0.1, armDown);
  set(p, B.FARM_L, 0.28);
  set(p, B.FARM_R, 0.28);
  set(p, B.HAND_L, 0, 0, 0.08);
  set(p, B.HAND_R, 0, 0, -0.08);
  set(p, B.THIGH_L, -0.04, 0, 0.02);
  set(p, B.THIGH_R, -0.04, 0, -0.02);
  set(p, B.SHIN_L, 0.08);
  set(p, B.SHIN_R, 0.08);
  set(p, B.FOOT_L, -0.04);
  set(p, B.FOOT_R, -0.04);
  return p;
}

const POSE_STAND = standPose(newPose());
const POSE_CROUCH = (() => {
  const p = standPose(newPose());
  set(p, B.SPINE, 0.35);
  set(p, B.CHEST, 0.25);
  set(p, B.HEAD, -0.2);
  set(p, B.THIGH_L, -1.25, 0, 0.12);
  set(p, B.THIGH_R, -1.25, 0, -0.12);
  set(p, B.SHIN_L, 1.9);
  set(p, B.SHIN_R, 1.9);
  set(p, B.FOOT_L, -0.55);
  set(p, B.FOOT_R, -0.55);
  set(p, B.UARM_L, -0.9, 0, -0.3);
  set(p, B.UARM_R, -0.9, 0, 0.3);
  set(p, B.FARM_L, 0.5);
  set(p, B.FARM_R, 0.5);
  return p;
})();
const POSE_PROTECT = (() => {
  const p = newPose();
  set(p, B.SPINE, 0.3);
  set(p, B.CHEST, 0.25);
  set(p, B.HEAD, 0.45);
  set(p, B.UARM_L, -1.3, 0, -0.15);
  set(p, B.UARM_R, -1.3, 0, 0.15);
  set(p, B.FARM_L, 1.5);
  set(p, B.FARM_R, 1.5);
  set(p, B.THIGH_L, -0.7, 0, 0.1);
  set(p, B.THIGH_R, -0.7, 0, -0.1);
  set(p, B.SHIN_L, 1.1);
  set(p, B.SHIN_R, 1.1);
  return p;
})();

export class Person extends Entity {
  /**
   * opts: { type, outfit, position: Vector3, yaw, quality, headless }
   */
  constructor(game, opts = {}) {
    super(game);
    this.kind = 'person';
    const type = opts.type || 'male';
    this.type = type;
    this.outfit = opts.outfit || (opts.dummy ? dummyOutfit() : randomOutfit(type));
    this.dummy = !!this.outfit.dummy;
    this.name = opts.name || (this.dummy ? 'Crash test dummy' : FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)]);
    this.sk = makeSkeleton(type);
    const pos = opts.position || new THREE.Vector3();
    this.yaw = opts.yaw ?? 0;
    this.heading = this.yaw;
    this.ragdoll = new Ragdoll(game.physics, this.sk, pos, this.yaw, this);
    this.bodies = this.ragdoll.bodies;
    this.mass = this.ragdoll.totalMass;
    this.standH = this.sk.centers[B.PELVIS][1] - 0.015;
    initInjuries(this);
    initChem(this);

    if (!opts.headless) {
      this.ch = createCharacterMesh(type, this.outfit, opts.quality || 'high');
      this.ch.root.userData.entity = this;
      game.scene.add(this.ch.root);
      this.syncBones();
    }

    // vitals
    this.health = 100;
    this.blood = 100;
    this.bleed = 0;
    this.pain = 0;
    this.stun = 0;
    this.fear = 0;
    this.fearFrom = new THREE.Vector3();
    this.unconsciousTimer = 0;

    // control
    this.state = ST.ACTIVE;
    this.stateTime = 0;
    this.strength = 1;
    this.support = 1;
    this.phase = Math.random() * Math.PI * 2;
    this.speed = 0;
    this.desiredSpeed = 0;
    this.target = null;
    this.idleTimer = 1 + Math.random() * 3;
    this.airTime = 0;
    this.groundY = 0;
    this.height = this.standH;
    this.grounded = true;
    this.held = false;
    this.time = 0;
    this.animT = Math.random() * 10;
    this.pose = newPose();
    this.tmpPose = newPose();
    this.lookYaw = 0;
    this.lookPitch = 0;
    this.blinkTimer = 2 + Math.random() * 3;
    this.blink = 0;
    this.pale = 0;
    this.recoverTime = 2;
    this.deathTime = 0;
    this.lastHit = -10;
    this.voiceCooldown = 0;
    this.prevVel = new Float32Array(BONE_COUNT * 3);
    this.wounds = [];
    this.controlled = false;
    this.controlInput = { x: 0, z: 0, run: false };
    this.jumpTime = 0;
    this.punchTime = 0;
    this.comVel = new Float32Array(3);
    this.jolt = 0;
    this.joltPeak = 0;
  }

  get alive() {
    return this.state !== ST.DEAD;
  }

  get conscious() {
    return this.state !== ST.DEAD && this.state !== ST.UNCONSCIOUS;
  }

  statusText() {
    const base = this.baseStatus();
    const chem = this.alive ? chemStatus(this) : '';
    return chem ? `${base} · ${chem}` : base;
  }

  baseStatus() {
    if (this.onFire && this.alive) return 'On fire!';
    if (this.shockTime > 0) return 'Electrocuted!';
    if (this.controlled && this.alive) return 'Controlled by you';
    if (this.held && this.conscious) return 'Panicking!';
    switch (this.state) {
      case ST.DEAD:
        return 'Dead';
      case ST.UNCONSCIOUS:
        return 'Unconscious';
      case ST.DOWN:
      case ST.FALLING:
        return this.pain > 0.5 ? 'Hurt, on the ground' : 'Knocked down';
      case ST.GETUP:
        return 'Getting up';
      default:
        if (this.held) return 'Panicking';
        if (this.fear > 0.3) return 'Running away';
        if (this.bleed > 0.6) return 'Bleeding';
        return this.desiredSpeed > 0.1 ? 'Walking' : 'Idle';
    }
  }

  setState(s) {
    if (this.state === s) return;
    this.state = s;
    this.stateTime = 0;
  }

  // ------------------------------------------------------------------ physics step
  prePhysics(dt) {
    if (this.removed) return;
    const rd = this.ragdoll;
    this.time += dt;
    this.stateTime += dt;
    this.updateVitals(dt);
    updateChem(this, dt);
    const pv = this.prevVel;
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < BONE_COUNT; i++) {
      const v = rd.bodies[i].linvel();
      pv[i * 3] = v.x;
      pv[i * 3 + 1] = v.y;
      pv[i * 3 + 2] = v.z;
      // parts that came off no longer move the body's centre of mass
      const m = this.attached[i] ? rd.masses[i] : 0;
      cx += v.x * m;
      cy += v.y * m;
      cz += v.z * m;
    }
    // whole-body trauma from sudden centre-of-mass deceleration (falls, crashes, blasts)
    cx /= this.mass;
    cy /= this.mass;
    cz /= this.mass;
    const cv = this.comVel;
    const dvCom = Math.hypot(cx - cv[0], cy - cv[1], cz - cv[2]);
    cv[0] = cx;
    cv[1] = cy;
    cv[2] = cz;
    // decaying sum approximates the speed lost over the last ~0.1 s; damage is applied once per jolt peak
    // (being dragged around by the hand tool is jerky, so it gets a higher tolerance)
    const joltLimit = this.held ? 5.5 : 3.6;
    this.jolt = this.jolt * Math.exp(-dt / 0.08) + (this.time > 0.3 ? dvCom : 0);
    if (this.jolt > joltLimit) this.joltPeak = Math.max(this.joltPeak, this.jolt);
    else if (this.joltPeak > 0) {
      const t = rd.bodies[B.PELVIS].translation();
      this.damage({ amount: Math.max(0, this.joltPeak - joltLimit) * 18, part: B.PELVIS, point: _v2.set(t.x, t.y, t.z), kind: 'blunt' });
      if (this.joltPeak > 5) this.stun += 1;
      this.joltPeak = 0;
    }
    // limbs only tear when something holds the body back (a dragged body just follows the hand)
    if (this.tethered || this.frozenParts > 0 || this.tearWatch > 0) checkTearing(this, dt);
    this.tearWatch -= dt;

    const pel = rd.bodies[B.PELVIS];
    const pt = pel.translation();
    const chest = rd.bodies[B.CHEST];
    const cq = chest.rotation();
    _q.set(cq.x, cq.y, cq.z, cq.w);
    const up = _v.copy(UP).applyQuaternion(_q);
    const tilt = Math.acos(Math.max(-1, Math.min(1, up.y)));

    // ground probe from the pelvis (ignores ragdolls)
    const hit = this.game.physics.raycast(pt, { x: 0, y: -1, z: 0 }, 2.5, null, GROUPS.queryStatic);
    this.groundY = hit ? hit.point.y : pt.y - 3;
    this.height = pt.y - this.groundY;
    this.grounded = this.height < this.standH + 0.35;
    this.airTime = this.grounded ? 0 : this.airTime + dt;

    const sleeping = rd.isSleeping();
    switch (this.state) {
      case ST.ACTIVE: {
        const v = pel.linvel();
        const slip = Math.hypot(v.x - Math.sin(this.heading) * this.desiredSpeed, v.z - Math.cos(this.heading) * this.desiredSpeed);
        this.slip = slip > 2.0 && this.stateTime > 0.6 ? (this.slip || 0) + dt : 0;
        const airLimit = this.jumpTime > 0 ? 1.4 : 0.35;
        if (tilt > 0.85 || (this.height < this.standH * 0.62 && this.jumpTime <= 0) || this.stun > 0.6 || (this.airTime > airLimit && !this.held) || this.slip > 0.1) {
          this.fall();
        }
        break;
      }
      case ST.FALLING:
        if (this.grounded && this.stateTime > 0.6 && pel.linvel().y > -1) this.setState(ST.DOWN);
        if (this.stateTime > 4) this.setState(ST.DOWN);
        break;
      case ST.DOWN:
        if (this.stateTime > this.recoverTime && this.canStand() && this.grounded && !this.held) {
          this.setState(ST.GETUP);
          this.getupFrom = this.height;
        }
        break;
      case ST.GETUP:
        if (this.stateTime > 1.6 && tilt < 0.3 && this.height > this.standH - 0.06) {
          this.setState(ST.ACTIVE);
          this.stun = 0;
        } else if (this.stateTime > 4 || this.held) {
          this.setState(ST.DOWN);
          this.recoverTime = 1.5 + Math.random() * 1.5;
        }
        break;
      case ST.UNCONSCIOUS:
        this.unconsciousTimer -= dt;
        if (this.unconsciousTimer <= 0 && this.blood > 40 && this.health > 10) this.setState(ST.DOWN);
        break;
      default:
        break;
    }

    if (this.state === ST.ACTIVE && !this.held) this.think(dt);
    else this.desiredSpeed = 0;
    if (this.jumpTime > 0) this.jumpTime -= dt;
    if (this.punchTime > 0) {
      this.punchTime -= dt;
      if (this.punchTime > 0.08) this.punchContacts();
    }

    // muscle tone by state
    let strength = 1;
    let support = 0;
    const p = this.pose;
    switch (this.state) {
      case ST.ACTIVE:
        if (this.held || (!this.grounded && this.jumpTime <= 0)) {
          this.flailPose(p);
          strength = 0.75;
        } else {
          this.locomotionPose(p, dt);
          strength = 1;
          support = 1;
        }
        break;
      case ST.FALLING:
        lerpPose(p, POSE_PROTECT, POSE_PROTECT, 0);
        strength = 0.4;
        break;
      case ST.DOWN: {
        lerpPose(p, POSE_PROTECT, POSE_STAND, 0.5);
        const w = this.pain;
        p[B.SPINE][0] = 0.2 + Math.sin((this.time + this.animT) * 2.1) * 0.25 * w;
        p[B.THIGH_L][0] = -0.6 + Math.sin((this.time + this.animT) * 1.7) * 0.4 * w;
        p[B.THIGH_R][0] = -0.5 + Math.sin((this.time + this.animT) * 1.3 + 1) * 0.4 * w;
        strength = this.held ? 0.5 : 0.18 + 0.1 * w;
        if (this.held) this.flailPose(p);
        break;
      }
      case ST.GETUP: {
        const t = Math.min(1, this.stateTime / 1.7);
        lerpPose(p, POSE_CROUCH, POSE_STAND, smooth(0.45, 1, t));
        strength = 0.9;
        support = smooth(0, 0.8, this.stateTime);
        break;
      }
      case ST.UNCONSCIOUS:
        strength = 0.03;
        break;
      case ST.DEAD:
        strength = Math.max(0, 0.3 - this.stateTime * 0.6);
        break;
      default:
        break;
    }
    // electrocution: every muscle fires at random (dead bodies twitch too)
    if (this.shockTime > 0) {
      this.shockTime -= dt;
      this.shockJitter = (this.shockJitter ?? 0) - dt;
      if (this.shockJitter <= 0 || !this.shockPose) {
        this.shockJitter = 0.04 + Math.random() * 0.03;
        this.shockPose = newPose();
        for (let i = 1; i < BONE_COUNT; i++) set(this.shockPose, i, (Math.random() - 0.5) * 1.6, (Math.random() - 0.5) * 0.7, (Math.random() - 0.5) * 0.7);
      }
      // limp states keep their last pose, so start from a neutral one instead of accumulating
      if (this.state === ST.DEAD || this.state === ST.UNCONSCIOUS) lerpPose(p, POSE_STAND, POSE_STAND, 0);
      for (let i = 1; i < BONE_COUNT; i++) for (let k = 0; k < 3; k++) p[i][k] += this.shockPose[i][k];
      strength = 1.2;
      support = 0;
    }
    // head look
    if (this.conscious) {
      p[B.HEAD][1] += this.lookYaw;
      p[B.HEAD][0] += this.lookPitch;
    }
    if (this.state === ST.ACTIVE || this.state === ST.GETUP) strength *= chemBoost(this).strength;
    this.strength += (strength - this.strength) * Math.min(1, dt * 6);
    this.support = support;
    if (!sleeping || this.state !== ST.DEAD) rd.drive(p, this.strength, this.punchTime > 0 ? PUNCH_BOOST[this.punchSide] : null);

    if (this.jumpTime > 0.55) support = 0; // let the take-off happen
    if (support > 0 && this.grounded && !this.held) this.balance(dt, support);
  }

  canStand() {
    // adrenaline keeps people going on very little
    const tough = this.chem.adrenaline > 0.2;
    return this.conscious && this.health > (tough ? 4 : 12) && this.blood > (tough ? 22 : 35) && this.state !== ST.UNCONSCIOUS && !legsDisabled(this);
  }

  fall() {
    if (this.state === ST.DEAD || this.state === ST.UNCONSCIOUS) return;
    this.setState(ST.FALLING);
    this.recoverTime = 1.6 + Math.random() * 2 + this.pain * 3;
    this.target = null;
    this.game.events?.emit('fall', this);
  }

  // ------------------------------------------------------------------ balance controller
  balance(dt, k) {
    const rd = this.ragdoll;
    const pel = rd.bodies[B.PELVIS];
    const chest = rd.bodies[B.CHEST];
    const M = this.mass;
    const g = 9.81 * (this.game.physics.gravityScale ?? 1);
    const pv = pel.linvel();

    // vertical support (spring-damper on pelvis height)
    // while walking the pelvis rides slightly higher so trailing feet barely load the ground
    let target = this.standH + Math.min(1, this.desiredSpeed) * 0.03 - Math.abs(Math.cos(this.phase)) * 0.02 * Math.min(1, this.speed);
    if (this.state === ST.GETUP) {
      const t = smooth(0.1, 1.6, this.stateTime);
      target = this.getupFrom + (this.standH - this.getupFrom) * t;
    }
    const err = target - this.height;
    let fy = M * (g * 0.92 + 70 * err - 12 * pv.y);
    fy = Math.max(0, Math.min(fy, M * g * 2.6)) * k;
    pel.applyImpulse({ x: 0, y: fy * dt, z: 0 }, true);

    // horizontal drive toward desired velocity
    if (this.state === ST.ACTIVE) {
      const dvx = Math.sin(this.heading) * this.desiredSpeed - pv.x;
      const dvz = Math.cos(this.heading) * this.desiredSpeed - pv.z;
      const maxA = 4;
      let ax = dvx * 4;
      let az = dvz * 4;
      const al = Math.hypot(ax, az);
      if (al > maxA) {
        ax *= maxA / al;
        az *= maxA / al;
      }
      pel.applyImpulse({ x: ax * M * 0.5 * dt, y: 0, z: az * M * 0.5 * dt }, true);
      chest.applyImpulse({ x: ax * M * 0.5 * dt, y: 0, z: az * M * 0.5 * dt }, true);
      // feet slide a little while walking so dragging legs cannot trip the body
      const walking = this.desiredSpeed > 0.2;
      if (walking !== this._walkFriction) {
        this._walkFriction = walking;
        for (const f of [B.FOOT_L, B.FOOT_R]) this.ragdoll.colliders[f].setFriction(walking ? 0.35 : 1.0);
      }
    } else {
      // damp sliding while getting up
      pel.applyImpulse({ x: -pv.x * M * 2 * dt * k, y: 0, z: -pv.z * M * 2 * dt * k }, true);
    }

    // upright torques on pelvis and chest
    const lean = this.state === ST.ACTIVE ? Math.min(0.25, this.speed * 0.05) : 0;
    const tn = this.game.tune || TUNE;
    // keep gain * dt * fraction below 1 so the servo never overshoots at low frame rates
    const lim = (f, g) => Math.min(f * k, 0.7 / (g * dt));
    this.uprightBody(pel, this.yaw, 0, lim(tn.fp, tn.gp), tn.gp);
    this.uprightBody(rd.bodies[B.SPINE], this.yaw, lean * 0.5, lim(tn.fs, tn.gs), tn.gs);
    this.uprightBody(chest, this.yaw, lean, lim(tn.fc, tn.gs), tn.gs);
    this.uprightBody(rd.bodies[B.HEAD], this.yaw + this.lookYaw, this.lookPitch, lim(0.25, 14), 14);
  }

  /**
   * Velocity-servo a body toward an upright orientation with the given yaw/lean.
   * Uses the body's own world inertia so the correction can never overshoot.
   */
  uprightBody(body, yaw, lean, fraction, gain) {
    const r = body.rotation();
    _q.set(r.x, r.y, r.z, r.w);
    _euler.set(lean, yaw, 0, 'YXZ');
    _q2.setFromEuler(_euler);
    _q2.multiply(_q.invert());
    if (_q2.w < 0) {
      _q2.x = -_q2.x;
      _q2.y = -_q2.y;
      _q2.z = -_q2.z;
      _q2.w = -_q2.w;
    }
    const s = Math.sqrt(Math.max(0, 1 - _q2.w * _q2.w));
    const angle = 2 * Math.acos(Math.min(1, _q2.w));
    let wx = 0, wy = 0, wz = 0;
    if (s > 1e-5) {
      const k = (angle * gain) / s;
      wx = _q2.x * k;
      wy = _q2.y * k;
      wz = _q2.z * k;
    }
    const av = body.angvel();
    const dx = (wx - av.x) * fraction;
    const dy = (wy - av.y) * fraction;
    const dz = (wz - av.z) * fraction;
    const I = body.effectiveAngularInertia();
    body.applyTorqueImpulse(
      {
        x: I.m11 * dx + I.m12 * dy + I.m13 * dz,
        y: I.m21 * dx + I.m22 * dy + I.m23 * dz,
        z: I.m31 * dx + I.m32 * dy + I.m33 * dz,
      },
      true
    );
  }

  // ------------------------------------------------------------------ poses
  locomotionPose(p, dt) {
    const sp = this.speed;
    const run = Math.min(1, Math.max(0, (sp - 1.6) / 1.6));
    const stride = 1.3 + run * 0.9;
    if (sp > 0.05) this.phase += (dt * sp * Math.PI * 2) / stride;
    const amp = Math.min(1, sp / 1.2);
    const A = (0.42 + run * 0.35) * amp;
    const Kb = (0.75 + run * 0.45) * amp;
    const s = Math.sin(this.phase);
    const c = Math.cos(this.phase);
    lerpPose(p, POSE_STAND, POSE_STAND, 0);
    // legs
    p[B.THIGH_L][0] = -0.04 - A * s;
    p[B.THIGH_R][0] = -0.04 + A * s;
    p[B.SHIN_L][0] = 0.08 + Kb * Math.max(0, c) * (0.6 + 0.4 * Math.max(0, -s));
    p[B.SHIN_R][0] = 0.08 + Kb * Math.max(0, -c) * (0.6 + 0.4 * Math.max(0, s));
    p[B.FOOT_L][0] = -0.04 + (A * s - p[B.SHIN_L][0] * 0.4) * 0.5;
    p[B.FOOT_R][0] = -0.04 + (-A * s - p[B.SHIN_R][0] * 0.4) * 0.5;
    // arms swing opposite to legs
    const armA = A * (0.7 + run * 0.4);
    p[B.UARM_L][0] = -0.1 + armA * s;
    p[B.UARM_R][0] = -0.1 - armA * s;
    p[B.FARM_L][0] = 0.28 + run * 1.1 + amp * 0.15;
    p[B.FARM_R][0] = 0.28 + run * 1.1 + amp * 0.15;
    p[B.SPINE][1] = 0.08 * s * amp;
    p[B.CHEST][1] = -0.1 * s * amp;
    p[B.SPINE][0] = 0.02 + run * 0.12;
    // idle sway / breathing
    p[B.CHEST][0] += Math.sin((this.time + this.animT) * 1.6) * 0.015;
    if (this.punchTime > 0) {
      // extend the punching arm straight forward, then pull back
      const k = this.punchTime > 0.14 ? 1 : this.punchTime / 0.14;
      const right = this.punchSide === B.HAND_R;
      const ua = right ? B.UARM_R : B.UARM_L;
      const fa = right ? B.FARM_R : B.FARM_L;
      p[ua][0] = -1.45 * k + p[ua][0] * (1 - k);
      p[ua][2] = (right ? 0.62 : -0.62) * k + p[ua][2] * (1 - k);
      p[fa][0] = 0.12 * k + p[fa][0] * (1 - k);
      p[B.CHEST][1] = (right ? 0.35 : -0.35) * k;
      p[B.SPINE][1] = (right ? 0.15 : -0.15) * k;
    }
    if (this.pain > 0.4) {
      p[B.SPINE][0] += 0.2 * this.pain;
      p[B.HEAD][0] += 0.2 * this.pain;
    }
  }

  flailPose(p) {
    const t = this.time + this.animT;
    lerpPose(p, POSE_STAND, POSE_STAND, 0);
    p[B.UARM_L][0] = -0.6 + Math.sin(t * 9.1) * 0.9;
    p[B.UARM_L][2] = 0.3 + Math.sin(t * 7.3) * 0.9;
    p[B.UARM_R][0] = -0.6 + Math.sin(t * 8.3 + 1.2) * 0.9;
    p[B.UARM_R][2] = -0.3 - Math.sin(t * 6.9 + 0.4) * 0.9;
    p[B.FARM_L][0] = 0.9 + Math.sin(t * 11) * 0.7;
    p[B.FARM_R][0] = 0.9 + Math.sin(t * 10.3 + 2) * 0.7;
    p[B.THIGH_L][0] = -0.5 + Math.sin(t * 8) * 0.7;
    p[B.THIGH_R][0] = -0.5 + Math.sin(t * 8 + Math.PI) * 0.7;
    p[B.SHIN_L][0] = 0.8 + Math.sin(t * 8 + 1) * 0.6;
    p[B.SHIN_R][0] = 0.8 + Math.sin(t * 8 + 1 + Math.PI) * 0.6;
    p[B.SPINE][0] = 0.2 + Math.sin(t * 5) * 0.2;
    p[B.HEAD][0] = Math.sin(t * 6) * 0.3;
  }

  // ------------------------------------------------------------------ brain
  think(dt) {
    const ai = this.game.settings?.ai !== false;
    const pel = this.ragdoll.bodies[B.PELVIS];
    const pt = pel.translation();
    const pv = pel.linvel();
    this.speed = Math.hypot(pv.x, pv.z);
    this.fear = Math.max(0, this.fear - dt * 0.12);
    if (this.controlled) {
      this.controlThink(dt);
      return;
    }

    let desired = 0;
    if (this.fear > 0.3 && this.canStand()) {
      // run away from the danger
      const dx = pt.x - this.fearFrom.x;
      const dz = pt.z - this.fearFrom.z;
      this.heading = turnToward(this.heading, Math.atan2(dx, dz), dt * 4);
      desired = 3.0 + Math.min(1, this.fear) * 0.8;
      this.target = null;
    } else if (ai) {
      if (!this.target) {
        this.idleTimer -= dt;
        if (this.idleTimer <= 0) {
          const a = Math.random() * Math.PI * 2;
          const r = 3 + Math.random() * 16;
          this.target = new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
          this.walkSpeed = 1.0 + Math.random() * 0.5;
          this.targetTime = 0;
        }
      } else {
        const dx = this.target.x - pt.x;
        const dz = this.target.z - pt.z;
        const d = Math.hypot(dx, dz);
        this.targetTime = (this.targetTime ?? 0) + dt;
        if (d < 0.8 || this.targetTime > 40) {
          this.target = null;
          this.idleTimer = 2 + Math.random() * 6;
        } else {
          this.heading = turnToward(this.heading, Math.atan2(dx, dz), dt * 2.5);
          desired = this.walkSpeed * Math.min(1, d / 1.5);
          // avoid walking off things / into walls
          if (this.blockedAhead(pt)) {
            this.target = null;
            this.idleTimer = 0.5;
            this.heading += Math.PI * (0.5 + Math.random());
          }
        }
      }
    }
    if (this.pain > 0.5) desired *= 0.6;
    desired *= chemBoost(this).speed;
    this.desiredSpeed += (desired - this.desiredSpeed) * Math.min(1, dt * 3);
    this.yaw = turnToward(this.yaw, this.heading, dt * 5);

    // look around
    this.lookTimer = (this.lookTimer ?? 0) - dt;
    if (this.lookTimer <= 0) {
      this.lookTimer = 1.5 + Math.random() * 3;
      this.lookYawGoal = (Math.random() - 0.5) * 1.4;
      this.lookPitchGoal = (Math.random() - 0.5) * 0.3;
    }
    this.lookYaw += ((this.lookYawGoal ?? 0) - this.lookYaw) * Math.min(1, dt * 3);
    this.lookPitch += ((this.lookPitchGoal ?? 0) - this.lookPitch) * Math.min(1, dt * 3);
  }

  /** Player control: input is a world-space direction set by the Control tool. */
  controlThink(dt) {
    const inp = this.controlInput || { x: 0, z: 0, run: false };
    const len = Math.hypot(inp.x, inp.z);
    let desired = 0;
    if (len > 0.1) {
      this.heading = Math.atan2(inp.x, inp.z);
      desired = inp.run ? 3.7 : 1.7;
    }
    if (this.pain > 0.5) desired *= 0.7;
    desired *= chemBoost(this).speed;
    this.desiredSpeed += (desired - this.desiredSpeed) * Math.min(1, dt * 6);
    this.yaw = turnToward(this.yaw, this.heading, dt * 9);
    this.lookYaw += (0 - this.lookYaw) * Math.min(1, dt * 5);
    this.lookPitch += (0 - this.lookPitch) * Math.min(1, dt * 5);
  }

  jump() {
    if (this.state !== ST.ACTIVE || !this.grounded || this.jumpTime > 0) return false;
    const fwd = this.desiredSpeed;
    const fx = Math.sin(this.heading) * fwd * 0.4;
    const fz = Math.cos(this.heading) * fwd * 0.4;
    this.ragdoll.bodies.forEach((b, i) => {
      const m = this.ragdoll.masses[i];
      b.applyImpulse({ x: fx * m, y: 3.2 * m, z: fz * m }, true);
    });
    this.jumpTime = 0.9;
    return true;
  }

  punch() {
    if (this.state !== ST.ACTIVE || this.punchTime > 0) return false;
    this.punchSide = this.punchSide === B.HAND_R ? B.HAND_L : B.HAND_R;
    this.punchTime = 0.34;
    this.punchHits = new Set();
    const hand = this.ragdoll.bodies[this.punchSide];
    const dx = Math.sin(this.yaw), dz = Math.cos(this.yaw);
    hand.applyImpulse({ x: dx * 5.5, y: 0.8, z: dz * 5.5 }, true);
    this.game.audio?.whoosh(hand.translation(), 0.35);
    return true;
  }

  /** While a punch is in flight, anything the fist touches gets hit once. */
  punchContacts() {
    const col = this.ragdoll.colliders[this.punchSide];
    const world = this.game.physics.world;
    world.contactPairsWith(col, (other) => {
      const o = this.game.physics.ownerOf(other.handle);
      const e = o?.entity;
      if (!e || e === this || e.kind === 'static' || this.punchHits.has(e)) return;
      this.punchHits.add(e);
      const t = col.translation();
      const p = new THREE.Vector3(t.x, t.y, t.z);
      const dir = new THREE.Vector3(Math.sin(this.yaw), 0.15, Math.cos(this.yaw)).normalize();
      if (e.kind === 'person') {
        const part = o.part ?? B.CHEST;
        e.damage({ amount: part === B.HEAD ? 14 : 9, part, point: p, dir, kind: 'blunt' });
        e.stun += part === B.HEAD ? 0.55 : 0.3;
        e.bodies[part].applyImpulse({ x: dir.x * 30, y: dir.y * 30, z: dir.z * 30 }, true);
        if (e.alive) e.fear = Math.min(2, e.fear + 1);
        e.fearFrom.copy(p);
      } else {
        e.impulse(dir.clone().multiplyScalar(40), p, o.part);
      }
      this.game.audio?.impact(e.kind === 'person' ? 'flesh' : e.material || 'wood', 0.8, p);
    });
  }

  blockedAhead(pt) {
    this._probeT = (this._probeT ?? 0) + 1;
    if (this._probeT % 10 !== 0) return false;
    const fx = Math.sin(this.heading);
    const fz = Math.cos(this.heading);
    const phys = this.game.physics;
    // wall in front at knee height
    const wall = phys.raycast({ x: 0, y: 0, z: 0, ...{ x: this.ragdoll.bodies[B.PELVIS].translation().x, y: this.groundY + 0.4, z: this.ragdoll.bodies[B.PELVIS].translation().z } }, { x: fx, y: 0, z: fz }, 1.0, null, GROUPS.queryStatic);
    if (wall) return true;
    // drop in front
    const p = this.ragdoll.bodies[B.PELVIS].translation();
    const ahead = phys.raycast({ x: p.x + fx * 0.9, y: p.y, z: p.z + fz * 0.9 }, { x: 0, y: -1, z: 0 }, 2.5, null, GROUPS.queryStatic);
    if (!ahead || p.y - ahead.toi < this.groundY - 0.5) return true;
    return false;
  }

  hear(point, loudness) {
    if (!this.conscious) return;
    const pel = this.ragdoll.bodies[B.PELVIS].translation();
    const d = Math.hypot(pel.x - point.x, pel.z - point.z);
    const f = loudness / Math.max(2, d);
    if (f > 0.15) {
      this.fear = Math.min(2, this.fear + f);
      this.fearFrom.set(point.x, point.y, point.z);
      this.lookYawGoal = 0;
    }
  }

  // ------------------------------------------------------------------ vitals & damage
  updateVitals(dt) {
    if (this.state === ST.DEAD) {
      this.deathTime += dt;
      this.blood = Math.max(0, this.blood - this.bleed * dt);
      this.bleed *= Math.exp(-dt / 8);
      return;
    }
    this.blood = Math.max(0, this.blood - this.bleed * dt);
    this.bleed *= Math.exp(-dt / 25);
    this.pain = Math.max(0, this.pain - dt * 0.03);
    this.stun = Math.max(0, this.stun - dt * 0.8);
    this.voiceCooldown -= dt;
    if (this.blood < (this.chem.adrenaline > 0.2 ? 20 : 30) && this.state !== ST.UNCONSCIOUS) this.knockOut(6 + Math.random() * 6);
    if (this.blood <= 8 || this.health <= 0) this.die();
  }

  knockOut(seconds) {
    if (this.state === ST.DEAD) return;
    this.setState(ST.UNCONSCIOUS);
    this.unconsciousTimer = seconds;
  }

  die(cause = '') {
    if (this.state === ST.DEAD) return;
    this.health = Math.min(this.health, 0);
    this.setState(ST.DEAD);
    this.deathTime = 0;
    this.cause = cause;
    this.game.events?.emit('death', this);
  }

  /**
   * info: { amount, part, point (Vector3), dir (Vector3), kind: 'bullet'|'blunt'|'explosion'|'fire', bleed }
   */
  damage(info) {
    if (this.removed) return;
    const part = info.part ?? B.CHEST;
    const mult = PART_MULT[part] ?? 1;
    const dmg = info.amount * mult;
    if (dmg <= 0) return;
    if (!this.attached[part]) {
      // a part that came off: only the visuals
      if (this.ch && info.point && (info.kind === 'bullet' || info.kind === 'cut') && !this.dummy && this.game.settings?.blood !== false) {
        paintDamage(this.ch, part, info.point, 0.03, 1, 0);
      }
      if (this.ch && info.point && (info.kind === 'explosion' || info.kind === 'fire')) paintDamage(this.ch, part, info.point, 0.2, Math.min(1, dmg / 40), 1);
      return;
    }
    const wasAlive = this.alive;
    this.health -= dmg;
    this.pain = Math.min(1, this.pain + dmg / 45);
    this.stun += dmg / (info.kind === 'bullet' ? 45 : 30);
    this.lastHit = this.time;
    if (info.kind === 'bullet' || info.kind === 'cut') {
      if (!this.dummy) this.bleed += dmg * 0.05 * (info.bleed ?? 1);
      if (info.point) this.addWound(part, info.point);
    }
    if (info.point) {
      this.fear = Math.min(2, this.fear + 1.2);
      this.fearFrom.copy(info.point).addScaledVector(info.dir || _v.set(0, 0, 0), -6);
    }
    if (part === B.HEAD && dmg > 45) {
      if (dmg > 70 || Math.random() < 0.6) this.die('head');
      else this.knockOut(8 + Math.random() * 10);
    } else if (part === B.HEAD && dmg > 20 && Math.random() < 0.5) {
      this.knockOut(3 + Math.random() * 5);
    }
    if (this.health <= 0) this.die(info.kind);
    if (this.state === ST.ACTIVE && this.stun > 0.6) this.fall();
    if (wasAlive && this.alive && this.voiceCooldown <= 0 && dmg > 6) {
      this.voiceCooldown = 0.8 + Math.random();
      if (!this.dummy) this.game.audio?.voice(this, Math.min(1, dmg / 40));
    }
    // visuals
    if (this.ch && info.point && this.game.settings?.blood !== false && !this.dummy) {
      if (info.kind === 'bullet' || info.kind === 'cut') {
        paintDamage(this.ch, part, info.point, 0.022 + Math.min(0.03, dmg * 0.0008), 1, 0);
        paintDamage(this.ch, part, info.point, 0.06 + Math.min(0.06, dmg * 0.002), 0.25, 0);
      } else if (info.kind === 'blunt' && dmg > 12) {
        paintDamage(this.ch, part, info.point, 0.04, Math.min(0.6, dmg / 60), 0);
      }
    }
    if (this.ch && info.kind === 'explosion' && info.point) {
      paintDamage(this.ch, part, info.point, 0.25, Math.min(1, dmg / 40), 1);
    }
    if (info.kind === 'bullet' && info.dir) bulletTrauma(this, part, info.amount, info.dir);
  }

  /** Electric shock at a point: convulsions for `seconds`, burns, and a stopped heart if weak. */
  shock(power, seconds, point, part = B.CHEST) {
    if (this.removed) return;
    this.shockTime = Math.max(this.shockTime ?? 0, seconds);
    this.damage({ amount: 7 * power, part, point, kind: 'shock' });
    this.stun += 1.5 * power;
    if (this.state === ST.ACTIVE) this.fall();
    if (this.alive && power >= 1 && this.health < 40 && Math.random() < 0.2 * power) this.die('electrocuted');
    if (this.ch && point) paintDamage(this.ch, part, point, 0.035, 0.8, 1);
    this.ragdoll.wake();
  }

  addWound(part, point) {
    const b = this.ragdoll.bodies[part];
    const t = b.translation();
    const r = b.rotation();
    _q.set(r.x, r.y, r.z, r.w).invert();
    const local = new THREE.Vector3(point.x - t.x, point.y - t.y, point.z - t.z).applyQuaternion(_q);
    this.wounds.push({ part, local });
    if (this.wounds.length > 8) this.wounds.shift();
  }

  /** Blood dripping from open wounds and a pool under a body lying still. */
  updateBleeding(dt) {
    const fx = this.game.fx;
    if (this.dummy) return;
    if (!fx || this.game.settings?.blood === false || dt <= 0) return;
    if (this.bleed > 0.25 && this.wounds.length) {
      this.dripTimer = (this.dripTimer ?? 0) - dt * Math.min(4, this.bleed);
      if (this.dripTimer <= 0) {
        this.dripTimer = 0.18 + Math.random() * 0.2;
        const w = this.wounds[Math.floor(Math.random() * this.wounds.length)];
        const b = this.ragdoll.bodies[w.part];
        const t = b.translation();
        const r = b.rotation();
        _q.set(r.x, r.y, r.z, r.w);
        const p = _v2.copy(w.local).applyQuaternion(_q).add(_v.set(t.x, t.y, t.z));
        const v = b.linvel();
        fx.addDrop(p, new THREE.Vector3(v.x * 0.5 + (Math.random() - 0.5) * 0.3, v.y * 0.5 - 0.2, v.z * 0.5 + (Math.random() - 0.5) * 0.3), 0.01 + Math.random() * 0.012);
      }
    }
    const lying = this.state === ST.DOWN || this.state === ST.DEAD || this.state === ST.UNCONSCIOUS;
    if (lying && this.bleed > 0.3 && this.stateTime > 1) {
      const c = this.ragdoll.bodies[B.SPINE].translation();
      const v = this.ragdoll.bodies[B.SPINE].linvel();
      const still = Math.hypot(v.x, v.y, v.z) < 0.3;
      const far = !this.poolAt || Math.hypot(c.x - this.poolAt.x, c.z - this.poolAt.z) > 1.2;
      if (still && far && (this.poolCount ?? 0) < 3) {
        if (fx.bloodPool(this, new THREE.Vector3(c.x, c.y, c.z))) {
          this.poolAt = new THREE.Vector3(c.x, c.y, c.z);
          this.poolCount = (this.poolCount ?? 0) + 1;
        }
      }
    }
  }

  /** Paint a bullet wound without dealing damage (used for exit wounds). */
  wound(part, point, scale = 1) {
    if (this.dummy || !this.ch || this.game.settings?.blood === false) return;
    paintDamage(this.ch, part, point, 0.026 * scale, 1, 0);
    paintDamage(this.ch, part, point, 0.07 * scale, 0.3, 0);
  }

  /** Called from the physics impact listener. impulse in N*s. */
  onImpact(part, impulse, otherEntity) {
    if (otherEntity === this) return;
    if (this.punchTime > 0 && part === this.punchSide) return; // our own fist landing a punch
    // injury is driven by the body's velocity change this step, not raw contact force
    // (resting contacts and joint-limit fights produce force without any change in velocity)
    const body = this.ragdoll.bodies[part];
    const v = body.linvel();
    const pv = this.prevVel;
    const dv = Math.min(impulse / this.ragdoll.masses[part], Math.hypot(v.x - pv[part * 3], v.y - pv[part * 3 + 1], v.z - pv[part * 3 + 2]));
    if (this.game.debugImpacts && dv > 3) console.log('impact', BONE_NAMES[part], 'J', impulse.toFixed(1), 'dv', dv.toFixed(1), this.state);
    if (dv > 2.5) this.game.audio?.impact(this.dummy ? 'rubber' : 'flesh', Math.min(1, dv / 12), this.ragdoll.bodies[part].translation());
    if (!this.attached[part]) return;
    // extremities swing fast during normal motion; they need a much harder hit to be hurt
    const limit = IMPACT_LIMIT[part];
    if (dv < limit) return;
    const amount = (dv - limit) * 7;
    const t = this.ragdoll.bodies[part].translation();
    this.damage({ amount, part, point: new THREE.Vector3(t.x, t.y, t.z), kind: 'blunt' });
    if (dv > 9 && this.state === ST.ACTIVE && part <= B.HEAD) this.fall();
    impactTrauma(this, part, dv, limit);
  }

  /** Returns false when the injuries are beyond healing (no head, cut in half). */
  heal() {
    healInjuries(this);
    clearChem(this);
    if (fatalLoss(this)) {
      this.bleed = 0;
      return false;
    }
    this.health = 100;
    this.blood = 100;
    this.bleed = 0;
    this.pain = 0;
    this.stun = 0;
    this.fear = 0;
    this.pale = 0;
    this.wounds.length = 0;
    if (this.ch) {
      clearDamage(this.ch);
      this.ch.material.userData.uniforms.uPale.value = 0;
    }
    if (this.state === ST.DEAD || this.state === ST.UNCONSCIOUS) {
      this.setState(ST.DOWN);
      this.recoverTime = 0.8;
    }
    this.ragdoll.wake();
    return true;
  }

  injuryText() {
    return injuryText(this);
  }

  // ------------------------------------------------------------------ frame update / render sync
  update(dt) {
    if (!this.ch) return;
    this.syncBones();
    this.updateBleeding(dt);
    if (!this.dummy) updateSpurts(this, dt);
    // eyes
    let lid = -0.45;
    if (this.state === ST.DEAD) lid = 0.12;
    else if (this.state === ST.UNCONSCIOUS) lid = 0.65;
    else {
      this.blinkTimer -= dt;
      if (this.blinkTimer <= 0) {
        this.blink = 0.14;
        this.blinkTimer = 2 + Math.random() * 4;
      }
      if (this.blink > 0) {
        this.blink -= dt;
        lid = 0.6;
      } else if (this.pain > 0.6 || this.state === ST.FALLING) lid = -0.1;
      else if (this.fear > 0.5) lid = -0.75;
    }
    for (const l of this.ch.lids) l.rotation.x += (lid - l.rotation.x) * Math.min(1, dt * 30);
    // pallor from blood loss / death
    const pale = this.dummy ? 0 : this.state === ST.DEAD ? Math.min(1, 0.35 + this.deathTime / 25) : Math.max(0, (60 - this.blood) / 60);
    this.pale += (pale - this.pale) * Math.min(1, dt);
    this.ch.material.userData.uniforms.uPale.value = this.pale;
  }

  syncBones() {
    const bones = this.ch.bones;
    for (let i = 0; i < BONE_COUNT; i++) {
      const b = this.ragdoll.bodies[i];
      const t = b.translation();
      const r = b.rotation();
      bones[i].position.set(t.x, t.y, t.z);
      bones[i].quaternion.set(r.x, r.y, r.z, r.w);
    }
  }

  position(out) {
    const t = this.ragdoll.bodies[B.CHEST].translation();
    return out.set(t.x, t.y, t.z);
  }

  partName(part) {
    return BONE_NAMES[part] || 'Body';
  }

  setFrozen(frozen) {
    this.frozen = frozen;
  }

  destroy() {
    if (this.removed) return;
    super.destroy();
    this.ragdoll.destroy();
    if (this.ch) {
      this.game.scene.remove(this.ch.root);
      // template buffers are shared between people: detach them so dispose() only frees ours
      const g = this.ch.geometry;
      // (after a dismemberment the skinning and index buffers are this person's own)
      for (const k of this.ch.ownSkin ? ['normal'] : ['normal', 'skinIndex', 'skinWeight']) g.deleteAttribute(k);
      if (!this.ch.ownSkin) g.setIndex(null);
      g.dispose();
      this.ch.material.dispose();
      const lg = this.ch.lids[0]?.geometry;
      if (lg) {
        for (const k of ['position', 'normal']) lg.deleteAttribute(k);
        lg.setIndex(null);
        lg.dispose();
      }
    }
  }
}

function smooth(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function turnToward(a, b, maxStep) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  if (Math.abs(d) <= maxStep) return b;
  return a + Math.sign(d) * maxStep;
}

