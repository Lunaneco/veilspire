import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// Cinematic grade applied after tone mapping: lift/gamma/gain, saturation,
// a teal-shadow / warm-highlight split, and a soft vignette. Values are
// driven from time of day and weather so dusk and storms feel different.

const GradingShader = {
  uniforms: {
    tDiffuse: { value: null },
    uLift: { value: new THREE.Vector3(0, 0, 0) },
    uGain: { value: new THREE.Vector3(1, 1, 1) },
    uGamma: { value: 1.0 },
    uSaturation: { value: 1.06 },
    uContrast: { value: 1.06 },
    uSplitShadow: { value: new THREE.Vector3(0.02, 0.05, 0.10) },
    uSplitHighlight: { value: new THREE.Vector3(0.06, 0.03, -0.02) },
    uVignette: { value: 0.32 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec3 uLift;
    uniform vec3 uGain;
    uniform float uGamma;
    uniform float uSaturation;
    uniform float uContrast;
    uniform vec3 uSplitShadow;
    uniform vec3 uSplitHighlight;
    uniform float uVignette;
    varying vec2 vUv;

    void main() {
      vec4 tex = texture2D(tDiffuse, vUv);
      vec3 c = tex.rgb;

      // Lift / gamma / gain
      c = c * uGain + uLift;
      c = pow(max(c, 0.0), vec3(1.0 / uGamma));

      // Split toning: cool shadows, warm highlights
      float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c += uSplitShadow * (1.0 - smoothstep(0.0, 0.55, luma));
      c += uSplitHighlight * smoothstep(0.45, 1.0, luma);

      // Contrast about mid grey, then saturation
      c = (c - 0.5) * uContrast + 0.5;
      float l2 = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l2), c, uSaturation);

      // Vignette
      vec2 d = vUv - 0.5;
      float vig = 1.0 - uVignette * dot(d, d) * 2.4;
      c *= vig;

      gl_FragColor = vec4(clamp(c, 0.0, 1.0), tex.a);
    }
  `,
};

export class GradingPass extends ShaderPass {
  constructor() {
    super(GradingShader);
    this._tmp = new THREE.Vector3();
  }

  // dayness 0..1, duskness 0..1, weather dim 0..1, snow 0..1
  applyMood(dayness, duskness, dim = 0, snow = 0) {
    const u = this.uniforms;
    // Night: crush shadows toward blue, lower saturation
    const night = 1 - dayness;
    u.uLift.value.set(
      -0.008 + 0.004 * night,
      -0.006 + 0.006 * night,
      0.004 + 0.022 * night);
    u.uGain.value.set(
      1.02 - 0.06 * night + 0.05 * duskness,
      1.01 - 0.08 * night + 0.01 * duskness,
      0.99 - 0.02 * night - 0.05 * duskness);
    u.uGamma.value = 1.0 + 0.06 * night;
    u.uSaturation.value = 1.10 - 0.28 * night - 0.22 * dim + 0.10 * duskness - 0.10 * snow;
    u.uContrast.value = 1.07 - 0.08 * dim + 0.03 * duskness;
    // Dusk pushes the highlight split warmer; storms go cold and flat
    u.uSplitHighlight.value.set(
      0.05 + 0.09 * duskness - 0.03 * dim,
      0.025 + 0.03 * duskness - 0.01 * dim,
      -0.02 - 0.03 * duskness + 0.05 * dim + 0.04 * snow);
    u.uSplitShadow.value.set(
      0.01 + 0.01 * snow,
      0.045 + 0.02 * night + 0.02 * snow,
      0.09 + 0.06 * night + 0.05 * dim + 0.05 * snow);
    u.uVignette.value = 0.30 + 0.16 * night + 0.10 * dim;
  }
}
