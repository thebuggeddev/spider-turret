import * as THREE from 'three';
import { MeshStandardNodeMaterial, MeshBasicNodeMaterial } from 'three/webgpu';
import {
  Fn,
  uniform,
  uv,
  positionWorld,
  normalWorld,
  normalView,
  positionViewDirection,
  texture,
  float,
  vec2,
  vec3,
  sin,
  cos,
  abs,
  dot,
  mix,
  smoothstep,
  clamp,
} from 'three/tsl';

/**
 * Shared global TSL uniforms for the Spider Turret & Battlefield Proving Ground.
 */
export function createSpiderTSLUniforms() {
  return {
    uTime: uniform(0.0),
    uBarrelHeat: uniform(0.0),
    uMuzzleFlash: uniform(0.0),
    uSensorPulse: uniform(1.0),
    uRobotWorldPos: uniform(new THREE.Vector3(0, 0, 0)),
  };
}

/**
 * Upgrades loaded GLTF materials on the Spider Turret to authentic metallic WebGPU/TSL NodeMaterials.
 * Only the 6 rotating barrel tubes (`isBarrelTube === true`) receive the heated-steel thermal glow
 * during firing; the housing, support clamps, body, and legs never glow red.
 */
export function upgradeRobotMaterialToTSL(srcMat, tslUniforms, isBarrelTube = false) {
  if (!srcMat) return srcMat;
  const matName = srcMat.name || '';

  // 1. Pitch-black recessed barrel bore & leg slot material
  if (matName.includes('BoreBlack')) {
    return new MeshStandardNodeMaterial({
      name: matName + '_TSL',
      color: new THREE.Color(0x050608),
      roughness: 0.48,
      metalness: 0.72,
      envMapIntensity: 0.5,
    });
  }

  // 2. Military Amber Indicator Lens material
  if (matName.includes('CyanEmissive')) {
    return new MeshBasicNodeMaterial({
      name: matName + '_TSL',
      color: new THREE.Color(0xd4a848),
    });
  }

  // 3. Heavy Industrial Metallic Orange Armor & Oiled Gunmetal TSL NodeMaterials
  const isOrange = matName.includes('Orange');
  const isSteelTrim = matName.includes('SteelTrim');

  const nodeMat = new MeshStandardNodeMaterial({
    name: matName + '_TSL',
    roughness: isOrange ? 0.26 : isSteelTrim ? 0.20 : 0.24,
    metalness: isOrange ? 0.66 : isSteelTrim ? 0.92 : 0.88,
    envMapIntensity: 1.45,
    normalScale: new THREE.Vector2(1.0, 1.0),
  });

  if (srcMat.normalMap) {
    nodeMat.normalMap = srcMat.normalMap;
  }

  const mapTex = srcMat.map;
  const roughTex = srcMat.roughnessMap;
  const metalTex = srcMat.metalnessMap;

  nodeMat.colorNode = Fn(() => {
    const uvCoord = uv();
    const baseCol = mapTex
      ? texture(mapTex, uvCoord).rgb
      : isOrange
      ? vec3(0.90, 0.37, 0.09)
      : vec3(0.18, 0.20, 0.23);

    // Subtle grazing Fresnel metallic edge highlight + vertical hemisphere cavity contrast
    const nV = normalView.normalize();
    const vDir = positionViewDirection.normalize();
    const grazing = float(1.0).sub(clamp(dot(nV, vDir), 0.0, 1.0));
    const grazingSq = grazing.mul(grazing);

    const upDot = clamp(normalWorld.y.mul(0.5).add(0.5), 0.0, 1.0);
    const cavityShade = mix(float(0.80), float(1.05), upDot);

    const steelHighlight = isOrange
      ? vec3(0.72, 0.68, 0.64)
      : isSteelTrim
      ? vec3(0.78, 0.82, 0.88)
      : vec3(0.60, 0.64, 0.70);

    return mix(baseCol.mul(cavityShade), steelHighlight, grazingSq.mul(isOrange ? 0.18 : 0.22));
  })();

  // Realistic Barrel Tube Thermal Glow: ONLY on the 6 cylindrical barrel tubes (never on housing/body)
  if (isBarrelTube && tslUniforms) {
    nodeMat.emissiveNode = Fn(() => {
      const wp = positionWorld;
      const relXZ = vec2(
        wp.x.sub(tslUniforms.uRobotWorldPos.x),
        wp.z.sub(tslUniforms.uRobotWorldPos.z)
      ).length();

      // Heat concentrates along the forward half of the barrel tubes toward the muzzle
      const barrelLengthGradient = smoothstep(0.24, 0.72, relXZ);
      const heat = tslUniforms.uBarrelHeat.mul(barrelLengthGradient);

      // Authentic heated gun-barrel steel: dull cherry-red warming to orange-red ember
      const dullCherryRed = vec3(0.62, 0.06, 0.01);
      const hotBarrelOrange = vec3(1.10, 0.20, 0.02);
      const emberCol = mix(dullCherryRed, hotBarrelOrange, heat);

      return emberCol.mul(heat).mul(1.15);
    })();
  }

  nodeMat.roughnessNode = Fn(() => {
    const rVal = roughTex ? texture(roughTex, uv()).r : float(0.26);
    return clamp(rVal.mul(0.85), 0.14, 0.58);
  })();

  nodeMat.metalnessNode = Fn(() => {
    const mVal = metalTex ? texture(metalTex, uv()).r : float(isOrange ? 0.66 : 0.90);
    return isOrange
      ? clamp(mVal.add(0.16), 0.55, 0.94)
      : clamp(mVal.add(0.05), 0.84, 0.96);
  })();

  return nodeMat;
}

/**
 * Flat ground datum plane (y = 0.0) so all 4 feet plant cleanly without any floor plank mesh.
 */
export function evaluateBattlefieldTerrainHeight() {
  return 0.0;
}

/**
 * Matte Olive-Drab Army Proving Ground TSL material with radial feathering into the
 * architectural blueprint background (zero plank edges, zero neon, zero glossy puddles).
 */
export function createBattlefieldTerrainTSLMaterial() {
  const mat = new MeshStandardNodeMaterial({
    name: 'Mat_BattlefieldTerrain_TSL',
    roughness: 0.96,
    metalness: 0.0,
    envMapIntensity: 0.0,
    transparent: true,
  });

  mat.colorNode = Fn(() => {
    const wp = positionWorld;
    const xz = vec2(wp.x, wp.z);
    const dist = xz.length();

    const n1 = sin(wp.x.mul(1.25)).mul(cos(wp.z.mul(1.25))).mul(0.5).add(0.5);
    const n2 = sin(wp.x.mul(3.1).add(wp.z.mul(2.6))).mul(0.5).add(0.5);

    const oliveDark = vec3(0.022, 0.026, 0.019);
    const khakiDust = vec3(0.038, 0.043, 0.031);
    const earthMix = mix(oliveDark, khakiDust, n1.mul(0.62).add(n2.mul(0.38)));

    // Subtle army stencil range rings at r = 1.45m (stance circle) and r = 4.6m (Aim Box range)
    const ring1 = float(1.0).sub(smoothstep(0.008, 0.024, abs(dist.sub(1.45))));
    const ring2 = float(1.0).sub(smoothstep(0.012, 0.032, abs(dist.sub(4.6))));
    const centerLineZ = float(1.0)
      .sub(smoothstep(0.006, 0.018, abs(wp.x)))
      .mul(smoothstep(1.45, 1.55, wp.z))
      .mul(float(1.0).sub(smoothstep(4.5, 4.65, wp.z)));

    const fade = float(1.0).sub(smoothstep(5.0, 9.0, dist));
    const brassStencil = vec3(0.24, 0.21, 0.12);
    const lineFactor = clamp(
      ring1.mul(0.35).add(ring2.mul(0.22)).add(centerLineZ.mul(0.25)),
      0.0,
      1.0
    ).mul(fade);

    return mix(earthMix, brassStencil, lineFactor);
  })();

  mat.opacityNode = Fn(() => {
    const wp = positionWorld;
    const dist = vec2(wp.x, wp.z).length();
    return float(1.0).sub(smoothstep(4.8, 9.2, dist)).mul(0.88);
  })();

  return mat;
}

/**
 * High-luminance TSL NodeMaterial for supersonic ballistic tracer rounds & muzzle flash.
 */
export function createProjectileTSLMaterial(colorHex = 0xff8822, coreHex = 0xffffff) {
  const mat = new MeshBasicNodeMaterial({
    name: 'Mat_BallisticTracer_TSL',
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });

  const cOuter = new THREE.Color(colorHex);
  const cCore = new THREE.Color(coreHex);

  mat.colorNode = Fn(() => {
    const nV = normalView.normalize();
    const vDir = positionViewDirection.normalize();
    const centerGlow = clamp(abs(dot(nV, vDir)), 0.0, 1.0);
    return mix(
      vec3(cOuter.r, cOuter.g, cOuter.b).mul(1.8),
      vec3(cCore.r, cCore.g, cCore.b).mul(2.8),
      smoothstep(0.18, 0.82, centerGlow)
    );
  })();

  return mat;
}
