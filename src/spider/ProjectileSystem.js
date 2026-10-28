import * as THREE from 'three';
import { createProjectileTSLMaterial, evaluateBattlefieldTerrainHeight } from './tslMaterials.js?v=11';

/**
 * Army Proving Ground Ballistics, Autocannon Muzzle Flash, Shell Casing Ejection,
 * Weld Sparks, and the Single Army Ballistic Aim Box.
 *
 * Clean, uncluttered range layout:
 * - Zero scattered planks, pyramids, or perimeter boxes
 * - Just ONE authentic military ballistic target box downrange at (0, 0, 4.8)
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

    // Shared pre-compiled ballistic materials
    this.whiteHotMat = createProjectileTSLMaterial(0xfff4cc, 0xffffff);
    this.tracerGoldMat = createProjectileTSLMaterial(0xe88424, 0xfff6d8);
    this.flameOuterMat = new THREE.MeshBasicMaterial({
      color: 0xe66818,
      transparent: true,
      opacity: 0.90,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.flameInnerMat = new THREE.MeshBasicMaterial({
      color: 0xfff0b8,
      transparent: true,
      opacity: 0.98,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.sparkMat = new THREE.MeshBasicMaterial({
      color: 0xffd268,
      transparent: true,
      opacity: 0.96,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.shockRingMat = new THREE.MeshBasicMaterial({
      color: 0xe69538,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.brassMat = new THREE.MeshStandardMaterial({
      color: 0xc89b3c,
      roughness: 0.28,
      metalness: 0.90,
    });

    this._initAutocannonMuzzleFlash();
    this._initProjectilePool(20);
    this._initShellCasingPool(16);
    this._initSparkPool(42);
    this.targets = [];

    this._nextVec = new THREE.Vector3();
    this._segVec = new THREE.Vector3();
    this._rightVec = new THREE.Vector3();
    this._upVec = new THREE.Vector3(0, 1, 0);
  }

  /**
   * Builds a sharp, self-illuminated 3D star-burst autocannon muzzle flash.
   */
  _initAutocannonMuzzleFlash() {
    this.muzzleFlashGroup = new THREE.Group();
    this.muzzleFlashGroup.visible = false;

    const coreGeo = new THREE.ConeGeometry(0.028, 0.38, 8);
    coreGeo.rotateX(Math.PI * 0.5);
    coreGeo.translate(0, 0, 0.19);
    const coreMesh = new THREE.Mesh(coreGeo, this.flameInnerMat);
    this.muzzleFlashGroup.add(coreMesh);

    const sheathGeo = new THREE.ConeGeometry(0.048, 0.48, 8);
    sheathGeo.rotateX(Math.PI * 0.5);
    sheathGeo.translate(0, 0, 0.23);
    const sheathMesh = new THREE.Mesh(sheathGeo, this.flameOuterMat);
    this.muzzleFlashGroup.add(sheathMesh);

    const spikeGeo = new THREE.ConeGeometry(0.018, 0.19, 5);
    spikeGeo.translate(0, 0.095, 0);
    for (let i = 0; i < 6; i++) {
      const spikePivot = new THREE.Group();
      spikePivot.rotation.z = (i * Math.PI) / 3.0;
      const spike = new THREE.Mesh(
        spikeGeo,
        i % 2 === 0 ? this.flameInnerMat : this.flameOuterMat
      );
      spike.rotation.x = 0.42;
      spikePivot.add(spike);
      this.muzzleFlashGroup.add(spikePivot);
    }

    this.group.add(this.muzzleFlashGroup);
    this.flashTimer = 0.0;
  }

  /**
   * Builds high-velocity supersonic ballistic tracer rounds.
   */
  _initProjectilePool(count) {
    this.projectiles = [];
    const coreGeo = new THREE.CylinderGeometry(0.010, 0.012, 0.44, 6);
    coreGeo.rotateX(Math.PI * 0.5);

    const streakGeo = new THREE.ConeGeometry(0.022, 1.35, 6);
    streakGeo.rotateX(-Math.PI * 0.5);
    streakGeo.translate(0, 0, -0.58);

    for (let i = 0; i < count; i++) {
      const boltGroup = new THREE.Group();
      boltGroup.visible = false;
      const coreMesh = new THREE.Mesh(coreGeo, this.whiteHotMat);
      const streakMesh = new THREE.Mesh(streakGeo, this.tracerGoldMat);
      coreMesh.frustumCulled = false;
      streakMesh.frustumCulled = false;
      boltGroup.add(coreMesh, streakMesh);

      this.group.add(boltGroup);
      this.projectiles.push({
        mesh: boltGroup,
        active: false,
        isRicochet: false,
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        age: 0.0,
        maxLife: 1.0,
      });
    }
  }

  /**
   * Builds a pool of ejected metallic brass shell casings.
   */
  _initShellCasingPool(count) {
    this.shells = [];
    const shellGeo = new THREE.CylinderGeometry(0.013, 0.015, 0.068, 6);
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
   * Builds a pool of incandescent metal weld sparks & shockwave rings for armor impacts.
   */
  _initSparkPool(count) {
    this.sparks = [];
    const sparkGeo = new THREE.BoxGeometry(0.014, 0.014, 0.22);

    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(sparkGeo, i % 3 === 0 ? this.whiteHotMat : this.sparkMat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.sparks.push({
        mesh,
        active: false,
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        age: 0.0,
        maxLife: 0.34,
      });
    }

    this.impactRings = [];
    const ringGeo = new THREE.RingGeometry(0.04, 0.14, 16);
    const flashSphereGeo = new THREE.SphereGeometry(0.11, 8, 8);

    for (let i = 0; i < 8; i++) {
      const rGroup = new THREE.Group();
      rGroup.visible = false;
      const rMesh = new THREE.Mesh(ringGeo, this.shockRingMat);
      const sMesh = new THREE.Mesh(flashSphereGeo, this.whiteHotMat);
      rGroup.add(rMesh, sMesh);
      this.group.add(rGroup);

      this.impactRings.push({
        group: rGroup,
        sphereMesh: sMesh,
        active: false,
        isExplosion: false,
        age: 0.0,
        maxLife: 0.20,
      });
    }
  }

  /**
   * Builds a high-resolution 512x512 procedural canvas texture for the colorful 10-ring
   * FITA / Olympic Archery target sheet (White, Black, Blue, Red, Gold-Yellow rings + score numbers).
   */
  _createArcheryTargetTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');

    // Cream paper target sheet background with subtle border
    ctx.fillStyle = '#ede8dc';
    ctx.fillRect(0, 0, 512, 512);
    ctx.strokeStyle = '#33362f';
    ctx.lineWidth = 8;
    ctx.strokeRect(12, 12, 488, 488);

    const cx = 256;
    const cy = 256;
    const maxR = 228;

    // 10 FITA Archery concentric zones from outside (1) to inside (10)
    const zones = [
      { r: 1.00, fill: '#f7f5f0', stroke: '#1b1d1e' }, // 1 - White
      { r: 0.90, fill: '#f7f5f0', stroke: '#1b1d1e' }, // 2 - White
      { r: 0.80, fill: '#202326', stroke: '#1b1d1e' }, // 3 - Black
      { r: 0.70, fill: '#202326', stroke: '#e8e6e0' }, // 4 - Black (white divider)
      { r: 0.60, fill: '#1992d4', stroke: '#1b1d1e' }, // 5 - Archery Blue
      { r: 0.50, fill: '#1992d4', stroke: '#1b1d1e' }, // 6 - Archery Blue
      { r: 0.40, fill: '#e03127', stroke: '#1b1d1e' }, // 7 - Archery Red
      { r: 0.30, fill: '#e03127', stroke: '#1b1d1e' }, // 8 - Archery Red
      { r: 0.20, fill: '#f7c616', stroke: '#1b1d1e' }, // 9 - Archery Gold
      { r: 0.10, fill: '#f7c616', stroke: '#1b1d1e' }, // 10 - Archery Gold
    ];

    for (const z of zones) {
      ctx.beginPath();
      ctx.arc(cx, cy, maxR * z.r, 0, Math.PI * 2);
      ctx.fillStyle = z.fill;
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = z.stroke;
      ctx.stroke();
    }

    // Inner X-ring + center '+' pinhole
    ctx.beginPath();
    ctx.arc(cx, cy, maxR * 0.045, 0, Math.PI * 2);
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = '#1b1d1e';
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(cx - 8, cy);
    ctx.lineTo(cx + 8, cy);
    ctx.moveTo(cx, cy - 8);
    ctx.lineTo(cx, cy + 8);
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = '#1b1d1e';
    ctx.stroke();

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  }

  /**
   * Builds ONE colorful Archery-style Target Box on an A-Frame Stand positioned at (0, 0, 2.35)
   * directly in front of the Spider Turret's Gatling barrels so both robot and target are framed together.
   */
  _initSingleArmyTargetBox() {
    this.targets = [];
    const tx = 0.0;
    const tz = 2.35;
    const groundY = 0.0;

    const woodStandMat = new THREE.MeshStandardMaterial({
      color: 0x8a643b,
      roughness: 0.72,
      metalness: 0.08,
    });
    const darkBracketMat = new THREE.MeshStandardMaterial({
      color: 0x242820,
      roughness: 0.48,
      metalness: 0.75,
    });
    const strawButtMat = new THREE.MeshStandardMaterial({
      color: 0xb89b5e,
      roughness: 0.88,
      metalness: 0.05,
    });
    const pinRedMat = new THREE.MeshStandardMaterial({
      color: 0xd93025,
      roughness: 0.35,
      metalness: 0.2,
    });

    const archeryTex = this._createArcheryTargetTexture();
    const targetSheetMat = new THREE.MeshStandardMaterial({
      map: archeryTex,
      roughness: 0.52,
      metalness: 0.05,
    });

    // Stepped 3D concentric ring materials for extra depth
    const ringWhiteMat = new THREE.MeshStandardMaterial({ color: 0xf5f2eb, roughness: 0.45 });
    const ringBlackMat = new THREE.MeshStandardMaterial({ color: 0x202326, roughness: 0.45 });
    const ringBlueMat = new THREE.MeshStandardMaterial({ color: 0x1992d4, roughness: 0.40 });
    const ringRedMat = new THREE.MeshStandardMaterial({ color: 0xe03127, roughness: 0.40 });
    const bullseyeGoldMat = new THREE.MeshBasicMaterial({ color: 0xf7c616, side: THREE.DoubleSide });

    const root = new THREE.Group();
    root.name = 'ArcheryAimBox';
    root.position.set(tx, groundY, tz);
    root.lookAt(0.0, groundY, 0.0);

    // 1. Sturdy Timber A-Frame Archery Stand Legs & Ground Base
    const footSkidGeo = new THREE.BoxGeometry(0.10, 0.06, 0.96);
    for (const sx of [-0.46, 0.46]) {
      const skid = new THREE.Mesh(footSkidGeo, darkBracketMat);
      skid.position.set(sx, 0.03, 0.0);
      root.add(skid);
    }

    const frontLegGeo = new THREE.BoxGeometry(0.075, 1.85, 0.075);
    for (const sx of [-0.44, 0.44]) {
      const leg = new THREE.Mesh(frontLegGeo, woodStandMat);
      leg.position.set(sx * 0.88, 0.90, 0.06);
      leg.rotation.z = -sx * 0.08;
      leg.rotation.x = 0.08;
      root.add(leg);
    }

    // Rear A-frame support prop leg
    const rearLeg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.75, 0.08), woodStandMat);
    rearLeg.position.set(0.0, 0.82, -0.36);
    rearLeg.rotation.x = -0.32;
    root.add(rearLeg);

    // Horizontal support shelf beam under the target box
    const shelfBeam = new THREE.Mesh(new THREE.BoxGeometry(1.12, 0.08, 0.28), woodStandMat);
    shelfBeam.position.set(0, 0.74, 0.04);
    root.add(shelfBeam);

    // 2. Reactive Hinged Archery Target Box (centered at y = 1.28m, matching Gatling barrel line)
    const centerH = 1.28;
    const tiltPivot = new THREE.Group();
    tiltPivot.position.set(0, centerH, 0.06);
    root.add(tiltPivot);

    // Dense compressed straw/foam archery butt box (0.98m x 0.98m x 0.20m)
    const buttBox = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.98, 0.20), strawButtMat);
    tiltPivot.add(buttBox);

    // Dark steel corner reinforcement brackets on the target box
    const rimGeo = new THREE.BoxGeometry(1.01, 0.06, 0.22);
    const topRim = new THREE.Mesh(rimGeo, darkBracketMat);
    topRim.position.set(0, 0.48, 0);
    const botRim = new THREE.Mesh(rimGeo, darkBracketMat);
    botRim.position.set(0, -0.48, 0);
    tiltPivot.add(topRim, botRim);

    // Pinned FITA Archery Target Sheet on Front (+Z facing robot) & Back (-Z)
    const sheetGeo = new THREE.PlaneGeometry(0.90, 0.90);
    const frontSheet = new THREE.Mesh(sheetGeo, targetSheetMat);
    frontSheet.position.z = 0.102;
    const backSheet = new THREE.Mesh(sheetGeo, targetSheetMat);
    backSheet.rotation.y = Math.PI;
    backSheet.position.z = -0.102;
    tiltPivot.add(frontSheet, backSheet);

    // 4 Red Archery Target Corner Pins
    const pinGeo = new THREE.SphereGeometry(0.024, 10, 10);
    for (const px of [-0.41, 0.41]) {
      for (const py of [-0.41, 0.41]) {
        const pin = new THREE.Mesh(pinGeo, pinRedMat);
        pin.position.set(px, py, 0.108);
        tiltPivot.add(pin);
      }
    }

    // 3D Stepped Concentric Archery Bullseye Discs on Front & Back for crisp 3D relief
    const layers = [
      { r: 0.40, mat: ringWhiteMat, z: 0.104 },
      { r: 0.32, mat: ringBlackMat, z: 0.107 },
      { r: 0.24, mat: ringBlueMat, z: 0.110 },
      { r: 0.16, mat: ringRedMat, z: 0.113 },
      { r: 0.08, mat: bullseyeGoldMat, z: 0.116 },
    ];
    for (const l of layers) {
      const discF = new THREE.Mesh(new THREE.CircleGeometry(l.r, 36), l.mat);
      discF.position.z = l.z;
      const discB = new THREE.Mesh(new THREE.CircleGeometry(l.r, 36), l.mat);
      discB.rotation.y = Math.PI;
      discB.position.z = -l.z;
      tiltPivot.add(discF, discB);
    }

    this.group.add(root);

    this.targets.push({
      id: 'ARCHERY-AIM-BOX-01',
      root,
      tiltPivot,
      centerMat: bullseyeGoldMat,
      hitCenterWorld: new THREE.Vector3(tx, groundY + centerH, tz),
      hitRadius: 0.56,
      tiltAngle: 0.0,
      tiltVelocity: 0.0,
      flashTimer: 0.0,
      hits: 0,
      maxHp: 24,
      hp: 24,
      destroyedTimer: 0.0,
    });
  }

  /**
   * Spawns a supersonic ballistic tracer round, star-burst autocannon muzzle flash,
   * and spinning brass shell casing.
   */
  spawnProjectile(muzzleWorldPos, muzzleWorldDir) {
    this.shotsFired++;

    this.muzzleFlashGroup.visible = true;
    this.muzzleFlashGroup.position.copy(muzzleWorldPos);
    this._nextVec.copy(muzzleWorldPos).add(muzzleWorldDir);
    this.muzzleFlashGroup.lookAt(this._nextVec);
    this.muzzleFlashGroup.rotateZ(Math.random() * Math.PI * 2.0);

    const sx = 0.72 + Math.random() * 0.40;
    const sz = 0.80 + Math.random() * 0.50;
    this.muzzleFlashGroup.scale.set(sx, sx, sz);
    this.flashTimer = 0.035;

    this._spawnShellCasing(muzzleWorldPos, muzzleWorldDir);

    let slot = null;
    for (let i = 0; i < this.projectiles.length; i++) {
      if (!this.projectiles[i].active) {
        slot = this.projectiles[i];
        break;
      }
    }
    if (!slot) slot = this.projectiles[0];

    slot.active = true;
    slot.isRicochet = false;
    slot.age = 0.0;
    slot.maxLife = 0.85;
    slot.position.copy(muzzleWorldPos);

    const spreadX = (Math.random() - 0.5) * 0.015;
    const spreadY = (Math.random() - 0.5) * 0.015;
    const spreadZ = (Math.random() - 0.5) * 0.015;
    slot.velocity
      .copy(muzzleWorldDir)
      .add(this._segVec.set(spreadX, spreadY, spreadZ))
      .normalize()
      .multiplyScalar(64.0);

    slot.mesh.position.copy(slot.position);
    slot.mesh.scale.set(1, 1, 1);
    this._nextVec.copy(slot.position).add(slot.velocity);
    slot.mesh.lookAt(this._nextVec);
    slot.mesh.visible = true;
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

  _spawnSmokePuff() {}

  _spawnImpactEffects(hitPos, hitNormal, isBigExplosion = false) {
    const sparkCount = isBigExplosion ? 24 : 11;
    let spawned = 0;
    for (let i = 0; i < this.sparks.length && spawned < sparkCount; i++) {
      const sp = this.sparks[i];
      if (!sp.active) {
        sp.active = true;
        sp.age = 0.0;
        sp.maxLife = (isBigExplosion ? 0.38 : 0.20) + Math.random() * 0.15;
        sp.position.copy(hitPos);

        const rx = (Math.random() - 0.5) * 2.2;
        const ry = Math.random() * 1.8 + 0.3;
        const rz = (Math.random() - 0.5) * 2.2;
        const spd = (isBigExplosion ? 6.0 : 4.2) + Math.random() * 7.5;
        sp.velocity
          .set(rx + hitNormal.x * 1.4, ry + hitNormal.y * 1.4, rz + hitNormal.z * 1.4)
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
        rg.maxLife = isBigExplosion ? 0.32 : 0.16;
        rg.group.position.copy(hitPos).addScaledVector(hitNormal, 0.05);
        this._nextVec.copy(rg.group.position).add(hitNormal);
        rg.group.lookAt(this._nextVec);
        rg.group.scale.setScalar(isBigExplosion ? 1.1 : 0.50);
        rg.group.visible = true;
        break;
      }
    }
  }

  update(dt) {
    if (this.flashTimer > 0.0) {
      this.flashTimer -= dt;
      if (this.flashTimer <= 0.0) {
        this.muzzleFlashGroup.visible = false;
      }
    }

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
      }

      this._nextVec.copy(p.position).addScaledVector(p.velocity, dt);

      const groundY = evaluateBattlefieldTerrainHeight(this._nextVec.x, this._nextVec.z);
      let hitOccurred = false;

      if (this._nextVec.y <= groundY + 0.03) {
        this._nextVec.y = groundY + 0.03;
        this._spawnImpactEffects(this._nextVec, this._upVec, false);
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
            tgt.hp = Math.max(0, tgt.hp - 1);
            this.totalHits++;

            this._segVec.copy(p.position).sub(tgt.hitCenterWorld).normalize();

            if (tgt.hp <= 0) {
              this.totalKills++;
              tgt.hp = tgt.maxHp;
              tgt.tiltVelocity = -13.5;
              tgt.flashTimer = 0.25;
              tgt.centerMat.color.setHex(0xfff0c0);
              this._spawnImpactEffects(this._nextVec, this._segVec, true);
              hitOccurred = true;
            } else {
              tgt.tiltVelocity = -6.5;
              tgt.flashTimer = 0.16;
              tgt.centerMat.color.setHex(0xf5d078);
              this._spawnImpactEffects(this._nextVec, this._segVec, false);

              if (Math.random() < 0.20) {
                p.isRicochet = true;
                p.age = 0.0;
                p.maxLife = 0.40;
                p.position.copy(this._nextVec);
                p.velocity.set(
                  (Math.random() - 0.5) * 26.0,
                  10.0 + Math.random() * 16.0,
                  -9.0 + (Math.random() - 0.5) * 16.0
                );
                p.mesh.scale.set(0.65, 0.65, 0.55);
              } else {
                hitOccurred = true;
              }
            }

            if (this.onTargetHitCallback) {
              this.onTargetHitCallback({
                totalHits: this.totalHits,
                totalKills: this.totalKills,
                targetId: tgt.id,
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

    for (let i = 0; i < this.sparks.length; i++) {
      const sp = this.sparks[i];
      if (!sp.active) continue;
      sp.age += dt;
      if (sp.age >= sp.maxLife) {
        sp.active = false;
        sp.mesh.visible = false;
        continue;
      }
      sp.velocity.y -= 14.0 * dt;
      sp.position.addScaledVector(sp.velocity, dt);
      sp.mesh.position.copy(sp.position);
      this._nextVec.copy(sp.position).add(sp.velocity);
      sp.mesh.lookAt(this._nextVec);
      const lifeRatio = 1.0 - sp.age / sp.maxLife;
      sp.mesh.scale.set(lifeRatio, lifeRatio, Math.max(0.25, lifeRatio * 1.5));
    }

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
      const maxS = rg.isExplosion ? 4.5 : 1.9;
      rg.group.scale.setScalar(0.5 + prog * maxS);
      rg.sphereMesh.scale.setScalar(Math.max(0.05, 1.0 - prog * 1.3));
    }

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
