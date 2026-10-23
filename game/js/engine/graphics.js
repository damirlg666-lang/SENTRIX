// Renderer, lighting, sky, environment lighting and post-processing.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { setMaxAnisotropy } from './textures.js';

const TIME_PRESETS = {
  day: {
    elevation: 50, azimuth: 135, turbidity: 2.6, rayleigh: 0.9, mie: 0.004, mieG: 0.8,
    sunColor: 0xfff3e2, sunIntensity: 3.4, hemiSky: 0xcfe3ff, hemiGround: 0x5b5240, hemiIntensity: 0.35,
    envIntensity: 1.0, exposure: 0.92, fog: 0xbcd3e8, fogDensity: 0.0026, shadowRadius: 2.5,
  },
  golden: {
    elevation: 9, azimuth: 250, turbidity: 5.5, rayleigh: 2.2, mie: 0.007, mieG: 0.86,
    sunColor: 0xffb46b, sunIntensity: 3.0, hemiSky: 0xffc9a0, hemiGround: 0x4a3a2c, hemiIntensity: 0.3,
    envIntensity: 0.9, exposure: 1.0, fog: 0xd9b493, fogDensity: 0.003, shadowRadius: 3.5,
  },
  overcast: {
    elevation: 65, azimuth: 160, turbidity: 18, rayleigh: 4, mie: 0.02, mieG: 0.6,
    sunColor: 0xe8eef5, sunIntensity: 0.9, hemiSky: 0xd8e2ee, hemiGround: 0x4d4d48, hemiIntensity: 1.1,
    envIntensity: 1.25, exposure: 1.05, fog: 0xa9b3bd, fogDensity: 0.006, shadowRadius: 8,
  },
};

export class Graphics {
  constructor(canvas) {
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer = renderer;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    setMaxAnisotropy(Math.min(8, renderer.capabilities.getMaxAnisotropy()));

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.05, 3000);
    this.camera.position.set(0, 4, 12);

    // Sky dome
    this.sky = new Sky();
    this.sky.scale.setScalar(2500);
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);

    // Sun
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -28;
    sc.right = 28;
    sc.top = 28;
    sc.bottom = -28;
    sc.near = 1;
    sc.far = 260;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.025;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.sunDir = new THREE.Vector3();
    this.shadowFocus = new THREE.Vector3();

    this.hemi = new THREE.HemisphereLight(0xcfe3ff, 0x5b5240, 0.35);
    this.scene.add(this.hemi);

    // Dynamic flash lights (fixed count so shaders never recompile)
    this.flashes = [];
    for (let i = 0; i < 3; i++) {
      const l = new THREE.PointLight(0xffaa55, 0, 18, 2);
      l.userData.t = 0;
      l.userData.dur = 1;
      l.userData.peak = 0;
      this.scene.add(l);
      this.flashes.push(l);
    }

    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envTarget = null;

    this.scene.fog = new THREE.FogExp2(0xbcd3e8, 0.0026);

    this.quality = 'high';
    this.composer = null;
    this.timeOfDay = 'day';
    this.setTimeOfDay('day');

    this._resize = () => this.resize();
    window.addEventListener('resize', this._resize);
  }

  setTimeOfDay(name) {
    const p = TIME_PRESETS[name] || TIME_PRESETS.day;
    this.timeOfDay = name;
    const u = this.sky.material.uniforms;
    u.turbidity.value = p.turbidity;
    u.rayleigh.value = p.rayleigh;
    u.mieCoefficient.value = p.mie;
    u.mieDirectionalG.value = p.mieG;
    const phi = THREE.MathUtils.degToRad(90 - p.elevation);
    const theta = THREE.MathUtils.degToRad(p.azimuth);
    this.sunDir.setFromSphericalCoords(1, phi, theta);
    u.sunPosition.value.copy(this.sunDir);
    this.sun.color.set(p.sunColor);
    this.sun.intensity = p.sunIntensity;
    this.sun.shadow.radius = p.shadowRadius;
    this.hemi.color.set(p.hemiSky);
    this.hemi.groundColor.set(p.hemiGround);
    this.hemi.intensity = p.hemiIntensity;
    this.scene.fog.color.set(p.fog);
    this.scene.fog.density = p.fogDensity;
    this.renderer.toneMappingExposure = p.exposure;
    this.scene.environmentIntensity = p.envIntensity;
    this.preset = p;
    this._buildEnvironment(p);
  }

  _buildEnvironment(p) {
    // Render the sky plus a ground disc into a PMREM cube for image-based lighting.
    const envScene = new THREE.Scene();
    const sky = new Sky();
    sky.scale.setScalar(100);
    const su = sky.material.uniforms;
    const u = this.sky.material.uniforms;
    for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG']) su[k].value = u[k].value;
    su.sunPosition.value.copy(this.sunDir);
    envScene.add(sky);
    const groundCol = new THREE.Color(p.hemiGround).multiplyScalar(0.55);
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(60, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: groundCol })
    );
    ground.position.y = -1;
    envScene.add(ground);
    const old = this.envTarget;
    this.envTarget = this.pmrem.fromScene(envScene, 0.02, 0.1, 400);
    this.scene.environment = this.envTarget.texture;
    if (old) old.dispose();
    sky.geometry.dispose();
    sky.material.dispose();
    ground.geometry.dispose();
    ground.material.dispose();
  }

  setQuality(q) {
    this.quality = q;
    const r = this.renderer;
    const dpr = window.devicePixelRatio || 1;
    if (q === 'low') {
      r.setPixelRatio(Math.min(dpr, 1));
      this._setShadowSize(1024);
      r.shadowMap.type = THREE.PCFShadowMap;
    } else if (q === 'medium') {
      r.setPixelRatio(Math.min(dpr, 1.5));
      this._setShadowSize(2048);
      r.shadowMap.type = THREE.PCFSoftShadowMap;
    } else {
      r.setPixelRatio(Math.min(dpr, 2));
      this._setShadowSize(4096);
      r.shadowMap.type = THREE.PCFSoftShadowMap;
    }
    r.shadowMap.needsUpdate = true;
    this._buildComposer();
    this.resize();
  }

  _setShadowSize(s) {
    const sh = this.sun.shadow;
    if (sh.mapSize.x !== s) {
      sh.mapSize.set(s, s);
      if (sh.map) {
        sh.map.dispose();
        sh.map = null;
      }
    }
  }

  _buildComposer() {
    if (this.composer) {
      this.composer.renderTarget1.dispose();
      this.composer.renderTarget2.dispose();
      for (const p of this.composer.passes) p.dispose?.();
      this.composer = null;
    }
    if (this.quality === 'low') return;
    const r = this.renderer;
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: 4,
    });
    const composer = new EffectComposer(r, rt);
    composer.addPass(new RenderPass(this.scene, this.camera));
    if (this.quality === 'high') {
      const gtao = new GTAOPass(this.scene, this.camera, size.x, size.y);
      gtao.output = GTAOPass.OUTPUT.Default;
      gtao.blendIntensity = 0.85;
      gtao.updateGtaoMaterial({
        radius: 0.6,
        distanceExponent: 1.5,
        thickness: 1.5,
        scale: 1.0,
        samples: 12,
        distanceFallOff: 1.0,
        screenSpaceRadius: false,
      });
      gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
      composer.addPass(gtao);
      this.gtao = gtao;
    } else {
      this.gtao = null;
    }
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.28, 0.4, 2.4);
    composer.addPass(this.bloom);
    composer.addPass(new OutputPass());
    this.composer = composer;
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    if (this.composer) {
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.composer.setSize(w, h);
    }
  }

  /** Keep the sun's shadow frustum centred on what the player is looking at. */
  updateShadowFocus(focus) {
    const sc = this.sun.shadow.camera;
    const texel = (sc.right - sc.left) / this.sun.shadow.mapSize.x;
    // snap in light space to avoid shimmering
    const lightRot = new THREE.Matrix4().lookAt(this.sunDir, new THREE.Vector3(), new THREE.Vector3(0, 1, 0));
    const inv = lightRot.clone().invert();
    const p = focus.clone().applyMatrix4(inv);
    p.x = Math.round(p.x / texel) * texel;
    p.y = Math.round(p.y / texel) * texel;
    p.applyMatrix4(lightRot);
    this.sun.target.position.copy(p);
    this.sun.position.copy(p).addScaledVector(this.sunDir, 120);
    this.sun.target.updateMatrixWorld();
  }

  flash(position, color = 0xffaa55, intensity = 60, duration = 0.25, distance = 18) {
    // reuse the light that is closest to finishing
    let best = this.flashes[0];
    for (const l of this.flashes) {
      if (l.userData.t <= 0) {
        best = l;
        break;
      }
      if (l.userData.t < best.userData.t) best = l;
    }
    best.position.copy(position);
    best.color.set(color);
    best.distance = distance;
    best.userData.t = duration;
    best.userData.dur = duration;
    best.userData.peak = intensity;
    best.intensity = intensity;
  }

  update(dt) {
    for (const l of this.flashes) {
      if (l.userData.t > 0) {
        l.userData.t -= dt;
        const k = Math.max(0, l.userData.t / l.userData.dur);
        l.intensity = l.userData.peak * k * k;
      } else {
        l.intensity = 0;
      }
    }
    this.sky.position.copy(this.camera.position);
  }

  render() {
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
}
