// Syringes: glass barrel with coloured liquid that drains into whoever the needle is stuck in.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { R } from '../engine/physics.js';
import { merge } from '../util/geo.js';
import { SUBSTANCES, inject } from '../entities/chem.js';
import { sharpImpact } from './melee.js';

const mats = {};
const glass = () => (mats.glass ??= new THREE.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: 0.26, roughness: 0.04, clearcoat: 1, depthWrite: false }));
const steel = () => (mats.steel ??= new THREE.MeshStandardMaterial({ color: 0xdfe3e8, metalness: 1, roughness: 0.18 }));
const plastic = () => (mats.plastic ??= new THREE.MeshStandardMaterial({ color: 0xf2f3f5, roughness: 0.45 }));
const rubber = () => (mats.rubber ??= new THREE.MeshStandardMaterial({ color: 0x1b1b1d, roughness: 0.7 }));
function liquidMat(color) {
  const k = 'liquid' + color;
  return (mats[k] ??= new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35, roughness: 0.2, transparent: true, opacity: 0.88 }));
}

const alongZ = (g) => g.rotateX(Math.PI / 2);
const FRONT = -0.054; // inside face of the barrel's front end
const FULL = 0.094; // liquid column length when full

/** Needle points down -Z; tip at z = -0.107. */
export function syringeModel(color, fill = 1) {
  const g = new THREE.Group();
  const barrel = new THREE.Mesh(alongZ(new THREE.CylinderGeometry(0.0125, 0.0125, 0.1, 22, 1, true)).translate(0, 0, -0.005), glass());
  barrel.renderOrder = 2;
  barrel.userData.noShadow = true;
  g.add(barrel);
  const front = alongZ(new THREE.CylinderGeometry(0.0045, 0.0125, 0.01, 18)).translate(0, 0, -0.06);
  const hub = alongZ(new THREE.CylinderGeometry(0.0032, 0.004, 0.01, 12)).translate(0, 0, -0.07);
  const flange = new RoundedBoxGeometry(0.05, 0.0045, 0.014, 2, 0.002).translate(0, 0, 0.045);
  g.add(new THREE.Mesh(merge([front, hub, flange]), plastic()));
  g.add(new THREE.Mesh(alongZ(new THREE.CylinderGeometry(0.00045, 0.0008, 0.036, 6)).translate(0, 0, -0.092), steel()));
  const liquid = new THREE.Mesh(alongZ(new THREE.CylinderGeometry(0.0109, 0.0109, 1, 18)), liquidMat(color));
  liquid.userData.noShadow = true;
  g.add(liquid);
  // plunger: rubber stopper behind the liquid, rod and thumb rest
  const plunger = new THREE.Group();
  plunger.add(new THREE.Mesh(alongZ(new THREE.CylinderGeometry(0.0115, 0.0115, 0.007, 18)).translate(0, 0, 0.0035), rubber()));
  const rod = new RoundedBoxGeometry(0.004, 0.012, 0.11, 1, 0.001).translate(0, 0, 0.058);
  const thumb = alongZ(new THREE.CylinderGeometry(0.012, 0.012, 0.003, 20)).translate(0, 0, 0.114);
  plunger.add(new THREE.Mesh(merge([rod, thumb]), plastic()));
  g.add(plunger);
  g.userData.liquid = liquid;
  g.userData.plunger = plunger;
  setFill(g, fill);
  return g;
}

function setFill(model, fill) {
  const len = Math.max(0.0005, FULL * fill);
  model.userData.liquid.scale.set(1, 1, len);
  model.userData.liquid.position.z = FRONT + len / 2;
  model.userData.liquid.visible = fill > 0.003;
  model.userData.plunger.position.z = FRONT + len;
}

const rotX90 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);

function makeSyringe(type) {
  const sub = SUBSTANCES[type];
  return {
    id: 'syringe_' + type, name: `${sub.name} syringe`, material: 'glass', mass: 0.06, size: 0.026, ccd: true, loud: 0.3, health: 6,
    sharp: { a: [0, 0, -0.075], b: [0, 0, -0.107], stab: true, needle: true, stabSpeed: 1.5, damage: 1 },
    stick: { axis: [0, 0, -1], tip: [0, 0, -0.107], depth: 0.022 },
    build: () => ({
      mesh: syringeModel(sub.color),
      colliders: [{ desc: R.ColliderDesc.capsule(0.05, 0.013).setRotation({ x: rotX90.x, y: rotX90.y, z: rotX90.z, w: rotX90.w }).setTranslation(0, 0, -0.005) }],
    }),
    onSpawn: (prop) => {
      prop.fill = 1;
    },
    onImpact: sharpImpact,
    onEmbed: (prop, e, part) => {
      prop.injecting = e.kind === 'person' ? { person: e, part } : null;
    },
    onUnembed: (prop) => {
      prop.injecting = null;
    },
    update: (prop, dt) => {
      const inj = prop.injecting;
      if (!inj || !prop.embedded || prop.fill <= 0 || dt <= 0) return;
      // the whole syringe goes in over a couple of seconds
      const d = Math.min(prop.fill, dt / 1.8);
      prop.fill -= d;
      inject(inj.person, type, d, inj.part);
      setFill(prop.mesh, prop.fill);
      if (prop.fill <= 0) prop.game.audio?.click(1700);
    },
    onBreak: (prop, p) => {
      prop.game.fx?.debris(p, new THREE.Vector3(0, 1, 0), 10, [0.85, 0.9, 0.95]);
      prop.game.audio?.impact('glass', 0.8, p);
    },
  };
}

export const SYRINGES = {
  adrenaline: makeSyringe('adrenaline'),
  life: makeSyringe('life'),
  acid: makeSyringe('acid'),
  sedative: makeSyringe('sedative'),
};
