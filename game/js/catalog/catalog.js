// Spawn menu: categories, items and how each item is placed in the world.
import * as THREE from 'three';
import { PROPS } from './props.js';
import { MELEE_PROPS } from './melee.js';
import { SYRINGES } from './syringes.js';
import { MACHINES } from './machines.js';
import { Prop } from '../entities/prop.js';
import { Car } from '../entities/vehicle.js';

const yawQ = (yaw) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);

function propItem(def, extra = {}) {
  return {
    id: def.id,
    name: def.name,
    def,
    height: def.size ?? 0.5,
    spawn(game, point, yaw) {
      const p = point.clone();
      p.y += (def.bottom ?? (def.size ?? 0.5) / 2) + 0.02 + (extra.lift ?? 0);
      return game.add(new Prop(game, def, p, yawQ(yaw), extra.opts || {}));
    },
    ...extra,
  };
}

export const CATEGORIES = [
  {
    id: 'people',
    name: 'People',
    items: [
      { id: 'person', name: 'Random person', person: 'random', height: 1.8 },
      { id: 'man', name: 'Man', person: 'male', height: 1.8 },
      { id: 'woman', name: 'Woman', person: 'female', height: 1.7 },
      { id: 'big', name: 'Big guy', person: 'heavy', height: 1.8 },
      { id: 'slim', name: 'Tall guy', person: 'slim', height: 1.85 },
      { id: 'crowd', name: 'Crowd of 6', person: 'random', count: 6, height: 1.8 },
      { id: 'dummy', name: 'Crash test dummy', person: 'male', dummy: true, height: 1.8, desc: 'No blood' },
    ],
  },
  {
    id: 'melee',
    name: 'Melee',
    items: [
      propItem(MELEE_PROPS.knife, { desc: 'Place on someone to stab' }),
      propItem(MELEE_PROPS.sword, { desc: 'Throw it or drag it fast' }),
      propItem(MELEE_PROPS.axe, { desc: 'Heavy chops take limbs' }),
    ],
  },
  {
    id: 'syringes',
    name: 'Syringes',
    items: [
      propItem(SYRINGES.adrenaline, { desc: 'Wakes, faster, stronger' }),
      propItem(SYRINGES.life, { desc: 'Heals, mends, revives' }),
      propItem(SYRINGES.acid, { desc: 'Dissolves from inside' }),
      propItem(SYRINGES.sedative, { desc: 'Out cold for a minute' }),
    ],
  },
  {
    id: 'explosives',
    name: 'Explosives',
    items: [
      propItem(PROPS.explosiveBarrel, { desc: 'Shoot it' }),
      propItem(PROPS.tnt, { desc: 'Activate (G) or shoot' }),
      propItem(PROPS.mine, { desc: 'Steps trigger it' }),
    ],
  },
  {
    id: 'props',
    name: 'Props',
    items: [
      propItem(PROPS.crate),
      propItem(PROPS.smallCrate),
      propItem(PROPS.barrel),
      propItem(PROPS.cone),
      propItem(PROPS.tire),
      propItem(PROPS.table),
      propItem(PROPS.chair),
      propItem(PROPS.mattress),
      propItem(PROPS.plank),
      propItem(PROPS.ibeam),
      propItem(PROPS.block),
      propItem(PROPS.anvil, { lift: 4, desc: 'Drops from above' }),
    ],
  },
  {
    id: 'fun',
    name: 'Fun',
    items: [
      propItem(PROPS.balloon, { desc: 'Tie with the rope tool' }),
      propItem(PROPS.beachBall),
      propItem(PROPS.bowlingBall),
      propItem(PROPS.watermelon),
      {
        id: 'brickWall', name: 'Brick wall', height: 1.0, preview: PROPS.brick,
        spawn(game, point, yaw) {
          const q = yawQ(yaw);
          const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
          const cols = 9;
          const rows = 14;
          let last = null;
          for (let r = 0; r < rows; r++) {
            const off = r % 2 ? 0.5 : 0;
            for (let c = 0; c < cols - (r % 2 ? 1 : 0); c++) {
              const x = (c + off - (cols - 1) / 2) * 0.218;
              const p = point.clone().addScaledVector(right, x);
              p.y += 0.0325 + r * 0.0655 + 0.002;
              last = game.add(new Prop(game, PROPS.brick, p, q), false);
            }
          }
          return last;
        },
      },
      {
        id: 'dominoes', name: 'Domino run', height: 0.6, preview: PROPS.domino,
        spawn(game, point, yaw) {
          const q = yawQ(yaw);
          const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
          let last = null;
          for (let i = 0; i < 16; i++) {
            const p = point.clone().addScaledVector(fwd, i * 0.42 - 3);
            p.y += 0.31;
            last = game.add(new Prop(game, PROPS.domino, p, q), false);
          }
          return last;
        },
      },
      {
        id: 'balloonBunch', name: 'Balloon bunch', height: 1.0, preview: PROPS.balloon,
        spawn(game, point) {
          let last = null;
          for (let i = 0; i < 10; i++) {
            const p = point.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.2, 0.6 + Math.random() * 0.6, (Math.random() - 0.5) * 1.2));
            last = game.add(new Prop(game, PROPS.balloon, p, new THREE.Quaternion()), false);
          }
          return last;
        },
      },
    ],
  },
  {
    id: 'machines',
    name: 'Machines',
    items: [propItem(MACHINES.thruster, { desc: 'Stick it on, press G' })],
  },
  {
    id: 'vehicles',
    name: 'Vehicles',
    items: [
      {
        id: 'car', name: 'Car', height: 1.45, desc: 'Activate (G) to drive',
        spawn(game, point, yaw) {
          return game.add(new Car(game, point.clone().add(new THREE.Vector3(0, 0.05, 0)), yaw));
        },
      },
    ],
  },
];

export function allItems() {
  return CATEGORIES.flatMap((c) => c.items);
}
