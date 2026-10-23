// How people react to being hurt: flinching away from a hit, staggering, clutching the wound,
// limping on a bad leg, writhing on the ground and twitching after a violent death.
// Everything here only nudges the target pose (and the balance drive); physics does the rest.
import * as THREE from 'three';
import { B, BONE_COUNT } from '../characters/skeleton.js';

const LEG_L = [B.THIGH_L, B.SHIN_L, B.FOOT_L];
const LEG_R = [B.THIGH_R, B.SHIN_R, B.FOOT_R];
const ARM_L = [B.UARM_L, B.FARM_L, B.HAND_L];
const ARM_R = [B.UARM_R, B.FARM_R, B.HAND_R];

const _v = new THREE.Vector3();

export function initReactions(p) {
  p.flinch = null; // { t, f, r, s }
  p.stagger = null; // { t, vx, vz }
  p.clutch = null; // { region, side, until }
  p.limp = 0;
  p.limpSide = 0;
  p.twitch = 0;
  p.twitchUntil = 0;
  p.rollTimer = 2;
}

function region(part) {
  if (part === B.HEAD) return 'head';
  if (part === B.CHEST) return 'chest';
  if (part === B.SPINE || part === B.PELVIS) return 'belly';
  if (ARM_L.includes(part) || ARM_R.includes(part)) return 'arm';
  return 'leg';
}

function side(part, p, point) {
  if (ARM_L.includes(part) || LEG_L.includes(part)) return 1;
  if (ARM_R.includes(part) || LEG_R.includes(part)) return -1;
  // torso: which side of the body the hit landed on
  if (!point) return Math.random() < 0.5 ? 1 : -1;
  const c = p.ragdoll.bodies[B.CHEST].translation();
  const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw); // the person's left (+X in bind space)
  return (point.x - c.x) * rx + (point.z - c.z) * rz >= 0 ? 1 : -1;
}

/** Called from Person.damage for every hit that registers. */
export function react(p, part, point, dir, dmg, kind) {
  if (!p.conscious || dmg < 2) return;
  const s = Math.min(1, dmg / 30);
  if (dir) {
    // hit direction in the person's own frame: f > 0 pushes them forward, r > 0 to their left
    const f = dir.x * Math.sin(p.yaw) + dir.z * Math.cos(p.yaw);
    const r = dir.x * Math.cos(p.yaw) - dir.z * Math.sin(p.yaw);
    p.flinch = { t: 0, f, r, s: Math.max(p.flinch?.s ?? 0, 0.35 + 0.65 * s) };
    if (p.state === 'active' && !p.held) {
      const k = Math.min(2.4, 0.6 + dmg / 14);
      p.stagger = { t: 0.5, vx: dir.x * k, vz: dir.z * k };
    }
  } else {
    p.flinch = { t: 0, f: -0.5, r: 0, s: 0.4 + 0.6 * s };
  }
  const reg = region(part);
  // a new wound only takes the hands away from an older one if it is at least as bad
  const keep = p.clutch && p.time < p.clutch.until && p.clutch.dmg > dmg;
  if ((kind === 'bullet' || kind === 'cut' || dmg > 10) && kind !== 'shock' && !keep) {
    p.clutch = { region: reg, side: side(part, p, point), until: p.time + 3 + Math.min(8, dmg / 6), dmg };
  }
  // a leg that has been shot or cut gives way, and the person limps on it afterwards
  if (reg === 'leg' && (kind === 'bullet' || kind === 'cut') && dmg >= 10) {
    p.limp = Math.min(1, p.limp + dmg / 25);
    p.limpSide = side(part, p, point);
    if (dmg >= 16 && p.state === 'active') p.fall();
  }
  if (reg === 'belly' && dmg >= 22 && p.state === 'active' && Math.random() < 0.6) p.fall();
}

/** Extra horizontal velocity for the balance controller while staggering. */
export function staggerVelocity(p, dt) {
  const st = p.stagger;
  if (!st) return null;
  st.t -= dt;
  if (st.t <= 0) {
    p.stagger = null;
    return null;
  }
  const k = st.t / 0.5;
  st.x = st.vx * k;
  st.z = st.vz * k;
  return st;
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** Put the hand(s) on the wound. Arms are mirrored by side: +1 = the person's left. */
function clutchPose(p, pose, c, down) {
  const reach = (arm, x, z, elbow, hand = 0) => {
    const left = arm === ARM_L;
    pose[arm[0]][0] = x;
    pose[arm[0]][1] = 0;
    pose[arm[0]][2] = clamp(left ? -z : z, -0.85, 0.85);
    pose[arm[1]][0] = elbow;
    pose[arm[2]][0] = hand;
  };
  // the hand on the opposite side reaches across; with a hurt arm the good hand holds it
  const other = c.side > 0 ? ARM_R : ARM_L;
  const same = c.side > 0 ? ARM_L : ARM_R;
  switch (c.region) {
    case 'head':
      reach(ARM_L, -1.85, 0.3, 2.3);
      reach(ARM_R, -1.85, 0.3, 2.3);
      pose[B.HEAD][0] += 0.25;
      break;
    case 'chest':
      reach(other, -0.8, 0.85, 1.95);
      reach(same, -0.45, 0.6, 1.5);
      pose[B.CHEST][0] += 0.15;
      break;
    case 'belly':
      reach(other, -0.5, 0.85, 1.55, 0.2);
      reach(same, -0.35, 0.7, 1.35, 0.2);
      pose[B.SPINE][0] += down ? 0.3 : 0.35;
      pose[B.CHEST][0] += 0.2;
      break;
    case 'arm':
      reach(other, -0.65, 0.85, 1.3);
      reach(same, -0.3, 0.75, 1.25);
      break;
    default: {
      // a leg: double over and hold it
      reach(same, -0.45, 0.35, 0.35);
      if (down) reach(other, -0.6, 0.6, 0.6);
      pose[B.SPINE][0] += down ? 0.25 : 0.3;
      const leg = c.side > 0 ? LEG_L : LEG_R;
      if (down) {
        pose[leg[0]][0] = -1.3;
        pose[leg[1]][0] = 1.8;
      }
    }
  }
}

/**
 * Adjust the state's target pose. Returns a muscle-strength override (or null).
 */
export function applyReactions(p, pose, dt) {
  let strength = null;
  const down = p.state === 'down' || p.state === 'falling';
  // clutching the wound while conscious and not busy getting up
  if (p.clutch) {
    if (p.time > p.clutch.until || !p.conscious) p.clutch = null;
    else if (p.state !== 'getup' && !p.held && !p.controlled) clutchPose(p, pose, p.clutch, down);
  }
  // flinch: the torso and head snap away from the hit, arms jerk up
  const fl = p.flinch;
  if (fl) {
    fl.t += dt;
    if (fl.t > 0.4) p.flinch = null;
    else {
      const e = Math.sin((Math.PI * fl.t) / 0.4) * fl.s;
      pose[B.SPINE][0] += fl.f * 0.45 * e;
      pose[B.CHEST][0] += fl.f * 0.4 * e;
      pose[B.HEAD][0] += fl.f * 0.7 * e;
      pose[B.SPINE][2] += fl.r * 0.3 * e;
      pose[B.CHEST][2] += fl.r * 0.25 * e;
      if (!p.clutch) {
        pose[B.UARM_L][0] -= 0.5 * e;
        pose[B.UARM_R][0] -= 0.5 * e;
        pose[B.FARM_L][0] += 0.6 * e;
        pose[B.FARM_R][0] += 0.6 * e;
      }
    }
  }
  // limping: the bad leg takes short, stiff steps and the body dips over it
  if (p.limp > 0) {
    p.limp = Math.max(0, p.limp - dt / 60);
    if (p.state === 'active' && p.speed > 0.2) {
      const leg = p.limpSide > 0 ? LEG_L : LEG_R;
      pose[leg[0]][0] *= 1 - 0.5 * p.limp;
      pose[leg[1]][0] *= 1 - 0.6 * p.limp;
      pose[B.SPINE][2] += p.limpSide * 0.12 * p.limp * Math.max(0, Math.sin(p.phase));
    }
  }
  // writhing: people in pain on the ground roll from side to side and curl up
  if (p.state === 'down' && p.conscious && p.pain > 0.45 && !p.held) {
    p.rollTimer -= dt;
    if (p.rollTimer <= 0) {
      p.rollTimer = 1.6 + Math.random() * 2.4;
      const pel = p.ragdoll.bodies[B.PELVIS];
      const ch = p.ragdoll.bodies[B.CHEST];
      const a = pel.translation();
      const b = ch.translation();
      _v.set(b.x - a.x, b.y - a.y, b.z - a.z).normalize();
      const k = (Math.random() < 0.5 ? -1 : 1) * p.mass * 0.9 * p.pain;
      for (const body of [pel, ch]) body.applyTorqueImpulse({ x: _v.x * k * 0.1, y: _v.y * k * 0.1, z: _v.z * k * 0.1 }, true);
    }
    const t = p.time * 2.3;
    pose[B.THIGH_L][0] -= 0.35 + Math.sin(t) * 0.25;
    pose[B.THIGH_R][0] -= 0.35 + Math.sin(t + 1.3) * 0.25;
    pose[B.SHIN_L][0] += 0.5;
    pose[B.SHIN_R][0] += 0.5;
    strength = 0.32 + 0.15 * p.pain;
  }
  // death throes after a violent death: a few fading jerks
  if (p.state === 'dead' && p.time < p.twitchUntil) {
    p.twitch -= dt;
    if (p.twitch <= 0) {
      p.twitch = 0.25 + Math.random() * 0.6;
      p.twitchPose = [];
      for (let i = 0; i < BONE_COUNT; i++) p.twitchPose.push([(Math.random() - 0.5) * 0.9, (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.3]);
      p.twitchOn = 0.12;
    }
    if (p.twitchOn > 0 && p.twitchPose) {
      p.twitchOn -= dt;
      const fade = (p.twitchUntil - p.time) / 3;
      for (let i = 1; i < BONE_COUNT; i++) for (let k = 0; k < 3; k++) pose[i][k] += p.twitchPose[i][k];
      strength = 0.35 * fade;
    }
  }
  return strength;
}

/** Violent deaths get a few seconds of twitching; bleeding out does not. */
export function onDeath(p, cause) {
  if (cause === 'bullet' || cause === 'head' || cause === 'explosion' || cause === 'blunt' || cause === 'cut' || cause === 'electrocuted' || cause === 'decapitated' || cause === 'cut in half') {
    p.twitchUntil = p.time + 1.5 + Math.random() * 2;
    p.twitch = 0.1;
  }
  p.clutch = null;
  p.flinch = null;
  p.stagger = null;
}
