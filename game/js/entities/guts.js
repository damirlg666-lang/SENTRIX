// A strand of intestine hanging between two body parts after someone is cut in half: a chain
// of small physics beads joined end to end, drawn as one smooth tube. Pulled too far, it snaps.
import * as THREE from 'three';
import { R, GROUPS } from '../engine/physics.js';
import { wetMaterial, GUT_COLOR } from '../characters/gore.js';

const SEG = 0.05; // bead spacing
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();

function worldOf(body, local, out) {
  const t = body.translation();
  const r = body.rotation();
  _q.set(r.x, r.y, r.z, r.w);
  return out.copy(local).applyQuaternion(_q).add(_v.set(t.x, t.y, t.z));
}

export class GutStrand {
  /**
   * a, b: { body, local (Vector3 in the body's frame) } — the two ends.
   */
  constructor(game, a, b, slack = 1.6) {
    this.game = game;
    this.a = a;
    this.b = b;
    const world = game.physics.world;
    const pa = worldOf(a.body, a.local, new THREE.Vector3());
    const pb = worldOf(b.body, b.local, new THREE.Vector3());
    const n = Math.max(4, Math.min(16, Math.round((pa.distanceTo(pb) * slack + 0.2) / SEG)));
    this.beads = [];
    for (let i = 1; i <= n; i++) {
      const t = i / (n + 1);
      const p = pa.clone().lerp(pb, t);
      p.y -= Math.sin(Math.PI * t) * 0.08; // starts with a little sag
      const body = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(p.x, p.y, p.z).setLinearDamping(0.6).setAngularDamping(1));
      world.createCollider(R.ColliderDesc.ball(0.017).setMass(0.06).setFriction(0.9).setRestitution(0).setCollisionGroups(GROUPS.debris), body);
      this.beads.push(body);
    }
    // joints along the chain: [a -> bead0], [bead_i -> bead_i+1], [bead_last -> b]
    this.links = [];
    const link = (b1, l1, b2, l2) => {
      const j = world.createImpulseJoint(R.JointData.rope(SEG, { x: l1.x, y: l1.y, z: l1.z }, { x: l2.x, y: l2.y, z: l2.z }), b1, b2, true);
      this.links.push(j);
    };
    const zero = new THREE.Vector3();
    link(a.body, a.local, this.beads[0], zero);
    for (let i = 0; i < this.beads.length - 1; i++) link(this.beads[i], zero, this.beads[i + 1], zero);
    link(this.beads[this.beads.length - 1], zero, b.body, b.local);
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), wetMaterial(GUT_COLOR));
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    game.scene.add(this.mesh);
    this.alive = true;
  }

  /** Snap any link pulled much past its length; redraw the strand. */
  update() {
    if (!this.alive) return;
    const world = this.game.physics.world;
    const pts = [worldOf(this.a.body, this.a.local, new THREE.Vector3())];
    for (const b of this.beads) {
      const t = b.translation();
      pts.push(new THREE.Vector3(t.x, t.y, t.z));
    }
    pts.push(worldOf(this.b.body, this.b.local, new THREE.Vector3()));
    const snap = (i) => {
      world.removeImpulseJoint(this.links[i], true);
      this.links[i] = null;
      this.game.fx?.bloodBurst(pts[i].clone().lerp(pts[i + 1], 0.5), new THREE.Vector3(0, 1, 0), 0.4);
    };
    for (let i = 0; i < this.links.length; i++) {
      const j = this.links[i];
      if (j && j.isValid() && pts[i].distanceTo(pts[i + 1]) > SEG * 3.5) snap(i);
    }
    // a strand pulled taut between the halves tears rather than tying them together
    if (this.links.every((j) => j?.isValid()) && pts[0].distanceTo(pts[pts.length - 1]) > this.links.length * SEG * 0.9) {
      snap(Math.floor(this.links.length * (0.3 + Math.random() * 0.4)));
    }
    // draw one tube per unbroken run of the chain
    const runs = [];
    let run = [pts[0]];
    for (let i = 0; i < this.links.length; i++) {
      if (this.links[i]?.isValid()) run.push(pts[i + 1]);
      else {
        runs.push(run);
        run = [pts[i + 1]];
      }
    }
    runs.push(run);
    const geos = [];
    for (const r of runs) {
      if (r.length < 2) continue;
      geos.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(r), r.length * 4, 0.016, 7));
    }
    this.mesh.geometry.dispose();
    this.mesh.geometry = geos.length === 1 ? geos[0] : mergeTubes(geos);
  }

  destroy() {
    if (!this.alive) return;
    this.alive = false;
    const world = this.game.physics.world;
    for (const b of this.beads) if (b.isValid()) world.removeRigidBody(b);
    this.game.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
  }
}

function mergeTubes(geos) {
  if (!geos.length) return new THREE.BufferGeometry();
  let nv = 0;
  let ni = 0;
  for (const g of geos) {
    nv += g.attributes.position.count;
    ni += g.index.count;
  }
  const pos = new Float32Array(nv * 3);
  const nrm = new Float32Array(nv * 3);
  const uv = new Float32Array(nv * 2);
  const idx = new Uint32Array(ni);
  let vo = 0;
  let io = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, vo * 3);
    nrm.set(g.attributes.normal.array, vo * 3);
    uv.set(g.attributes.uv.array, vo * 2);
    const gi = g.index.array;
    for (let k = 0; k < gi.length; k++) idx[io + k] = gi[k] + vo;
    vo += g.attributes.position.count;
    io += gi.length;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}
