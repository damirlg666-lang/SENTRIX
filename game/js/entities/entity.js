// Base class for everything that lives in the sandbox (people, props, explosives...).
let nextId = 1;

export class Entity {
  constructor(game) {
    this.game = game;
    this.id = nextId++;
    this.removed = false;
    this.name = 'Object';
    this.kind = 'entity';
    this.bodies = [];
    this.frozen = false;
  }

  /** Called before every physics sub-step. */
  prePhysics(dt) {}

  /** Called once per rendered frame after physics. */
  update(dt) {}

  /** Generic damage hook: { amount, part, point, dir, kind, impulse } */
  damage(info) {}

  /** Push the entity (impulse in N*s applied at a point, optional part). */
  impulse(imp, point, part = null) {
    const body = part !== null && this.bodies[part] ? this.bodies[part] : this.bodies[0];
    if (!body) return;
    body.applyImpulseAtPoint({ x: imp.x, y: imp.y, z: imp.z }, { x: point.x, y: point.y, z: point.z }, true);
  }

  /** World position used for UI and focusing. */
  position(out) {
    const b = this.bodies[0];
    if (!b) return out;
    const t = b.translation();
    return out.set(t.x, t.y, t.z);
  }

  setFrozen(frozen) {
    this.frozen = frozen;
  }

  destroy() {
    this.removed = true;
  }
}
