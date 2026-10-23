// Spawnable rockets: a missile that flies off when activated and explodes on impact (and
// drags along whatever it is stuck to), and a firework that shoots up and bursts.
import * as THREE from 'three';
import { R } from '../engine/physics.js';
import { merge } from '../util/geo.js';

const mats = {};
const M = {
  white: () => new THREE.MeshStandardMaterial({ color: 0xe9ebee, roughness: 0.38, metalness: 0.25 }),
  red: () => new THREE.MeshStandardMaterial({ color: 0xc8231c, roughness: 0.4, metalness: 0.2 }),
  dark: () => new THREE.MeshStandardMaterial({ color: 0x26282c, roughness: 0.45, metalness: 0.8, side: THREE.DoubleSide }),
  paperA: () => new THREE.MeshStandardMaterial({ color: 0x2a5bd7, roughness: 0.75 }),
  paperB: () => new THREE.MeshStandardMaterial({ color: 0xf0c419, roughness: 0.75 }),
  stick: () => new THREE.MeshStandardMaterial({ color: 0xb48a5a, roughness: 0.85 }),
};
const mat = (k) => (mats[k] ??= M[k]());
const V2 = (x, y) => new THREE.Vector2(x, y);
const toZ = (g) => g.rotateX(Math.PI / 2); // lathe/cylinder axis +Y -> +Z

/** Nose toward -Z, nozzle at +Z. */
export function missileModel() {
  const g = new THREE.Group();
  const nose = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    nose.push(V2(Math.max(0.001, 0.062 * Math.sqrt(1 - (1 - t) * (1 - t))), -0.62 + t * 0.27));
  }
  const body = toZ(new THREE.LatheGeometry([...nose, V2(0.062, 0.42), V2(0.055, 0.45), V2(0.001, 0.45)], 32));
  g.add(new THREE.Mesh(body, mat('white')));
  const bands = [-0.33, 0.05, 0.36].map((z) => toZ(new THREE.CylinderGeometry(0.0625, 0.0625, 0.035, 32)).translate(0, 0, z));
  g.add(new THREE.Mesh(merge(bands), mat('red')));
  // swept tail fins
  const fin = new THREE.Shape();
  fin.moveTo(0, 0);
  fin.lineTo(0.09, 0.05);
  fin.lineTo(0.09, 0.13);
  fin.lineTo(0, 0.17);
  const fins = [];
  for (let k = 0; k < 4; k++) {
    const f = new THREE.ExtrudeGeometry(fin, { depth: 0.006, bevelEnabled: false });
    f.translate(0.055, 0, -0.003);
    f.rotateX(Math.PI / 2);
    f.translate(0, 0, 0.26);
    f.rotateZ((k * Math.PI) / 2 + Math.PI / 4);
    fins.push(f);
  }
  g.add(new THREE.Mesh(merge(fins), mat('red')));
  g.add(new THREE.Mesh(toZ(new THREE.LatheGeometry([V2(0.034, 0.44), V2(0.042, 0.47), V2(0.05, 0.51)], 24)), mat('dark')));
  const glow = new THREE.Mesh(new THREE.CircleGeometry(0.033, 20), new THREE.MeshBasicMaterial({ color: 0x331a0a, toneMapped: false }));
  glow.position.z = 0.445;
  glow.userData.noShadow = true;
  g.add(glow);
  g.userData.glow = glow;
  return g;
}

/** Bottle rocket: paper tube, cone and a long balancing stick; nose toward -Z. */
export function fireworkModel() {
  const g = new THREE.Group();
  const tube = toZ(new THREE.CylinderGeometry(0.026, 0.026, 0.16, 18)).translate(0, 0, -0.02);
  g.add(new THREE.Mesh(tube, mat('paperA')));
  const band = toZ(new THREE.CylinderGeometry(0.0265, 0.0265, 0.04, 18)).translate(0, 0, -0.03);
  g.add(new THREE.Mesh(band, mat('paperB')));
  g.add(new THREE.Mesh(toZ(new THREE.ConeGeometry(0.03, 0.07, 18)).rotateX(Math.PI).translate(0, 0, -0.135), mat('red')));
  g.add(new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.008, 0.5).translate(0, -0.03, 0.27), mat('stick')));
  return g;
}

const _q = new THREE.Quaternion();
const _d = new THREE.Vector3();
const _p = new THREE.Vector3();
const rotX90 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
const capsuleZ = (half, r, z = 0) => R.ColliderDesc.capsule(half, r).setRotation({ x: rotX90.x, y: rotX90.y, z: rotX90.z, w: rotX90.w }).setTranslation(0, 0, z);

function exhaust(prop, back, size, dt) {
  const r = prop.body.rotation();
  _q.set(r.x, r.y, r.z, r.w);
  const d = _d.set(0, 0, 1).applyQuaternion(_q);
  const t = prop.body.translation();
  const exit = _p.set(t.x, t.y, t.z).addScaledVector(d, back);
  const v = prop.body.linvel();
  const fx = prop.game.fx;
  for (let i = 0; i < 3; i++) {
    const s = 4 + Math.random() * 4;
    fx?.additive.add({
      x: exit.x, y: exit.y, z: exit.z,
      vx: d.x * s + v.x * 0.6 + (Math.random() - 0.5), vy: d.y * s + v.y * 0.6 + (Math.random() - 0.5), vz: d.z * s + v.z * 0.6 + (Math.random() - 0.5),
      drag: 4, life: 0.12 + Math.random() * 0.12, size0: size, size1: size * 2.4,
      col0: [1.7, 1.2, 0.6], col1: [0.9, 0.25, 0.04], tile: 4 + Math.floor(Math.random() * 4), a0: 0.85,
    });
  }
  prop.trail = (prop.trail ?? 0) + dt * 30;
  while (prop.trail >= 1) {
    prop.trail -= 1;
    fx?.smoke(exit, 1, { size: size * 1.4, gray: 0.7, alpha: 0.4, speed: 0.25, life: 1.6, spread: 0.2 });
  }
  return exit;
}

/** Keep a free-flying rocket pointing along its velocity, like fins would. */
function weathervane(prop) {
  const v = prop.body.linvel();
  if (Math.hypot(v.x, v.y, v.z) < 4) return;
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), new THREE.Vector3(v.x, v.y, v.z).normalize());
  const r = prop.body.rotation();
  _q.set(r.x, r.y, r.z, r.w).slerp(q, 0.2);
  prop.body.setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w }, true);
}

function burst(prop) {
  if (prop.removed) return;
  const game = prop.game;
  const t = prop.body.translation();
  const p = new THREE.Vector3(t.x, t.y, t.z);
  const hue = Math.random();
  const c = new THREE.Color().setHSL(hue, 1, 0.6);
  const c2 = new THREE.Color().setHSL((hue + 0.15 + Math.random() * 0.4) % 1, 1, 0.6);
  for (let i = 0; i < 140; i++) {
    const d = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(6 + Math.random() * 6);
    const col = i % 3 ? c : c2;
    game.fx?.streaks.add({ x: p.x, y: p.y, z: p.z, vx: d.x, vy: d.y, vz: d.z, grav: 3, life: 1 + Math.random() * 0.8, color: [col.r * 2, col.g * 2, col.b * 2], intensity: 3, len: 0.25 });
  }
  game.fx?.additive.add({ x: p.x, y: p.y, z: p.z, vx: 0, vy: 0, vz: 0, life: 0.25, size0: 4, size1: 6, col0: [c.r, c.g, c.b], tile: 8, a0: 0.8 });
  game.gfx.flash(p, c.getHex(), 120, 0.4, 40);
  game.audio?.firework(p);
  game.noise(p, 3);
  game.remove(prop);
}

export const ROCKETS = {
  missile: {
    id: 'missile', name: 'Missile', material: 'metal', mass: 9, size: 0.13, ccd: true, health: 40, explosive: 2.2,
    linearDamping: 0.05, loud: 1.2,
    stick: { axis: [0, 0, -1], tip: [0, 0, -0.6], depth: 0.02 },
    build: () => ({ mesh: missileModel(), colliders: [{ desc: capsuleZ(0.48, 0.062, -0.08) }] }),
    onActivate: (prop) => {
      if (prop.launched) return false;
      prop.launched = true;
      prop.burn = 0;
      if (!prop.embedded) {
        // tip the nose up a little so it clears the ground
        const r = prop.body.rotation();
        _q.set(r.x, r.y, r.z, r.w);
        const fwd = _d.set(0, 0, -1).applyQuaternion(_q);
        const side = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0));
        if (side.lengthSq() > 1e-6 && fwd.y < 0.2) _q.premultiply(new THREE.Quaternion().setFromAxisAngle(side.normalize(), 0.3));
        prop.body.setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w }, true);
        const t = prop.body.translation();
        prop.body.setTranslation({ x: t.x, y: t.y + 0.12, z: t.z }, true);
      }
      prop.game.audio?.gunshot('rocket', prop.body.translation());
      prop.body.wakeUp();
      return true;
    },
    activateText: () => 'Missile launched',
    prePhysics: (prop, dt) => {
      if (!prop.launched || prop.burn > 3.2) return;
      const r = prop.body.rotation();
      _q.set(r.x, r.y, r.z, r.w);
      const d = _d.set(0, 0, -1).applyQuaternion(_q);
      const e = prop.embedded;
      // strapped to someone it pushes hard; on its own it settles at about 45 m/s
      const v = prop.body.linvel();
      const along = v.x * d.x + v.y * d.y + v.z * d.z;
      const f = (e ? 2600 : Math.max(0, 45 - along) * prop.body.mass() * 3) * dt;
      const target = e ? e.entity.bodies[e.part] : prop.body;
      const t = prop.body.translation();
      target.applyImpulseAtPoint({ x: d.x * f, y: d.y * f, z: d.z * f }, t, true);
      if (e?.entity.kind === 'person') e.entity.tearWatch = Math.max(e.entity.tearWatch, 0.1);
      if (!e) weathervane(prop);
    },
    update: (prop, dt) => {
      const glow = prop.mesh.userData.glow;
      if (!prop.launched || dt <= 0) return;
      prop.burn += dt;
      if (prop.burn < 3.2) {
        glow.material.color.setHex(0xffb060);
        const exit = exhaust(prop, 0.5, 0.12, dt);
        if (!prop.sound && prop.game.audio) prop.sound = prop.game.audio.loop('thruster', exit);
        prop.sound?.setPos(exit);
      } else {
        glow.material.color.setHex(0x331a0a);
        prop.sound?.stop();
        prop.sound = null;
      }
      if (prop.burn > 5) prop.detonate();
    },
    onImpact: (prop, dv, other) => {
      // contacts with whatever it is stuck to are disabled, so anything else it hits counts
      if (prop.launched && prop.burn > 0.25 && dv > 2.5 && other !== prop.embedded?.entity) prop.detonate();
    },
    onDestroy: (prop) => {
      prop.sound?.stop();
      prop.mesh.userData.glow.material.dispose();
    },
  },
  firework: {
    id: 'firework', name: 'Firework', material: 'wood', mass: 0.3, size: 0.06, ccd: true, health: 10, flammable: 1.5, fuel: 1,
    // stands upright on its stick until it is lit
    spawnRot: [Math.PI / 2, 0, 0], bottom: 0.52,
    stick: { axis: [0, 0, -1], tip: [0, 0, -0.17], depth: 0.02 },
    build: () => ({ mesh: fireworkModel(), colliders: [{ desc: capsuleZ(0.07, 0.027, -0.03) }, { desc: R.ColliderDesc.cuboid(0.01, 0.01, 0.25).setTranslation(0, -0.03, 0.27), mass: 0.05 }] }),
    onSpawn: (prop) => {
      if (!prop.embedded) prop.setFrozen(true);
    },
    onActivate: (prop) => {
      if (prop.launched) return false;
      prop.launched = true;
      prop.burn = 0;
      if (prop.frozen) prop.setFrozen(false);
      prop.game.audio?.whoosh(prop.body.translation(), 1);
      return true;
    },
    activateText: () => 'Firework lit',
    prePhysics: (prop, dt) => {
      if (!prop.launched) return;
      const r = prop.body.rotation();
      _q.set(r.x, r.y, r.z, r.w);
      const d = _d.set(0, 0, -1).applyQuaternion(_q);
      const e = prop.embedded;
      if (e) {
        e.entity.bodies[e.part].applyImpulse({ x: d.x * 900 * dt, y: d.y * 900 * dt, z: d.z * 900 * dt }, true);
        return;
      }
      const v = prop.body.linvel();
      const along = v.x * d.x + v.y * d.y + v.z * d.z;
      const f = Math.max(0, 26 - along) * prop.body.mass() * 8 * dt;
      prop.body.applyImpulse({ x: d.x * f, y: d.y * f, z: d.z * f }, true);
      weathervane(prop);
    },
    update: (prop, dt) => {
      if (!prop.launched || dt <= 0) return;
      prop.burn += dt;
      exhaust(prop, 0.1, 0.06, dt);
      if (prop.burn > 1.5) burst(prop);
    },
    onIgnite: (prop) => prop.activate(),
  },
};
