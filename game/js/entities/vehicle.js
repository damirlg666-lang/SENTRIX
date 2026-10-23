// A rolling physics car: chassis + four wheel bodies on revolute joints.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Entity } from './entity.js';
import { R, GROUPS } from '../engine/physics.js';
import { merge } from '../util/geo.js';

const CAR_COLORS = [0xb3151b, 0x1f4fa8, 0xe8e6e1, 0x16181b, 0x6c7a86, 0x2f6b3c, 0xd9a21b, 0x7a1430];
const WHEEL_X = 1.32;
const WHEEL_Z = 0.8;
const WHEEL_R = 0.33;
const WHEEL_Y = 0.33;

let shared = null;

function sharedParts() {
  if (shared) return shared;
  const s = new THREE.Shape();
  s.moveTo(2.18, 0.34);
  s.lineTo(2.22, 0.62);
  s.quadraticCurveTo(2.24, 0.86, 2.0, 0.9);
  s.lineTo(1.08, 1.0);
  s.lineTo(0.36, 1.4);
  s.lineTo(-0.72, 1.4);
  s.lineTo(-1.38, 1.04);
  s.lineTo(-1.95, 1.0);
  s.quadraticCurveTo(-2.2, 0.98, -2.2, 0.78);
  s.lineTo(-2.17, 0.34);
  s.lineTo(-WHEEL_X - 0.43, 0.34);
  s.absarc(-WHEEL_X, WHEEL_Y, 0.43, Math.PI, 0, true);
  s.lineTo(WHEEL_X - 0.43, 0.34);
  s.absarc(WHEEL_X, WHEEL_Y, 0.43, Math.PI, 0, true);
  s.lineTo(2.18, 0.34);
  const body = new THREE.ExtrudeGeometry(s, { depth: 1.62, bevelEnabled: true, bevelThickness: 0.09, bevelSize: 0.08, bevelSegments: 4, curveSegments: 18 });
  body.translate(0, 0, -0.81);
  body.computeVertexNormals();

  // greenhouse glass
  const side = new THREE.Shape();
  side.moveTo(-1.26, 1.07);
  side.lineTo(-0.7, 1.35);
  side.lineTo(0.33, 1.35);
  side.lineTo(0.98, 1.04);
  side.closePath();
  const sideGeo = new THREE.ExtrudeGeometry(side, { depth: 0.012, bevelEnabled: false });
  const glassParts = [];
  for (const z of [0.895, -0.907]) glassParts.push(sideGeo.clone().translate(0, 0, z));
  const quadBetween = (a, b, w) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const g = new THREE.BoxGeometry(len, 0.012, w);
    g.rotateZ(Math.atan2(b[1] - a[1], b[0] - a[0]));
    g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0);
    return g;
  };
  glassParts.push(quadBetween([1.1, 1.03], [0.37, 1.43], 1.55));
  glassParts.push(quadBetween([-0.73, 1.43], [-1.39, 1.07], 1.5));
  const glass = merge(glassParts);

  // pillars over the glass (body coloured)
  const pillars = merge([new THREE.BoxGeometry(0.1, 0.33, 1.83).translate(-0.18, 1.2, 0)]);

  // trim: bumpers, grille, mirrors, sills
  const trim = merge([
    new RoundedBoxGeometry(0.22, 0.22, 1.86, 2, 0.06).translate(2.2, 0.47, 0),
    new RoundedBoxGeometry(0.22, 0.22, 1.86, 2, 0.06).translate(-2.2, 0.47, 0),
    new RoundedBoxGeometry(0.06, 0.16, 0.9, 1, 0.02).translate(2.29, 0.7, 0),
    new RoundedBoxGeometry(0.16, 0.1, 0.06, 1, 0.02).translate(0.9, 1.05, 0.95),
    new RoundedBoxGeometry(0.16, 0.1, 0.06, 1, 0.02).translate(0.9, 1.05, -0.95),
    new THREE.BoxGeometry(1.7, 0.06, 0.04).translate(0, 0.36, 0.93),
    new THREE.BoxGeometry(1.7, 0.06, 0.04).translate(0, 0.36, -0.93),
  ]);
  const headlights = merge([
    new RoundedBoxGeometry(0.06, 0.12, 0.32, 1, 0.03).translate(2.24, 0.76, 0.6),
    new RoundedBoxGeometry(0.06, 0.12, 0.32, 1, 0.03).translate(2.24, 0.76, -0.6),
  ]);
  const taillights = merge([
    new RoundedBoxGeometry(0.06, 0.12, 0.36, 1, 0.03).translate(-2.25, 0.84, 0.58),
    new RoundedBoxGeometry(0.06, 0.12, 0.36, 1, 0.03).translate(-2.25, 0.84, -0.58),
  ]);

  // wheel
  const tire = new THREE.TorusGeometry(0.245, 0.09, 18, 40);
  tire.scale(1, 1, 1.25);
  const rimParts = [new THREE.CylinderGeometry(0.19, 0.19, 0.2, 28).rotateX(Math.PI / 2)];
  for (let i = 0; i < 5; i++) {
    const sp = new THREE.BoxGeometry(0.05, 0.17, 0.03);
    sp.translate(0, 0.09, 0.105);
    sp.rotateZ((i / 5) * Math.PI * 2);
    rimParts.push(sp);
  }
  rimParts.push(new THREE.CylinderGeometry(0.05, 0.05, 0.24, 16).rotateX(Math.PI / 2));
  const rim = merge(rimParts);

  shared = {
    body, glass, pillars, trim, headlights, taillights, tire, rim,
    glassMat: new THREE.MeshPhysicalMaterial({ color: 0x0b1118, roughness: 0.04, metalness: 0.3, clearcoat: 1, clearcoatRoughness: 0.02 }),
    trimMat: new THREE.MeshStandardMaterial({ color: 0x1c1e21, roughness: 0.6, metalness: 0.2 }),
    headMat: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4dd, emissiveIntensity: 0.8, roughness: 0.1 }),
    tailMat: new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff1a10, emissiveIntensity: 0.6, roughness: 0.2 }),
    tireMat: new THREE.MeshStandardMaterial({ color: 0x161618, roughness: 0.92 }),
    rimMat: new THREE.MeshStandardMaterial({ color: 0xc4c8ce, metalness: 0.95, roughness: 0.25 }),
  };
  return shared;
}

export class Car extends Entity {
  constructor(game, position, yaw = 0, color = null) {
    super(game);
    this.kind = 'vehicle';
    this.name = 'Car';
    this.material = 'metal';
    const S = sharedParts();
    this.paint = new THREE.MeshPhysicalMaterial({
      color: color ?? CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)],
      metalness: 0.55, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.04,
    });
    const g = new THREE.Group();
    g.add(new THREE.Mesh(S.body, this.paint));
    g.add(new THREE.Mesh(S.pillars, this.paint));
    g.add(new THREE.Mesh(S.glass, S.glassMat));
    g.add(new THREE.Mesh(S.trim, S.trimMat));
    g.add(new THREE.Mesh(S.headlights, S.headMat));
    g.add(new THREE.Mesh(S.taillights, S.tailMat));
    g.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    g.userData.entity = this;
    this.mesh = g;
    game.scene.add(g);

    const world = game.physics.world;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    const rq = { x: q.x, y: q.y, z: q.z, w: q.w };
    const chassis = world.createRigidBody(
      R.RigidBodyDesc.dynamic().setTranslation(position.x, position.y + 0.02, position.z).setRotation(rq).setLinearDamping(0.05).setAngularDamping(0.3).setCcdEnabled(true)
    );
    this.chassis = chassis;
    this.bodies = [chassis];
    this.colliders = [];
    const add = (desc, body, part, mass) => {
      desc.setCollisionGroups(GROUPS.prop).setMass(mass).setFriction(0.6).setRestitution(0.1)
        .setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(mass * 60);
      const c = world.createCollider(desc, body);
      game.physics.register(c, this, part);
      this.colliders.push(c);
      return c;
    };
    add(R.ColliderDesc.roundCuboid(2.1, 0.22, 0.86, 0.06).setTranslation(0, 0.62, 0), chassis, 0, 850);
    add(R.ColliderDesc.roundCuboid(0.8, 0.16, 0.76, 0.06).setTranslation(-0.2, 1.16, 0), chassis, 0, 250);

    this.wheels = [];
    this.joints = [];
    const wq = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
    for (const [x, z] of [[WHEEL_X, WHEEL_Z], [WHEEL_X, -WHEEL_Z], [-WHEEL_X, WHEEL_Z], [-WHEEL_X, -WHEEL_Z]]) {
      const wp = new THREE.Vector3(x, WHEEL_Y, z).applyQuaternion(q).add(position);
      const wb = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(wp.x, wp.y + 0.02, wp.z).setRotation(rq).setAngularDamping(0.05).setCcdEnabled(true));
      const c = add(R.ColliderDesc.roundCylinder(0.06, WHEEL_R - 0.05, 0.05).setRotation({ x: wq.x, y: wq.y, z: wq.z, w: wq.w }), wb, this.wheels.length + 1, 22);
      c.setFriction(1.4);
      const jd = R.JointData.revolute({ x, y: WHEEL_Y, z }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
      const joint = world.createImpulseJoint(jd, chassis, wb, true);
      joint.setContactsEnabled(false);
      this.joints.push(joint);
      const wm = new THREE.Group();
      const tire = new THREE.Mesh(S.tire, S.tireMat);
      const rim = new THREE.Mesh(S.rim, S.rimMat);
      rim.scale.z = z > 0 ? 1 : -1;
      wm.add(tire, rim);
      wm.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      wm.userData.entity = this;
      game.scene.add(wm);
      this.wheels.push({ body: wb, mesh: wm });
      this.bodies.push(wb);
    }
    this.health = 450;
    this.maxHealth = 450;
    this.driving = false;
    this.smokeT = 0;
    this.prevVel = new THREE.Vector3();
    this.age = 0;
    this.sync();
  }

  sync() {
    const t = this.chassis.translation();
    const r = this.chassis.rotation();
    this.mesh.position.set(t.x, t.y, t.z);
    this.mesh.quaternion.set(r.x, r.y, r.z, r.w);
    for (const w of this.wheels) {
      const wt = w.body.translation();
      const wr = w.body.rotation();
      w.mesh.position.set(wt.x, wt.y, wt.z);
      w.mesh.quaternion.set(wr.x, wr.y, wr.z, wr.w);
    }
  }

  prePhysics(dt) {
    const v = this.chassis.linvel();
    this.prevVel.set(v.x, v.y, v.z);
    if (this.driving) {
      // drive the rear wheels; positive spin about +Z rolls the car toward local +X
      for (let i = 2; i < 4; i++) {
        const j = this.joints[i];
        j.configureMotorVelocity(-26, 1200);
      }
    }
  }

  activate() {
    this.driving = !this.driving;
    for (let i = 2; i < 4; i++) {
      if (!this.driving) this.joints[i].configureMotorVelocity(0, 0);
    }
    this.chassis.wakeUp();
    return true;
  }

  update(dt) {
    if (this.removed) return;
    this.age += dt;
    this.sync();
    if (this.health < 180 && dt > 0) {
      this.smokeT -= dt;
      if (this.smokeT <= 0) {
        this.smokeT = 0.08;
        const p = new THREE.Vector3(1.6, 1.0, 0).applyQuaternion(this.mesh.quaternion).add(this.mesh.position);
        this.game.fx?.smoke(p, 1, { gray: this.health < 90 ? 0.12 : 0.5, size: 0.35, alpha: 0.4 });
        if (this.health < 90) this.game.fx?.fire(p, 1, 0.35);
      }
    }
  }

  damage(info) {
    if (this.removed) return;
    this.health -= info.amount * (info.kind === 'explosion' ? 1.2 : 0.5);
    if (this.health <= 0 && !this.exploding) {
      this.exploding = true;
      const t = this.chassis.translation();
      const p = new THREE.Vector3(t.x, t.y + 0.6, t.z);
      this.game.explode(p, 2.2, this);
      // wreck stays: blacken paint and leave it burning
      this.paint.color.multiplyScalar(0.15);
      this.paint.clearcoat = 0;
      this.paint.roughness = 0.9;
      this.health = 1;
      this.driving = false;
      this.chassis.applyImpulse({ x: 0, y: 6000, z: 0 }, true);
      this.chassis.applyTorqueImpulse({ x: (Math.random() - 0.5) * 3000, y: 0, z: (Math.random() - 0.5) * 3000 }, true);
    }
  }

  onImpact(part, impulse, other) {
    const v = this.chassis.linvel();
    const dv = Math.hypot(v.x - this.prevVel.x, v.y - this.prevVel.y, v.z - this.prevVel.z);
    if (dv > 1 && this.age > 0.3) this.game.audio?.impact('metal', Math.min(1, dv / 6), this.chassis.translation());
    if (dv > 8 && !this.exploding) this.damage({ amount: (dv - 8) * 30, kind: 'blunt' });
  }

  impulse(imp, point, part) {
    const b = part ? this.bodies[part] || this.chassis : this.chassis;
    b.applyImpulseAtPoint({ x: imp.x, y: imp.y, z: imp.z }, { x: point.x, y: point.y, z: point.z }, true);
  }

  setFrozen(frozen) {
    this.frozen = frozen;
    for (const b of this.bodies) b.setBodyType(frozen ? R.RigidBodyType.Fixed : R.RigidBodyType.Dynamic, true);
  }

  position(out) {
    const t = this.chassis.translation();
    return out.set(t.x, t.y + 0.7, t.z);
  }

  destroy() {
    if (this.removed) return;
    super.destroy();
    for (const b of this.bodies) this.game.physics.removeBody(b);
    this.game.scene.remove(this.mesh);
    for (const w of this.wheels) this.game.scene.remove(w.mesh);
    this.paint.dispose();
  }
}

/** Visual-only car (used for menu thumbnails). */
export function carModel(color = 0xb3151b) {
  const S = sharedParts();
  const paint = new THREE.MeshPhysicalMaterial({ color, metalness: 0.55, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.04 });
  const g = new THREE.Group();
  g.add(new THREE.Mesh(S.body, paint), new THREE.Mesh(S.pillars, paint), new THREE.Mesh(S.glass, S.glassMat), new THREE.Mesh(S.trim, S.trimMat));
  g.add(new THREE.Mesh(S.headlights, S.headMat), new THREE.Mesh(S.taillights, S.tailMat));
  for (const [x, z] of [[WHEEL_X, WHEEL_Z], [WHEEL_X, -WHEEL_Z], [-WHEEL_X, WHEEL_Z], [-WHEEL_X, -WHEEL_Z]]) {
    const w = new THREE.Group();
    w.add(new THREE.Mesh(S.tire, S.tireMat), new THREE.Mesh(S.rim, S.rimMat));
    w.position.set(x, WHEEL_Y, z);
    if (z < 0) w.scale.z = -1;
    g.add(w);
  }
  return g;
}
