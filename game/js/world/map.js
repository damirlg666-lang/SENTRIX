// The sandbox map: terrain, concrete plaza, structures, vegetation and sky details.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { merge as mergeGeometries } from '../util/geo.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { R, GROUPS } from '../engine/physics.js';
import * as TX from '../engine/textures.js';
import { fbm, smoothstep, mulberry32 } from '../engine/noise.js';

export const PLAZA_HALF = 25;

export function terrainHeight(x, z) {
  const r = Math.sqrt(x * x + z * z);
  const flat = smoothstep(58, 125, r);
  let h = -0.08;
  if (flat > 0) {
    const n = fbm(x / 95 + 10, z / 95 + 4, 4, 0, 7);
    h += Math.pow(n, 1.6) * 30 * flat;
  }
  const m = smoothstep(240, 760, r);
  if (m > 0) {
    const n = fbm(x / 300 + 3, z / 300 - 6, 5, 0, 19);
    const ridge = 1 - Math.abs(fbm(x / 160, z / 160, 3, 0, 23) * 2 - 1);
    h += m * (n * 260 + ridge * 90);
  }
  return h;
}

/** Ground height used by gameplay (plaza top is y = 0). */
export function groundHeight(x, z) {
  if (Math.abs(x) <= PLAZA_HALF && Math.abs(z) <= PLAZA_HALF) return 0;
  return terrainHeight(x, z);
}

export class WorldMap {
  constructor(graphics, physics) {
    this.g = graphics;
    this.physics = physics;
    this.scene = graphics.scene;
    this.group = new THREE.Group();
    this.group.name = 'map';
    this.scene.add(this.group);
    this.body = physics.world.createRigidBody(R.RigidBodyDesc.fixed());
    this.statics = [];
    this.anim = [];
  }

  build(progress = () => {}) {
    progress('Laying concrete…');
    this.materials();
    progress('Growing terrain…');
    this.buildTerrain();
    this.buildPlaza();
    progress('Building structures…');
    this.buildTower(13, -11);
    this.buildRamp(-13, -9);
    this.buildContainer(-15.5, 12.5, 0.12);
    this.buildTrampoline(10, 11);
    this.buildBarriers();
    this.buildLamps();
    this.buildBenches();
    progress('Planting trees…');
    this.buildVegetation();
    this.buildClouds();
  }

  // ---------------------------------------------------------------- materials
  materials() {
    const c = TX.concrete(1024);
    const mk = (repeat, tint = 0xffffff) => {
      const m = new THREE.MeshStandardMaterial({
        color: tint,
        map: c.map.clone(),
        normalMap: c.normalMap.clone(),
        roughnessMap: c.roughnessMap.clone(),
        roughness: 1,
        metalness: 0,
        normalScale: new THREE.Vector2(1, 1),
      });
      for (const t of [m.map, m.normalMap, m.roughnessMap]) {
        t.repeat.set(repeat, repeat);
        t.needsUpdate = true;
      }
      return m;
    };
    this.matPlaza = mk(1 / 6);
    this.matConcrete = mk(1 / 3, 0xd8d4cc);
    this.matConcreteDark = mk(1 / 3, 0xa8a49c);
    const pm = TX.paintedMetal(512, 2);
    this.matYellowSteel = new THREE.MeshStandardMaterial({
      color: 0xf0b31a, map: pm.map, roughnessMap: pm.roughnessMap, normalMap: pm.normalMap, roughness: 1, metalness: 0.35,
    });
    this.matDarkSteel = new THREE.MeshStandardMaterial({
      color: 0x3a3f46, map: pm.map, roughnessMap: pm.roughnessMap, roughness: 1, metalness: 0.75,
    });
    this.matLine = new THREE.MeshStandardMaterial({
      color: 0xf2c14a, roughness: 0.75, metalness: 0, transparent: true, opacity: 0.88,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      map: c.map, // reuse concrete detail so the paint looks worn
    });
    this.matLineWhite = this.matLine.clone();
    this.matLineWhite.color.set(0xe9e9e4);
  }

  addCollider(desc, owner) {
    desc.setCollisionGroups(GROUPS.world).setFriction(0.9);
    const col = this.physics.world.createCollider(desc, this.body);
    this.physics.register(col, owner);
    this.statics.push(col);
    return col;
  }

  staticBox(geo, mat, pos, half, rot = null, material = 'concrete', name = 'Structure') {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(pos);
    if (rot) mesh.quaternion.copy(rot);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    const d = R.ColliderDesc.cuboid(half.x, half.y, half.z).setTranslation(pos.x, pos.y, pos.z);
    if (rot) d.setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w });
    this.addCollider(d, { kind: 'static', material, name });
    return mesh;
  }

  // ---------------------------------------------------------------- terrain
  buildTerrain() {
    const rings = 150;
    const segs = 256;
    const maxR = 1600;
    const pos = [];
    const uv = [];
    const idx = [];
    pos.push(0, terrainHeight(0, 0), 0);
    uv.push(0, 0);
    for (let i = 1; i <= rings; i++) {
      const t = i / rings;
      const r = maxR * t * t;
      for (let j = 0; j < segs; j++) {
        const a = (j / segs) * Math.PI * 2;
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        pos.push(x, terrainHeight(x, z), z);
        uv.push(x / 4, z / 4);
      }
    }
    for (let j = 0; j < segs; j++) idx.push(0, 1 + ((j + 1) % segs), 1 + j);
    for (let i = 1; i < rings; i++) {
      const a0 = 1 + (i - 1) * segs;
      const b0 = 1 + i * segs;
      for (let j = 0; j < segs; j++) {
        const j1 = (j + 1) % segs;
        idx.push(a0 + j, a0 + j1, b0 + j);
        idx.push(a0 + j1, b0 + j1, b0 + j);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();

    const gr = TX.grass(1024);
    const macro = TX.macroNoise(256);
    const mat = new THREE.MeshStandardMaterial({
      map: gr.map,
      normalMap: gr.normalMap,
      roughnessMap: gr.roughnessMap,
      roughness: 1,
      metalness: 0,
      normalScale: new THREE.Vector2(0.8, 0.8),
    });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.macroMap = { value: macro };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNormal;')
        .replace(
          '#include <worldpos_vertex>',
          '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWNormal = normalize(mat3(modelMatrix) * objectNormal);'
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNormal;\nuniform sampler2D macroMap;'
        )
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          float mA = texture2D(macroMap, vWPos.xz / 140.0).r;
          float mB = texture2D(macroMap, vWPos.xz / 37.0 + 0.3).r;
          diffuseColor.rgb *= mix(0.72, 1.18, mA) * mix(0.9, 1.08, mB);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.12, 1.0, 0.75), smoothstep(0.55, 0.8, mA) * 0.6);
          float slope = 1.0 - clamp(vWNormal.y, 0.0, 1.0);
          float rockAmt = smoothstep(0.28, 0.5, slope) + smoothstep(60.0, 140.0, vWPos.y);
          vec3 rock = vec3(0.36, 0.35, 0.33) * mix(0.75, 1.2, mB);
          diffuseColor.rgb = mix(diffuseColor.rgb, rock, clamp(rockAmt, 0.0, 1.0));
          float snow = smoothstep(170.0, 230.0, vWPos.y + mA * 40.0) * smoothstep(0.65, 0.35, slope);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.94, 0.97), snow);`
        );
    };
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.name = 'terrain';
    this.group.add(mesh);
    this.terrain = mesh;

    // physics heightfield covering the playable region
    const N = 300;
    const S = 600;
    const heights = new Float32Array((N + 1) * (N + 1));
    for (let i = 0; i <= N; i++) {
      for (let j = 0; j <= N; j++) {
        const x = -S / 2 + (S * i) / N;
        const z = -S / 2 + (S * j) / N;
        heights[i * (N + 1) + j] = terrainHeight(x, z);
      }
    }
    this.addCollider(R.ColliderDesc.heightfield(N, N, heights, { x: S, y: 1, z: S }).setFriction(1.0), {
      kind: 'static',
      material: 'grass',
      name: 'Grass',
    });
  }

  // ---------------------------------------------------------------- plaza
  buildPlaza() {
    const H = PLAZA_HALF;
    const depth = 0.6;
    const geo = new THREE.BoxGeometry(H * 2, depth, H * 2);
    // world-scaled UVs on top face
    const uv = geo.attributes.uv;
    const p = geo.attributes.position;
    const n = geo.attributes.normal;
    for (let i = 0; i < uv.count; i++) {
      if (Math.abs(n.getY(i)) > 0.5) uv.setXY(i, p.getX(i) + H, p.getZ(i) + H);
      else if (Math.abs(n.getX(i)) > 0.5) uv.setXY(i, p.getZ(i) + H, p.getY(i));
      else uv.setXY(i, p.getX(i) + H, p.getY(i));
    }
    const plaza = new THREE.Mesh(geo, this.matPlaza);
    plaza.position.y = -depth / 2;
    plaza.receiveShadow = true;
    this.group.add(plaza);
    this.addCollider(R.ColliderDesc.cuboid(H, depth / 2, H).setTranslation(0, -depth / 2, 0), {
      kind: 'static', material: 'concrete', name: 'Plaza',
    });

    // curb
    const curbMat = this.matConcrete;
    const curbGeoX = new RoundedBoxGeometry(H * 2 + 0.6, 0.18, 0.3, 2, 0.04);
    const curbGeoZ = new RoundedBoxGeometry(0.3, 0.18, H * 2 + 0.6, 2, 0.04);
    for (const s of [-1, 1]) {
      const a = new THREE.Mesh(curbGeoX, curbMat);
      a.position.set(0, -0.02, s * (H + 0.15));
      const b = new THREE.Mesh(curbGeoZ, curbMat);
      b.position.set(s * (H + 0.15), -0.02, 0);
      for (const m of [a, b]) {
        m.receiveShadow = true;
        m.castShadow = true;
        this.group.add(m);
      }
    }

    // painted markings
    const lines = [];
    const border = H - 1.2;
    const w = 0.12;
    const addLine = (x, z, sx, sz) => {
      const g = new THREE.PlaneGeometry(sx, sz).rotateX(-Math.PI / 2);
      g.translate(x, 0.004, z);
      lines.push(g);
    };
    addLine(0, border, border * 2 + w, w);
    addLine(0, -border, border * 2 + w, w);
    addLine(border, 0, w, border * 2 + w);
    addLine(-border, 0, w, border * 2 + w);
    // hazard chevrons near tower base
    const lineMesh = new THREE.Mesh(mergeGeometries(lines), this.matLine);
    lineMesh.receiveShadow = true;
    this.group.add(lineMesh);
    // centre spawn circle
    const ring = new THREE.Mesh(new THREE.RingGeometry(3.85, 4.0, 96).rotateX(-Math.PI / 2), this.matLineWhite);
    ring.position.y = 0.004;
    ring.receiveShadow = true;
    this.group.add(ring);
    const ring2 = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.65, 48).rotateX(-Math.PI / 2), this.matLineWhite);
    ring2.position.y = 0.004;
    ring2.receiveShadow = true;
    this.group.add(ring2);
  }

  // ---------------------------------------------------------------- tower
  buildTower(cx, cz) {
    const top = 5.3;
    const size = 5;
    const half = size / 2;
    const own = 'Drop Tower';
    // pillars
    const pillarGeo = new RoundedBoxGeometry(0.45, top - 0.3, 0.45, 2, 0.05);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        this.staticBox(
          pillarGeo, this.matConcrete,
          new THREE.Vector3(cx + sx * (half - 0.35), (top - 0.3) / 2, cz + sz * (half - 0.35)),
          new THREE.Vector3(0.225, (top - 0.3) / 2, 0.225), null, 'concrete', own
        );
      }
    }
    // slab
    this.staticBox(
      new RoundedBoxGeometry(size, 0.3, size, 2, 0.04), this.matConcrete,
      new THREE.Vector3(cx, top - 0.15, cz), new THREE.Vector3(half, 0.15, half), null, 'concrete', own
    );
    // railings on the two z sides
    const railH = 1.05;
    const postGeo = new THREE.CylinderGeometry(0.035, 0.035, railH, 10);
    const railGeoLong = new THREE.CylinderGeometry(0.03, 0.03, size - 0.1, 10).rotateZ(Math.PI / 2);
    const posts = [];
    const rails = [];
    const edges = [
      { dir: 'z', z: half - 0.08 },
      { dir: 'z', z: -half + 0.08 },
    ];
    for (const e of edges) {
      for (let k = 0; k <= 4; k++) {
        const t = -half + 0.1 + (k / 4) * (size - 0.2);
        const g = postGeo.clone();
        if (e.dir === 'z') g.translate(cx + t, top + railH / 2, cz + e.z);
        else g.translate(cx + e.x, top + railH / 2, cz + t);
        posts.push(g);
      }
      for (const yy of [top + railH - 0.03, top + railH * 0.5]) {
        const g = railGeoLong.clone();
        if (e.dir === 'x') g.rotateY(Math.PI / 2);
        if (e.dir === 'z') g.translate(cx, yy, cz + e.z);
        else g.translate(cx + e.x, yy, cz);
        rails.push(g);
      }
      const hx = e.dir === 'z' ? half : 0.04;
      const hz = e.dir === 'z' ? 0.04 : half;
      const px = e.dir === 'z' ? cx : cx + e.x;
      const pz = e.dir === 'z' ? cz + e.z : cz;
      this.addCollider(R.ColliderDesc.cuboid(hx, railH / 2, hz).setTranslation(px, top + railH / 2, pz), {
        kind: 'static', material: 'metal', name: 'Railing',
      });
    }
    const railMesh = new THREE.Mesh(mergeGeometries([...posts, ...rails]), this.matYellowSteel);
    railMesh.castShadow = true;
    railMesh.receiveShadow = true;
    this.group.add(railMesh);

    // stairs running along +z side going up toward the slab, outside the tower footprint
    const steps = 18;
    const rise = top / steps;
    const run = 0.32;
    const width = 1.3;
    // stairs alongside the +x side (the -x side stays open toward the plaza for dropping things)
    const stairGeos = [];
    const sx = cx + half + width / 2 + 0.05;
    const stairStartZ = cz - half + 0.2;
    for (let i = 0; i < steps; i++) {
      const h = rise * (steps - i);
      const zc = stairStartZ + i * run + run / 2;
      const g = new THREE.BoxGeometry(width, h, run);
      g.translate(sx, h / 2, zc);
      stairGeos.push(g);
      this.addCollider(R.ColliderDesc.cuboid(width / 2, h / 2, run / 2).setTranslation(sx, h / 2, zc), {
        kind: 'static', material: 'concrete', name: 'Stairs',
      });
    }
    const stairs = new THREE.Mesh(mergeGeometries(stairGeos), this.matConcreteDark);
    stairs.castShadow = true;
    stairs.receiveShadow = true;
    this.group.add(stairs);
    this.towerTop = new THREE.Vector3(cx, top, cz);
  }

  // ---------------------------------------------------------------- ramp
  buildRamp(cx, cz) {
    const L = 10;
    const W = 4.5;
    const Hh = 2.8;
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(L, 0);
    shape.lineTo(L, Hh);
    shape.lineTo(L - 0.8, Hh);
    shape.lineTo(0, 0.02);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: W, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 2 });
    geo.translate(-L / 2, 0, -W / 2);
    // planar UVs in meters (x along ramp, z across)
    const p = geo.attributes.position;
    const uv = geo.attributes.uv;
    const nrm = geo.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      if (Math.abs(nrm.getZ(i)) > 0.7) uv.setXY(i, p.getX(i), p.getY(i));
      else uv.setXY(i, p.getX(i) + p.getY(i), p.getZ(i));
    }
    const mesh = new THREE.Mesh(geo, this.matConcrete);
    mesh.position.set(cx, 0, cz);
    mesh.rotation.y = Math.PI / 2;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    mesh.updateMatrixWorld();
    const pts = [];
    const corners = [
      [0, 0], [L, 0], [L, Hh], [L - 0.8, Hh],
    ];
    for (const [x, y] of corners) {
      for (const z of [0, W]) {
        const v = new THREE.Vector3(x - L / 2, y, z - W / 2).applyMatrix4(mesh.matrixWorld);
        pts.push(v.x, v.y, v.z);
      }
    }
    this.addCollider(R.ColliderDesc.convexHull(new Float32Array(pts)), { kind: 'static', material: 'concrete', name: 'Ramp' });
    // yellow edge stripes
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(W + 0.02, 0.06, 0.25), this.matYellowSteel);
    stripe.position.copy(new THREE.Vector3(L / 2 - 0.4, Hh + 0.0, 0).applyMatrix4(mesh.matrixWorld));
    stripe.rotation.y = Math.PI / 2;
    stripe.castShadow = true;
    this.group.add(stripe);
  }

  // ---------------------------------------------------------------- container
  buildContainer(cx, cz, rotY) {
    const L = 6.06;
    const Hh = 2.59;
    const W = 2.44;
    const pm = TX.paintedMetal(512, 5);
    const corr = TX.corrugated(512);
    const body = new THREE.MeshStandardMaterial({
      color: 0x2c6e8f, map: pm.map, roughnessMap: pm.roughnessMap, normalMap: corr, roughness: 1, metalness: 0.45,
      normalScale: new THREE.Vector2(1.4, 1.4),
    });
    for (const t of [body.map, body.roughnessMap, body.normalMap]) {
      t.repeat.set(3, 1);
    }
    const group = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(L - 0.1, Hh - 0.1, W - 0.1), body);
    box.castShadow = true;
    box.receiveShadow = true;
    group.add(box);
    // frame
    const frameGeos = [];
    const beam = (sx, sy, sz, x, y, z) => {
      const g = new THREE.BoxGeometry(sx, sy, sz);
      g.translate(x, y, z);
      frameGeos.push(g);
    };
    const t = 0.14;
    for (const y of [-Hh / 2 + t / 2, Hh / 2 - t / 2]) {
      for (const z of [-W / 2 + t / 2, W / 2 - t / 2]) beam(L, t, t, 0, y, z);
      for (const x of [-L / 2 + t / 2, L / 2 - t / 2]) beam(t, t, W, x, y, 0);
    }
    for (const x of [-L / 2 + t / 2, L / 2 - t / 2]) for (const z of [-W / 2 + t / 2, W / 2 - t / 2]) beam(t, Hh, t, x, 0, z);
    // door bars on +x end
    for (const z of [-0.75, -0.3, 0.3, 0.75]) beam(0.06, Hh - 0.3, 0.05, L / 2 + 0.01, 0, z);
    const frameMat = body.clone();
    frameMat.normalMap = null;
    frameMat.color.set(0x23566f);
    const frame = new THREE.Mesh(mergeGeometries(frameGeos), frameMat);
    frame.castShadow = true;
    frame.receiveShadow = true;
    group.add(frame);
    group.position.set(cx, Hh / 2, cz);
    group.rotation.y = rotY;
    this.group.add(group);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
    this.addCollider(
      R.ColliderDesc.cuboid(L / 2, Hh / 2, W / 2).setTranslation(cx, Hh / 2, cz).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }),
      { kind: 'static', material: 'metal', name: 'Container' }
    );
  }

  // ---------------------------------------------------------------- trampoline
  buildTrampoline(cx, cz) {
    const r = 2.0;
    const h = 0.75;
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x2b78d6, roughness: 0.35, metalness: 0.6 });
    const matMat = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.85, metalness: 0 });
    const padMat = new THREE.MeshStandardMaterial({ color: 0x2b78d6, roughness: 0.6, metalness: 0 });
    const g = new THREE.Group();
    const ringMesh = new THREE.Mesh(new THREE.TorusGeometry(r, 0.05, 12, 64).rotateX(Math.PI / 2), frameMat);
    ringMesh.position.y = h;
    const pad = new THREE.Mesh(new THREE.TorusGeometry(r - 0.12, 0.09, 10, 64).rotateX(Math.PI / 2), padMat);
    pad.position.y = h + 0.03;
    pad.scale.set(1, 1, 0.5);
    const mat = new THREE.Mesh(new THREE.CircleGeometry(r - 0.2, 64).rotateX(-Math.PI / 2), matMat);
    mat.position.y = h - 0.02;
    g.add(ringMesh, pad, mat);
    const legGeo = new THREE.CylinderGeometry(0.035, 0.035, h, 8);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      const leg = new THREE.Mesh(legGeo, frameMat);
      leg.position.set(Math.cos(a) * r, h / 2, Math.sin(a) * r);
      g.add(leg);
    }
    g.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    g.position.set(cx, 0, cz);
    this.group.add(g);
    const c = this.addCollider(
      R.ColliderDesc.cylinder(0.05, r - 0.1).setTranslation(cx, h - 0.05, cz),
      { kind: 'static', material: 'rubber', name: 'Trampoline' }
    );
    c.setRestitution(1.05);
    c.setRestitutionCombineRule(R.CoefficientCombineRule.Max);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      this.addCollider(
        R.ColliderDesc.cylinder(h / 2, 0.04).setTranslation(cx + Math.cos(a) * r, h / 2, cz + Math.sin(a) * r),
        { kind: 'static', material: 'metal', name: 'Trampoline' }
      );
    }
  }

  // ---------------------------------------------------------------- barriers
  buildBarriers() {
    // jersey barrier profile
    const s = new THREE.Shape();
    s.moveTo(-0.3, 0);
    s.lineTo(0.3, 0);
    s.lineTo(0.3, 0.08);
    s.lineTo(0.16, 0.33);
    s.lineTo(0.1, 0.81);
    s.lineTo(-0.1, 0.81);
    s.lineTo(-0.16, 0.33);
    s.lineTo(-0.3, 0.08);
    s.closePath();
    const geo = new THREE.ExtrudeGeometry(s, { depth: 2.9, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.02, bevelSegments: 2 });
    geo.translate(0, 0, -1.45);
    const p = geo.attributes.position;
    const uv = geo.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, p.getZ(i) + p.getX(i), p.getY(i));
    const placements = [
      [-21.5, -3, 0], [-21.5, 0.2, 0], [-21.5, 3.4, 0],
      [4, -21.5, Math.PI / 2], [7.2, -21.5, Math.PI / 2],
    ];
    for (const [x, z, ry] of placements) {
      const m = new THREE.Mesh(geo, this.matConcrete);
      m.position.set(x, 0, z);
      m.rotation.y = ry;
      m.castShadow = true;
      m.receiveShadow = true;
      this.group.add(m);
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry);
      this.addCollider(
        R.ColliderDesc.convexHull(new Float32Array([
          -0.3, 0, -1.45, 0.3, 0, -1.45, -0.1, 0.81, -1.45, 0.1, 0.81, -1.45, -0.3, 0.08, -1.45, 0.3, 0.08, -1.45,
          -0.3, 0, 1.45, 0.3, 0, 1.45, -0.1, 0.81, 1.45, 0.1, 0.81, 1.45, -0.3, 0.08, 1.45, 0.3, 0.08, 1.45,
        ])).setTranslation(x, 0, z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }),
        { kind: 'static', material: 'concrete', name: 'Barrier' }
      );
    }
  }

  // ---------------------------------------------------------------- lamps
  buildLamps() {
    const poleGeo = new THREE.CylinderGeometry(0.07, 0.11, 7, 12);
    poleGeo.translate(0, 3.5, 0);
    const armGeo = new THREE.CylinderGeometry(0.045, 0.045, 1.2, 8).rotateZ(Math.PI / 2);
    armGeo.translate(0.55, 6.9, 0);
    const headGeo = new RoundedBoxGeometry(0.7, 0.14, 0.32, 2, 0.04);
    headGeo.translate(1.15, 6.85, 0);
    const baseGeo = new THREE.CylinderGeometry(0.22, 0.26, 0.4, 16);
    baseGeo.translate(0, 0.2, 0);
    const metal = mergeGeometries([poleGeo, armGeo, headGeo, baseGeo]);
    const bulbGeo = new THREE.BoxGeometry(0.55, 0.02, 0.22);
    bulbGeo.translate(1.15, 6.77, 0);
    const bulbMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2d6, emissiveIntensity: 1.5 });
    this.lampBulbMat = bulbMat;
    const H = PLAZA_HALF - 0.6;
    for (const [x, z] of [[H, H], [-H, H], [H, -H], [-H, -H]]) {
      const g = new THREE.Group();
      const m = new THREE.Mesh(metal, this.matDarkSteel);
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m, new THREE.Mesh(bulbGeo, bulbMat));
      g.position.set(x, 0, z);
      g.rotation.y = Math.atan2(-z, x) + Math.PI;
      // arm should point toward plaza centre
      g.rotation.y = Math.atan2(z, -x);
      this.group.add(g);
      this.addCollider(R.ColliderDesc.cylinder(3.5, 0.1).setTranslation(x, 3.5, z), {
        kind: 'static', material: 'metal', name: 'Lamp post',
      });
    }
  }

  // ---------------------------------------------------------------- benches
  buildBenches() {
    const wood = TX.woodPlanks(512, 4, 9);
    const woodMat = new THREE.MeshStandardMaterial({ map: wood.map, normalMap: wood.normalMap, roughnessMap: wood.roughnessMap, roughness: 1 });
    const legMat = this.matDarkSteel;
    const make = (x, z, ry) => {
      const g = new THREE.Group();
      for (let i = 0; i < 3; i++) {
        const plank = new THREE.Mesh(new RoundedBoxGeometry(1.8, 0.04, 0.12, 2, 0.015), woodMat);
        plank.position.set(0, 0.45, -0.14 + i * 0.14);
        g.add(plank);
      }
      for (let i = 0; i < 2; i++) {
        const plank = new THREE.Mesh(new RoundedBoxGeometry(1.8, 0.12, 0.04, 2, 0.015), woodMat);
        plank.position.set(0, 0.62 + i * 0.16, -0.24);
        plank.rotation.x = -0.12;
        g.add(plank);
      }
      for (const sx of [-0.75, 0.75]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.45, 0.4), legMat);
        leg.position.set(sx, 0.225, -0.05);
        g.add(leg);
        const back = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.5, 0.05), legMat);
        back.position.set(sx, 0.7, -0.25);
        back.rotation.x = -0.12;
        g.add(back);
      }
      g.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      g.position.set(x, 0, z);
      g.rotation.y = ry;
      this.group.add(g);
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry);
      const off = new THREE.Vector3(0, 0.3, -0.05).applyQuaternion(q);
      this.addCollider(
        R.ColliderDesc.cuboid(0.9, 0.3, 0.25).setTranslation(x + off.x, off.y, z + off.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }),
        { kind: 'static', material: 'wood', name: 'Bench' }
      );
    };
    make(-6, 23.2, Math.PI);
    make(0, 23.2, Math.PI);
    make(6, 23.2, Math.PI);
    make(23.2, 4, -Math.PI / 2);
  }

  // ---------------------------------------------------------------- vegetation
  buildVegetation() {
    const rnd = mulberry32(1234);
    const variants = [this.makeTree(1), this.makeTree(2), this.makePine(3), this.makePine(4)];
    const rocks = this.makeRock(5);
    const placements = variants.map(() => []);
    const rockPlace = [];
    const tries = 1100;
    for (let i = 0; i < tries; i++) {
      const a = rnd() * Math.PI * 2;
      const r = 34 + Math.pow(rnd(), 0.8) * 210;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (Math.abs(x) < PLAZA_HALF + 6 && Math.abs(z) < PLAZA_HALF + 6) continue;
      const density = fbm(x / 60, z / 60, 3, 0, 55);
      if (rnd() > density * 1.3 - 0.05) continue;
      const y = terrainHeight(x, z);
      const v = Math.floor(rnd() * variants.length);
      const s = 0.75 + rnd() * 0.6;
      placements[v].push({ x, y, z, s, ry: rnd() * Math.PI * 2 });
      if (r < 130 && v < 4) {
        this.addCollider(
          R.ColliderDesc.cylinder(3 * s, 0.28 * s).setTranslation(x, y + 3 * s, z),
          { kind: 'static', material: 'wood', name: 'Tree' }
        );
      }
    }
    for (let i = 0; i < 160; i++) {
      const a = rnd() * Math.PI * 2;
      const r = 30 + rnd() * 200;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (Math.abs(x) < PLAZA_HALF + 3 && Math.abs(z) < PLAZA_HALF + 3) continue;
      rockPlace.push({ x, y: terrainHeight(x, z) - 0.1, z, s: 0.3 + Math.pow(rnd(), 3) * 2.2, ry: rnd() * 6.28 });
    }
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    // near and far instances are split so only trees around the plaza render into the
    // shadow map (instanced meshes are culled as a whole)
    const addInstanced = (parts, all) => {
      const near = all.filter((p) => Math.hypot(p.x, p.z) < 75);
      const far = all.filter((p) => Math.hypot(p.x, p.z) >= 75);
      for (const [list, shadows] of [[near, true], [far, false]]) {
        if (!list.length) continue;
        for (const part of parts) {
          const im = new THREE.InstancedMesh(part.geo, part.mat, list.length);
          list.forEach((p, i) => {
            q.setFromAxisAngle(up, p.ry);
            m4.compose(new THREE.Vector3(p.x, p.y, p.z), q, new THREE.Vector3(p.s, p.s, p.s));
            im.setMatrixAt(i, m4);
          });
          im.castShadow = shadows;
          im.receiveShadow = true;
          im.computeBoundingSphere();
          this.group.add(im);
        }
      }
    };
    variants.forEach((parts, i) => addInstanced(parts, placements[i]));
    addInstanced(rocks, rockPlace);
  }

  makeTree(seed) {
    const rnd = mulberry32(seed * 97);
    const barkMat = new THREE.MeshStandardMaterial({ color: 0x5a4636, roughness: 0.95, normalMap: TX.bumpNoise(256, 12, 2.5, 6) });
    barkMat.normalMap.repeat.set(2, 6);
    const trunkParts = [];
    const trunk = new THREE.CylinderGeometry(0.16, 0.3, 4.2, 10, 6);
    trunk.translate(0, 2.1, 0);
    bend(trunk, rnd() * 0.3, rnd() * 0.3);
    trunkParts.push(trunk);
    // a few branches
    for (let i = 0; i < 4; i++) {
      const b = new THREE.CylinderGeometry(0.04, 0.09, 1.6, 6);
      b.translate(0, 0.8, 0);
      b.rotateZ(0.7 + rnd() * 0.4);
      b.rotateY(rnd() * Math.PI * 2);
      b.translate(0, 2.6 + rnd() * 1.0, 0);
      trunkParts.push(b);
    }
    const leafParts = [];
    const blobs = 7 + Math.floor(rnd() * 4);
    for (let i = 0; i < blobs; i++) {
      const r = 0.9 + rnd() * 0.9;
      const g = smoothIco(r, 2);
      displace(g, 0.28, seed * 10 + i);
      const a = rnd() * Math.PI * 2;
      const d = i === 0 ? 0 : 0.7 + rnd() * 1.0;
      g.translate(Math.cos(a) * d, 4.3 + rnd() * 1.8 - (d > 1.2 ? 0.6 : 0), Math.sin(a) * d);
      leafParts.push(g);
    }
    const leaves = mergeGeometries(leafParts);
    shadeFoliage(leaves, new THREE.Color(0x3f6b2a), new THREE.Color(0x8fb04a), 3.2, 6.8, seed);
    const leafMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, normalMap: TX.bumpNoise(256, 24, 3, 8) });
    leafMat.normalMap.repeat.set(3, 3);
    return [
      { geo: mergeGeometries(trunkParts.map((g) => g.toNonIndexed())), mat: barkMat },
      { geo: leaves, mat: leafMat },
    ];
  }

  makePine(seed) {
    const rnd = mulberry32(seed * 31);
    const barkMat = new THREE.MeshStandardMaterial({ color: 0x4a3a2e, roughness: 0.95 });
    const trunk = new THREE.CylinderGeometry(0.12, 0.26, 3.5, 8);
    trunk.translate(0, 1.75, 0);
    const tiers = [];
    const n = 5;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const r = 2.1 * (1 - t * 0.75) + rnd() * 0.2;
      const h = 2.2 - t * 0.6;
      const c = new THREE.ConeGeometry(r, h, 14, 3, true);
      displace(c, 0.18, seed * 7 + i);
      c.translate(0, 2.0 + i * 1.25 + h / 2, 0);
      tiers.push(c);
    }
    const leaves = mergeGeometries(tiers.map((g) => g.toNonIndexed()));
    leaves.computeVertexNormals();
    shadeFoliage(leaves, new THREE.Color(0x1f3d24), new THREE.Color(0x4f7a3a), 2.0, 8.5, seed);
    const leafMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide });
    return [
      { geo: trunk, mat: barkMat },
      { geo: leaves, mat: leafMat },
    ];
  }

  makeRock(seed) {
    const g = smoothIco(1, 2);
    displace(g, 0.35, seed);
    g.scale(1, 0.65, 0.9);
    g.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: 0x8a867e, roughness: 0.92, normalMap: TX.bumpNoise(256, 16, 3, 12) });
    return [{ geo: g, mat }];
  }

  // ---------------------------------------------------------------- clouds
  buildClouds() {
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTime: { value: 0 },
        uSunDir: { value: this.g.sunDir },
        uSunColor: { value: new THREE.Color(1, 0.95, 0.88) },
        uCover: { value: 0.5 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vPos;
        void main() {
          vPos = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * viewMatrix * vec4(vPos, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uSunDir;
        uniform vec3 uSunColor;
        uniform float uCover;
        varying vec3 vPos;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p); vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
        }
        float fbm(vec2 p) {
          float s = 0.0, a = 0.5;
          for (int i = 0; i < 6; i++) { s += a * noise(p); p = p * 2.03 + 17.0; a *= 0.5; }
          return s;
        }
        void main() {
          vec2 uv = vPos.xz / 900.0 + vec2(uTime * 0.004, uTime * 0.0015);
          float n = fbm(uv);
          float d = smoothstep(uCover, uCover + 0.28, n);
          float r = length(vPos.xz);
          float fade = 1.0 - smoothstep(1800.0, 3800.0, r);
          float shade = mix(0.72, 1.0, smoothstep(uCover, uCover + 0.5, fbm(uv + uSunDir.xz * 0.06)));
          vec3 col = mix(vec3(0.62, 0.66, 0.72), uSunColor, shade);
          gl_FragColor = vec4(col * 1.05, d * fade * 0.92);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(8000, 8000).rotateX(Math.PI / 2), mat);
    plane.position.y = 520;
    plane.frustumCulled = false;
    plane.renderOrder = -1;
    this.group.add(plane);
    this.cloudMat = mat;
    this.clouds = plane;
  }

  setCloudCover(c) {
    if (this.cloudMat) this.cloudMat.uniforms.uCover.value = c;
  }

  update(dt, camera) {
    if (this.cloudMat) {
      this.cloudMat.uniforms.uTime.value += dt;
      this.clouds.position.x = camera.position.x;
      this.clouds.position.z = camera.position.z;
    }
  }
}

// ---------------------------------------------------------------- geometry helpers
function smoothIco(r, detail) {
  const g = new THREE.IcosahedronGeometry(r, detail);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  const m = mergeVertices(g);
  m.computeVertexNormals();
  // spherical uvs for normal-map detail
  const p = m.attributes.position;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    uv[i * 2] = Math.atan2(z, x) / (Math.PI * 2) + 0.5;
    uv[i * 2 + 1] = Math.acos(Math.max(-1, Math.min(1, y / r))) / Math.PI;
  }
  m.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return m;
}

function displace(geo, amount, seed) {
  const p = geo.attributes.position;
  const v = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    nrm.copy(v).normalize();
    const n = fbm(v.x * 1.3 + seed, v.y * 1.3 + v.z * 0.7, 3, 0, seed) - 0.5;
    v.addScaledVector(nrm, n * amount * 2);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
}

function bend(geo, bx, bz) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const t = y / 4;
    p.setX(i, p.getX(i) + bx * t * t);
    p.setZ(i, p.getZ(i) + bz * t * t);
  }
  geo.computeVertexNormals();
}

function shadeFoliage(geo, dark, light, y0, y1, seed) {
  const p = geo.attributes.position;
  const nrm = geo.attributes.normal;
  const colors = new Float32Array(p.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const t = smoothstep(y0, y1, y);
    const up = nrm.getY(i) * 0.5 + 0.5;
    const n = fbm(p.getX(i) * 0.8 + seed, p.getZ(i) * 0.8, 2, 0, seed);
    c.copy(dark).lerp(light, Math.min(1, t * 0.6 + up * 0.35 + (n - 0.5) * 0.5));
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}
