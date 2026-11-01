// Renderer, real-sky HDRI lighting (Poly Haven CC0, chosen by sun elevation and weather),
// sun shadows, fog matched to the sky's horizon, and post-processing.
import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import type { QualitySettings } from '../core/env';
import { sunPosition } from '../core/sun';
import { clamp, smoothstep } from '../core/rand';

// Height-aware exponential fog for every material: denser near the ground, thinning with altitude.
THREE.ShaderChunk.fog_pars_fragment = THREE.ShaderChunk.fog_pars_fragment.replace(
  '#ifdef USE_FOG',
  '#ifdef USE_FOG\n  varying vec3 vFogWorldPos;',
);
THREE.ShaderChunk.fog_pars_vertex = THREE.ShaderChunk.fog_pars_vertex.replace(
  '#ifdef USE_FOG',
  '#ifdef USE_FOG\n  varying vec3 vFogWorldPos;',
);
THREE.ShaderChunk.fog_vertex = THREE.ShaderChunk.fog_vertex.replace(
  '#ifdef USE_FOG',
  '#ifdef USE_FOG\n  vFogWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;',
);
THREE.ShaderChunk.fog_fragment = THREE.ShaderChunk.fog_fragment.replace(
  'float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );',
  `float hFall = exp(-max(0.0, (vFogWorldPos.y + cameraPosition.y) * 0.5 - 2.0) * 0.012);
   float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth * (0.55 + 0.9 * hFall) );`,
);

interface SkyDef { id: string; kind: string; sunAz: number; sunEl: number; sunStrength: number; upperMean: number; exposure: number }
interface LoadedSky { def: SkyDef; bg: THREE.Texture; env: THREE.Texture; horizon: THREE.Color }
const SKY_BASE = `${import.meta.env.BASE_URL}assets/sky/`;

export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly q: QualitySettings;
  private composer: EffectComposer | null = null;
  private renderPass: RenderPass | null = null;
  private bloom: UnrealBloomPass | null = null;
  private gtao: GTAOPass | null = null;
  private pmrem: THREE.PMREMGenerator;
  readonly sunDir = new THREE.Vector3(0, 1, 0);
  /** 0 = full day, 1 = full night. Drives lamps and windows. */
  night = 0;
  tunnelFactor = 0;
  private baseExposure = 0.55;
  private sunBase = 3;
  private hemiBase = 0.3;
  private envBase = 0.6;
  private bgBase = 1;
  private skyDefs: SkyDef[] = [];
  private skies = new Map<string, Promise<LoadedSky>>();
  private currentSky: LoadedSky | null = null;
  private wantedSky = '';
  private loadingSky = '';
  /** Resolves when the first sky is on screen (used by the loading screen). */
  readonly skyReady: Promise<void>;
  private resolveSkyReady!: () => void;

  constructor(container: HTMLElement, q: QualitySettings) {
    this.q = q;
    this.skyReady = new Promise<void>((res) => (this.resolveSkyReady = res));
    this.renderer = new THREE.WebGLRenderer({ antialias: !q.postFX, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(q.pixelRatio);
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = this.baseExposure;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.touchAction = 'none';

    this.camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.05, 24000);

    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
    const r = q.shadowRange;
    Object.assign(this.sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 1, far: 1200 });
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0x55603a, 0.3);
    this.scene.add(this.hemi);
    this.scene.fog = new THREE.FogExp2(0xbfd0e0, 0.00018);
    this.scene.background = new THREE.Color(0x9fb4c8);

    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.pmrem.compileEquirectangularShader();
    if (q.postFX) this.setupPost(container);
    void this.loadManifest();
  }

  private async loadManifest() {
    try {
      const r = await fetch(SKY_BASE + 'skies.json');
      const j = (await r.json()) as { skies: SkyDef[] };
      this.skyDefs = j.skies;
      if (this.wantedSky) this.applySky(this.wantedSky);
    } catch (e) { console.warn('skies manifest missing', e); this.resolveSkyReady(); }
  }

  private loadSky(id: string): Promise<LoadedSky> {
    let p = this.skies.get(id);
    if (!p) {
      p = (async () => {
        const def = this.skyDefs.find((s) => s.id === id)!;
        const [bg, hdr] = await Promise.all([
          new Promise<THREE.Texture>((res, rej) => new THREE.TextureLoader().load(`${SKY_BASE}${id}.jpg`, res, undefined, rej)),
          new Promise<THREE.DataTexture>((res, rej) => new HDRLoader().load(`${SKY_BASE}${id}_1k.hdr`, res, undefined, rej)),
        ]);
        bg.mapping = THREE.EquirectangularReflectionMapping;
        bg.colorSpace = THREE.SRGBColorSpace;
        bg.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
        hdr.mapping = THREE.EquirectangularReflectionMapping;
        const env = this.pmrem.fromEquirectangular(hdr).texture;
        hdr.dispose();
        // horizon colour from the background image, for the fog
        const img = bg.image as HTMLImageElement;
        const cv = document.createElement('canvas'); cv.width = 64; cv.height = 32;
        const ctx = cv.getContext('2d')!;
        ctx.drawImage(img, 0, 0, 64, 32);
        const d = ctx.getImageData(0, 15, 64, 2).data;
        let cr = 0, cg = 0, cb = 0;
        for (let i = 0; i < d.length; i += 4) { cr += d[i]; cg += d[i + 1]; cb += d[i + 2]; }
        const n = d.length / 4;
        const horizon = new THREE.Color(cr / n / 255, cg / n / 255, cb / n / 255).convertSRGBToLinear();
        return { def, bg, env, horizon };
      })();
      this.skies.set(id, p);
    }
    return p;
  }

  private applySky(id: string) {
    if (!this.skyDefs.length || this.loadingSky === id || this.currentSky?.def.id === id) return;
    this.loadingSky = id;
    void this.loadSky(id).then((sky) => {
      this.loadingSky = '';
      if (this.wantedSky !== id) { this.applySky(this.wantedSky); return; }
      this.currentSky = sky;
      this.scene.background = sky.bg;
      this.scene.environment = sky.env;
      this.resolveSkyReady();
    }).catch((e) => { console.warn('sky load failed', e); this.loadingSky = ''; this.resolveSkyReady(); });
  }

  private setupPost(container: HTMLElement) {
    const w = container.clientWidth, h = container.clientHeight;
    const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: this.q.msaa });
    this.composer = new EffectComposer(this.renderer, rt);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);
    if (this.q.quality === 'high') {
      this.gtao = new GTAOPass(this.scene, this.camera, w, h);
      this.gtao.updateGtaoMaterial({ radius: 1.2, distanceExponent: 1.5, thickness: 0.6, scale: 1.2, samples: 12, distanceFallOff: 1 });
      this.gtao.output = GTAOPass.OUTPUT.Default;
      this.gtao.blendIntensity = 0.8;
      this.composer.addPass(this.gtao);
    }
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.12, 0.5, 0.95);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    if (!this.q.msaa) this.composer.addPass(new SMAAPass());
  }

  setCamera(cam: THREE.PerspectiveCamera) {
    this.camera = cam;
    if (this.renderPass) this.renderPass.camera = cam;
    if (this.gtao) this.gtao.camera = cam;
  }

  resize(w: number, h: number) {
    this.renderer.setSize(w, h);
    this.composer?.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Sets sun, sky, fog and ambient for a time of day (local Dublin time). overcast 0..1. */
  setTime(date: Date, overcast = 0.35) {
    const { elevation, azimuth } = sunPosition(date);
    // Azimuth from north clockwise -> world: north = -z, east = +x.
    const el = Math.max(elevation, -0.3);
    this.sunDir.set(Math.sin(azimuth) * Math.cos(el), Math.sin(el), -Math.cos(azimuth) * Math.cos(el)).normalize();
    const elevDeg = (elevation * 180) / Math.PI;
    const day = smoothstep(-6, 8, elevDeg);
    this.night = 1 - smoothstep(-8, 2, elevDeg);
    const golden = 1 - smoothstep(3, 20, elevDeg);
    // choose the real-sky HDRI
    const hour = date.getHours() + date.getMinutes() / 60;
    let id: string;
    if (elevDeg < -5) id = 'night';
    else if (elevDeg < 5) id = 'sunset';
    else if (elevDeg < 13) id = 'golden';
    else if (overcast > 0.6) id = 'day_overcast';
    else if (hour < 9.5 && overcast > 0.3) id = 'morning_mist';
    else id = 'day_partly';
    if (id !== this.wantedSky) { this.wantedSky = id; this.applySky(id); }
    // rotate the sky so its sun sits at the real sun's azimuth
    const sky = this.currentSky;
    if (sky) {
      const realAngle = Math.atan2(this.sunDir.z, this.sunDir.x); // angle from +x towards +z
      const rot = sky.def.sunAz - realAngle;
      this.scene.backgroundRotation.set(0, rot, 0);
      this.scene.environmentRotation.set(0, rot, 0);
    }
    const kind = sky?.def.kind ?? 'day';
    const sunCol = new THREE.Color().setRGB(1, 0.93 - golden * 0.25, 0.85 - golden * 0.45);
    this.sun.color.copy(sunCol);
    const cloudy = kind === 'overcast' ? 0.25 : kind === 'mist' ? 0.5 : 1 - overcast * 0.35;
    this.sunBase = 3.4 * day * cloudy;
    this.hemiBase = 0.1 + 0.15 * day;
    this.hemi.color.setRGB(0.65 + 0.1 * day, 0.75 + 0.1 * day, 1.0);
    this.hemi.groundColor.setRGB(0.28 * day + 0.08, 0.3 * day + 0.08, 0.22 * day + 0.1);
    // The night sky photo is moonlit and bright; real Dublin at night is lit by lamps, not sky.
    // Scale the sky, sky-light and fog down with darkness so lamps, windows and headlights dominate.
    const dark = this.night;
    this.bgBase = 1 - 0.9 * dark;
    this.envBase = (sky ? 0.75 : 0.6) * (1 - 0.85 * dark);
    const fog = this.scene.fog as THREE.FogExp2;
    if (sky) fog.color.copy(sky.horizon).multiplyScalar(1 - 0.88 * dark);
    else fog.color.copy(new THREE.Color(0.045, 0.055, 0.085).lerp(new THREE.Color(0.72, 0.79, 0.86), day));
    fog.density = 0.00015 + overcast * 0.0001 + (kind === 'mist' ? 0.00025 : 0);
    this.baseExposure = kind === 'night' ? 0.95 : kind === 'sunset' ? 0.7 : 0.62;
    if (this.bloom) this.bloom.strength = 0.1 + this.night * 0.25;
    this.applyLighting();
  }

  private applyLighting() {
    const f = this.tunnelFactor;
    this.sun.intensity = this.sunBase * (1 - f);
    this.hemi.intensity = this.hemiBase * (1 - 0.9 * f);
    this.scene.environmentIntensity = this.envBase * (1 - 0.9 * f);
    this.scene.backgroundIntensity = this.bgBase;
    this.renderer.toneMappingExposure = this.baseExposure * (1 + f * 1.2);
  }

  /** Keeps the shadow frustum centred on the camera, snapped to texels to avoid shimmering. */
  updateShadows(focus: THREE.Vector3) {
    const r = this.q.shadowRange;
    const texel = (2 * r) / this.q.shadowMapSize;
    const lightRot = new THREE.Matrix4().lookAt(new THREE.Vector3(), this.sunDir.clone().negate(), new THREE.Vector3(0, 1, 0));
    const inv = lightRot.clone().invert();
    const p = focus.clone().applyMatrix4(inv);
    p.x = Math.round(p.x / texel) * texel; p.y = Math.round(p.y / texel) * texel;
    const c = p.applyMatrix4(lightRot);
    this.sun.target.position.copy(c);
    this.sun.position.copy(c).addScaledVector(this.sunDir, 500);
    this.sun.target.updateMatrixWorld();
    this.sun.castShadow = this.sunDir.y > 0.02;
  }

  setTunnel(factor: number) {
    this.tunnelFactor = clamp(factor, 0, 1);
    this.applyLighting();
  }

  render() {
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
}
