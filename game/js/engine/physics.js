// Thin wrapper around the Rapier world: stepping, ownership lookup, queries and impact events.
import RAPIER from 'rapier';
import * as THREE from 'three';

export let R = null;

export async function initPhysics() {
  await RAPIER.init({});
  R = RAPIER;
  return R;
}

// Collision group bits
export const G = {
  WORLD: 0x0001,
  PROP: 0x0002,
  RAGDOLL: 0x0004,
  ANCHOR: 0x0008,
  SENSOR: 0x0010,
  DEBRIS: 0x0020, // gut strands and the like: collide with the world, ignored by picking
};

export function groups(member, filter) {
  return (((member & 0xffff) << 16) | (filter & 0xffff)) >>> 0;
}

export const GROUPS = {
  world: groups(G.WORLD, G.PROP | G.RAGDOLL | G.DEBRIS),
  prop: groups(G.PROP, G.WORLD | G.PROP | G.RAGDOLL | G.DEBRIS),
  debris: groups(G.DEBRIS, G.WORLD | G.PROP),
  ragdoll: groups(G.RAGDOLL, G.WORLD | G.PROP | G.RAGDOLL),
  anchor: groups(G.ANCHOR, 0),
  // query masks
  queryAll: groups(0xffff, G.WORLD | G.PROP | G.RAGDOLL),
  queryStatic: groups(0xffff, G.WORLD | G.PROP),
};

const _v = new THREE.Vector3();

export class Physics {
  constructor() {
    this.world = new R.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = 1 / 60;
    this.world.numSolverIterations = 6;
    this.eventQueue = new R.EventQueue(true);
    this.owners = new Map(); // collider handle -> { entity, part }
    this.gravityScale = 1;
    this.impactListeners = [];
    this.ray = new R.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  }

  setGravity(scale) {
    this.gravityScale = scale;
    this.world.gravity = { x: 0, y: -9.81 * scale, z: 0 };
    this.world.forEachRigidBody((b) => b.wakeUp());
  }

  register(collider, entity, part = null) {
    this.owners.set(collider.handle, { entity, part, collider });
  }

  unregister(collider) {
    this.owners.delete(collider.handle);
  }

  ownerOf(handle) {
    return this.owners.get(handle) || null;
  }

  removeBody(body) {
    if (!body || !body.isValid?.()) return;
    for (let i = 0; i < body.numColliders(); i++) this.owners.delete(body.collider(i).handle);
    this.world.removeRigidBody(body);
  }

  step(dt) {
    this.world.timestep = dt;
    this.world.step(this.eventQueue);
    this.eventQueue.drainContactForceEvents((e) => {
      const h1 = e.collider1();
      const h2 = e.collider2();
      const f = e.maxForceMagnitude();
      const impulse = e.totalForceMagnitude() * dt;
      const dir = e.maxForceDirection();
      for (const l of this.impactListeners) l(h1, h2, impulse, f, dir);
    });
  }

  /**
   * Cast a ray. Returns { point, normal, toi, collider, owner } or null.
   * `filter` is an optional predicate on the collider.
   */
  raycast(origin, dir, maxDist = 500, filter = null, groupsMask = GROUPS.queryAll) {
    this.ray.origin = { x: origin.x, y: origin.y, z: origin.z };
    this.ray.dir = { x: dir.x, y: dir.y, z: dir.z };
    const hit = this.world.castRayAndGetNormal(
      this.ray,
      maxDist,
      true,
      undefined,
      groupsMask,
      undefined,
      undefined,
      filter || undefined
    );
    if (!hit) return null;
    const toi = hit.timeOfImpact;
    const point = new THREE.Vector3(origin.x + dir.x * toi, origin.y + dir.y * toi, origin.z + dir.z * toi);
    const normal = new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z);
    return { point, normal, toi, collider: hit.collider, owner: this.ownerOf(hit.collider.handle) };
  }

  /** All colliders whose shapes intersect a sphere. */
  overlapSphere(center, radius, cb) {
    const shape = new R.Ball(radius);
    this.world.intersectionsWithShape(
      { x: center.x, y: center.y, z: center.z },
      { x: 0, y: 0, z: 0, w: 1 },
      shape,
      (c) => {
        cb(c);
        return true;
      },
      undefined,
      GROUPS.queryAll
    );
  }
}

export function toV3(v, out = _v) {
  return out.set(v.x, v.y, v.z);
}
