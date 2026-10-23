// Destructible buildings: stacks of separate wall blocks, pillars, slabs, planks and glass.
// Pieces spawn asleep so the structure stands until it is hit; a broken piece splits into
// smaller pieces (and eventually rubble), and wakes the rest of the building so whatever it
// was holding up comes down.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { R } from '../engine/physics.js';
import * as TX from '../engine/textures.js';
import { Group } from '../entities/group.js';

const MATS = {};
const MAT = {
  plaster: {
    name: 'Wall', material: 'concrete', density: 1300, toughness: 2600, fragile: 10, dust: [0.75, 0.72, 0.66],
    make: () => new THREE.MeshStandardMaterial({ color: 0xe6ddcc, roughness: 0.92, normalMap: TX.bumpNoise(256, 24, 1.6, 71), normalScale: new THREE.Vector2(0.7, 0.7) }),
  },
  concrete: {
    name: 'Concrete', material: 'concrete', density: 1400, toughness: 3000, fragile: 11, dust: [0.6, 0.6, 0.58],
    make: () => {
      const c = TX.concrete(1024);
      return new THREE.MeshStandardMaterial({ map: c.map, normalMap: c.normalMap, roughnessMap: c.roughnessMap, roughness: 1, color: 0xe2ded6 });
    },
  },
  roof: {
    name: 'Roof slab', material: 'concrete', density: 1300, toughness: 2600, fragile: 10, dust: [0.5, 0.5, 0.5],
    make: () => new THREE.MeshStandardMaterial({ color: 0x55585e, roughness: 0.85, normalMap: TX.bumpNoise(256, 30, 2, 72) }),
  },
  wood: {
    name: 'Plank', material: 'wood', density: 600, toughness: 900, fragile: 13, dust: [0.55, 0.42, 0.28], flammable: 1,
    make: () => {
      const w = TX.woodPlanks(512, 1, 31);
      return new THREE.MeshStandardMaterial({ map: w.map, normalMap: w.normalMap, roughnessMap: w.roughnessMap, roughness: 1, color: 0xb88a5e });
    },
  },
  glass: {
    name: 'Window', material: 'glass', density: 2500, toughness: 0, fragile: 1.6, dust: [0.85, 0.9, 0.95],
    make: () => new THREE.MeshPhysicalMaterial({ color: 0xcfe8ff, transparent: true, opacity: 0.28, roughness: 0.04, metalness: 0, clearcoat: 1, depthWrite: false }),
  },
};
const material = (m) => (MATS[m] ??= MAT[m].make());

const geos = new Map();
function boxGeo(w, h, d) {
  const k = `${w.toFixed(3)}|${h.toFixed(3)}|${d.toFixed(3)}`;
  if (!geos.has(k)) geos.set(k, new RoundedBoxGeometry(w, h, d, 1, Math.min(0.012, w * 0.1, h * 0.1, d * 0.1)));
  return geos.get(k);
}

const defs = new Map();
/** Prop definition for one building piece of a material and size (cached). */
export function pieceDef(mat, w, h, d) {
  const k = `${mat}|${w.toFixed(3)}|${h.toFixed(3)}|${d.toFixed(3)}`;
  if (defs.has(k)) return defs.get(k);
  const M = MAT[mat];
  const vol = w * h * d;
  const def = {
    id: 'piece', name: M.name, material: M.material, hidden: true,
    mass: Math.min(500, Math.max(0.5, vol * M.density)),
    health: mat === 'glass' ? 4 : Math.min(900, 30 + vol * M.toughness),
    fragile: M.fragile, friction: 1, restitution: 0.02, size: h,
    flammable: M.flammable, fuel: 18,
    piece: { mat, w, h, d },
    build: () => {
      const mesh = new THREE.Mesh(boxGeo(w, h, d), material(mat));
      mesh.userData.sharedGeometry = true;
      if (mat === 'glass') mesh.userData.noShadow = true;
      return { mesh, colliders: [{ desc: R.ColliderDesc.cuboid(w / 2, h / 2, d / 2) }] };
    },
    onBreak: (prop, p) => breakPiece(prop, p),
    onDestroy: (prop) => prop.group?.wake(),
  };
  defs.set(k, def);
  return def;
}

const RUBBLE = {
  id: 'rubble', name: 'Rubble', material: 'concrete', mass: 2, hidden: true, friction: 1, restitution: 0.05,
  build: (o) => {
    const s = o.size ?? 0.1;
    const g = new THREE.DodecahedronGeometry(s, 0);
    g.scale(1, 0.6 + Math.random() * 0.4, 0.8 + Math.random() * 0.4);
    return { mesh: new THREE.Mesh(g, material(o.mat ?? 'concrete')), colliders: [{ desc: R.ColliderDesc.ball(s * 0.75) }] };
  },
};

/** A broken piece splits along its longest side into smaller pieces; small ones crumble. */
function breakPiece(prop, p) {
  const game = prop.game;
  const { mat, w, h, d } = prop.def.piece;
  const M = MAT[mat];
  const up = new THREE.Vector3(0, 1, 0);
  game.fx?.dust(p, up, mat === 'glass' ? 2 : 8, M.dust);
  game.fx?.debris(p, up, mat === 'glass' ? 18 : 12, M.dust);
  game.audio?.impact(M.material === 'concrete' ? 'concrete' : M.material, 1, p);
  if (mat === 'glass') {
    for (let i = 0; i < 24; i++) {
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.6, Math.random() - 0.5).normalize().multiplyScalar(2 + Math.random() * 3);
      game.fx?.streaks.add({ x: p.x + (Math.random() - 0.5) * w, y: p.y + (Math.random() - 0.5) * h, z: p.z, vx: v.x, vy: v.y, vz: v.z, life: 0.6 + Math.random() * 0.5, color: [0.7, 0.85, 1], intensity: 1.2, len: 0.05, floor: p.y - h });
    }
    return;
  }
  const { Prop } = game.classes;
  const r = prop.body.rotation();
  const q = new THREE.Quaternion(r.x, r.y, r.z, r.w);
  const v = prop.body.linvel();
  const dims = [w, h, d];
  const ax = dims.indexOf(Math.max(...dims));
  const add = (e) => {
    game.add(e, false);
    prop.group?.add(e);
    return e;
  };
  if (dims[ax] > 0.4) {
    const n = dims[ax] > 1.2 ? 3 : 2;
    let start = -dims[ax] / 2;
    for (let i = 0; i < n; i++) {
      const len = i === n - 1 ? dims[ax] / 2 - start : (dims[ax] / n) * (0.75 + Math.random() * 0.5);
      const sub = dims.slice();
      sub[ax] = len;
      const off = new THREE.Vector3();
      off.setComponent(ax, start + len / 2);
      off.applyQuaternion(q);
      // small leftovers fade out after a while so the scene does not fill up with them
      const opts = Math.max(...sub) < 0.7 ? { lifetime: 35 + Math.random() * 15 } : {};
      const piece = add(new Prop(game, pieceDef(mat, sub[0], sub[1], sub[2]), new THREE.Vector3(p.x, p.y, p.z).add(off), q, opts));
      piece.body.setLinvel({ x: v.x + (Math.random() - 0.5) * 1.5, y: v.y + Math.random() * 1.2, z: v.z + (Math.random() - 0.5) * 1.5 }, true);
      start += len;
    }
  } else {
    for (let i = 0; i < 3; i++) {
      const s = Math.min(0.12, dims[ax] * 0.35) * (0.6 + Math.random() * 0.5);
      const c = add(new Prop(game, RUBBLE, new THREE.Vector3(p.x + (Math.random() - 0.5) * w, p.y + (Math.random() - 0.5) * h, p.z + (Math.random() - 0.5) * d), q, { size: s, mat, lifetime: 18 + Math.random() * 10 }));
      c.body.setLinvel({ x: v.x + (Math.random() - 0.5) * 2, y: v.y + Math.random() * 2, z: v.z + (Math.random() - 0.5) * 2 }, true);
    }
  }
  prop.group?.wake();
}

// ------------------------------------------------------------------ layouts
/**
 * A masonry wall along one axis: rows of blocks in running bond, with openings cut out.
 * `along` is 'x' or 'z'; s0..s1 is the span along that axis; `at` the wall's position across.
 */
function wall(out, mat, along, s0, s1, at, y0, rowH, t, openings, row, blockLen = 1) {
  const len = s1 - s0;
  const n = Math.max(1, Math.round(len / blockLen));
  const bw = len / n;
  const cuts = [s0];
  for (let s = s0 + (row % 2 ? bw / 2 : bw); s < s1 - 0.05; s += bw) cuts.push(s);
  cuts.push(s1);
  let segs = [];
  for (let i = 0; i < cuts.length - 1; i++) segs.push([cuts[i], cuts[i + 1]]);
  for (const o of openings) {
    if (row < o.r0 || row > o.r1) continue;
    const next = [];
    for (const [a, b] of segs) {
      if (b <= o.a || a >= o.b) next.push([a, b]);
      else {
        if (o.a - a > 0.1) next.push([a, o.a]);
        if (b - o.b > 0.1) next.push([o.b, b]);
      }
    }
    segs = next;
  }
  const y = y0 + rowH / 2;
  for (const [a, b] of segs) {
    const c = (a + b) / 2;
    const l = b - a;
    if (along === 'x') out.push({ def: pieceDef(mat, l, rowH, t), p: [c, y, at] });
    else out.push({ def: pieceDef(mat, t, rowH, l), p: [at, y, c] });
  }
}

function houseLayout() {
  const out = [];
  const W = 4.2, D = 3.4, t = 0.2, rowH = 0.5, rows = 5;
  const front = [{ a: -0.5, b: 0.5, r0: 0, r1: 3 }, { a: -1.65, b: -0.95, r0: 2, r1: 3 }, { a: 0.95, b: 1.65, r0: 2, r1: 3 }];
  const back = [{ a: -0.45, b: 0.45, r0: 2, r1: 3 }];
  const side = [{ a: -0.45, b: 0.45, r0: 2, r1: 3 }];
  for (let r = 0; r < rows; r++) {
    // corners interlock: the long walls run full width on even rows, the side walls on odd rows
    const fx = r % 2 ? W / 2 - t : W / 2;
    const sz = r % 2 ? D / 2 : D / 2 - t;
    wall(out, 'plaster', 'x', -fx, fx, D / 2 - t / 2, r * rowH, rowH, t, front, r);
    wall(out, 'plaster', 'x', -fx, fx, -D / 2 + t / 2, r * rowH, rowH, t, back, r);
    wall(out, 'plaster', 'z', -sz, sz, W / 2 - t / 2, r * rowH, rowH, t, side, r, 0.9);
    wall(out, 'plaster', 'z', -sz, sz, -W / 2 + t / 2, r * rowH, rowH, t, side, r, 0.9);
  }
  // glass in every window
  for (const [a, b] of [[-1.65, -0.95], [0.95, 1.65]]) out.push({ def: pieceDef('glass', b - a - 0.02, 0.98, 0.025), p: [(a + b) / 2, 1.5, D / 2 - t / 2] });
  out.push({ def: pieceDef('glass', 0.88, 0.98, 0.025), p: [0, 1.5, -D / 2 + t / 2] });
  for (const x of [W / 2 - t / 2, -W / 2 + t / 2]) out.push({ def: pieceDef('glass', 0.025, 0.98, 0.88), p: [x, 1.5, 0] });
  // flat roof in two slabs
  for (const s of [-1, 1]) out.push({ def: pieceDef('roof', W / 2 + 0.1, 0.18, D + 0.25), p: [s * (W / 4 + 0.05), rows * rowH + 0.09, 0] });
  return out;
}

function shedLayout() {
  const out = [];
  const W = 3.0, D = 2.4, t = 0.05, rowH = 0.24, rows = 8;
  const door = [{ a: -0.45, b: 0.45, r0: 0, r1: 6 }];
  for (let r = 0; r < rows; r++) {
    const fx = r % 2 ? W / 2 - t : W / 2;
    const sz = r % 2 ? D / 2 : D / 2 - t;
    wall(out, 'wood', 'x', -fx, fx, D / 2 - t / 2, r * rowH, rowH, t, door, r, 3);
    wall(out, 'wood', 'x', -fx, fx, -D / 2 + t / 2, r * rowH, rowH, t, [], r, 3);
    wall(out, 'wood', 'z', -sz, sz, W / 2 - t / 2, r * rowH, rowH, t, [], r, 3);
    wall(out, 'wood', 'z', -sz, sz, -W / 2 + t / 2, r * rowH, rowH, t, [], r, 3);
  }
  const top = rows * rowH;
  for (let i = 0; i < 5; i++) out.push({ def: pieceDef('wood', W + 0.3, 0.05, (D + 0.3) / 5 - 0.01), p: [0, top + 0.025, -(D + 0.3) / 2 + ((i + 0.5) * (D + 0.3)) / 5] });
  return out;
}

function towerLayout() {
  const out = [];
  const levels = 3, ph = 1.8, slab = 0.18, half = 1.05;
  for (let l = 0; l < levels; l++) {
    const y0 = l * (ph + slab);
    for (const x of [-half, half]) for (const z of [-half, half]) out.push({ def: pieceDef('concrete', 0.28, ph, 0.28), p: [x, y0 + ph / 2, z] });
    out.push({ def: pieceDef('concrete', 2.7, slab, 2.7), p: [0, y0 + ph + slab / 2, 0] });
  }
  return out;
}

function building(id, name, layout, box, desc) {
  return {
    id, name, desc, height: box[1], ghostBox: box,
    spawn(game, point, yaw) {
      const { Prop } = game.classes;
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      const group = game.add(new Group(game, name));
      for (const e of layout()) {
        const p = new THREE.Vector3(...e.p).applyQuaternion(q).add(point);
        p.y += 0.004;
        group.add(game.add(new Prop(game, e.def, p, q, { sleeping: true }), false));
      }
      return group;
    },
    /** Static model for the menu thumbnail. */
    model() {
      const g = new THREE.Group();
      for (const e of layout()) {
        const m = e.def.build({}).mesh;
        m.position.set(...e.p);
        g.add(m);
      }
      return g;
    },
  };
}

export const BUILDINGS = [
  building('house', 'House', houseLayout, [4.2, 2.7, 3.6], 'Shoot it, blow it up'),
  building('shed', 'Wooden shed', shedLayout, [3.3, 2.0, 2.7], 'Burns well'),
  building('tower', 'Watchtower', towerLayout, [2.7, 6, 2.7], 'Take out a pillar'),
];
