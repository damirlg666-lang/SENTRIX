// Geometry helpers shared by the map, props and weapon models.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Merge geometries regardless of indexing; keeps only the attributes every input has
 * (position/normal/uv/color).
 */
export function merge(geos) {
  const list = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  const names = ['position', 'normal', 'uv', 'color'].filter((n) => list.every((g) => g.attributes[n]));
  const clean = list.map((g) => {
    const out = new THREE.BufferGeometry();
    for (const n of names) out.setAttribute(n, g.attributes[n]);
    return out;
  });
  const m = mergeGeometries(clean);
  return m;
}

/** Paint a constant vertex color on a geometry (adds a color attribute). */
export function tint(geo, color) {
  const c = new THREE.Color(color);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}
