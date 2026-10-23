import * as THREE from 'three';
import { initPhysics } from './engine/physics.js';
import { Graphics } from './engine/graphics.js';
import { Game } from './game.js';
import { prepareModels } from './characters/humanModel.js';
import { Effects } from './fx/effects.js';
import { Audio } from './audio.js';
import { Tools, TOOL_IDS } from './tools/tools.js';
import { UI } from './ui.js';
import { Prop } from './entities/prop.js';
import { Car } from './entities/vehicle.js';
import { PROPS } from './catalog/props.js';

const loadFill = document.getElementById('load-fill');
const loadText = document.getElementById('load-text');
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

const bootStart = performance.now();
const timings = [];

async function progress(text, frac) {
  if (text) timings.push([text, Math.round(performance.now() - bootStart)]);
  if (text) loadText.textContent = text;
  if (frac !== undefined) loadFill.style.width = Math.round(frac * 100) + '%';
  await nextFrame();
}

function checkSupport() {
  const c = document.createElement('canvas');
  const gl = c.getContext('webgl2');
  if (!gl) throw new Error('This game needs WebGL 2. Please use a recent version of Chrome, Edge, Firefox or Safari.');
}

function starterScene(game, crowd) {
  const yawQ = (y) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), y);
  for (let i = 0; i < crowd; i++) {
    const a = (i / Math.max(1, crowd)) * Math.PI * 2 + 0.4;
    const r = 2.5 + (i % 2) * 1.5;
    game.spawnPerson(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r), Math.random() * Math.PI * 2, { record: false });
  }
  if (crowd === 0) return;
  game.add(new Car(game, new THREE.Vector3(8.5, 0.05, 1.5), 2.1), false);
  const add = (def, x, y, z, yaw = 0) => game.add(new Prop(game, def, new THREE.Vector3(x, y, z), yawQ(yaw)), false);
  add(PROPS.crate, -6, 0.42, -3, 0.2);
  add(PROPS.crate, -5.9, 1.24, -3.05, 0.5);
  add(PROPS.smallCrate, -5, 0.27, -3.9, 0.9);
  add(PROPS.explosiveBarrel, -4.2, 0.46, -1.6);
  add(PROPS.barrel, 4.5, 0.46, -4.5);
  add(PROPS.barrel, 5.1, 0.46, -4.1);
  for (let i = 0; i < 4; i++) add(PROPS.cone, -1.5 + i * 1.1, 0.33, -6.5);
  add(PROPS.mattress, 11.2, 0.13, -7.6, 0.1);
}

function bindInput(game) {
  const { tools, ui, cam } = game;
  const canvas = game.gfx.renderer.domElement;
  let rotating = false;
  let panning = false;
  let lastX = 0;
  let lastY = 0;
  const touches = new Map();
  let pinchDist = 0;
  let touchTool = false;

  const centroid = () => {
    let x = 0;
    let y = 0;
    for (const t of touches.values()) {
      x += t.x;
      y += t.y;
    }
    return { x: x / touches.size, y: y / touches.size };
  };
  const spread = () => {
    const [a, b] = [...touches.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  canvas.addEventListener('pointerdown', (e) => {
    canvas.focus();
    game.audio.unlock();
    ui.pointerOverUI = false;
    if (e.pointerType === 'touch') {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 1) {
        tools.setPointer(e.clientX, e.clientY);
        tools.updateRay();
        tools.hover = tools.pick();
        tools.down();
        touchTool = true;
      } else if (touches.size === 2) {
        if (touchTool) tools.up();
        touchTool = false;
        const c = centroid();
        lastX = c.x;
        lastY = c.y;
        pinchDist = spread();
      }
      return;
    }
    canvas.setPointerCapture(e.pointerId);
    tools.setPointer(e.clientX, e.clientY);
    lastX = e.clientX;
    lastY = e.clientY;
    if (e.button === 0) tools.down();
    else if (e.button === 2) rotating = true;
    else if (e.button === 1) {
      panning = true;
      e.preventDefault();
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') {
      if (!touches.has(e.pointerId)) return;
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 1) tools.setPointer(e.clientX, e.clientY);
      else if (touches.size === 2) {
        const c = centroid();
        cam.rotate((c.x - lastX) * 1.2, (c.y - lastY) * 1.2);
        lastX = c.x;
        lastY = c.y;
        const d = spread();
        if (pinchDist > 0) cam.zoom((pinchDist - d) * 4);
        pinchDist = d;
      }
      return;
    }
    tools.setPointer(e.clientX, e.clientY);
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    if (rotating) cam.rotate(dx, dy);
    if (panning) cam.pan(dx, dy);
  });

  const end = (e) => {
    if (e.pointerType === 'touch') {
      touches.delete(e.pointerId);
      if (touchTool && touches.size === 0) {
        tools.up();
        touchTool = false;
      }
      if (touches.size < 2) pinchDist = 0;
      return;
    }
    if (e.button === 0) tools.up();
    if (e.button === 2) rotating = false;
    if (e.button === 1) panning = false;
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', (e) => {
    end(e);
    rotating = false;
    panning = false;
  });
  canvas.addEventListener('pointerleave', () => (ui.pointerOverUI = true));
  canvas.addEventListener('pointerenter', () => (ui.pointerOverUI = false));
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 1) e.preventDefault(); // no autoscroll on middle click
  });
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const d = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      if (!tools.wheel(d)) cam.zoom(d);
    },
    { passive: false }
  );

  window.addEventListener('keydown', (e) => {
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    tools.keysShift = e.shiftKey;
    game.audio.unlock();
    if (e.code === 'Escape') {
      if (!ui.closeAnyModal() && !tools.cancel() && tools.grab) tools.release();
      return;
    }
    if (ui.modalOpen) return;
    if (e.code === 'Tab') {
      e.preventDefault();
      ui.toggleCatalog();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
      e.preventDefault();
      ui.undo();
      return;
    }
    const n = parseInt(e.key);
    if (!isNaN(n) && n >= 1 && n <= TOOL_IDS.length && !e.ctrlKey && !e.metaKey) {
      tools.select(TOOL_IDS[n - 1]);
      return;
    }
    if (tools.key(e.code)) return;
    switch (e.code) {
      case 'KeyP':
        ui.togglePause();
        return;
      case 'KeyT':
        ui.toggleSlowmo();
        return;
      case 'KeyH':
        ui.openModal('help');
        return;
      case 'KeyF': {
        const h = tools.hover;
        if (h) cam.focus(h.point, Math.min(cam.goalDist, 9));
        return;
      }
      default:
        break;
    }
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'Space', 'KeyC', 'ShiftLeft', 'ShiftRight', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      cam.keys.add(e.code);
    }
  });
  window.addEventListener('keyup', (e) => {
    tools.keysShift = e.shiftKey;
    cam.keys.delete(e.code);
  });
  window.addEventListener('blur', () => {
    cam.keys.clear();
    tools.up();
  });
}

async function main() {
  checkSupport();
  const params = new URLSearchParams(location.search);
  await progress('Starting physics engine…', 0.04);
  await initPhysics();

  const canvas = document.getElementById('view');
  const gfx = new Graphics(canvas);
  const game = new Game(gfx);
  if (params.get('q')) game.settings.quality = params.get('q');
  gfx.setQuality(game.settings.quality);
  gfx.setTimeOfDay(game.settings.time);
  game.modelQuality = game.settings.quality;
  window.__game = game;
  window.__debug = { PROPS, THREE };

  // characters are sculpted in worker threads while the main thread builds the world
  let modelProgress = 0;
  const models = prepareModels(game.modelQuality, (f) => (modelProgress = f));
  await progress('Building the world…', 0.1);
  game.buildWorld((t) => (loadText.textContent = t));
  game.map.setCloudCover(game.settings.time === 'overcast' ? 0.25 : 0.5);

  await progress('Sculpting people…', 0.3 + modelProgress * 0.45);
  const tick = setInterval(() => (loadFill.style.width = Math.round((0.3 + modelProgress * 0.45) * 100) + '%'), 100);
  await models;
  clearInterval(tick);

  game.fx = new Effects(game);
  game.audio = new Audio(game);
  game.tools = new Tools(game);
  game.ui = new UI(game);
  bindInput(game);

  await progress('Rendering menu thumbnails…', 0.78);
  if (params.get('thumbs') !== '0') await game.ui.renderThumbnails(game.modelQuality);

  await progress('Setting the scene…', 0.92);
  if (params.get('ai') === '0') game.settings.ai = false;
  starterScene(game, parseInt(params.get('people') ?? '5'));
  game.ready = true;

  await progress('Ready', 1);
  if (params.has('debug')) console.log('boot timings (ms):', JSON.stringify(timings), 'world:', game.map.buildTimings.join(', '));
  document.getElementById('loading').classList.add('fade');
  document.getElementById('hud').classList.remove('hidden');

  const maxFrames = parseInt(params.get('frames') || '0');
  const fixedDt = parseFloat(params.get('dt') || '0');
  let frameNo = 0;
  function frame() {
    frameNo++;
    if (maxFrames && frameNo > maxFrames) {
      console.log('stopped after', maxFrames, 'frames');
      return;
    }
    const dt = fixedDt || game.clock.getDelta();
    game.step(dt);
    game.audio.updateListener(gfx.camera);
    gfx.render();
    requestAnimationFrame(frame);
  }
  frame();
}

main().catch((err) => {
  console.error(err);
  const f = document.getElementById('fatal');
  f.classList.remove('hidden');
  f.textContent = 'Failed to start: ' + (err && err.message ? err.message : err);
});
