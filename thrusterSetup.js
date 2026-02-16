// File: thrusterSetup.js

// Auto-binding tolerances
const TRANSLATION_ANGLE_DEGREES = 90-25;
const TRANSLATION_TOLERANCE = Math.cos(TRANSLATION_ANGLE_DEGREES * Math.PI / 180);

/**
 * Initializes all thrusters based on a configuration file.
 * It creates physics objects, visual representations, and automatically
 * maps them to keyboard controls for translation and rotation.
 *
 * @param {string} configUrl - The URL or path to thruster configuration JSON file.
 * @param {object} CANNON - The Cannon.js physics engine instance.
 * @param {object3D} satMesh - The Three.js (or other) mesh of the satellite to which thrusters will be added.
 * @param {object} keyToThrusterIndices - An object that will be populated with key-to-thruster mappings.
 * @param {function} createThrusterVisual - A function that creates visual representation of a single thruster.
 * @returns {Promise<Array<object>>} A promise that resolves to an array of thruster objects.
 */
export default async function initializeThrusters(configUrl, CANNON, satMesh, keyToThrusterIndices, createThrusterVisual, centerOfMass = {x: 0, y: 0, z: 0}) {
  try {
    const response = await fetch(configUrl);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const config = await response.json();
    
    return processThrusterConfig(config, CANNON, satMesh, keyToThrusterIndices, createThrusterVisual, centerOfMass);
  } catch (error) {
    console.error("Failed to initialize thrusters:", error);
    return []; // Return an empty array on failure
  }
}

/**
 * Initializes all thrusters based on a configuration object (for uploaded files).
 * It creates physics objects, visual representations, and automatically
 * maps them to keyboard controls for translation and rotation.
 *
 * @param {object} config - The thruster configuration object.
 * @param {object} CANNON - The Cannon.js physics engine instance.
 * @param {object3D} satMesh - The Three.js (or other) mesh of the satellite to which thrusters will be added.
 * @param {object} keyToThrusterIndices - An object that will be populated with key-to-thruster mappings.
 * @param {function} createThrusterVisual - A function that creates visual representation of a single thruster.
 * @returns {Promise<Array<object>>} A promise that resolves to an array of thruster objects.
 */
export async function initializeThrustersWithConfig(config, CANNON, satMesh, keyToThrusterIndices, createThrusterVisual, centerOfMass = {x: 0, y: 0, z: 0}) {
  try {
    return processThrusterConfig(config, CANNON, satMesh, keyToThrusterIndices, createThrusterVisual, centerOfMass);
  } catch (error) {
    console.error("Failed to initialize thrusters with config:", error);
    return []; // Return an empty array on failure
  }
}

/**
 * Common function to process thruster configuration and create thruster objects.
 * This is used by both initializeThrusters and initializeThrustersWithConfig.
 *
 * @param {object} config - The thruster configuration object.
 * @param {object} CANNON - The Cannon.js physics engine instance.
 * @param {object3D} satMesh - The Three.js (or other) mesh of the satellite to which thrusters will be added.
 * @param {object} keyToThrusterIndices - An object that will be populated with key-to-thruster mappings.
 * @param {function} createThrusterVisual - A function that creates visual representation of a single thruster.
 * @param {object} centerOfMass - The center of mass offset {x, y, z} to apply to thruster positions.
 * @returns {Array<object>} An array of thruster objects.
 */
function processThrusterConfig(config, CANNON, satMesh, keyToThrusterIndices, createThrusterVisual, centerOfMass = {x: 0, y: 0, z: 0}) {
  const thrusters = config.thrusters.map((t, i) => {
    // Adjust position: original - centerOfMass (relative to center of mass)
    const pos = new CANNON.Vec3(
      t.position[0] - (centerOfMass.x || 0),
      t.position[1] - (centerOfMass.y || 0),
      t.position[2] - (centerOfMass.z || 0)
    );
    const dir = new CANNON.Vec3(t.direction[0], t.direction[1], t.direction[2]).unit();
    const { group: visual, material } = createThrusterVisual(pos, dir);
    satMesh.add(visual);

    // --- DATA SANITIZATION ---
    // This is critical fix. We ensure thrust and isp are valid numbers.
    // First convert strings to numbers, then validate.

    // Sanitize thrust value
    let thrust = parseFloat(t.thrust);
    if (isNaN(thrust) || thrust <= 0) {
      console.warn(`Invalid thrust value for thruster "${t.name || i}": ${t.thrust}. Defaulting to 50N.`);
      thrust = 50;
    }

    // Sanitize ISP value
    let isp = parseFloat(t.isp);
    if (isNaN(isp) || isp <= 0) {
      console.warn(`Invalid ISP value for thruster "${t.name || i}": ${t.isp}. Defaulting to 300s.`);
      isp = 300;
    }
    // --- END SANITIZATION ---

    // ---------- KEYBIND MAPPING ----------
    // Check if autoBind is enabled or use custom keybinds from JSON
    const autoBind = t.autoBind !== false; // Default to true unless explicitly false
    const customKeybinds = Array.isArray(t.keybind) ? t.keybind : [];

    if (autoBind) {
      // Use auto-binding logic based on position and direction
      const dot = (a, b) => a.dot(b);
      if (Math.abs(dot(dir, new CANNON.Vec3(0, 0, 1))) > TRANSLATION_TOLERANCE) keyToThrusterIndices[dir.z > 0 ? 'w' : 's'].push(i);
      if (Math.abs(dot(dir, new CANNON.Vec3(1, 0, 0))) > TRANSLATION_TOLERANCE) keyToThrusterIndices[dir.x > 0 ? 'a' : 'd'].push(i);
      if (Math.abs(dot(dir, new CANNON.Vec3(0, 1, 0))) > TRANSLATION_TOLERANCE) keyToThrusterIndices[dir.y > 0 ? 'e' : 'q'].push(i);

      // Rotation: torque = r × F  (lever arm × direction)
      const lever = pos;
      const torque = lever.cross(dir);

      // Pitch (rotation around X axis)
      if (Math.abs(torque.x) > 0.025) {
        if (torque.x > 0) keyToThrusterIndices['k'].push(i); // pitch up
        else keyToThrusterIndices['i'].push(i); // pitch down
      }

      // Yaw (rotation around Y axis)
      if (Math.abs(torque.y) > 0.025) {
        if (torque.y > 0) keyToThrusterIndices['j'].push(i); // yaw left
        else keyToThrusterIndices['l'].push(i); // yaw right
      }

      // Roll (rotation around Z axis)
      if (Math.abs(torque.z) > 0.025) {
        if (torque.z > 0) keyToThrusterIndices['o'].push(i); // roll left
        else keyToThrusterIndices['u'].push(i); // roll right
      }
    } else {
      // Use custom keybinds from JSON
      // If keybind array is empty, thruster remains unbound
      customKeybinds.forEach(key => {
        const normalizedKey = key.toLowerCase().trim();
        if (normalizedKey && keyToThrusterIndices[normalizedKey]) {
          keyToThrusterIndices[normalizedKey].push(i);
        }
      });
    }
    // ----------------------------------

    // Return sanitized thruster object
    return { pos, dir, thrust, isp, visual, material, active: false, index: i };
  });

  return thrusters;
}
