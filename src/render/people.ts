// Low-poly passengers, instanced, with per-person clothing colours and a walking bob.
import * as THREE from 'three';

function personGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, x: number, y: number, z: number, colourIdx: number) => {
    g.translate(x, y, z);
    const n = g.attributes.position.count;
    g.setAttribute('part', new THREE.Float32BufferAttribute(new Array(n).fill(colourIdx), 1));
    parts.push(g.index ? g.toNonIndexed() : g);
  };
  add(new THREE.CylinderGeometry(0.075, 0.06, 0.82, 6), -0.1, 0.41, 0, 0); // legs
  add(new THREE.CylinderGeometry(0.075, 0.06, 0.82, 6), 0.1, 0.41, 0, 0);
  add(new THREE.CylinderGeometry(0.2, 0.17, 0.62, 8), 0, 1.12, 0, 1); // torso
  add(new THREE.CylinderGeometry(0.05, 0.045, 0.6, 5), -0.25, 1.1, 0, 1); // arms
  add(new THREE.CylinderGeometry(0.05, 0.045, 0.6, 5), 0.25, 1.1, 0, 1);
  add(new THREE.SphereGeometry(0.11, 10, 8), 0, 1.57, 0, 2); // head
  add(new THREE.SphereGeometry(0.115, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), 0, 1.6, -0.005, 3); // hair
  const pos: number[] = [], nor: number[] = [], part: number[] = [];
  for (const g of parts) { pos.push(...(g.attributes.position.array as Float32Array)); nor.push(...(g.attributes.normal.array as Float32Array)); part.push(...(g.attributes.part.array as Float32Array)); }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('part', new THREE.Float32BufferAttribute(part, 1));
  return out;
}

export interface PersonVisual { x: number; y: number; z: number; heading: number; walking: boolean; phase: number; colours: [number, number, number, number] }

export class PeopleRenderer {
  readonly mesh: THREE.InstancedMesh;
  private cLegs: THREE.InstancedBufferAttribute; private cTop: THREE.InstancedBufferAttribute; private cSkin: THREE.InstancedBufferAttribute; private cHair: THREE.InstancedBufferAttribute;
  constructor(readonly capacity: number) {
    const geo = personGeometry();
    this.cLegs = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.cTop = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.cSkin = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.cHair = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    geo.setAttribute('cLegs', this.cLegs); geo.setAttribute('cTop', this.cTop); geo.setAttribute('cSkin', this.cSkin); geo.setAttribute('cHair', this.cHair);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.85 });
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float part; attribute vec3 cLegs, cTop, cSkin, cHair; varying vec3 vPC;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPC = part < 0.5 ? cLegs : part < 1.5 ? cTop : part < 2.5 ? cSkin : cHair;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vPC;').replace('#include <map_fragment>', 'diffuseColor.rgb *= vPC;');
    };
    this.mesh = new THREE.InstancedMesh(geo, mat, capacity);
    this.mesh.count = 0;
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
  }
  update(list: PersonVisual[], t: number) {
    const n = Math.min(list.length, this.capacity);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3(), c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const v = list[i];
      const bob = v.walking ? Math.abs(Math.sin(t * 7 + v.phase)) * 0.04 : 0;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), v.heading + (v.walking ? Math.sin(t * 7 + v.phase) * 0.05 : 0));
      m.compose(p.set(v.x, v.y + bob, v.z), q, s);
      this.mesh.setMatrixAt(i, m);
      c.setHex(v.colours[0]); this.cLegs.setXYZ(i, c.r, c.g, c.b);
      c.setHex(v.colours[1]); this.cTop.setXYZ(i, c.r, c.g, c.b);
      c.setHex(v.colours[2]); this.cSkin.setXYZ(i, c.r, c.g, c.b);
      c.setHex(v.colours[3]); this.cHair.setXYZ(i, c.r, c.g, c.b);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.cLegs.needsUpdate = this.cTop.needsUpdate = this.cSkin.needsUpdate = this.cHair.needsUpdate = true;
  }
}
