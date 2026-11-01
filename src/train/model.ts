// A 4-car DART-style electric multiple unit, built in code: body with livery, cab ends,
// windscreens, sliding plug doors, windows with lit interiors, bogies, pantograph.
import * as THREE from 'three';
import type { TrackPath } from '../dart/path';
import { destinationTexture } from '../render/textures';
import { WIRE_HEIGHT } from '../render/track';

export const CAR_LEN = 20.3;
export const CAR_GAP = 0.6;
export const BODY_W = 2.88;
export const FLOOR_H = 1.1;
export const ROOF_H = 3.72;
const BOGIE_OFF = 7.2;
export const DOOR_Z = [-5.2, 5.2]; // door centres along each car (m from car centre)
export const DOOR_W = 1.3;

let shared: {
  body: THREE.BufferGeometry; bodyCab: THREE.BufferGeometry; bodyMat: THREE.MeshStandardMaterial; glass: THREE.MeshStandardMaterial; dark: THREE.MeshStandardMaterial;
  bogie: THREE.MeshStandardMaterial; wheel: THREE.BufferGeometry; steel: THREE.MeshStandardMaterial; door: THREE.MeshStandardMaterial;
  yellow: THREE.MeshStandardMaterial; interior: THREE.MeshStandardMaterial; seat: THREE.MeshStandardMaterial; rubber: THREE.MeshStandardMaterial;
} | null = null;

function sharedParts() {
  if (shared) return shared;
  const sh = new THREE.Shape();
  const hw = BODY_W / 2;
  sh.moveTo(-hw + 0.1, 0.95);
  sh.lineTo(hw - 0.1, 0.95);
  sh.quadraticCurveTo(hw, 0.95, hw, 1.2);
  sh.lineTo(hw, 3.1);
  sh.quadraticCurveTo(hw - 0.05, 3.55, hw - 0.6, ROOF_H - 0.05);
  sh.quadraticCurveTo(0, ROOF_H + 0.04, -hw + 0.6, ROOF_H - 0.05);
  sh.quadraticCurveTo(-hw + 0.05, 3.55, -hw, 3.1);
  sh.lineTo(-hw, 1.2);
  sh.quadraticCurveTo(-hw, 0.95, -hw + 0.1, 0.95);
  const body = new THREE.ExtrudeGeometry(sh, { depth: CAR_LEN, bevelEnabled: false, curveSegments: 8 });
  body.translate(0, 0, -CAR_LEN / 2);
  // cab cars: the same profile with a rounded (bevelled) front end
  const bodyCab = new THREE.ExtrudeGeometry(sh, { depth: CAR_LEN - 0.9, bevelEnabled: true, bevelThickness: 0.45, bevelSize: 0.22, bevelSegments: 4, curveSegments: 8 });
  bodyCab.translate(0, 0, -CAR_LEN / 2 + 0.45);
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.3 });
  bodyMat.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vLocal;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvLocal = position;');
    s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vLocal;').replace('#include <map_fragment>', `
      // all-green livery: body green, slightly darker roof
      vec3 green = vec3(0.02, 0.17, 0.07), roofc = vec3(0.015, 0.11, 0.05);
      float y = vLocal.y;
      vec3 c = y < 3.25 ? green : roofc;
      diffuseColor.rgb *= c;`);
  };
  bodyMat.customProgramCacheKey = () => 'dart-livery';
  const wheel = new THREE.CylinderGeometry(0.42, 0.42, 0.14, 18);
  wheel.rotateZ(Math.PI / 2);
  shared = {
    body, bodyCab, bodyMat,
    glass: new THREE.MeshStandardMaterial({ color: 0x1a2328, roughness: 0.04, metalness: 0.2, transparent: true, opacity: 0.55 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x15181a, roughness: 0.6 }),
    bogie: new THREE.MeshStandardMaterial({ color: 0x24282a, roughness: 0.7, metalness: 0.4 }),
    wheel,
    steel: new THREE.MeshStandardMaterial({ color: 0x8a8f93, roughness: 0.4, metalness: 0.8 }),
    door: new THREE.MeshStandardMaterial({ color: 0x0a4a22, roughness: 0.3, metalness: 0.4 }),
    yellow: new THREE.MeshStandardMaterial({ color: 0xf5c400, roughness: 0.35, metalness: 0.2 }),
    interior: new THREE.MeshStandardMaterial({ color: 0xd8dad6, roughness: 0.6, emissive: new THREE.Color(0.9, 0.95, 1), emissiveIntensity: 0.06 }),
    seat: new THREE.MeshStandardMaterial({ color: 0x1d3f6b, roughness: 0.9 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 }),
  };
  return shared;
}

const box = new THREE.BoxGeometry(1, 1, 1);
const INNER = new THREE.MeshStandardMaterial({ color: 0xc9ccc8, roughness: 0.7 });
function add(parent: THREE.Object3D, mat: THREE.Material, sx: number, sy: number, sz: number, x: number, y: number, z: number, shadow = false): THREE.Mesh {
  const m = new THREE.Mesh(box, mat); m.scale.set(sx, sy, sz); m.position.set(x, y, z); m.castShadow = shadow; parent.add(m); return m;
}

export interface Car { group: THREE.Group; doors: { left: THREE.Mesh[]; right: THREE.Mesh[] }; wheels: THREE.Mesh[]; exterior: THREE.Object3D[]; doorLights: THREE.MeshStandardMaterial[] }

export class TrainModel {
  readonly group = new THREE.Group();
  readonly cars: Car[] = [];
  readonly length: number;
  private headLights: THREE.MeshStandardMaterial;
  private tailLights: THREE.MeshStandardMaterial;
  private destMats: THREE.MeshStandardMaterial[] = [];
  private panArms: { lower: THREE.Mesh; upper: THREE.Mesh; head: THREE.Mesh } | null = null;
  readonly frontLight: THREE.SpotLight | null;
  private wheelAngle = 0;
  doorOpen = { left: 0, right: 0 };

  constructor(nCars = 4, destination = 'Howth', withLight = false) {
    const S = sharedParts();
    this.length = nCars * CAR_LEN + (nCars - 1) * CAR_GAP;
    this.headLights = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: new THREE.Color(1, 0.95, 0.85), emissiveIntensity: 4 });
    this.tailLights = new THREE.MeshStandardMaterial({ color: 0x330000, emissive: new THREE.Color(1, 0.05, 0.02), emissiveIntensity: 3 });
    for (let i = 0; i < nCars; i++) {
      const g = new THREE.Group();
      const exterior: THREE.Object3D[] = [];
      const isCab = i === 0 || i === nCars - 1;
      const body = new THREE.Mesh(isCab ? S.bodyCab : S.body, S.bodyMat); body.castShadow = true; body.receiveShadow = true; g.add(body); exterior.push(body);
      // roof conduits and vents
      for (const rx of [-0.9, 0.9]) { const c = add(g, S.dark, 0.12, 0.1, CAR_LEN - 2, rx, ROOF_H + 0.04, 0); exterior.push(c); }
      for (let vz = -7; vz <= 7; vz += 3.5) { const v = add(g, S.dark, 0.6, 0.12, 0.9, 0, ROOF_H + 0.05, vz); exterior.push(v); }
      // windows: band of glass with lit interior behind
      const doors = { left: [] as THREE.Mesh[], right: [] as THREE.Mesh[] };
      const doorLights: THREE.MeshStandardMaterial[] = [];
      const winSegs: [number, number][] = [[-9.2, -6.0], [-4.4, 4.4], [6.0, 9.2]];
      for (const side of [-1, 1]) {
        const x = side * (BODY_W / 2 + 0.005);
        for (const [z0, z1] of winSegs) {
          // leave the cab section at each end of the unit without saloon windows
          const za = i === nCars - 1 ? Math.max(z0, -7.6) : z0, zb = i === 0 ? Math.min(z1, 7.6) : z1;
          const w = add(g, S.glass, 0.02, 0.95, zb - za, x, 2.35, (za + zb) / 2); exterior.push(w);
          const fr = add(g, S.rubber, 0.012, 1.03, zb - za + 0.08, x - side * 0.008, 2.35, (za + zb) / 2); exterior.push(fr);
          // mullions between the panes
          for (let mz = za + 1.45; mz < zb - 0.3; mz += 1.45) { const m = add(g, S.rubber, 0.025, 0.95, 0.05, x + side * 0.004, 2.35, mz); exterior.push(m); }
        }
        for (const dz of DOOR_Z) {
          for (const leaf of [-1, 1]) {
            const d = add(g, S.door, 0.04, 2.05, DOOR_W / 2 - 0.02, x + side * 0.02, 2.0, dz + leaf * DOOR_W / 4, true);
            const dw = add(d, S.glass, 1.2, 0.35, 0.7, 0, 0.18, 0); dw.scale.set(1.2, 0.33, 0.7);
            d.userData.closedZ = d.position.z; d.userData.leaf = leaf;
            (side < 0 ? doors.right : doors.left).push(d); // local -x is the right-hand side of the train
            exterior.push(d);
          }
          const dl = new THREE.MeshStandardMaterial({ color: 0x331a00, emissive: new THREE.Color(1, 0.55, 0), emissiveIntensity: 0 });
          doorLights.push(dl);
          add(g, dl, 0.03, 0.06, 0.25, x + side * 0.02, 3.12, dz);
        }
      }
      // inner shell: walls with real window openings, so the saloon reads correctly from inside
      const inner = INNER;
      // the saloon excludes the cab area at each end of the unit (the cab has its own shell)
      const sz0 = i === nCars - 1 ? -CAR_LEN / 2 + 2.45 : -CAR_LEN / 2 + 0.15, sz1 = i === 0 ? CAR_LEN / 2 - 2.45 : CAR_LEN / 2 - 0.15;
      for (const side of [-1, 1]) {
        const x = side * (BODY_W / 2 - 0.06);
        add(g, inner, 0.04, 0.78, sz1 - sz0, x, 1.49, (sz0 + sz1) / 2);
        add(g, inner, 0.04, 0.32, sz1 - sz0, x, 2.99, (sz0 + sz1) / 2);
        const open: [number, number][] = [...winSegs.map(([a, b]) => [Math.max(a, sz0), Math.min(b, sz1)] as [number, number]), ...DOOR_Z.map((d) => [d - DOOR_W / 2, d + DOOR_W / 2] as [number, number])].filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0]);
        let z = sz0;
        for (const [a, b] of open) { if (a - z > 0.02) add(g, inner, 0.04, 0.95, a - z, x, 2.355, (a + z) / 2); z = Math.max(z, b); }
        if (sz1 - z > 0.02) add(g, inner, 0.04, 0.95, sz1 - z, x, 2.355, (sz1 + z) / 2);
      }
      for (const ez of [sz0, sz1]) add(g, inner, BODY_W - 0.1, 2.1, 0.04, 0, 2.15, ez);
      // interior (seen through windows)
      add(g, S.interior, BODY_W - 0.2, 0.05, CAR_LEN - 1.2, 0, 3.15, 0);
      add(g, S.dark, BODY_W - 0.2, 0.05, CAR_LEN - 1.2, 0, FLOOR_H, 0);
      for (let z = -8.5; z <= 8.5; z += 1.7) {
        if (DOOR_Z.some((d) => Math.abs(z - d) < 1.1)) continue;
        for (const side of [-1, 1]) add(g, S.seat, 0.95, 0.5, 0.5, side * 0.85, 1.45, z);
      }
      // underframe equipment, bogies, wheels, couplers
      const under = add(g, S.bogie, BODY_W - 0.5, 0.55, CAR_LEN - 7, 0, 0.75, 0, true); exterior.push(under);
      const wheels: THREE.Mesh[] = [];
      for (const bz of [-BOGIE_OFF, BOGIE_OFF]) {
        const fr = add(g, S.bogie, 2.2, 0.35, 2.9, 0, 0.62, bz, true); exterior.push(fr);
        for (const az of [-1.25, 1.25]) for (const ax of [-0.84, 0.84]) {
          const w = new THREE.Mesh(S.wheel, S.steel); w.position.set(ax, 0.42, bz + az); g.add(w); wheels.push(w); exterior.push(w);
        }
      }
      // gangway bellows between cars
      if (i < nCars - 1) { const b = add(g, S.rubber, 2.2, 2.6, CAR_GAP + 0.2, 0, 2.3, -CAR_LEN / 2 - CAR_GAP / 2); exterior.push(b); }
      // roof equipment
      const r1 = add(g, S.dark, 1.6, 0.3, 3.5, 0, ROOF_H + 0.1, -3, true); exterior.push(r1);
      this.cars.push({ group: g, doors, wheels, exterior, doorLights });
      this.group.add(g);
    }
    // Cab ends: car 0 front (+z), last car rear (-z)
    this.frontLight = null;
    [[0, 1], [nCars - 1, -1]].forEach(([ci, dir]) => {
      const g = this.cars[ci].group;
      const zf = dir * (CAR_LEN / 2);
      const ext = this.cars[ci].exterior;
      const nose = new THREE.Group(); nose.position.z = zf; nose.scale.z = dir; g.add(nose); ext.push(nose);
      add(nose, S.yellow, BODY_W - 0.02, 1.15, 0.12, 0, 1.55, 0.02, true);
      add(nose, S.glass, BODY_W - 0.35, 1.05, 0.05, 0, 2.62, 0.04).rotation.x = -0.12;
      add(nose, S.dark, BODY_W - 0.1, 0.32, 0.08, 0, 3.32, 0.03);
      add(nose, S.yellow, BODY_W - 0.02, 0.12, 0.1, 0, 3.55, 0.01);
      add(nose, S.dark, 0.06, 1.15, 0.1, -0.05, 2.62, 0.06);
      for (const sx of [-0.95, 0.95]) {
        add(nose, this.headLights, 0.22, 0.14, 0.04, sx, 1.42, 0.09);
        add(nose, this.tailLights, 0.12, 0.12, 0.04, sx + (sx > 0 ? -0.25 : 0.25), 1.42, 0.09);
      }
      add(nose, S.dark, 0.5, 0.25, 0.25, 0, 0.95, 0.15); // coupler
      const dm = new THREE.MeshStandardMaterial({ map: destinationTexture(destination), emissive: new THREE.Color(1, 1, 1), emissiveMap: null, emissiveIntensity: 0.0 });
      dm.emissiveMap = dm.map;
      dm.emissiveIntensity = 1.2;
      this.destMats.push(dm);
      const dp = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.24), dm); dp.position.set(0.55, 3.32, 0.075); if (dir < 0) dp.rotation.y = Math.PI; nose.add(dp);
    });
    // Pantograph on car 2 roof
    if (nCars > 1) {
      const g = this.cars[1].group;
      const base = add(g, S.dark, 1.4, 0.15, 1.6, 0, ROOF_H + 0.08, 3);
      this.cars[1].exterior.push(base);
      const lower = add(g, S.steel, 0.08, 0.08, 1.7, 0, 0, 0); const upper = add(g, S.steel, 0.06, 0.06, 1.75, 0, 0, 0); const head = add(g, S.steel, 1.7, 0.06, 0.25, 0, 0, 0);
      this.cars[1].exterior.push(lower, upper, head);
      this.panArms = { lower, upper, head };
      this.setPantograph(WIRE_HEIGHT);
    }
    if (withLight) {
      const sl = new THREE.SpotLight(0xfff1dd, 0, 220, 0.32, 0.6, 1.4);
      sl.position.set(0, 1.5, CAR_LEN / 2 + 0.2);
      sl.target.position.set(0, 0, CAR_LEN / 2 + 60);
      this.cars[0].group.add(sl, sl.target);
      (this as { frontLight: THREE.SpotLight | null }).frontLight = sl;
    }
    this.group.traverse((o) => { o.frustumCulled = true; });
  }

  /** Raises the single-arm pantograph so the head touches the wire at `wireAboveRail`. */
  setPantograph(wireAboveRail: number, raised = true) {
    if (!this.panArms) return;
    const baseY = ROOF_H + 0.15, baseZ = 3.8;
    const target = raised ? wireAboveRail - 0.05 : ROOF_H + 0.45;
    const L1 = 1.7, L2 = 1.75;
    const h = Math.max(0.2, target - baseY);
    // knee position: solve two-link with head straight above base at z = baseZ - 0.6
    const hz = baseZ - 0.6, d = Math.hypot(h, 0.6);
    const a = Math.acos(Math.min(1, (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d)));
    const ang0 = Math.atan2(h, -0.6);
    const kneeAng = ang0 - a;
    const knee = new THREE.Vector3(0, baseY + Math.sin(kneeAng) * L1, baseZ + Math.cos(kneeAng) * L1);
    const headP = new THREE.Vector3(0, baseY + h, hz);
    const basePt = new THREE.Vector3(0, baseY, baseZ);
    const seg = (m: THREE.Mesh, p0: THREE.Vector3, p1: THREE.Vector3) => {
      m.position.copy(p0).add(p1).multiplyScalar(0.5);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), p1.clone().sub(p0).normalize());
      m.scale.z = p0.distanceTo(p1);
    };
    seg(this.panArms.lower, basePt, knee);
    seg(this.panArms.upper, knee, headP);
    this.panArms.head.position.copy(headP).add(new THREE.Vector3(0, 0.03, 0));
  }

  setLights(on: boolean, night: number) {
    this.headLights.emissiveIntensity = on ? 3 + night * 4 : 0.2;
    this.tailLights.emissiveIntensity = on ? 2 + night * 2 : 0.1;
    if (this.frontLight) this.frontLight.intensity = on ? night * 900 + 40 : 0;
    sharedParts().interior.emissiveIntensity = 0.05 + night * 0.6;
  }

  setDestination(text: string) {
    for (const m of this.destMats) { m.map?.dispose(); const t = destinationTexture(text); m.map = t; m.emissiveMap = t; m.needsUpdate = true; }
  }

  /** Door animation: 0 closed .. 1 fully open, per side (left/right relative to the direction of travel). */
  updateDoors() {
    for (const c of this.cars) {
      for (const [side, list] of [['left', c.doors.left], ['right', c.doors.right]] as const) {
        const f = this.doorOpen[side];
        // plug doors: move out 4 cm, then slide
        const out = Math.min(1, f * 4) * 0.05;
        const slide = Math.max(0, (f - 0.15) / 0.85) * (DOOR_W / 2 - 0.05);
        for (const d of list) {
          d.position.z = d.userData.closedZ + d.userData.leaf * slide;
          d.position.x = (side === 'left' ? 1 : -1) * (BODY_W / 2 + 0.03 + out);
        }
      }
      const anyOpen = this.doorOpen.left > 0.01 || this.doorOpen.right > 0.01;
      c.doorLights.forEach((m) => (m.emissiveIntensity = anyOpen ? 3 : 0));
    }
  }

  /** Positions each car on the path; frontS is the chainage of the leading coupler. */
  placeOnPath(path: TrackPath, frontS: number, reversed = false, speed = 0, dt = 0) {
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    for (let i = 0; i < this.cars.length; i++) {
      const cs = frontS - CAR_LEN / 2 - i * (CAR_LEN + CAR_GAP);
      path.point(cs + BOGIE_OFF, a); path.point(cs - BOGIE_OFF, b);
      const g = this.cars[i].group;
      g.position.addVectors(a, b).multiplyScalar(0.5);
      const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
      const yaw = Math.atan2(dx, dz) + (reversed ? Math.PI : 0);
      const pitch = -Math.atan2(dy, Math.hypot(dx, dz)) * (reversed ? -1 : 1);
      const roll = Math.max(-0.035, Math.min(0.035, path.curvature(cs) * speed * speed * 0.004)) * (reversed ? -1 : 1);
      g.rotation.set(pitch, yaw, roll, 'YXZ');
    }
    this.wheelAngle += (speed * dt) / 0.42;
    for (const c of this.cars) for (const w of c.wheels) w.rotation.x = this.wheelAngle;
  }

  setExteriorVisible(carIndex: number, v: boolean) { for (const o of this.cars[carIndex].exterior) o.visible = v; }

  dispose() {
    this.destMats.forEach((m) => { m.map?.dispose(); m.dispose(); });
    this.headLights.dispose(); this.tailLights.dispose();
  }
}
