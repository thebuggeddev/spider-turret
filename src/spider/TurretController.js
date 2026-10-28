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
 * shoulder stalk sensor tracking (`SensorStalkPivot`), and hydraulic firing recoil.
 */
export class TurretController {
  constructor(barrelController) {
    this.barrelController = barrelController || new BarrelRotationController();

    this.currentAimYaw = 0.0;
    this.targetAimYaw = 0.0;
    this.currentAimPitch = 0.0;
    this.targetAimPitch = 0.0;

    this.recoilOffsetZ = 0.0;
    this.recoilPitchKick = 0.0;
    this.vibrationPhase = 0.0;
    this.idleTimer = 0.0;

    this._worldMuzzlePos = new THREE.Vector3();
    this._worldBarrelCenter = new THREE.Vector3();
    this._tempPos = new THREE.Vector3();
    this._turretQuat = new THREE.Quaternion();
  }

  setAimAngles(relYaw, pitch) {
    this.targetAimYaw = relYaw;
    this.targetAimPitch = THREE.MathUtils.clamp(pitch, -0.65, 0.78);
  }

  update(dt, rig, { isFiring = false, isSpinOnly = false, isIdleScan = false, chassisPitch = 0, chassisRoll = 0 } = {}) {
    if (!rig) return { triggeredShot: false };

    this.idleTimer += dt;

    if (isIdleScan) {
      this.targetAimYaw = Math.sin(this.idleTimer * 0.9) * 0.62;
      this.targetAimPitch = Math.sin(this.idleTimer * 1.5) * 0.14 + 0.02;
    }

    const yawDiff = this._normalizeAngle(this.targetAimYaw - this.currentAimYaw);
    const trackRate = Math.min(1.0, dt * 11.5);
    this.currentAimYaw = this._normalizeAngle(this.currentAimYaw + yawDiff * trackRate);
    this.currentAimPitch = THREE.MathUtils.lerp(this.currentAimPitch, this.targetAimPitch, trackRate);

    const triggeredShot = this.barrelController.update(
      dt,
      rig.barrelClusterNode,
      isFiring,
      isSpinOnly
    );

    if (triggeredShot) {
      this.recoilOffsetZ = -0.056;
      this.recoilPitchKick = 0.036;
    }

    const recoilRecover = Math.min(1.0, dt * 22.0);
    this.recoilOffsetZ = THREE.MathUtils.lerp(this.recoilOffsetZ, 0.0, recoilRecover);
    this.recoilPitchKick = THREE.MathUtils.lerp(this.recoilPitchKick, 0.0, recoilRecover);

    const spinRatio = this.barrelController.spinSpeed / this.barrelController.maxSpinSpeed;
    this.vibrationPhase += dt * 72.0;
    const vibAmp = (isFiring ? 0.0065 : 0.002) * spinRatio;
    const vibX = Math.sin(this.vibrationPhase) * vibAmp;
    const vibY = Math.cos(this.vibrationPhase * 1.37) * vibAmp;

    // Split horizontal yaw between main spherical body (76%) and upper turret neck (24%),
    // plus subtle gyroscopic counter-stabilization against lower chassis pitch/roll!
    const bodyYaw = this.currentAimYaw * 0.76;
    const neckYaw = this.currentAimYaw * 0.24;

    if (rig.bodyYawNode) {
      rig.bodyYawNode.rotation.set(
        -this.currentAimPitch * 0.42 - chassisPitch * 0.38 - this.recoilPitchKick * 0.52 + vibX * 0.5,
        bodyYaw,
        -chassisRoll * 0.38 + vibY * 0.5
      );
    }

    if (rig.turretYawNode) {
      rig.turretYawNode.rotation.set(0.0, neckYaw, 0.0);
    }

    if (rig.turretPitchNode) {
      rig.turretPitchNode.rotation.set(
        -(this.currentAimPitch + this.recoilPitchKick) + vibX,
        0.0,
        vibY
      );
      rig.turretPitchNode.position.set(
        rig.baseTurretPitchPos.x + vibY * 0.45,
        rig.baseTurretPitchPos.y + vibX * 0.45,
        rig.baseTurretPitchPos.z + this.recoilOffsetZ
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
      spinSpeed: this.barrelController.spinSpeed,
      heatLevel: this.barrelController.heatLevel,
    };
  }

  getActiveMuzzleTransform(rig, outPos, outDir) {
    if (!rig || !rig.muzzleNodes || rig.muzzleNodes.length === 0) {
      outPos.set(0, 1.62, 1.0);
      outDir.set(0, 0, 1);
      return;
    }

    rig.rootNode.updateWorldMatrix(true, true);
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
    this.barrelController.reset();
  }

  _normalizeAngle(a) {
    while (a > Math.PI) a -= Math.PI * 2.0;
    while (a < -Math.PI) a += Math.PI * 2.0;
    return a;
  }
}
