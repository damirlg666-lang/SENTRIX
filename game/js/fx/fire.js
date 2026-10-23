// Fire: anything flammable can catch, burns for a while (hurting, charring and eventually
// breaking it) and heats up whatever is close enough to catch as well.
import * as THREE from 'three';
import { BONE_COUNT } from '../characters/skeleton.js';
import { paintDamage } from '../characters/humanModel.js';

const MATERIAL_FLAMMABILITY = { wood: 1, cloth: 1.3, rubber: 0.6, flesh: 0.25 };

export function flammability(e) {
  if (e.kind === 'person') return e.dummy ? 0.6 : 1;
  if (e.kind === 'vehicle') return 0.5;
  if (e.kind !== 'prop') return 0;
  if (e.def.flammable !== undefined) return e.def.flammable;
  if (e.def.explosive) return 0.8; // heats up and goes off
  return MATERIAL_FLAMMABILITY[e.material] ?? 0;
}

const _c = new THREE.Vector3();
const _w = new THREE.Vector3();

/** Rough size of an entity, for how big its flames are and how far heat reaches. */
function fireRadius(e) {
  if (e.kind === 'person') return 0.3;
  if (e.kind === 'vehicle') return 1.4;
  const box = new THREE.Box3().setFromObject(e.mesh);
  return THREE.MathUtils.clamp(box.getSize(_w).length() * 0.4, 0.08, 1.2);
}

function center(e, out) {
  return e.position(out);
}

export class FireSystem {
  constructor(game) {
    this.game = game;
    this.burning = new Set();
    this.spreadTimer = 0;
    this.light = game.gfx.fireLight;
    this.sound = null;
  }

  /** Set something alight. Returns true if it caught. */
  ignite(e, strength = 1) {
    if (!e || e.removed) return false;
    const f = flammability(e);
    if (f <= 0) return false;
    if (e.onFire) return false;
    // everything has a fixed amount to burn; once it is used up the thing cannot catch again
    if (e.fuelLeft === undefined) {
      if (e.kind === 'person') e.fuelLeft = 13 + Math.random() * 7;
      else if (e.kind === 'vehicle') e.fuelLeft = 40;
      else e.fuelLeft = (e.def.fuel ?? 22 * f) * (0.8 + Math.random() * 0.4);
    }
    if (e.fuelLeft < 1) return false;
    e.onFire = { fuel: Math.min(e.fuelLeft, 6 + 14 * strength), t: 0, emit: 0, tick: 0, radius: fireRadius(e) };
    this.burning.add(e);
    if (e.kind === 'person' && e.conscious && !e.dummy) {
      e.voiceCooldown = 0.3;
      this.game.audio?.voice(e, 1);
    }
    return true;
  }

  /** Add heat; past a threshold the thing catches. */
  heat(e, amount) {
    if (e.onFire || e.removed) return;
    const f = flammability(e);
    if (f <= 0) return;
    // heat leaks away again when the source goes
    const now = this.game.simTime;
    e.heatLevel = (e.heatLevel ?? 0) * Math.exp(-(now - (e.heatAt ?? now)) / 3) + amount * f;
    e.heatAt = now;
    if (e.heatLevel >= 1) this.ignite(e);
  }

  extinguish(e) {
    if (!e.onFire) return;
    e.onFire = null;
    e.heatLevel = 0;
    this.burning.delete(e);
    if (!e.removed) this.game.fx?.smoke(center(e, _c), 4, { size: 0.3, gray: 0.5, alpha: 0.4, life: 1 });
  }

  /** Explosions set nearby flammable things alight. */
  igniteNear(p, radius, chance = 0.6) {
    for (const e of this.game.entities) {
      if (e.removed || flammability(e) <= 0) continue;
      if (center(e, _c).distanceTo(p) < radius && Math.random() < chance) this.ignite(e);
    }
  }

  clear() {
    for (const e of this.burning) e.onFire = null;
    this.burning.clear();
    this.sound?.stop();
    this.sound = null;
  }

  /** A random point on the burning thing where a flame starts. */
  emitPoint(e, out) {
    if (e.kind === 'person') {
      const t = e.bodies[Math.floor(Math.random() * BONE_COUNT)].translation();
      return out.set(t.x + (Math.random() - 0.5) * 0.12, t.y + (Math.random() - 0.3) * 0.12, t.z + (Math.random() - 0.5) * 0.12);
    }
    const r = e.onFire.radius;
    center(e, out);
    return out.set(out.x + (Math.random() - 0.5) * r * 1.2, out.y + (Math.random() - 0.2) * r * 0.8, out.z + (Math.random() - 0.5) * r * 1.2);
  }

  update(dt) {
    if (dt <= 0) return;
    for (const e of [...this.burning]) {
      if (e.removed || !e.onFire) {
        this.burning.delete(e);
        continue;
      }
      const f = e.onFire;
      f.t += dt;
      f.fuel -= dt;
      e.fuelLeft -= dt;
      this.burnEffects(e, f, dt);
      this.burnDamage(e, f, dt);
      if (f.fuel <= 0 && e.onFire) this.extinguish(e);
    }
    this.spreadTimer -= dt;
    if (this.spreadTimer <= 0 && this.burning.size) {
      this.spreadTimer = 0.25;
      this.spread(0.25);
    }
    this.updateAmbience();
  }

  burnEffects(e, f, dt) {
    const fx = this.game.fx;
    if (!fx) return;
    const r = f.radius;
    // flames die down as the fuel runs out
    const k = Math.min(1, f.fuel / 4, 0.4 + f.t * 0.6);
    f.emit += dt * (e.kind === 'person' ? 46 : 14 + 26 * r) * k;
    while (f.emit >= 1) {
      f.emit -= 1;
      fx.fire(this.emitPoint(e, _c), 1, (e.kind === 'person' ? 0.42 : 0.28 + r * 0.55) * (0.6 + 0.4 * k));
    }
    f.smoke = (f.smoke ?? 0) + dt * (2 + r * 4) * k;
    if (f.smoke >= 1) {
      f.smoke = 0;
      const black = e.material === 'rubber' || e.kind === 'vehicle';
      fx.smoke(this.emitPoint(e, _c).add(_w.set(0, 0.3 + r * 0.5, 0)), 1, { size: 0.25 + r * 0.4, gray: black ? 0.08 : 0.3, alpha: black ? 0.7 : 0.45, speed: 0.7 });
    }
  }

  burnDamage(e, f, dt) {
    f.tick += dt;
    if (e.kind === 'person') {
      if (e.alive) {
        e.health -= dt * (e.dummy ? 3 : 5.5);
        e.pain = 1;
        e.fear = 2;
        // run about blindly
        if (Math.random() < dt * 1.5) {
          const t = e.bodies[2].translation();
          e.fearFrom.set(t.x + (Math.random() - 0.5) * 6, t.y, t.z + (Math.random() - 0.5) * 6);
        }
        if (e.health < 30) e.stun += dt * 1.2;
        if (e.conscious && !e.dummy && e.voiceCooldown <= 0) {
          e.voiceCooldown = 0.5 + Math.random() * 0.7;
          this.game.audio?.voice(e, 1);
        }
        if (e.health <= 0) e.die('fire');
      }
      if (f.tick > 0.18 && e.ch) {
        f.tick = 0;
        const part = Math.floor(Math.random() * BONE_COUNT);
        const t = e.bodies[part].translation();
        paintDamage(e.ch, part, _c.set(t.x, t.y, t.z), 0.14, 0.14, 1);
      }
      return;
    }
    if (e.kind === 'vehicle') {
      e.damage({ amount: 12 * dt, kind: 'fire' });
      return;
    }
    if (e.def.explosive) {
      if (f.t > 2.5) {
        if (e.def.fuseTime && e.fuse < 0) e.activate();
        else if (!e.def.fuseTime) e.detonate();
      }
      return;
    }
    if (isFinite(e.health)) e.damage({ amount: 5 * dt, kind: 'fire' });
    if (f.tick > 0.3) {
      f.tick = 0;
      this.char(e, Math.min(1, f.t / 18));
    }
  }

  /** Darken a burning prop (its materials are shared, so it gets its own copies first). */
  char(e, k) {
    if (!e.charMats) {
      e.charMats = [];
      e.mesh.traverse((o) => {
        if (!o.isMesh || !o.material?.color) return;
        o.material = o.material.clone();
        o.material.userData.base = o.material.color.clone();
        e.charMats.push(o.material);
      });
    }
    for (const m of e.charMats) m.color.copy(m.userData.base).multiplyScalar(1 - 0.85 * k);
  }

  spread(step) {
    const burning = [...this.burning];
    const reach = 0.6;
    for (const e of this.game.entities) {
      if (e.onFire || e.removed || flammability(e) <= 0) continue;
      let best = Infinity;
      for (const b of burning) {
        center(b, _c);
        let d;
        if (e.kind === 'person') {
          d = Infinity;
          for (const body of e.bodies) {
            const t = body.translation();
            d = Math.min(d, Math.hypot(t.x - _c.x, t.y - _c.y, t.z - _c.z));
          }
        } else d = center(e, _w).distanceTo(_c) - fireRadius(e) * 0.5;
        d -= b.onFire.radius;
        best = Math.min(best, d);
      }
      if (best < reach) this.heat(e, step * 0.9 * (1 - Math.max(0, best) / reach));
    }
  }

  /** One flickering light and one crackling loop at the fire nearest the camera. */
  updateAmbience() {
    const cam = this.game.camera.position;
    let near = null;
    let nd = Infinity;
    for (const e of this.burning) {
      const d = center(e, _c).distanceTo(cam);
      if (d < nd) {
        nd = d;
        near = e;
      }
    }
    const light = this.light;
    if (!near) {
      if (light) light.intensity = 0;
      if (this.sound) {
        this.sound.stop();
        this.sound = null;
      }
      return;
    }
    center(near, _c);
    _c.y += 0.5;
    if (light) {
      light.position.copy(_c);
      const k = Math.min(1, near.onFire.fuel / 4);
      light.intensity = (5 + Math.random() * 3) * k * Math.min(2, 0.6 + near.onFire.radius * 2);
    }
    if (!this.sound) this.sound = this.game.audio?.loop('flame', _c) ?? null;
    this.sound?.setPos(_c);
  }
}
