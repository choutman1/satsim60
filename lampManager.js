import * as THREE from 'three';

export class LampManager {
  constructor(scene, spacecraftMesh) {
    this.scene = scene;
    this.spacecraftMesh = spacecraftMesh;
    this.lamps = [];
    this.lights = [];
    this.lampHelpers = [];
    this.lampsVisible = true;
    this.helpersVisible = false;
    this.centerOfMassOffset = {x: 0, y: 0, z: 0};

    // Create temporary objects for calculations to avoid garbage collection
    this._tempMatrix = new THREE.Matrix4();
    this._tempPos = new THREE.Vector3();
    this._tempDir = new THREE.Vector3();
    this._lampLocalMatrix = new THREE.Matrix4();
    this._combinedMatrix = new THREE.Matrix4();
  }
  
  setCenterOfMassOffset(offset) {
    this.centerOfMassOffset = {
      x: offset.x || 0,
      y: offset.y || 0,
      z: offset.z || 0
    };
  }

  toggleHelpers() {
    this.helpersVisible = !this.helpersVisible;
    this.lampHelpers.forEach(helper => {
      helper.visible = this.helpersVisible;
    });

    if (this.helpersVisible) {
      console.log("=== LAMP DEBUGGING INFO (MANUAL UPDATE) ===");
      console.log("Spacecraft position:", this.spacecraftMesh.position);
      console.log("Spacecraft quaternion:", this.spacecraftMesh.quaternion);
      this.lights.forEach((light, index) => {
        console.log(`--- Lamp ${index} ---`);
        console.log("Light world position:", light.position);
        console.log("Light target world position:", light.target.position);
      });
      console.log("=== END DEBUGGING INFO ===");
    }
    return this.helpersVisible;
  }

  async loadLamps(jsonPath) {
    try {
      const response = await fetch(jsonPath);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const lampsConfig = await response.json();
      
      return this.loadLampsWithConfig(lampsConfig);
    } catch (error) {
      console.error('Failed to load lamps:', error);
      throw error;
    }
  }

  // New function to load lamps from a configuration object
  async loadLampsWithConfig(lampsConfig) {
    try {
      if (!lampsConfig || !lampsConfig.lamps || !Array.isArray(lampsConfig.lamps)) {
        throw new Error('Invalid lamps configuration format');
      }

      for (const lampConfig of lampsConfig.lamps) {
        this.createLamp(lampConfig);
      }
      console.log(`Successfully loaded ${lampsConfig.lamps.length} lamps`);
      return this.lights;
    } catch (error) {
      console.error('Failed to load lamps from config:', error);
      throw error;
    }
  }

  createLamp(config) {
    const color = new THREE.Color(config.color || '#ffffff');
    const light = new THREE.SpotLight(
      color,
      parseFloat(config.intensity) || 1,
      parseFloat(config.distance) || 20,
      parseFloat(config.angle),
      parseFloat(config.penumbra) || 0.2
    );

    if (config.castShadow) {
      light.castShadow = true;
      light.shadow.mapSize.width = 1024;
      light.shadow.mapSize.height = 1024;
      light.shadow.camera.near = 0.5;
      light.shadow.camera.far = config.distance || 20;
    }

    // Add light and its target directly to scene, NOT to spacecraft
    this.scene.add(light);
    this.scene.add(light.target);

    // Add helper for visualization
    const helper = new THREE.SpotLightHelper(light);
    helper.visible = this.helpersVisible;
    this.scene.add(helper);

    // Store references
    this.lamps.push(config);
    this.lights.push(light);
    this.lampHelpers.push(helper);

    return light;
  }

  toggleLamps() {
    this.lampsVisible = !this.lampsVisible;
    this.lights.forEach(light => light.visible = this.lampsVisible);
    return this.lampsVisible;
  }

  // This is critical new method
  updateLamps() {
    // Ensure spacecraft's world matrix is up-to-date
    this.spacecraftMesh.updateMatrixWorld(true);

    // Copy spacecraft's world matrix once, as it's same for all lamps
    this._tempMatrix.copy(this.spacecraftMesh.matrixWorld);

    this.lamps.forEach((config, index) => {
      const light = this.lights[index];
      const helper = this.lampHelpers[index];

      // --- 1. Calculate Light's World Position ---
      // Start with lamp's local position from config (convert strings to numbers), adjust for centerOfMass
      this._tempPos.set(
        parseFloat(config.position.x) - (this.centerOfMassOffset.x || 0),
        parseFloat(config.position.y) - (this.centerOfMassOffset.y || 0),
        parseFloat(config.position.z) - (this.centerOfMassOffset.z || 0)
      );
      // Apply spacecraft's world transform to get final world position
      this._tempPos.applyMatrix4(this._tempMatrix);
      // Set light's position in world space
      light.position.copy(this._tempPos);

      // --- 2. Calculate Light's World Direction ---
      // Create a matrix for lamp's local rotation (convert strings to numbers)
      this._lampLocalMatrix.compose(
        new THREE.Vector3(), // No local position for direction calculation
        new THREE.Quaternion().setFromEuler(new THREE.Euler(
          parseFloat(config.rotation.x),
          parseFloat(config.rotation.y),
          parseFloat(config.rotation.z),
          'XYZ'
        )),
        new THREE.Vector3(1, 1, 1) // No scale
      );
      // Combine spacecraft's transform with lamp's local rotation
      this._combinedMatrix.multiplyMatrices(this._tempMatrix, this._lampLocalMatrix);

      // A spotlight's default direction is its local -Z axis
      this._tempDir.set(0, 0, -1);
      // Transform this direction by the combined matrix to get the final world direction
      this._tempDir.transformDirection(this._combinedMatrix);

      // --- 3. Update Target's World Position ---
      const targetDistance = parseFloat(config.distance) || 20;
      // Position the target at the light's position, plus the direction vector scaled by distance
      light.target.position.copy(light.position).add(this._tempDir.multiplyScalar(targetDistance));

      // --- 4. Update Helper ---
      helper.update();
    });
  }

  setLampIntensity(lampId, intensity) {
    const lampIndex = this.lamps.findIndex(lamp => lamp.id === lampId);
    if (lampIndex !== -1 && this.lights[lampIndex]) {
      this.lights[lampIndex].intensity = intensity;
      return true;
    }
    return false;
  }

  getLamps() {
    return this.lights;
  }

  removeAllLamps() {
    this.lights.forEach(light => {
      this.scene.remove(light);
      this.scene.remove(light.target);
    });
    this.lampHelpers.forEach(helper => this.scene.remove(helper));

    this.lamps = [];
    this.lights = [];
    this.lampHelpers = [];
  }
}
