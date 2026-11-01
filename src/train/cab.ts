// The driving cab: shell, windscreen, desk, instrument panel, seat, and working controls.
// Convention: positions are given in SCREEN coordinates (sx > 0 = the driver's right). The cab
// camera looks along the car's +z axis, so screen x maps to world x = -sx. The driver sits on
// the left, as on Irish stock. Everything clickable carries userData.action; instruments are
// live canvas textures.
import * as THREE from 'three';
import { CAR_LEN } from './model';
import type { Aspect } from '../render/signals';
import { NOTCH_MAX, NOTCH_MIN, notchLabel } from './physics';
import { gaugeTexture, pbrMaterial } from '../render/textures';

const ZF = CAR_LEN / 2; // cab front (local z)
const W = (sx: number) => -sx;
const DRIVER_SX = -0.56;
export const EYE = new THREE.Vector3(W(DRIVER_SX), 2.5, ZF - 1.25);

function mat(color: number, rough = 0.6, metal = 0.1, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) { return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra }); }
const box = new THREE.BoxGeometry(1, 1, 1);

export interface CabState {
  kmh: number; limitKmh: number; nextLimitKmh: number | null; notch: number; aspect: Aspect; warning: boolean; interlock: boolean;
  doorsLeft: number; doorsRight: number; headlights: boolean; pantograph: boolean; ebActive: boolean; ataTarget: number | null;
  bcBar: number; mrBar: number;
  screen: { clock: string; next: string; nextArr: string; dist: string; delta: string; msg: string };
}

export class Cab {
  readonly group = new THREE.Group();
  readonly clickables: THREE.Object3D[] = [];
  private lever: THREE.Group;
  private speedoCanvas = document.createElement('canvas');
  private speedoTex: THREE.CanvasTexture;
  private screenCanvas = document.createElement('canvas');
  private screenTex: THREE.CanvasTexture;
  private lamps: Record<string, THREE.MeshStandardMaterial> = {};
  private lastSpeedo = '';
  private lastScreen = '';
  readonly light: THREE.PointLight;
  private wiper: THREE.Mesh;
  private bcGauge!: { needle: THREE.Mesh; max: number };
  private mrGauge!: { needle: THREE.Mesh; max: number };
  private ceilingLight!: THREE.MeshStandardMaterial;
  wiperOn = false;
  private wiperT = 0;

  constructor() {
    const g = this.group;
    // scanned CC0 surfaces (AmbientCG): moulded plastic lining, brushed metal desk, rubber mats, seat cloth
    const shell = pbrMaterial('plastic', 2, { color: 0xe6e2d6, normalStrength: 0.6 });
    const darkPanel = pbrMaterial('plastic', 2, { color: 0x4a5054, normalStrength: 0.6 });
    const desk = pbrMaterial('metal', 1, { color: 0x8a9094, metal: true, normalStrength: 0.5 });
    const deskTop = pbrMaterial('rubber', 2, { color: 0x5a5e62 });
    const floor = pbrMaterial('rubber', 3, { color: 0x45484b });
    const seatCloth = pbrMaterial('fabric', 3, { color: 0x3a4250 });
    const glass = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.02, metalness: 0, transmission: 0, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false });
    /** Box at screen-x sx. */
    const P = (m: THREE.Material, sx_: number, sy: number, sz: number, sx: number, y: number, z: number, shadow = true) => {
      const o = new THREE.Mesh(box, m); o.scale.set(sx_, sy, sz); o.position.set(W(sx), y, z); o.castShadow = shadow; o.receiveShadow = true; g.add(o); return o;
    };
    const SILL = 2.3, TOP = 3.25;
    // shell
    P(floor, 2.76, 0.04, 2.4, 0, 1.1, ZF - 1.2);
    P(shell, 2.76, 0.06, 2.4, 0, 3.56, ZF - 1.2);              // ceiling
    P(shell, 2.76, 2.5, 0.06, 0, 2.35, ZF - 2.4);              // back wall
    for (const sx of [-1, 1]) {
      P(shell, 0.06, 1.2, 2.4, sx * 1.38, 1.7, ZF - 1.2);       // lower side
      P(shell, 0.06, 0.35, 2.4, sx * 1.38, 3.38, ZF - 1.2);     // upper side
      P(shell, 0.06, 0.9, 0.9, sx * 1.38, 2.75, ZF - 2.0);      // rear of side window
      P(shell, 0.08, TOP - SILL, 0.12, sx * 1.33, (SILL + TOP) / 2, ZF - 0.12);   // A pillar
      const sw = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.9), glass); sw.position.set(W(sx * 1.385), 2.75, ZF - 0.85); sw.rotation.y = Math.PI / 2; g.add(sw);
    }
    P(shell, 2.76, 3.56 - TOP, 0.08, 0, (3.56 + TOP) / 2, ZF - 0.08);   // header above windscreen
    P(darkPanel, 2.76, SILL - 1.1, 0.08, 0, (SILL + 1.1) / 2, ZF - 0.06); // front wall below the windscreen
    P(shell, 0.1, TOP - SILL, 0.1, 0.3, (SILL + TOP) / 2, ZF - 0.08);    // centre pillar (two-piece screen)
    const ws = new THREE.Mesh(new THREE.PlaneGeometry(2.7, TOP - SILL), glass); ws.position.set(0, (SILL + TOP) / 2, ZF - 0.05); g.add(ws);
    // sun visor above the driver
    const visor = P(new THREE.MeshStandardMaterial({ color: 0x223022, transparent: true, opacity: 0.55, roughness: 0.3 }), 1.0, 0.01, 0.35, DRIVER_SX, 3.2, ZF - 0.3, false); visor.rotation.x = 0.35;
    // desk: flat top at the hands, then the instrument panel angled up to the windscreen sill
    P(deskTop, 2.7, 0.05, 0.6, 0, 1.98, ZF - 0.75);
    P(darkPanel, 2.7, 0.88, 0.05, 0, 1.54, ZF - 1.05);
    // wedge under the angled panel: profile in (z, y), extruded across the cab
    const wedge = new THREE.Shape();
    wedge.moveTo(ZF - 0.47, 1.95); wedge.lineTo(ZF - 0.08, 1.95); wedge.lineTo(ZF - 0.08, SILL - 0.01); wedge.lineTo(ZF - 0.13, SILL - 0.01); wedge.lineTo(ZF - 0.47, 1.97);
    const wg = new THREE.ExtrudeGeometry(wedge, { depth: 2.7, bevelEnabled: false });
    const wm = new THREE.Mesh(wg, darkPanel); wm.rotation.y = -Math.PI / 2; wm.position.x = 1.35; wm.castShadow = true; g.add(wm);
    // wiper (pivot at the bottom of the screen)
    this.wiper = P(mat(0x111111), 0.03, 0.85, 0.02, DRIVER_SX, SILL, ZF + 0.0, false);
    this.wiper.geometry = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    // seat
    // seat: cushion under the driver, back behind the eye (forward is +z)
    P(seatCloth, 0.55, 0.12, 0.5, DRIVER_SX, 1.6, EYE.z - 0.2);
    P(seatCloth, 0.55, 0.75, 0.1, DRIVER_SX, 2.02, EYE.z - 0.5).rotation.x = 0.15;
    P(mat(0x444444, 0.5, 0.6), 0.08, 0.45, 0.08, DRIVER_SX, 1.3, EYE.z - 0.2);

    // Instrument panel: 45° face from (y 1.98, z ZF-0.45) up to (y 2.28, z ZF-0.15), facing the driver.
    // rotation (0.78, π, 0): local +x = screen x, local +y = up/away, normal = up/towards the driver.
    const panel = new THREE.Group();
    panel.position.set(0, 2.13, ZF - 0.3);
    panel.rotation.set(0.78, Math.PI, 0);
    g.add(panel);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(2.7, 0.42), desk); face.position.z = -0.001; panel.add(face);
    // speedometer in front of the driver
    this.speedoCanvas.width = this.speedoCanvas.height = 256;
    this.speedoTex = new THREE.CanvasTexture(this.speedoCanvas); this.speedoTex.colorSpace = THREE.SRGBColorSpace;
    const speedo = new THREE.Mesh(new THREE.CircleGeometry(0.11, 40), new THREE.MeshStandardMaterial({ map: this.speedoTex, emissive: 0xffffff, emissiveMap: this.speedoTex, emissiveIntensity: 0.35, roughness: 0.3 }));
    speedo.position.set(DRIVER_SX, 0.02, 0.004); panel.add(speedo);
    const bezel = new THREE.Mesh(new THREE.RingGeometry(0.11, 0.125, 40), mat(0x111111, 0.4, 0.5)); bezel.position.set(DRIVER_SX, 0.02, 0.005); panel.add(bezel);
    const sqPlate = new THREE.Mesh(new THREE.PlaneGeometry(0.27, 0.27), mat(0x24282b, 0.6, 0.2)); sqPlate.position.set(DRIVER_SX, 0.02, 0.002); panel.add(sqPlate);
    // brake gauges: brake cylinder and main reservoir, right of the speedo
    const gauge = (label: string, max: number, red: number, x: number, r: number) => {
      const cv = gaugeTexture(label, max, red);
      const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
      const face = new THREE.Mesh(new THREE.CircleGeometry(r, 36), new THREE.MeshStandardMaterial({ map: t, roughness: 0.35 }));
      face.position.set(x, 0.02, 0.004); panel.add(face);
      const bz = new THREE.Mesh(new THREE.RingGeometry(r, r + 0.012, 36), mat(0x111111, 0.4, 0.5)); bz.position.set(x, 0.02, 0.005); panel.add(bz);
      const needle = new THREE.Mesh(new THREE.BoxGeometry(0.006, r * 0.85, 0.003).translate(0, r * 0.35, 0), mat(0xd43a2a, 0.5));
      needle.position.set(x, 0.02, 0.008); panel.add(needle);
      return { needle, max };
    };
    this.bcGauge = gauge('BRAKE CYL', 6, 4.5, DRIVER_SX + 0.21, 0.065);
    this.mrGauge = gauge('MAIN RES', 10, 9, DRIVER_SX + 0.36, 0.065);
    // CAWS aspect display (4 lamps, top to bottom: YY, G, Y, R) to the left of the speedo
    const cawsX = DRIVER_SX - 0.3;
    const cawsBox = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.3, 0.04), mat(0x1a1c1e, 0.5, 0.3)); cawsBox.position.set(cawsX, 0.03, 0.02); panel.add(cawsBox);
    const cawsFace = new THREE.Mesh(new THREE.PlaneGeometry(0.075, 0.26), mat(0x050505)); cawsFace.position.set(cawsX, 0.03, 0.041); panel.add(cawsFace);
    const lampDefs: [string, number, number][] = [['Y2', 0x332200, 0.12], ['G', 0x003311, 0.06], ['Y', 0x332200, 0.0], ['R', 0x330000, -0.06]];
    const lampCols: Record<string, number> = { Y2: 0xffb000, G: 0x22ff77, Y: 0xffb000, R: 0xff2200 };
    for (const [k, c, y] of lampDefs) {
      const m = new THREE.MeshStandardMaterial({ color: c, emissive: new THREE.Color(lampCols[k]), emissiveIntensity: 0 });
      this.lamps['caws' + k] = m;
      const l = new THREE.Mesh(new THREE.CircleGeometry(0.02, 20), m); l.position.set(cawsX, y, 0.042); panel.add(l);
    }
    const ct = labelMesh('CAWS', 0.08); ct.position.set(cawsX, -0.115, 0.042); panel.add(ct);
    // train management screen to the right of the speedo
    this.screenCanvas.width = 512; this.screenCanvas.height = 300;
    this.screenTex = new THREE.CanvasTexture(this.screenCanvas); this.screenTex.colorSpace = THREE.SRGBColorSpace;
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.2), new THREE.MeshStandardMaterial({ map: this.screenTex, emissive: 0xffffff, emissiveMap: this.screenTex, emissiveIntensity: 0.6, roughness: 0.2 }));
    scr.position.set(DRIVER_SX + 0.66, 0.02, 0.004); panel.add(scr);
    const scrFrame = new THREE.Mesh(new THREE.PlaneGeometry(0.37, 0.23), mat(0x101214)); scrFrame.position.set(DRIVER_SX + 0.66, 0.02, 0.003); panel.add(scrFrame);
    // indicator lamps (top row) and two rows of labelled push buttons with coloured caps, as on
    // Irish Rail stock: door test/release/interlock, demister, cab heater, fan, pantograph, lamp
    // test, reset. Buttons with an action are clickable; the rest are dressing.
    const indicator = (key: string, col: number, x: number, y: number, label: string) => {
      const m = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: new THREE.Color(col), emissiveIntensity: 0 });
      this.lamps[key] = m;
      const bez = new THREE.Mesh(new THREE.RingGeometry(0.014, 0.019, 16), mat(0x0a0a0a, 0.5, 0.6)); bez.position.set(x, y, 0.004); panel.add(bez);
      const l = new THREE.Mesh(new THREE.CircleGeometry(0.014, 16), m); l.position.set(x, y, 0.004); panel.add(l);
      const t = labelMesh(label, 0.09); t.position.set(x, y - 0.03, 0.004); panel.add(t);
    };
    indicator('interlock', 0x22ff55, 0.45, 0.15, 'DOORS CLOSED');
    indicator('doorsL', 0xffaa00, 0.33, 0.15, 'L OPEN');
    indicator('doorsR', 0xffaa00, 0.57, 0.15, 'R OPEN');
    indicator('pan', 0x44aaff, 0.72, 0.15, 'PAN UP');
    indicator('eb', 0xff2200, 0.87, 0.15, 'EMERG BRAKE');
    indicator('head', 0xffffff, 1.02, 0.15, 'HEADLIGHTS');
    const button = (action: string | null, col: number, x: number, y: number, r: number, label: string) => {
      const m = new THREE.MeshStandardMaterial({ color: col, roughness: 0.35, emissive: new THREE.Color(col), emissiveIntensity: 0.06 });
      const collar = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.008, r + 0.008, 0.012, 20), mat(0x15181a, 0.5, 0.5));
      collar.rotation.x = Math.PI / 2; collar.position.set(x, y, 0.006); panel.add(collar);
      const b = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.02, 20), m);
      b.rotation.x = Math.PI / 2; b.position.set(x, y, 0.016);
      if (action) { b.userData.action = action; this.clickables.push(b); }
      b.userData.label = label;
      panel.add(b);
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.085, 0.022), mat(0xe9e6dc, 0.6)); plate.position.set(x, y - r - 0.018, 0.003); panel.add(plate);
      const t = labelMesh(label, 0.082); t.position.set(x, y - r - 0.018, 0.004); (t.material as THREE.MeshBasicMaterial).color.setHex(0x111111); panel.add(t);
      return b;
    };
    const row1: [string | null, number, string][] = [['openL', 0x2e8b57, 'L DOOR REL'], ['closeL', 0xb03030, 'L DOOR CLOSE'], ['openR', 0x2e8b57, 'R DOOR REL'], ['closeR', 0xb03030, 'R DOOR CLOSE'], [null, 0xf2f2f2, 'DOOR TEST'], [null, 0xf2f2f2, 'DEMISTER']];
    const row2: [string | null, number, string][] = [['horn', 0x333333, 'HORN'], ['lights', 0xf2f2f2, 'HEAD LIGHTS'], ['wiper', 0x2255aa, 'WIPER'], ['panUp', 0x2255aa, 'PAN UP'], ['panDown', 0x1a2a44, 'PAN DOWN'], [null, 0xf5c400, 'LAMP TEST']];
    row1.forEach(([a, c, l], i) => button(a, c, 0.3 + i * 0.1, 0.05, 0.016, l));
    row2.forEach(([a, c, l], i) => button(a, c, 0.3 + i * 0.1, -0.05, 0.016, l));
    button('ack', 0xf5c400, DRIVER_SX - 0.3, -0.09, 0.03, 'CAWS ACK');
    // big red emergency mushroom on a yellow collar
    const mush = button('eb', 0xcc1100, 0.98, -0.07, 0.04, 'EMERGENCY');
    mush.scale.z = 2.2;
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.045, 0.06, 24), mat(0xf5c400, 0.6)); ring.position.set(0.98, -0.07, 0.004); panel.add(ring);
    // door controls on each side wall by the driver (left wall for the left doors, right wall for the right)
    const doorPanel = (sx: number) => {
      const dp = new THREE.Group();
      dp.position.set(W(sx * 1.34), 2.1, ZF - 1.1);
      dp.rotation.y = sx < 0 ? -Math.PI / 2 : Math.PI / 2;
      g.add(dp);
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.22), mat(0x1a1d1f)); dp.add(plate);
      const mk = (action: string, col: number, x: number, label: string) => {
        const b = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.02, 20), new THREE.MeshStandardMaterial({ color: col, emissive: new THREE.Color(col), emissiveIntensity: 0.08 }));
        b.rotation.x = Math.PI / 2; b.position.set(x, 0.02, 0.012); b.userData.action = action; b.userData.label = label;
        dp.add(b); this.clickables.push(b);
        const t = labelMesh(label, 0.09); t.position.set(x, -0.04, 0.003); dp.add(t);
      };
      const s = sx < 0 ? 'L' : 'R';
      mk(`open${s}`, 0x22aa44, -0.07, `OPEN ${s}`);
      mk(`close${s}`, 0xcc2222, 0.07, `CLOSE ${s}`);
      const t = labelMesh(sx < 0 ? 'LEFT DOORS' : 'RIGHT DOORS', 0.18); t.position.set(0, 0.085, 0.003); dp.add(t);
    };
    doorPanel(-1); doorPanel(1);
    // master controller: combined traction/brake handle at the driver's left hand
    this.lever = new THREE.Group();
    this.lever.position.set(W(DRIVER_SX - 0.42), 2.0, ZF - 0.8);
    g.add(this.lever);
    const quad = new THREE.Mesh(box, darkPanel); quad.scale.set(0.12, 0.05, 0.36); quad.position.copy(this.lever.position); g.add(quad);
    const shaft = new THREE.Mesh(box, mat(0x777777, 0.3, 0.8)); shaft.scale.set(0.025, 0.2, 0.025); shaft.position.y = 0.1; this.lever.add(shaft);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 12), mat(0x111111, 0.4)); knob.position.y = 0.21; this.lever.add(knob);
    knob.userData.action = 'lever'; shaft.userData.action = 'lever';
    this.clickables.push(knob, shaft);
    const nl = labelMesh('POWER ↑  ·  BRAKE ↓', 0.24); nl.position.set(W(DRIVER_SX - 0.42), 2.01, ZF - 0.55); nl.rotation.set(-Math.PI / 2, 0, Math.PI); g.add(nl);

    // driver's key switch on the desk, right of the controller
    const keyBase = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.03, 20), mat(0x222426, 0.4, 0.6)); keyBase.position.set(W(DRIVER_SX - 0.12), 2.02, ZF - 0.78); g.add(keyBase);
    const key = P(mat(0xc9b037, 0.3, 0.8), 0.01, 0.07, 0.03, DRIVER_SX - 0.12, 2.07, ZF - 0.78); key.rotation.z = 0.5;
    // radio handset cradled on the left wall by the driver
    const cradle = P(mat(0x1d1f21, 0.5, 0.3), 0.06, 0.22, 0.09, -1.33, 2.45, ZF - 1.55);
    void cradle;
    const handset = P(mat(0x2a2d30, 0.45, 0.2), 0.05, 0.2, 0.06, -1.3, 2.47, ZF - 1.55); handset.rotation.z = 0.08;
    const cord = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.006, 6, 24, Math.PI), mat(0x111111, 0.6)); cord.position.set(W(-1.3), 2.3, ZF - 1.55); cord.rotation.y = Math.PI / 2; g.add(cord);
    // headrest, grab rail, ceiling light panel and the door back to the saloon
    P(seatCloth, 0.4, 0.22, 0.12, DRIVER_SX, 2.55, EYE.z - 0.5);
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1.0, 10), mat(0xd9dcdd, 0.3, 0.8)); rail.rotation.z = Math.PI / 2; rail.position.set(0.3, 3.25, ZF - 0.14); g.add(rail);
    this.ceilingLight = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, emissive: new THREE.Color(1, 0.95, 0.85), emissiveIntensity: 0 });
    P(this.ceilingLight, 0.9, 0.02, 0.25, 0, 3.52, ZF - 1.2, false);
    P(mat(0x8f9496, 0.6), 0.8, 2.0, 0.04, 0.55, 2.1, ZF - 2.37);
    P(mat(0x1a2328, 0.05, 0.2), 0.5, 0.5, 0.02, 0.55, 2.7, ZF - 2.35, false);
    P(mat(0xd9dcdd, 0.3, 0.8), 0.03, 0.25, 0.04, 0.9, 2.1, ZF - 2.34);

    this.light = new THREE.PointLight(0xffe2b8, 0, 4, 1.5);
    this.light.position.set(0, 3.4, ZF - 1.2);
    g.add(this.light);
    this.drawSpeedo(0, 0, null, 0);
  }

  update(dt: number, st: CabState, night: number) {
    // lever: pushed forward for power, pulled back for brake
    const ang = (st.notch / Math.max(NOTCH_MAX, -NOTCH_MIN)) * 0.75;
    this.lever.rotation.x += (ang - this.lever.rotation.x) * Math.min(1, dt * 12);
    const sp = `${Math.round(st.kmh * 2)}|${st.limitKmh}|${st.nextLimitKmh}|${st.notch}`;
    if (sp !== this.lastSpeedo) { this.lastSpeedo = sp; this.drawSpeedo(st.kmh, st.limitKmh, st.nextLimitKmh, st.notch); }
    const on = (k: string, v: boolean, i = 2.5) => { this.lamps[k].emissiveIntensity = v ? i : 0; this.lamps[k].color.setHex(v ? 0xffffff : 0x111111); };
    const blink = st.warning && Math.floor(performance.now() / 300) % 2 === 0;
    on('cawsG', st.aspect === 'G'); on('cawsY', (st.aspect === 'Y' || st.aspect === 'YY') && !blink); on('cawsY2', st.aspect === 'YY' && !blink); on('cawsR', st.aspect === 'R' && !blink);
    on('interlock', st.interlock); on('doorsL', st.doorsLeft > 0.01); on('doorsR', st.doorsRight > 0.01);
    on('pan', st.pantograph, 1.5); on('eb', st.ebActive); on('head', st.headlights, 1.2);
    const sc = JSON.stringify(st.screen);
    if (sc !== this.lastScreen) { this.lastScreen = sc; this.drawScreen(st); }
    this.light.intensity = night * 0.6;
    this.ceilingLight.emissiveIntensity = night * 1.5;
    const ga = (v: number, max: number) => -(Math.PI * 0.75 + (Math.PI * 1.5 * Math.min(1, v / max)) - Math.PI * 1.5);
    this.bcGauge.needle.rotation.z += (ga(st.bcBar, this.bcGauge.max) - this.bcGauge.needle.rotation.z) * Math.min(1, dt * 6);
    this.mrGauge.needle.rotation.z += (ga(st.mrBar, this.mrGauge.max) - this.mrGauge.needle.rotation.z) * Math.min(1, dt * 6);
    if (this.wiperOn || this.wiperT > 0) {
      this.wiperT += dt * 1.6;
      this.wiper.rotation.z = Math.sin(this.wiperT * Math.PI) * 1.1;
      if (!this.wiperOn && Math.abs(Math.sin(this.wiperT * Math.PI)) < 0.03) { this.wiperT = 0; this.wiper.rotation.z = 0; }
    }
  }

  private drawSpeedo(kmh: number, limit: number, next: number | null, notch: number) {
    const c = this.speedoCanvas.getContext('2d')!;
    const W2 = 256, cx = 128, cy = 128, R = 118;
    c.fillStyle = '#0b0d0e'; c.fillRect(0, 0, W2, W2);
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25, max = 120;
    const ang = (v: number) => a0 + (a1 - a0) * Math.min(1, v / max);
    c.lineWidth = 10; c.strokeStyle = '#d33'; c.beginPath(); c.arc(cx, cy, R - 10, ang(limit), ang(max)); c.stroke();
    c.strokeStyle = '#2a6'; c.beginPath(); c.arc(cx, cy, R - 10, a0, ang(limit)); c.stroke();
    c.strokeStyle = '#ddd'; c.fillStyle = '#ddd'; c.lineWidth = 2; c.font = 'bold 15px Arial'; c.textAlign = 'center'; c.textBaseline = 'middle';
    for (let v = 0; v <= max; v += 10) {
      const a = ang(v), big = v % 20 === 0;
      c.beginPath(); c.moveTo(cx + Math.cos(a) * (R - 18), cy + Math.sin(a) * (R - 18)); c.lineTo(cx + Math.cos(a) * (R - (big ? 32 : 26)), cy + Math.sin(a) * (R - (big ? 32 : 26))); c.stroke();
      if (big) c.fillText(String(v), cx + Math.cos(a) * (R - 46), cy + Math.sin(a) * (R - 46));
    }
    c.font = 'bold 30px Arial'; c.fillStyle = '#fff'; c.fillText(String(Math.round(kmh)), cx, cy + 40);
    c.font = '12px Arial'; c.fillStyle = '#aaa'; c.fillText('km/h', cx, cy + 62);
    c.fillStyle = '#f5c400'; c.font = 'bold 14px Arial'; c.fillText(notchLabel(notch), cx, cy - 40);
    if (next != null) { c.fillStyle = '#8cf'; c.font = '12px Arial'; c.fillText(`next ${next}`, cx, cy + 80); }
    const a = ang(kmh);
    c.strokeStyle = '#ff6a00'; c.lineWidth = 4; c.beginPath(); c.moveTo(cx - Math.cos(a) * 12, cy - Math.sin(a) * 12); c.lineTo(cx + Math.cos(a) * (R - 22), cy + Math.sin(a) * (R - 22)); c.stroke();
    c.fillStyle = '#333'; c.beginPath(); c.arc(cx, cy, 9, 0, Math.PI * 2); c.fill();
    this.speedoTex.needsUpdate = true;
  }

  private drawScreen(st: CabState) {
    const c = this.screenCanvas.getContext('2d')!;
    c.fillStyle = '#05131c'; c.fillRect(0, 0, 512, 300);
    c.fillStyle = '#0e3a52'; c.fillRect(0, 0, 512, 44);
    c.fillStyle = '#fff'; c.font = 'bold 26px Arial'; c.textAlign = 'left'; c.fillText('DART', 14, 31);
    c.textAlign = 'right'; c.fillText(st.screen.clock, 498, 31);
    c.textAlign = 'left'; c.fillStyle = '#9fd3ff'; c.font = '20px Arial'; c.fillText('Next stop', 14, 80);
    c.fillStyle = '#fff'; c.font = 'bold 30px Arial'; c.fillText(st.screen.next.slice(0, 26), 14, 116);
    c.font = '22px Arial'; c.fillStyle = '#ddd';
    c.fillText(`Due ${st.screen.nextArr}`, 14, 156); c.fillText(st.screen.dist, 260, 156);
    c.fillStyle = /late/.test(st.screen.delta) ? '#ff8a65' : '#9be89b'; c.font = 'bold 24px Arial';
    c.fillText(st.screen.delta, 14, 196);
    c.fillStyle = '#f5c400'; c.font = '20px Arial'; c.fillText(st.screen.msg.slice(0, 40), 14, 250);
    this.screenTex.needsUpdate = true;
  }
}

function labelMesh(text: string, width: number): THREE.Mesh {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 48;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#cfd4d6'; g.font = 'bold 26px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 128, 26);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.PlaneGeometry(width, (width * 48) / 256), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, toneMapped: false }));
}
