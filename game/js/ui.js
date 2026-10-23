// HUD: toolbar, spawn catalog (with rendered 3D thumbnails), settings, help, hover info.
import * as THREE from 'three';
import { CATEGORIES } from './catalog/catalog.js';
import { WEAPONS, grenadeModel } from './catalog/weapons.js';
import { TOOL_IDS, EXPLODE_SIZES } from './tools/tools.js';
import { createCharacterMesh, randomOutfit, dummyOutfit, prepareModels } from './characters/humanModel.js';
import { B } from './characters/skeleton.js';
import { carModel } from './entities/vehicle.js';
import { PROPS } from './catalog/props.js';
import { ST } from './entities/person.js';

const $ = (id) => document.getElementById(id);

const ICONS = {
  hand: '<svg viewBox="0 0 24 24"><path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12"/><path d="M11 11.5v-7a1.5 1.5 0 0 1 3 0v7"/><path d="M14 11.5V6a1.5 1.5 0 0 1 3 0v8"/><path d="M8 13l-1.6-1.8a1.6 1.6 0 0 0-2.4 2.1l3.4 4.4A6 6 0 0 0 12.2 20H13a5 5 0 0 0 5-5v-1"/></svg>',
  weapon: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/><circle cx="12" cy="12" r="1.2"/></svg>',
  explode: '<svg viewBox="0 0 24 24"><path d="M12 2l1.8 5.2L19 5l-2.2 5.2L22 12l-5.2 1.8L19 19l-5.2-2.2L12 22l-1.8-5.2L5 19l2.2-5.2L2 12l5.2-1.8L5 5l5.2 2.2z"/></svg>',
  rope: '<svg viewBox="0 0 24 24"><circle cx="5" cy="5" r="2.2"/><circle cx="19" cy="19" r="2.2"/><path d="M6.6 6.6c3 2 1 5 4 7s5-1 6.8 3.8"/></svg>',
  push: '<svg viewBox="0 0 24 24"><path d="M3 8h10a3 3 0 1 0-3-3"/><path d="M3 12h15a3 3 0 1 1-3 3"/><path d="M3 16h7"/></svg>',
  freeze: '<svg viewBox="0 0 24 24"><path d="M12 2v20M4.2 6.5l15.6 11M4.2 17.5l15.6-11"/><path d="M9.5 3.5 12 6l2.5-2.5M9.5 20.5 12 18l2.5 2.5"/></svg>',
  heal: '<svg viewBox="0 0 24 24"><path d="M20.8 8.6a5 5 0 0 0-8.8-3.2 5 5 0 0 0-8.8 3.2c0 5.6 8.8 11.4 8.8 11.4s8.8-5.8 8.8-11.4z"/><path d="M12 9v6M9 12h6"/></svg>',
  delete: '<svg viewBox="0 0 24 24"><path d="M20 20H9L4.5 15.5a2 2 0 0 1 0-2.8l8.7-8.7a2 2 0 0 1 2.8 0l4 4a2 2 0 0 1 0 2.8L13 18"/><path d="M8 11l6 6"/></svg>',
  control: '<svg viewBox="0 0 24 24"><path d="M6 11h4M8 9v4M15 12h.01M18 10h.01"/><path d="M17.3 5H6.7a4 4 0 0 0-4 3.6l-.9 7.6A2.6 2.6 0 0 0 4.4 19c.8 0 1.5-.4 2-1l1.6-2h8l1.6 2c.5.6 1.2 1 2 1a2.6 2.6 0 0 0 2.6-2.8l-.9-7.6a4 4 0 0 0-4-3.6z"/></svg>',
};
const TOOL_NAMES = { hand: 'Hand', weapon: 'Weapons', explode: 'Explode', rope: 'Rope', push: 'Force', freeze: 'Freeze', heal: 'Heal', delete: 'Delete', control: 'Control' };
const EXPLODE_ICON = '<svg viewBox="0 0 24 24"><path d="M12 3l1.5 4.5L18 6l-1.6 4.4L21 12l-4.6 1.6L18 18l-4.5-1.5L12 21l-1.5-4.5L6 18l1.6-4.4L3 12l4.6-1.6L6 6l4.5 1.5z"/></svg>';

const CROSSHAIR = '<svg viewBox="0 0 22 22" width="22" height="22" style="stroke:#fff;stroke-width:1.6;fill:none;filter:drop-shadow(0 0 2px #000)"><circle cx="11" cy="11" r="1.2" fill="#fff"/><path d="M11 1v6M11 15v6M1 11h6M15 11h6"/></svg>';

/** Small offscreen renderer that turns models into menu thumbnails. */
class ThumbRenderer {
  constructor(size = 160) {
    this.size = size;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(size, size, false);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    // studio lighting + a small room environment for reflections
    const env = new THREE.Scene();
    env.background = new THREE.Color(0x5a6270);
    const lightBox = (c, i, x, y, z, s) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(i) }));
      m.position.set(x, y, z);
      env.add(m);
    };
    lightBox(0xffffff, 6, 3, 4, 3, 2);
    lightBox(0xcfe2ff, 3, -4, 2, -1, 2);
    lightBox(0xffe6cc, 2, 0, -3, 4, 2);
    const pm = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pm.fromScene(env, 0.04).texture;
    pm.dispose();
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(3, 5, 4);
    const rim = new THREE.DirectionalLight(0xbcd7ff, 1.6);
    rim.position.set(-4, 3, -4);
    this.scene.add(key, rim, new THREE.HemisphereLight(0xffffff, 0x404050, 0.5));
    this.camera = new THREE.PerspectiveCamera(26, 1, 0.01, 100);
  }

  render(object, view = [1, 0.55, 1.5]) {
    this.scene.add(object);
    object.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(object, true);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(size.length() * 0.5, 0.05);
    const dist = radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 0.92;
    const dir = new THREE.Vector3(...view).normalize();
    this.camera.position.copy(center).addScaledVector(dir, dist);
    this.camera.near = dist / 50;
    this.camera.far = dist * 4;
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(center);
    this.renderer.render(this.scene, this.camera);
    const url = this.renderer.domElement.toDataURL('image/png');
    this.scene.remove(object);
    return url;
  }

  dispose() {
    this.renderer.dispose();
    this.renderer.forceContextLoss?.();
  }
}

/** Lower the A-pose arms so thumbnails show a relaxed stance. */
function relaxArms(ch) {
  const sk = ch.template.sk;
  for (const [S, s, bones] of [['L', 1, [B.UARM_L, B.FARM_L, B.HAND_L]], ['R', -1, [B.UARM_R, B.FARM_R, B.HAND_R]]]) {
    const sh = new THREE.Vector3(...sk.j['shoulder' + S]);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -s * 0.5);
    for (const b of bones) {
      const c = new THREE.Vector3(...sk.centers[b]);
      ch.bones[b].position.copy(c.sub(sh).applyQuaternion(q).add(sh));
      ch.bones[b].quaternion.copy(q);
    }
  }
}

export class UI {
  constructor(game) {
    this.game = game;
    this.tools = game.tools;
    this.thumbs = new Map();
    this.toastTimer = 0;
    this.fpsFrames = 0;
    this.fpsTime = 0;
    this.fps = 0;
    this.statTimer = 0;
    this.activeCategory = CATEGORIES[0].id;
    this.buildToolbar();
    this.buildCatalog();
    this.bindTop();
    this.bindSettings();
    $('crosshair').innerHTML = CROSSHAIR;
    this.tools.on((type, data) => this.onToolEvent(type, data));
    this.updateHint();
    if (window.innerWidth < 760) this.setCatalogOpen(false);
  }

  // ------------------------------------------------------------------ toolbar
  buildToolbar() {
    const bar = $('toolbar');
    bar.innerHTML = '';
    TOOL_IDS.forEach((id, i) => {
      const b = document.createElement('button');
      b.className = 'tool';
      b.dataset.tool = id;
      b.innerHTML = `${ICONS[id]}<span>${TOOL_NAMES[id]}</span><kbd>${i + 1}</kbd>`;
      b.title = `${TOOL_NAMES[id]} (${i + 1})`;
      b.addEventListener('click', () => {
        this.game.audio?.unlock();
        this.tools.select(id);
      });
      bar.appendChild(b);
    });
    this.refreshToolbar();
  }

  refreshToolbar() {
    const t = this.tools;
    for (const b of $('toolbar').children) b.classList.toggle('active', !t.spawnItem && b.dataset.tool === t.active);
    const wb = $('weapon-bar');
    if (t.active === 'weapon' && !t.spawnItem) {
      wb.classList.remove('hidden');
      wb.innerHTML = '';
      WEAPONS.forEach((w, i) => {
        const b = document.createElement('button');
        b.className = 'tool' + (i === t.weaponIndex ? ' active' : '');
        const img = this.thumbs.get('w_' + w.id);
        b.innerHTML = `${img ? `<img src="${img}" alt="" style="width:46px;height:30px;object-fit:contain">` : ICONS.weapon}<span>${w.name}</span>`;
        b.addEventListener('click', () => this.tools.selectWeapon(i));
        wb.appendChild(b);
      });
    } else if (t.active === 'explode' && !t.spawnItem) {
      wb.classList.remove('hidden');
      wb.innerHTML = '';
      EXPLODE_SIZES.forEach((s, i) => {
        const b = document.createElement('button');
        b.className = 'tool' + (i === t.explodeIndex ? ' active' : '');
        b.innerHTML = `<span style="transform:scale(${0.75 + i * 0.25});display:grid">${EXPLODE_ICON}</span><span>${s.name}</span>`;
        b.addEventListener('click', () => {
          t.explodeIndex = i;
          this.refreshToolbar();
        });
        wb.appendChild(b);
      });
    } else wb.classList.add('hidden');
    const weaponMode = t.active === 'weapon' && !t.spawnItem;
    $('crosshair').classList.toggle('hidden', !weaponMode);
    document.getElementById('view').style.cursor = weaponMode ? 'none' : t.spawnItem ? 'copy' : t.active === 'hand' ? 'grab' : 'crosshair';
  }

  // ------------------------------------------------------------------ catalog
  buildCatalog() {
    const tabs = $('cat-tabs');
    tabs.innerHTML = '';
    for (const c of CATEGORIES) {
      const b = document.createElement('button');
      b.textContent = c.name;
      b.dataset.cat = c.id;
      b.addEventListener('click', () => {
        this.activeCategory = c.id;
        this.renderCatalogItems();
      });
      tabs.appendChild(b);
    }
    this.renderCatalogItems();
    $('btn-catalog-toggle').addEventListener('click', () => this.setCatalogOpen(false));
    $('catalog-open').addEventListener('click', () => this.setCatalogOpen(true));
  }

  setCatalogOpen(open) {
    $('catalog').classList.toggle('closed', !open);
    $('catalog-open').classList.toggle('hidden', open);
    this.catalogOpen = open;
  }

  toggleCatalog() {
    this.setCatalogOpen(!this.catalogOpen);
  }

  renderCatalogItems() {
    for (const b of $('cat-tabs').children) b.classList.toggle('active', b.dataset.cat === this.activeCategory);
    const wrap = $('cat-items');
    wrap.innerHTML = '';
    const cat = CATEGORIES.find((c) => c.id === this.activeCategory);
    for (const item of cat.items) {
      const b = document.createElement('button');
      b.className = 'item' + (this.tools.spawnItem === item ? ' active' : '');
      const img = this.thumbs.get(item.id);
      b.innerHTML = `${img ? `<img src="${img}" alt="">` : '<div class="thumb-ph"></div>'}<span>${item.name}</span>${item.desc ? `<small>${item.desc}</small>` : ''}`;
      b.addEventListener('click', () => {
        this.game.audio?.unlock();
        this.game.audio?.click(1100);
        if (this.tools.spawnItem === item) this.tools.cancel();
        else this.tools.selectSpawn(item);
        if (window.innerWidth < 760) this.setCatalogOpen(false);
      });
      wrap.appendChild(b);
    }
  }

  /** Render thumbnails for every catalog item and weapon (call after models are ready). */
  async renderThumbnails(quality) {
    const tr = new ThumbRenderer(160);
    const yieldFrame = () => new Promise((r) => setTimeout(r, 0));
    try {
      const people = {
        person: ['male'], man: ['male'], woman: ['female'], big: ['heavy'], slim: ['slim'], crowd: ['female', 'male', 'heavy'], dummy: ['male'],
      };
      let seed = 11;
      const rnd = () => {
        seed = (seed * 16807) % 2147483647;
        return seed / 2147483647;
      };
      for (const cat of CATEGORIES) {
        for (const item of cat.items) {
          let obj;
          if (item.person) {
            obj = new THREE.Group();
            const types = people[item.id] || ['male'];
            types.forEach((t, i) => {
              const ch = createCharacterMesh(t, item.dummy ? dummyOutfit() : randomOutfit(t, rnd), quality);
              relaxArms(ch);
              ch.root.position.x = (i - (types.length - 1) / 2) * 0.7;
              ch.root.position.z = -Math.abs(i - 1) * 0.3;
              obj.add(ch.root);
            });
            this.thumbs.set(item.id, tr.render(obj, [0.25, 0.25, 1.5]));
          } else if (item.id === 'car') {
            obj = carModel(0xb3151b);
            this.thumbs.set(item.id, tr.render(obj, [1.2, 0.5, 1.3]));
          } else if (item.id === 'brickWall') {
            obj = new THREE.Group();
            for (let r = 0; r < 5; r++) {
              for (let c = 0; c < 4; c++) {
                const m = PROPS.brick.build({}).mesh;
                m.position.set((c + (r % 2 ? 0.5 : 0)) * 0.218, r * 0.0655, 0);
                obj.add(m);
              }
            }
            this.thumbs.set(item.id, tr.render(obj));
          } else if (item.id === 'dominoes') {
            obj = new THREE.Group();
            for (let i = 0; i < 4; i++) {
              const m = PROPS.domino.build({}).mesh;
              m.position.set(0, 0, i * 0.42);
              if (i === 3) m.rotation.x = 0.5;
              obj.add(m);
            }
            this.thumbs.set(item.id, tr.render(obj, [1.4, 0.6, 0.6]));
          } else if (item.id === 'balloonBunch') {
            obj = new THREE.Group();
            [0xe52b2b, 0x2b7be5, 0xf2c12e, 0x3fbf5a, 0xd94fd1].forEach((c, i) => {
              const m = PROPS.balloon.build({ color: c }).mesh;
              m.position.set((i % 3) * 0.35 - 0.35, (i > 2 ? 0.35 : 0), i * 0.05);
              obj.add(m);
            });
            this.thumbs.set(item.id, tr.render(obj));
          } else if (item.def) {
            obj = item.def.build({}).mesh;
            this.thumbs.set(item.id, tr.render(obj));
          }
          await yieldFrame();
        }
      }
      for (const w of WEAPONS) {
        const m = w.id === 'grenade' ? grenadeModel() : w.model();
        this.thumbs.set('w_' + w.id, tr.render(m, [1.6, 0.35, 0.05]));
      }
    } catch (e) {
      console.warn('thumbnail rendering failed', e);
    }
    tr.dispose();
    this.renderCatalogItems();
    this.refreshToolbar();
  }

  // ------------------------------------------------------------------ top bar
  bindTop() {
    const g = this.game;
    $('btn-undo').addEventListener('click', () => this.undo());
    $('btn-slowmo').addEventListener('click', () => this.toggleSlowmo());
    $('btn-pause').addEventListener('click', () => this.togglePause());
    $('btn-clear').addEventListener('click', () => {
      g.clearAll();
      this.toast('Cleared');
    });
    $('btn-settings').addEventListener('click', () => this.openModal('settings'));
    $('btn-help').addEventListener('click', () => this.openModal('help'));
    for (const el of document.querySelectorAll('[data-close]')) el.addEventListener('click', () => this.closeModal(el.dataset.close));
    for (const m of document.querySelectorAll('.modal')) {
      m.addEventListener('pointerdown', (e) => {
        if (e.target === m) this.closeModal(m.id);
      });
    }
  }

  undo() {
    if (this.game.undo()) this.toast('Removed last spawn');
  }

  toggleSlowmo() {
    this.game.setSlowmo(!this.game.slowmo);
    $('btn-slowmo').classList.toggle('active', this.game.slowmo);
    $('slowmo-badge').classList.toggle('hidden', !this.game.slowmo);
  }

  togglePause() {
    this.game.paused = !this.game.paused;
    $('btn-pause').classList.toggle('active', this.game.paused);
    $('paused-badge').classList.toggle('hidden', !this.game.paused);
  }

  openModal(id) {
    $(id).classList.remove('hidden');
    this.modalOpen = id;
  }

  closeModal(id) {
    $(id).classList.add('hidden');
    if (this.modalOpen === id) this.modalOpen = null;
  }

  closeAnyModal() {
    if (!this.modalOpen) return false;
    this.closeModal(this.modalOpen);
    return true;
  }

  // ------------------------------------------------------------------ settings
  bindSettings() {
    const g = this.game;
    const s = g.settings;
    const seg = (id, key, apply) => {
      const el = $(id);
      const refresh = () => {
        for (const b of el.children) b.classList.toggle('active', b.dataset.v === s[key]);
      };
      for (const b of el.children) {
        b.addEventListener('click', () => {
          s[key] = b.dataset.v;
          refresh();
          apply(s[key]);
          g.saveSettings();
        });
      }
      refresh();
    };
    seg('set-quality', 'quality', (q) => {
      g.gfx.setQuality(q);
      this.toast('Preparing models for new quality…');
      prepareModels(q).then(() => {
        g.modelQuality = q;
        this.toast(`Graphics: ${q}`);
      });
    });
    seg('set-time', 'time', (t) => {
      g.gfx.setTimeOfDay(t);
      g.map.setCloudCover(t === 'overcast' ? 0.25 : 0.5);
    });
    const range = (id, key, label, fmt, apply) => {
      const el = $(id);
      el.value = s[key];
      const show = () => ($(label).textContent = fmt(parseFloat(el.value)));
      show();
      el.addEventListener('input', () => {
        s[key] = parseFloat(el.value);
        show();
        apply(s[key]);
      });
      el.addEventListener('change', () => g.saveSettings());
    };
    range('set-gravity', 'gravity', 'grav-val', (v) => `${Math.round(v * 100)}%`, (v) => g.physics.setGravity(v));
    range('set-slow', 'slowScale', 'slow-val', (v) => `${Math.round(v * 100)}%`, () => {
      if (g.slowmo) g.setSlowmo(true);
    });
    range('set-volume', 'volume', 'vol-val', (v) => `${Math.round(v * 100)}%`, (v) => g.audio?.setVolume(v));
    const toggle = (id, key, apply) => {
      const el = $(id);
      el.checked = !!s[key];
      el.addEventListener('change', () => {
        s[key] = el.checked;
        apply?.(el.checked);
        g.saveSettings();
      });
    };
    toggle('set-blood', 'blood');
    toggle('set-ai', 'ai');
    toggle('set-fps', 'fps', (v) => {
      if (!v) $('stat-fps').textContent = '';
    });
  }

  // ------------------------------------------------------------------ feedback
  onToolEvent(type, data) {
    if (type === 'toast') this.toast(data);
    if (type === 'tool' || type === 'weapon' || type === 'spawn') {
      this.refreshToolbar();
      if (type === 'spawn') this.renderCatalogItems();
    }
    this.updateHint();
  }

  toast(text) {
    const el = $('toast');
    el.textContent = text;
    el.classList.add('show');
    this.toastTimer = 2.2;
  }

  updateHint() {
    const t = this.tools;
    let h = '';
    if (t.spawnItem) h = `<b>Click</b> to place ${t.spawnItem.name.toLowerCase()}${t.spawnItem.def?.stick ? ' (click a person to stick it in)' : ''} · <b>R</b> rotate · <b>Esc</b> cancel`;
    else if (t.active === 'hand') h = t.grab ? '<b>Move</b> to drag · <b>Wheel</b> pull / push · <b>F</b> pin in place · release to throw' : '<b>Click & drag</b> anything to move or throw it · <b>G</b> activate (TNT, car, thruster, tesla coil)';
    else if (t.active === 'weapon') {
      const w = t.weapon;
      const verb = { stab: 'stab with the', slash: 'swing the', chop: 'chop with the' }[w.melee] || 'fire the';
      h = `<b>Click</b> to ${verb} ${w.name.toLowerCase()}${w.auto ? ' (hold for auto)' : ''} · <b>R</b> next weapon`;
    }
    else if (t.active === 'explode') h = '<b>Click</b> anywhere to make an explosion · pick the size above';
    else if (t.active === 'rope') h = t.ropeStart ? '<b>Click</b> the second point to tie the rope · <b>Esc</b> cancel' : '<b>Click</b> two points to tie them together (people, props or the world)';
    else if (t.active === 'push') h = '<b>Click</b> to blast things away with a burst of force';
    else if (t.active === 'freeze') h = '<b>Click</b> to freeze or unfreeze. On people it pins the body part you click';
    else if (t.active === 'heal') h = '<b>Click</b> someone to heal or revive them';
    else if (t.active === 'delete') h = '<b>Click</b> to delete · <b>Ctrl+Z</b> undo last spawn';
    else if (t.active === 'control') h = t.controlled ? '<b>WASD</b> walk · <b>Shift</b> run · <b>Space</b> jump · <b>Click</b> punch · <b>Esc</b> let go' : '<b>Click</b> a person to take control of them';
    h += '<br><b>Right drag</b> look · <b>WASD</b> move · <b>Tab</b> spawn menu · <b>H</b> help';
    $('hint').innerHTML = h;
  }

  update(dt) {
    const g = this.game;
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) $('toast').classList.remove('show');
    }
    // stats
    this.statTimer -= dt;
    this.fpsFrames++;
    this.fpsTime += dt;
    if (this.statTimer <= 0) {
      this.statTimer = 0.25;
      const s = g.stats();
      $('stat-alive').textContent = s.alive;
      $('stat-dead').textContent = s.down;
      $('stat-objects').textContent = s.objects;
      if (this.fpsTime > 0) this.fps = Math.round(this.fpsFrames / this.fpsTime);
      this.fpsFrames = 0;
      this.fpsTime = 0;
      if (g.settings.fps) $('stat-fps').textContent = `${this.fps} fps`;
    }
    // crosshair follows the pointer
    const t = this.tools;
    const ch = $('crosshair');
    if (!ch.classList.contains('hidden')) {
      ch.style.left = t.pointerPx.x + 'px';
      ch.style.top = t.pointerPx.y + 'px';
    }
    this.updateHoverTip();
  }

  updateHoverTip() {
    const tip = $('hover-tip');
    const t = this.tools;
    const e = t.grab?.entity || t.hover?.owner?.entity;
    if (!e || e.kind === 'static' || this.pointerOverUI) {
      tip.classList.add('hidden');
      return;
    }
    tip.classList.remove('hidden');
    tip.querySelector('.ht-name').textContent = e.name;
    const bar = tip.querySelector('.ht-bar');
    const fill = bar.querySelector('i');
    let frac = null;
    let state = '';
    if (e.kind === 'person') {
      frac = Math.max(0, Math.min(e.health, e.blood) / 100);
      state = e.statusText();
      if (e.alive && e.bleed > 0.4) state += ' · bleeding';
      if (e.state === ST.DEAD) frac = 0;
    } else if (isFinite(e.maxHealth)) {
      frac = Math.max(0, e.health / e.maxHealth);
    } else if (e.kind === 'vehicle') {
      frac = Math.max(0, e.health / 450);
      state = e.driving ? 'Driving' : 'Press G to drive';
    }
    if (e.kind === 'prop' && e.fuse > 0) state = `Exploding in ${e.fuse.toFixed(1)}s`;
    else if (e.kind === 'prop' && e.def.explosive && e.def.fuseTime) state = 'Press G to arm';
    else if (e.kind === 'prop' && e.def.onActivate) state = e.on ? 'Running · G to stop' : 'Press G to start';
    else if (e.kind === 'prop' && e.fill !== undefined) state = e.fill > 0 ? (e.embedded ? 'Injecting…' : 'Place it on someone') : 'Empty';
    if (e.frozen) state = 'Frozen';
    bar.classList.toggle('hidden', frac === null);
    if (frac !== null) {
      fill.style.width = `${Math.round(frac * 100)}%`;
      fill.style.background = frac > 0.6 ? 'var(--good)' : frac > 0.3 ? 'var(--accent)' : 'var(--bad)';
    }
    tip.querySelector('.ht-state').textContent = state;
    tip.querySelector('.ht-inj').textContent = e.kind === 'person' ? e.injuryText() : '';
    const x = Math.min(window.innerWidth - 180, t.pointerPx.x + 18);
    const y = Math.min(window.innerHeight - 80, t.pointerPx.y + 18);
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
  }
}
