import * as THREE from 'three';

/**
 * Analytical 3-DOF + Foot-Orientation Mechanical Inverse Kinematics Solver
 * for the Spider Turret's four articulated legs (`FL`, `FR`, `RL`, `RR`).
 *
 * Joint Hierarchy (in Three.js Y-up space after glTF import):
 * - `LegHipYaw_<ID>` (child of `ChassisBase`):
 *     Located at hip socket on chassis rim.
 *     Local +X points radially outward along the leg plane.
 *     Local +Y points vertically Up (Yaw axis).
 * - `LegFemurPitch_<ID>` (child of `LegHipYaw_<ID>`):
 *     Located at `(L_COXA, 0, 0)`.
 *     Local +Z is the horizontal hinge axis: `rotation.z = femurPitch` pitches `(L_FEMUR, 0, 0)`
 *     to `(L_FEMUR * cos(femurPitch), L_FEMUR * sin(femurPitch), 0)` in HipYaw space!
 * - `LegTibiaPitch_<ID>` (child of `LegFemurPitch_<ID>`):
 *     Located at `(L_FEMUR, 0, 0)`.
 *     `rotation.z = tibiaRelPitch` bends the knee in the leg plane.
 * - `LegAnklePitch_<ID>` (child of `LegTibiaPitch_<ID>`):
 *     Located at `(L_TIBIA, 0, 0)`.
 *     `rotation.z = ankleRelPitch` orients the curved claw foot so its tip lands cleanly at the target.
 * - `LegFootTip_<ID>` (child of `LegAnklePitch_<ID>`):
 *     Located at `(L_FOOT, 0, 0)`.
 */
export class LegIKSolver {
  constructor({
    lCoxa = 0.115,
    lFemur = 0.50,
    lTibia = 0.48,
    lFoot = 0.31,
    defaultFootWorldPitch = THREE.MathUtils.degToRad(-113.0),
  } = {}) {
    this.lCoxa = lCoxa;
    this.lFemur = lFemur;
    this.lTibia = lTibia;
    this.lFoot = lFoot;
    this.defaultFootWorldPitch = defaultFootWorldPitch;

    this._invChassisMatrix = new THREE.Matrix4();
    this._localTarget = new THREE.Vector3();
  }

  /**
   * Solves IK for a single leg given a target foot-tip position in World Space.
   *
   * @param {Object} legRig - `{ id, hipYawNode, femurPitchNode, tibiaPitchNode, anklePitchNode, baseYaw, hipLocalPos }`
   * @param {THREE.Object3D} chassisNode - The `ChassisBase` parent node
   * @param {THREE.Vector3} worldFootTarget - Desired 3D world position of `LegFootTip_<ID>`
   * @param {number} [footPitchOffset=0] - Additional pitch angle (radians) for claw lift during swing phase
   * @returns {Object} Solved joint angles `{ yaw, femurPitch, tibiaPitch, anklePitch }`
   */
  solveLegWorld(legRig, chassisNode, worldFootTarget, footPitchOffset = 0.0) {
    if (!legRig || !chassisNode) return null;

    // 1. Transform world foot target into ChassisBase local space
    chassisNode.updateWorldMatrix(true, false);
    this._invChassisMatrix.copy(chassisNode.matrixWorld).invert();
    this._localTarget.copy(worldFootTarget).applyMatrix4(this._invChassisMatrix);

    // 2. Vector from HipYaw origin to target in ChassisBase space (X-Z horizontal, Y vertical)
    const dx = this._localTarget.x - legRig.hipLocalPos.x;
    const dy = this._localTarget.y - legRig.hipLocalPos.y;
    const dz = this._localTarget.z - legRig.hipLocalPos.z;

    // In Three.js glTF space (X_glTF = X_bl, Y_glTF = Z_bl, Z_glTF = -Y_bl):
    // A rotation around +Y by `yaw` maps local +X `(1, 0, 0)` to `(cos(yaw), 0, -sin(yaw))`.
    // Therefore `atan2(-dz, dx)` is the exact yaw angle around +Y!
    const targetYaw = Math.atan2(-dz, dx);

    // Clamp hip yaw relative to the leg's mounting azimuth so legs never collide with the chassis
    let deltaYaw = this._normalizeAngle(targetYaw - legRig.baseYaw);
    deltaYaw = THREE.MathUtils.clamp(deltaYaw, -0.68, 0.68);
    const solvedYaw = legRig.baseYaw + deltaYaw;

    // 3. Project target into the leg's radial-vertical (r, y) plane starting at FemurPitch origin
    const horizDist = Math.sqrt(dx * dx + dz * dz);
    const rFromFemur = Math.max(0.12, horizDist - this.lCoxa);
    const yFromFemur = dy;

    // 4. Desired foot orientation in the leg's vertical plane
    // In rest pose, the claw hooks downward/inward at -113 deg so the curved talon meets the ground cleanly.
    const desiredFootPitch = this.defaultFootWorldPitch + footPitchOffset;

    // Back-compute the required Ankle joint position `(rAnkle, yAnkle)` relative to FemurPitch origin
    let rAnkle = rFromFemur - this.lFoot * Math.cos(desiredFootPitch);
    let yAnkle = yFromFemur - this.lFoot * Math.sin(desiredFootPitch);

    // 5. Two-bone Law of Cosines IK for Femur (L1) and Tibia (L2) -> Knee-Up configuration!
    const L1 = this.lFemur;
    const L2 = this.lTibia;
    const minReach = Math.abs(L1 - L2) + 0.04;
    const maxReach = L1 + L2 - 0.025;

    let distSq = rAnkle * rAnkle + yAnkle * yAnkle;
    let dist = Math.sqrt(distSq);

    if (dist > maxReach) {
      const scale = maxReach / dist;
      rAnkle *= scale;
      yAnkle *= scale;
      dist = maxReach;
      distSq = dist * dist;
    } else if (dist < minReach) {
      const scale = minReach / Math.max(1e-4, dist);
      rAnkle *= scale;
      yAnkle *= scale;
      dist = minReach;
      distSq = dist * dist;
    }

    // Angle from Femur origin to Ankle target
    const baseAngle = Math.atan2(yAnkle, rAnkle);

    // Interior angle at Femur joint via Law of Cosines
    const cosFemurInterior = THREE.MathUtils.clamp(
      (L1 * L1 + distSq - L2 * L2) / (2.0 * L1 * dist),
      -1.0,
      1.0
    );
    const femurInterior = Math.acos(cosFemurInterior);

    // Interior angle at Knee joint via Law of Cosines
    const cosKneeInterior = THREE.MathUtils.clamp(
      (L1 * L1 + L2 * L2 - distSq) / (2.0 * L1 * L2),
      -1.0,
      1.0
    );
    const kneeInterior = Math.acos(cosKneeInterior);

    // Knee-Up solution: Femur pitches ABOVE `baseAngle`, Tibia bends DOWNWARD (`-(PI - kneeInterior)`)
    const femurPitch = baseAngle + femurInterior;
    const tibiaPitch = -(Math.PI - kneeInterior);

    // Ankle pitch relative to Tibia so world foot pitch equals `desiredFootPitch`
    const anklePitch = desiredFootPitch - (femurPitch + tibiaPitch);

    // 6. Apply solved angles directly to the hierarchy pivot nodes
    legRig.hipYawNode.rotation.set(0, solvedYaw, 0);
    legRig.femurPitchNode.rotation.set(0, 0, femurPitch);
    legRig.tibiaPitchNode.rotation.set(0, 0, tibiaPitch);
    legRig.anklePitchNode.rotation.set(0, 0, anklePitch);

    return {
      yaw: solvedYaw,
      femurPitch,
      tibiaPitch,
      anklePitch,
    };
  }

  _normalizeAngle(a) {
    while (a > Math.PI) a -= Math.PI * 2.0;
    while (a < -Math.PI) a += Math.PI * 2.0;
    return a;
  }
}
