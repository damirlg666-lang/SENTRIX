// Weapon definitions, first-person models and projectile props.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { R } from '../engine/physics.js';
import { merge } from '../util/geo.js';
import * as TX from '../engine/textures.js';

const M = {
  black: () => new THREE.MeshStandardMaterial({ color: 0x18191b, roughness: 0.45, metalness: 0.6 }),
  gunmetal: () => new THREE.MeshStandardMaterial({ color: 0x2c2f33, roughness: 0.35, metalness: 0.85 }),
  polymer: () => new THREE.MeshStandardMaterial({ color: 0x232426, roughness: 0.75, metalness: 0.05 }),
  tan: () => new THREE.MeshStandardMaterial({ color: 0x9c8462, roughness: 0.7, metalness: 0.05 }),
  wood: () => {
    const w = TX.woodPlanks(512, 1, 23);
    return new THREE.MeshStandardMaterial({ map: w.map, normalMap: w.normalMap, roughness: 0.55, color: 0xa4693e });
  },
  olive: () => new THREE.MeshStandardMaterial({ color: 0x4d5536, roughness: 0.65, metalness: 0.2 }),
  glass: () => new THREE.MeshPhysicalMaterial({ color: 0x0a1630, roughness: 0.05, metalness: 0.4, clearcoat: 1 }),
  brass: () => new THREE.MeshStandardMaterial({ color: 0xb08d3c, roughness: 0.3, metalness: 1 }),
  warhead: () => new THREE.MeshStandardMaterial({ color: 0x5c6b3a, roughness: 0.5, metalness: 0.3 }),
};
const cache = {};
const m = (k) => (cache[k] ??= M[k]());

const rb = (w, h, d, r, x = 0, y = 0, z = 0) => new RoundedBoxGeometry(w, h, d, 2, r).translate(x, y, z);
const cyl = (r1, r2, len, x = 0, y = 0, z = 0, seg = 18) => new THREE.CylinderGeometry(r1, r2, len, seg).rotateX(Math.PI / 2).translate(x, y, z);

function group(parts) {
  const g = new THREE.Group();
  for (const [geo, mat] of parts) {
    const mesh = new THREE.Mesh(Array.isArray(geo) ? merge(geo) : geo, m(mat));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
  }
  return g;
}

// Models point down -Z (forward) with the muzzle at userData.muzzle
function pistolModel() {
  const g = group([
    [[rb(0.032, 0.034, 0.19, 0.006, 0, 0.018, -0.02)], 'black'],
    [[rb(0.028, 0.02, 0.17, 0.004, 0, -0.008, -0.01), rb(0.03, 0.11, 0.045, 0.008, 0, -0.06, 0.05).rotateX(0.25)], 'polymer'],
    [[cyl(0.0065, 0.0065, 0.02, 0, 0.02, -0.12)], 'gunmetal'],
    [[new THREE.TorusGeometry(0.018, 0.0035, 6, 16, Math.PI).rotateY(Math.PI / 2).translate(0, -0.02, -0.002)], 'polymer'],
  ]);
  g.userData.muzzle = new THREE.Vector3(0, 0.02, -0.13);
  return g;
}

function rifleModel() {
  const g = group([
    [[rb(0.045, 0.06, 0.32, 0.006, 0, 0, 0), rb(0.035, 0.03, 0.3, 0.004, 0, 0.042, -0.02)], 'black'],
    [[rb(0.05, 0.055, 0.22, 0.01, 0, 0.005, -0.27)], 'tan'],
    [[cyl(0.009, 0.009, 0.25, 0, 0.012, -0.48), cyl(0.014, 0.014, 0.05, 0, 0.012, -0.6)], 'gunmetal'],
    [[rb(0.03, 0.13, 0.05, 0.006, 0, -0.09, -0.06).rotateX(-0.25), rb(0.03, 0.1, 0.04, 0.008, 0, -0.07, 0.08).rotateX(0.3)], 'polymer'],
    [[rb(0.04, 0.06, 0.2, 0.012, 0, -0.01, 0.25), rb(0.035, 0.09, 0.05, 0.01, 0, -0.03, 0.34)], 'tan'],
    [[rb(0.026, 0.035, 0.06, 0.004, 0, 0.075, 0.02)], 'gunmetal'],
  ]);
  g.userData.muzzle = new THREE.Vector3(0, 0.012, -0.63);
  return g;
}

function shotgunModel() {
  const g = group([
    [[cyl(0.012, 0.012, 0.62, 0, 0.02, -0.33), cyl(0.011, 0.011, 0.5, 0, -0.008, -0.28)], 'gunmetal'],
    [[rb(0.045, 0.06, 0.18, 0.008, 0, 0.0, 0.0)], 'black'],
    [[rb(0.05, 0.045, 0.16, 0.012, 0, -0.01, -0.26)], 'wood'],
    [[rb(0.04, 0.07, 0.3, 0.015, 0, -0.03, 0.22).rotateX(0.12)], 'wood'],
  ]);
  g.userData.muzzle = new THREE.Vector3(0, 0.02, -0.65);
  return g;
}

function sniperModel() {
  const g = group([
    [[cyl(0.011, 0.008, 0.6, 0, 0.012, -0.45), cyl(0.016, 0.016, 0.06, 0, 0.012, -0.77)], 'gunmetal'],
    [[rb(0.045, 0.055, 0.28, 0.008, 0, 0, -0.02)], 'black'],
    [[rb(0.05, 0.05, 0.42, 0.012, 0, -0.012, -0.12), rb(0.04, 0.09, 0.26, 0.015, 0, -0.03, 0.28).rotateX(0.1)], 'olive'],
    [[cyl(0.022, 0.022, 0.26, 0, 0.075, -0.02), cyl(0.028, 0.022, 0.05, 0, 0.075, -0.16), cyl(0.026, 0.022, 0.04, 0, 0.075, 0.12), rb(0.02, 0.04, 0.03, 0.004, 0, 0.045, -0.05)], 'black'],
    [[cyl(0.02, 0.02, 0.005, 0, 0.075, -0.188)], 'glass'],
  ]);
  g.userData.muzzle = new THREE.Vector3(0, 0.012, -0.8);
  return g;
}

function launcherModel() {
  const g = group([
    [[cyl(0.045, 0.045, 0.9, 0, 0, -0.15, 24)], 'olive'],
    [[cyl(0.052, 0.052, 0.08, 0, 0, 0.27, 24), cyl(0.05, 0.05, 0.06, 0, 0, -0.56, 24)], 'black'],
    [[new THREE.ConeGeometry(0.04, 0.16, 16).rotateX(-Math.PI / 2).translate(0, 0, -0.68), cyl(0.04, 0.04, 0.06, 0, 0, -0.58, 16)], 'warhead'],
    [[rb(0.03, 0.11, 0.045, 0.008, 0, -0.09, 0.05).rotateX(0.2), rb(0.03, 0.1, 0.04, 0.008, 0, -0.08, -0.22).rotateX(0.2), rb(0.02, 0.05, 0.05, 0.004, -0.04, 0.05, -0.1)], 'black'],
  ]);
  g.userData.muzzle = new THREE.Vector3(0, 0, -0.72);
  return g;
}

export function grenadeModel() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.035, 20, 14), m('olive'));
  body.scale.set(1, 1.25, 1);
  g.add(body);
  const top = group([
    [[new THREE.CylinderGeometry(0.014, 0.016, 0.025, 12).translate(0, 0.05, 0), rb(0.012, 0.06, 0.008, 0.003, 0.018, 0.035, 0).rotateZ(-0.15)], 'gunmetal'],
    [[new THREE.TorusGeometry(0.01, 0.002, 6, 12).translate(-0.016, 0.06, 0)], 'brass'],
  ]);
  g.add(top);
  g.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  g.userData.muzzle = new THREE.Vector3(0, 0, -0.05);
  return g;
}

export function rocketModel() {
  const g = group([
    [[cyl(0.04, 0.04, 0.28, 0, 0, 0.02, 16)], 'warhead'],
    [[new THREE.ConeGeometry(0.04, 0.14, 16).rotateX(-Math.PI / 2).translate(0, 0, -0.19)], 'warhead'],
    [[rb(0.005, 0.07, 0.06, 0.002, 0, 0, 0.14), rb(0.07, 0.005, 0.06, 0.002, 0, 0, 0.14)], 'black'],
  ]);
  return g;
}

export const WEAPONS = [
  { id: 'pistol', name: 'Pistol', model: pistolModel, damage: 26, impulse: 14, rate: 0.16, auto: false, spread: 0.004, recoil: 0.06, sound: 'pistol', pierce: 0, pos: [0.2, -0.17, -0.42] },
  { id: 'rifle', name: 'Assault rifle', model: rifleModel, damage: 30, impulse: 18, rate: 0.085, auto: true, spread: 0.012, recoil: 0.04, sound: 'rifle', pierce: 1, pos: [0.19, -0.2, -0.36] },
  { id: 'shotgun', name: 'Shotgun', model: shotgunModel, damage: 14, impulse: 9, rate: 0.75, auto: false, spread: 0.055, pellets: 9, recoil: 0.12, sound: 'shotgun', pierce: 0, pos: [0.19, -0.2, -0.34] },
  { id: 'sniper', name: 'Sniper rifle', model: sniperModel, damage: 120, impulse: 70, rate: 1.1, auto: false, spread: 0.0, recoil: 0.16, sound: 'sniper', pierce: 3, pos: [0.19, -0.21, -0.34] },
  { id: 'rocket', name: 'Rocket launcher', model: launcherModel, rate: 1.0, auto: false, projectile: 'rocket', recoil: 0.12, sound: 'rocket', pos: [0.22, -0.2, -0.3] },
  { id: 'grenade', name: 'Grenade', model: grenadeModel, rate: 0.6, auto: false, projectile: 'grenade', recoil: 0.0, sound: null, pos: [0.22, -0.2, -0.38] },
];

export const PROJECTILES = {
  rocket: {
    id: 'rocket', name: 'Rocket', material: 'metal', mass: 4, explosive: 2.0, ccd: true, gravityScale: 0.15, hidden: true,
    build: () => ({ mesh: rocketModel(), colliders: [{ desc: R.ColliderDesc.capsule(0.12, 0.04).setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2)) }] }),
    impactTrigger: 0.01,
    update: (prop, dt) => {
      if (dt <= 0) return;
      const fx = prop.game.fx;
      const v = prop.body.linvel();
      const back = new THREE.Vector3(v.x, v.y, v.z).normalize().multiplyScalar(-0.2);
      const t = prop.body.translation();
      const p = new THREE.Vector3(t.x + back.x, t.y + back.y, t.z + back.z);
      fx?.fire(p, 2, 0.22);
      fx?.smoke(p, 1, { size: 0.25, gray: 0.6, alpha: 0.5, speed: 0.3, life: 1.2 });
      // keep the rocket pointing along its velocity
      if (Math.hypot(v.x, v.y, v.z) > 1) {
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), new THREE.Vector3(v.x, v.y, v.z).normalize());
        prop.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
      }
      if (prop.age > 6) prop.detonate();
    },
  },
  grenade: {
    id: 'grenade', name: 'Grenade', material: 'metal', mass: 0.4, explosive: 1.3, fuseTime: 2.6, ccd: true, restitution: 0.35, hidden: true,
    build: () => ({ mesh: grenadeModel(), colliders: [{ desc: R.ColliderDesc.capsule(0.01, 0.036) }] }),
    onSpawn: (prop) => {
      prop.fuse = 2.6;
    },
  },
};
