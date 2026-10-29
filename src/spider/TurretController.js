import * as THREE from 'three';

/**
 * Controls the 6-barrel Gatling cluster's longitudinal rotation,
 * rapid spin-up / spin-down inertia, thermal glow accumulation,
 * and high-cadence rotary firing trigger synchronization.
 */
export class BarrelRotationController {
  constructor() {
    this.angle = 0.0;
    this.spinSpeed = 0.0;
    this.maxSpinSpeed = 35.0;       // rad/s (~335 RPM cluster = ~2,000 RPM barrel rate!)
    this.spinAccel = 48.0;          // rad/s^2 spin-up acceleration
    this.spinDecel = 15.0;          // rad/s^2 mechanical coasting deceleration
    this.firingThreshold = 10.0;    // minimum rad/s before rounds begin firing
    this.heatLevel = 0.0;           // [0..1] barrel muzzle thermal glow
    this.shotAccumulator = 0.0;
    this.shotIntervalAngle = (Math.PI * 2.0) / 6.0; // 60 degrees per barrel!
  }

  update(dt, barrelClusterNode, isFiring, isSpinOnly = false) {
    const shouldSpin = isFiring || isSpinOnly;

    if (shouldSpin) {
      const targetSpeed = isFiring ? this.maxSpinSpeed : this.maxSpinSpeed * 0.82;
      this.spinSpeed = Math.min(targetSpeed, this.spinSpeed + this.spinAccel * dt);
    } else {
      this.spinSpeed = Math.max(0.0, this.spinSpeed - this.spinDecel * dt);
    }

    const deltaAngle = this.spinSpeed * dt;
    this.angle = (this.angle + deltaAngle) % (Math.PI * 2.0);

    if (barrelClusterNode) {
      barrelClusterNode.rotation.set(0.0, 0.0, this.angle);
    }

    // Build barrel thermal glow progressively while rounds are actively firing
    if (isFiring && this.spinSpeed >= this.firingThreshold) {
      this.heatLevel = Math.min(1.0, this.heatLevel + dt * 0.68);
    } else {
      this.heatLevel = Math.max(0.0, this.heatLevel - dt * 0.28);
    }

    // Trigger a high-velocity round every ~90 deg of rotation (~18-20 rounds/sec at full spin!)
    let triggerShot = false;
    if (isFiring && this.spinSpeed >= this.firingThreshold) {
      this.shotAccumulator += deltaAngle;
      const stepAngle = this.shotIntervalAngle * 1.5;
      if (this.shotAccumulator >= stepAngle) {
        this.shotAccumulator %= stepAngle;
        triggerShot = true;
      }
    } else {
      this.shotAccumulator = 0.0;
    }

    return triggerShot;
  }

  reset() {
    this.angle = 0.0;
    this.spinSpeed = 0.0;
    this.heatLevel = 0.0;
    this.shotAccumulator = 0.0;
  }
}

/**
 * Controls horizontal turret rotation (`BodyYawPivot` + `TurretYawPivot`),
 * vertical elevation (`TurretPitchPivot`), gyro-stabilization against chassis tilt,
 * shoulder stalk sensor tracking (`SensorStalkPivot`), and multi-weapon firing physics
 * across `GATLING` (GAU-6), `RAILGUN` (EMG-02), and `MISSILE` (MLRS-8).
 */
export class TurretController {
  constructor(barrelController) {
    this.barrelController = barrelController || new BarrelRotationController();
    this.weaponType = 'GATLING'; // 'GATLING' | 'RAILGUN' | 'MISSILE'

    this.currentAimYaw = 0.0;
    this.targetAimYaw = 0.0;
    this.currentAimPitch = 0.0;
    this.targetAimPitch = 0.0;
    this.angularSlewSpeed = 0.0;

    this.recoilOffsetZ = 0.0;
    this.recoilPitchKick = 0.0;
    this.vibrationPhase = 0.0;
    this.idleTimer = 0.0;

    // EMG-02 Twin Railgun capacitor state
    this.railCharge = 0.0;
    this.railCooldown = 0.0;
    this.railFlash = 0.0;

    // MLRS-8 Micro-Missile Pod salvo state
    this.missileShotTimer = 0.0;
    this.activeMissileTube = 0;
    this.lastFiredMissileTube = 0;
    this.tubeReloadTimers = new Float32Array(8);

    // Multi-stage mechanical weapon transformation state (continuous C2-smooth deploy factor)
    this.visibleWeapon = 'GATLING';
    this.currentDeployFactor = 1.0; // 1.0 = fully deployed & locked, 0.0 = fully retracted in breech
    this.isTransformingWeapon = false;
    this.transformTurretPitchOffset = 0.0;
    this.transformTurretZOffset = 0.0;

    this._worldMuzzlePos = new THREE.Vector3();
    this._worldBarrelCenter = new THREE.Vector3();
    this._tempPos = new THREE.Vector3();
    this._turretQuat = new THREE.Quaternion();
  }

  setWeaponType(weaponType, rig = null) {
    const valid = ['GATLING', 'RAILGUN', 'MISSILE'].includes(weaponType) ? weaponType : 'GATLING';
    if (valid === this.weaponType && this.visibleWeapon === valid && this.currentDeployFactor >= 1.0) {
      if (rig) rig.setWeaponType(valid);
      return;
    }

    this.weaponType = valid;
    this.isTransformingWeapon = true;
    this.railCharge = 0.0;
    this.railCooldown = 0.0;
    this.missileShotTimer = 0.0;
  }

  setAimAngles(relYaw, pitch) {
    this.targetAimYaw = relYaw;
    this.targetAimPitch = THREE.MathUtils.clamp(pitch, -0.65, 0.78);
  }

  update(dt, rig, { isFiring = false, isSpinOnly = false, isIdleScan = false, chassisPitch = 0, chassisRoll = 0 } = {}) {
    if (!rig) return { triggeredShot: false, spinSpeed: 0, heatLevel: 0, chargeRatio: 0 };

    this.idleTimer += dt;

    if (isIdleScan) {
      this.targetAimYaw = Math.sin(this.idleTimer * 0.9) * 0.62;
      this.targetAimPitch = Math.sin(this.idleTimer * 1.5) * 0.14 + 0.02;
    }

    const prevYaw = this.currentAimYaw;
    const prevPitch = this.currentAimPitch;

    const yawDiff = this._normalizeAngle(this.targetAimYaw - this.currentAimYaw);
    const trackRate = Math.min(1.0, dt * 11.5);
    this.currentAimYaw = this._normalizeAngle(this.currentAimYaw + yawDiff * trackRate);
    this.currentAimPitch = THREE.MathUtils.lerp(this.currentAimPitch, this.targetAimPitch, trackRate);

    const dYaw = Math.abs(this._normalizeAngle(this.currentAimYaw - prevYaw));
    const dPitch = Math.abs(this.currentAimPitch - prevPitch);
    this.angularSlewSpeed = dt > 1e-4 ? Math.min(1.0, (dYaw + dPitch) / (dt * 2.2)) : 0.0;

    let triggeredShot = false;
    let effectiveSpinSpeed = 0.0;
    let heatLevel = this.barrelController.heatLevel;

    // ========================================================================
    // 1. WEAPON-SPECIFIC FIRING & RECOIL MECHANICS
    // ========================================================================
    const canFireNow = !this.isTransformingWeapon && isFiring;
    if (this.weaponType === 'GATLING') {
      triggeredShot = this.barrelController.update(
        dt,
        rig.barrelClusterNode,
        canFireNow,
        isSpinOnly && !this.isTransformingWeapon
      );
      effectiveSpinSpeed = this.barrelController.spinSpeed;
      heatLevel = this.barrelController.heatLevel;

      if (triggeredShot) {
        this.recoilOffsetZ = -0.056;
        this.recoilPitchKick = 0.036;
      }
    } else if (this.weaponType === 'RAILGUN') {
      // Coast down gatling rotor if it was spinning
      this.barrelController.update(dt, rig.barrelClusterNode, false, false);
      this.railFlash = Math.max(0.0, this.railFlash - dt * 4.5);

      if (this.railCooldown > 0.0) {
        this.railCooldown = Math.max(0.0, this.railCooldown - dt);
      }

      if (canFireNow && this.railCooldown <= 0.0) {
        this.railCharge = Math.min(1.0, this.railCharge + dt * 1.85);
        if (this.railCharge >= 1.0) {
          triggeredShot = true;
          this.railCharge = 0.0;
          this.railCooldown = 0.38;
          this.railFlash = 1.0;
          // Heavy electromagnetic recoil kick!
          this.recoilOffsetZ = -0.155;
          this.recoilPitchKick = 0.115;
          this.barrelController.heatLevel = Math.min(1.0, this.barrelController.heatLevel + 0.34);
        }
      } else {
        this.railCharge = Math.max(0.0, this.railCharge - dt * 2.4);
      }

      if (!this.isTransformingWeapon) {
        rig.updateRailgunVisuals(this.railCharge, this.railFlash);
      }
      effectiveSpinSpeed = this.railCharge * 35.0;
      heatLevel = this.barrelController.heatLevel;
    } else if (this.weaponType === 'MISSILE') {
      this.barrelController.update(dt, rig.barrelClusterNode, false, false);

      // Update warhead reload animations inside the 8 launch tubes (when not in weapon-swap sequence)
      if (!this.isTransformingWeapon) {
        for (let i = 0; i < 8; i++) {
          if (this.tubeReloadTimers[i] > 0.0) {
            this.tubeReloadTimers[i] = Math.max(0.0, this.tubeReloadTimers[i] - dt);
          }
          const wh = rig.missileWarheadNodes?.[i];
          if (wh) {
            const rTimer = this.tubeReloadTimers[i];
            if (rTimer > 0.35) {
              wh.visible = false;
            } else {
              wh.visible = true;
              const slideT = 1.0 - rTimer / 0.35;
              wh.position.z = (wh.userData.restZ || 0.535) - (1.0 - slideT) * 0.09;
            }
          }
        }
      }

      if (canFireNow) {
        this.missileShotTimer -= dt;
        if (this.missileShotTimer <= 0.0) {
          triggeredShot = true;
          this.missileShotTimer = 0.24; // ~250 RPM ripple-fire salvo!
          this.lastFiredMissileTube = this.activeMissileTube;
          this.tubeReloadTimers[this.lastFiredMissileTube] = 1.45;
          this.activeMissileTube = (this.activeMissileTube + 1) % 8;

          this.recoilOffsetZ = -0.078;
          this.recoilPitchKick = 0.054;
          this.barrelController.heatLevel = Math.min(1.0, this.barrelController.heatLevel + 0.15);
        }
        effectiveSpinSpeed = 14.8;
      } else {
        this.missileShotTimer = Math.min(0.06, this.missileShotTimer);
        effectiveSpinSpeed = 0.0;
      }

      heatLevel = this.barrelController.heatLevel;
    }

    // ========================================================================
    // 2. CONTINUOUS C2-SMOOTH MECHANICAL WEAPON TRANSFORMATION SEQUENCE
    // ========================================================================
    if (this.isTransformingWeapon) {
      if (this.visibleWeapon !== this.weaponType) {
        // Phase A: Retract currently visible weapon smoothly into Gatling_OrangeHousing
        this.currentDeployFactor = Math.max(0.0, this.currentDeployFactor - dt / 0.36);
        rig.applyWeaponTransformPose(this.visibleWeapon, this.currentDeployFactor, 'RETRACT');

        if (this.visibleWeapon === 'GATLING' && rig.barrelClusterNode) {
          const spinBell = Math.sin(this.currentDeployFactor * Math.PI);
          this.barrelController.angle = (this.barrelController.angle + spinBell * 10.5 * dt) % (Math.PI * 2.0);
          rig.barrelClusterNode.rotation.z = this.barrelController.angle;
        }

        // Smooth C2 turret suspension dip during retraction
        const retractBell = Math.sin(this.currentDeployFactor * Math.PI);
        this.transformTurretPitchOffset = -0.032 * retractBell;
        this.transformTurretZOffset = -0.024 * retractBell;

        // Seamless zero-velocity handover inside the dark receiver drum
        if (this.currentDeployFactor <= 1e-4) {
          this.currentDeployFactor = 0.0;
          this.visibleWeapon = this.weaponType;
          rig.setWeaponType(this.visibleWeapon);
          rig.applyWeaponTransformPose(this.visibleWeapon, 0.0, 'DEPLOY');
        }
      } else {
        // Phase B: Telescope incoming weapon out of Gatling_OrangeHousing & lock sub-assemblies
        this.currentDeployFactor = Math.min(1.0, this.currentDeployFactor + dt / 0.52);
        rig.applyWeaponTransformPose(this.visibleWeapon, this.currentDeployFactor, 'DEPLOY');

        if (this.visibleWeapon === 'GATLING' && rig.barrelClusterNode) {
          const spinBell = Math.sin(this.currentDeployFactor * Math.PI);
          this.barrelController.angle = (this.barrelController.angle + spinBell * 12.0 * dt) % (Math.PI * 2.0);
          rig.barrelClusterNode.rotation.z = this.barrelController.angle;
        } else if (this.visibleWeapon === 'RAILGUN') {
          const calGlow = Math.sin(this.currentDeployFactor * Math.PI) * 0.65;
          if (rig.railPlasmaMat) {
            rig.railPlasmaMat.color.setRGB(
              0.16 + calGlow * 0.84,
              0.66 + calGlow * 0.34,
              0.95 + calGlow * 0.05
            );
          }
        }

        // Smooth damped suspension settle as forward sub-assemblies lock into place
        const deployBell = Math.sin(this.currentDeployFactor * Math.PI);
        this.transformTurretPitchOffset = 0.026 * deployBell * (1.0 - this.currentDeployFactor * 0.4);
        this.transformTurretZOffset = -0.028 * deployBell * (1.0 - this.currentDeployFactor * 0.5);

        if (this.currentDeployFactor >= 1.0 - 1e-4) {
          this.currentDeployFactor = 1.0;
          this.isTransformingWeapon = false;
          this.transformTurretPitchOffset = 0.0;
          this.transformTurretZOffset = 0.0;
          rig.resetWeaponSubPivots();
        }
      }
    } else {
      this.transformTurretPitchOffset = THREE.MathUtils.lerp(this.transformTurretPitchOffset, 0.0, Math.min(1.0, dt * 16.0));
      this.transformTurretZOffset = THREE.MathUtils.lerp(this.transformTurretZOffset, 0.0, Math.min(1.0, dt * 16.0));
    }

    const recoilRecover = Math.min(1.0, dt * (this.weaponType === 'RAILGUN' ? 12.0 : 22.0));
    this.recoilOffsetZ = THREE.MathUtils.lerp(this.recoilOffsetZ, 0.0, recoilRecover);
    this.recoilPitchKick = THREE.MathUtils.lerp(this.recoilPitchKick, 0.0, recoilRecover);

    const spinRatio = effectiveSpinSpeed / this.barrelController.maxSpinSpeed;
    this.vibrationPhase += dt * 72.0;
    const vibAmp = (isFiring ? 0.0065 : 0.002) * spinRatio;
    const vibX = Math.sin(this.vibrationPhase) * vibAmp;
    const vibY = Math.cos(this.vibrationPhase * 1.37) * vibAmp;

    // Split horizontal yaw between main spherical body (76%) and upper turret neck (24%),
    // plus subtle gyroscopic counter-stabilization against lower chassis pitch/roll!
    const bodyYaw = this.currentAimYaw * 0.76;
    const neckYaw = this.currentAimYaw * 0.24;
    const totalPitchKick = this.recoilPitchKick + this.transformTurretPitchOffset;
    const totalZOffset = this.recoilOffsetZ + this.transformTurretZOffset;

    if (rig.bodyYawNode) {
      rig.bodyYawNode.rotation.set(
        -this.currentAimPitch * 0.42 - chassisPitch * 0.38 - totalPitchKick * 0.52 + vibX * 0.5,
        bodyYaw,
        -chassisRoll * 0.38 + vibY * 0.5
      );
    }

    if (rig.turretYawNode) {
      rig.turretYawNode.rotation.set(0.0, neckYaw, 0.0);
    }

    if (rig.turretPitchNode) {
      rig.turretPitchNode.rotation.set(
        -(this.currentAimPitch + totalPitchKick) + vibX,
        0.0,
        vibY
      );
      rig.turretPitchNode.position.set(
        rig.baseTurretPitchPos.x + vibY * 0.45,
        rig.baseTurretPitchPos.y + vibX * 0.45,
        rig.baseTurretPitchPos.z + totalZOffset
      );
    }

    if (rig.sensorStalkNode) {
      const scanYaw = Math.sin(this.idleTimer * 2.4) * 0.25 + neckYaw * 0.6;
      const scanPitch = Math.cos(this.idleTimer * 1.9) * 0.12 - this.currentAimPitch * 0.45;
      rig.sensorStalkNode.rotation.set(
        rig.baseSensorStalkRot.x + scanPitch,
        rig.baseSensorStalkRot.y + scanYaw,
        rig.baseSensorStalkRot.z
      );
    }

    return {
      triggeredShot,
      spinSpeed: effectiveSpinSpeed,
      heatLevel,
      chargeRatio: this.railCharge,
      slewSpeed: this.angularSlewSpeed,
    };
  }

  getActiveMuzzleTransform(rig, outPos, outDir) {
    if (!rig) {
      outPos.set(0, 1.62, 1.0);
      outDir.set(0, 0, 1);
      return;
    }

    rig.rootNode.updateWorldMatrix(true, true);

    if (this.weaponType === 'RAILGUN' && rig.railgunMuzzleNode) {
      rig.railgunMuzzleNode.getWorldPosition(outPos);
    } else if (this.weaponType === 'MISSILE' && rig.missileMuzzleNodes?.length > 0) {
      const mNode = rig.missileMuzzleNodes[this.lastFiredMissileTube] || rig.missileMuzzleNodes[0];
      mNode.getWorldPosition(outPos);
    } else if (rig.muzzleNodes && rig.muzzleNodes.length > 0) {
      let topNode = rig.muzzleNodes[0];
      let maxY = -Infinity;
      for (let i = 0; i < rig.muzzleNodes.length; i++) {
        const mNode = rig.muzzleNodes[i];
        mNode.getWorldPosition(this._tempPos);
        if (this._tempPos.y > maxY) {
          maxY = this._tempPos.y;
          topNode = mNode;
        }
      }
      topNode.getWorldPosition(outPos);
    } else {
      outPos.set(0, 1.62, 1.0);
    }

    rig.turretPitchNode.getWorldQuaternion(this._turretQuat);
    outDir.set(0, 0, 1).applyQuaternion(this._turretQuat).normalize();
  }

  reset() {
    this.currentAimYaw = 0.0;
    this.targetAimYaw = 0.0;
    this.currentAimPitch = 0.0;
    this.targetAimPitch = 0.0;
    this.recoilOffsetZ = 0.0;
    this.recoilPitchKick = 0.0;
    this.transformTurretPitchOffset = 0.0;
    this.transformTurretZOffset = 0.0;
    this.visibleWeapon = this.weaponType;
    this.currentDeployFactor = 1.0;
    this.isTransformingWeapon = false;
    this.railCharge = 0.0;
    this.railCooldown = 0.0;
    this.railFlash = 0.0;
    this.missileShotTimer = 0.0;
    this.activeMissileTube = 0;
    this.tubeReloadTimers.fill(0);
    this.barrelController.reset();
  }

  _normalizeAngle(a) {
    while (a > Math.PI) a -= Math.PI * 2.0;
    while (a < -Math.PI) a += Math.PI * 2.0;
    return a;
  }
}
