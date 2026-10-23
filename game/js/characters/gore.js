// Dismemberment visuals: splitting a character's skinned mesh at a joint, capping both
// wounds with a cross-section (skin, fat, muscle, bone), and the organs inside the torso.
import * as THREE from 'three';
import { B, BONE_COUNT, PARENT } from './skeleton.js';
import { bumpNoise } from '../engine/textures.js';

/** Mask of a bone and everything below it in the hierarchy. */
export function subtreeMask(bone) {
  const m = new Uint8Array(BONE_COUNT);
  m[bone] = 1;
  // PARENT is ordered parent-before-child, so one pass reaches every descendant
  for (let i = 0; i < BONE_COUNT; i++) if (PARENT[i] >= 0 && m[PARENT[i]]) m[i] = 1;
  return m;
}

let assets = null;
function capAssets() {
  if (assets) return assets;
  // dome cap: the upper half of a sphere, flattened per use; colours run from the rim inwards
  const dome = new THREE.SphereGeometry(1, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  const p = dome.attributes.position;
  const col = new Float32Array(p.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const r = Math.hypot(x, z);
    const n = Math.sin(x * 23.1 + z * 17.3) * Math.sin(x * 9.7 - z * 13.9 + y * 5.0);
    if (r > 0.95) c.setRGB(0.3, 0.04, 0.04); // torn skin edge
    else if (r > 0.86) c.setRGB(0.78, 0.55, 0.27); // fat
    else c.setRGB(0.4 + n * 0.07, 0.035 + n * 0.015, 0.035 + n * 0.015); // muscle
    col.set([c.r, c.g, c.b], i * 3);
  }
  dome.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const bone = new THREE.CylinderGeometry(1, 1.08, 1, 12).translate(0, 0.5, 0);
  // spongy marrow on the end of the bone
  const marrow = new THREE.CircleGeometry(0.62, 12).rotateX(-Math.PI / 2).translate(0, 1.001, 0);
  assets = {
    dome,
    bone,
    marrow,
    meat: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0 }),
    boneMat: new THREE.MeshStandardMaterial({ color: 0xe8dfc9, roughness: 0.55 }),
    marrowMat: new THREE.MeshStandardMaterial({ color: 0x8a2a22, roughness: 0.7 }),
    plastic: new THREE.MeshStandardMaterial({ color: 0x3b3b3e, roughness: 0.65, metalness: 0.1 }),
  };
  return assets;
}

/**
 * A wound cap facing +Y with the given radius. Dummies get a plain plastic cross-section.
 */
export function makeCap(radius, dummy = false) {
  const a = capAssets();
  const g = new THREE.Group();
  const dome = new THREE.Mesh(a.dome, dummy ? a.plastic : a.meat);
  dome.scale.set(radius, radius * 0.3, radius);
  g.add(dome);
  if (!dummy) {
    const br = Math.min(0.3 * radius, 0.017);
    const len = radius * 0.3 + 0.006 + Math.random() * 0.012;
    const bone = new THREE.Mesh(a.bone, a.boneMat);
    bone.scale.set(br, len, br);
    const marrow = new THREE.Mesh(a.marrow, a.marrowMat);
    marrow.scale.set(br, len, br);
    g.add(bone, marrow);
  }
  return g;
}

const _a = new THREE.Vector3();

/**
 * Split the skinned mesh where the subtree in `mask` meets the rest of the body. Every vertex
 * goes wholly with the side that carries most of its skin weight and triangles that straddle
 * the cut are dropped. Returns the bind-space centre and radius of the opening on each side
 * (radius measured perpendicular to `axis`), or null for a side without an opening.
 */
export function splitMesh(ch, mask, axis) {
  const tpl = ch.template;
  const geo = ch.geometry;
  if (!ch.ownSkin) {
    // the template's skinning and index buffers are shared between people: copy before editing
    geo.setAttribute('skinIndex', new THREE.BufferAttribute(tpl.skinIndexAttr.array.slice(), 4));
    geo.setAttribute('skinWeight', new THREE.BufferAttribute(tpl.skinWeightAttr.array.slice(), 4));
    geo.setIndex(new THREE.BufferAttribute(tpl.indexAttr.array.slice(), 1));
    geo.setDrawRange(0, tpl.indexAttr.count);
    ch.ownSkin = true;
  }
  const si = geo.attributes.skinIndex.array;
  const sw = geo.attributes.skinWeight.array;
  const pos = geo.attributes.position.array;
  const n = tpl.vertexCount;
  const side = new Uint8Array(n);
  for (let v = 0; v < n; v++) {
    let w = 0;
    for (let k = 0; k < 4; k++) if (mask[si[v * 4 + k]]) w += sw[v * 4 + k];
    const s = w > 0.5 ? 1 : 0;
    side[v] = s;
    let tot = 0;
    for (let k = 0; k < 4; k++) {
      if (mask[si[v * 4 + k]] !== s) sw[v * 4 + k] = 0;
      tot += sw[v * 4 + k];
    }
    if (tot > 0) for (let k = 0; k < 4; k++) sw[v * 4 + k] /= tot;
  }
  geo.attributes.skinWeight.needsUpdate = true;

  const idx = geo.index.array;
  const count = geo.drawRange.count === Infinity ? geo.index.count : Math.min(geo.drawRange.count, geo.index.count);
  const ring = [new Set(), new Set()];
  let w = 0;
  for (let i = 0; i < count; i += 3) {
    const a = idx[i], b = idx[i + 1], c = idx[i + 2];
    if (side[a] === side[b] && side[b] === side[c]) {
      idx[w++] = a;
      idx[w++] = b;
      idx[w++] = c;
    } else {
      for (const v of [a, b, c]) ring[side[v]].add(v);
    }
  }
  geo.setDrawRange(0, w);
  geo.index.needsUpdate = true;

  const ax = _a.set(axis[0], axis[1], axis[2]).normalize();
  return ring.map((set) => {
    if (set.size < 3) return null;
    const c = new THREE.Vector3();
    for (const v of set) c.add(new THREE.Vector3(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]));
    c.multiplyScalar(1 / set.size);
    let r = 0;
    const d = new THREE.Vector3();
    for (const v of set) {
      d.set(pos[v * 3] - c.x, pos[v * 3 + 1] - c.y, pos[v * 3 + 2] - c.z);
      d.addScaledVector(ax, -d.dot(ax));
      r += d.length();
    }
    return { center: c, radius: (r / set.size) * 1.08 };
  });
}

// ------------------------------------------------------------------ organs
const organMats = {};
/** Wet, glossy tissue. */
export function wetMaterial(color) {
  return (organMats[color] ??= new THREE.MeshPhysicalMaterial({
    color, roughness: 0.38, clearcoat: 0.9, clearcoatRoughness: 0.2, normalMap: bumpNoise(128, 18, 1.4, 61), normalScale: new THREE.Vector2(0.6, 0.6),
  }));
}

/** A lumpy ellipsoid: a sphere pushed in and out by a few low-frequency waves. */
export function blobGeometry(rx, ry, rz, lump = 0.12, detail = 18) {
  const g = new THREE.SphereGeometry(1, detail + 6, detail);
  const p = g.attributes.position;
  const a = Math.random() * 6, b = Math.random() * 6;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + lump * (Math.sin(x * 3.1 + a) * Math.sin(y * 2.7 + b) + 0.5 * Math.sin(z * 4.3 + a + b));
    p.setXYZ(i, x * rx * k, y * ry * k, z * rz * k);
  }
  g.computeVertexNormals();
  return g;
}

/** Intestines: a tube wandering about inside an ellipsoid, folding back on itself. */
export function gutCoilGeometry(rx, ry, rz, tube = 0.0145, steps = 70) {
  const pts = [];
  const p = new THREE.Vector3((Math.random() - 0.5) * rx, (Math.random() - 0.5) * ry, 0);
  const d = new THREE.Vector3(1, 0, 0);
  const r = new THREE.Vector3();
  for (let i = 0; i < steps; i++) {
    d.add(r.set(Math.random() - 0.5, (Math.random() - 0.5) * 0.6, Math.random() - 0.5).multiplyScalar(0.9)).normalize();
    p.addScaledVector(d, 0.022);
    // steer back inside the volume
    const e = (p.x / rx) ** 2 + (p.y / ry) ** 2 + (p.z / rz) ** 2;
    if (e > 1) d.lerp(r.set(-p.x / rx, -p.y / ry, -p.z / rz).normalize(), 0.6).normalize();
    pts.push(p.clone());
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), steps * 3, tube, 8);
}

const ORGAN = { lung: 0xd9868c, heart: 0x6c0e15, liver: 0x4a0f0f, stomach: 0xc4847a, gut: 0xcf8580 };

/**
 * Put organs inside a character's torso, parented to the bones so they move with the body.
 * Cheap enough to add only once someone is opened up.
 */
export function addOrgans(ch, sk) {
  if (ch.organs) return ch.organs;
  const j = sk.j;
  const p = sk.params;
  const C = sk.centers;
  const g = Math.sqrt(p.girth);
  const sw = p.shoulder;
  const w = Math.sqrt(p.waist * p.girth);
  const list = [];
  const place = (geo, color, bone, pos, rot = null) => {
    const m = new THREE.Mesh(geo, wetMaterial(color));
    m.position.set(pos[0] - C[bone][0], pos[1] - C[bone][1], pos[2] - C[bone][2]);
    if (rot) m.rotation.set(...rot);
    ch.bones[bone].add(m);
    list.push(m);
    return m;
  };
  const cc = j.chestC;
  for (const s of [-1, 1]) place(blobGeometry(0.05 * sw, 0.088, 0.056 * g, 0.08), ORGAN.lung, B.CHEST, [s * 0.06 * sw, cc[1] + 0.005, cc[2] - 0.01]);
  place(blobGeometry(0.036, 0.048, 0.035, 0.1), ORGAN.heart, B.CHEST, [0.02, cc[1] - 0.035, cc[2] + 0.035], [0, 0, 0.45]);
  const cj = j.chestJ;
  place(blobGeometry(0.072 * g, 0.036, 0.052 * g, 0.1), ORGAN.liver, B.SPINE, [-0.035, cj[1] + 0.0, cj[2] + 0.015], [0, 0, -0.2]);
  place(blobGeometry(0.048, 0.034, 0.034, 0.15), ORGAN.stomach, B.SPINE, [0.045, cj[1] - 0.012, cj[2] + 0.03], [0, 0, 0.5]);
  // the gut fills the belly from below the stomach down into the pelvis
  place(gutCoilGeometry(0.068 * w, 0.045, 0.05 * w), ORGAN.gut, B.SPINE, [0, j.waist[1] + 0.05, j.waist[2] + 0.025]);
  place(gutCoilGeometry(0.07 * w, 0.04, 0.05 * w), ORGAN.gut, B.PELVIS, [0, j.waist[1] - 0.01, j.waist[2] + 0.025]);
  for (const m of list) m.castShadow = false;
  ch.organs = list;
  return list;
}

/** A bare piece of spine sticking out of a wound, along +Y. */
export function vertebraStub(radius = 0.018) {
  const a = capAssets();
  const g = new THREE.Group();
  const len = 0.025 + Math.random() * 0.02;
  const bone = new THREE.Mesh(a.bone, a.boneMat);
  bone.scale.set(radius, len, radius);
  const marrow = new THREE.Mesh(a.marrow, a.marrowMat);
  marrow.scale.set(radius, len, radius);
  g.add(bone, marrow);
  return g;
}

export const GUT_COLOR = ORGAN.gut;
