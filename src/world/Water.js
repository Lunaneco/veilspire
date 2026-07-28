import * as THREE from 'three';
import { WATER_LEVEL, TERRAIN_SIZE } from './Terrain.js';

// Animated lake surface: normal-perturbed standard material with moving
// waves in the vertex shader and a fresnel-ish tint. Cheap but convincing
// at a distance; upgraded to planar reflections in a later pass.

export class Water {
  constructor(scene) {
    const geo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, 128, 128);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x1d4a5e,
      roughness: 0.15,
      metalness: 0.55,
      transparent: true,
      opacity: 0.86,
      side: THREE.DoubleSide, // visible from underwater
    });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = { value: 0 };
      this._shader = shader;
      shader.vertexShader = 'uniform float uTime;\nvarying vec3 vWPos;\n' + shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          float w1 = sin(uTime * 1.1 + position.x * 0.12 + position.z * 0.09) * 0.18;
          float w2 = sin(uTime * 1.7 - position.x * 0.07 + position.z * 0.16) * 0.12;
          transformed.y += w1 + w2;
          vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        }`
      );
      shader.fragmentShader = 'varying vec3 vWPos;\nuniform float uTime;\n' + shader.fragmentShader.replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        {
          float r1 = sin(dot(vWPos.xz, vec2(1.3, 0.9)) + uTime * 2.1);
          float r2 = sin(dot(vWPos.xz, vec2(-0.7, 1.7)) - uTime * 1.6);
          float r3 = sin(dot(vWPos.xz, vec2(0.4, -1.1)) + uTime * 1.1);
          float ripple = (r1 + r2 + r3) / 3.0;
          roughnessFactor = clamp(roughnessFactor + ripple * 0.06, 0.05, 0.45);
        }`
      );
    };
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.y = WATER_LEVEL;
    this.mesh.receiveShadow = true;
    scene.add(this.mesh);
  }

  update(dt, elapsed) {
    if (this._shader) this._shader.uniforms.uTime.value = elapsed;
  }
}
