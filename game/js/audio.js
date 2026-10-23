// Procedural sound effects with the Web Audio API (no audio files needed).
import * as THREE from 'three';

const rnd = (a, b) => a + Math.random() * (b - a);

export class Audio {
  constructor(game) {
    this.game = game;
    this.ctx = null;
    this.volume = game.settings.volume ?? 0.7;
    this.rate = 1;
    this.lastImpact = 0;
    this.active = 0;
    this._v = new THREE.Vector3();
    this._f = new THREE.Vector3();
  }

  /** Must be called from a user gesture (browsers block audio until then). */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 6;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;
    this.master.connect(comp);
    comp.connect(ctx.destination);
    // reverb send
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(2.2, 2.6);
    this.reverbGain = ctx.createGain();
    this.reverbGain.gain.value = 0.32;
    this.reverb.connect(this.reverbGain);
    this.reverbGain.connect(this.master);
    // white noise source buffer
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  impulse(seconds, decay) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  setRate(r) {
    this.rate = r;
  }

  updateListener(camera) {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    const p = camera.position;
    camera.getWorldDirection(this._f);
    const t = this.ctx.currentTime;
    if (l.positionX) {
      l.positionX.setTargetAtTime(p.x, t, 0.02);
      l.positionY.setTargetAtTime(p.y, t, 0.02);
      l.positionZ.setTargetAtTime(p.z, t, 0.02);
      l.forwardX.setTargetAtTime(this._f.x, t, 0.02);
      l.forwardY.setTargetAtTime(this._f.y, t, 0.02);
      l.forwardZ.setTargetAtTime(this._f.z, t, 0.02);
      l.upX.value = 0;
      l.upY.value = 1;
      l.upZ.value = 0;
    } else if (l.setPosition) {
      l.setPosition(p.x, p.y, p.z);
      l.setOrientation(this._f.x, this._f.y, this._f.z, 0, 1, 0);
    }
  }

  panner(pos) {
    const pan = this.ctx.createPanner();
    pan.panningModel = 'equalpower';
    pan.distanceModel = 'inverse';
    pan.refDistance = 4;
    pan.rolloffFactor = 1.1;
    pan.maxDistance = 400;
    this.placePanner(pan, pos);
    return pan;
  }

  placePanner(pan, pos) {
    if (pan.positionX) {
      pan.positionX.value = pos.x;
      pan.positionY.value = pos.y;
      pan.positionZ.value = pos.z;
    } else pan.setPosition(pos.x, pos.y, pos.z);
  }

  /** Output node at a world position (or 2D if no position). Returns { input, end(t) }. */
  out(pos, gain = 1, reverb = 0.3) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.value = gain;
    let node = g;
    if (pos) {
      const pan = this.panner(pos);
      g.connect(pan);
      node = pan;
    }
    node.connect(this.master);
    if (reverb > 0) {
      const s = ctx.createGain();
      s.gain.value = reverb;
      node.connect(s);
      s.connect(this.reverb);
    }
    return g;
  }

  noiseSrc(dur) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    s.playbackRate.value = this.rate;
    s.start(this.ctx.currentTime, Math.random() * 1.5);
    s.stop(this.ctx.currentTime + dur / this.rate + 0.05);
    return s;
  }

  env(node, t0, attack, peak, decay) {
    const g = node.gain;
    g.setValueAtTime(0.0001, t0);
    g.exponentialRampToValueAtTime(peak, t0 + attack);
    g.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
  }

  canPlay() {
    return this.ctx && this.ctx.state === 'running' && this.volume > 0;
  }

  // ---------------------------------------------------------------- sounds
  gunshot(kind, pos) {
    if (!this.canPlay()) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const R = 1 / this.rate;
    const cfg = {
      pistol: { len: 0.22, f: 1800, body: 140, gain: 0.9, rv: 0.35 },
      rifle: { len: 0.28, f: 2400, body: 110, gain: 1.0, rv: 0.4 },
      shotgun: { len: 0.45, f: 1200, body: 80, gain: 1.2, rv: 0.5 },
      sniper: { len: 0.7, f: 1500, body: 60, gain: 1.4, rv: 0.7 },
      rocket: { len: 0.9, f: 700, body: 70, gain: 0.8, rv: 0.4 },
    }[kind] || { len: 0.22, f: 1800, body: 140, gain: 0.9, rv: 0.35 };
    const o = this.out(pos, cfg.gain, cfg.rv);
    // crack
    const n = this.noiseSrc(cfg.len);
    const bp = ctx.createBiquadFilter();
    bp.type = 'lowpass';
    bp.frequency.setValueAtTime(cfg.f * 3 * this.rate, t);
    bp.frequency.exponentialRampToValueAtTime(cfg.f * 0.3 * this.rate, t + cfg.len * R);
    const ng = ctx.createGain();
    this.env(ng, t, 0.002, 1, cfg.len * R);
    n.connect(bp);
    bp.connect(ng);
    ng.connect(o);
    // body thump
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(cfg.body * 2 * this.rate, t);
    osc.frequency.exponentialRampToValueAtTime(cfg.body * 0.4 * this.rate, t + 0.15 * R);
    const og = ctx.createGain();
    this.env(og, t, 0.002, 0.9, 0.18 * R);
    osc.connect(og);
    og.connect(o);
    osc.start(t);
    osc.stop(t + 0.25 * R);
    if (kind === 'rocket') {
      const w = this.noiseSrc(1.2);
      const lp = ctx.createBiquadFilter();
      lp.type = 'bandpass';
      lp.frequency.value = 900 * this.rate;
      lp.Q.value = 0.6;
      const wg = ctx.createGain();
      this.env(wg, t, 0.05, 0.6, 1.1 * R);
      w.connect(lp);
      lp.connect(wg);
      wg.connect(o);
    }
  }

  explosion(pos, power = 1) {
    if (!this.canPlay()) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const R = 1 / this.rate;
    const o = this.out(pos, 1.6 * Math.min(1.6, Math.sqrt(power)), 0.8);
    const len = 2.2 * Math.sqrt(power);
    const n = this.noiseSrc(len);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(3500 * this.rate, t);
    lp.frequency.exponentialRampToValueAtTime(120 * this.rate, t + len * R);
    const g = ctx.createGain();
    this.env(g, t, 0.004, 1.2, len * R);
    n.connect(lp);
    lp.connect(g);
    g.connect(o);
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(90 * this.rate, t);
    sub.frequency.exponentialRampToValueAtTime(22 * this.rate, t + 0.9 * R);
    const sg = ctx.createGain();
    this.env(sg, t, 0.005, 1.4, 1.0 * R);
    sub.connect(sg);
    sg.connect(o);
    sub.start(t);
    sub.stop(t + 1.2 * R);
    // crackle tail
    for (let i = 0; i < 6; i++) {
      const dt = rnd(0.1, 0.9) * R;
      const c = this.noiseSrc(0.05);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 1500;
      const cg = ctx.createGain();
      this.env(cg, t + dt, 0.002, rnd(0.1, 0.3), 0.05);
      c.connect(hp);
      hp.connect(cg);
      cg.connect(o);
    }
  }

  impact(material, strength, pos) {
    if (!this.canPlay()) return;
    const now = performance.now();
    if (now - this.lastImpact < 28 || strength < 0.06) return;
    this.lastImpact = now;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const R = 1 / this.rate;
    const s = Math.min(1, strength);
    const o = this.out(pos, 0.25 + s * 0.6, 0.15);
    if (material === 'metal') {
      const base = rnd(300, 700) * this.rate;
      for (const [mul, amp] of [[1, 0.5], [2.76, 0.3], [5.4, 0.2], [8.9, 0.1]]) {
        const osc = ctx.createOscillator();
        osc.frequency.value = base * mul;
        const g = ctx.createGain();
        this.env(g, t, 0.002, amp * s, (0.6 / mul + 0.15) * R);
        osc.connect(g);
        g.connect(o);
        osc.start(t);
        osc.stop(t + 1 * R);
      }
      return;
    }
    const freq = { wood: 700, flesh: 220, concrete: 380, rubber: 160, glass: 2500 }[material] || 400;
    const n = this.noiseSrc(0.2);
    const bp = ctx.createBiquadFilter();
    bp.type = material === 'flesh' ? 'lowpass' : 'bandpass';
    bp.frequency.value = freq * rnd(0.8, 1.2) * this.rate;
    bp.Q.value = material === 'wood' ? 3 : 0.9;
    const g = ctx.createGain();
    this.env(g, t, 0.002, 0.9 * s, (material === 'flesh' ? 0.12 : 0.09) * R);
    n.connect(bp);
    bp.connect(g);
    g.connect(o);
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(freq * 0.35 * this.rate, t);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.15 * this.rate, t + 0.1 * R);
    const og = ctx.createGain();
    this.env(og, t, 0.002, 0.6 * s, 0.1 * R);
    osc.connect(og);
    og.connect(o);
    osc.start(t);
    osc.stop(t + 0.2 * R);
  }

  bulletHit(material, pos) {
    if (!this.canPlay()) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const R = 1 / this.rate;
    if (material === 'metal' && Math.random() < 0.7) {
      const o = this.out(pos, 0.35, 0.25);
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(rnd(2800, 4200) * this.rate, t);
      osc.frequency.exponentialRampToValueAtTime(rnd(900, 1400) * this.rate, t + 0.35 * R);
      const g = ctx.createGain();
      this.env(g, t, 0.003, 0.5, 0.35 * R);
      osc.connect(g);
      g.connect(o);
      osc.start(t);
      osc.stop(t + 0.4 * R);
      return;
    }
    if (material === 'flesh') {
      const o = this.out(pos, 0.6, 0.1);
      const n = this.noiseSrc(0.12);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(1600 * this.rate, t);
      lp.frequency.exponentialRampToValueAtTime(200 * this.rate, t + 0.1 * R);
      const g = ctx.createGain();
      this.env(g, t, 0.002, 1, 0.11 * R);
      n.connect(lp);
      lp.connect(g);
      g.connect(o);
      return;
    }
    this.impact(material, 0.5, pos);
  }

  /** Short synthesized vocal reaction ("ugh!", "ah!") using formant filters. */
  voice(person, intensity = 0.5) {
    if (!this.canPlay()) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const R = 1 / this.rate;
    const female = person.outfit?.female;
    const base = (female ? rnd(200, 250) : rnd(105, 140)) * this.rate * (1 + intensity * 0.25);
    const pos = person.ragdoll.bodies[3].translation();
    const o = this.out(pos, 0.22 + intensity * 0.25, 0.2);
    const dur = (0.18 + intensity * 0.35) * R;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(base * 1.25, t);
    osc.frequency.linearRampToValueAtTime(base * (1.4 + intensity * 0.3), t + dur * 0.25);
    osc.frequency.exponentialRampToValueAtTime(base * 0.8, t + dur);
    const vib = ctx.createOscillator();
    vib.frequency.value = 7;
    const vg = ctx.createGain();
    vg.gain.value = base * 0.03;
    vib.connect(vg);
    vg.connect(osc.frequency);
    const vowels = [[730, 1090, 2440], [570, 840, 2410], [660, 1720, 2410], [520, 1190, 2390]];
    const f = vowels[Math.floor(Math.random() * vowels.length)];
    const mix = ctx.createGain();
    this.env(mix, t, 0.02, 1, dur);
    for (let i = 0; i < 3; i++) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f[i] * (female ? 1.15 : 1) * this.rate;
      bp.Q.value = 6 + i * 3;
      const g = ctx.createGain();
      g.gain.value = [1, 0.6, 0.25][i];
      osc.connect(bp);
      bp.connect(g);
      g.connect(mix);
    }
    // breathy noise
    const n = this.noiseSrc(dur);
    const nf = ctx.createBiquadFilter();
    nf.type = 'bandpass';
    nf.frequency.value = 1800;
    const ng = ctx.createGain();
    ng.gain.value = 0.12;
    n.connect(nf);
    nf.connect(ng);
    ng.connect(mix);
    mix.connect(o);
    osc.start(t);
    vib.start(t);
    osc.stop(t + dur + 0.05);
    vib.stop(t + dur + 0.05);
  }

  click(freq = 900) {
    if (!this.canPlay()) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = this.out(null, 0.08, 0);
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.6, t + 0.05);
    const g = ctx.createGain();
    this.env(g, t, 0.002, 1, 0.06);
    osc.connect(g);
    g.connect(o);
    osc.start(t);
    osc.stop(t + 0.08);
  }

  /** Simple looping-ish beep for armed explosives. */
  beep(pos, freq = 1800) {
    if (!this.canPlay()) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = this.out(pos, 0.25, 0.05);
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = freq;
    const g = ctx.createGain();
    this.env(g, t, 0.002, 0.4, 0.07);
    osc.connect(g);
    g.connect(o);
    osc.start(t);
    osc.stop(t + 0.1);
  }

  /**
   * A continuous sound that follows something around (thruster roar, flamethrower).
   * Returns { setPos(v), stop() } or null while audio is locked.
   */
  loop(kind, pos) {
    if (!this.canPlay()) return null;
    const ctx = this.ctx;
    const cfg = { thruster: ['lowpass', 650, 0.6, 0.7], flame: ['bandpass', 1100, 0.45, 0.6] }[kind] || ['lowpass', 800, 0.4, 0.7];
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.playbackRate.value = this.rate;
    const f = ctx.createBiquadFilter();
    f.type = cfg[0];
    f.frequency.value = cfg[1];
    f.Q.value = cfg[3];
    const g = ctx.createGain();
    g.gain.value = 0.0001;
    g.gain.setTargetAtTime(cfg[2], ctx.currentTime, 0.05);
    const pan = this.panner(pos);
    src.connect(f);
    f.connect(g);
    g.connect(pan);
    pan.connect(this.master);
    src.start(ctx.currentTime, Math.random());
    let stopped = false;
    return {
      setPos: (p) => this.placePanner(pan, p),
      stop: () => {
        if (stopped) return;
        stopped = true;
        const t = ctx.currentTime;
        g.gain.setTargetAtTime(0.0001, t, 0.06);
        src.stop(t + 0.5);
      },
    };
  }

  /** Electric discharge: a sharp crackle over a short mains-like buzz. */
  zap(pos, strength = 1) {
    if (!this.canPlay()) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const R = 1 / this.rate;
    const o = this.out(pos, 0.55 * strength, 0.2);
    for (let i = 0; i < 4; i++) {
      const t0 = t + rnd(0, 0.08) * R;
      const n = this.noiseSrc(0.04);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = rnd(2500, 5000) * this.rate;
      const g = ctx.createGain();
      this.env(g, t0, 0.001, rnd(0.4, 1), 0.03 * R);
      n.connect(hp);
      hp.connect(g);
      g.connect(o);
    }
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = rnd(95, 125) * this.rate;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1800;
    const og = ctx.createGain();
    this.env(og, t, 0.003, 0.35, 0.16 * R);
    osc.connect(lp);
    lp.connect(og);
    og.connect(o);
    osc.start(t);
    osc.stop(t + 0.22 * R);
  }

  /** Firework burst: a hollow pop followed by a scatter of crackles. */
  firework(pos) {
    if (!this.canPlay()) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const R = 1 / this.rate;
    const o = this.out(pos, 0.9, 0.7);
    const n = this.noiseSrc(0.5);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2200 * this.rate, t);
    lp.frequency.exponentialRampToValueAtTime(150 * this.rate, t + 0.4 * R);
    const g = ctx.createGain();
    this.env(g, t, 0.003, 1, 0.45 * R);
    n.connect(lp);
    lp.connect(g);
    g.connect(o);
    for (let i = 0; i < 14; i++) {
      const t0 = t + (0.35 + Math.random() * 0.9) * R;
      const c = this.noiseSrc(0.03);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 3000;
      const cg = ctx.createGain();
      this.env(cg, t0, 0.001, rnd(0.08, 0.25), 0.025);
      c.connect(hp);
      hp.connect(cg);
      cg.connect(o);
    }
  }

  /** Bone snapping: a dry, bright crack with a short woody knock. */
  crack(pos) {
    if (!this.canPlay()) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const R = 1 / this.rate;
    const o = this.out(pos, 0.7, 0.1);
    for (let i = 0; i < 2; i++) {
      const t0 = t + i * rnd(0.012, 0.03) * R;
      const n = this.noiseSrc(0.06);
      const hp = ctx.createBiquadFilter();
      hp.type = 'bandpass';
      hp.frequency.value = rnd(2200, 3600) * this.rate;
      hp.Q.value = 1.5;
      const g = ctx.createGain();
      this.env(g, t0, 0.001, i ? 0.5 : 1, 0.035 * R);
      n.connect(hp);
      hp.connect(g);
      g.connect(o);
    }
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(900 * this.rate, t);
    osc.frequency.exponentialRampToValueAtTime(240 * this.rate, t + 0.05 * R);
    const og = ctx.createGain();
    this.env(og, t, 0.001, 0.5, 0.06 * R);
    osc.connect(og);
    og.connect(o);
    osc.start(t);
    osc.stop(t + 0.1 * R);
  }

  /** A blade landing: a bright slice plus a wet (or plasticky, for dummies) thud. */
  blade(kind, pos, dummy = false) {
    if (!this.canPlay()) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const R = 1 / this.rate;
    const o = this.out(pos, 0.7, 0.12);
    if (kind !== 'stab') {
      const n = this.noiseSrc(0.12);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 2500 * this.rate;
      const g = ctx.createGain();
      this.env(g, t, 0.002, 0.5, 0.09 * R);
      n.connect(hp);
      hp.connect(g);
      g.connect(o);
    }
    const n2 = this.noiseSrc(0.2);
    const lp = ctx.createBiquadFilter();
    lp.type = dummy ? 'bandpass' : 'lowpass';
    lp.Q.value = dummy ? 2 : 4;
    lp.frequency.setValueAtTime((dummy ? 700 : 1100) * this.rate, t);
    lp.frequency.exponentialRampToValueAtTime((dummy ? 400 : 160) * this.rate, t + 0.15 * R);
    const g2 = ctx.createGain();
    this.env(g2, t, 0.003, kind === 'chop' ? 1.1 : 0.8, (kind === 'stab' ? 0.1 : 0.16) * R);
    n2.connect(lp);
    lp.connect(g2);
    g2.connect(o);
  }

  /** Wet tearing for dismemberment: a crack buried in a low, squelchy noise burst. */
  gore(pos, strength = 1) {
    if (!this.canPlay()) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const R = 1 / this.rate;
    const o = this.out(pos, 0.8 * strength, 0.15);
    const n = this.noiseSrc(0.4);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 6;
    lp.frequency.setValueAtTime(1400 * this.rate, t);
    lp.frequency.exponentialRampToValueAtTime(180 * this.rate, t + 0.3 * R);
    const g = ctx.createGain();
    this.env(g, t, 0.004, 1, 0.32 * R);
    n.connect(lp);
    lp.connect(g);
    g.connect(o);
    this.crack(pos);
  }

  whoosh(pos, strength = 1) {
    if (!this.canPlay()) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = this.out(pos, 0.3 * strength, 0.1);
    const n = this.noiseSrc(0.4);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(300, t);
    bp.frequency.exponentialRampToValueAtTime(1500, t + 0.25);
    const g = ctx.createGain();
    this.env(g, t, 0.06, 0.7, 0.3);
    n.connect(bp);
    bp.connect(g);
    g.connect(o);
  }
}
