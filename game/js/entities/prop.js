// Single-body physics props with procedurally built models.
import * as THREE from 'three';
import { Entity } from './entity.js';
import { R, GROUPS } from '../engine/physics.js';

const _q = new THREE.Quaternion();

export class Prop extends Entity {
  /**
   * def: catalog definition { id, name, material, build(), mass, health, explosive, ... }
   */
  constructor(game, def, position, quaternion = new THREE.Quaternion(), opts = {}) {
    super(game);
    this.kind = 'prop';
    this.def = def;
    this.name = def.name;
    this.material = def.material || 'concrete';
    const built = def.build(opts);
    this.mesh = built.mesh;
    this.mesh.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = o.userData.noShadow ? false : true;
        o.receiveShadow = true;
      }
    });
    this.mesh.userData.entity = this;
    game.scene.add(this.mesh);

    const bd = R.RigidBodyDesc.dynamic()
      .setTranslation(position.x, position.y, position.z)
      .setRotation({ x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w })
      .setLinearDamping(def.linearDamping ?? 0.02)
      .setAngularDamping(def.angularDamping ?? 0.08)
      .setCcdEnabled(!!def.ccd);
    if (def.gravityScale !== undefined) bd.setGravityScale(def.gravityScale);
    const body = game.physics.world.createRigidBody(bd);
    this.body = body;
    this.bodies = [body];
    const total = built.colliders.length;
    this.colliders = [];
    for (const c of built.colliders) {
      const desc = c.desc
        .setCollisionGroups(GROUPS.prop)
        .setFriction(c.friction ?? def.friction ?? 0.7)
        .setRestitution(c.restitution ?? def.restitution ?? 0.15)
        .setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold((def.mass / total) * 120);
      desc.setMass(c.mass ?? def.mass / total);
      if (def.restitutionMax) desc.setRestitutionCombineRule(R.CoefficientCombineRule.Max);
      const col = game.physics.world.createCollider(desc, body);
      game.physics.register(col, this, 0);
      this.colliders.push(col);
    }
    this.health = def.health ?? Infinity;
    this.maxHealth = this.health;
    this.age = 0;
    this.prevVel = new THREE.Vector3();
    this.fuse = -1;
    this.lifetime = opts.lifetime ?? def.lifetime ?? Infinity;
    this.sync();
    def.onSpawn?.(this, opts);
  }

  sync() {
    const t = this.body.translation();
    const r = this.body.rotation();
    this.mesh.position.set(t.x, t.y, t.z);
    this.mesh.quaternion.set(r.x, r.y, r.z, r.w);
  }

  prePhysics(dt) {
    const v = this.body.linvel();
    this.prevVel.set(v.x, v.y, v.z);
    this.def.prePhysics?.(this, dt);
  }

  update(dt, realDt) {
    if (this.removed) return;
    this.age += dt;
    this.sync();
    if (this.fuse > 0) {
      this.fuse -= dt;
      this.def.onFuseTick?.(this, dt);
      if (this.fuse <= 0) this.detonate();
    }
    if (this.age > this.lifetime) {
      // fade out spent debris
      this.game.remove(this);
      return;
    }
    this.def.update?.(this, dt, realDt);
  }

  impulse(imp, point) {
    this.body.applyImpulseAtPoint({ x: imp.x, y: imp.y, z: imp.z }, { x: point.x, y: point.y, z: point.z }, true);
  }

  onImpact(part, impulse, other) {
    if (this.removed) return;
    const v = this.body.linvel();
    const dv = Math.hypot(v.x - this.prevVel.x, v.y - this.prevVel.y, v.z - this.prevVel.z);
    if (dv > 1.2 && this.age > 0.25) {
      const t = this.body.translation();
      this.game.audio?.impact(this.material, Math.min(1, dv / 9) * (this.def.loud ?? 1), t);
    }
    if (this.def.fragile && dv > this.def.fragile && this.age > 0.3) {
      this.damage({ amount: (dv - this.def.fragile) * 25 + 10, kind: 'blunt' });
    }
    if (this.def.impactTrigger && dv > this.def.impactTrigger && this.age > 0.5) this.detonate();
    this.def.onImpact?.(this, dv, other);
  }

  damage(info) {
    if (this.removed || !isFinite(this.health)) {
      this.def.onDamage?.(this, info);
      return;
    }
    this.health -= info.amount;
    this.def.onDamage?.(this, info);
    if (this.health <= 0) {
      if (this.def.explosive) {
        // brief delay makes chain reactions look natural
        if (this.fuse < 0 || this.fuse > 0.25) this.fuse = info.kind === 'explosion' ? 0.05 + Math.random() * 0.15 : 0.12;
      } else this.breakApart();
    }
  }

  /** Arm or trigger the prop's action (explosives start their fuse). */
  activate() {
    if (this.def.onActivate) return this.def.onActivate(this);
    if (this.def.explosive && this.fuse < 0) {
      this.fuse = this.def.fuseTime ?? 3;
      return true;
    }
    return false;
  }

  detonate() {
    if (this.removed) return;
    const t = this.body.translation();
    const p = new THREE.Vector3(t.x, t.y, t.z);
    this.game.remove(this);
    this.game.explode(p, this.def.explosive || 1, this);
  }

  breakApart() {
    if (this.removed) return;
    const t = this.body.translation();
    const p = new THREE.Vector3(t.x, t.y, t.z);
    this.def.onBreak?.(this, p);
    this.game.remove(this);
  }

  setFrozen(frozen) {
    this.frozen = frozen;
    this.body.setBodyType(frozen ? R.RigidBodyType.Fixed : R.RigidBodyType.Dynamic, true);
  }

  position(out) {
    const t = this.body.translation();
    return out.set(t.x, t.y, t.z);
  }

  destroy() {
    if (this.removed) return;
    super.destroy();
    this.game.physics.removeBody(this.body);
    this.game.scene.remove(this.mesh);
    this.def.onDestroy?.(this);
  }
}

export function quatFromYaw(yaw) {
  return _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw).clone();
}
