import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { upgradeRobotMaterialToTSL } from './tslMaterials.js?v=11';

/**
 * Loads `spider_turret.glb`, upgrades PBR materials to WebGPU/TSL NodeMaterials,
 * binds all mechanical pivot nodes for real-time IK and turret articulation,
 * and provides real-time CAD Wireframe and Mechanical Exploded-View capabilities.
 */
export class RobotRig {
  constructor(gltfScene, tslUniforms) {
    this.sceneRoot = gltfScene;
    this.tslUniforms = tslUniforms;

    this.rootNode = gltfScene.getObjectByName('RobotRoot') || gltfScene;
    this.chassisNode = gltfScene.getObjectByName('ChassisBase');
    this.bodyYawNode = gltfScene.getObjectByName('BodyYawPivot');
    this.sensorStalkNode = gltfScene.getObjectByName('SensorStalkPivot');
    this.turretYawNode = gltfScene.getObjectByName('TurretYawPivot');
    this.turretPitchNode = gltfScene.getObjectByName('TurretPitchPivot');
    this.barrelClusterNode = gltfScene.getObjectByName('BarrelClusterPivot');
    this.rearExhaustGroup = gltfScene.getObjectByName('RearExhaustGroup');

    this.baseTurretPitchPos = this.turretPitchNode
      ? this.turretPitchNode.position.clone()
      : new THREE.Vector3(0, 0.13, 0);

    this.baseTurretYawPos = this.turretYawNode
      ? this.turretYawNode.position.clone()
      : new THREE.Vector3(0, 0.60, 0);

    this.baseBodyYawPos = this.bodyYawNode
      ? this.bodyYawNode.position.clone()
      : new THREE.Vector3(0, 0.16, 0);

    this.baseBarrelClusterPos = this.barrelClusterNode
      ? this.barrelClusterNode.position.clone()
      : new THREE.Vector3(0, 0.17, 0.14);

    this.baseSensorStalkPos = this.sensorStalkNode
      ? this.sensorStalkNode.position.clone()
      : new THREE.Vector3(-0.165, 0.52, 0.165);

    this.baseSensorStalkRot = this.sensorStalkNode
      ? this.sensorStalkNode.rotation.clone()
      : new THREE.Euler(0, 0, 0);

    // Discover the 6 MuzzleTip_<0..5> spawn helpers
    this.muzzleNodes = [];
    for (let i = 0; i < 6; i++) {
      const mNode = gltfScene.getObjectByName(`MuzzleTip_${i}`);
      if (mNode) this.muzzleNodes.push(mNode);
    }

    // Discover the 4 articulated spider legs (`FL`, `FR`, `RL`, `RR`)
    this.legs = {};
    for (const id of ['FL', 'FR', 'RL', 'RR']) {
      const hipYawNode = gltfScene.getObjectByName(`LegHipYaw_${id}`);
      const femurPitchNode = gltfScene.getObjectByName(`LegFemurPitch_${id}`);
      const tibiaPitchNode = gltfScene.getObjectByName(`LegTibiaPitch_${id}`);
      const anklePitchNode = gltfScene.getObjectByName(`LegAnklePitch_${id}`);
      const footTipNode = gltfScene.getObjectByName(`LegFootTip_${id}`);

      if (hipYawNode && femurPitchNode && tibiaPitchNode && anklePitchNode) {
        const hipLocalPos = hipYawNode.position.clone();
        const baseYaw = Math.atan2(-hipLocalPos.z, hipLocalPos.x);

        this.legs[id] = {
          id,
          hipYawNode,
          femurPitchNode,
          tibiaPitchNode,
          anklePitchNode,
          footTipNode,
          hipLocalPos,
          baseFemurPos: femurPitchNode.position.clone(),
          baseTibiaPos: tibiaPitchNode.position.clone(),
          baseAnklePos: anklePitchNode.position.clone(),
          baseYaw,
          restRotations: {
            hipYaw: hipYawNode.rotation.clone(),
            femurPitch: femurPitchNode.rotation.clone(),
            tibiaPitch: tibiaPitchNode.rotation.clone(),
            anklePitch: anklePitchNode.rotation.clone(),
          },
        };
      }
    }

    // Upgrade materials to TSL NodeMaterials and prepare Explode & CAD Wireframe data
    const materialCache = new Map();
    this.wireframeMaterial = new THREE.LineBasicMaterial({
      color: 0xe65616,
      transparent: true,
      opacity: 0.62,
    });
    this.wireframeSegments = [];
    this.explodableMeshes = [];
    this.meshCount = 0;

    gltfScene.updateMatrixWorld(true);

    gltfScene.traverse((obj) => {
      if (obj.isMesh && obj.geometry && obj.material) {
        this.meshCount++;
        const srcMat = obj.material;
        const isBarrelTube = /^BarrelCluster_Barrel_[0-5]$/.test(obj.name);
        const cacheKey = `${srcMat.uuid}_${isBarrelTube ? 'barrel' : 'body'}`;
        if (!materialCache.has(cacheKey)) {
          materialCache.set(
            cacheKey,
            upgradeRobotMaterialToTSL(srcMat, tslUniforms, isBarrelTube)
          );
        }
        obj.material = materialCache.get(cacheKey);
        obj.castShadow = !obj.material.name?.includes('CyanEmissive');
        obj.receiveShadow = false;

        // Compute bounding-box center in parent space to derive a mechanical explosion vector
        obj.geometry.computeBoundingBox();
        const bb = obj.geometry.boundingBox;
        const localCenter = new THREE.Vector3();
        if (bb) {
          bb.getCenter(localCenter);
        }
        localCenter.applyMatrix4(obj.matrix);

        const expVec = this._computeMeshExplodeVector(obj.name, localCenter);
        obj.userData.basePos = obj.position.clone();
        obj.userData.explodeVec = expVec;
        this.explodableMeshes.push(obj);
      }
    });

    this.currentExplode = 0.0;
    this.isWireframe = false;
  }

  /**
   * Computes a deterministic, engineering-accurate explosion offset vector for each part
   * based on its mechanical sub-assembly name and centroid.
   */
  _computeMeshExplodeVector(name, centroid) {
    const v = new THREE.Vector3(0, 0, 0);

    if (name.includes('BarrelCluster_FrontSupportRing')) {
      v.set(0, 0, 0.34);
    } else if (name.includes('BarrelCluster_MidSupportCollar')) {
      v.set(0, 0, 0.18);
    } else if (name.includes('BarrelCluster_Barrel_') || name.includes('BarrelCluster_Bore_Barrel_')) {
      const rDir = new THREE.Vector3(centroid.x, centroid.y, 0);
      if (rDir.lengthSq() > 1e-5) rDir.normalize();
      v.set(rDir.x * 0.11, rDir.y * 0.11, 0.24);
    } else if (name.includes('BarrelCluster_CenterBarrel')) {
      v.set(0, 0, 0.14);
    } else if (name.includes('Gatling_Handle')) {
      v.set(0, 0.22, 0);
    } else if (name.includes('Gatling_SideCircularHub_Left')) {
      v.set(-0.22, 0, 0);
    } else if (name.includes('Gatling_SideCircularHub_Right')) {
      v.set(0.22, 0, 0);
    } else if (name.includes('Gatling_Rear')) {
      v.set(0, 0, -0.24);
    } else if (name.includes('Gatling_FrontInnerRim') || name.includes('Gatling_CollarGroove')) {
      v.set(0, 0, 0.12);
    } else if (name.includes('Body_FrontVisorPlate_Left')) {
      v.set(-0.08, 0.02, 0.24);
    } else if (name.includes('Body_FrontVisorPlate_Right')) {
      v.set(0.08, 0.02, 0.24);
    } else if (name.includes('Body_FrontUpperBrowPlate')) {
      v.set(0, 0.10, 0.24);
    } else if (name.includes('Body_FrontChinBulkhead')) {
      v.set(0, -0.08, 0.20);
    } else if (name.includes('Body_CheekPort')) {
      const sx = name.includes('Left') ? -1 : 1;
      v.set(sx * 0.16, 0.04, 0.18);
    } else if (name.includes('Body_SideLensDrum_Left') || name.includes('Body_SideDrumCollar_Left')) {
      v.set(-0.26, 0, 0);
    } else if (name.includes('Body_SideLensDrum_Right') || name.includes('Body_SideDrumCollar_Right')) {
      v.set(0.26, 0, 0);
    } else if (name.includes('Body_RearReactor') || name.includes('Body_RearWaistGuard')) {
      v.set(0, 0, -0.24);
    } else if (name.includes('Rear_Exhaust')) {
      const sx = name.includes('Left') ? -1 : 1;
      v.set(sx * 0.14, 0.10, -0.28);
    } else if (name.includes('Chassis_OrangeArmor') || name.includes('Chassis_ArmorRib')) {
      const dir = new THREE.Vector3(centroid.x, 0, centroid.z);
      if (dir.lengthSq() > 1e-5) dir.normalize();
      v.set(dir.x * 0.18, 0.0, dir.z * 0.18);
    } else if (name.includes('LegKneeHorn')) {
      v.set(-0.14, 0.12, 0);
    } else if (name.includes('LegFemurTopFlange')) {
      v.set(0, 0.10, 0);
    } else if (name.includes('LegFemurBotFlange')) {
      v.set(0, -0.10, 0);
    } else if (name.includes('LegTibiaOuterRail')) {
      const sy = centroid.z >= 0 ? 1 : -1;
      v.set(0, 0, sy * 0.09);
    } else if (name.includes('LegClawFoot')) {
      v.set(0.14, 0, 0);
    } else if (name.includes('Cap')) {
      const dir = centroid.clone();
      if (dir.lengthSq() > 1e-5) dir.normalize();
      v.copy(dir).multiplyScalar(0.10);
    }
    return v;
  }

  /**
   * Toggles the architectural CAD wireframe overlay on the entire robot.
   * Lazily constructs wireframe geometries on first activation for instant startup.
   */
  setWireframe(enabled) {
    this.isWireframe = enabled;
    if (enabled && this.wireframeSegments.length === 0) {
      for (const mesh of this.explodableMeshes) {
        const edgesGeo = new THREE.WireframeGeometry(mesh.geometry);
        const lineSeg = new THREE.LineSegments(edgesGeo, this.wireframeMaterial);
        lineSeg.name = `${mesh.name}_CADWire`;
        mesh.add(lineSeg);
        this.wireframeSegments.push(lineSeg);
      }
    }
    for (const seg of this.wireframeSegments) {
      seg.visible = enabled;
    }
  }

  /**
   * Applies mechanical exploded-view separation (`factor` in `[0.0 .. 1.0]`)
   * across both hierarchical joint pivots and individual armor/weapon sub-assemblies.
   */
  setExplodeFactor(factor) {
    this.currentExplode = factor;

    // 1. Explode individual sub-assembly meshes
    for (const mesh of this.explodableMeshes) {
      const base = mesh.userData.basePos;
      const exp = mesh.userData.explodeVec;
      if (base && exp) {
        mesh.position.set(
          base.x + exp.x * factor,
          base.y + exp.y * factor,
          base.z + exp.z * factor
        );
      }
    }

    // 2. Explode primary hierarchical pivots along assembly axes
    if (this.bodyYawNode) {
      this.bodyYawNode.position.set(
        this.baseBodyYawPos.x,
        this.baseBodyYawPos.y + 0.14 * factor,
        this.baseBodyYawPos.z
      );
    }
    if (this.turretYawNode) {
      this.turretYawNode.position.set(
        this.baseTurretYawPos.x,
        this.baseTurretYawPos.y + 0.22 * factor,
        this.baseTurretYawPos.z
      );
    }
    if (this.barrelClusterNode) {
      this.barrelClusterNode.position.set(
        this.baseBarrelClusterPos.x,
        this.baseBarrelClusterPos.y,
        this.baseBarrelClusterPos.z + 0.26 * factor
      );
    }
    if (this.sensorStalkNode) {
      this.sensorStalkNode.position.set(
        this.baseSensorStalkPos.x - 0.12 * factor,
        this.baseSensorStalkPos.y + 0.12 * factor,
        this.baseSensorStalkPos.z + 0.08 * factor
      );
    }
    if (this.rearExhaustGroup) {
      this.rearExhaustGroup.position.set(0, 0.08 * factor, -0.18 * factor);
    }

    // 3. Explode the 4 spider legs radially outward from the chassis
    for (const id of ['FL', 'FR', 'RL', 'RR']) {
      const leg = this.legs[id];
      if (!leg) continue;
      const rDir = leg.hipLocalPos.clone().normalize();
      leg.hipYawNode.position.set(
        leg.hipLocalPos.x + rDir.x * 0.20 * factor,
        leg.hipLocalPos.y,
        leg.hipLocalPos.z + rDir.z * 0.20 * factor
      );
      leg.femurPitchNode.position.set(
        leg.baseFemurPos.x + 0.10 * factor,
        leg.baseFemurPos.y,
        leg.baseFemurPos.z
      );
      leg.tibiaPitchNode.position.set(
        leg.baseTibiaPos.x + 0.12 * factor,
        leg.baseTibiaPos.y,
        leg.baseTibiaPos.z
      );
      leg.anklePitchNode.position.set(
        leg.baseAnklePos.x + 0.12 * factor,
        leg.baseAnklePos.y,
        leg.baseAnklePos.z
      );
    }
  }

  /**
   * Restores all leg joints and upper body pivots to their canonical rest pose.
   */
  resetPose() {
    if (this.rootNode) {
      this.rootNode.position.set(0, 0, 0);
      this.rootNode.rotation.set(0, 0, 0);
    }
    if (this.chassisNode) {
      this.chassisNode.position.set(0, 0.56, 0);
      this.chassisNode.rotation.set(0, 0, 0);
    }
    if (this.bodyYawNode) {
      this.bodyYawNode.rotation.set(0, 0, 0);
    }
    if (this.turretYawNode) {
      this.turretYawNode.rotation.set(0, 0, 0);
    }
    if (this.turretPitchNode) {
      this.turretPitchNode.position.copy(this.baseTurretPitchPos);
      this.turretPitchNode.rotation.set(0, 0, 0);
    }
    if (this.barrelClusterNode) {
      this.barrelClusterNode.rotation.set(0, 0, 0);
    }
    for (const id of ['FL', 'FR', 'RL', 'RR']) {
      const leg = this.legs[id];
      if (leg) {
        leg.hipYawNode.rotation.copy(leg.restRotations.hipYaw);
        leg.femurPitchNode.rotation.copy(leg.restRotations.femurPitch);
        leg.tibiaPitchNode.rotation.copy(leg.restRotations.tibiaPitch);
        leg.anklePitchNode.rotation.copy(leg.restRotations.anklePitch);
      }
    }
  }
}

/**
 * Asynchronously loads the rigged Spider Turret GLB and returns a ready `RobotRig`.
 */
export function loadSpiderTurretRig({ url, tslUniforms, onProgress }) {
  return new Promise((resolve, reject) => {
    const loader = new GLTFLoader();
    loader.load(
      url,
      (gltf) => {
        const rig = new RobotRig(gltf.scene, tslUniforms);
        resolve(rig);
      },
      (evt) => {
        if (onProgress && evt.total > 0) {
          onProgress(Math.round((evt.loaded / evt.total) * 100));
        }
      },
      (err) => reject(err)
    );
  });
}
