// Game orchestration: owns subsystems, entities and the fixed-step simulation loop.
import * as THREE from 'three';
import { Physics } from './engine/physics.js';
import { CameraController } from './engine/camera.js';
import { WorldMap, groundHeight } from './world/map.js';
import { Person, ST } from './entities/person.js';
import { Prop } from './entities/prop.js';
import { BODY_TYPES } from './characters/skeleton.js';
import { blastTrauma } from './entities/injury.js';
import { FireSystem } from './fx/fire.js';

const _v = new THREE.Vector3();
const _d = new THREE.Vector3();

class Emitter {
  constructor() {
    this.map = new Map();
  }
  on(name, fn) {
    if (!this.map.has(name)) this.map.set(name, []);
    this.map.get(name).push(fn);
  }
  emit(name, ...args) {
    const l = this.map.get(name);
    if (l) for (const fn of l) fn(...args);
  }
}

const SETTINGS_KEY = 'ragdoll-sandbox-settings';

function defaultQuality() {
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && Math.min(window.screen.width, window.screen.height) < 820);
  if (mobile) return 'low';
  return (navigator.hardwareConcurrency || 4) <= 4 ? 'medium' : 'high';
}

export class Game {
  constructor(gfx) {
    this.gfx = gfx;
    this.scene = gfx.scene;
    this.camera = gfx.camera;
    this.physics = new Physics();
    this.events = new Emitter();
    this.entities = [];
    this.spawnHistory = [];
    this.timeScale = 1;
    this.slowmo = false;
    this.paused = false;
    this.simTime = 0;
    this.settings = {
      quality: 'high',
      time: 'day',
      gravity: 1,
      slowScale: 0.25,
      volume: 0.7,
      blood: true,
      ai: true,
      fps: false,
    };
    this.loadSettings();
    if (!this.hasSavedSettings) this.settings.quality = defaultQuality();
    this.audio = null;
    this.fx = null;
    this.ui = null;
    this.tools = null;
    this.ready = false;
    this.clock = new THREE.Clock();
    this.classes = { Prop };

    this.physics.impactListeners.push((h1, h2, impulse, force) => this.onImpact(h1, h2, impulse, force));
  }

  loadSettings() {
    try {
      const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
      this.hasSavedSettings = !!s.quality;
      Object.assign(this.settings, s);
    } catch {
      /* storage unavailable */
    }
  }

  saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    } catch {
      /* storage unavailable */
    }
  }

  buildWorld(progress) {
    this.map = new WorldMap(this.gfx, this.physics);
    this.map.build(progress);
    this.cam = new CameraController(this.camera, groundHeight);
    // frame the starter scene, leaving room for the spawn menu on the left
    this.cam.goalPivot.set(-3.2, 0.8, 1.2);
    this.cam.pivot.copy(this.cam.goalPivot);
    this.cam.goalYaw = this.cam.yaw = 0.42;
    this.cam.goalPitch = this.cam.pitch = 0.3;
    this.cam.goalDist = this.cam.dist = 15;
    this.physics.setGravity(this.settings.gravity);
    this.fire = new FireSystem(this);
  }

  // ------------------------------------------------------------------ entities
  add(entity, record = true) {
    this.entities.push(entity);
    if (record) this.spawnHistory.push(entity);
    this.events.emit('spawn', entity);
    return entity;
  }

  remove(entity) {
    if (!entity || entity.removed) return;
    entity.destroy();
    const i = this.entities.indexOf(entity);
    if (i >= 0) this.entities.splice(i, 1);
    const h = this.spawnHistory.indexOf(entity);
    if (h >= 0) this.spawnHistory.splice(h, 1);
    this.events.emit('remove', entity);
  }

  undo() {
    while (this.spawnHistory.length) {
      const e = this.spawnHistory.pop();
      if (!e.removed) {
        this.remove(e);
        return true;
      }
    }
    return false;
  }

  clearAll() {
    for (const e of [...this.entities]) this.remove(e);
    this.spawnHistory.length = 0;
    this.fx?.clearDecals();
    this.fire?.clear();
    this.tools?.reset();
  }

  spawnPerson(position, yaw = Math.random() * Math.PI * 2, opts = {}) {
    let type = opts.type;
    if (!type || type === 'random') {
      const types = Object.keys(BODY_TYPES);
      const w = [0.36, 0.36, 0.14, 0.14];
      let r = Math.random();
      type = types[types.length - 1];
      for (let i = 0; i < types.length; i++) {
        if ((r -= w[i]) <= 0) {
          type = types[i];
          break;
        }
      }
    }
    const p = new Person(this, { ...opts, type, position, yaw, quality: this.modelQuality });
    return this.add(p, opts.record !== false);
  }

  people() {
    return this.entities.filter((e) => e.kind === 'person');
  }

  // ------------------------------------------------------------------ physics events
  onImpact(h1, h2, impulse, force) {
    const o1 = this.physics.ownerOf(h1);
    const o2 = this.physics.ownerOf(h2);
    const e1 = o1?.entity;
    const e2 = o2?.entity;
    if (e1?.onImpact) e1.onImpact(o1.part, impulse, e2, o2);
    if (e2?.onImpact) e2.onImpact(o2.part, impulse, e1, o1);
  }

  /** Explosion: radial impulses with falloff, damage, chain reactions and effects. */
  explode(p, power = 1, source = null) {
    const s = Math.sqrt(power);
    const radius = 6 * s;
    this.fx?.explosion(p, power);
    this.gfx.flash(_v.copy(p).add(new THREE.Vector3(0, 0.8, 0)), 0xffa24a, 160 * power, 0.45, 30 * s);
    this.audio?.explosion(p, power);
    const camD = this.camera.position.distanceTo(p);
    this.cam.shake(Math.min(1.2, (1.4 * power) / (1 + camD / 7)));
    this.noise(p, 8 * power);
    this.fire?.igniteNear(p, radius * 0.35, 0.65);
    for (const e of [...this.entities]) {
      if (e === source || e.removed) continue;
      if (e.kind === 'person') {
        let minD = Infinity;
        let near = 0;
        e.bodies.forEach((b, i) => {
          const t = b.translation();
          _d.set(t.x - p.x, t.y - p.y, t.z - p.z);
          const dist = _d.length();
          if (dist < minD && e.attached[i]) {
            minD = dist;
            near = i;
          }
          if (dist < radius) {
            const f = Math.pow(1 - dist / radius, 1.5);
            _d.normalize();
            _d.y += 0.35;
            _d.normalize();
            const dv = 15 * power * f;
            const m = e.ragdoll.masses[i];
            b.applyImpulse({ x: _d.x * dv * m, y: _d.y * dv * m, z: _d.z * dv * m }, true);
          }
        });
        if (minD < radius) {
          const f = 1 - minD / radius;
          const t = e.bodies[near].translation();
          e.damage({ amount: 130 * power * f * f, part: near, point: new THREE.Vector3(t.x, t.y, t.z), kind: 'explosion' });
          e.stun += 2 * f;
          blastTrauma(e, p, power, radius);
        }
      } else {
        let hitAny = false;
        let minD = Infinity;
        for (const b of e.bodies) {
          if (!b.isDynamic()) continue;
          const t = b.translation();
          _d.set(t.x - p.x, t.y - p.y, t.z - p.z);
          const dist = _d.length();
          minD = Math.min(minD, dist);
          if (dist >= radius) continue;
          hitAny = true;
          const f = Math.pow(1 - dist / radius, 1.5);
          _d.normalize();
          _d.y += 0.3;
          _d.normalize();
          const m = b.mass();
          const dv = (14 * power * f) / (1 + m / 300);
          const off = 0.15;
          b.applyImpulseAtPoint(
            { x: _d.x * dv * m, y: _d.y * dv * m, z: _d.z * dv * m },
            { x: t.x + (Math.random() - 0.5) * off, y: t.y + (Math.random() - 0.5) * off, z: t.z + (Math.random() - 0.5) * off },
            true
          );
        }
        if (hitAny) e.damage({ amount: 200 * power * (1 - minD / radius), kind: 'explosion', point: p.clone() });
      }
    }
  }

  /** Let every conscious person react to a loud noise. */
  noise(point, loudness) {
    for (const e of this.entities) if (e.hear) e.hear(point, loudness);
  }

  // ------------------------------------------------------------------ loop
  setSlowmo(on) {
    this.slowmo = on;
    this.timeScale = on ? this.settings.slowScale : 1;
    this.audio?.setRate(on ? 0.6 : 1);
  }

  step(frameDt) {
    const dt = Math.min(frameDt, 1 / 20);
    if (!this.paused) {
      const simDt = dt * this.timeScale;
      const maxStep = 1 / 60;
      const n = Math.max(1, Math.ceil(simDt / maxStep - 1e-6));
      const h = simDt / n;
      for (let i = 0; i < n; i++) {
        this.tools?.prePhysics(h);
        for (const e of this.entities) e.prePhysics(h);
        this.physics.step(h);
        this.simTime += h;
      }
      this.fire?.update(simDt);
      // remove things that fell out of the world
      for (const e of [...this.entities]) {
        const b = e.bodies[0];
        if (b && b.isValid?.() !== false && b.translation().y < -60) this.remove(e);
      }
    }
    const visDt = this.paused ? 0 : dt * this.timeScale;
    for (const e of this.entities) e.update(visDt, dt);
    this.fx?.update(visDt, dt);
    this.tools?.update(dt);
    this.cam.update(dt);
    this.gfx.updateShadowFocus(this.cam.pivot);
    this.map.update(dt, this.camera);
    this.gfx.update(dt);
    this.ui?.update(dt);
  }

  stats() {
    let alive = 0;
    let down = 0;
    let objects = 0;
    for (const e of this.entities) {
      if (e.kind === 'person') {
        if (e.state === ST.DEAD) down++;
        else alive++;
      } else if (e.kind !== 'group') objects++;
    }
    return { alive, down, objects };
  }
}
