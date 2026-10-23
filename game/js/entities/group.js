// A handful of entities spawned together (a building): undo and delete treat them as one.
import { Entity } from './entity.js';

export class Group extends Entity {
  constructor(game, name) {
    super(game);
    this.kind = 'group';
    this.name = name;
    this.members = [];
  }

  add(e) {
    this.members.push(e);
    e.group = this;
    return e;
  }

  /** Wake every remaining member, so pieces resting on something that broke start to fall. */
  wake() {
    for (const m of this.members) if (!m.removed) for (const b of m.bodies) b.wakeUp();
  }

  position(out) {
    const m = this.members.find((x) => !x.removed);
    return m ? m.position(out) : out;
  }

  destroy() {
    if (this.removed) return;
    super.destroy();
    for (const m of this.members) if (!m.removed) this.game.remove(m);
  }
}
