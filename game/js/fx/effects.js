// Visual effects: sprite particles, spark/tracer streaks and pooled decals.
import * as THREE from 'three';
import * as TX from '../engine/textures.js';
import { GROUPS } from '../engine/physics.js';

const TILE = { SMOKE: 0, FIRE: 4, GLOW: 8, BLOB: 12 };

const PARTICLE_VS = /* glsl */ `
attribute vec4 aColor;
attribute float aSize;
attribute float aTile;
attribute float aRot;
uniform float uScale;
varying vec4 vColor;
varying float vTile;
varying float vRot;
#include <fog_pars_vertex>
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  gl_PointSize = aSize * uScale / max(0.05, -mvPosition.z);
  vColor = aColor;
  vTile = aTile;
  vRot = aRot;
  #include <fog_vertex>
}`;

const PARTICLE_FS = /* glsl */ `
uniform sampler2D uAtlas;
varying vec4 vColor;
varying float vTile;
varying float vRot;
#include <fog_pars_fragment>
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float c = cos(vRot), s = sin(vRot);
  p = vec2(c * p.x - s * p.y, s * p.x + c * p.y) + 0.5;
  if (p.x < 0.0 || p.y < 0.0 || p.x > 1.0 || p.y > 1.0) discard;
  float t = floor(vTile + 0.5);
  vec2 uv = (vec2(mod(t, 4.0), 3.0 - floor(t / 4.0)) + vec2(p.x, 1.0 - p.y)) * 0.25;
  vec4 tex = texture2D(uAtlas, uv);
  gl_FragColor = vec4(vColor.rgb * tex.rgb, vColor.a * tex.a);
  if (gl_FragColor.a < 0.003) discard;
  #include <fog_fragment>
}`;

class ParticlePool {
  constructor(scene, max, blending) {
    this.max = max;
    this.count = 0;
    this.p = [];
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.tile = new Float32Array(max);
    this.rot = new Float32Array(max);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aTile', new THREE.BufferAttribute(this.tile, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aRot', new THREE.BufferAttribute(this.rot, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, 0);
    this.geo = geo;
    this.mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uAtlas: { value: TX.particleAtlas() }, uScale: { value: 400 } }]),
      vertexShader: PARTICLE_VS,
      fragmentShader: PARTICLE_FS,
      transparent: true,
      depthWrite: false,
      blending,
      fog: true,
    });
    this.mat.uniforms.uAtlas.value = TX.particleAtlas();
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = blending === THREE.AdditiveBlending ? 3 : 2;
    scene.add(this.points);
  }

  add(o) {
    if (this.p.length >= this.max) this.p.shift();
    o.age = 0;
    o.rot = o.rot ?? Math.random() * Math.PI * 2;
    o.spin = o.spin ?? (Math.random() - 0.5) * 2;
    o.drag = o.drag ?? 0.5;
    o.grav = o.grav ?? 0;
    o.size1 = o.size1 ?? o.size0;
    o.a0 = o.a0 ?? 1;
    o.col1 = o.col1 ?? o.col0;
    this.p.push(o);
    return o;
  }

  update(dt) {
    const keep = [];
    for (const o of this.p) {
      o.age += dt;
      if (o.age >= o.life) continue;
      const k = Math.exp(-o.drag * dt);
      o.vx *= k;
      o.vy = o.vy * k - o.grav * dt;
      o.vz *= k;
      o.x += o.vx * dt;
      o.y += o.vy * dt;
      o.z += o.vz * dt;
      if (o.floor !== undefined && o.y < o.floor) {
        o.y = o.floor;
        o.vy *= -0.2;
        o.vx *= 0.5;
        o.vz *= 0.5;
      }
      o.rot += o.spin * dt;
      keep.push(o);
    }
    this.p = keep;
    const n = keep.length;
    for (let i = 0; i < n; i++) {
      const o = keep[i];
      const t = o.age / o.life;
      this.pos[i * 3] = o.x;
      this.pos[i * 3 + 1] = o.y;
      this.pos[i * 3 + 2] = o.z;
      const c0 = o.col0;
      const c1 = o.col1;
      this.col[i * 4] = c0[0] + (c1[0] - c0[0]) * t;
      this.col[i * 4 + 1] = c0[1] + (c1[1] - c0[1]) * t;
      this.col[i * 4 + 2] = c0[2] + (c1[2] - c0[2]) * t;
      const fadeIn = o.fadeIn ? Math.min(1, o.age / o.fadeIn) : 1;
      this.col[i * 4 + 3] = o.a0 * fadeIn * (1 - Math.pow(t, o.fadePow ?? 1.5));
      this.size[i] = o.size0 + (o.size1 - o.size0) * Math.sqrt(t);
      this.tile[i] = o.tile;
      this.rot[i] = o.rot;
    }
    this.geo.setDrawRange(0, n);
    for (const k of ['position', 'aColor', 'aSize', 'aTile', 'aRot']) this.geo.attributes[k].needsUpdate = true;
  }

  clear() {
    this.p.length = 0;
  }
}

/** Velocity-aligned glowing streaks (sparks, tracers). */
class StreakPool {
  constructor(scene, max) {
    this.max = max;
    this.s = [];
    this.pos = new Float32Array(max * 6);
    this.col = new Float32Array(max * 6);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, 0);
    this.geo = geo;
    const mat = new THREE.LineBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false });
    this.lines = new THREE.LineSegments(geo, mat);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 4;
    scene.add(this.lines);
  }

  add(o) {
    if (this.s.length >= this.max) this.s.shift();
    o.age = 0;
    this.s.push(o);
  }

  update(dt) {
    const keep = [];
    for (const o of this.s) {
      o.age += dt;
      if (o.age >= o.life) continue;
      if (!o.tracer) {
        o.vy -= (o.grav ?? 9.8) * dt;
        o.x += o.vx * dt;
        o.y += o.vy * dt;
        o.z += o.vz * dt;
        if (o.floor !== undefined && o.y < o.floor) {
          o.y = o.floor;
          o.vy = Math.abs(o.vy) * 0.35;
          o.vx *= 0.6;
          o.vz *= 0.6;
        }
      }
      keep.push(o);
    }
    this.s = keep;
    for (let i = 0; i < keep.length; i++) {
      const o = keep[i];
      const t = o.age / o.life;
      const fade = 1 - t;
      let ax, ay, az, bx, by, bz;
      if (o.tracer) {
        // a short bright segment travelling from muzzle to hit point
        const head = Math.min(1, t * o.speedFrac + 0.15);
        const tail = Math.max(0, head - 0.35);
        ax = o.x + (o.ex - o.x) * tail;
        ay = o.y + (o.ey - o.y) * tail;
        az = o.z + (o.ez - o.z) * tail;
        bx = o.x + (o.ex - o.x) * head;
        by = o.y + (o.ey - o.y) * head;
        bz = o.z + (o.ez - o.z) * head;
      } else {
        const L = o.len ?? 0.05;
        const sp = Math.hypot(o.vx, o.vy, o.vz) || 1;
        ax = o.x;
        ay = o.y;
        az = o.z;
        bx = o.x - (o.vx / sp) * L * Math.min(1, sp / 6);
        by = o.y - (o.vy / sp) * L * Math.min(1, sp / 6);
        bz = o.z - (o.vz / sp) * L * Math.min(1, sp / 6);
      }
      this.pos.set([ax, ay, az, bx, by, bz], i * 6);
      const c = o.color;
      const k = fade * (o.intensity ?? 1);
      this.col.set([c[0] * k, c[1] * k, c[2] * k, c[0] * k * 0.4, c[1] * k * 0.4, c[2] * k * 0.4], i * 6);
    }
    this.geo.setDrawRange(0, keep.length * 2);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }

  clear() {
    this.s.length = 0;
  }
}

/** Ring-buffer of decal quads drawn with one InstancedMesh. */
class DecalPool {
  constructor(scene, max, material, atlas = 1) {
    this.max = max;
    this.next = 0;
    this.count = 0;
    const geo = new THREE.PlaneGeometry(1, 1);
    this.tiles = new Float32Array(max * 2);
    geo.setAttribute('aTile', new THREE.InstancedBufferAttribute(this.tiles, 2));
    this.atlas = atlas;
    if (atlas > 1) {
      material.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nattribute vec2 aTile;')
          .replace('#include <uv_vertex>', `#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv = vMapUv / ${atlas.toFixed(1)} + aTile;\n#endif`);
      };
    }
    this.mesh = new THREE.InstancedMesh(geo, material, max);
    this.mesh.count = 0;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._z = new THREE.Vector3(0, 0, 1);
    this._q2 = new THREE.Quaternion();
  }

  add(point, normal, size, tile = 0, rot = Math.random() * Math.PI * 2) {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    this.count = Math.min(this.max, this.count + 1);
    this._q.setFromUnitVectors(this._z, normal);
    this._q2.setFromAxisAngle(this._z, rot);
    this._q.multiply(this._q2);
    const p = point.clone().addScaledVector(normal, 0.004 + Math.random() * 0.002);
    this._m.compose(p, this._q, new THREE.Vector3(size, size, size));
    this.mesh.setMatrixAt(i, this._m);
    if (this.atlas > 1) {
      this.tiles[i * 2] = (tile % this.atlas) / this.atlas;
      this.tiles[i * 2 + 1] = Math.floor(tile / this.atlas) / this.atlas;
      this.mesh.geometry.attributes.aTile.needsUpdate = true;
    }
    this.mesh.count = this.count;
    this.mesh.instanceMatrix.needsUpdate = true;
    return i;
  }

  /** Grow a decal in place (blood pools). */
  setScale(i, point, normal, size, rot) {
    this._q.setFromUnitVectors(this._z, normal);
    this._q2.setFromAxisAngle(this._z, rot);
    this._q.multiply(this._q2);
    this._m.compose(point.clone().addScaledVector(normal, 0.003), this._q, new THREE.Vector3(size, size, size));
    this.mesh.setMatrixAt(i, this._m);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear() {
    this.count = 0;
    this.next = 0;
    this.mesh.count = 0;
  }
}

const rnd = (a, b) => a + Math.random() * (b - a);

export class Effects {
  constructor(game) {
    this.game = game;
    const scene = game.scene;
    this.additive = new ParticlePool(scene, 2500, THREE.AdditiveBlending);
    this.alpha = new ParticlePool(scene, 2500, THREE.NormalBlending);
    this.streaks = new StreakPool(scene, 600);
    this.blood = new DecalPool(
      scene,
      320,
      new THREE.MeshStandardMaterial({
        map: TX.bloodDecals(), transparent: true, depthWrite: false, roughness: 0.18, metalness: 0,
        polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
      }),
      2
    );
    this.holes = new DecalPool(
      scene,
      240,
      new THREE.MeshStandardMaterial({
        map: TX.bulletHole(), transparent: true, depthWrite: false, roughness: 0.9,
        polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
      })
    );
    this.scorch = new DecalPool(
      scene,
      48,
      new THREE.MeshStandardMaterial({
        map: TX.scorchDecal(), transparent: true, depthWrite: false, roughness: 0.95,
        polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
      })
    );
    this.drops = []; // blood droplets that leave decals where they land
    this.pools = []; // growing blood pools under bleeding bodies
    this.rings = [];
    this.ringGeo = new THREE.RingGeometry(0.9, 1, 64).rotateX(-Math.PI / 2);
  }

  setPixelScale(h) {
    // point size scale so a size of 1 is ~1 metre
    const s = h * this.game.camera.projectionMatrix.elements[5] * 0.5;
    this.additive.mat.uniforms.uScale.value = s;
    this.alpha.mat.uniforms.uScale.value = s;
  }

  update(dt) {
    this.setPixelScale(this.game.gfx.renderer.domElement.height);
    this.additive.update(dt);
    this.alpha.update(dt);
    this.streaks.update(dt);
    this.updateDrops(dt);
    this.updatePools(dt);
    for (const r of [...this.rings]) {
      r.t += dt;
      const k = r.t / r.life;
      if (k >= 1) {
        this.game.scene.remove(r.mesh);
        r.mesh.material.dispose();
        this.rings.splice(this.rings.indexOf(r), 1);
        continue;
      }
      const s = r.r0 + (r.r1 - r.r0) * (1 - Math.pow(1 - k, 3));
      r.mesh.scale.set(s, 1, s);
      r.mesh.material.opacity = (1 - k) * 0.3;
    }
  }

  clearDecals() {
    this.blood.clear();
    this.holes.clear();
    this.scorch.clear();
    this.drops.length = 0;
    this.pools.length = 0;
    this.additive.clear();
    this.alpha.clear();
    this.streaks.clear();
  }

  // ---------------------------------------------------------------- primitives
  smoke(p, n = 6, opts = {}) {
    for (let i = 0; i < n; i++) {
      const g = opts.gray ?? rnd(0.35, 0.55);
      this.alpha.add({
        x: p.x + rnd(-0.1, 0.1) * (opts.spread ?? 1), y: p.y + rnd(0, 0.1), z: p.z + rnd(-0.1, 0.1) * (opts.spread ?? 1),
        vx: rnd(-0.6, 0.6) * (opts.speed ?? 1), vy: rnd(0.4, 1.4) * (opts.speed ?? 1), vz: rnd(-0.6, 0.6) * (opts.speed ?? 1),
        drag: 1.2, grav: -0.25, life: rnd(1.5, 3.5) * (opts.life ?? 1),
        size0: (opts.size ?? 0.5) * rnd(0.6, 1), size1: (opts.size ?? 0.5) * rnd(2.5, 4),
        col0: [g, g, g * 1.02], col1: [g * 0.8, g * 0.8, g * 0.82], a0: opts.alpha ?? 0.5, tile: TILE.SMOKE + Math.floor(Math.random() * 4),
        fadeIn: 0.15, fadePow: 1.2,
      });
    }
  }

  dust(p, normal, n = 6, color = [0.6, 0.58, 0.52]) {
    for (let i = 0; i < n; i++) {
      const sp = rnd(0.5, 2.2);
      this.alpha.add({
        x: p.x, y: p.y, z: p.z,
        vx: normal.x * sp + rnd(-0.8, 0.8), vy: normal.y * sp + rnd(0, 0.8), vz: normal.z * sp + rnd(-0.8, 0.8),
        drag: 3, grav: 0.3, life: rnd(0.6, 1.4), size0: rnd(0.06, 0.12), size1: rnd(0.35, 0.6),
        col0: color, col1: color, a0: 0.55, tile: TILE.SMOKE + Math.floor(Math.random() * 4), fadePow: 1,
      });
    }
  }

  sparks(p, normal, n = 10, speed = 6, color = [1, 0.75, 0.35]) {
    for (let i = 0; i < n; i++) {
      const d = new THREE.Vector3(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).normalize().addScaledVector(normal, 1.3).normalize();
      const s = speed * rnd(0.3, 1.2);
      this.streaks.add({
        x: p.x, y: p.y, z: p.z, vx: d.x * s, vy: d.y * s, vz: d.z * s,
        life: rnd(0.15, 0.5), color, intensity: 3, len: rnd(0.04, 0.1), floor: p.y - 2,
      });
    }
    this.additive.add({
      x: p.x + normal.x * 0.03, y: p.y + normal.y * 0.03, z: p.z + normal.z * 0.03, vx: 0, vy: 0, vz: 0,
      life: 0.07, size0: 0.25, size1: 0.1, col0: [1.6, 1.1, 0.6], tile: TILE.GLOW,
    });
  }

  debris(p, normal, n = 6, color = [0.45, 0.43, 0.4]) {
    for (let i = 0; i < n; i++) {
      const s = rnd(1.5, 4.5);
      this.alpha.add({
        x: p.x, y: p.y, z: p.z,
        vx: normal.x * s + rnd(-1.5, 1.5), vy: normal.y * s + rnd(0.5, 2.5), vz: normal.z * s + rnd(-1.5, 1.5),
        drag: 0.3, grav: 9.8, life: rnd(0.6, 1.4), size0: rnd(0.012, 0.03), size1: rnd(0.012, 0.03),
        col0: color, col1: color, a0: 1, tile: TILE.BLOB + Math.floor(Math.random() * 4), fadePow: 6, floor: p.y - 3, spin: rnd(-8, 8),
      });
    }
  }

  tracer(from, to, color = [1, 0.85, 0.55]) {
    const d = from.distanceTo(to);
    this.streaks.add({ tracer: true, x: from.x, y: from.y, z: from.z, ex: to.x, ey: to.y, ez: to.z, life: Math.min(0.09, 0.02 + d / 900), speedFrac: 1.6, color, intensity: 2.5 });
  }

  muzzleFlash(p, dir, scale = 1) {
    for (let i = 0; i < 3; i++) {
      const k = i * 0.08 * scale;
      this.additive.add({
        x: p.x + dir.x * k, y: p.y + dir.y * k, z: p.z + dir.z * k, vx: dir.x * 2, vy: dir.y * 2, vz: dir.z * 2,
        life: 0.05, size0: (0.28 - i * 0.06) * scale, size1: (0.2 - i * 0.05) * scale, col0: [2.2, 1.5, 0.7], tile: TILE.FIRE + i, a0: 1,
      });
    }
    this.alpha.add({
      x: p.x + dir.x * 0.1, y: p.y + dir.y * 0.1, z: p.z + dir.z * 0.1, vx: dir.x * 1.2, vy: 0.3, vz: dir.z * 1.2,
      life: 0.9, size0: 0.08 * scale, size1: 0.5 * scale, col0: [0.7, 0.7, 0.7], a0: 0.25, tile: TILE.SMOKE, drag: 2, grav: -0.3,
    });
  }

  fire(p, n = 4, size = 0.4) {
    for (let i = 0; i < n; i++) {
      this.additive.add({
        x: p.x + rnd(-0.1, 0.1), y: p.y, z: p.z + rnd(-0.1, 0.1),
        vx: rnd(-0.3, 0.3), vy: rnd(0.8, 2), vz: rnd(-0.3, 0.3), drag: 1, grav: -1,
        life: rnd(0.3, 0.7), size0: size * rnd(0.6, 1), size1: size * 0.3,
        col0: [1.8, 1.0, 0.35], col1: [0.9, 0.25, 0.05], tile: TILE.FIRE + Math.floor(Math.random() * 4), fadeIn: 0.05,
      });
    }
  }

  // ---------------------------------------------------------------- blood
  bloodBurst(p, dir, amount = 1) {
    if (this.game.settings.blood === false) return;
    const n = Math.round(10 * amount);
    for (let i = 0; i < n; i++) {
      const s = rnd(1, 4.5) * Math.sqrt(amount);
      const d = new THREE.Vector3(dir.x + rnd(-0.6, 0.6), dir.y + rnd(-0.3, 0.8), dir.z + rnd(-0.6, 0.6)).normalize();
      this.addDrop(p, d.multiplyScalar(s), rnd(0.012, 0.03));
    }
    // fine mist
    for (let i = 0; i < 3; i++) {
      this.alpha.add({
        x: p.x, y: p.y, z: p.z, vx: dir.x * rnd(0.5, 1.5) + rnd(-0.3, 0.3), vy: rnd(0, 0.5), vz: dir.z * rnd(0.5, 1.5) + rnd(-0.3, 0.3),
        drag: 4, grav: 0.4, life: rnd(0.4, 0.8), size0: 0.05, size1: rnd(0.2, 0.35),
        col0: [0.45, 0.02, 0.03], col1: [0.3, 0.01, 0.02], a0: 0.6, tile: TILE.SMOKE + Math.floor(Math.random() * 4),
      });
    }
  }

  addDrop(p, v, size) {
    if (this.drops.length > 400) this.drops.shift();
    const part = this.alpha.add({
      x: p.x, y: p.y, z: p.z, vx: v.x, vy: v.y, vz: v.z, drag: 0.2, grav: 9.8, life: 3, size0: size, size1: size,
      col0: [0.32, 0.01, 0.015], col1: [0.32, 0.01, 0.015], a0: 1, tile: TILE.BLOB + Math.floor(Math.random() * 4), fadePow: 8,
    });
    this.drops.push({ part, size, px: p.x, py: p.y, pz: p.z });
  }

  updateDrops(dt) {
    if (dt <= 0) return;
    const phys = this.game.physics;
    const keep = [];
    const dir = new THREE.Vector3();
    for (const d of this.drops) {
      const o = d.part;
      if (o.age >= o.life) continue;
      dir.set(o.x - d.px, o.y - d.py, o.z - d.pz);
      const len = dir.length();
      if (len > 1e-4) {
        dir.multiplyScalar(1 / len);
        const hit = phys.raycast({ x: d.px, y: d.py, z: d.pz }, dir, len + 0.02, null, GROUPS.queryStatic);
        if (hit) {
          o.life = 0; // kill particle
          if (hit.owner?.entity?.kind === 'static' || !hit.owner) {
            this.blood.add(hit.point, hit.normal, d.size * rnd(4, 9), Math.floor(Math.random() * 4));
          }
          continue;
        }
      }
      d.px = o.x;
      d.py = o.y;
      d.pz = o.z;
      keep.push(d);
    }
    this.drops = keep;
  }

  /** Start (or continue) a pool of blood under a bleeding body. */
  bloodPool(person, point) {
    if (this.game.settings.blood === false) return null;
    const hit = this.game.physics.raycast(point, { x: 0, y: -1, z: 0 }, 1.0, null, GROUPS.queryStatic);
    if (!hit || hit.normal.y < 0.7) return null;
    const i = this.blood.add(hit.point, hit.normal, 0.05, 0);
    const pool = { i, point: hit.point, normal: hit.normal, size: 0.05, max: 0.9 + Math.random() * 0.5, rot: Math.random() * 6.28, person };
    this.pools.push(pool);
    return pool;
  }

  updatePools(dt) {
    for (const p of this.pools) {
      if (p.size >= p.max) continue;
      const rate = p.person && !p.person.removed ? Math.min(1, p.person.bleed / 2) * 0.12 + 0.01 : 0;
      if (rate <= 0) continue;
      p.size = Math.min(p.max, p.size + rate * dt);
      this.blood.setScale(p.i, p.point, p.normal, p.size, p.rot);
    }
    if (this.pools.length > 40) this.pools.shift();
  }

  // ---------------------------------------------------------------- impacts
  /** Bullet impact on a static surface. */
  surfaceHit(point, normal, material = 'concrete', size = 0.06) {
    if (material === 'grass') {
      this.dust(point, normal, 5, [0.36, 0.33, 0.22]);
      this.debris(point, normal, 5, [0.25, 0.3, 0.12]);
      return;
    }
    if (material === 'metal') {
      this.sparks(point, normal, 14, 7);
      this.holes.add(point, normal, size * 0.7);
      return;
    }
    if (material === 'wood') {
      this.debris(point, normal, 8, [0.5, 0.36, 0.2]);
      this.dust(point, normal, 3, [0.55, 0.45, 0.32]);
      this.holes.add(point, normal, size);
      return;
    }
    if (material === 'rubber' || material === 'cloth') {
      this.dust(point, normal, 2, [0.3, 0.3, 0.3]);
      return;
    }
    this.dust(point, normal, 6);
    this.debris(point, normal, 7);
    this.sparks(point, normal, 3, 4);
    this.holes.add(point, normal, size);
  }

  explosion(p, power = 1) {
    const s = Math.sqrt(power);
    // fireball
    for (let i = 0; i < 18 * s; i++) {
      const d = new THREE.Vector3(rnd(-1, 1), rnd(-0.2, 1), rnd(-1, 1)).normalize();
      const sp = rnd(2, 10) * s;
      const hot = Math.random();
      this.additive.add({
        x: p.x + d.x * 0.2, y: p.y + d.y * 0.2 + 0.1, z: p.z + d.z * 0.2, vx: d.x * sp, vy: d.y * sp + 1, vz: d.z * sp,
        drag: 5, grav: -2.5, life: rnd(0.25, 0.65), size0: rnd(0.35, 0.8) * s, size1: rnd(1.1, 1.9) * s,
        col0: [1.6, 0.55 + hot * 0.35, 0.12 + hot * 0.1], col1: [0.55, 0.08, 0.01], a0: 0.6, tile: TILE.FIRE + Math.floor(Math.random() * 4), fadePow: 1.2,
      });
    }
    // core flash
    this.additive.add({ x: p.x, y: p.y + 0.3, z: p.z, vx: 0, vy: 0, vz: 0, life: 0.1, size0: 2.6 * s, size1: 3.6 * s, col0: [1.4, 0.9, 0.45], a0: 0.8, tile: TILE.GLOW });
    // smoke column
    for (let i = 0; i < 22 * s; i++) {
      const d = new THREE.Vector3(rnd(-1, 1), rnd(0, 1), rnd(-1, 1)).normalize();
      const sp = rnd(1, 5) * s;
      const g = rnd(0.06, 0.16);
      this.alpha.add({
        x: p.x + d.x * 0.5, y: p.y + 0.3 + d.y * 0.5, z: p.z + d.z * 0.5, vx: d.x * sp, vy: d.y * sp + 1.5, vz: d.z * sp,
        drag: 2, grav: -0.6, life: rnd(2.5, 5.5), size0: rnd(0.6, 1.2) * s, size1: rnd(3, 5) * s,
        col0: [g, g * 0.95, g * 0.9], col1: [0.32, 0.32, 0.33], a0: 0.7, tile: TILE.SMOKE + Math.floor(Math.random() * 4), fadeIn: 0.25, fadePow: 1.1,
      });
    }
    // sparks + debris
    for (let i = 0; i < 50 * s; i++) {
      const d = new THREE.Vector3(rnd(-1, 1), rnd(-0.2, 1), rnd(-1, 1)).normalize();
      const sp = rnd(6, 22) * s;
      this.streaks.add({ x: p.x, y: p.y + 0.2, z: p.z, vx: d.x * sp, vy: d.y * sp, vz: d.z * sp, life: rnd(0.4, 1.3), color: [1, 0.6, 0.25], intensity: 3, len: rnd(0.15, 0.4), floor: p.y });
    }
    this.debris(p, new THREE.Vector3(0, 1, 0), Math.round(24 * s), [0.2, 0.18, 0.16]);
    // shock ring
    const ring = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: 0xffe2b0, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    ring.position.set(p.x, p.y + 0.05, p.z);
    this.game.scene.add(ring);
    this.rings.push({ mesh: ring, t: 0, life: 0.35, r0: 0.3, r1: 6 * s });
    // scorch
    const hit = this.game.physics.raycast({ x: p.x, y: p.y + 0.5, z: p.z }, { x: 0, y: -1, z: 0 }, 2.5, null, GROUPS.queryStatic);
    if (hit && hit.owner?.entity?.kind === 'static') this.scorch.add(hit.point, hit.normal, rnd(2.8, 3.8) * s);
  }

  /** Small puff used when deleting/spawning things. */
  poof(p, size = 1) {
    for (let i = 0; i < 10; i++) {
      const d = new THREE.Vector3(rnd(-1, 1), rnd(-0.2, 1), rnd(-1, 1)).normalize();
      this.alpha.add({
        x: p.x + d.x * 0.2 * size, y: p.y + d.y * 0.2 * size, z: p.z + d.z * 0.2 * size, vx: d.x * 1.5 * size, vy: d.y * 1.5 * size, vz: d.z * 1.5 * size,
        drag: 4, grav: -0.2, life: rnd(0.5, 0.9), size0: 0.2 * size, size1: 0.7 * size,
        col0: [0.9, 0.9, 0.92], col1: [0.85, 0.85, 0.88], a0: 0.6, tile: TILE.SMOKE + Math.floor(Math.random() * 4),
      });
    }
  }
}
