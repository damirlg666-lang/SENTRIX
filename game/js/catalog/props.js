// Prop definitions: procedural models + physics settings.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { R } from '../engine/physics.js';
import * as TX from '../engine/textures.js';
import { merge } from '../util/geo.js';

const mats = new Map();
function mat(key, make) {
  if (!mats.has(key)) mats.set(key, make());
  return mats.get(key);
}

const V2 = (x, y) => new THREE.Vector2(x, y);
const box = (w, h, d, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
const cuboid = (hx, hy, hz, x = 0, y = 0, z = 0, q = null) => {
  const d = R.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z);
  if (q) d.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
  return { desc: d };
};
const rotZ90 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);

function woodMat(seed = 3, tint = 0xffffff) {
  return mat('wood' + seed + tint, () => {
    const w = TX.woodPlanks(512, 4, seed);
    return new THREE.MeshStandardMaterial({ map: w.map, normalMap: w.normalMap, roughnessMap: w.roughnessMap, roughness: 1, color: tint });
  });
}

function metalMat(color, seed = 1, metalness = 0.55) {
  return mat('metal' + color + seed + metalness, () => {
    const m = TX.paintedMetal(512, seed);
    return new THREE.MeshStandardMaterial({ color, map: m.map, normalMap: m.normalMap, roughnessMap: m.roughnessMap, roughness: 1, metalness });
  });
}

function concreteMat() {
  return mat('concrete', () => {
    const c = TX.concrete(1024);
    const m = new THREE.MeshStandardMaterial({ map: c.map, normalMap: c.normalMap, roughnessMap: c.roughnessMap, roughness: 1, color: 0xd8d4cc });
    return m;
  });
}

// ------------------------------------------------------------------ models
function crateModel(s) {
  const g = new THREE.Group();
  const inner = new THREE.Mesh(new RoundedBoxGeometry(s * 0.97, s * 0.97, s * 0.97, 2, 0.01), woodMat(3));
  g.add(inner);
  const t = s * 0.085;
  const h = s / 2 - t / 2 + 0.002;
  const beams = [];
  for (const a of [-1, 1]) {
    for (const b of [-1, 1]) {
      beams.push(box(s + 0.004, t, t, 0, a * h, b * h));
      beams.push(box(t, s + 0.004, t, a * h, 0, b * h));
      beams.push(box(t, t, s + 0.004, a * h, b * h, 0));
    }
  }
  // diagonal braces on the four sides
  const diag = Math.SQRT2 * (s - 2 * t);
  for (const [axis, sign] of [['z', 1], ['z', -1], ['x', 1], ['x', -1]]) {
    const b = new THREE.BoxGeometry(diag, t * 0.9, t * 0.5);
    b.rotateZ(Math.PI / 4 * sign);
    if (axis === 'z') b.translate(0, 0, sign * (s / 2 + 0.003));
    else {
      b.rotateY(Math.PI / 2);
      b.translate(sign * (s / 2 + 0.003), 0, 0);
    }
    beams.push(b);
  }
  g.add(new THREE.Mesh(merge(beams), woodMat(7, 0xb0886a)));
  const st = new THREE.Mesh(
    new THREE.PlaneGeometry(s * 0.7, s * 0.7),
    mat('stencil', () => new THREE.MeshStandardMaterial({ map: TX.crateStencil(), transparent: true, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2 }))
  );
  st.position.set(0, -s * 0.05, s / 2 + 0.0065);
  st.userData.noShadow = true;
  g.add(st);
  return g;
}

function barrelGeometry(R0 = 0.29, H = 0.88) {
  const pts = [];
  pts.push(V2(0.001, 0), V2(R0 - 0.015, 0), V2(R0, 0.015), V2(R0 + 0.008, 0.022), V2(R0 + 0.008, 0.036), V2(R0, 0.042));
  for (const y of [H * 0.33, H * 0.67]) pts.push(V2(R0, y - 0.026), V2(R0 + 0.011, y - 0.012), V2(R0 + 0.011, y + 0.012), V2(R0, y + 0.026));
  pts.push(V2(R0, H - 0.042), V2(R0 + 0.008, H - 0.036), V2(R0 + 0.008, H - 0.022), V2(R0, H - 0.015), V2(R0 - 0.015, H), V2(R0 - 0.03, H - 0.012), V2(0.001, H - 0.012));
  const geo = new THREE.LatheGeometry(pts, 48);
  const p = geo.attributes.position;
  const uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setY(i, p.getY(i) / H);
  geo.translate(0, -H / 2, 0);
  geo.computeVertexNormals();
  return geo;
}

function barrelModel(material) {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(barrelGeometry(), material));
  // bung caps on the lid
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 16), metalMat(0x888888, 3, 0.8));
  cap.position.set(0.15, 0.435, 0.05);
  g.add(cap);
  return g;
}

function tntModel() {
  const g = new THREE.Group();
  const stickMat = mat('tntstick', () => new THREE.MeshStandardMaterial({ color: 0xb8231b, roughness: 0.75 }));
  const capMat = mat('tntcap', () => new THREE.MeshStandardMaterial({ color: 0xd9c9a3, roughness: 0.9 }));
  const sticks = [];
  const caps = [];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 2; j++) {
      const x = (i - 1) * 0.052;
      const y = (j - 0.5) * 0.052;
      sticks.push(new THREE.CylinderGeometry(0.025, 0.025, 0.22, 18).rotateX(Math.PI / 2).translate(x, y, 0));
      caps.push(new THREE.CylinderGeometry(0.0255, 0.0255, 0.006, 18).rotateX(Math.PI / 2).translate(x, y, 0.111));
      caps.push(new THREE.CylinderGeometry(0.0255, 0.0255, 0.006, 18).rotateX(Math.PI / 2).translate(x, y, -0.111));
    }
  }
  g.add(new THREE.Mesh(merge(sticks), stickMat));
  g.add(new THREE.Mesh(merge(caps), capMat));
  const tape = mat('tape', () => new THREE.MeshStandardMaterial({ color: 0x1c1c1e, roughness: 0.4 }));
  for (const z of [-0.06, 0.06]) g.add(new THREE.Mesh(new RoundedBoxGeometry(0.168, 0.116, 0.025, 2, 0.01).translate(0, 0, z), tape));
  const label = new THREE.Mesh(
    new THREE.PlaneGeometry(0.15, 0.075),
    mat('tntlabel', () => new THREE.MeshStandardMaterial({ map: TX.tntLabel(), roughness: 0.8 }))
  );
  label.rotation.y = Math.PI / 2;
  label.position.set(0.0785, 0, 0);
  label.scale.set(1.3, 1.1, 1);
  g.add(label);
  // timer
  const timer = new THREE.Mesh(new RoundedBoxGeometry(0.09, 0.03, 0.06, 2, 0.006), tape);
  timer.position.set(0, 0.068, -0.0);
  g.add(timer);
  const lcd = new THREE.Mesh(
    new THREE.PlaneGeometry(0.06, 0.03),
    new THREE.MeshStandardMaterial({ color: 0x0a1a0a, emissive: 0x33ff55, emissiveIntensity: 0.6, roughness: 0.3 })
  );
  lcd.rotation.x = -Math.PI / 2;
  lcd.position.set(0, 0.0835, 0);
  g.add(lcd);
  g.userData.lcd = lcd;
  const wire = new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0.04, 0.07, 0.02), new THREE.Vector3(0.07, 0.08, 0.06), new THREE.Vector3(0.05, 0.055, 0.1)]), 12, 0.003, 6),
    mat('wirered', () => new THREE.MeshStandardMaterial({ color: 0xcc2222, roughness: 0.5 }))
  );
  g.add(wire);
  return g;
}

function mineModel() {
  const g = new THREE.Group();
  const body = metalMat(0x4b5a3a, 4, 0.4);
  const prof = [V2(0.001, 0), V2(0.15, 0), V2(0.155, 0.012), V2(0.15, 0.045), V2(0.13, 0.055), V2(0.06, 0.058), V2(0.06, 0.066), V2(0.001, 0.066)];
  const geo = new THREE.LatheGeometry(prof, 40).translate(0, -0.033, 0);
  geo.computeVertexNormals();
  g.add(new THREE.Mesh(geo, body));
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.008, 10, 8), new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff2020, emissiveIntensity: 0 }));
  led.position.set(0.08, 0.025, 0.0);
  g.add(led);
  g.userData.led = led;
  return g;
}

function coneModel() {
  const g = new THREE.Group();
  const prof = [V2(0.001, 0.03), V2(0.14, 0.03), V2(0.135, 0.05), V2(0.03, 0.7), V2(0.022, 0.71), V2(0.001, 0.71)];
  const geo = new THREE.LatheGeometry(prof, 32);
  const p = geo.attributes.position;
  const col = new Float32Array(p.count * 3);
  const orange = new THREE.Color(0xff5a14);
  const white = new THREE.Color(0xf4f4f0);
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const c = (y > 0.3 && y < 0.39) || (y > 0.49 && y < 0.55) ? white : orange;
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  geo.translate(0, -0.3, 0);
  g.add(new THREE.Mesh(geo, mat('cone', () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 }))));
  const base = new THREE.Mesh(new RoundedBoxGeometry(0.36, 0.03, 0.36, 2, 0.01).translate(0, -0.285, 0), mat('rubber', () => new THREE.MeshStandardMaterial({ color: 0x18181a, roughness: 0.85 })));
  g.add(base);
  return g;
}

function tireModel() {
  const g = new THREE.Group();
  const rubber = mat('tire', () => {
    const n = TX.bumpNoise(256, 48, 4, 21);
    n.repeat.set(8, 1);
    return new THREE.MeshStandardMaterial({ color: 0x1b1b1d, roughness: 0.9, normalMap: n, normalScale: new THREE.Vector2(1.5, 1.5) });
  });
  const tire = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.115, 20, 48), rubber);
  tire.scale.set(1, 1, 1.25);
  tire.rotation.y = Math.PI / 2;
  g.add(tire);
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.2, 28).rotateZ(Math.PI / 2), mat('rim', () => new THREE.MeshStandardMaterial({ color: 0xb8bcc2, metalness: 0.9, roughness: 0.3 })));
  g.add(rim);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.22, 16).rotateZ(Math.PI / 2), mat('hub', () => new THREE.MeshStandardMaterial({ color: 0x55585e, metalness: 0.8, roughness: 0.4 })));
  g.add(hub);
  return g;
}

function sphereModel(r, material, sx = 1, sy = 1, sz = 1) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 40, 28), material);
  m.scale.set(sx, sy, sz);
  return m;
}

function anvilModel() {
  const g = new THREE.Group();
  const iron = mat('iron', () => new THREE.MeshStandardMaterial({ color: 0x2c2e31, metalness: 0.85, roughness: 0.42, normalMap: TX.bumpNoise(256, 20, 1.5, 33) }));
  const parts = [
    new RoundedBoxGeometry(0.36, 0.1, 0.22, 2, 0.015).translate(0, -0.12, 0),
    new RoundedBoxGeometry(0.2, 0.12, 0.13, 2, 0.015).translate(0, -0.01, 0),
    new RoundedBoxGeometry(0.42, 0.1, 0.2, 2, 0.015).translate(-0.03, 0.1, 0),
    new THREE.ConeGeometry(0.07, 0.22, 20).rotateZ(-Math.PI / 2).scale(1, 0.75, 1).translate(0.29, 0.11, 0),
  ];
  g.add(new THREE.Mesh(merge(parts), iron));
  return g;
}

function brickModel() {
  const t = TX.brick();
  return new THREE.Mesh(
    new RoundedBoxGeometry(0.215, 0.065, 0.1025, 1, 0.004),
    mat('brick', () => new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, roughness: 0.92 }))
  );
}

function tableModel() {
  const g = new THREE.Group();
  const top = new THREE.Mesh(new RoundedBoxGeometry(1.4, 0.05, 0.8, 2, 0.012), woodMat(11, 0xc9a27a));
  top.position.y = 0.35;
  g.add(top);
  const legs = [];
  for (const x of [-0.62, 0.62]) for (const z of [-0.33, 0.33]) legs.push(new RoundedBoxGeometry(0.06, 0.7, 0.06, 1, 0.01).translate(x, -0.025, z));
  legs.push(box(1.2, 0.08, 0.025, 0, 0.29, 0.33), box(1.2, 0.08, 0.025, 0, 0.29, -0.33));
  g.add(new THREE.Mesh(merge(legs), woodMat(12, 0x8a6446)));
  return g;
}

function chairModel() {
  const g = new THREE.Group();
  const w = woodMat(13, 0xa87d58);
  const seat = new THREE.Mesh(new RoundedBoxGeometry(0.45, 0.04, 0.45, 2, 0.01), w);
  seat.position.y = 0;
  g.add(seat);
  const parts = [];
  for (const x of [-0.19, 0.19]) for (const z of [-0.19, 0.19]) parts.push(box(0.04, 0.45, 0.04, x, -0.245, z));
  for (const x of [-0.19, 0.19]) parts.push(box(0.04, 0.5, 0.04, x, 0.27, -0.19));
  for (const y of [0.2, 0.32, 0.44]) parts.push(box(0.38, 0.05, 0.02, 0, y, -0.19));
  g.add(new THREE.Mesh(merge(parts), w));
  return g;
}

function ibeamModel() {
  const s = new THREE.Shape();
  const W = 0.2, H = 0.3, tf = 0.016, tw = 0.01;
  s.moveTo(-W / 2, -H / 2);
  s.lineTo(W / 2, -H / 2);
  s.lineTo(W / 2, -H / 2 + tf);
  s.lineTo(tw / 2, -H / 2 + tf);
  s.lineTo(tw / 2, H / 2 - tf);
  s.lineTo(W / 2, H / 2 - tf);
  s.lineTo(W / 2, H / 2);
  s.lineTo(-W / 2, H / 2);
  s.lineTo(-W / 2, H / 2 - tf);
  s.lineTo(-tw / 2, H / 2 - tf);
  s.lineTo(-tw / 2, -H / 2 + tf);
  s.lineTo(-W / 2, -H / 2 + tf);
  s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, { depth: 3, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 1 });
  geo.translate(0, 0, -1.5);
  const uv = geo.attributes.uv;
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getZ(i) * 0.5 + p.getX(i), p.getY(i) * 2);
  return new THREE.Mesh(geo, metalMat(0x8a5a3c, 8, 0.6));
}

function dominoModel() {
  return new THREE.Mesh(
    new RoundedBoxGeometry(0.3, 0.6, 0.08, 2, 0.02),
    mat('domino', () => new THREE.MeshPhysicalMaterial({ map: TX.domino(), roughness: 0.25, clearcoat: 0.6 }))
  );
}

const BALLOON_COLORS = [0xe52b2b, 0x2b7be5, 0xf2c12e, 0x3fbf5a, 0xd94fd1, 0xff8a1f];
function balloonModel(color) {
  const g = new THREE.Group();
  const m = new THREE.MeshPhysicalMaterial({ color, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.08, sheen: 0.5, sheenColor: new THREE.Color(color).multiplyScalar(0.6) });
  const prof = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const a = t * Math.PI;
    const r = Math.sin(a) * 0.24 * (1 - 0.25 * Math.pow(1 - t, 3));
    prof.push(V2(Math.max(0.001, r), -Math.cos(a) * 0.29 - 0.0));
  }
  const geo = new THREE.LatheGeometry(prof, 32);
  geo.computeVertexNormals();
  g.add(new THREE.Mesh(geo, m));
  const knot = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.035, 10).rotateX(Math.PI), m);
  knot.position.y = -0.3;
  g.add(knot);
  const string = new THREE.Mesh(new THREE.CylinderGeometry(0.0015, 0.0015, 0.6, 4).translate(0, -0.62, 0), mat('string', () => new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.8 })));
  string.userData.noShadow = true;
  g.add(string);
  return g;
}

// ------------------------------------------------------------------ definitions
function makeDebris(game, def, p, n, lifetime = 12) {
  // lazily resolved to avoid an import cycle
  const { Prop } = game.classes;
  for (let i = 0; i < n; i++) {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6));
    const pos = p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.4, Math.random() * 0.3, (Math.random() - 0.5) * 0.4));
    const d = new Prop(game, def, pos, q, { lifetime: lifetime + Math.random() * 4 });
    d.body.setLinvel({ x: (Math.random() - 0.5) * 4, y: Math.random() * 4, z: (Math.random() - 0.5) * 4 }, true);
    d.body.setAngvel({ x: (Math.random() - 0.5) * 10, y: (Math.random() - 0.5) * 10, z: (Math.random() - 0.5) * 10 }, true);
    game.add(d, false);
  }
}

export const PROPS = {};

PROPS.crate = {
  id: 'crate', name: 'Wooden crate', material: 'wood', mass: 28, health: 140, size: 0.8,
  build: () => ({ mesh: crateModel(0.8), colliders: [cuboid(0.4, 0.4, 0.4)] }),
  onBreak: (prop, p) => {
    prop.game.fx?.debris(p, new THREE.Vector3(0, 1, 0), 30, [0.5, 0.36, 0.2]);
    prop.game.fx?.dust(p, new THREE.Vector3(0, 1, 0), 10, [0.55, 0.45, 0.32]);
    prop.game.audio?.impact('wood', 1, p);
    makeDebris(prop.game, PROPS.plankDebris, p, 6);
  },
};
PROPS.smallCrate = {
  ...PROPS.crate, id: 'smallCrate', name: 'Small crate', mass: 9, health: 70, size: 0.5,
  build: () => ({ mesh: crateModel(0.5), colliders: [cuboid(0.25, 0.25, 0.25)] }),
  onBreak: (prop, p) => {
    prop.game.fx?.debris(p, new THREE.Vector3(0, 1, 0), 18, [0.5, 0.36, 0.2]);
    prop.game.audio?.impact('wood', 1, p);
    makeDebris(prop.game, PROPS.plankDebris, p, 3);
  },
};
PROPS.plankDebris = {
  id: 'plankDebris', name: 'Splinter', material: 'wood', mass: 1.2, hidden: true,
  build: () => ({ mesh: new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.025, 0.09), woodMat(3)), colliders: [cuboid(0.21, 0.0125, 0.045)] }),
};
PROPS.barrel = {
  id: 'barrel', name: 'Steel drum', material: 'metal', mass: 32, size: 0.88, loud: 1.2,
  build: () => ({ mesh: barrelModel(metalMat(0x2a5d8f, 1, 0.55)), colliders: [{ desc: R.ColliderDesc.roundCylinder(0.42, 0.28, 0.01) }] }),
};
PROPS.explosiveBarrel = {
  id: 'explosiveBarrel', name: 'Explosive barrel', material: 'metal', mass: 45, health: 30, explosive: 1.6, size: 0.88,
  build: () => {
    const m = mat('exbarrel', () => {
      const pm = TX.paintedMetal(512, 6);
      return new THREE.MeshStandardMaterial({ map: TX.explosiveLabel(), roughnessMap: pm.roughnessMap, normalMap: pm.normalMap, roughness: 1, metalness: 0.35 });
    });
    return { mesh: barrelModel(m), colliders: [{ desc: R.ColliderDesc.roundCylinder(0.42, 0.28, 0.01) }] };
  },
  onDamage: (prop, info) => {
    if (info.kind === 'bullet' && prop.health > 0) {
      // punctured: leak a little fire before going up
      prop.leak = (prop.leak || 0) + 1;
    }
  },
  update: (prop, dt) => {
    if (prop.leak && prop.fuse < 0 && !prop.removed) {
      if (Math.random() < dt * 20) {
        const t = prop.body.translation();
        prop.game.fx?.fire(new THREE.Vector3(t.x, t.y + 0.45, t.z), 1, 0.25);
      }
    }
  },
};
PROPS.tnt = {
  id: 'tnt', name: 'TNT bundle', material: 'wood', mass: 3.5, health: 20, explosive: 2.2, fuseTime: 3, size: 0.12,
  build: () => ({ mesh: tntModel(), colliders: [cuboid(0.08, 0.055, 0.112)] }),
  onFuseTick: (prop) => {
    const lcd = prop.mesh.userData.lcd;
    const t = Math.ceil(prop.fuse * 2);
    if (t !== prop._beepT) {
      prop._beepT = t;
      prop.game.audio?.beep(prop.body.translation(), prop.fuse < 1 ? 2400 : 1800);
      if (lcd) lcd.material.emissive.set(t % 2 ? 0xff3322 : 0x33ff55);
    }
  },
};
PROPS.mine = {
  id: 'mine', name: 'Landmine', material: 'metal', mass: 3, health: 15, explosive: 1.8, size: 0.066,
  build: () => ({ mesh: mineModel(), colliders: [{ desc: R.ColliderDesc.roundCylinder(0.02, 0.14, 0.012) }] }),
  onImpact: (prop, dv, other) => {
    if (prop.age > 1.5 && other && other.kind !== 'static' && dv > 0.15) prop.fuse = 0.15;
  },
  update: (prop) => {
    const led = prop.mesh.userData.led;
    if (led) led.material.emissiveIntensity = prop.age > 1.5 && Math.sin(prop.age * 8) > 0.6 ? 4 : 0;
  },
};
PROPS.cone = {
  id: 'cone', name: 'Traffic cone', material: 'rubber', mass: 3, size: 0.6,
  build: () => ({
    mesh: coneModel(),
    colliders: [{ desc: R.ColliderDesc.cone(0.33, 0.13).setTranslation(0, 0.06, 0) }, cuboid(0.18, 0.015, 0.18, 0, -0.285, 0)],
  }),
};
PROPS.tire = {
  id: 'tire', name: 'Tire', material: 'rubber', mass: 11, restitution: 0.55, size: 0.78,
  build: () => ({ mesh: tireModel(), colliders: [{ desc: R.ColliderDesc.roundCylinder(0.04, 0.28, 0.105).setRotation({ x: rotZ90.x, y: rotZ90.y, z: rotZ90.z, w: rotZ90.w }) }] }),
};
PROPS.beachBall = {
  id: 'beachBall', name: 'Beach ball', material: 'rubber', mass: 0.35, restitution: 0.85, restitutionMax: true, linearDamping: 0.6, angularDamping: 0.3, size: 0.6, loud: 0.4,
  build: () => ({ mesh: sphereModel(0.3, mat('beach', () => new THREE.MeshPhysicalMaterial({ map: TX.beachBall(), roughness: 0.3, clearcoat: 0.6 }))), colliders: [{ desc: R.ColliderDesc.ball(0.3) }] }),
};
PROPS.bowlingBall = {
  id: 'bowlingBall', name: 'Bowling ball', material: 'concrete', mass: 7, restitution: 0.25, size: 0.22, ccd: true,
  build: () => ({ mesh: sphereModel(0.109, mat('bowl', () => new THREE.MeshPhysicalMaterial({ map: TX.bowlingBall(), roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.05 }))), colliders: [{ desc: R.ColliderDesc.ball(0.109) }] }),
};
PROPS.watermelon = {
  id: 'watermelon', name: 'Watermelon', material: 'flesh', mass: 6, health: 25, fragile: 5, size: 0.34,
  build: () => ({
    mesh: sphereModel(0.17, mat('melon', () => new THREE.MeshPhysicalMaterial({ map: TX.watermelon(), roughness: 0.35, clearcoat: 0.5 })), 1.3, 1, 1),
    colliders: [{ desc: R.ColliderDesc.capsule(0.06, 0.168).setRotation({ x: rotZ90.x, y: rotZ90.y, z: rotZ90.z, w: rotZ90.w }) }],
  }),
  onBreak: (prop, p) => {
    const fx = prop.game.fx;
    if (fx) {
      for (let i = 0; i < 40; i++) {
        const d = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).normalize().multiplyScalar(1 + Math.random() * 4);
        fx.alpha.add({ x: p.x, y: p.y, z: p.z, vx: d.x, vy: d.y, vz: d.z, grav: 9.8, drag: 0.3, life: 1.2, size0: 0.03, size1: 0.03, col0: [0.85, 0.12, 0.2], tile: 12 + (i % 4), fadePow: 6, floor: p.y - 0.3 });
      }
    }
    prop.game.audio?.impact('flesh', 1, p);
    makeDebris(prop.game, PROPS.melonChunk, p, 5, 15);
  },
};
PROPS.melonChunk = {
  id: 'melonChunk', name: 'Melon chunk', material: 'flesh', mass: 0.8, hidden: true,
  build: () => {
    const g = new THREE.Group();
    const rind = mat('melon', () => new THREE.MeshPhysicalMaterial({ map: TX.watermelon(), roughness: 0.35, clearcoat: 0.5 }));
    const flesh = mat('melonflesh', () => new THREE.MeshStandardMaterial({ color: 0xe0303f, roughness: 0.55 }));
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 8, 0, Math.PI, 0, Math.PI / 2), rind));
    const cap = new THREE.Mesh(new THREE.CircleGeometry(0.098, 16, 0, Math.PI), flesh);
    cap.rotation.x = -Math.PI / 2;
    g.add(cap);
    return { mesh: g, colliders: [cuboid(0.09, 0.045, 0.045, 0, 0.04, 0.045)] };
  },
};
PROPS.anvil = {
  id: 'anvil', name: 'Anvil', material: 'metal', mass: 110, size: 0.32, ccd: true, loud: 1.5,
  build: () => ({
    mesh: anvilModel(),
    colliders: [cuboid(0.18, 0.05, 0.11, 0, -0.12, 0), cuboid(0.1, 0.06, 0.065, 0, -0.01, 0), cuboid(0.21, 0.05, 0.1, -0.03, 0.1, 0), cuboid(0.1, 0.035, 0.05, 0.27, 0.11, 0)],
  }),
};
PROPS.brick = {
  id: 'brick', name: 'Brick', material: 'concrete', mass: 2.3, size: 0.065,
  build: () => ({ mesh: brickModel(), colliders: [cuboid(0.1075, 0.0325, 0.05125)] }),
};
PROPS.block = {
  id: 'block', name: 'Concrete block', material: 'concrete', mass: 380, size: 0.5,
  build: () => {
    const g = new THREE.Mesh(new RoundedBoxGeometry(1.0, 0.5, 0.5, 2, 0.02), concreteMat());
    return { mesh: g, colliders: [cuboid(0.5, 0.25, 0.25)] };
  },
};
PROPS.plank = {
  id: 'plank', name: 'Wooden plank', material: 'wood', mass: 9, size: 0.045,
  build: () => ({ mesh: new THREE.Mesh(new RoundedBoxGeometry(2.4, 0.045, 0.22, 1, 0.006), woodMat(15)), colliders: [cuboid(1.2, 0.0225, 0.11)] }),
};
PROPS.table = {
  id: 'table', name: 'Table', material: 'wood', mass: 24, size: 0.75,
  build: () => ({
    mesh: tableModel(),
    colliders: [cuboid(0.7, 0.025, 0.4, 0, 0.35, 0), ...[-0.62, 0.62].flatMap((x) => [-0.33, 0.33].map((z) => cuboid(0.03, 0.35, 0.03, x, -0.025, z)))],
  }),
};
PROPS.chair = {
  id: 'chair', name: 'Chair', material: 'wood', mass: 6, size: 0.5,
  build: () => ({
    mesh: chairModel(),
    colliders: [cuboid(0.225, 0.02, 0.225), ...[-0.19, 0.19].flatMap((x) => [-0.19, 0.19].map((z) => cuboid(0.02, 0.225, 0.02, x, -0.245, z))), cuboid(0.21, 0.25, 0.02, 0, 0.27, -0.19)],
  }),
};
PROPS.mattress = {
  id: 'mattress', name: 'Mattress', material: 'cloth', mass: 18, friction: 1.0, restitution: 0.35, size: 0.22,
  build: () => ({
    mesh: new THREE.Mesh(new RoundedBoxGeometry(1.9, 0.22, 0.9, 4, 0.07), mat('mattress', () => new THREE.MeshStandardMaterial({ map: TX.stripes(), roughness: 0.95, normalMap: TX.bumpNoise(256, 30, 2, 41) }))),
    colliders: [cuboid(0.95, 0.11, 0.45)],
  }),
};
PROPS.ibeam = {
  id: 'ibeam', name: 'Steel I-beam', material: 'metal', mass: 110, size: 0.3, loud: 1.4,
  build: () => ({ mesh: ibeamModel(), colliders: [cuboid(0.1, 0.008, 1.5, 0, 0.142, 0), cuboid(0.1, 0.008, 1.5, 0, -0.142, 0), cuboid(0.005, 0.135, 1.5)] }),
};
PROPS.domino = {
  id: 'domino', name: 'Giant domino', material: 'wood', mass: 6, size: 0.6, hidden: true,
  build: () => ({ mesh: dominoModel(), colliders: [cuboid(0.15, 0.3, 0.04)] }),
};
PROPS.balloon = {
  id: 'balloon', name: 'Balloon', material: 'rubber', mass: 0.05, health: 1, linearDamping: 2.5, angularDamping: 2, gravityScale: 0, size: 0.6,
  build: (opts) => {
    const color = opts.color ?? BALLOON_COLORS[Math.floor(Math.random() * BALLOON_COLORS.length)];
    return { mesh: balloonModel(color), colliders: [{ desc: R.ColliderDesc.ball(0.24) }] };
  },
  prePhysics: (prop, dt) => {
    // buoyancy aims for a gentle rise speed; a held-down balloon pulls with up to 80 N
    // (about nine balloons lift a person)
    const vy = prop.body.linvel().y;
    const f = 80 * Math.min(1, Math.max(0, (1.6 - vy) / 1.6));
    prop.body.applyImpulse({ x: 0, y: f * dt, z: 0 }, true);
  },
  onBreak: (prop, p) => {
    prop.game.audio?.gunshot('pistol', p);
    prop.game.fx?.poof(p, 0.4);
  },
};
