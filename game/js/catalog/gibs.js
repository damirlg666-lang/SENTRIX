// Bits of people: chunks thrown out when someone is blown apart.
import * as THREE from 'three';
import { R } from '../engine/physics.js';
import { blobGeometry, wetMaterial } from '../characters/gore.js';

export const GIBS = {
  chunk: {
    id: 'gibChunk', name: 'Remains', material: 'flesh', mass: 0.5, hidden: true, lifetime: 45, ccd: true, restitution: 0.05, friction: 0.9,
    build: (opts) => {
      const r = opts.r ?? 0.05;
      const mesh = new THREE.Mesh(blobGeometry(r, r * 0.7, r * 0.85, 0.28, 10), wetMaterial(opts.color ?? 0x7d1414));
      return { mesh, colliders: [{ desc: R.ColliderDesc.ball(r * 0.8) }] };
    },
    update: (prop, dt) => {
      // leave a trail of drops while it flies
      if (dt <= 0 || prop.bloodless) return;
      const v = prop.body.linvel();
      if (Math.hypot(v.x, v.y, v.z) > 1.5 && Math.random() < dt * 18) {
        const t = prop.body.translation();
        prop.game.fx?.addDrop(new THREE.Vector3(t.x, t.y, t.z), new THREE.Vector3(v.x * 0.3, v.y * 0.3, v.z * 0.3), 0.008 + Math.random() * 0.008);
      }
    },
  },
};
