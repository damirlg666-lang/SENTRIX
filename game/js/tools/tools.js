// Player tools: hand (grab/throw/pin), weapons, explosions, rope, force, freeze, heal, delete
// and item placement from the spawn menu.
import * as THREE from 'three';
import { R } from '../engine/physics.js';
import { WEAPONS, PROJECTILES } from '../catalog/weapons.js';
import { Prop } from '../entities/prop.js';
import { groundHeight } from '../world/map.js';

export const TOOL_IDS = ['hand', 'weapon', 'explode', 'rope', 'push', 'freeze', 'heal', 'delete'];
export const EXPLODE_SIZES = [
  { id: 'small', name: 'Small', power: 0.6 },
  { id: 'medium', name: 'Medium', power: 1.3 },
  { id: 'large', name: 'Huge', power: 3.2 },
];

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();

function bodyLocal(body, worldPoint) {
  const t = body.translation();
  const r = body.rotation();
  _q.set(r.x, r.y, r.z, r.w).invert();
  return new THREE.Vector3(worldPoint.x - t.x, worldPoint.y - t.y, worldPoint.z - t.z).applyQuaternion(_q);
}

function bodyWorld(body, local, out = new THREE.Vector3()) {
  const t = body.translation();
  const r = body.rotation();
  _q.set(r.x, r.y, r.z, r.w);
  return out.copy(local).applyQuaternion(_q).add(_v2.set(t.x, t.y, t.z));
}

export class Tools {
  constructor(game) {
    this.game = game;
    this.active = 'hand';
    this.weaponIndex = 0;
    this.explodeIndex = 1;
    this.spawnItem = null;
    this.spawnYaw = 0;
    this.pointer = new THREE.Vector2(0, 0);
    this.pointerPx = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    this.mouseDown = false;
    this.raycaster = new THREE.Raycaster();
    this.rayOrigin = new THREE.Vector3();
    this.rayDir = new THREE.Vector3(0, 0, -1);
    this.hover = null;
    this.grab = null;
    this.pins = [];
    this.ropes = [];
    this.ropeStart = null;
    this.frozenMarks = [];
    this.cooldown = 0;
    this.recoil = 0;
    this.listeners = [];

    // first-person weapon models hang off the camera
    const cam = game.camera;
    game.scene.add(cam);
    this.viewmodel = new THREE.Group();
    cam.add(this.viewmodel);
    this.weaponModels = WEAPONS.map((w) => {
      const m = w.model();
      m.visible = false;
      m.traverse((o) => {
        if (o.isMesh) o.castShadow = false;
      });
      this.viewmodel.add(m);
      return m;
    });
    this.vmLight = new THREE.PointLight(0xffd29a, 0, 3, 2);
    this.viewmodel.add(this.vmLight);
    this.sway = new THREE.Vector2();

    // grab visuals
    const glow = new THREE.MeshBasicMaterial({ color: 0xffc04a, transparent: true, opacity: 0.85, depthTest: false, toneMapped: false });
    this.grabDot = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), glow);
    this.grabDot.renderOrder = 10;
    this.grabDot.visible = false;
    game.scene.add(this.grabDot);
    this.grabLineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    this.grabLine = new THREE.Line(this.grabLineGeo, new THREE.LineDashedMaterial({ color: 0xffc04a, dashSize: 0.08, gapSize: 0.05, transparent: true, opacity: 0.8, depthTest: false }));
    this.grabLine.renderOrder = 10;
    this.grabLine.visible = false;
    this.grabLine.frustumCulled = false;
    game.scene.add(this.grabLine);

    // spawn preview
    this.ghostMat = new THREE.MeshStandardMaterial({ color: 0x7cc4ff, emissive: 0x2a6fb0, emissiveIntensity: 0.6, transparent: true, opacity: 0.38, depthWrite: false });
    this.ghost = new THREE.Group();
    this.ghost.visible = false;
    game.scene.add(this.ghost);
    this.ghostCache = new Map();
    this.ropeMat = new THREE.MeshStandardMaterial({ color: 0xb59a6a, roughness: 0.9 });
    this.pinMat = new THREE.MeshStandardMaterial({ color: 0x8fe3ff, emissive: 0x2bb8ff, emissiveIntensity: 1.2, roughness: 0.2, transparent: true, opacity: 0.85 });
    this.pinGeo = new THREE.OctahedronGeometry(0.05, 0);
  }

  on(fn) {
    this.listeners.push(fn);
  }

  emit(type, data) {
    for (const fn of this.listeners) fn(type, data);
  }

  // ------------------------------------------------------------------ selection
  select(id) {
    if (this.grab) this.release();
    this.spawnItem = null;
    this.ghost.visible = false;
    this.ropeStart = null;
    this.active = id;
    this.mouseDown = false;
    this.emit('tool', id);
  }

  selectWeapon(i) {
    this.weaponIndex = (i + WEAPONS.length) % WEAPONS.length;
    if (this.active !== 'weapon') this.select('weapon');
    this.cooldown = 0.15;
    this.recoil = -0.15; // small "raise" animation
    this.emit('weapon', this.weaponIndex);
  }

  selectSpawn(item) {
    if (this.grab) this.release();
    this.spawnItem = item;
    this.spawnYaw = 0;
    this.buildGhost(item);
    this.emit('spawn', item);
  }

  cancel() {
    if (this.spawnItem) {
      this.spawnItem = null;
      this.ghost.visible = false;
      this.emit('spawn', null);
      return true;
    }
    if (this.ropeStart) {
      this.ropeStart = null;
      this.emit('hint');
      return true;
    }
    return false;
  }

  get weapon() {
    return WEAPONS[this.weaponIndex];
  }

  // ------------------------------------------------------------------ input
  setPointer(clientX, clientY) {
    this.pointerPx.x = clientX;
    this.pointerPx.y = clientY;
    this.pointer.set((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
  }

  down() {
    this.mouseDown = true;
    this.game.audio?.unlock();
    if (this.spawnItem) {
      this.placeSpawn();
      return;
    }
    switch (this.active) {
      case 'hand':
        this.startGrab();
        break;
      case 'weapon':
        this.tryFire();
        break;
      case 'explode':
        this.explodeAt();
        break;
      case 'rope':
        this.ropeClick();
        break;
      case 'push':
        this.pushAt();
        break;
      case 'freeze':
        this.freezeAt();
        break;
      case 'heal':
        this.healAt();
        break;
      case 'delete':
        this.deleteAt();
        break;
      default:
        break;
    }
  }

  up() {
    this.mouseDown = false;
    if (this.grab) this.release();
  }

  /** Returns true if the wheel was used by the tool. */
  wheel(delta) {
    if (this.grab) {
      this.grab.dist = THREE.MathUtils.clamp(this.grab.dist * Math.pow(1.0012, -delta), 0.8, 80);
      return true;
    }
    if (this.spawnItem && this.keysShift) {
      this.spawnYaw += Math.sign(delta) * (Math.PI / 8);
      return true;
    }
    return false;
  }

  key(code) {
    if (code === 'KeyF' && this.grab) {
      this.pinGrab();
      return true;
    }
    if (code === 'KeyR') {
      if (this.spawnItem) {
        this.spawnYaw += Math.PI / 4;
        return true;
      }
      if (this.active === 'weapon') {
        this.selectWeapon(this.weaponIndex + 1);
        return true;
      }
    }
    if (code === 'KeyG') {
      const e = this.hover?.owner?.entity;
      if (e && e.activate && !e.removed) {
        if (e.activate()) this.emit('toast', e.kind === 'vehicle' ? (e.driving ? 'Engine on' : 'Engine off') : `${e.name} armed`);
        return true;
      }
    }
    if (code === 'Delete' || code === 'Backspace') {
      const e = this.hover?.owner?.entity;
      if (e && e.kind !== 'static') {
        this.removeEntity(e);
        return true;
      }
    }
    return false;
  }

  // ------------------------------------------------------------------ per-frame
  updateRay() {
    this.raycaster.setFromCamera(this.pointer, this.game.camera);
    this.rayOrigin.copy(this.raycaster.ray.origin);
    this.rayDir.copy(this.raycaster.ray.direction);
  }

  pick(maxDist = 1000) {
    return this.game.physics.raycast(this.rayOrigin, this.rayDir, maxDist);
  }

  prePhysics(dt) {
    if (this.grab) {
      const g = this.grab;
      if (!g.body.isValid() || g.entity.removed) {
        this.release();
      } else {
        const target = _v.copy(this.rayOrigin).addScaledVector(this.rayDir, g.dist);
        const gh = groundHeight(target.x, target.z);
        if (target.y < gh + 0.05) target.y = gh + 0.05;
        const cur = g.anchor.translation();
        const d = _v2.set(target.x - cur.x, target.y - cur.y, target.z - cur.z);
        const maxStep = 28 * dt;
        if (d.length() > maxStep) d.setLength(maxStep);
        g.anchor.setNextKinematicTranslation({ x: cur.x + d.x, y: cur.y + d.y, z: cur.z + d.z });
      }
    }
  }

  update(dt) {
    this.updateRay();
    this.hover = this.pick();
    this.cooldown -= dt;
    if (this.active === 'weapon' && this.mouseDown && !this.spawnItem && this.weapon.auto) this.tryFire();
    this.updateViewmodel(dt);
    this.updateGrabVisual();
    this.updateGhost();
    this.updateRopes();
    this.updateMarks();
  }

  reset() {
    if (this.grab) this.release();
    for (const p of [...this.pins]) this.removePin(p);
    for (const r of [...this.ropes]) this.removeRope(r);
    for (const m of this.frozenMarks) this.game.scene.remove(m.mesh);
    this.frozenMarks.length = 0;
    this.ropeStart = null;
  }

  // ------------------------------------------------------------------ hand
  grabbable(hit) {
    const e = hit?.owner?.entity;
    if (!e || e.kind === 'static' || e.removed) return null;
    const body = e.bodies[hit.owner.part ?? 0] || e.bodies[0];
    if (!body || !body.isDynamic()) return null;
    return { e, body };
  }

  startGrab() {
    const hit = this.hover;
    const g = this.grabbable(hit);
    if (!g) return;
    const world = this.game.physics.world;
    const local = bodyLocal(g.body, hit.point);
    const anchor = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(hit.point.x, hit.point.y, hit.point.z));
    const joint = world.createImpulseJoint(R.JointData.spherical({ x: 0, y: 0, z: 0 }, { x: local.x, y: local.y, z: local.z }), anchor, g.body, true);
    this.grab = { entity: g.e, body: g.body, anchor, joint, local, dist: hit.toi };
    if (g.e.kind === 'person') {
      g.e.held = true;
      g.e.ragdoll.wake();
      if (g.e.conscious) this.game.audio?.voice(g.e, 0.3);
    }
    g.body.wakeUp();
    this.emit('hint');
  }

  release() {
    const g = this.grab;
    if (!g) return;
    const world = this.game.physics.world;
    if (g.joint.isValid()) world.removeImpulseJoint(g.joint, true);
    world.removeRigidBody(g.anchor);
    if (g.entity.kind === 'person' && !this.pins.some((p) => p.entity === g.entity)) g.entity.held = false;
    this.grab = null;
    this.emit('hint');
  }

  pinGrab() {
    const g = this.grab;
    if (!g) return;
    const marker = new THREE.Mesh(this.pinGeo, this.pinMat);
    this.game.scene.add(marker);
    this.pins.push({ entity: g.entity, body: g.body, anchor: g.anchor, joint: g.joint, local: g.local, marker });
    this.grab = null;
    this.emit('toast', 'Pinned in place — use Freeze on it to release');
    this.emit('hint');
  }

  removePin(p) {
    const world = this.game.physics.world;
    if (p.joint.isValid()) world.removeImpulseJoint(p.joint, true);
    if (p.anchor.isValid()) world.removeRigidBody(p.anchor);
    this.game.scene.remove(p.marker);
    this.pins.splice(this.pins.indexOf(p), 1);
    if (p.entity.kind === 'person' && !this.pins.some((q) => q.entity === p.entity)) p.entity.held = false;
  }

  updateGrabVisual() {
    const g = this.grab;
    if (!g || !g.body.isValid()) {
      this.grabDot.visible = false;
      this.grabLine.visible = false;
      return;
    }
    const p = bodyWorld(g.body, g.local, _v);
    this.grabDot.position.copy(p);
    this.grabDot.visible = true;
    const target = _v2.copy(this.rayOrigin).addScaledVector(this.rayDir, g.dist);
    const pos = this.grabLineGeo.attributes.position;
    pos.setXYZ(0, p.x, p.y, p.z);
    pos.setXYZ(1, target.x, target.y, target.z);
    pos.needsUpdate = true;
    this.grabLine.computeLineDistances();
    this.grabLine.visible = p.distanceTo(target) > 0.08;
  }

  // ------------------------------------------------------------------ weapons
  tryFire() {
    if (this.cooldown > 0) return;
    const w = this.weapon;
    this.cooldown = w.rate;
    this.fire(w);
  }

  muzzleWorld(out = new THREE.Vector3()) {
    const m = this.weaponModels[this.weaponIndex];
    m.updateWorldMatrix(true, false);
    return out.copy(m.userData.muzzle).applyMatrix4(m.matrixWorld);
  }

  fire(w) {
    const game = this.game;
    const origin = this.rayOrigin.clone();
    const muzzle = this.muzzleWorld();
    this.recoil = w.recoil;
    if (w.projectile) {
      this.launch(w, muzzle);
      return;
    }
    game.audio?.gunshot(w.sound, muzzle);
    game.fx?.muzzleFlash(muzzle, this.rayDir, w.id === 'shotgun' ? 1.4 : w.id === 'sniper' ? 1.6 : 1);
    this.vmLight.intensity = 6;
    game.cam.shake(w.id === 'sniper' ? 0.35 : w.id === 'shotgun' ? 0.28 : 0.08);
    game.noise(origin, w.id === 'sniper' ? 5 : 3);
    const pellets = w.pellets || 1;
    for (let i = 0; i < pellets; i++) {
      const dir = this.rayDir.clone();
      if (w.spread) {
        dir.x += (Math.random() - 0.5) * 2 * w.spread;
        dir.y += (Math.random() - 0.5) * 2 * w.spread;
        dir.z += (Math.random() - 0.5) * 2 * w.spread;
        dir.normalize();
      }
      this.shootRay(origin, dir, w, muzzle, w.pierce || 0, 1);
    }
  }

  shootRay(origin, dir, w, muzzle, pierce, dmgScale, exclude = null) {
    const game = this.game;
    const filter = exclude ? (c) => !exclude.has(c.handle) : null;
    const hit = game.physics.raycast(origin, dir, 900, filter);
    if (!hit) {
      if (muzzle) game.fx?.tracer(muzzle, origin.clone().addScaledVector(dir, 300));
      return;
    }
    if (muzzle) game.fx?.tracer(muzzle, hit.point);
    const e = hit.owner?.entity;
    const back = dir.clone().negate();
    if (!e || e.kind === 'static') {
      const mat = e?.material ?? 'concrete';
      game.fx?.surfaceHit(hit.point, hit.normal, mat);
      game.audio?.bulletHit(mat, hit.point);
      return;
    }
    const amount = w.damage * dmgScale;
    if (e.kind === 'person') {
      const part = hit.owner.part;
      e.damage({ amount, part, point: hit.point, dir, kind: 'bullet' });
      const b = e.bodies[part];
      b.applyImpulseAtPoint({ x: dir.x * w.impulse * dmgScale, y: dir.y * w.impulse * dmgScale, z: dir.z * w.impulse * dmgScale }, { x: hit.point.x, y: hit.point.y, z: hit.point.z }, true);
      game.fx?.bloodBurst(hit.point, back.clone().lerp(hit.normal, 0.5).normalize(), 0.7);
      game.audio?.bulletHit('flesh', hit.point);
      // exit wound: find the far side of the body part
      const handles = new Set(e.ragdoll.colliders.map((c) => c.handle));
      const farStart = hit.point.clone().addScaledVector(dir, 0.6);
      const exitHit = game.physics.raycast(farStart, back, 0.6, (c) => c.handle === e.ragdoll.colliders[part].handle);
      if (exitHit && (pierce > 0 || w.damage > 25)) {
        game.fx?.bloodBurst(exitHit.point, dir, 1.1);
        e.wound(part, exitHit.point, 1.3);
      }
      if (pierce > 0) {
        const ex = exclude ? new Set([...exclude, ...handles]) : handles;
        this.shootRay((exitHit ? exitHit.point : farStart).clone().addScaledVector(dir, 0.02), dir, w, null, pierce - 1, dmgScale * 0.6, ex);
      }
      return;
    }
    // props / vehicles
    e.damage({ amount, kind: 'bullet', point: hit.point, dir });
    e.impulse(dir.clone().multiplyScalar(w.impulse * dmgScale), hit.point, hit.owner.part);
    const mat = e.material ?? 'metal';
    game.fx?.surfaceHit(hit.point, hit.normal, mat === 'flesh' ? 'wood' : mat, 0.04);
    game.audio?.bulletHit(mat, hit.point);
    if (pierce > 0 && mat !== 'metal') {
      const handles = new Set(e.colliders?.map((c) => c.handle) ?? []);
      const ex = exclude ? new Set([...exclude, ...handles]) : handles;
      this.shootRay(hit.point.clone().addScaledVector(dir, 0.05), dir, w, null, pierce - 1, dmgScale * 0.5, ex);
    }
  }

  launch(w, muzzle) {
    const game = this.game;
    const def = PROJECTILES[w.projectile];
    const dir = this.rayDir.clone();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir);
    const start = muzzle.clone().addScaledVector(dir, 0.15);
    const prop = new Prop(game, def, start, q);
    game.add(prop, false);
    if (w.projectile === 'rocket') {
      prop.body.setLinvel({ x: dir.x * 42, y: dir.y * 42, z: dir.z * 42 }, true);
      game.audio?.gunshot('rocket', muzzle);
      game.fx?.smoke(muzzle, 6, { size: 0.3, gray: 0.7, alpha: 0.5 });
      game.noise(this.rayOrigin, 3);
    } else {
      const v = dir.clone().multiplyScalar(13).add(new THREE.Vector3(0, 3, 0));
      prop.body.setLinvel({ x: v.x, y: v.y, z: v.z }, true);
      prop.body.setAngvel({ x: Math.random() * 10 - 5, y: Math.random() * 10 - 5, z: Math.random() * 10 - 5 }, true);
      game.audio?.whoosh(muzzle, 0.6);
    }
  }

  updateViewmodel(dt) {
    const show = this.active === 'weapon' && !this.spawnItem;
    this.viewmodel.visible = show;
    if (!show) return;
    const w = this.weapon;
    this.weaponModels.forEach((m, i) => (m.visible = i === this.weaponIndex));
    const m = this.weaponModels[this.weaponIndex];
    this.recoil += (0 - this.recoil) * Math.min(1, dt * 9);
    // aim the gun at what is under the cursor
    const target = this.hover ? this.hover.point : _v.copy(this.rayOrigin).addScaledVector(this.rayDir, 50);
    const cam = this.game.camera;
    const local = cam.worldToLocal(_v2.copy(target));
    const base = new THREE.Vector3(...w.pos);
    // follow the cursor a little on screen
    base.x += this.pointer.x * 0.06;
    base.y += this.pointer.y * 0.04;
    this.sway.x += (Math.sin(performance.now() * 0.0012) * 0.004 - this.sway.x) * Math.min(1, dt * 4);
    this.sway.y += (Math.cos(performance.now() * 0.0017) * 0.003 - this.sway.y) * Math.min(1, dt * 4);
    m.position.set(base.x + this.sway.x, base.y + this.sway.y - this.recoil * 0.15, base.z + this.recoil * 0.6);
    const dir = local.sub(m.position).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir);
    const kick = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), this.recoil * 2.2);
    m.quaternion.slerp(q.multiply(kick), Math.min(1, dt * 18));
    this.vmLight.position.copy(m.position).add(new THREE.Vector3(0, 0.05, -0.4));
    this.vmLight.intensity *= Math.exp(-dt * 30);
  }

  // ------------------------------------------------------------------ explode / push / freeze / heal / delete
  explodeAt() {
    const hit = this.hover;
    if (!hit) return;
    const e = hit.owner?.entity;
    if (e && e.kind === 'prop' && e.def.explosive) {
      e.detonate();
      return;
    }
    const p = hit.point.clone().addScaledVector(hit.normal, 0.2);
    this.game.explode(p, EXPLODE_SIZES[this.explodeIndex].power);
  }

  pushAt() {
    const hit = this.hover;
    if (!hit) return;
    const game = this.game;
    const dir = this.rayDir.clone().add(new THREE.Vector3(0, 0.25, 0)).normalize();
    const center = hit.point;
    game.audio?.whoosh(center, 1);
    game.fx?.poof(center, 0.6);
    for (const e of game.entities) {
      if (e.removed) continue;
      e.bodies.forEach((b, i) => {
        if (!b.isDynamic()) return;
        const t = b.translation();
        const d = Math.hypot(t.x - center.x, t.y - center.y, t.z - center.z);
        if (d > 2.2) return;
        const f = 1 - d / 2.2;
        const m = b.mass();
        const dv = (e.kind === 'person' ? 11 : 13) * f / (1 + m / 400);
        b.applyImpulse({ x: dir.x * dv * m, y: dir.y * dv * m, z: dir.z * dv * m }, true);
        if (e.kind === 'person' && i === 0) e.stun += f * 1.5;
      });
    }
  }

  freezeAt() {
    const hit = this.hover;
    const e = hit?.owner?.entity;
    if (!e || e.kind === 'static') return;
    // releasing a pin takes priority
    const pin = this.pins.find((p) => p.entity === e);
    if (pin) {
      this.removePin(pin);
      this.emit('toast', 'Released');
      return;
    }
    if (e.kind === 'person') {
      const part = hit.owner.part;
      const b = e.bodies[part];
      const frozen = b.isFixed();
      b.setBodyType(frozen ? R.RigidBodyType.Dynamic : R.RigidBodyType.Fixed, true);
      if (frozen) {
        this.frozenMarks = this.frozenMarks.filter((m) => {
          if (m.body === b) {
            this.game.scene.remove(m.mesh);
            return false;
          }
          return true;
        });
      } else this.addMark(e, b);
      e.held = e.bodies.some((x) => x.isFixed());
      e.ragdoll.wake();
      this.emit('toast', frozen ? 'Unfrozen' : `${e.partName(part)} frozen in place`);
      return;
    }
    e.setFrozen(!e.frozen);
    if (e.frozen) this.addMark(e, e.bodies[0]);
    else {
      this.frozenMarks = this.frozenMarks.filter((m) => {
        if (m.entity === e) {
          this.game.scene.remove(m.mesh);
          return false;
        }
        return true;
      });
    }
    this.emit('toast', e.frozen ? `${e.name} frozen` : `${e.name} unfrozen`);
  }

  addMark(entity, body) {
    const mesh = new THREE.Mesh(this.pinGeo, this.pinMat);
    this.game.scene.add(mesh);
    this.frozenMarks.push({ entity, body, mesh });
  }

  updateMarks() {
    const t = performance.now() * 0.002;
    this.frozenMarks = this.frozenMarks.filter((m) => {
      if (m.entity.removed || !m.body.isValid()) {
        this.game.scene.remove(m.mesh);
        return false;
      }
      const p = m.body.translation();
      m.mesh.position.set(p.x, p.y + 0.25, p.z);
      m.mesh.rotation.y = t;
      return true;
    });
    for (const p of [...this.pins]) {
      if (p.entity.removed || !p.body.isValid()) {
        this.removePin(p);
        continue;
      }
      const a = p.anchor.translation();
      p.marker.position.set(a.x, a.y, a.z);
      p.marker.rotation.y = t;
    }
  }

  healAt() {
    const e = this.hover?.owner?.entity;
    if (!e || e.kind === 'static') return;
    if (e.heal) e.heal();
    else if (isFinite(e.maxHealth)) e.health = e.maxHealth;
    const p = e.position(new THREE.Vector3());
    const fx = this.game.fx;
    for (let i = 0; i < 24; i++) {
      fx?.additive.add({
        x: p.x + (Math.random() - 0.5) * 0.6, y: p.y + (Math.random() - 0.5) * 1.2, z: p.z + (Math.random() - 0.5) * 0.6,
        vx: 0, vy: 0.6 + Math.random(), vz: 0, life: 0.8 + Math.random() * 0.6, size0: 0.08, size1: 0.02,
        col0: [0.4, 1.6, 0.6], col1: [0.2, 1.0, 0.4], tile: 8, drag: 1,
      });
    }
    this.game.audio?.click(1400);
    this.emit('toast', `${e.name} healed`);
  }

  deleteAt() {
    const e = this.hover?.owner?.entity;
    if (!e || e.kind === 'static') return;
    this.removeEntity(e);
  }

  removeEntity(e) {
    const p = e.position(new THREE.Vector3());
    if (this.grab?.entity === e) this.release();
    for (const pin of [...this.pins]) if (pin.entity === e) this.removePin(pin);
    this.game.fx?.poof(p, e.kind === 'vehicle' ? 2 : 1);
    this.game.audio?.click(500);
    this.game.remove(e);
  }

  // ------------------------------------------------------------------ rope
  attachInfo(hit) {
    const e = hit.owner?.entity;
    if (!e || e.kind === 'static') {
      return { entity: null, body: this.game.map.body, local: hit.point.clone(), point: hit.point.clone() };
    }
    const body = e.bodies[hit.owner.part ?? 0] || e.bodies[0];
    return { entity: e, body, local: bodyLocal(body, hit.point), point: hit.point.clone() };
  }

  ropeClick() {
    const hit = this.hover;
    if (!hit) return;
    const info = this.attachInfo(hit);
    if (!this.ropeStart) {
      this.ropeStart = info;
      this.emit('hint');
      this.game.audio?.click(800);
      return;
    }
    const a = this.ropeStart;
    this.ropeStart = null;
    if (!a.entity && !info.entity) {
      this.emit('toast', 'Attach at least one end to an object');
      this.emit('hint');
      return;
    }
    if (a.body === info.body) {
      this.emit('hint');
      return;
    }
    const pa = bodyWorld(a.body, a.local, new THREE.Vector3());
    const pb = bodyWorld(info.body, info.local, new THREE.Vector3());
    const length = Math.max(0.15, pa.distanceTo(pb));
    const jd = R.JointData.rope(length, { x: a.local.x, y: a.local.y, z: a.local.z }, { x: info.local.x, y: info.local.y, z: info.local.z });
    const joint = this.game.physics.world.createImpulseJoint(jd, a.body, info.body, true);
    const mesh = this.makeRopeMesh();
    this.game.scene.add(mesh);
    this.ropes.push({ a, b: info, joint, length, mesh });
    a.body.wakeUp();
    info.body.wakeUp();
    this.game.audio?.click(1000);
    this.emit('hint');
  }

  makeRopeMesh() {
    const SEG = 20;
    const SIDES = 6;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array((SEG + 1) * SIDES * 3);
    const nrm = new Float32Array((SEG + 1) * SIDES * 3);
    const idx = [];
    for (let i = 0; i < SEG; i++) {
      for (let j = 0; j < SIDES; j++) {
        const a = i * SIDES + j;
        const b = i * SIDES + ((j + 1) % SIDES);
        const c = (i + 1) * SIDES + j;
        const d = (i + 1) * SIDES + ((j + 1) % SIDES);
        idx.push(a, c, b, b, c, d);
      }
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setIndex(idx);
    const mesh = new THREE.Mesh(geo, this.ropeMat);
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    mesh.userData.seg = SEG;
    mesh.userData.sides = SIDES;
    return mesh;
  }

  updateRopes() {
    for (const r of [...this.ropes]) {
      if ((r.a.entity && r.a.entity.removed) || (r.b.entity && r.b.entity.removed) || !r.joint.isValid() || !r.a.body.isValid() || !r.b.body.isValid()) {
        this.removeRope(r);
        continue;
      }
      const pa = bodyWorld(r.a.body, r.a.local, new THREE.Vector3());
      const pb = bodyWorld(r.b.body, r.b.local, new THREE.Vector3());
      const dist = pa.distanceTo(pb);
      const slack = Math.max(0, r.length - dist);
      const sag = Math.sqrt(slack * r.length) * 0.5;
      const mid = pa.clone().add(pb).multiplyScalar(0.5);
      mid.y -= sag;
      const curve = new THREE.QuadraticBezierCurve3(pa, mid, pb);
      this.writeTube(r.mesh, curve, 0.012);
    }
  }

  writeTube(mesh, curve, radius) {
    const SEG = mesh.userData.seg;
    const SIDES = mesh.userData.sides;
    const pos = mesh.geometry.attributes.position.array;
    const nrm = mesh.geometry.attributes.normal.array;
    const t = new THREE.Vector3();
    const n = new THREE.Vector3();
    const b = new THREE.Vector3();
    const p = new THREE.Vector3();
    let ref = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i <= SEG; i++) {
      const u = i / SEG;
      curve.getPoint(u, p);
      curve.getTangent(u, t);
      if (Math.abs(t.dot(ref)) > 0.95) ref = new THREE.Vector3(1, 0, 0);
      n.crossVectors(t, ref).normalize();
      b.crossVectors(t, n).normalize();
      for (let j = 0; j < SIDES; j++) {
        const a = (j / SIDES) * Math.PI * 2;
        const cx = Math.cos(a);
        const sx = Math.sin(a);
        const k = (i * SIDES + j) * 3;
        const nx = n.x * cx + b.x * sx;
        const ny = n.y * cx + b.y * sx;
        const nz = n.z * cx + b.z * sx;
        pos[k] = p.x + nx * radius;
        pos[k + 1] = p.y + ny * radius;
        pos[k + 2] = p.z + nz * radius;
        nrm[k] = nx;
        nrm[k + 1] = ny;
        nrm[k + 2] = nz;
      }
    }
    mesh.geometry.attributes.position.needsUpdate = true;
    mesh.geometry.attributes.normal.needsUpdate = true;
  }

  removeRope(r) {
    if (r.joint.isValid()) this.game.physics.world.removeImpulseJoint(r.joint, true);
    this.game.scene.remove(r.mesh);
    r.mesh.geometry.dispose();
    this.ropes.splice(this.ropes.indexOf(r), 1);
  }

  // ------------------------------------------------------------------ spawning
  buildGhost(item) {
    this.ghost.clear();
    if (!item) {
      this.ghost.visible = false;
      return;
    }
    let g = this.ghostCache.get(item.id);
    if (!g) {
      g = new THREE.Group();
      const def = item.def || item.preview;
      if (item.person) {
        const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 1.3, 6, 12), this.ghostMat);
        body.position.y = 0.88;
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12), this.ghostMat);
        head.position.y = 1.65;
        const nose = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.25, 8).rotateX(Math.PI / 2), this.ghostMat);
        nose.position.set(0, 1.2, 0.3);
        g.add(body, head, nose);
      } else if (item.id === 'car') {
        const b = new THREE.Mesh(new THREE.BoxGeometry(4.4, 1.1, 1.8), this.ghostMat);
        b.position.y = 0.85;
        g.add(b);
      } else if (item.id === 'brickWall') {
        const b = new THREE.Mesh(new THREE.BoxGeometry(1.96, 0.92, 0.1), this.ghostMat);
        b.position.y = 0.46;
        g.add(b);
      } else if (item.id === 'dominoes') {
        for (let i = 0; i < 16; i++) {
          const b = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.6, 0.08), this.ghostMat);
          b.position.set(0, 0.3, i * 0.42 - 3);
          g.add(b);
        }
      } else if (def) {
        const built = def.build({});
        built.mesh.traverse((o) => {
          if (o.isMesh) o.material = this.ghostMat;
        });
        built.mesh.position.y = (def.size ?? 0.5) / 2 + 0.02;
        g.add(built.mesh);
      }
      this.ghostCache.set(item.id, g);
    }
    this.ghost.add(g);
  }

  spawnYawFor(point) {
    // face the camera by default
    const c = this.game.camera.position;
    return Math.atan2(c.x - point.x, c.z - point.z) + this.spawnYaw;
  }

  updateGhost() {
    const item = this.spawnItem;
    if (!item || !this.hover) {
      this.ghost.visible = false;
      return;
    }
    const p = this.hover.point;
    this.ghost.visible = true;
    this.ghost.position.copy(p);
    if (item.lift) this.ghost.position.y += item.lift;
    this.ghost.rotation.set(0, this.spawnYawFor(p), 0);
  }

  placeSpawn() {
    const item = this.spawnItem;
    const hit = this.hover;
    if (!item || !hit) return;
    const game = this.game;
    const p = hit.point.clone();
    if (hit.normal.y < 0.5) p.addScaledVector(hit.normal, 0.4);
    const yaw = this.spawnYawFor(p);
    let ent = null;
    if (item.person) {
      const n = item.count || 1;
      for (let i = 0; i < n; i++) {
        const q = p.clone();
        if (n > 1) {
          const a = (i / n) * Math.PI * 2;
          q.x += Math.cos(a) * 1.3;
          q.z += Math.sin(a) * 1.3;
          q.y = groundHeight(q.x, q.z) > q.y - 0.5 ? Math.max(q.y, groundHeight(q.x, q.z)) : q.y;
        }
        ent = game.spawnPerson(q.add(new THREE.Vector3(0, 0.02, 0)), n > 1 ? Math.random() * Math.PI * 2 : yaw, { type: item.person });
      }
    } else {
      ent = item.spawn(game, p, yaw);
    }
    game.fx?.poof(p.clone().add(new THREE.Vector3(0, 0.3, 0)), 0.5);
    game.audio?.click(700);
    this.emit('spawned', ent);
  }
}
