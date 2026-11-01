// Colour-light signal heads (4-aspect: Y / G / Y / R from the top), repeaters and speed boards.
import * as THREE from 'three';
import type { TrackPath } from '../dart/path';
import { textTexture } from './textures';

export type Aspect = 'R' | 'Y' | 'YY' | 'G' | 'OFF';
const LAMP_COL = { G: new THREE.Color(0.2, 1, 0.55), Y: new THREE.Color(1, 0.7, 0.1), R: new THREE.Color(1, 0.08, 0.04) };
const dark = new THREE.MeshStandardMaterial({ color: 0x0c0c0c, roughness: 0.6 });
const post = new THREE.MeshStandardMaterial({ color: 0x9aa0a4, roughness: 0.6, metalness: 0.5 });
const white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 });
const cabinet = new THREE.MeshStandardMaterial({ color: 0x6f7d72, roughness: 0.6, metalness: 0.3 });
const box = new THREE.BoxGeometry(1, 1, 1);
const lampGeo = new THREE.CircleGeometry(0.1, 16);
const hoodGeo = new THREE.CylinderGeometry(0.13, 0.13, 0.22, 12, 1, true, 0, Math.PI);

export class SignalMesh {
  readonly group = new THREE.Group();
  private lamps: { mat: THREE.MeshStandardMaterial; col: THREE.Color; key: 'Y2' | 'G' | 'Y' | 'R' }[] = [];
  private current: Aspect | null = null;

  constructor(path: TrackPath, s: number, side: number, ref: string, repeater = false) {
    const p = path.offsetPoint(s, side * 2.4, 0);
    this.group.position.copy(p);
    this.group.rotation.y = path.heading(s) + Math.PI; // face oncoming trains
    const h = repeater ? 2.6 : 3.6;
    const m = new THREE.Mesh(box, post); m.scale.set(0.14, h, 0.14); m.position.y = h / 2; m.castShadow = true; this.group.add(m);
    const keys: ('Y2' | 'G' | 'Y' | 'R')[] = repeater ? ['G', 'Y'] : ['Y2', 'G', 'Y', 'R'];
    const headH = keys.length * 0.3 + 0.12;
    const head = new THREE.Mesh(box, dark); head.scale.set(0.42, headH, 0.28); head.position.set(0, h + headH / 2, 0); head.castShadow = true; this.group.add(head);
    // white border (sighting board)
    const board = new THREE.Mesh(box, white); board.scale.set(0.5, headH + 0.08, 0.02); board.position.set(0, h + headH / 2, -0.15); this.group.add(board);
    keys.forEach((k, i) => {
      const mat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: new THREE.Color(0, 0, 0), roughness: 0.2 });
      mat.userData.perItem = true;
      const lamp = new THREE.Mesh(lampGeo, mat);
      const y = h + headH - 0.21 - i * 0.3;
      lamp.position.set(0, y, 0.145);
      this.group.add(lamp);
      const hood = new THREE.Mesh(hoodGeo, dark); hood.rotation.x = Math.PI / 2; hood.rotation.y = Math.PI; hood.position.set(0, y + 0.02, 0.25); this.group.add(hood);
      this.lamps.push({ mat, col: k === 'G' ? LAMP_COL.G : k === 'R' ? LAMP_COL.R : LAMP_COL.Y, key: k });
    });
    // location cabinet (relay case) behind the signal
    if (!repeater) {
      const cab = new THREE.Mesh(box, cabinet); cab.scale.set(0.9, 1.35, 0.55); cab.position.set(side * 1.3, 0.675, -2.6); cab.castShadow = true; this.group.add(cab);
      const plinth = new THREE.Mesh(box, dark); plinth.scale.set(1.1, 0.12, 0.75); plinth.position.set(side * 1.3, 0.06, -2.6); this.group.add(plinth);
    }
    // identification plate
    const plateMat = new THREE.MeshStandardMaterial({ map: textTexture(ref, { w: 256, h: 92, bg: '#ffffff', fg: '#000000' }) });
    plateMat.userData.perItem = true;
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.18), plateMat);
    plate.position.set(0, h - 0.6, 0.08); this.group.add(plate);
    this.group.traverse((o) => { o.matrixAutoUpdate = false; o.updateMatrix(); });
  }

  setAspect(a: Aspect, intensity = 6) {
    if (a === this.current) return;
    this.current = a;
    for (const l of this.lamps) {
      const on = (a === 'G' && l.key === 'G') || (a === 'R' && l.key === 'R') || ((a === 'Y' || a === 'YY') && l.key === 'Y') || (a === 'YY' && l.key === 'Y2');
      l.mat.emissive.copy(on ? l.col : new THREE.Color(0, 0, 0)).multiplyScalar(on ? intensity : 0);
      l.mat.color.setHex(on ? 0xffffff : 0x111111);
    }
  }
}

/** Lineside speed board (Irish Rail boards show mph). */
export function speedBoard(path: TrackPath, s: number, mph: number): THREE.Group {
  const g = new THREE.Group();
  g.position.copy(path.offsetPoint(s, -2.3, 0));
  g.rotation.y = path.heading(s) + Math.PI;
  const m = new THREE.Mesh(box, post); m.scale.set(0.08, 1.8, 0.08); m.position.y = 0.9; g.add(m);
  const bm = new THREE.MeshStandardMaterial({ map: textTexture(String(mph), { w: 128, h: 96, bg: '#ffffff', fg: '#000000' }) });
  bm.userData.perItem = true;
  const b = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.45), bm);
  b.position.y = 2.0; g.add(b);
  g.traverse((o) => { o.matrixAutoUpdate = false; o.updateMatrix(); });
  return g;
}
