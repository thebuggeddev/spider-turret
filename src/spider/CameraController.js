import * as THREE from 'three';

/**
 * Dual-Mode Camera Controller for the Spider Turret Laboratory:
 *
 * 1. `inspect` Mode:
 *    - 360-degree orbital rotation, zoom (`1.2m..11.5m`), pan, underside inspection,
 *      and instant preset angles (defaulting to the exact 3/4 Reference View!).
 * 2. `control` Mode:
 *    - Smooth third-person over-the-shoulder follow camera tracking the walking robot,
 *      while mouse movement independently aims the Gatling turret reticle!
 */
export class CameraController {
  constructor(camera, domElement) {
    this.camera = camera;
    this.domElement = domElement;

    this.mode = 'inspect'; // 'inspect' | 'control'

    // Inspect Mode spherical coordinates (default matches the 3/4 reference image!)
    // In Three.js glTF space (+Z is forward, +X is right, +Y is up):
    // Looking from (+X = +2.25, +Y = +1.55, +Z = +1.85) toward (0, 1.02, 0) puts +Z (gun) pointing to the UPPER-LEFT!
    this.defaultSpherical = {
      radius: 4.25,
      theta: 0.88,      // exact 3/4 reference azimuth
      phi: 1.24,        // polar angle from +Y
      target: new THREE.Vector3(0.0, 0.95, 0.0),
    };

    this.radius = this.defaultSpherical.radius;
    this.targetRadius = this.defaultSpherical.radius;
    this.theta = this.defaultSpherical.theta;
    this.targetTheta = this.defaultSpherical.theta;
    this.phi = this.defaultSpherical.phi;
    this.targetPhi = this.defaultSpherical.phi;

    this.orbitCenter = this.defaultSpherical.target.clone();
    this.targetOrbitCenter = this.defaultSpherical.target.clone();

    // Control Mode follow camera state
    this.followPos = new THREE.Vector3(0, 2.35, -3.6);
    this.followLookAt = new THREE.Vector3(0, 1.15, 2.5);
    this.controlAimYaw = 0.0;
    this.controlAimPitch = 0.04;

    // Pointer interaction state
    this.isDraggingOrbit = false;
    this.isDraggingPan = false;
    this.isMouseFiring = false;
    this.lastPointer = new THREE.Vector2();
    this.pointerNdc = new THREE.Vector2(0, 0);

    this._desiredCamPos = new THREE.Vector3();
    this._desiredLookAt = new THREE.Vector3();
    this._rightVec = new THREE.Vector3();
    this._upVec = new THREE.Vector3();

    this._bindEvents();
    this.applyImmediate();
  }

  _bindEvents() {
    this._onPointerDown = (e) => {
      if (this.mode === 'control') {
        if (e.button === 0) {
          this.isMouseFiring = true;
        }
        return;
      }

      // Inspect mode orbit / pan
      if (e.button === 0 && !e.shiftKey) {
        this.isDraggingOrbit = true;
      } else if (e.button === 2 || (e.button === 0 && e.shiftKey) || e.button === 1) {
        this.isDraggingPan = true;
      }
      this.lastPointer.set(e.clientX, e.clientY);
    };

    this._onPointerMove = (e) => {
      const rect = this.domElement.getBoundingClientRect();
      this.pointerNdc.x = ((e.clientX - rect.left) / Math.max(1, rect.width)) * 2.0 - 1.0;
      this.pointerNdc.y = -((e.clientY - rect.top) / Math.max(1, rect.height)) * 2.0 + 1.0;

      if (this.mode === 'control') {
        // Map normalized mouse coordinates to smooth turret aim offsets relative to robot forward
        this.controlAimYaw = -this.pointerNdc.x * 1.15;
        this.controlAimPitch = THREE.MathUtils.clamp(this.pointerNdc.y * 0.42 + 0.02, -0.36, 0.44);
        return;
      }

      const dx = e.clientX - this.lastPointer.x;
      const dy = e.clientY - this.lastPointer.y;
      this.lastPointer.set(e.clientX, e.clientY);

      if (this.isDraggingOrbit) {
        this.targetTheta -= dx * 0.0075;
        // Allow inspecting low underside (phi up to 1.72 rad) as well as overhead (0.20 rad)
        this.targetPhi = THREE.MathUtils.clamp(this.targetPhi - dy * 0.0065, 0.20, 1.72);
      } else if (this.isDraggingPan) {
        const panScale = this.radius * 0.0014;
        this.camera.getWorldDirection(this._desiredLookAt);
        this._rightVec.crossVectors(this._desiredLookAt, this.camera.up).normalize();
        this._upVec.crossVectors(this._rightVec, this._desiredLookAt).normalize();

        this.targetOrbitCenter.addScaledVector(this._rightVec, -dx * panScale);
        this.targetOrbitCenter.addScaledVector(this._upVec, dy * panScale);
        this.targetOrbitCenter.y = THREE.MathUtils.clamp(this.targetOrbitCenter.y, 0.15, 2.4);
      }
    };

    this._onPointerUp = () => {
      this.isDraggingOrbit = false;
      this.isDraggingPan = false;
      this.isMouseFiring = false;
    };

    this._onWheel = (e) => {
      e.preventDefault();
      if (this.mode === 'inspect') {
        this.targetRadius = THREE.MathUtils.clamp(
          this.targetRadius + e.deltaY * 0.0028,
          1.25,
          22.0
        );
      }
    };

    this._onContextMenu = (e) => e.preventDefault();

    this.domElement.addEventListener('pointerdown', this._onPointerDown);
    window.addEventListener('pointermove', this._onPointerMove);
    window.addEventListener('pointerup', this._onPointerUp);
    this.domElement.addEventListener('wheel', this._onWheel, { passive: false });
    this.domElement.addEventListener('contextmenu', this._onContextMenu);
  }

  setMode(newMode, robotPos = null) {
    this.mode = newMode === 'control' ? 'control' : 'inspect';
    this.isDraggingOrbit = false;
    this.isDraggingPan = false;
    this.isMouseFiring = false;

    if (this.mode === 'inspect' && robotPos) {
      this.targetOrbitCenter.set(robotPos.x, 1.02, robotPos.z);
    }
  }

  resetCamera(robotPos = new THREE.Vector3(0, 0, 0)) {
    this.targetRadius = this.defaultSpherical.radius;
    this.targetTheta = this.defaultSpherical.theta;
    this.targetPhi = this.defaultSpherical.phi;
    this.targetOrbitCenter.set(robotPos.x, 0.95, robotPos.z);
  }

  setPresetView(presetName, robotPos = new THREE.Vector3(0, 0, 0)) {
    this.targetOrbitCenter.set(robotPos.x, 0.95, robotPos.z);
    switch (presetName) {
      case 'reference':
        this.targetTheta = 0.88;
        this.targetPhi = 1.24;
        this.targetRadius = 4.25;
        break;
      case 'front':
        this.targetTheta = 0.0;
        this.targetPhi = 1.30;
        this.targetRadius = 4.25;
        break;
      case 'side':
        this.targetTheta = Math.PI * 0.5;
        this.targetPhi = 1.32;
        this.targetRadius = 4.35;
        break;
      case 'rear':
        this.targetTheta = Math.PI * 0.82;
        this.targetPhi = 1.20;
        this.targetRadius = 4.25;
        break;
      case 'underside':
        this.targetTheta = 0.72;
        this.targetPhi = 1.66;
        this.targetRadius = 3.35;
        this.targetOrbitCenter.set(robotPos.x, 0.68, robotPos.z);
        break;
      default:
        this.resetCamera(robotPos);
    }
  }

  applyImmediate() {
    this.radius = this.targetRadius;
    this.theta = this.targetTheta;
    this.phi = this.targetPhi;
    this.orbitCenter.copy(this.targetOrbitCenter);
    this._updateInspectCamera();
  }

  _updateInspectCamera() {
    const sinPhi = Math.sin(this.phi);
    const cosPhi = Math.cos(this.phi);
    const sinTheta = Math.sin(this.theta);
    const cosTheta = Math.cos(this.theta);

    const cx = this.orbitCenter.x + this.radius * sinPhi * sinTheta;
    const cy = Math.max(0.08, this.orbitCenter.y + this.radius * cosPhi);
    const cz = this.orbitCenter.z + this.radius * sinPhi * cosTheta;

    if (this.camera.clearViewOffset) {
      this.camera.clearViewOffset();
    }

    this.camera.position.set(cx, cy, cz);
    this.camera.lookAt(this.orbitCenter);
  }

  /**
   * Updates camera position and orientation for the current frame.
   */
  update(dt, robotPos, robotYaw, turretAimYaw = 0.0) {
    if (this.mode === 'inspect') {
      const smooth = Math.min(1.0, dt * 10.0);
      const centerSmooth = Math.min(1.0, dt * 4.2);
      this.radius = THREE.MathUtils.lerp(this.radius, this.targetRadius, smooth);
      this.theta = THREE.MathUtils.lerp(this.theta, this.targetTheta, smooth);
      this.phi = THREE.MathUtils.lerp(this.phi, this.targetPhi, smooth);
      this.orbitCenter.lerp(this.targetOrbitCenter, centerSmooth);
      this._updateInspectCamera();
      return;
    }

    // Control Mode: Smooth third-person follow camera behind robot + slight turret lead
    const combinedYaw = robotYaw + turretAimYaw * 0.32;
    const fwdX = Math.sin(combinedYaw);
    const fwdZ = Math.cos(combinedYaw);
    const rightX = Math.cos(combinedYaw);
    const rightZ = -Math.sin(combinedYaw);

    const followDist = 3.75;
    const followHeight = 2.25;
    const shoulderOffset = 0.45;

    this._desiredCamPos.set(
      robotPos.x - fwdX * followDist + rightX * shoulderOffset,
      followHeight,
      robotPos.z - fwdZ * followDist + rightZ * shoulderOffset
    );

    this._desiredLookAt.set(
      robotPos.x + fwdX * 3.2,
      1.18 + this.controlAimPitch * 1.8,
      robotPos.z + fwdZ * 3.2
    );

    const lerpFactor = Math.min(1.0, dt * 8.5);
    this.followPos.lerp(this._desiredCamPos, lerpFactor);
    this.followLookAt.lerp(this._desiredLookAt, lerpFactor);

    this.camera.position.copy(this.followPos);
    this.camera.lookAt(this.followLookAt);
  }

  dispose() {
    this.domElement.removeEventListener('pointerdown', this._onPointerDown);
    window.removeEventListener('pointermove', this._onPointerMove);
    window.removeEventListener('pointerup', this._onPointerUp);
    this.domElement.removeEventListener('wheel', this._onWheel);
    this.domElement.removeEventListener('contextmenu', this._onContextMenu);
  }
}
