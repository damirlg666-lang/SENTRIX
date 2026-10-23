// Kamikaze drone: a quadcopter with a charge strapped underneath. Activated, it takes off,
// picks the nearest living person, leads them as they run, dives in and blows up.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { R } from '../engine/physics.js';
import { merge } from '../util/geo.js';

const mats = {};
const M = {
  shell: () => new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.45, metalness: 0.3 }),
  carbon: () => new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.35, metalness: 0.5 }),
  motor: () => new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.3, metalness: 0.9 }),
  prop: () => new THREE.MeshStandardMaterial({ color: 0x1d1f22, roughness: 0.5, transparent: true, opacity: 0.85 }),
  charge: () => new THREE.MeshStandardMaterial({ color: 0xb8231b, roughness: 0.7 }),
  tape: () => new THREE.MeshStandardMaterial({ color: 0x111113, roughness: 0.5 }),
  lens: () => new THREE.MeshPhysicalMaterial({ color: 0x0a0d14, roughness: 0.05, clearcoat: 1, metalness: 0.2 }),
};
const mat = (k) => (mats[k] ??= M[k]());

const ARM = 0.155; // centre to motor

/** Nose (camera) toward -Z, rotors on top. */
export function droneModel() {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new RoundedBoxGeometry(0.12, 0.05, 0.19, 3, 0.02), mat('shell')));
  const arms = [];
  for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const a = new RoundedBoxGeometry(0.2, 0.014, 0.022, 1, 0.006);
    a.rotateY(Math.atan2(-z, x));
    a.translate((x * ARM) / 2, 0.005, (z * ARM) / 2);
    arms.push(a);
  }
  // landing skids
  for (const x of [-0.05, 0.05]) arms.push(new THREE.BoxGeometry(0.008, 0.008, 0.16).translate(x, -0.085, 0), new THREE.BoxGeometry(0.006, 0.06, 0.006).translate(x, -0.055, 0.05), new THREE.BoxGeometry(0.006, 0.06, 0.006).translate(x, -0.055, -0.05));
  g.add(new THREE.Mesh(merge(arms), mat('carbon')));
  const motors = [];
  const rotors = [];
  for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    motors.push(new THREE.CylinderGeometry(0.02, 0.022, 0.032, 14).translate(x * ARM, 0.02, z * ARM));
    const rotor = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.003, 0.018), mat('prop'));
    rotor.position.set(x * ARM, 0.04, z * ARM);
    rotor.userData.noShadow = true;
    g.add(rotor);
    rotors.push(rotor);
  }
  g.add(new THREE.Mesh(merge(motors), mat('motor')));
  // the charge strapped underneath, with a wire up into the body
  g.add(new THREE.Mesh(new RoundedBoxGeometry(0.09, 0.045, 0.11, 2, 0.008).translate(0, -0.045, 0), mat('charge')));
  g.add(new THREE.Mesh(merge([new THREE.BoxGeometry(0.094, 0.012, 0.02).translate(0, -0.045, 0.03), new THREE.BoxGeometry(0.094, 0.012, 0.02).translate(0, -0.045, -0.03)]), mat('tape')));
  const cam = new THREE.Mesh(new THREE.SphereGeometry(0.022, 14, 10), mat('lens'));
  cam.position.set(0, -0.01, -0.1);
  g.add(cam);
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 6), new THREE.MeshBasicMaterial({ color: 0x330000, toneMapped: false }));
  led.position.set(0, 0.03, 0.09);
  led.userData.noShadow = true;
  g.add(led);
  g.userData.rotors = rotors;
  g.userData.led = led;
  return g;
}

const SPEED = 15;
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();

function findTarget(prop, pos) {
  let best = null;
  let bd = 150;
  for (const e of prop.game.entities) {
    if (e.kind !== 'person' || e.removed || !e.alive || !e.attached?.[2]) continue;
    const c = e.bodies[2].translation();
    const d = Math.hypot(c.x - pos.x, c.y - pos.y, c.z - pos.z);
    if (d < bd) {
      bd = d;
      best = e;
    }
  }
  return best;
}

export const DRONE = {
  id: 'drone', name: 'Kamikaze drone', material: 'metal', mass: 2.2, size: 0.18, bottom: 0.09, ccd: true, health: 15, explosive: 1.6, loud: 0.8,
  linearDamping: 0.1, angularDamping: 2,
  build: () => ({
    mesh: droneModel(),
    colliders: [{ desc: R.ColliderDesc.cuboid(0.17, 0.035, 0.17).setTranslation(0, 0.01, 0) }, { desc: R.ColliderDesc.cuboid(0.055, 0.04, 0.08).setTranslation(0, -0.05, 0) }],
  }),
  onActivate: (prop) => {
    if (prop.launched) return false;
    prop.launched = true;
    prop.flight = 0;
    prop.scanT = 0;
    prop.hoverY = prop.body.translation().y + 2.5;
    prop.body.wakeUp();
    return true;
  },
  activateText: () => 'Drone launched',
  statusText: (prop) => (!prop.launched ? 'Press G to launch' : prop.target && !prop.target.removed && prop.target.alive ? `Hunting ${prop.target.name}` : 'Searching…'),
  prePhysics: (prop, dt) => {
    if (!prop.launched || prop.removed) return;
    const b = prop.body;
    const m = b.mass();
    const t = b.translation();
    const v = b.linvel();
    const pos = new THREE.Vector3(t.x, t.y, t.z);
    prop.flight += dt;
    prop.scanT -= dt;
    if (prop.scanT <= 0) {
      prop.scanT = 0.4;
      if (!prop.target || prop.target.removed || !prop.target.alive) prop.target = findTarget(prop, pos);
    }
    const desired = new THREE.Vector3();
    const tg = prop.target;
    if (tg && !tg.removed && tg.alive && prop.flight > 0.6) {
      const cb = tg.bodies[2];
      const c = cb.translation();
      const cv = cb.linvel();
      const aim = new THREE.Vector3(c.x, c.y, c.z);
      const dist = aim.distanceTo(pos);
      if (dist < 0.6) {
        prop.detonate();
        return;
      }
      // lead a moving target, keep some height until close, then dive
      aim.addScaledVector(new THREE.Vector3(cv.x, cv.y, cv.z), Math.min(1, dist / SPEED) * 0.8);
      const to = aim.sub(pos);
      if (dist > 7) {
        desired.copy(to).setLength(SPEED);
        desired.y += Math.max(0, c.y + 2 - pos.y) * 1.5;
      } else desired.copy(to).setLength(SPEED * 1.15);
    } else {
      desired.set(Math.sin(prop.flight * 0.7) * 0.6, (prop.hoverY - pos.y) * 2, Math.cos(prop.flight * 0.5) * 0.6);
    }
    const acc = desired.sub(new THREE.Vector3(v.x, v.y, v.z)).multiplyScalar(4);
    if (acc.length() > 26) acc.setLength(26);
    const thrust = acc.clone();
    thrust.y += 9.81 * (prop.game.physics.gravityScale ?? 1);
    b.applyImpulse({ x: thrust.x * m * dt, y: thrust.y * m * dt, z: thrust.z * m * dt }, true);
    prop.load = thrust.length() / 9.81;
    // attitude: rotors tilt toward the thrust, nose toward where it is heading
    const up = thrust.normalize();
    const head = new THREE.Vector3(v.x, 0, v.z);
    if (head.lengthSq() < 0.25) head.set(Math.sin(prop.flight * 0.3), 0, Math.cos(prop.flight * 0.3));
    const back = head.normalize().negate();
    back.addScaledVector(up, -back.dot(up)).normalize();
    const right = new THREE.Vector3().crossVectors(up, back);
    _m.makeBasis(right, up, back);
    const target = new THREE.Quaternion().setFromRotationMatrix(_m);
    const r = b.rotation();
    _q.set(r.x, r.y, r.z, r.w).slerp(target, 0.15);
    b.setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w }, true);
    b.setAngvel({ x: 0, y: 0, z: 0 }, true);
  },
  update: (prop, dt) => {
    const { rotors, led } = prop.mesh.userData;
    const spin = prop.launched ? 70 : 0;
    rotors.forEach((r, i) => (r.rotation.y += spin * dt * (i % 2 ? 1 : -1)));
    led.material.color.setHex(prop.launched && Math.sin(prop.age * 12) > 0 ? 0xff2020 : 0x330000);
    if (!prop.launched || dt <= 0) return;
    const t = prop.body.translation();
    if (!prop.sound && prop.game.audio) prop.sound = prop.game.audio.loop('drone', t);
    prop.sound?.setPos(t);
    prop.sound?.setPitch(0.8 + Math.min(1.6, prop.load ?? 1) * 0.35);
  },
  onImpact: (prop, dv) => {
    if (prop.launched && prop.flight > 0.8 && dv > 2.5) prop.detonate();
  },
  onDestroy: (prop) => {
    prop.sound?.stop();
    prop.mesh.userData.led.material.dispose();
  },
};
