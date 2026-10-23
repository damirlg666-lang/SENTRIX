// Orbit-style sandbox camera: right-drag to orbit, middle-drag to pan, WASD/QE to fly, wheel to zoom.
import * as THREE from 'three';

const damp = (a, b, rate, dt) => a + (b - a) * (1 - Math.exp(-rate * dt));

export class CameraController {
  constructor(camera, groundHeight) {
    this.camera = camera;
    this.groundHeight = groundHeight;
    this.pivot = new THREE.Vector3(0, 1.0, 0);
    this.goalPivot = this.pivot.clone();
    this.yaw = 0.55;
    this.pitch = 0.32;
    this.dist = 12;
    this.goalYaw = this.yaw;
    this.goalPitch = this.pitch;
    this.goalDist = this.dist;
    this.keys = new Set();
    this.shakeAmt = 0;
    this.shakeOffset = new THREE.Vector3();
    this.enabled = true;
    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this.follow = null; // optional function returning a Vector3 to track
    this.moveLock = false; // keyboard drives something else (controlled person)
    this.baseFov = camera.fov;
    this.scope = null; // sniper scope: the camera stays put and turns in place
  }

  /** Look through a scope: fixed position, narrow field of view, slower mouse look. */
  enterScope(fov = 8) {
    if (this.scope) return;
    const d = new THREE.Vector3();
    this.camera.getWorldDirection(d);
    this.scope = {
      pos: this.camera.position.clone(),
      yaw: Math.atan2(-d.x, -d.z),
      pitch: Math.asin(THREE.MathUtils.clamp(-d.y, -1, 1)),
      fov,
      t: 0,
    };
    this.follow = null;
  }

  /** Back to orbiting, around a point straight ahead of where the scope was looking. */
  exitScope() {
    const s = this.scope;
    if (!s) return;
    this.scope = null;
    const cp = Math.cos(s.pitch);
    const d = new THREE.Vector3(-cp * Math.sin(s.yaw), -Math.sin(s.pitch), -cp * Math.cos(s.yaw));
    this.goalPivot.copy(s.pos).addScaledVector(d, this.dist);
    this.pivot.copy(this.goalPivot);
    this.yaw = this.goalYaw = s.yaw;
    this.pitch = this.goalPitch = THREE.MathUtils.clamp(s.pitch, -0.25, 1.48);
  }

  scopeZoom(delta) {
    if (this.scope) this.scope.fov = THREE.MathUtils.clamp(this.scope.fov * Math.pow(1.0015, delta), 3, 20);
  }

  rotate(dx, dy) {
    if (this.scope) {
      // the narrower the view, the finer the aim
      const k = this.scope.fov / this.baseFov;
      this.scope.yaw -= dx * 0.0045 * k;
      this.scope.pitch = THREE.MathUtils.clamp(this.scope.pitch + dy * 0.0045 * k, -1.45, 1.45);
      return;
    }
    this.goalYaw -= dx * 0.0055;
    this.goalPitch = THREE.MathUtils.clamp(this.goalPitch + dy * 0.0045, -0.25, 1.48);
  }

  pan(dx, dy) {
    const s = this.dist * 0.0016;
    this._right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const up = new THREE.Vector3(0, 1, 0);
    this.goalPivot.addScaledVector(this._right, -dx * s);
    this.goalPivot.addScaledVector(up, dy * s);
  }

  zoom(delta) {
    this.goalDist = THREE.MathUtils.clamp(this.goalDist * Math.pow(1.0015, delta), 1.2, 140);
  }

  focus(point, dist) {
    this.goalPivot.copy(point);
    if (dist) this.goalDist = dist;
  }

  shake(amount) {
    this.shakeAmt = Math.min(1.2, this.shakeAmt + amount);
  }

  update(dt) {
    const cam = this.camera;
    const fov = this.scope ? this.scope.fov : this.baseFov;
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov += (fov - cam.fov) * (1 - Math.exp(-14 * dt));
      cam.updateProjectionMatrix();
    }
    if (this.scope) {
      const s = this.scope;
      s.t += dt;
      // breathing sway, mostly steadied while Shift is held
      const steady = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 0.15 : 1;
      const a = 0.0025 * steady * (s.fov / 8);
      const yaw = s.yaw + Math.sin(s.t * 1.1) * a + Math.sin(s.t * 2.7) * a * 0.4;
      const pitch = s.pitch + Math.sin(s.t * 1.7 + 1) * a * 0.8;
      const cp = Math.cos(pitch);
      cam.position.copy(s.pos);
      cam.lookAt(s.pos.x - cp * Math.sin(yaw), s.pos.y - Math.sin(pitch), s.pos.z - cp * Math.cos(yaw));
      if (this.shakeAmt > 0.001) {
        cam.rotateX(this.shakeAmt * 0.04);
        this.shakeAmt = Math.max(0, this.shakeAmt - dt * 2.2);
      }
      return;
    }
    if (this.enabled && !this.moveLock) {
      const k = this.keys;
      const fast = k.has('ShiftLeft') || k.has('ShiftRight');
      const speed = (this.dist * 0.9 + 5) * (fast ? 2.6 : 1);
      this._fwd.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      this._right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      const mv = new THREE.Vector3();
      if (k.has('KeyW') || k.has('ArrowUp')) mv.add(this._fwd);
      if (k.has('KeyS') || k.has('ArrowDown')) mv.sub(this._fwd);
      if (k.has('KeyD') || k.has('ArrowRight')) mv.add(this._right);
      if (k.has('KeyA') || k.has('ArrowLeft')) mv.sub(this._right);
      if (k.has('KeyE') || k.has('Space')) mv.y += 1;
      if (k.has('KeyQ') || k.has('KeyC')) mv.y -= 1;
      if (mv.lengthSq() > 0) {
        mv.normalize().multiplyScalar(speed * dt);
        this.goalPivot.add(mv);
        this.follow = null;
      }
    }
    if (this.follow) {
      const p = this.follow();
      if (p) this.goalPivot.lerp(p, 1 - Math.exp(-6 * dt));
      else this.follow = null;
    }
    const lim = 260;
    this.goalPivot.x = THREE.MathUtils.clamp(this.goalPivot.x, -lim, lim);
    this.goalPivot.z = THREE.MathUtils.clamp(this.goalPivot.z, -lim, lim);
    const gh = this.groundHeight(this.goalPivot.x, this.goalPivot.z);
    this.goalPivot.y = THREE.MathUtils.clamp(this.goalPivot.y, gh + 0.15, gh + 120);

    this.pivot.x = damp(this.pivot.x, this.goalPivot.x, 12, dt);
    this.pivot.y = damp(this.pivot.y, this.goalPivot.y, 12, dt);
    this.pivot.z = damp(this.pivot.z, this.goalPivot.z, 12, dt);
    this.yaw = damp(this.yaw, this.goalYaw, 18, dt);
    this.pitch = damp(this.pitch, this.goalPitch, 18, dt);
    this.dist = damp(this.dist, this.goalDist, 10, dt);

    const cp = Math.cos(this.pitch);
    cam.position.set(
      this.pivot.x + this.dist * cp * Math.sin(this.yaw),
      this.pivot.y + this.dist * Math.sin(this.pitch),
      this.pivot.z + this.dist * cp * Math.cos(this.yaw)
    );
    const camGround = this.groundHeight(cam.position.x, cam.position.z) + 0.25;
    if (cam.position.y < camGround) cam.position.y = camGround;
    cam.lookAt(this.pivot);

    if (this.shakeAmt > 0.001) {
      const a = this.shakeAmt * this.shakeAmt * 0.35;
      this.shakeOffset.set((Math.random() - 0.5) * a, (Math.random() - 0.5) * a, (Math.random() - 0.5) * a);
      cam.position.add(this.shakeOffset);
      cam.rotateZ((Math.random() - 0.5) * a * 0.15);
      this.shakeAmt = Math.max(0, this.shakeAmt - dt * 2.2);
    }
  }
}
