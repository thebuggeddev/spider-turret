import * as THREE from 'three';
import { evaluateBattlefieldTerrainHeight } from './tslMaterials.js?v=38';

/**
 * Army Proving Ground Ballistics, Volumetric Soft-Gradient Weapon VFX,
 * Hypersonic Railgun Plasma Wake Beams, Finned 70mm Guided Rockets with
 * Fading Volumetric Smoke Trails, Shell Casing Ejection, and Target Box.
 */
export class ProjectileSystem {
  constructor(scene, onTargetHitCallback = null) {
    this.scene = scene;
    this.onTargetHitCallback = onTargetHitCallback;

    this.group = new THREE.Group();
    this.group.name = 'ArmyRangeBallistics';
    this.scene.add(this.group);

    this.totalHits = 0;
    this.totalKills = 0;
    this.shotsFired = 0;

    // 1. Procedural Soft-Gradient Canvas Textures (Zero hard geometric edges)
    this.warmGlowTex = this._createRadialGlowTexture([
      [0.0, 'rgba(255, 255, 245, 1.0)'],
      [0.22, 'rgba(255, 232, 165, 0.92)'],
      [0.52, 'rgba(245, 125, 28, 0.48)'],
      [0.82, 'rgba(210, 65, 10, 0.12)'],
      [1.0, 'rgba(0, 0, 0, 0.0)'],
    ]);
    this.cyanGlowTex = this._createRadialGlowTexture([
      [0.0, 'rgba(255, 255, 255, 1.0)'],
      [0.24, 'rgba(185, 245, 255, 0.95)'],
      [0.55, 'rgba(14, 165, 233, 0.52)'],
      [0.85, 'rgba(2, 105, 190, 0.14)'],
      [1.0, 'rgba(0, 0, 0, 0.0)'],
    ]);
    this.warmJetTex = this._createMuzzleJetTexture([
      [0.0, 'rgba(255, 255, 240, 1.0)'],
      [0.28, 'rgba(255, 215, 120, 0.90)'],
      [0.62, 'rgba(238, 102, 20, 0.45)'],
      [1.0, 'rgba(180, 40, 5, 0.0)'],
    ]);
    this.cyanJetTex = this._createMuzzleJetTexture([
      [0.0, 'rgba(255, 255, 255, 1.0)'],
      [0.30, 'rgba(165, 243, 252, 0.92)'],
      [0.65, 'rgba(14, 165, 233, 0.48)'],
      [1.0, 'rgba(3, 105, 161, 0.0)'],
    ]);
    this.warmStreakTex = this._createLaserStreakTexture(
      'rgba(255, 253, 235, 1.0)',
      'rgba(255, 195, 85, 0.82)',
      'rgba(234, 88, 12, 0.0)'
    );
    this.cyanStreakTex = this._createLaserStreakTexture(
      'rgba(255, 255, 255, 1.0)',
      'rgba(125, 211, 252, 0.90)',
      'rgba(14, 165, 233, 0.0)'
    );
    this.shockHaloTex = this._createShockHaloTexture();
    this.smokeCloudTex = this._createSoftSmokeCloudTexture();

    // 2. Shared Materials for Projectiles, Brass & Rocket Hardware
    this.tracerStreakMat = new THREE.MeshBasicMaterial({
      map: this.warmStreakTex,
      transparent: true,
      opacity: 0.98,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.railSlugStreakMat = new THREE.MeshBasicMaterial({
      map: this.cyanStreakTex,
      transparent: true,
      opacity: 1.0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    this.missileBodyMat = new THREE.MeshStandardMaterial({
      color: 0x2b3036,
      roughness: 0.34,
      metalness: 0.78,
    });
    this.missileBandMat = new THREE.MeshStandardMaterial({
      color: 0xd8d3c8,
      roughness: 0.38,
      metalness: 0.45,
    });
    this.missileWarheadMat = new THREE.MeshStandardMaterial({
      color: 0xe65616,
      roughness: 0.28,
      metalness: 0.55,
    });
    this.missileFinMat = new THREE.MeshStandardMaterial({
      color: 0x181a1d,
      roughness: 0.42,
      metalness: 0.82,
      side: THREE.DoubleSide,
    });
    this.missilePlumeMat = new THREE.MeshBasicMaterial({
      map: this.warmJetTex,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.missileGlowMat = new THREE.MeshBasicMaterial({
      map: this.warmGlowTex,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    this.brassMat = new THREE.MeshStandardMaterial({
      color: 0xc89b3c,
      roughness: 0.26,
      metalness: 0.90,
    });

    this._initAutocannonMuzzleFlash();
    this._initRailgunChargeEffect();
    this._initProjectilePool(28);
    this._initRailgunBeamPool(6);
    this._initShellCasingPool(18);
    this._initSparkPool(64);
    this._initSmokePool(80);
    this.targets = [];

    this._nextVec = new THREE.Vector3();
    this._segVec = new THREE.Vector3();
    this._rightVec = new THREE.Vector3();
    this._upVec = new THREE.Vector3(0, 1, 0);
    this._tmpVec = new THREE.Vector3();
  }

  /**
   * Smooth radial glow texture with zero border clipping (fades to alpha=0 before edge).
   */
  _createRadialGlowTexture(stops) {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 60);
    for (const [offset, color] of stops) {
      grad.addColorStop(offset, color);
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  }

  /**
   * Longitudinal supersonic muzzle gas jet / rocket plume texture (+Z oriented along U).
   * Fades smoothly to alpha=0 on all four edges so plane geometry borders are invisible.
   */
  _createMuzzleJetTexture(stops) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');

    // Draw overlapping soft elliptical gas lobes from nozzle (x=22) to tip (x=244)
    for (let i = 0; i < 28; i++) {
      const t = i / 27;
      const cx = 24 + t * 195;
      const rx = 22 + t * 38;
      const ry = (1.0 - t * 0.65) * 44 * Math.sin(Math.min(1, t * 3.2) * Math.PI * 0.5);
      if (ry < 2) continue;

      ctx.save();
      ctx.translate(cx, 64);
      ctx.scale(rx / 32, ry / 32);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 32);
      for (const [offset, color] of stops) {
        g.addColorStop(offset, color);
      }
      ctx.fillStyle = g;
      ctx.globalAlpha = (1.0 - t * 0.78) * 0.34;
      ctx.beginPath();
      ctx.arc(0, 0, 32, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  }

  /**
   * High-aspect incandescent streak texture for tracers, railgun beams, and hot metal sparks.
   */
  _createLaserStreakTexture(coreColor, midColor, outerColor) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');

    // Transverse Gaussian glow
    const vGrad = ctx.createLinearGradient(0, 4, 0, 60);
    vGrad.addColorStop(0.0, outerColor);
    vGrad.addColorStop(0.32, midColor);
    vGrad.addColorStop(0.5, coreColor);
    vGrad.addColorStop(0.68, midColor);
    vGrad.addColorStop(1.0, outerColor);
    ctx.fillStyle = vGrad;
    ctx.fillRect(0, 4, 256, 56);

    // Longitudinal feathering so ends are tapered, never boxy
    ctx.globalCompositeOperation = 'destination-in';
    const hGrad = ctx.createLinearGradient(0, 0, 256, 0);
    hGrad.addColorStop(0.0, 'rgba(255,255,255,0.0)');
    hGrad.addColorStop(0.12, 'rgba(255,255,255,0.45)');
    hGrad.addColorStop(0.72, 'rgba(255,255,255,1.0)');
    hGrad.addColorStop(0.92, 'rgba(255,255,255,0.85)');
    hGrad.addColorStop(1.0, 'rgba(255,255,255,0.0)');
    ctx.fillStyle = hGrad;
    ctx.fillRect(0, 0, 256, 64);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  }

  /**
   * Soft expanding shockwave halo texture (soft refractive ring, zero polygon facets).
   */
  _createShockHaloTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(64, 64, 4, 64, 64, 60);
    grad.addColorStop(0.0, 'rgba(255, 250, 230, 0.35)');
    grad.addColorStop(0.45, 'rgba(255, 195, 110, 0.18)');
    grad.addColorStop(0.72, 'rgba(255, 220, 150, 0.72)');
    grad.addColorStop(0.88, 'rgba(235, 110, 25, 0.28)');
    grad.addColorStop(1.0, 'rgba(0, 0, 0, 0.0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  }

  /**
   * Multi-lobe organic cloud texture for realistic rocket & ordnance propellant smoke.
   */
  _createSoftSmokeCloudTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');

    const lobes = [
      { x: 64, y: 64, r: 46, a: 0.55 },
      { x: 48, y: 56, r: 36, a: 0.42 },
      { x: 78, y: 58, r: 34, a: 0.40 },
      { x: 56, y: 76, r: 35, a: 0.38 },
      { x: 74, y: 74, r: 32, a: 0.36 },
    ];
    for (const l of lobes) {
      const g = ctx.createRadialGradient(l.x, l.y, 2, l.x, l.y, l.r);
      g.addColorStop(0.0, `rgba(238, 234, 226, ${l.a})`);
      g.addColorStop(0.45, `rgba(206, 200, 190, ${l.a * 0.68})`);
      g.addColorStop(0.78, `rgba(168, 162, 154, ${l.a * 0.25})`);
      g.addColorStop(1.0, 'rgba(140, 135, 128, 0.0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(l.x, l.y, l.r, 0, Math.PI * 2);
      ctx.fill();
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  }

  /**
   * Builds a volumetric, soft-gradient 3D muzzle blast using crossed gas-jet planes
   * and radial bloom billboards (zero hard cones).
   */
  _initAutocannonMuzzleFlash() {
    this.muzzleFlashGroup = new THREE.Group();
    this.muzzleFlashGroup.visible = false;

    this.muzzleJetMat = new THREE.MeshBasicMaterial({
      map: this.warmJetTex,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.muzzleGlowMat = new THREE.MeshBasicMaterial({
      map: this.warmGlowTex,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    // 3 crossed longitudinal gas plume planes along +Z
    const jetPlaneGeo = new THREE.PlaneGeometry(0.56, 0.26);
    jetPlaneGeo.rotateY(-Math.PI * 0.5);
    jetPlaneGeo.translate(0, 0, 0.26);

    for (let i = 0; i < 3; i++) {
      const plane = new THREE.Mesh(jetPlaneGeo, this.muzzleJetMat);
      plane.rotation.z = (i * Math.PI) / 3.0;
      plane.frustumCulled = false;
      this.muzzleFlashGroup.add(plane);
    }

    // 4 radial Mach-brake vent gas wisps angled outward at 42 deg
    const ventPlaneGeo = new THREE.PlaneGeometry(0.28, 0.14);
    ventPlaneGeo.rotateY(-Math.PI * 0.5);
    ventPlaneGeo.translate(0, 0, 0.13);
    for (let i = 0; i < 4; i++) {
      const pivot = new THREE.Group();
      pivot.rotation.z = (i * Math.PI) / 2.0 + Math.PI * 0.25;
      const wisp = new THREE.Mesh(ventPlaneGeo, this.muzzleJetMat);
      wisp.rotation.x = 0.62;
      wisp.frustumCulled = false;
      pivot.add(wisp);
      this.muzzleFlashGroup.add(pivot);
    }

    // Transverse radial glow disc at the muzzle crown
    const crownGlowGeo = new THREE.PlaneGeometry(0.38, 0.38);
    this.muzzleCrownMesh = new THREE.Mesh(crownGlowGeo, this.muzzleGlowMat);
    this.muzzleCrownMesh.position.z = 0.04;
    this.muzzleCrownMesh.frustumCulled = false;
    this.muzzleFlashGroup.add(this.muzzleCrownMesh);

    // Dynamic muzzle flash point light for realistic illumination on weapon & chassis
    this.muzzleLight = new THREE.PointLight(0xffb84d, 0.0, 4.2, 1.8);
    this.muzzleLight.position.set(0, 0, 0.12);
    this.muzzleFlashGroup.add(this.muzzleLight);

    this.group.add(this.muzzleFlashGroup);
    this.flashTimer = 0.0;
    this.flashMaxDuration = 0.045;
  }

  /**
   * Builds the live electromagnetic plasma pinch corona at the Railgun muzzle during charge-up.
   */
  _initRailgunChargeEffect() {
    this.chargeCoronaGroup = new THREE.Group();
    this.chargeCoronaGroup.visible = false;

    this.chargeCoronaMat = new THREE.MeshBasicMaterial({
      map: this.cyanGlowTex,
      transparent: true,
      opacity: 0.0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.chargeArcMat = new THREE.MeshBasicMaterial({
      map: this.cyanStreakTex,
      transparent: true,
      opacity: 0.0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const glowGeo = new THREE.PlaneGeometry(0.34, 0.34);
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(glowGeo, this.chargeCoronaMat);
      if (i === 1) m.rotation.x = Math.PI * 0.5;
      if (i === 2) m.rotation.y = Math.PI * 0.5;
      m.frustumCulled = false;
      this.chargeCoronaGroup.add(m);
    }

    // Crossed high-voltage plasma filaments inside the rail gap
    const arcGeo = new THREE.PlaneGeometry(0.32, 0.055);
    arcGeo.rotateY(-Math.PI * 0.5);
    arcGeo.translate(0, 0, -0.06);
    for (let i = 0; i < 2; i++) {
      const arc = new THREE.Mesh(arcGeo, this.chargeArcMat);
      arc.rotation.z = i * Math.PI * 0.5;
      arc.frustumCulled = false;
      this.chargeCoronaGroup.add(arc);
    }

    this.chargeLight = new THREE.PointLight(0x38bdf8, 0.0, 2.8, 1.8);
    this.chargeCoronaGroup.add(this.chargeLight);
    this.group.add(this.chargeCoronaGroup);
  }

  /**
   * Updates the live Railgun capacitor charge pinch effect at the active muzzle every frame.
   */
  updateWeaponChargeEffect(muzzleWorldPos, muzzleWorldDir, weaponType, chargeRatio, dt) {
    if (!this.chargeCoronaGroup) return;
    if (weaponType !== 'RAILGUN' || !chargeRatio || chargeRatio <= 0.02) {
      this.chargeCoronaGroup.visible = false;
      this.chargeLight.intensity = 0.0;
      return;
    }

    this.chargeCoronaGroup.visible = true;
    this.chargeCoronaGroup.position.copy(muzzleWorldPos);
    this._nextVec.copy(muzzleWorldPos).add(muzzleWorldDir);
    this.chargeCoronaGroup.lookAt(this._nextVec);
    this.chargeCoronaGroup.rotateZ(dt * 18.0 + Math.random() * 0.8);

    const pulse = 0.78 + 0.22 * Math.sin(performance.now() * 0.045);
    const s = (0.25 + chargeRatio * 0.95) * pulse;
    this.chargeCoronaGroup.scale.set(s, s, 0.55 + chargeRatio * 0.75);
    this.chargeCoronaMat.opacity = Math.min(0.95, chargeRatio * 0.92 * pulse);
    this.chargeArcMat.opacity = Math.min(1.0, chargeRatio * 1.1);
    this.chargeLight.intensity = chargeRatio * 3.2 * pulse;
  }

  /**
   * Builds high-velocity soft-gradient ballistic tracer rounds, railgun penetrators,
   * and detailed 70mm fin-stabilized rockets with soft glowing exhaust plumes.
   */
  _initProjectilePool(count) {
    this.projectiles = [];

    // Crossed soft-gradient laser/tracer streak planes (zero cone edges)
    const streakPlaneGeo = new THREE.PlaneGeometry(1.15, 0.095);
    streakPlaneGeo.rotateY(-Math.PI * 0.5);
    streakPlaneGeo.translate(0, 0, -0.35);

    // Fin-stabilized 70mm Micro-Missile geometry
    const mTubeGeo = new THREE.CylinderGeometry(0.015, 0.0155, 0.22, 12);
    mTubeGeo.rotateX(Math.PI * 0.5);
    const mBandGeo = new THREE.CylinderGeometry(0.0158, 0.0158, 0.036, 12);
    mBandGeo.rotateX(Math.PI * 0.5);
    mBandGeo.translate(0, 0, 0.05);
    const mConeGeo = new THREE.ConeGeometry(0.015, 0.075, 12);
    mConeGeo.rotateX(Math.PI * 0.5);
    mConeGeo.translate(0, 0, 0.147);
    const mNozzleGeo = new THREE.CylinderGeometry(0.011, 0.014, 0.028, 10);
    mNozzleGeo.rotateX(Math.PI * 0.5);
    mNozzleGeo.translate(0, 0, -0.12);

    // 4 Swept tail stabilizer fins
    const finGeo = new THREE.BoxGeometry(0.0025, 0.058, 0.052);
    finGeo.translate(0, 0, -0.088);

    // Soft-gradient rocket exhaust plume planes (replaces solid orange cone)
    const plumePlaneGeo = new THREE.PlaneGeometry(0.42, 0.13);
    plumePlaneGeo.rotateY(-Math.PI * 0.5);
    plumePlaneGeo.translate(0, 0, -0.31);
    const nozzleGlowGeo = new THREE.PlaneGeometry(0.15, 0.15);

    for (let i = 0; i < count; i++) {
      const boltGroup = new THREE.Group();
      boltGroup.visible = false;

      // 1. Crossed soft-gradient tracer / railgun penetrator sub-group
      const tracerSub = new THREE.Group();
      const sPlaneA = new THREE.Mesh(streakPlaneGeo, this.tracerStreakMat);
      const sPlaneB = new THREE.Mesh(streakPlaneGeo, this.tracerStreakMat);
      sPlaneB.rotation.z = Math.PI * 0.5;
      sPlaneA.frustumCulled = false;
      sPlaneB.frustumCulled = false;
      tracerSub.add(sPlaneA, sPlaneB);

      // 2. Fin-stabilized 70mm guided rocket sub-group
      const missileSub = new THREE.Group();
      missileSub.visible = false;
      const bodyM = new THREE.Mesh(mTubeGeo, this.missileBodyMat);
      const bandM = new THREE.Mesh(mBandGeo, this.missileBandMat);
      const headM = new THREE.Mesh(mConeGeo, this.missileWarheadMat);
      const nozM = new THREE.Mesh(mNozzleGeo, this.missileFinMat);
      const finA = new THREE.Mesh(finGeo, this.missileFinMat);
      const finB = new THREE.Mesh(finGeo, this.missileFinMat);
      finB.rotation.z = Math.PI * 0.5;
      bodyM.frustumCulled = false;
      bandM.frustumCulled = false;
      headM.frustumCulled = false;
      nozM.frustumCulled = false;
      finA.frustumCulled = false;
      finB.frustumCulled = false;

      const plumeGroup = new THREE.Group();
      const p1 = new THREE.Mesh(plumePlaneGeo, this.missilePlumeMat);
      const p2 = new THREE.Mesh(plumePlaneGeo, this.missilePlumeMat);
      p2.rotation.z = Math.PI * 0.5;
      const nGlow = new THREE.Mesh(nozzleGlowGeo, this.missileGlowMat);
      nGlow.position.z = -0.135;
      p1.frustumCulled = false;
      p2.frustumCulled = false;
      nGlow.frustumCulled = false;
      plumeGroup.add(p1, p2, nGlow);

      missileSub.add(bodyM, bandM, headM, nozM, finA, finB, plumeGroup);
      boltGroup.add(tracerSub, missileSub);

      this.group.add(boltGroup);
      this.projectiles.push({
        mesh: boltGroup,
        tracerSub,
        streakPlanes: [sPlaneA, sPlaneB],
        missileSub,
        plumeGroup,
        weaponType: 'GATLING',
        active: false,
        isRicochet: false,
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        spiralPhase: 0.0,
        smokeTimer: 0.0,
        age: 0.0,
        maxLife: 1.0,
      });
    }
  }

  /**
   * Pool of fading ionized plasma wake beams for RAIL-02 shots.
   * Each beam stretches from muzzle to impact point and smoothly decays its opacity to 0.
   */
  _initRailgunBeamPool(count) {
    this.railBeams = [];
    // Unit-length (1m) crossed planes along +Z starting at z=0 -> z=1
    const beamGeo = new THREE.PlaneGeometry(1.0, 0.11);
    beamGeo.rotateY(-Math.PI * 0.5);
    beamGeo.translate(0, 0, 0.5);

    const coreGeo = new THREE.PlaneGeometry(1.0, 0.038);
    coreGeo.rotateY(-Math.PI * 0.5);
    coreGeo.translate(0, 0, 0.5);

    for (let i = 0; i < count; i++) {
      const beamGroup = new THREE.Group();
      beamGroup.visible = false;

      const sheathMat = new THREE.MeshBasicMaterial({
        map: this.cyanStreakTex,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const coreMat = new THREE.MeshBasicMaterial({
        map: this.warmStreakTex,
        transparent: true,
        opacity: 1.0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });

      for (let k = 0; k < 3; k++) {
        const sMesh = new THREE.Mesh(beamGeo, sheathMat);
        sMesh.rotation.z = (k * Math.PI) / 3.0;
        sMesh.frustumCulled = false;
        beamGroup.add(sMesh);
      }
      for (let k = 0; k < 2; k++) {
        const cMesh = new THREE.Mesh(coreGeo, coreMat);
        cMesh.rotation.z = k * Math.PI * 0.5;
        cMesh.frustumCulled = false;
        beamGroup.add(cMesh);
      }

      this.group.add(beamGroup);
      this.railBeams.push({
        group: beamGroup,
        sheathMat,
        coreMat,
        active: false,
        age: 0.0,
        maxLife: 0.26,
        length: 4.0,
      });
    }
  }

  /**
   * Builds a pool of soft volumetric smoke clouds (each with its own fading opacity material).
   * Replaces the old DodecahedronGeometry rock pool.
   */
  _initSmokePool(count) {
    this.smokePuffs = [];
    const cloudPlaneGeo = new THREE.PlaneGeometry(0.28, 0.28);

    for (let i = 0; i < count; i++) {
      const puffGroup = new THREE.Group();
      puffGroup.visible = false;

      const mat = new THREE.MeshBasicMaterial({
        map: this.smokeCloudTex,
        color: 0xe6e1d6,
        transparent: true,
        opacity: 0.0,
        depthWrite: false,
        side: THREE.DoubleSide,
      });

      // 3 crossed soft-cloud planes so the puff looks volumetric from every camera orbit
      const p1 = new THREE.Mesh(cloudPlaneGeo, mat);
      const p2 = new THREE.Mesh(cloudPlaneGeo, mat);
      p2.rotation.y = Math.PI * 0.33;
      p2.rotation.x = 0.35;
      const p3 = new THREE.Mesh(cloudPlaneGeo, mat);
      p3.rotation.y = -Math.PI * 0.33;
      p3.rotation.z = 0.35;
      p1.frustumCulled = false;
      p2.frustumCulled = false;
      p3.frustumCulled = false;
      puffGroup.add(p1, p2, p3);

      this.group.add(puffGroup);
      this.smokePuffs.push({
        mesh: puffGroup,
        mat,
        active: false,
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        spinSpeed: 0.0,
        startScale: 0.4,
        endScale: 1.8,
        peakOpacity: 0.46,
        age: 0.0,
        maxLife: 0.65,
      });
    }
  }

  /**
   * Builds a pool of ejected metallic brass shell casings.
   */
  _initShellCasingPool(count) {
    this.shells = [];
    const shellGeo = new THREE.CylinderGeometry(0.012, 0.014, 0.064, 8);
    shellGeo.rotateZ(Math.PI * 0.5);

    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(shellGeo, this.brassMat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.shells.push({
        mesh,
        active: false,
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        angVel: new THREE.Vector3(),
        age: 0.0,
        maxLife: 1.6,
      });
    }
  }

  /**
   * Builds needle-thin incandescent metal spark streaks & soft radial impact flash fireballs.
   * Replaces old BoxGeometry bricks, flat RingGeometry, and low-poly SphereGeometry.
   */
  _initSparkPool(count) {
    this.sparks = [];
    const sparkPlaneGeo = new THREE.PlaneGeometry(0.24, 0.022);
    sparkPlaneGeo.rotateY(-Math.PI * 0.5);

    for (let i = 0; i < count; i++) {
      const sGroup = new THREE.Group();
      sGroup.visible = false;
      const mat = new THREE.MeshBasicMaterial({
        map: i % 4 === 0 ? this.cyanStreakTex : this.warmStreakTex,
        transparent: true,
        opacity: 1.0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const m1 = new THREE.Mesh(sparkPlaneGeo, mat);
      const m2 = new THREE.Mesh(sparkPlaneGeo, mat);
      m2.rotation.z = Math.PI * 0.5;
      m1.frustumCulled = false;
      m2.frustumCulled = false;
      sGroup.add(m1, m2);

      this.group.add(sGroup);
      this.sparks.push({
        mesh: sGroup,
        mat,
        active: false,
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        age: 0.0,
        maxLife: 0.32,
      });
    }

    // Soft-gradient volumetric impact flashes & shockwave halos (with per-instance opacity decay)
    this.impactRings = [];
    const flashPlaneGeo = new THREE.PlaneGeometry(0.42, 0.42);
    const haloPlaneGeo = new THREE.PlaneGeometry(0.55, 0.55);

    for (let i = 0; i < 10; i++) {
      const rGroup = new THREE.Group();
      rGroup.visible = false;

      const flashMat = new THREE.MeshBasicMaterial({
        map: this.warmGlowTex,
        transparent: true,
        opacity: 1.0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const haloMat = new THREE.MeshBasicMaterial({
        map: this.shockHaloTex,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });

      const haloMesh = new THREE.Mesh(haloPlaneGeo, haloMat);
      const f1 = new THREE.Mesh(flashPlaneGeo, flashMat);
      const f2 = new THREE.Mesh(flashPlaneGeo, flashMat);
      f2.rotation.x = Math.PI * 0.5;
      const f3 = new THREE.Mesh(flashPlaneGeo, flashMat);
      f3.rotation.y = Math.PI * 0.5;
      haloMesh.frustumCulled = false;
      f1.frustumCulled = false;
      f2.frustumCulled = false;
      f3.frustumCulled = false;

      const coreGroup = new THREE.Group();
      coreGroup.add(f1, f2, f3);
      rGroup.add(haloMesh, coreGroup);
      this.group.add(rGroup);

      this.impactRings.push({
        group: rGroup,
        coreGroup,
        haloMesh,
        flashMat,
        haloMat,
        active: false,
        isExplosion: false,
        age: 0.0,
        maxLife: 0.22,
      });
    }
  }

  /**
   * Spawns a ballistic round (`GATLING` tracer, `RAILGUN` hypersonic plasma penetrator + wake beam,
   * or `MISSILE` fin-stabilized 70mm rocket with soft smoke ribbon).
   */
  spawnProjectile(muzzleWorldPos, muzzleWorldDir, weaponType = 'GATLING') {
    this.shotsFired++;

    this.muzzleFlashGroup.visible = true;
    this.muzzleFlashGroup.position.copy(muzzleWorldPos);
    this._nextVec.copy(muzzleWorldPos).add(muzzleWorldDir);
    this.muzzleFlashGroup.lookAt(this._nextVec);
    this.muzzleFlashGroup.rotateZ(Math.random() * Math.PI * 2.0);

    if (weaponType === 'RAILGUN') {
      this.muzzleJetMat.map = this.cyanJetTex;
      this.muzzleGlowMat.map = this.cyanGlowTex;
      this.muzzleLight.color.setHex(0x38bdf8);
      this.muzzleLight.intensity = 6.5;
      this.muzzleFlashGroup.scale.set(1.35, 1.35, 1.75);
      this.flashMaxDuration = 0.09;
      this.flashTimer = 0.09;

      // Spawn a fading ionized plasma wake beam along the railgun bore vector
      this._spawnRailgunBeam(muzzleWorldPos, muzzleWorldDir);
    } else if (weaponType === 'MISSILE') {
      this.muzzleJetMat.map = this.warmJetTex;
      this.muzzleGlowMat.map = this.warmGlowTex;
      this.muzzleLight.color.setHex(0xff8c24);
      this.muzzleLight.intensity = 4.2;
      this.muzzleFlashGroup.scale.set(0.95, 0.95, 1.05);
      this.flashMaxDuration = 0.07;
      this.flashTimer = 0.07;

      // Soft propellant backblast smoke cloud at the launch tube
      for (let k = 0; k < 3; k++) {
        this._spawnSmokePuff(muzzleWorldPos, 1.35, muzzleWorldDir, 0xded9ce);
      }
    } else {
      this.muzzleJetMat.map = this.warmJetTex;
      this.muzzleGlowMat.map = this.warmGlowTex;
      this.muzzleLight.color.setHex(0xffb84d);
      this.muzzleLight.intensity = 3.4;
      const sx = 0.68 + Math.random() * 0.32;
      const sz = 0.72 + Math.random() * 0.38;
      this.muzzleFlashGroup.scale.set(sx, sx, sz);
      this.flashMaxDuration = 0.038;
      this.flashTimer = 0.038;
      this._spawnShellCasing(muzzleWorldPos, muzzleWorldDir);
    }
    this.muzzleJetMat.needsUpdate = true;
    this.muzzleGlowMat.needsUpdate = true;

    let slot = null;
    for (let i = 0; i < this.projectiles.length; i++) {
      if (!this.projectiles[i].active) {
        slot = this.projectiles[i];
        break;
      }
    }
    if (!slot) slot = this.projectiles[0];

    slot.active = true;
    slot.weaponType = weaponType;
    slot.isRicochet = false;
    slot.age = 0.0;
    slot.smokeTimer = 0.0;
    slot.spiralPhase = Math.random() * Math.PI * 2.0;
    slot.position.copy(muzzleWorldPos);

    if (weaponType === 'RAILGUN') {
      slot.maxLife = 0.45;
      slot.tracerSub.visible = true;
      slot.missileSub.visible = false;
      slot.streakPlanes[0].material = this.railSlugStreakMat;
      slot.streakPlanes[1].material = this.railSlugStreakMat;
      slot.velocity.copy(muzzleWorldDir).normalize().multiplyScalar(135.0);
      slot.mesh.scale.set(1.35, 1.35, 2.2);
    } else if (weaponType === 'MISSILE') {
      slot.maxLife = 1.45;
      slot.tracerSub.visible = false;
      slot.missileSub.visible = true;
      const spreadX = (Math.random() - 0.5) * 0.024;
      const spreadY = 0.055 + (Math.random() - 0.5) * 0.02;
      const spreadZ = (Math.random() - 0.5) * 0.024;
      slot.velocity
        .copy(muzzleWorldDir)
        .add(this._segVec.set(spreadX, spreadY, spreadZ))
        .normalize()
        .multiplyScalar(32.0);
      slot.mesh.scale.set(1.15, 1.15, 1.15);
    } else {
      slot.maxLife = 0.75;
      slot.tracerSub.visible = true;
      slot.missileSub.visible = false;
      slot.streakPlanes[0].material = this.tracerStreakMat;
      slot.streakPlanes[1].material = this.tracerStreakMat;
      const spreadX = (Math.random() - 0.5) * 0.014;
      const spreadY = (Math.random() - 0.5) * 0.014;
      const spreadZ = (Math.random() - 0.5) * 0.014;
      slot.velocity
        .copy(muzzleWorldDir)
        .add(this._segVec.set(spreadX, spreadY, spreadZ))
        .normalize()
        .multiplyScalar(72.0);
      slot.mesh.scale.set(1.0, 1.0, 1.0);
    }

    slot.mesh.position.copy(slot.position);
    this._nextVec.copy(slot.position).add(slot.velocity);
    slot.mesh.lookAt(this._nextVec);
    slot.mesh.visible = true;
  }

  /**
   * Spawns a fading cyan-white ionized plasma beam from the railgun muzzle along the shot trajectory,
   * plus soft dissipating ionized vapor puffs along the wake.
   */
  _spawnRailgunBeam(muzzlePos, muzzleDir) {
    let beam = null;
    for (let i = 0; i < this.railBeams.length; i++) {
      if (!this.railBeams[i].active) {
        beam = this.railBeams[i];
        break;
      }
    }
    if (!beam) beam = this.railBeams[0];

    // Trace beam length to ground or max range (18m)
    let beamLen = 16.0;
    for (let d = 0.8; d <= 16.0; d += 0.6) {
      this._tmpVec.copy(muzzlePos).addScaledVector(muzzleDir, d);
      const gy = evaluateBattlefieldTerrainHeight(this._tmpVec.x, this._tmpVec.z);
      if (this._tmpVec.y <= gy + 0.04) {
        beamLen = d;
        break;
      }
    }

    beam.active = true;
    beam.age = 0.0;
    beam.maxLife = 0.25;
    beam.length = beamLen;
    beam.group.position.copy(muzzlePos);
    this._nextVec.copy(muzzlePos).add(muzzleDir);
    beam.group.lookAt(this._nextVec);
    beam.group.scale.set(1.0, 1.0, beamLen);
    beam.sheathMat.opacity = 0.92;
    beam.coreMat.opacity = 1.0;
    beam.group.visible = true;

    // Soft ionized vapor wisps along the first 4 meters of the railgun bore wake
    for (let d = 0.45; d <= Math.min(beamLen, 4.2); d += 0.65) {
      this._tmpVec.copy(muzzlePos).addScaledVector(muzzleDir, d);
      this._spawnSmokePuff(this._tmpVec, 0.72, null, 0xbae6fd);
    }
  }

  _spawnShellCasing(muzzleWorldPos, muzzleWorldDir) {
    let sh = null;
    for (let i = 0; i < this.shells.length; i++) {
      if (!this.shells[i].active) {
        sh = this.shells[i];
        break;
      }
    }
    if (!sh) return;

    this._rightVec.crossVectors(muzzleWorldDir, this._upVec).normalize();
    sh.active = true;
    sh.age = 0.0;
    sh.position
      .copy(muzzleWorldPos)
      .addScaledVector(muzzleWorldDir, -0.72)
      .addScaledVector(this._rightVec, 0.22);

    sh.velocity
      .copy(this._rightVec)
      .multiplyScalar(2.2 + Math.random() * 1.1)
      .addScaledVector(this._upVec, 1.8 + Math.random() * 0.9)
      .addScaledVector(muzzleWorldDir, -0.5 + (Math.random() - 0.5) * 0.5);

    sh.angVel.set(
      (Math.random() - 0.5) * 28.0,
      (Math.random() - 0.5) * 28.0,
      (Math.random() - 0.5) * 28.0
    );
    sh.mesh.position.copy(sh.position);
    sh.mesh.visible = true;
  }

  _spawnSmokePuff(worldPos, scaleBoost = 1.0, driftDir = null, tintHex = 0xe6e1d6) {
    if (!this.smokePuffs) return;
    for (let i = 0; i < this.smokePuffs.length; i++) {
      const sp = this.smokePuffs[i];
      if (!sp.active) {
        sp.active = true;
        sp.age = 0.0;
        sp.maxLife = (0.48 + Math.random() * 0.28) * Math.sqrt(scaleBoost);
        sp.position.copy(worldPos);
        sp.velocity.set(
          (Math.random() - 0.5) * 0.55,
          0.28 + Math.random() * 0.42,
          (Math.random() - 0.5) * 0.55
        );
        if (driftDir) {
          sp.velocity.addScaledVector(driftDir, 0.65);
        }
        sp.spinSpeed = (Math.random() - 0.5) * 2.4;
        sp.startScale = 0.34 * scaleBoost;
        sp.endScale = (1.55 + Math.random() * 0.45) * scaleBoost;
        sp.peakOpacity = Math.min(0.62, 0.44 * Math.sqrt(scaleBoost));
        sp.mat.color.setHex(tintHex);
        sp.mat.opacity = sp.peakOpacity;

        sp.mesh.position.copy(worldPos);
        sp.mesh.rotation.set(
          Math.random() * Math.PI,
          Math.random() * Math.PI,
          Math.random() * Math.PI
        );
        sp.mesh.scale.setScalar(sp.startScale);
        sp.mesh.visible = true;
        break;
      }
    }
  }

  _spawnImpactEffects(hitPos, hitNormal, isBigExplosion = false, weaponType = 'GATLING') {
    const isRail = weaponType === 'RAILGUN';
    const sparkCount = isBigExplosion ? 26 : 12;
    let spawned = 0;
    for (let i = 0; i < this.sparks.length && spawned < sparkCount; i++) {
      const sp = this.sparks[i];
      if (!sp.active) {
        sp.active = true;
        sp.age = 0.0;
        sp.maxLife = (isBigExplosion ? 0.36 : 0.20) + Math.random() * 0.14;
        sp.position.copy(hitPos);
        sp.mat.map = isRail && spawned % 2 === 0 ? this.cyanStreakTex : this.warmStreakTex;
        sp.mat.opacity = 1.0;

        const rx = (Math.random() - 0.5) * 2.4;
        const ry = Math.random() * 1.9 + 0.35;
        const rz = (Math.random() - 0.5) * 2.4;
        const spd = (isBigExplosion ? 6.5 : 4.5) + Math.random() * 8.0;
        sp.velocity
          .set(rx + hitNormal.x * 1.3, ry + hitNormal.y * 1.3, rz + hitNormal.z * 1.3)
          .normalize()
          .multiplyScalar(spd);

        sp.mesh.position.copy(sp.position);
        sp.mesh.visible = true;
        spawned++;
      }
    }

    for (let i = 0; i < this.impactRings.length; i++) {
      const rg = this.impactRings[i];
      if (!rg.active) {
        rg.active = true;
        rg.isExplosion = isBigExplosion;
        rg.age = 0.0;
        rg.maxLife = isBigExplosion ? 0.30 : 0.16;
        rg.flashMat.map = isRail ? this.cyanGlowTex : this.warmGlowTex;
        rg.flashMat.opacity = 1.0;
        rg.haloMat.opacity = isBigExplosion ? 0.90 : 0.65;

        rg.group.position.copy(hitPos).addScaledVector(hitNormal, 0.04);
        this._nextVec.copy(rg.group.position).add(hitNormal);
        rg.group.lookAt(this._nextVec);
        rg.group.rotateZ(Math.random() * Math.PI * 2.0);
        rg.group.scale.setScalar(isBigExplosion ? 0.95 : 0.45);
        rg.coreGroup.scale.setScalar(1.0);
        rg.group.visible = true;
        break;
      }
    }
  }

  update(dt) {
    // 1. Muzzle Flash fade-out & dynamic light decay
    if (this.flashTimer > 0.0) {
      this.flashTimer -= dt;
      if (this.flashTimer <= 0.0) {
        this.muzzleFlashGroup.visible = false;
        this.muzzleLight.intensity = 0.0;
      } else {
        const ratio = Math.max(0.0, this.flashTimer / Math.max(0.001, this.flashMaxDuration));
        this.muzzleJetMat.opacity = ratio * 0.95;
        this.muzzleGlowMat.opacity = ratio;
        this.muzzleLight.intensity *= Math.pow(0.05, dt * 18.0);
      }
    }

    // 2. Railgun Ionized Plasma Wake Beams smooth opacity decay
    for (let i = 0; i < this.railBeams.length; i++) {
      const bm = this.railBeams[i];
      if (!bm.active) continue;
      bm.age += dt;
      if (bm.age >= bm.maxLife) {
        bm.active = false;
        bm.group.visible = false;
        continue;
      }
      const prog = bm.age / bm.maxLife;
      const fade = Math.pow(1.0 - prog, 1.85);
      bm.sheathMat.opacity = fade * 0.90;
      bm.coreMat.opacity = Math.pow(1.0 - prog, 2.8);
      const radialExpand = 1.0 + prog * 1.4;
      bm.group.scale.set(radialExpand, radialExpand, bm.length);
    }

    // 3. Projectiles (Gatling tracers, Railgun slugs, Finned 70mm Rockets)
    for (let i = 0; i < this.projectiles.length; i++) {
      const p = this.projectiles[i];
      if (!p.active) continue;

      p.age += dt;
      if (p.age >= p.maxLife) {
        p.active = false;
        p.mesh.visible = false;
        continue;
      }

      if (p.isRicochet) {
        p.velocity.y -= 18.0 * dt;
      } else if (p.weaponType === 'MISSILE') {
        // Subtle guided rocket helical micro-weave + high-frequency exhaust flicker + continuous soft smoke ribbon
        p.velocity.y -= 3.2 * dt;
        p.spiralPhase += dt * 24.0;
        p.velocity.x += Math.cos(p.spiralPhase) * 1.8 * dt;
        p.velocity.y += Math.sin(p.spiralPhase) * 1.2 * dt;

        if (p.plumeGroup) {
          const flicker = 0.82 + Math.random() * 0.36;
          p.plumeGroup.scale.set(flicker, flicker, 0.85 + Math.random() * 0.35);
          p.plumeGroup.rotation.z += dt * 32.0;
        }

        p.smokeTimer += dt;
        if (p.smokeTimer >= 0.014) {
          p.smokeTimer = 0.0;
          // Emit soft smoke cloud directly behind the rocket nozzle
          this._tmpVec.copy(p.velocity).normalize();
          this._segVec.copy(p.position).addScaledVector(this._tmpVec, -0.18);
          this._spawnSmokePuff(this._segVec, 0.78);
        }
      }

      this._nextVec.copy(p.position).addScaledVector(p.velocity, dt);

      const groundY = evaluateBattlefieldTerrainHeight(this._nextVec.x, this._nextVec.z);
      let hitOccurred = false;
      const isHeavyOrdnance = p.weaponType === 'RAILGUN' || p.weaponType === 'MISSILE';

      if (this._nextVec.y <= groundY + 0.03) {
        this._nextVec.y = groundY + 0.03;
        this._spawnImpactEffects(this._nextVec, this._upVec, isHeavyOrdnance, p.weaponType);
        if (isHeavyOrdnance) {
          for (let k = 0; k < 4; k++) {
            this._spawnSmokePuff(
              this._nextVec,
              1.65,
              this._upVec,
              p.weaponType === 'RAILGUN' ? 0xc8e6f8 : 0xd8d2c5
            );
          }
          if (this.onTargetHitCallback) {
            this.onTargetHitCallback({
              totalHits: this.totalHits,
              totalKills: this.totalKills,
              weaponType: p.weaponType,
              isKill: false,
            });
          }
        }
        hitOccurred = true;
      }

      if (!hitOccurred && !p.isRicochet) {
        for (let tIdx = 0; tIdx < this.targets.length; tIdx++) {
          const tgt = this.targets[tIdx];
          if (tgt.destroyedTimer > 0.0) continue;

          this._segVec.subVectors(this._nextVec, p.position);
          const segLenSq = Math.max(1e-6, this._segVec.lengthSq());
          const toCenterX = tgt.hitCenterWorld.x - p.position.x;
          const toCenterY = tgt.hitCenterWorld.y - p.position.y;
          const toCenterZ = tgt.hitCenterWorld.z - p.position.z;
          const projT = THREE.MathUtils.clamp(
            (toCenterX * this._segVec.x + toCenterY * this._segVec.y + toCenterZ * this._segVec.z) / segLenSq,
            0.0,
            1.0
          );
          const closestX = p.position.x + this._segVec.x * projT;
          const closestY = p.position.y + this._segVec.y * projT;
          const closestZ = p.position.z + this._segVec.z * projT;
          const distSq =
            (closestX - tgt.hitCenterWorld.x) ** 2 +
            (closestY - tgt.hitCenterWorld.y) ** 2 +
            (closestZ - tgt.hitCenterWorld.z) ** 2;

          if (distSq <= tgt.hitRadius * tgt.hitRadius) {
            this._nextVec.set(closestX, closestY, closestZ);
            tgt.hits++;
            const dmg = p.weaponType === 'RAILGUN' ? 8 : p.weaponType === 'MISSILE' ? 4 : 1;
            tgt.hp = Math.max(0, tgt.hp - dmg);
            this.totalHits++;

            this._segVec.copy(p.position).sub(tgt.hitCenterWorld).normalize();
            let isKill = false;

            if (tgt.hp <= 0) {
              isKill = true;
              this.totalKills++;
              tgt.hp = tgt.maxHp;
              tgt.tiltVelocity = -13.5;
              tgt.flashTimer = 0.25;
              tgt.centerMat.color.setHex(0xfff0c0);
              this._spawnImpactEffects(this._nextVec, this._segVec, true, p.weaponType);
              for (let k = 0; k < 4; k++) {
                this._spawnSmokePuff(this._nextVec, 1.85, this._upVec);
              }
              hitOccurred = true;
            } else {
              tgt.tiltVelocity = isHeavyOrdnance ? -10.5 : -6.5;
              tgt.flashTimer = 0.16;
              tgt.centerMat.color.setHex(0xf5d078);
              this._spawnImpactEffects(this._nextVec, this._segVec, isHeavyOrdnance, p.weaponType);
              if (isHeavyOrdnance) {
                this._spawnSmokePuff(this._nextVec, 1.4, this._upVec);
              }

              if (!isHeavyOrdnance && Math.random() < 0.20) {
                p.isRicochet = true;
                p.age = 0.0;
                p.maxLife = 0.36;
                p.position.copy(this._nextVec);
                p.velocity.set(
                  (Math.random() - 0.5) * 26.0,
                  10.0 + Math.random() * 16.0,
                  -9.0 + (Math.random() - 0.5) * 16.0
                );
                p.mesh.scale.set(0.6, 0.6, 0.5);
              } else {
                hitOccurred = true;
              }
            }

            if (this.onTargetHitCallback) {
              this.onTargetHitCallback({
                totalHits: this.totalHits,
                totalKills: this.totalKills,
                targetId: tgt.id,
                weaponType: p.weaponType,
                isKill,
              });
            }
            break;
          }
        }
      }

      if (hitOccurred) {
        p.active = false;
        p.mesh.visible = false;
      } else {
        p.position.copy(this._nextVec);
        p.mesh.position.copy(p.position);
        this._nextVec.copy(p.position).add(p.velocity);
        p.mesh.lookAt(this._nextVec);
      }
    }

    // 4. Ejected Brass Shell Casings
    for (let i = 0; i < this.shells.length; i++) {
      const sh = this.shells[i];
      if (!sh.active) continue;
      sh.age += dt;
      if (sh.age >= sh.maxLife) {
        sh.active = false;
        sh.mesh.visible = false;
        continue;
      }
      sh.velocity.y -= 14.5 * dt;
      sh.position.addScaledVector(sh.velocity, dt);
      const gy = evaluateBattlefieldTerrainHeight(sh.position.x, sh.position.z) + 0.015;
      if (sh.position.y < gy) {
        sh.position.y = gy;
        sh.velocity.y = Math.abs(sh.velocity.y) * 0.42;
        sh.velocity.x *= 0.65;
        sh.velocity.z *= 0.65;
      }
      sh.mesh.position.copy(sh.position);
      sh.mesh.rotation.x += sh.angVel.x * dt;
      sh.mesh.rotation.y += sh.angVel.y * dt;
      sh.mesh.rotation.z += sh.angVel.z * dt;
    }

    // 5. Needle-Thin Incandescent Sparks with smooth opacity fade
    for (let i = 0; i < this.sparks.length; i++) {
      const sp = this.sparks[i];
      if (!sp.active) continue;
      sp.age += dt;
      if (sp.age >= sp.maxLife) {
        sp.active = false;
        sp.mesh.visible = false;
        continue;
      }
      sp.velocity.y -= 14.5 * dt;
      sp.position.addScaledVector(sp.velocity, dt);
      sp.mesh.position.copy(sp.position);
      this._nextVec.copy(sp.position).add(sp.velocity);
      sp.mesh.lookAt(this._nextVec);
      const lifeRatio = 1.0 - sp.age / sp.maxLife;
      sp.mat.opacity = Math.pow(lifeRatio, 1.4);
      sp.mesh.scale.set(0.6 + lifeRatio * 0.5, 0.6 + lifeRatio * 0.5, Math.max(0.3, lifeRatio * 1.35));
    }

    // 6. Soft Impact Fireballs & Shock Halos with per-instance opacity decay to 0
    for (let i = 0; i < this.impactRings.length; i++) {
      const rg = this.impactRings[i];
      if (!rg.active) continue;
      rg.age += dt;
      if (rg.age >= rg.maxLife) {
        rg.active = false;
        rg.group.visible = false;
        continue;
      }
      const prog = rg.age / rg.maxLife;
      const maxS = rg.isExplosion ? 3.2 : 1.35;
      rg.group.scale.setScalar(0.45 + prog * maxS);
      rg.coreGroup.scale.setScalar(Math.max(0.1, 1.15 - prog * 0.85));
      rg.flashMat.opacity = Math.pow(1.0 - prog, 1.8);
      rg.haloMat.opacity = Math.pow(1.0 - prog, 1.5) * (rg.isExplosion ? 0.9 : 0.65);
    }

    // 7. Volumetric Soft Smoke Clouds with smooth expansion, air drag & opacity fade to 0
    if (this.smokePuffs) {
      for (let i = 0; i < this.smokePuffs.length; i++) {
        const sp = this.smokePuffs[i];
        if (!sp.active) continue;
        sp.age += dt;
        if (sp.age >= sp.maxLife) {
          sp.active = false;
          sp.mesh.visible = false;
          continue;
        }
        const prog = sp.age / sp.maxLife;
        // Air drag slows lateral drift while buoyancy lifts smoke gently
        sp.velocity.multiplyScalar(Math.max(0.0, 1.0 - dt * 2.2));
        sp.velocity.y += 0.35 * dt;
        sp.position.addScaledVector(sp.velocity, dt);
        sp.mesh.position.copy(sp.position);
        sp.mesh.rotation.z += sp.spinSpeed * dt;
        sp.mesh.rotation.y += sp.spinSpeed * 0.6 * dt;

        // Smooth scale expansion + smooth quadratic opacity fade-out (never pops!)
        const curScale = THREE.MathUtils.lerp(sp.startScale, sp.endScale, 1.0 - Math.pow(1.0 - prog, 2.0));
        sp.mesh.scale.setScalar(curScale);
        const fadeIn = Math.min(1.0, prog * 7.5);
        const fadeOut = Math.pow(1.0 - prog, 1.75);
        sp.mat.opacity = sp.peakOpacity * fadeIn * fadeOut;
      }
    }

    // 8. Target Box Spring Physics
    for (let i = 0; i < this.targets.length; i++) {
      const tgt = this.targets[i];
      const springK = 88.0;
      const damping = 9.8;
      const accel = -springK * tgt.tiltAngle - damping * tgt.tiltVelocity;
      tgt.tiltVelocity += accel * dt;
      tgt.tiltAngle += tgt.tiltVelocity * dt;
      tgt.tiltPivot.rotation.x = tgt.tiltAngle;

      if (tgt.flashTimer > 0.0) {
        tgt.flashTimer -= dt;
        if (tgt.flashTimer <= 0.0) {
          tgt.centerMat.color.setHex(0xf7c616);
        }
      }
    }
  }
}
