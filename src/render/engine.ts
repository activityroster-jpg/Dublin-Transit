// Renderer, sky, sun, fog, shadows and post-processing.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import type { QualitySettings } from '../core/env';
import { sunPosition } from '../core/sun';
import { clamp, smoothstep } from '../core/rand';

export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly sky: Sky;
  readonly q: QualitySettings;
  private composer: EffectComposer | null = null;
  private renderPass: RenderPass | null = null;
  private bloom: UnrealBloomPass | null = null;
  private pmrem: THREE.PMREMGenerator;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private skyScene = new THREE.Scene();
  private skyForEnv: Sky;
  readonly sunDir = new THREE.Vector3(0, 1, 0);
  /** 0 = full day, 1 = full night. Drives lamps and windows. */
  night = 0;
  /** Exposure multiplier when in tunnels. */
  tunnelFactor = 0;
  private baseExposure = 0.55;
  private sunBase = 3;
  private hemiBase = 0.6;
  private envBase = 1;

  constructor(container: HTMLElement, q: QualitySettings) {
    this.q = q;
    this.renderer = new THREE.WebGLRenderer({ antialias: !q.postFX, powerPreference: 'high-performance', logarithmicDepthBuffer: false });
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

    this.sky = new Sky();
    this.sky.scale.setScalar(20000);
    this.scene.add(this.sky);
    this.skyForEnv = new Sky();
    this.skyForEnv.scale.setScalar(1000);
    (this.skyForEnv.material as THREE.ShaderMaterial).uniforms.showSunDisc.value = 0;
    this.skyScene.add(this.skyForEnv);

    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
    const r = q.shadowRange;
    Object.assign(this.sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 1, far: 1200 });
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0x55603a, 0.6);
    this.scene.add(this.hemi);
    this.scene.fog = new THREE.FogExp2(0xbfd0e0, 0.00022);

    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    if (q.postFX) this.setupPost(container);
  }

  private setupPost(container: HTMLElement) {
    const w = container.clientWidth, h = container.clientHeight;
    const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: this.q.msaa });
    this.composer = new EffectComposer(this.renderer, rt);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.18, 0.5, 0.92);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    if (!this.q.msaa) this.composer.addPass(new SMAAPass());
  }

  setCamera(cam: THREE.PerspectiveCamera) {
    this.camera = cam;
    if (this.renderPass) this.renderPass.camera = cam;
  }

  resize(w: number, h: number) {
    this.renderer.setSize(w, h);
    this.composer?.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Sets sun, sky, fog and ambient for a time of day (local Dublin time). */
  setTime(date: Date, overcast = 0.35) {
    const { elevation, azimuth } = sunPosition(date);
    // Azimuth from north clockwise -> world: north = -z, east = +x.
    const el = Math.max(elevation, -0.3);
    this.sunDir.set(Math.sin(azimuth) * Math.cos(el), Math.sin(el), -Math.cos(azimuth) * Math.cos(el)).normalize();
    const elevDeg = (elevation * 180) / Math.PI;
    const day = smoothstep(-6, 8, elevDeg);
    this.night = 1 - smoothstep(-8, 2, elevDeg);
    const golden = 1 - smoothstep(3, 20, elevDeg);
    for (const s of [this.sky, this.skyForEnv]) {
      const u = (s.material as THREE.ShaderMaterial).uniforms;
      u.sunPosition.value.copy(this.sunDir);
      u.turbidity.value = 3 + overcast * 6;
      u.rayleigh.value = 1.2 + golden * 1.5;
      u.mieCoefficient.value = 0.004 + overcast * 0.004;
      u.mieDirectionalG.value = 0.82;
      u.cloudCoverage.value = 0.35 + overcast * 0.45;
      u.cloudDensity.value = 0.5 + overcast * 0.4;
      u.cloudElevation.value = 0.6;
    }
    const sunCol = new THREE.Color().setRGB(1, 0.93 - golden * 0.25, 0.85 - golden * 0.45);
    this.sun.color.copy(sunCol);
    this.sun.intensity = 3.6 * day * (1 - overcast * 0.45);
    this.hemi.intensity = 0.32 + 0.4 * day;
    this.hemi.color.setRGB(0.65 + 0.1 * day, 0.75 + 0.1 * day, 1.0);
    this.hemi.groundColor.setRGB(0.28 * day + 0.08, 0.3 * day + 0.08, 0.22 * day + 0.1);
    const fogDay = new THREE.Color(0.72, 0.79, 0.86).lerp(new THREE.Color(0.85, 0.72, 0.6), golden * 0.6);
    const fogNight = new THREE.Color(0.045, 0.055, 0.085);
    (this.scene.fog as THREE.FogExp2).color.copy(fogNight.lerp(fogDay, day));
    (this.scene.fog as THREE.FogExp2).density = 0.00016 + overcast * 0.00012;
    this.sunBase = this.sun.intensity; this.hemiBase = this.hemi.intensity;
    this.baseExposure = 0.5 + this.night * 0.9;
    this.renderer.toneMappingExposure = this.baseExposure;
    if (this.bloom) this.bloom.strength = 0.12 + this.night * 0.25;
    if (this.lastEnv == null || Math.abs(date.getTime() - this.lastEnv) > 180_000) { this.lastEnv = date.getTime(); this.updateEnvironment(); }
    else this.scene.environmentIntensity = this.envBase;
  }
  private lastEnv: number | null = null;

  private updateEnvironment() {
    this.envRT?.dispose();
    this.envRT = this.pmrem.fromScene(this.skyScene as unknown as THREE.Scene, 0, 0.1, 2000);
    this.scene.environment = this.envRT.texture;
    this.envBase = 0.35 + 0.65 * (1 - this.night);
    this.scene.environmentIntensity = this.envBase;
  }

  /** Keeps the shadow frustum centred on the camera, snapped to texels to avoid shimmering. */
  updateShadows(focus: THREE.Vector3) {
    this.sky.position.copy(focus);
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
    const f = this.tunnelFactor;
    this.sun.intensity = this.sunBase * (1 - f);
    this.hemi.intensity = this.hemiBase * (1 - 0.9 * f);
    this.scene.environmentIntensity = this.envBase * (1 - 0.9 * f);
    this.renderer.toneMappingExposure = this.baseExposure * (1 + f * 1.2);
  }

  render() {
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
}
