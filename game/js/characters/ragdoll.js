// Physical ragdoll: 16 rigid bodies connected by generic joints with anatomical limits and
// position motors ("muscles"). Bodies start in the bind pose with identity relative rotation,
// so joint angles are measured relative to the A-pose.
import * as THREE from 'three';
import { R, GROUPS } from '../engine/physics.js';
import { B, BONE_COUNT, PARENT, ARM_ANGLE } from './skeleton.js';

const AX = { X: 3, Y: 4, Z: 5 }; // RawJointAxis angular indices
const LOCK_LIN = 1 | 2 | 4;
const LOCK_HINGE = LOCK_LIN | 16 | 32;

const MASS_FRACTION = [0.15, 0.12, 0.2, 0.075, 0.03, 0.018, 0.007, 0.03, 0.018, 0.007, 0.1, 0.045, 0.014, 0.1, 0.045, 0.014];

/** Joint table: child bone -> anchor landmark, limits (radians) and muscle strength. */
function jointTable(sk) {
  const j = sk.j;
  const a = sk.j.armDirL;
  const ar = sk.j.armDirR;
  return [
    { child: B.SPINE, at: j.waist, lim: { x: [-0.5, 0.75], y: [-0.45, 0.45], z: [-0.4, 0.4] }, k: 650, c: 40 },
    { child: B.CHEST, at: j.chestJ, lim: { x: [-0.4, 0.6], y: [-0.45, 0.45], z: [-0.35, 0.35] }, k: 520, c: 34 },
    { child: B.HEAD, at: j.neck, lim: { x: [-0.7, 0.85], y: [-1.1, 1.1], z: [-0.6, 0.6] }, k: 130, c: 8 },
    { child: B.UARM_L, at: j.shoulderL, lim: { x: [-2.4, 0.9], y: [-1.2, 1.2], z: [-0.85, 2.2] }, k: 130, c: 8 },
    { child: B.FARM_L, at: j.elbowL, hinge: [a[1], -a[0], 0], lim: { x: [0, 2.5] }, k: 60, c: 4 },
    { child: B.HAND_L, at: j.wristL, lim: { x: [-0.5, 0.5], y: [-0.6, 0.6], z: [-0.9, 0.9] }, k: 14, c: 0.9 },
    { child: B.UARM_R, at: j.shoulderR, lim: { x: [-2.4, 0.9], y: [-1.2, 1.2], z: [-2.2, 0.85] }, k: 130, c: 8 },
    { child: B.FARM_R, at: j.elbowR, hinge: [ar[1], -ar[0], 0], lim: { x: [0, 2.5] }, k: 60, c: 4 },
    { child: B.HAND_R, at: j.wristR, lim: { x: [-0.5, 0.5], y: [-0.6, 0.6], z: [-0.9, 0.9] }, k: 14, c: 0.9 },
    { child: B.THIGH_L, at: j.hipL, lim: { x: [-2.0, 0.55], y: [-0.6, 0.6], z: [-0.35, 1.1] }, k: 700, c: 45 },
    { child: B.SHIN_L, at: j.kneeL, hinge: [1, 0, 0], lim: { x: [0, 2.5] }, k: 550, c: 34 },
    { child: B.FOOT_L, at: j.ankleL, lim: { x: [-0.6, 0.8], y: [-0.3, 0.3], z: [-0.35, 0.35] }, k: 150, c: 9 },
    { child: B.THIGH_R, at: j.hipR, lim: { x: [-2.0, 0.55], y: [-0.6, 0.6], z: [-1.1, 0.35] }, k: 700, c: 45 },
    { child: B.SHIN_R, at: j.kneeR, hinge: [1, 0, 0], lim: { x: [0, 2.5] }, k: 550, c: 34 },
    { child: B.FOOT_R, at: j.ankleR, lim: { x: [-0.6, 0.8], y: [-0.3, 0.3], z: [-0.35, 0.35] }, k: 150, c: 9 },
  ];
}

const _v = new THREE.Vector3();

function quatFromTo(from, to) {
  return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(...from).normalize(), new THREE.Vector3(...to).normalize());
}

export class Ragdoll {
  /**
   * @param physics Physics wrapper
   * @param sk skeleton from makeSkeleton
   * @param pos THREE.Vector3 world position of the feet
   * @param yaw facing angle (radians, 0 = +Z)
   * @param owner entity registered as collider owner
   */
  constructor(physics, sk, pos, yaw, owner) {
    this.physics = physics;
    this.sk = sk;
    const world = physics.world;
    const p = sk.params;
    const j = sk.j;
    const C = sk.centers;
    const qYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    this.bodies = new Array(BONE_COUNT);
    this.colliders = new Array(BONE_COUNT);
    this.masses = new Array(BONE_COUNT);
    this.totalMass = p.mass;

    const capsuleBetween = (a, b, r, center) => {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      const hh = Math.max(0.01, len / 2 - r);
      const mid = [(a[0] + b[0]) / 2 - center[0], (a[1] + b[1]) / 2 - center[1], (a[2] + b[2]) / 2 - center[2]];
      const q = quatFromTo([0, 1, 0], [b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
      return R.ColliderDesc.capsule(hh, r).setTranslation(mid[0], mid[1], mid[2]).setRotation(q);
    };
    const alongX = (hh, r, off = [0, 0, 0]) => {
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
      return R.ColliderDesc.capsule(hh, r).setTranslation(off[0], off[1], off[2]).setRotation(q);
    };

    const descs = new Array(BONE_COUNT);
    descs[B.PELVIS] = alongX(0.065 * p.hip, 0.1 * Math.sqrt(p.girth), [0, -0.005, -0.008]);
    descs[B.SPINE] = alongX(0.055 * p.waist, 0.093 * Math.sqrt(p.waist * p.girth), [0, 0, 0.005 * p.belly]);
    descs[B.CHEST] = alongX(0.075 * p.shoulder, 0.108 * Math.sqrt(p.girth), [0, 0.01, -0.006]);
    descs[B.HEAD] = R.ColliderDesc.ball(0.1 * p.head).setTranslation(0, 0.005, 0.005);
    for (const [S, s] of [['L', 1], ['R', -1]]) {
      const ua = S === 'L' ? B.UARM_L : B.UARM_R;
      const fa = S === 'L' ? B.FARM_L : B.FARM_R;
      const ha = S === 'L' ? B.HAND_L : B.HAND_R;
      descs[ua] = capsuleBetween(j['shoulder' + S], j['elbow' + S], 0.044 * p.limb, C[ua]);
      descs[fa] = capsuleBetween(j['elbow' + S], j['wrist' + S], 0.037 * p.limb, C[fa]);
      const hq = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), s * ARM_ANGLE);
      descs[ha] = R.ColliderDesc.roundCuboid(0.012, 0.07, 0.035, 0.008).setRotation(hq);
      const th = S === 'L' ? B.THIGH_L : B.THIGH_R;
      const sh = S === 'L' ? B.SHIN_L : B.SHIN_R;
      const ft = S === 'L' ? B.FOOT_L : B.FOOT_R;
      descs[th] = capsuleBetween(j['hip' + S], j['knee' + S], 0.074 * p.girth, C[th]);
      descs[sh] = capsuleBetween(j['knee' + S], j['ankle' + S], 0.05 * p.limb, C[sh]);
      descs[ft] = R.ColliderDesc.roundCuboid(0.035, 0.025, 0.1, 0.012).setTranslation(0.004 * s, -0.012, 0.012);
    }

    for (let i = 0; i < BONE_COUNT; i++) {
      const c = C[i];
      _v.set(c[0], c[1], c[2]).applyQuaternion(qYaw).add(pos);
      const bd = R.RigidBodyDesc.dynamic()
        .setTranslation(_v.x, _v.y, _v.z)
        .setRotation({ x: qYaw.x, y: qYaw.y, z: qYaw.z, w: qYaw.w })
        .setLinearDamping(0.05)
        .setAngularDamping(0.35)
        .setCanSleep(true);
      const body = world.createRigidBody(bd);
      body.userData = { bone: i };
      const m = this.totalMass * MASS_FRACTION[i];
      this.masses[i] = m;
      const isFoot = i === B.FOOT_L || i === B.FOOT_R;
      const d = descs[i]
        .setMass(m)
        .setFriction(isFoot ? 1.0 : 0.75)
        .setRestitution(0.04)
        .setCollisionGroups(GROUPS.ragdoll)
        .setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold(m * 300);
      const col = world.createCollider(d, body);
      physics.register(col, owner, i);
      this.bodies[i] = body;
      this.colliders[i] = col;
    }
    // inertia: give small limbs a bit more angular inertia so the solver stays stable
    for (const i of [B.HAND_L, B.HAND_R, B.FOOT_L, B.FOOT_R]) {
      this.bodies[i].setAdditionalSolverIterations?.(2);
    }

    // joints
    this.joints = [];
    this.jointDefs = jointTable(sk);
    const raw = world.impulseJoints.raw;
    this.raw = raw;
    for (const def of this.jointDefs) {
      const child = def.child;
      const parent = PARENT[child];
      const at = def.at;
      const pc = C[parent];
      const cc = C[child];
      const a1 = { x: at[0] - pc[0], y: at[1] - pc[1], z: at[2] - pc[2] };
      const a2 = { x: at[0] - cc[0], y: at[1] - cc[1], z: at[2] - cc[2] };
      let jd;
      if (def.hinge) {
        const ax = new THREE.Vector3(...def.hinge).normalize();
        jd = R.JointData.generic(a1, a2, { x: ax.x, y: ax.y, z: ax.z }, LOCK_HINGE);
      } else {
        // spherical joints use identity frames, so AngX/Y/Z are the parent's local axes
        jd = R.JointData.spherical(a1, a2);
      }
      const joint = world.createImpulseJoint(jd, this.bodies[parent], this.bodies[child], true);
      joint.setContactsEnabled(false);
      const h = joint.handle;
      raw.jointSetLimits(h, AX.X, def.lim.x[0], def.lim.x[1]);
      if (!def.hinge) {
        raw.jointSetLimits(h, AX.Y, def.lim.y[0], def.lim.y[1]);
        raw.jointSetLimits(h, AX.Z, def.lim.z[0], def.lim.z[1]);
      }
      for (const ax of def.hinge ? [AX.X] : [AX.X, AX.Y, AX.Z]) raw.jointConfigureMotorModel(h, ax, R.MotorModel.ForceBased);
      def.k *= this.totalMass / 75;
      def.c *= this.totalMass / 75;
      def.joint = joint;
      def.handle = h;
      def.axes = def.hinge ? [AX.X] : [AX.X, AX.Y, AX.Z];
      def.last = [NaN, NaN, NaN, NaN];
      this.joints.push(joint);
    }
    // extra non-adjacent pairs that should not collide (they overlap at the bind pose)
    this.handles = new Set(this.colliders.map((c) => c.handle));
    this.alive = true;
  }

  /**
   * Drive every joint motor toward a target pose.
   * @param pose array (by child bone) of [x, y, z] target angles
   * @param strength 0..1 muscle tone
   * @param perJoint optional array of extra strength multipliers by child bone
   */
  drive(pose, strength, perJoint = null) {
    const raw = this.raw;
    for (const def of this.jointDefs) {
      const t = pose[def.child] || ZERO;
      const s = strength * (perJoint ? perJoint[def.child] ?? 1 : 1);
      const k = def.k * s;
      // a little residual damping keeps limp bodies from jittering
      const c = def.c * (0.06 + 0.94 * Math.min(1, s * 1.5));
      // skip redundant wasm calls when nothing changed
      const last = def.last;
      if (Math.abs(last[0] - t[0]) < 1e-3 && Math.abs(last[1] - (t[1] || 0)) < 1e-3 && Math.abs(last[2] - (t[2] || 0)) < 1e-3 && Math.abs(last[3] - k) < 0.05 * def.k + 0.01) continue;
      last[0] = t[0];
      last[1] = t[1] || 0;
      last[2] = t[2] || 0;
      last[3] = k;
      if (def.hinge) {
        raw.jointConfigureMotor(def.handle, AX.X, clampLim(t[0], def.lim.x), 0, k, c);
      } else {
        raw.jointConfigureMotor(def.handle, AX.X, clampLim(t[0], def.lim.x), 0, k, c);
        raw.jointConfigureMotor(def.handle, AX.Y, clampLim(t[1] || 0, def.lim.y), 0, k, c);
        raw.jointConfigureMotor(def.handle, AX.Z, clampLim(t[2] || 0, def.lim.z), 0, k, c);
      }
    }
  }

  wake() {
    for (const b of this.bodies) b.wakeUp();
  }

  isSleeping() {
    return this.bodies[B.PELVIS].isSleeping();
  }

  centerOfMass(out = new THREE.Vector3()) {
    out.set(0, 0, 0);
    let m = 0;
    for (let i = 0; i < BONE_COUNT; i++) {
      const t = this.bodies[i].translation();
      out.x += t.x * this.masses[i];
      out.y += t.y * this.masses[i];
      out.z += t.z * this.masses[i];
      m += this.masses[i];
    }
    return out.multiplyScalar(1 / m);
  }

  destroy() {
    for (const b of this.bodies) this.physics.removeBody(b);
    this.alive = false;
  }
}

const ZERO = [0, 0, 0];

function clampLim(v, lim) {
  return v < lim[0] ? lim[0] : v > lim[1] ? lim[1] : v;
}

