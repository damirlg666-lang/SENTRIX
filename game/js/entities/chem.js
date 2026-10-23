// What syringes do once injected: each substance is a level that rises with every dose and
// wears off over time, changing a person's vitals and behaviour while it lasts.
import * as THREE from 'three';
import { B, BONE_COUNT } from '../characters/skeleton.js';
import { paintBind } from '../characters/humanModel.js';
import { healInjuries, fatalLoss } from './injury.js';

export const SUBSTANCES = {
  adrenaline: { name: 'Adrenaline', color: 0xff3b2f, decay: 1 / 40 },
  life: { name: 'Life serum', color: 0x35e06a, decay: 1 / 8 },
  acid: { name: 'Acid', color: 0xc6ff2a, decay: 1 / 8 },
  sedative: { name: 'Sedative', color: 0x3d8bff, decay: 1 / 60 },
};

export function initChem(p) {
  p.chem = { adrenaline: 0, life: 0, acid: 0, sedative: 0 };
  p.acidAt = null;
}

/** Add a dose (1 = one full syringe). `part`/`point` say where it went in. */
export function inject(p, type, amount, part = B.CHEST) {
  if (!p.chem || p.removed) return;
  p.chem[type] += amount;
  if (type === 'acid' && !p.acidAt) p.acidAt = { part, spread: 0.03 };
  if (type === 'life' && p.state === 'dead' && !fatalLoss(p) && p.deathTime < 90) p.heal();
}

/** Muscle and speed multipliers from what is in the blood. */
export function chemBoost(p) {
  const a = Math.min(1.5, p.chem.adrenaline);
  return { strength: 1 + 0.35 * Math.min(1, a), speed: 1 + 0.45 * Math.min(1, a) };
}

export function chemStatus(p) {
  const c = p.chem;
  if (c.acid > 0.05) return 'Dissolving';
  if (c.adrenaline > 2.2) return 'Heart racing!';
  if (c.adrenaline > 0.1) return 'Adrenaline rush';
  if (c.sedative > 0.1) return 'Sedated';
  if (c.life > 0.05) return 'Healing';
  return '';
}

export function updateChem(p, dt) {
  const c = p.chem;
  if (dt <= 0) return;
  const dead = p.state === 'dead';
  // adrenaline: wakes people up, numbs pain and stun; too much stops the heart
  if (c.adrenaline > 0) {
    if (!dead) {
      p.stun = Math.max(0, p.stun - dt * 3);
      p.pain = Math.max(0, p.pain - dt * 0.4);
      p.fear = Math.min(p.fear, 0.3);
      if (p.state === 'unconscious' && c.adrenaline > 0.3) {
        p.setState('down');
        p.recoverTime = 0.4;
      }
      if (c.adrenaline > 2.2) {
        p.health -= dt * 7 * (c.adrenaline - 2);
        p.pain = Math.min(1, p.pain + dt * 0.5);
        if (p.health <= 0) p.die('overdose');
      }
    }
    c.adrenaline = Math.max(0, c.adrenaline - dt * SUBSTANCES.adrenaline.decay * Math.max(1, c.adrenaline));
  }
  // life serum: closes wounds, refills blood, mends bones
  if (c.life > 0) {
    if (!dead) {
      p.health = Math.min(100, p.health + dt * 18);
      p.blood = Math.min(100, p.blood + dt * 12);
      p.bleed = Math.max(0, p.bleed - dt * 2);
      p.pain = Math.max(0, p.pain - dt * 0.3);
      c.acid = Math.max(0, c.acid - dt);
      if (p.broken.some((b) => b)) healInjuries(p);
    }
    c.life = Math.max(0, c.life - dt * SUBSTANCES.life.decay);
    p.lifeGlow = (p.lifeGlow ?? 0) + dt;
    if (p.lifeGlow > 0.08) {
      p.lifeGlow = 0;
      const t = p.ragdoll.bodies[Math.floor(Math.random() * BONE_COUNT)].translation();
      p.game.fx?.additive.add({
        x: t.x + (Math.random() - 0.5) * 0.2, y: t.y, z: t.z + (Math.random() - 0.5) * 0.2, vx: 0, vy: 0.5 + Math.random() * 0.5, vz: 0,
        life: 0.7, size0: 0.06, size1: 0.02, col0: [0.4, 1.6, 0.6], col1: [0.2, 1.0, 0.4], tile: 8, drag: 1,
      });
    }
  }
  // acid: eats the body from where it went in, spreading burns and fumes
  if (c.acid > 0) {
    if (!dead) {
      p.health -= dt * 20 * Math.min(2, c.acid);
      p.pain = 1;
      p.stun += dt * 1.6;
      if (p.voiceCooldown <= 0 && !p.dummy && p.conscious) {
        p.voiceCooldown = 0.6 + Math.random() * 0.6;
        p.game.audio?.voice(p, 0.9);
      }
      if (p.health <= 0) p.die('acid');
    }
    const at = p.acidAt;
    if (at) {
      at.spread = Math.min(0.55, at.spread + dt * 0.07 * Math.min(2, c.acid));
      at.tick = (at.tick ?? 0) + dt;
      const b = p.ragdoll.bodies[at.part];
      if (at.tick > 0.15) {
        at.tick = 0;
        if (p.ch) {
          const ctr = p.sk.centers[at.part];
          const r = at.spread;
          paintBind(p.ch, ctr[0] + (Math.random() - 0.5) * r, ctr[1] + (Math.random() - 0.5) * r, ctr[2] + (Math.random() - 0.5) * r, 0.05 + r * 0.4, 0.25, 1);
        }
        const t = b.translation();
        p.game.fx?.smoke(new THREE.Vector3(t.x, t.y + 0.05, t.z), 1, { size: 0.12, gray: 0.75, alpha: 0.35, speed: 0.4, life: 0.7 });
        p.game.fx?.additive.add({
          x: t.x + (Math.random() - 0.5) * 0.1, y: t.y + 0.05, z: t.z + (Math.random() - 0.5) * 0.1, vx: 0, vy: 0.4, vz: 0,
          life: 0.4, size0: 0.05, size1: 0.01, col0: [0.6, 1.2, 0.1], col1: [0.2, 0.5, 0.0], tile: 8, drag: 2,
        });
      }
    }
    c.acid = Math.max(0, c.acid - dt * SUBSTANCES.acid.decay);
    if (c.acid === 0) p.acidAt = null;
  }
  // sedative: out cold while it lasts
  if (c.sedative > 0) {
    if (!dead) {
      p.pain = Math.max(0, p.pain - dt * 0.5);
      p.fear = 0;
      if (c.sedative > 0.25 && p.state !== 'unconscious' && c.adrenaline < c.sedative) p.knockOut(4);
      else if (p.state === 'unconscious') p.unconsciousTimer = Math.max(p.unconsciousTimer, 1);
    }
    c.sedative = Math.max(0, c.sedative - dt * SUBSTANCES.sedative.decay);
  }
}

export function clearChem(p) {
  p.chem.acid = 0;
  p.chem.sedative = 0;
  p.chem.adrenaline = 0;
  p.acidAt = null;
}
