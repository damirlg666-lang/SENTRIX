// Powered props: the thruster (sticks to whatever it is placed on and pushes it).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { R } from '../engine/physics.js';
import { merge } from '../util/geo.js';
import * as TX from '../engine/textures.js';

const mats = {};
const M = {
  body: () => {
    const m = TX.paintedMetal(256, 9);
    return new THREE.MeshStandardMaterial({ color: 0xa8b0b8, map: m.map, normalMap: m.normalMap, roughnessMap: m.roughnessMap, roughness: 1, metalness: 0.8 });
  },
  orange: () => new THREE.MeshStandardMaterial({ color: 0xe8661c, roughness: 0.45, metalness: 0.3 }),
  dark: () => new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.4, metalness: 0.85, side: THREE.DoubleSide }),
  bolt: () => new THREE.MeshStandardMaterial({ color: 0x8c9096, roughness: 0.3, metalness: 1 }),
};
const mat = (k) => (mats[k] ??= M[k]());
const V2 = (x, y) => new THREE.Vector2(x, y);
// lathe profiles are built along +Y; this turns them to run along +Z
const toZ = (g) => g.rotateX(Math.PI / 2);

/** Mount plate at -Z, exhaust nozzle at +Z. */
export function thrusterModel() {
  const g = new THREE.Group();
  const body = toZ(new THREE.LatheGeometry([V2(0.001, -0.15), V2(0.062, -0.15), V2(0.07, -0.135), V2(0.07, 0.07), V2(0.062, 0.09), V2(0.048, 0.1), V2(0.001, 0.1)], 36));
  g.add(new THREE.Mesh(body, mat('body')));
  const bands = [-0.06, 0.035].map((z) => toZ(new THREE.CylinderGeometry(0.0716, 0.0716, 0.026, 36)).translate(0, 0, z));
  g.add(new THREE.Mesh(merge(bands), mat('orange')));
  const nozzle = toZ(new THREE.LatheGeometry([V2(0.042, 0.095), V2(0.05, 0.14), V2(0.066, 0.2), V2(0.08, 0.25), V2(0.084, 0.255)], 36));
  g.add(new THREE.Mesh(nozzle, mat('dark')));
  const plate = new RoundedBoxGeometry(0.17, 0.17, 0.02, 2, 0.006).translate(0, 0, -0.16);
  g.add(new THREE.Mesh(plate, mat('dark')));
  const bolts = [];
  for (const x of [-0.065, 0.065]) for (const y of [-0.065, 0.065]) bolts.push(toZ(new THREE.CylinderGeometry(0.008, 0.008, 0.012, 8)).translate(x, y, -0.146));
  g.add(new THREE.Mesh(merge(bolts), mat('bolt')));
  // hot glow inside the nozzle (per-instance material so it can light up)
  const glow = new THREE.Mesh(new THREE.CircleGeometry(0.043, 24).translate(0, 0, 0.0), new THREE.MeshBasicMaterial({ color: 0x331a0a, toneMapped: false }));
  glow.position.z = 0.1;
  glow.userData.noShadow = true;
  g.add(glow);
  g.userData.glow = glow;
  return g;
}

const rotX90 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
const _q = new THREE.Quaternion();
const _d = new THREE.Vector3();
const _p = new THREE.Vector3();

export const MACHINES = {
  thruster: {
    id: 'thruster', name: 'Thruster', material: 'metal', mass: 4, size: 0.17, loud: 1.2,
    stick: { axis: [0, 0, -1], tip: [0, 0, -0.17], depth: -0.004 },
    thrust: 1150,
    build: () => ({
      mesh: thrusterModel(),
      colliders: [
        { desc: R.ColliderDesc.cylinder(0.2, 0.072).setRotation({ x: rotX90.x, y: rotX90.y, z: rotX90.z, w: rotX90.w }).setTranslation(0, 0, 0.05) },
        { desc: R.ColliderDesc.cuboid(0.085, 0.085, 0.01).setTranslation(0, 0, -0.16) },
      ],
    }),
    onActivate: (prop) => {
      prop.on = !prop.on;
      if (!prop.on) {
        prop.sound?.stop();
        prop.sound = null;
      }
      prop.body.wakeUp();
      return true;
    },
    activateText: (prop) => (prop.on ? 'Thruster on' : 'Thruster off'),
    prePhysics: (prop, dt) => {
      if (!prop.on) return;
      const r = prop.body.rotation();
      _q.set(r.x, r.y, r.z, r.w);
      const d = _d.set(0, 0, -1).applyQuaternion(_q);
      const t = prop.body.translation();
      const f = prop.def.thrust * dt;
      // push the body part it is stuck to directly, so the joint does not have to carry the load
      const e = prop.embedded;
      const target = e ? e.entity.bodies[e.part] : prop.body;
      target.applyImpulseAtPoint({ x: d.x * f, y: d.y * f, z: d.z * f }, t, true);
      if (e?.entity.kind === 'person') e.entity.tearWatch = Math.max(e.entity.tearWatch, 0.1);
    },
    update: (prop, dt) => {
      const glow = prop.mesh.userData.glow;
      glow.material.color.setHex(prop.on ? 0xffb060 : 0x331a0a);
      if (!prop.on || dt <= 0) return;
      const r = prop.body.rotation();
      _q.set(r.x, r.y, r.z, r.w);
      const d = _d.set(0, 0, 1).applyQuaternion(_q);
      const t = prop.body.translation();
      const exit = _p.set(t.x, t.y, t.z).addScaledVector(d, 0.26);
      const fx = prop.game.fx;
      const v = prop.body.linvel();
      for (let i = 0; i < 3; i++) {
        const s = 5 + Math.random() * 4;
        fx?.additive.add({
          x: exit.x, y: exit.y, z: exit.z,
          vx: d.x * s + v.x + (Math.random() - 0.5) * 0.8, vy: d.y * s + v.y + (Math.random() - 0.5) * 0.8, vz: d.z * s + v.z + (Math.random() - 0.5) * 0.8,
          drag: 4, life: 0.12 + Math.random() * 0.12, size0: 0.11, size1: 0.3,
          col0: [1.7, 1.25, 0.7], col1: [0.9, 0.25, 0.04], tile: 4 + Math.floor(Math.random() * 4), a0: 0.85,
        });
      }
      fx?.additive.add({ x: exit.x, y: exit.y, z: exit.z, vx: v.x, vy: v.y, vz: v.z, life: 0.05, size0: 0.32, size1: 0.2, col0: [1.4, 0.9, 0.5], tile: 8, a0: 0.6 });
      if (Math.random() < dt * 14) {
        fx?.smoke(exit.clone().addScaledVector(d, 0.3), 1, { size: 0.18, gray: 0.55, alpha: 0.3, speed: 0.6, life: 0.8 });
      }
      const audio = prop.game.audio;
      if (!prop.sound && audio) prop.sound = audio.loop('thruster', exit);
      prop.sound?.setPos(exit);
    },
    onDestroy: (prop) => {
      prop.sound?.stop();
      prop.mesh.userData.glow.material.dispose();
    },
  },
};
