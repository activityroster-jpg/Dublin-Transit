// Sea surface for Dublin Bay / Killiney Bay: sky reflection, fresnel, sun glint, animated ripples.
import * as THREE from 'three';

export function makeSea(): { mesh: THREE.Mesh; update: (t: number, cam: THREE.Vector3) => void } {
  const geo = new THREE.PlaneGeometry(60000, 60000, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({ color: 0x1d3a44, roughness: 0.08, metalness: 0.0, transparent: true, opacity: 0.94 });
  const uniforms = { uTime: { value: 0 } };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uniforms.uTime;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vSeaPos;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvSeaPos = (modelMatrix * vec4(transformed,1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
uniform float uTime; varying vec3 vSeaPos;
vec2 wave(vec2 p, vec2 d, float f, float s){ float ph = dot(p, d) * f + uTime * s; return d * cos(ph) * f; }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  vec2 p = vSeaPos.xz;
  vec2 g = wave(p, normalize(vec2(1.0,0.3)), 0.21, 1.3) * 0.5 + wave(p, normalize(vec2(-0.4,1.0)), 0.37, 1.9) * 0.3
         + wave(p, normalize(vec2(0.7,-0.8)), 0.83, 2.7) * 0.12 + wave(p, normalize(vec2(-0.9,-0.2)), 1.71, 3.9) * 0.06;
  float dist = length(vSeaPos - cameraPosition);
  g *= 1.0 / (1.0 + dist * 0.004);
  vec3 wn = normalize(vec3(-g.x, 1.0, -g.y));
  normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);`);
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = 0.05;
  mesh.receiveShadow = false;
  mesh.renderOrder = -1;
  return {
    mesh,
    update: (t, cam) => { uniforms.uTime.value = t; mesh.position.x = Math.round(cam.x / 100) * 100; mesh.position.z = Math.round(cam.z / 100) * 100; },
  };
}
