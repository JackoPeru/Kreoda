import * as THREE from "three";

export function createZebraUniforms() {
  return { zebraEnabled: { value: 0 }, zebraBands: { value: 16 }, zebraAxis: { value: new THREE.Vector3(1, 0, 0) } };
}
export function createCurvatureUniforms() {
  return { curvatureEnabled: { value: 0 }, curvatureMaximumPerMm: { value: .1 } };
}

/** Reflection of a fixed striped environment, evaluated from native smooth normals. */
export function attachZebraMaterial(material: THREE.MeshStandardMaterial, uniforms: ReturnType<typeof createZebraUniforms>,
  curvature: ReturnType<typeof createCurvatureUniforms>): void {
  material.customProgramCacheKey = () => "kreoda-surface-analysis-v2";
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms, curvature);
    shader.vertexShader = `attribute float kreodaCurvature;
varying float vKreodaCurvature;
${shader.vertexShader}`.replace("#include <begin_vertex>", `#include <begin_vertex>
vKreodaCurvature = kreodaCurvature;`);
    shader.fragmentShader = `uniform float zebraEnabled;
uniform float zebraBands;
uniform vec3 zebraAxis;
uniform float curvatureEnabled;
uniform float curvatureMaximumPerMm;
varying float vKreodaCurvature;
${shader.fragmentShader}`.replace("#include <opaque_fragment>", `
if (curvatureEnabled > 0.5) {
  float t = clamp(vKreodaCurvature / curvatureMaximumPerMm, 0.0, 1.0);
  vec3 blue = vec3(0.12, 0.32, 0.95), green = vec3(0.10, 0.80, 0.55), red = vec3(0.95, 0.18, 0.12);
  vec3 heat = t < 0.5 ? mix(blue, green, t * 2.0) : mix(green, red, (t - 0.5) * 2.0);
  if (vKreodaCurvature < 0.0) heat = vec3(0.38);
  outgoingLight = mix(heat, diffuseColor.rgb, 0.14);
} else if (zebraEnabled > 0.5) {
  vec3 reflection = inverseTransformDirection(reflect(-normalize(vViewPosition), normal), viewMatrix);
  float wave = sin(dot(reflection, zebraAxis) * zebraBands * 3.141592653589793);
  float aa = max(fwidth(wave), 0.001);
  float band = smoothstep(-aa, aa, wave);
  // Retain a small material tint so hover, selection and shared targets remain visible.
  vec3 tint = mix(vec3(1.0), diffuseColor.rgb, 0.18);
  outgoingLight = mix(vec3(0.012), tint, band);
}
#include <opaque_fragment>`);
  };
}
