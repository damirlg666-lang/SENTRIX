// Kamikaze drone: a quadcopter with a charge strapped underneath. Activated, it takes off,
// picks the nearest living person, leads them as they run, dives in and blows up. With the
// Control tool the player flies it instead, through its nose camera or from behind.
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
const PILOT_SPEED = 13;
const PILOT_BOOST = 24;
const LENS = new THREE.Vector3(0, -0.01, -0.125);
const Y = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

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

function launch(prop) {
  if (prop.launched) return;
  prop.launched = true;
  prop.flight = 0;
  prop.scanT = 0;
  prop.hoverY = prop.body.translation().y + 2.5;
  prop.body.wakeUp();
}

/** Where the pilot looks: yaw around world up, pitch positive looking up. */
function lookDir(p, out) {
  const cp = Math.cos(p.pitch);
  return out.set(-Math.sin(p.yaw) * cp, Math.sin(p.pitch), -Math.cos(p.yaw) * cp);
}

/** The player takes over the drone. Returns the pilot state the tools write input into. */
export function startPilot(prop, yaw) {
  const wasFlying = prop.launched;
  launch(prop);
  prop.mode = 'pilot';
  prop.target = null;
  prop.pilot = { yaw, pitch: 0, move: new THREE.Vector3(), boost: false, lift: wasFlying ? 0 : 0.7, view: 'fpv', chase: null };
  return prop.pilot;
}

/** The player lets go: it holds its height where it is. */
export function stopPilot(prop) {
  if (!prop.pilot) return;
  prop.pilot = null;
  prop.mode = 'hover';
  if (!prop.removed) {
    prop.hoverY = prop.body.translation().y;
    prop.mesh.visible = true;
  }
}

export function pilotLook(prop, dx, dy) {
  const p = prop.pilot;
  if (!p) return;
  p.yaw -= dx * 0.0035;
  p.pitch = THREE.MathUtils.clamp(p.pitch - dy * 0.0035, -1.45, 1.2);
}

/** Places the camera for a piloted drone: in its nose camera, or chasing it. Returns the fov. */
export function placePilotCamera(prop, camera, dt, groundHeight) {
  const p = prop.pilot;
  const b = prop.body;
  const t = b.translation();
  const r = b.rotation();
  _q.set(r.x, r.y, r.z, r.w);
  _e.set(p.pitch, p.yaw, 0);
  const look = _q2.setFromEuler(_e);
  if (p.view === 'fpv') {
    prop.mesh.visible = false;
    camera.position.copy(LENS).applyQuaternion(_q).add(t);
    // the camera is bolted to the frame, so it banks with the drone (half as much, for comfort)
    const tilt = new THREE.Quaternion().setFromUnitVectors(Y, _v.copy(Y).applyQuaternion(_q));
    camera.quaternion.identity().slerp(tilt, 0.5).multiply(look);
    p.chase = null;
    return 92;
  }
  prop.mesh.visible = true;
  const fwd = lookDir(p, _v);
  const want = _v2.set(t.x, t.y, t.z).addScaledVector(fwd, -2.4);
  want.y += 0.7;
  if (!p.chase) p.chase = want.clone();
  else p.chase.lerp(want, 1 - Math.exp(-10 * dt));
  const gh = groundHeight(p.chase.x, p.chase.z) + 0.2;
  if (p.chase.y < gh) p.chase.y = gh;
  camera.position.copy(p.chase);
  camera.lookAt(t.x + fwd.x * 3, t.y + fwd.y * 3, t.z + fwd.z * 3);
  return null;
}

export const DRONE = {
  id: 'drone', name: 'Kamikaze drone', material: 'metal', mass: 2.2, size: 0.18, bottom: 0.09, ccd: true, health: 15, explosive: 1.6, loud: 0.8,
  linearDamping: 0.1, angularDamping: 2, pilotable: true,
  build: () => ({
    mesh: droneModel(),
    colliders: [{ desc: R.ColliderDesc.cuboid(0.17, 0.035, 0.17).setTranslation(0, 0.01, 0) }, { desc: R.ColliderDesc.cuboid(0.055, 0.04, 0.08).setTranslation(0, -0.05, 0) }],
  }),
  onActivate: (prop) => {
    if (prop.pilot || prop.mode === 'hunt') return false;
    launch(prop);
    prop.mode = 'hunt';
    return true;
  },
  activateText: () => 'Drone hunting',
  statusText: (prop) => {
    if (prop.pilot) return 'Remote controlled';
    if (prop.mode !== 'hunt') return prop.launched ? 'Hovering · G: hunt · Control tool: fly it' : 'G: hunt on its own · Control tool: fly it';
    return prop.target && !prop.target.removed && prop.target.alive ? `Hunting ${prop.target.name}` : 'Searching…';
  },
  prePhysics: (prop, dt) => {
    if (!prop.launched || prop.removed) return;
    const b = prop.body;
    const m = b.mass();
    const t = b.translation();
    const v = b.linvel();
    const pos = new THREE.Vector3(t.x, t.y, t.z);
    prop.flight += dt;
    const desired = new THREE.Vector3();
    let head = null;
    const pilot = prop.pilot;
    if (pilot) {
      // fly toward where the pilot looks; sideways and up/down stay level
      lookDir(pilot, _v);
      desired.addScaledVector(_v, pilot.move.z);
      desired.x += Math.cos(pilot.yaw) * pilot.move.x;
      desired.z -= Math.sin(pilot.yaw) * pilot.move.x;
      desired.y += pilot.move.y;
      if (desired.lengthSq() > 1) desired.normalize();
      desired.multiplyScalar(pilot.boost ? PILOT_BOOST : PILOT_SPEED);
      if (pilot.lift > 0) {
        pilot.lift -= dt;
        desired.y = Math.max(desired.y, 2.5); // take off on its own first
      }
      head = new THREE.Vector3(-Math.sin(pilot.yaw), 0, -Math.cos(pilot.yaw));
    } else if (prop.mode === 'hunt') {
      prop.scanT -= dt;
      if (prop.scanT <= 0) {
        prop.scanT = 0.4;
        if (!prop.target || prop.target.removed || !prop.target.alive) prop.target = findTarget(prop, pos);
      }
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
    } else {
      desired.set(0, THREE.MathUtils.clamp((prop.hoverY - pos.y) * 2, -4, 4), 0);
      head = prop.heading;
    }
    const acc = desired.sub(new THREE.Vector3(v.x, v.y, v.z)).multiplyScalar(pilot ? 5 : 4);
    const maxAcc = pilot ? 34 : 26;
    if (acc.length() > maxAcc) acc.setLength(maxAcc);
    const thrust = acc.clone();
    thrust.y += 9.81 * (prop.game.physics.gravityScale ?? 1);
    b.applyImpulse({ x: thrust.x * m * dt, y: thrust.y * m * dt, z: thrust.z * m * dt }, true);
    prop.load = thrust.length() / 9.81;
    // attitude: rotors tilt toward the thrust, nose toward where it is heading
    const up = thrust.normalize();
    if (!head) {
      head = new THREE.Vector3(v.x, 0, v.z);
      if (head.lengthSq() < 0.25) head.set(Math.sin(prop.flight * 0.3), 0, Math.cos(prop.flight * 0.3));
    }
    prop.heading = head.clone().normalize();
    const back = head.normalize().negate();
    back.addScaledVector(up, -back.dot(up)).normalize();
    const right = new THREE.Vector3().crossVectors(up, back);
    _m.makeBasis(right, up, back);
    const target = new THREE.Quaternion().setFromRotationMatrix(_m);
    const r = b.rotation();
    _q.set(r.x, r.y, r.z, r.w).slerp(target, pilot ? 0.2 : 0.15);
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
    // a piloted drone can bump into things a little before it goes off
    if (prop.launched && prop.flight > 0.8 && dv > (prop.pilot ? 3.5 : 2.5)) prop.detonate();
  },
  onDestroy: (prop) => {
    prop.sound?.stop();
    prop.mesh.userData.led.material.dispose();
  },
};
