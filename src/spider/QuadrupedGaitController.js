import * as THREE from 'three';
import { evaluateBattlefieldTerrainHeight } from './tslMaterials.js?v=31';

/**
 * Realistic Heavy Mechanical Quadruped Gait & Suspension Controller.
 *
 * Features:
 * 1. Terrain-aware world-space foot planting (`evaluateBattlefieldTerrainHeight(x, z)`) with zero foot sliding.
 * 2. Articulated 3-stage swing trajectory:
 *    - Stage 1 (Lift-off): Claw tucks inward while knee lifts sharply
 *    - Stage 2 (Mid-swing): Leg reaches forward along a cycloidal curve
 *    - Stage 3 (Touch-down): Claw hooks downward into the ground and imparts a hydraulic
 *      suspension compression impulse to `ChassisBase`!
 * 3. Pre-step Center-of-Mass (CoM) weight shift toward the grounded support triangle.
 */
export class QuadrupedGaitController {
  constructor(ikSolver) {
    this.ikSolver = ikSolver;

    const d = 0.675; // Rest foot distance along X and Z
    this.restFootLocal = {
      FL: new THREE.Vector3(-d, 0.0, +d),
      FR: new THREE.Vector3(+d, 0.0, +d),
      RL: new THREE.Vector3(-d, 0.0, -d),
      RR: new THREE.Vector3(+d, 0.0, -d),
    };

    // Diagonal gait with slight front-rear lead (0.06) for realistic mechanical weight transfer
    this.phaseOffsets = {
      FL: 0.00,
      RR: 0.06,
      FR: 0.50,
      RL: 0.56,
    };

    this.legStates = {};
    for (const id of ['FL', 'FR', 'RL', 'RR']) {
      this.legStates[id] = {
        id,
        currentWorldPos: new THREE.Vector3(),
        plantedWorldPos: new THREE.Vector3(),
        stepStartWorld: new THREE.Vector3(),
        stepTargetWorld: new THREE.Vector3(),
        isSwinging: false,
        swingProgress: 0.0,
        footPitchOffset: 0.0,
      };
    }

    this.gaitCycle = 0.0;
    this.idleTime = 0.0;
    this.initialized = false;

    // Hydraulic chassis suspension & sitting posture state
    this.baseHeight = 0.56;
    this.sitFactor = 0.0;
    this.suspensionY = 0.0;
    this.suspensionVelY = 0.0;
    this.currentPitchX = 0.0;
    this.currentRollZ = 0.0;
    this.weightShiftX = 0.0;
    this.weightShiftZ = 0.0;

    this._idealWorld = new THREE.Vector3();
    this._leadOffset = new THREE.Vector3();
    this._forwardDir = new THREE.Vector3();
    this._rightDir = new THREE.Vector3();
  }

  initFootPositions(robotPos, robotYaw) {
    for (const id of ['FL', 'FR', 'RL', 'RR']) {
      this._computeIdealWorldFoot(id, robotPos, robotYaw, this.legStates[id].plantedWorldPos);
      this.legStates[id].currentWorldPos.copy(this.legStates[id].plantedWorldPos);
      this.legStates[id].stepStartWorld.copy(this.legStates[id].plantedWorldPos);
      this.legStates[id].stepTargetWorld.copy(this.legStates[id].plantedWorldPos);
      this.legStates[id].isSwinging = false;
      this.legStates[id].swingProgress = 0.0;
    }
    this.initialized = true;
  }

  _computeIdealWorldFoot(id, robotPos, robotYaw, outVec) {
    const local = this.restFootLocal[id];
    const cy = Math.cos(robotYaw);
    const sy = Math.sin(robotYaw);
    const wx = robotPos.x + local.x * cy + local.z * sy;
    const wz = robotPos.z - local.x * sy + local.z * cy;
    const wy = evaluateBattlefieldTerrainHeight(wx, wz);
    outVec.set(wx, wy, wz);
    return outVec;
  }

  update(dt, rig, motionState) {
    if (!rig || !rig.chassisNode) return;

    const {
      position,
      yaw,
      linearVel,
      angularVel,
      isMoving,
      isFastWalk,
      isSitting = false,
      recoilImpulse = 0,
    } = motionState;
    if (!this.initialized) {
      this.initFootPositions(position, yaw);
    }

    this.idleTime += dt;
    this.sitFactor = THREE.MathUtils.lerp(
      this.sitFactor,
      isSitting && !isMoving ? 1.0 : 0.0,
      Math.min(1.0, dt * 4.8)
    );

    const speed = Math.hypot(linearVel.x, linearVel.z);
    const turnSpeed = Math.abs(angularVel);
    const effectiveActivity = Math.min(1.15, speed / 1.08 + turnSpeed / 1.25);

    // Measure max foot drift from ideal rest stance
    let maxRestDrift = 0.0;
    for (const id of ['FL', 'FR', 'RL', 'RR']) {
      this._computeIdealWorldFoot(id, position, yaw, this._idealWorld);
      const dx = this.legStates[id].plantedWorldPos.x - this._idealWorld.x;
      const dz = this.legStates[id].plantedWorldPos.z - this._idealWorld.z;
      const d = Math.hypot(dx, dz);
      if (d > maxRestDrift) maxRestDrift = d;
    }

    const needsStepping = isMoving || effectiveActivity > 0.035 || maxRestDrift > 0.075;

    const baseFreq = isFastWalk ? 2.15 : 1.48;
    const cycleRate = needsStepping
      ? baseFreq * Math.max(0.65, Math.min(1.10, effectiveActivity))
      : 0.0;

    if (needsStepping) {
      this.gaitCycle = (this.gaitCycle + dt * cycleRate) % 1.0;
    }

    const stepHeight = isFastWalk ? 0.195 : 0.145;
    const dutyFactor = 0.42; // 42% swing, 58% grounded support

    for (const id of ['FL', 'FR', 'RL', 'RR']) {
      const st = this.legStates[id];
      const legPhase = (this.gaitCycle + this.phaseOffsets[id]) % 1.0;
      const shouldSwing = needsStepping && legPhase < dutyFactor;

      if (shouldSwing) {
        const sProg = legPhase / dutyFactor;

        if (!st.isSwinging) {
          st.isSwinging = true;
          st.stepStartWorld.copy(st.plantedWorldPos);
        }

        const leadTime = isFastWalk ? 0.24 : 0.26;
        const predictedYaw = yaw + angularVel * leadTime;
        const predPos = this._leadOffset.set(
          position.x + linearVel.x * leadTime,
          0.0,
          position.z + linearVel.z * leadTime
        );
        this._computeIdealWorldFoot(id, predPos, predictedYaw, st.stepTargetWorld);

        // Cycloidal horizontal reach curve (smooth acceleration at lift-off, crisp placement at touchdown)
        const smoothT = sProg - Math.sin(2.0 * Math.PI * sProg) / (2.0 * Math.PI);
        st.currentWorldPos.lerpVectors(st.stepStartWorld, st.stepTargetWorld, smoothT);

        // Asymmetric high-knee lift arc (fast vertical lift on first 40%, controlled power-down on last 60%)
        const liftEnvelope = Math.sin(Math.pow(sProg, 0.82) * Math.PI);
        const groundY = evaluateBattlefieldTerrainHeight(st.currentWorldPos.x, st.currentWorldPos.z);
        st.currentWorldPos.y = groundY + liftEnvelope * stepHeight;

        // Articulated claw pitch: tucks inward on lift-off (-0.28 rad), extends forward before impact (+0.22 rad)
        st.footPitchOffset = -Math.sin(sProg * Math.PI * 2.0) * 0.26;
        st.swingProgress = sProg;
      } else {
        if (st.isSwinging) {
          st.isSwinging = false;
          st.plantedWorldPos.copy(st.stepTargetWorld);
          st.plantedWorldPos.y = evaluateBattlefieldTerrainHeight(
            st.plantedWorldPos.x,
            st.plantedWorldPos.z
          );
          // Impart heavy mechanical footstep impact impulse to the hydraulic suspension!
          this.suspensionVelY -= isFastWalk ? 0.26 : 0.17;
        }
        st.currentWorldPos.copy(st.plantedWorldPos);
        st.footPitchOffset = THREE.MathUtils.lerp(st.footPitchOffset, 0.0, Math.min(1.0, dt * 16.0));
        st.swingProgress = 0.0;
      }
    }

    // ========================================================================
    // HYDRAULIC CHASSIS SUSPENSION, WEIGHT SHIFT & TERRAIN CONTOUR ADAPTATION
    // ========================================================================
    // Compute average ground height under the 4 feet
    const avgFootY =
      (this.legStates.FL.currentWorldPos.y +
        this.legStates.FR.currentWorldPos.y +
        this.legStates.RL.currentWorldPos.y +
        this.legStates.RR.currentWorldPos.y) *
      0.25;

    // Damped spring-mass suspension for realistic heavy mechanical weight
    const idleServoBob = Math.sin(this.idleTime * 2.4) * 0.009 + Math.cos(this.idleTime * 5.2) * 0.003;
    const springAccel = -this.suspensionY * 68.0 - this.suspensionVelY * 11.5;
    this.suspensionVelY += springAccel * dt;
    this.suspensionY += this.suspensionVelY * dt;
    this.suspensionY = THREE.MathUtils.clamp(this.suspensionY, -0.065, 0.065);

    this._forwardDir.set(Math.sin(yaw), 0, Math.cos(yaw));
    this._rightDir.set(Math.cos(yaw), 0, -Math.sin(yaw));
    const fwdSpeed = linearVel.dot(this._forwardDir);
    const sideSpeed = linearVel.dot(this._rightDir);

    // Lateral weight shift away from the currently lifting diagonal pair
    const gaitWave = needsStepping ? Math.sin(this.gaitCycle * Math.PI * 2.0) : Math.sin(this.idleTime * 1.3) * 0.18;
    const targetShiftX = needsStepping ? gaitWave * 0.028 : Math.sin(this.idleTime * 1.1) * 0.008;
    const targetShiftZ = fwdSpeed * 0.018 - recoilImpulse * 0.032;

    // Terrain slope pitch & roll + acceleration lean
    const frontY = (this.legStates.FL.plantedWorldPos.y + this.legStates.FR.plantedWorldPos.y) * 0.5;
    const rearY = (this.legStates.RL.plantedWorldPos.y + this.legStates.RR.plantedWorldPos.y) * 0.5;
    const leftY = (this.legStates.FL.plantedWorldPos.y + this.legStates.RL.plantedWorldPos.y) * 0.5;
    const rightY = (this.legStates.FR.plantedWorldPos.y + this.legStates.RR.plantedWorldPos.y) * 0.5;
    const slopePitch = (rearY - frontY) * 0.35;
    const slopeRoll = (leftY - rightY) * 0.35;

    const targetPitchX = THREE.MathUtils.clamp(
      slopePitch + fwdSpeed * 0.038 - recoilImpulse * 0.065 + Math.cos(this.gaitCycle * Math.PI * 4.0) * (needsStepping ? 0.022 : 0.0),
      -0.16,
      0.16
    );
    const targetRollZ = THREE.MathUtils.clamp(
      slopeRoll - sideSpeed * 0.038 - angularVel * 0.032 + gaitWave * (needsStepping ? 0.034 : 0.008),
      -0.14,
      0.14
    );

    const damp = Math.min(1.0, dt * 11.0);
    this.currentPitchX = THREE.MathUtils.lerp(this.currentPitchX, targetPitchX, damp);
    this.currentRollZ = THREE.MathUtils.lerp(this.currentRollZ, targetRollZ, damp);
    this.weightShiftX = THREE.MathUtils.lerp(this.weightShiftX, targetShiftX, damp);
    this.weightShiftZ = THREE.MathUtils.lerp(this.weightShiftZ, targetShiftZ, damp);

    rig.rootNode.position.set(position.x, 0.0, position.z);
    rig.rootNode.rotation.set(0.0, yaw, 0.0);

    const sitHeightOffset = -this.sitFactor * 0.25;
    rig.chassisNode.position.set(
      this.weightShiftX * (1.0 - this.sitFactor * 0.6),
      this.baseHeight + sitHeightOffset + avgFootY * 0.55 + this.suspensionY + idleServoBob * (1.0 - this.sitFactor * 0.5),
      this.weightShiftZ
    );
    rig.chassisNode.rotation.set(this.currentPitchX - this.sitFactor * 0.04, 0.0, this.currentRollZ);

    // Solve 3-DOF analytical IK for all 4 legs
    for (const id of ['FL', 'FR', 'RL', 'RR']) {
      const legRig = rig.legs[id];
      const st = this.legStates[id];
      if (legRig) {
        this.ikSolver.solveLegWorld(legRig, rig.chassisNode, st.currentWorldPos, st.footPitchOffset);
      }
    }
  }
}
