import * as THREE from 'three';
import { LegIKSolver } from './LegIKSolver.js?v=31';
import { QuadrupedGaitController } from './QuadrupedGaitController.js?v=31';
import { BarrelRotationController, TurretController } from './TurretController.js?v=36';
import { AnimationStateMachine } from './AnimationStateMachine.js?v=31';
import { SoundEngine } from './SoundEngine.js?v=36';

/**
 * Master Robot Controller coordinating locomotion physics, 4-leg analytical IK,
 * terrain-adaptive quadruped gait, sitting posture, head elevation, CAD wireframe,
 * exploded mechanical view, swappable 3D weapon payloads (Gatling / Railgun / Missile),
 * procedural WebAudio mechanical & ballistic synthesis, and Army Aim Box ballistics.
 */
export class RobotController {
  constructor({
    rig,
    projectileSystem,
    cameraController,
    tslUniforms,
    onModeChange,
    onTelemetryUpdate,
  }) {
    this.rig = rig;
    this.projectileSystem = projectileSystem;
    this.cameraController = cameraController;
    this.tslUniforms = tslUniforms;
    this.onModeChange = onModeChange;
    this.onTelemetryUpdate = onTelemetryUpdate;

    // Sub-controllers
    this.ikSolver = new LegIKSolver();
    this.gaitController = new QuadrupedGaitController(this.ikSolver);
    this.barrelController = new BarrelRotationController();
    this.turretController = new TurretController(this.barrelController);
    this.stateMachine = new AnimationStateMachine();
    this.soundEngine = new SoundEngine();

    if (this.projectileSystem) {
      this.projectileSystem.onTargetHitCallback = (evt) => {
        this.soundEngine.playTargetImpact(evt.weaponType, evt.isKill);
      };
    }

    // Robot world transform state
    this.position = new THREE.Vector3(0.0, 0.0, 0.0);
    this.yaw = 0.0;
    this.linearVel = new THREE.Vector3(0.0, 0.0, 0.0);
    this.angularVel = 0.0;

    // Special mechanical states & active weapon payload
    this.weaponType = 'GATLING'; // 'GATLING' | 'RAILGUN' | 'MISSILE'
    this.isSitting = false;
    this.isWireframe = false;
    this.targetExplode = 0.0;
    this.currentExplode = 0.0;
    this.manualYawOffset = 0.0;
    this.manualPitchOffset = 0.0;
    this._prevAimYaw = 0.0;
    this._prevAimPitch = 0.0;

    // Input state
    this.keys = {
      w: false,
      s: false,
      a: false,
      d: false,
      q: false,
      e: false,
      shift: false,
      space: false,
    };
    this.uiFireHeld = false;

    this.elapsedTime = 0.0;
    this.telemetryTimer = 0.0;
    this.exhaustTimer = 0.0;
    this.recoilImpulse = 0.0;

    this._muzzlePos = new THREE.Vector3();
    this._muzzleDir = new THREE.Vector3();
    this._desiredVel = new THREE.Vector3();
    this._exhaustPos = new THREE.Vector3();
    this._exhaustVel = new THREE.Vector3();

    this._bindKeyboard();
    this.gaitController.initFootPositions(this.position, this.yaw);
  }

  _bindKeyboard() {
    this._onKeyDown = (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      const code = e.code;
      this.soundEngine.init();

      if (code === 'Tab') {
        e.preventDefault();
        this.toggleMode();
        return;
      }
      if (code === 'KeyR') {
        e.preventDefault();
        this.resetRobot();
        return;
      }
      if (code === 'KeyC') {
        e.preventDefault();
        this.triggerTestAction('SIT');
        return;
      }
      if (code === 'KeyX') {
        e.preventDefault();
        this.triggerTestAction('WIREFRAME');
        return;
      }
      if (code === 'KeyV') {
        e.preventDefault();
        this.triggerTestAction('EXPLODE');
        return;
      }
      if (code === 'Digit1') {
        e.preventDefault();
        this.setWeaponType('GATLING');
        return;
      }
      if (code === 'Digit2') {
        e.preventDefault();
        this.setWeaponType('RAILGUN');
        return;
      }
      if (code === 'Digit3') {
        e.preventDefault();
        this.setWeaponType('MISSILE');
        return;
      }
      if (code === 'KeyM') {
        e.preventDefault();
        this.triggerTestAction('TOGGLE_SOUND');
        return;
      }

      if (code === 'KeyW' || code === 'ArrowUp') this.keys.w = true;
      if (code === 'KeyS' || code === 'ArrowDown') this.keys.s = true;
      if (code === 'KeyA' || code === 'ArrowLeft') this.keys.a = true;
      if (code === 'KeyD' || code === 'ArrowRight') this.keys.d = true;
      if (code === 'KeyQ') this.keys.q = true;
      if (code === 'KeyE') this.keys.e = true;
      if (code === 'ShiftLeft' || code === 'ShiftRight') this.keys.shift = true;
      if (code === 'Space') {
        e.preventDefault();
        this.keys.space = true;
      }

      // Manual movement keys stand the robot up; W/S override static walk, while A/D/Q/E steer during walk
      if (this.keys.w || this.keys.s || this.keys.a || this.keys.d || this.keys.q || this.keys.e) {
        this.isSitting = false;
        const ov = this.stateMachine.testOverride;
        if (ov && ov !== 'FIRE' && ov !== 'BARREL_SPIN') {
          if (this.keys.w || this.keys.s || (ov !== 'WALK' && ov !== 'FAST_WALK')) {
            this.stateMachine.clearTestOverride();
          }
        }
      }
    };

    this._onKeyUp = (e) => {
      const code = e.code;
      if (code === 'KeyW' || code === 'ArrowUp') this.keys.w = false;
      if (code === 'KeyS' || code === 'ArrowDown') this.keys.s = false;
      if (code === 'KeyA' || code === 'ArrowLeft') this.keys.a = false;
      if (code === 'KeyD' || code === 'ArrowRight') this.keys.d = false;
      if (code === 'KeyQ') this.keys.q = false;
      if (code === 'KeyE') this.keys.e = false;
      if (code === 'ShiftLeft' || code === 'ShiftRight') this.keys.shift = false;
      if (code === 'Space') this.keys.space = false;
    };

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
  }

  toggleMode() {
    this.soundEngine.init();
    const nextMode = this.cameraController.mode === 'inspect' ? 'control' : 'inspect';
    this.setMode(nextMode);
  }

  setMode(targetMode) {
    this.cameraController.setMode(targetMode, this.position);
    if (this.onModeChange) {
      this.onModeChange(targetMode);
    }
  }

  /**
   * Switches the active 3D weapon payload ('GATLING' | 'RAILGUN' | 'MISSILE')
   * with a multi-stage mechanical breech transformation sequence.
   */
  setWeaponType(weaponType) {
    if (weaponType !== 'GATLING' && weaponType !== 'RAILGUN' && weaponType !== 'MISSILE') return;
    this.soundEngine.init();
    if (weaponType !== this.weaponType) {
      this.soundEngine.playWeaponSwapSound(weaponType);
    }
    this.weaponType = weaponType;
    this.turretController.setWeaponType(weaponType, this.rig);
  }

  /**
   * Triggers a specific mechanical system command from the Army Field Control Deck.
   */
  triggerTestAction(actionName) {
    this.soundEngine.init();

    if (actionName === 'WEAPON_GATLING') {
      this.setWeaponType('GATLING');
      return;
    }

    if (actionName === 'WEAPON_RAILGUN') {
      this.setWeaponType('RAILGUN');
      return;
    }

    if (actionName === 'WEAPON_MISSILE') {
      this.setWeaponType('MISSILE');
      return;
    }

    if (actionName === 'TOGGLE_SOUND') {
      this.soundEngine.toggle();
      return;
    }

    if (actionName === 'RESET') {
      this.resetRobot();
      return;
    }

    if (actionName === 'WIREFRAME') {
      this.isWireframe = !this.isWireframe;
      if (this.rig) {
        this.rig.setWireframe(this.isWireframe);
      }
      return;
    }

    if (actionName === 'EXPLODE') {
      this.targetExplode = this.targetExplode > 0.5 ? 0.0 : 1.0;
      return;
    }

    if (actionName === 'SIT') {
      this.isSitting = !this.isSitting;
      if (this.isSitting) {
        if (
          this.stateMachine.testOverride === 'WALK' ||
          this.stateMachine.testOverride === 'FAST_WALK' ||
          this.stateMachine.testOverride === 'TURN'
        ) {
          this.stateMachine.clearTestOverride();
        }
      }
      return;
    }

    if (actionName === 'HEAD_UP') {
      this.nudgeHeadAim(0.0, 0.14);
      return;
    }

    if (actionName === 'HEAD_DOWN') {
      this.nudgeHeadAim(0.0, -0.14);
      return;
    }

    if (actionName === 'HEAD_LEFT') {
      this.nudgeHeadAim(0.22, 0.0);
      return;
    }

    if (actionName === 'HEAD_RIGHT') {
      this.nudgeHeadAim(-0.22, 0.0);
      return;
    }

    if (actionName === 'HEAD_CENTER') {
      this.setManualHeadAim(0.0, 0.0);
      return;
    }

    if (actionName === 'IDLE') {
      this.isSitting = false;
      this.stateMachine.setTestOverride('IDLE');
      return;
    }

    // Walking or turning automatically stands the robot up from sitting
    if (actionName === 'WALK' || actionName === 'FAST_WALK' || actionName === 'TURN') {
      this.isSitting = false;
    }

    if (this.stateMachine.testOverride === actionName) {
      this.stateMachine.clearTestOverride();
    } else {
      this.stateMachine.setTestOverride(actionName);
    }
  }

  /**
   * Directly sets the 2-axis head gimbal aim (yaw in [-PI, PI], pitch in [-0.65, 0.78]).
   */
  setManualHeadAim(yawRad, pitchRad) {
    this.soundEngine.init();
    let normYaw = yawRad;
    while (normYaw > Math.PI) normYaw -= Math.PI * 2.0;
    while (normYaw < -Math.PI) normYaw += Math.PI * 2.0;
    this.manualYawOffset = normYaw;
    this.manualPitchOffset = THREE.MathUtils.clamp(pitchRad, -0.65, 0.78);
    this.turretController.setAimAngles(this.manualYawOffset, this.manualPitchOffset);
  }

  /**
   * Incrementally nudges the 2-axis head gimbal aim by (deltaYawRad, deltaPitchRad).
   */
  nudgeHeadAim(deltaYawRad, deltaPitchRad) {
    this.setManualHeadAim(
      this.manualYawOffset + deltaYawRad,
      this.manualPitchOffset + deltaPitchRad
    );
  }

  resetRobot() {
    this.stateMachine.clearTestOverride();
    this.position.set(0.0, 0.0, 0.0);
    this.yaw = 0.0;
    this.linearVel.set(0.0, 0.0, 0.0);
    this.angularVel = 0.0;
    this.recoilImpulse = 0.0;

    this.isSitting = false;
    this.isWireframe = false;
    this.targetExplode = 0.0;
    this.currentExplode = 0.0;
    this.manualYawOffset = 0.0;
    this.manualPitchOffset = 0.0;

    this.turretController.reset();
    if (this.rig) {
      this.rig.setWireframe(false);
      this.rig.setExplodeFactor(0.0);
      this.rig.resetPose();
      this.rig.setWeaponType(this.weaponType);
    }
    this.gaitController.initFootPositions(this.position, this.yaw);
    if (this.cameraController) {
      this.cameraController.resetCamera(this.position);
    }
  }

  /**
   * Main frame-rate-independent update step (`dt` in seconds).
   */
  update(dt) {
    this.elapsedTime += dt;

    // Smoothly interpolate mechanical Exploded View separation
    if (Math.abs(this.currentExplode - this.targetExplode) > 0.0005) {
      this.currentExplode = THREE.MathUtils.lerp(
        this.currentExplode,
        this.targetExplode,
        Math.min(1.0, dt * 6.5)
      );
      if (this.rig) {
        this.rig.setExplodeFactor(this.currentExplode);
      }
    }

    // 1. Read keyboard & test override inputs
    let fwdInput = (this.keys.w ? 1.0 : 0.0) - (this.keys.s ? 1.0 : 0.0);
    let turnInput = (this.keys.a ? 1.0 : 0.0) - (this.keys.d ? 1.0 : 0.0);
    let strafeInput = (this.keys.e ? 1.0 : 0.0) - (this.keys.q ? 1.0 : 0.0);
    let isFastWalk = this.keys.shift;

    const testMode = this.stateMachine.testOverride;

    if (testMode === 'WALK') {
      if (fwdInput === 0.0) fwdInput = 1.0;
      isFastWalk = this.keys.shift;
    } else if (testMode === 'FAST_WALK') {
      if (fwdInput === 0.0) fwdInput = 1.0;
      isFastWalk = true;
    } else if (testMode === 'TURN') {
      if (turnInput === 0.0) turnInput = 1.0;
    }

    const isFiring =
      this.keys.space ||
      this.uiFireHeld ||
      (this.cameraController && this.cameraController.isMouseFiring) ||
      testMode === 'FIRE';
    const isSpinOnly = testMode === 'BARREL_SPIN';

    // 2. Compute linear and angular velocity
    const maxWalkSpeed = isFastWalk ? 1.85 : 1.12;
    const maxTurnRate = isFastWalk ? 1.65 : 1.18;

    const targetTurnVel = turnInput * maxTurnRate;
    this.angularVel = THREE.MathUtils.lerp(this.angularVel, targetTurnVel, Math.min(1.0, dt * 10.0));
    this.yaw += this.angularVel * dt;

    const fwdX = Math.sin(this.yaw);
    const fwdZ = Math.cos(this.yaw);
    const rightX = Math.cos(this.yaw);
    const rightZ = -Math.sin(this.yaw);

    this._desiredVel.set(
      (fwdX * fwdInput + rightX * strafeInput) * maxWalkSpeed,
      0.0,
      (fwdZ * fwdInput + rightZ * strafeInput) * maxWalkSpeed
    );

    this.linearVel.lerp(this._desiredVel, Math.min(1.0, dt * 9.5));

    // Advance robot position within a flexible bounded range (24m radius instead of endless)
    const unClampedX = this.position.x + this.linearVel.x * dt;
    const unClampedZ = this.position.z + this.linearVel.z * dt;
    this.position.x = unClampedX;
    this.position.z = unClampedZ;

    const maxArenaRadius = 24.0;
    const rFromCenter = Math.hypot(this.position.x, this.position.z);
    if (rFromCenter > maxArenaRadius) {
      const clampScale = maxArenaRadius / rFromCenter;
      this.position.x *= clampScale;
      this.position.z *= clampScale;

      // Feed any boundary-clamped delta into planted feet so gait motion never stalls at the perimeter
      const clampedLossX = unClampedX - this.position.x;
      const clampedLossZ = unClampedZ - this.position.z;
      for (const id of ['FL', 'FR', 'RL', 'RR']) {
        const st = this.gaitController.legStates[id];
        st.plantedWorldPos.x -= clampedLossX;
        st.plantedWorldPos.z -= clampedLossZ;
        st.stepStartWorld.x -= clampedLossX;
        st.stepStartWorld.z -= clampedLossZ;
      }
    }

    // Flexible camera tracking in Inspect mode (0.65m room before smooth follow)
    if (this.cameraController && this.cameraController.mode === 'inspect' && !this.cameraController.isDraggingPan) {
      const oc = this.cameraController.targetOrbitCenter;
      const dx = this.position.x - oc.x;
      const dz = this.position.z - oc.z;
      const distFromCamCenter = Math.hypot(dx, dz);
      const leashRadius = 0.65;
      if (distFromCamCenter > leashRadius) {
        const pull = (distFromCamCenter - leashRadius) / distFromCamCenter;
        oc.x += dx * pull;
        oc.z += dz * pull;
      } else if (this.linearVel.lengthSq() > 0.01) {
        oc.x = THREE.MathUtils.lerp(oc.x, this.position.x, dt * 1.2);
        oc.z = THREE.MathUtils.lerp(oc.z, this.position.z, dt * 1.2);
      }
    }

    const isMoving =
      Math.abs(fwdInput) > 0.05 ||
      Math.abs(turnInput) > 0.05 ||
      Math.abs(strafeInput) > 0.05;

    // 3. Update Turret Aiming & Weapon Payload Cycle
    if (this.cameraController.mode === 'control') {
      this.turretController.setAimAngles(
        this.cameraController.controlAimYaw + this.manualYawOffset,
        this.cameraController.controlAimPitch + this.manualPitchOffset
      );
    } else if (testMode === 'AIM') {
      const sweepYaw = Math.sin(this.elapsedTime * 1.1) * 0.45 + this.manualYawOffset;
      const sweepPitch = Math.cos(this.elapsedTime * 1.6) * 0.12 + this.manualPitchOffset;
      this.turretController.setAimAngles(sweepYaw, sweepPitch);
    } else {
      this.turretController.setAimAngles(this.manualYawOffset, this.manualPitchOffset);
    }

    const { triggeredShot, spinSpeed, heatLevel, chargeRatio } = this.turretController.update(
      dt,
      this.rig,
      {
        isFiring,
        isSpinOnly,
        isIdleScan: false,
        chassisPitch: this.gaitController.currentPitchX,
        chassisRoll: this.gaitController.currentRollZ,
      }
    );

    // 4. Spawn Weapon-Specific Projectile & Trigger Procedural WebAudio SFX on Firing Index
    if (this.projectileSystem) {
      this.turretController.getActiveMuzzleTransform(this.rig, this._muzzlePos, this._muzzleDir);
      this.projectileSystem.updateWeaponChargeEffect(
        this._muzzlePos,
        this._muzzleDir,
        this.weaponType,
        chargeRatio,
        dt
      );
    }

    if (triggeredShot && this.projectileSystem) {
      this.projectileSystem.spawnProjectile(this._muzzlePos, this._muzzleDir, this.weaponType);

      if (this.weaponType === 'RAILGUN') {
        this.recoilImpulse = 2.4;
        this.soundEngine.playRailgunShot();
      } else if (this.weaponType === 'MISSILE') {
        this.recoilImpulse = 1.35;
        this.soundEngine.playMissileLaunch();
      } else {
        this.recoilImpulse = 1.0;
        this.soundEngine.playGatlingShot();
      }
    } else {
      this.recoilImpulse = THREE.MathUtils.lerp(this.recoilImpulse, 0.0, Math.min(1.0, dt * 13.0));
    }

    // 5. Update Quadruped Gait, Sitting Posture & 4-Leg Analytical IK (and detect foot touchdown for SFX)
    const wasSwingFL = this.gaitController.legStates.FL.isSwinging;
    const wasSwingFR = this.gaitController.legStates.FR.isSwinging;
    const wasSwingRL = this.gaitController.legStates.RL.isSwinging;
    const wasSwingRR = this.gaitController.legStates.RR.isSwinging;

    this.gaitController.update(dt, this.rig, {
      position: this.position,
      yaw: this.yaw,
      linearVel: this.linearVel,
      angularVel: this.angularVel,
      isMoving,
      isFastWalk,
      isSitting: this.isSitting,
      recoilImpulse: this.recoilImpulse,
    });

    if (
      (wasSwingFL && !this.gaitController.legStates.FL.isSwinging) ||
      (wasSwingFR && !this.gaitController.legStates.FR.isSwinging) ||
      (wasSwingRL && !this.gaitController.legStates.RL.isSwinging) ||
      (wasSwingRR && !this.gaitController.legStates.RR.isSwinging)
    ) {
      this.soundEngine.playFootstep(isFastWalk);
    }

    // Update continuous WebAudio synthesizer (rotary motor whine / railgun charge whine + leg/gimbal servos)
    const dAimYaw = Math.abs(this.turretController.currentAimYaw - this._prevAimYaw);
    const dAimPitch = Math.abs(this.turretController.currentAimPitch - this._prevAimPitch);
    this._prevAimYaw = this.turretController.currentAimYaw;
    this._prevAimPitch = this.turretController.currentAimPitch;
    const slewSpeed = dt > 0.0001 ? (dAimYaw + dAimPitch) / dt : 0.0;

    this.soundEngine.updateContinuous(dt, {
      weaponType: this.weaponType,
      spinRatio: Math.min(1.0, spinSpeed / 35.0),
      chargeRatio: chargeRatio || 0.0,
      locoActivity: isMoving
        ? Math.min(1.5, this.linearVel.length() * 0.7 + Math.abs(this.angularVel) * 0.5 + 0.35)
        : 0.0,
      gimbalVel: slewSpeed,
    });

    // 6. Update Ballistics, Shell Casings & Single Army Aim Box
    if (this.projectileSystem) {
      this.projectileSystem.update(dt);
    }

    // 7. Update Camera Controller
    if (this.cameraController) {
      this.cameraController.update(dt, this.position, this.yaw, this.turretController.currentAimYaw);
    }

    // 8. Update TSL Shader Uniforms
    if (this.tslUniforms) {
      this.tslUniforms.uTime.value = this.elapsedTime;
      this.tslUniforms.uBarrelHeat.value = heatLevel;
      this.tslUniforms.uMuzzleFlash.value = triggeredShot
        ? 1.0
        : Math.max(0.0, this.tslUniforms.uMuzzleFlash.value - dt * 16.0);
      this.tslUniforms.uRobotWorldPos.value.copy(this.position);
    }

    // 9. Evaluate Animation State Machine & Emit Telemetry at ~15 Hz
    const states = this.stateMachine.evaluate({
      fwdInput,
      turnInput,
      strafeInput,
      isFastInput: isFastWalk,
      isFiringInput: isFiring,
      spinSpeed,
    });

    this.telemetryTimer += dt;
    if (this.telemetryTimer >= 0.065 && this.onTelemetryUpdate) {
      this.telemetryTimer = 0.0;
      const rpm = Math.round((spinSpeed / (Math.PI * 2.0)) * 60.0);
      const chassisMm = Math.round(
        (this.gaitController.baseHeight -
          this.gaitController.sitFactor * 0.25 +
          this.gaitController.suspensionY) *
          1000
      );
      const legAngles = {};
      for (const id of ['FL', 'FR', 'RL', 'RR']) {
        const l = this.rig?.legs?.[id];
        if (l) {
          legAngles[id] = {
            coxa: Math.round(THREE.MathUtils.radToDeg(l.hipYawNode.rotation.y)),
            femur: Math.round(THREE.MathUtils.radToDeg(l.femurPitchNode.rotation.z)),
            tibia: Math.round(THREE.MathUtils.radToDeg(l.tibiaPitchNode.rotation.z)),
            swing: this.gaitController.legStates[id].isSwinging,
          };
        }
      }
      this.onTelemetryUpdate({
        locomotionState: this.isSitting && !isMoving ? 'SITTING_CROUCH' : states.locomotionState,
        weaponState: states.weaponState,
        weaponType: this.weaponType,
        chargePct: Math.round((chargeRatio || 0.0) * 100),
        soundEnabled: this.soundEngine.enabled,
        testOverride: states.testOverride,
        isSitting: this.isSitting,
        isWireframe: this.isWireframe,
        isExploded: this.targetExplode > 0.5,
        turretYawDeg: Math.round(THREE.MathUtils.radToDeg(this.turretController.currentAimYaw)),
        turretPitchDeg: Math.round(THREE.MathUtils.radToDeg(this.turretController.currentAimPitch)),
        headingDeg: Math.round(((THREE.MathUtils.radToDeg(this.yaw) % 360) + 360) % 360),
        barrelRpm: rpm,
        barrelHeatPct: Math.round(heatLevel * 100),
        barrelTempC: Math.round(28 + heatLevel * 760),
        chassisHeightMm: chassisMm,
        legAngles,
        legSwing: {
          FL: this.gaitController.legStates.FL.isSwinging,
          FR: this.gaitController.legStates.FR.isSwinging,
          RL: this.gaitController.legStates.RL.isSwinging,
          RR: this.gaitController.legStates.RR.isSwinging,
        },
        isFiring,
        shotsFired: this.projectileSystem ? this.projectileSystem.shotsFired : 0,
        targetHits: this.projectileSystem ? this.projectileSystem.totalHits : 0,
        targetKills: this.projectileSystem ? this.projectileSystem.totalKills : 0,
      });
    }
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
  }
}
