import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as CANNON from 'cannon-es';
import { CameraSystem } from './CameraSystem.js';
import initializeThrusters, { initializeThrustersWithConfig } from './thrusterSetup.js';
import { 
  initializeUI,
  updateUI,
  toggleUIVisibility,
  updateUIText
} from './hudUpdater.js';
import { loadConvexHulls, toggleHullVisibility } from './hullManager.js';
import { 
  loadSpacecraft, 
  toggleSpacecraftBoundingBoxVisibility, 
  getSpacecraftBody, 
  getSpacecraftMesh, 
  updateSpacecraft,
  updateSatelliteMass,
  consumeFuel,
  getFuelStatus,
  resetFuel,
  setFuelProperties
} from './spacecraftManager.js';
import { AttitudeControlSystem } from './attitudeControl.js';
import { LampManager } from './lampManager.js';

// Wait for the startSimulation event before initializing
window.addEventListener('startSimulation', () => {
  initSimulation();
});

function initSimulation() {
  const DEFAULT_MODEL_PATH = 'navion.stl';
  const CONVEX_HULLS_PATH = 'convex-hulls.json';

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000011);
  const skyboxLoader = new THREE.CubeTextureLoader();
  const skybox = skyboxLoader.load([
    'right.png', 'left.png', 'top.png', 'bottom.png', 'front.png', 'back.png'
  ]);
  scene.background = skybox;

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.getElementById('simulation-container').appendChild(renderer.domElement);

  const world = new CANNON.World();
  world.gravity.set(0, 0, 0);
  world.broadphase = new CANNON.NaiveBroadphase();
  world.solver.iterations = 10;

  let satBody;
  let satMesh;
  let camSys;
  let attitudeControl;
  let lampManager;
  let station;
  let defaultProperties = null;
  
  // Timer for debug output
  let lastInertiaDebugTime = 0;
  const INERTIA_DEBUG_INTERVAL = 10000; // 10 seconds in milliseconds
  
  let showDistanceInfo = false;
  let raycaster = new THREE.Raycaster();
  let maxDistance = 100;
  
  let fineControlMode = false;
  let fineControlKeys = {};
  let fineControlProcessedKeys = {};
  let fineControlKeyStartTimes = {};
  let timedFiringEnabled = false;
  let firingDuration = 0.1;
  let torquePercentage = 50; // Percentage of max torque to use (1-100)
  
  let initialPosition = new CANNON.Vec3(0, -3, 5.5);
  let initialOrientation = new CANNON.Quaternion();
  initialOrientation.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI/2);
  let initialOrientationThree = new THREE.Quaternion();
  initialOrientationThree.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI/2);
  let isDocked = true; // Start docked
  let canDock = false;
  let hasLeftDockingBoxOnce = false;
  
  // Clock variables for tracking time since undock
  let undockTime = null; // Timestamp when undocked
  let clockDisplay = null; // Reference to clock display element
  let pausedStartTime = null; // Timestamp when pause started
  let accumulatedPausedTime = 0; // Total time spent paused since undock
  let lastDockedTime = 0; // Time elapsed when last docked
  let DOCKING_BOX_SIZE = 0.1;
  let DOCKING_ANGLE_THRESHOLD = 3;
  const MAX_ANGULAR_SPEED = 1.0;
  const MAX_XZ_SPEED = 0.1;
  const MAX_Z_SPEED = 1.0;

  window.scene = scene;
  window.world = world;
  window.renderer = renderer;

  // Helper function to normalize configuration to unified format
  function normalizeConfiguration(config) {
    const normalized = {
      spacecraftProperties: config.spacecraftProperties || { dryMass: 5, fuelMass: 5, maxFuelMass: 5, inertia: { x: 3, y: 3, z: 3 } },
      cameras: Array.isArray(config.cameras) ? config.cameras : (config.cameras?.cameras || []),
      cmg: { cmgs: Array.isArray(config.cmg) ? config.cmg : (config.cmg?.cmgs || []) },
      lamps: { lamps: Array.isArray(config.lamps) ? config.lamps : (config.lamps?.lamps || []) },
      reactionwheels: { wheels: Array.isArray(config.reactionwheels) ? config.reactionwheels : (config.reactionwheels?.wheels || []) },
      thrusters: { thrusters: Array.isArray(config.thrusters) ? config.thrusters : (config.thrusters?.thrusters || []) }
    };
    
    // Handle CMG format: if config.cmg has a 'cmg' property (single CMG object), convert to cmgs array
    if (config.cmg && config.cmg.cmg) {
      normalized.cmg = { cmgs: [config.cmg.cmg] };
    }
    
    // Preserve model data if present (for editor compatibility)
    if (config.model) {
      normalized.model = config.model;
    }
    
    return normalized;
  }

  // Helper function to get configuration from uploaded files or defaults
  async function getConfiguration() {
    if (window.uploadedFiles && window.uploadedFiles.config) {
      console.log('Using uploaded configuration');
      return normalizeConfiguration(window.uploadedFiles.config);
    }
    
    // Load default configuration if no uploaded config
    try {
      const response = await fetch('config.json');
      if (!response.ok) {
        throw new Error(`Failed to load default config: ${response.statusText}`);
      }
      const data = await response.json();
      console.log('Using default configuration');
      return normalizeConfiguration(data);
    } catch (error) {
      console.error('Error loading default configuration:', error);
      // Return minimal default configuration
      return {
        cameras: [],
        cmg: { cmgs: [] },
        spacecraftProperties: { dryMass: 5, fuelMass: 5, maxFuelMass: 5, inertia: { x: 3, y: 3, z: 3 } },
        lamps: { lamps: [] },
        reactionwheels: { wheels: [] },
        thrusters: { thrusters: [] }
      };
    }
  }

  // Helper function to get spacecraft model
  async function getSpacecraftModel() {
    if (window.uploadedFiles && window.uploadedFiles.spacecraftModel) {
      console.log('Using uploaded spacecraft model');
      // Create a File object from the uploaded model data
      const blob = new Blob([window.uploadedFiles.spacecraftModel], { type: 'model/stl' });
      return new File([blob], 'custom.stl', { type: 'model/stl' });
    }
    
    // Load default model
    try {
      const response = await fetch(DEFAULT_MODEL_PATH);
      if (!response.ok) {
        throw new Error(`Failed to fetch default model: ${response.statusText}`);
      }
      const blob = await response.blob();
      return new File([blob], DEFAULT_MODEL_PATH, { type: 'model/stl' });
    } catch (error) {
      console.error('Error loading default model:', error);
      throw error;
    }
  }

  async function initializeDefaultSpacecraft() {
    const config = await getConfiguration();
    const modelFile = await getSpacecraftModel();
    
    // DEBUG: Log the loaded configuration
    console.log("DEBUG: Configuration loaded:", config);

    // Load initial position/orientation from uploaded file if available
    if (window.uploadedFiles && window.uploadedFiles.initialPosition) {
      const posData = window.uploadedFiles.initialPosition;
      initialPosition = new CANNON.Vec3(posData.position.x, posData.position.y, posData.position.z);
      initialOrientation = new CANNON.Quaternion(posData.orientation.x, posData.orientation.y, posData.orientation.z, posData.orientation.w);
      initialOrientationThree = new THREE.Quaternion(posData.orientation.x, posData.orientation.y, posData.orientation.z, posData.orientation.w);
      
      // Load docking parameters if available in the file
      if (posData.dockingBoxSize !== undefined) {
        DOCKING_BOX_SIZE = posData.dockingBoxSize;
        console.log("Using imported docking box size:", DOCKING_BOX_SIZE);
      }
      if (posData.dockingAngleThreshold !== undefined) {
        DOCKING_ANGLE_THRESHOLD = posData.dockingAngleThreshold;
        console.log("Using imported docking angle threshold:", DOCKING_ANGLE_THRESHOLD);
      }
      
      console.log("Using imported initial position/orientation:", posData);
    } else {
      console.log("Using default initial position/orientation");
    }

    const rotation = { x: 0, y: 0, z: 0 };
    const centroidModel = true;

    loadSpacecraft(modelFile, scene, world, rotation, centroidModel, config.spacecraftProperties, (body, mesh) => {
      satBody = body;
      satMesh = mesh;
      
      // DEBUG: Log the inertia of the body immediately after it's returned
      console.log("DEBUG: Inertia on returned satBody:", {
        x: satBody.inertia.x,
        y: satBody.inertia.y,
        z: satBody.inertia.z
      });
      
      window.satBody = satBody;
      window.satMesh = satMesh;
      
      satBody.position.copy(initialPosition);
      satBody.quaternion.copy(initialOrientation);
      satMesh.position.copy(initialPosition);
      satMesh.quaternion.copy(initialOrientation);
      
      // Ensure velocity and angular velocity are zero at start
      satBody.velocity.set(0, 0, 0);
      satBody.angularVelocity.set(0, 0, 0);

      camSys = new CameraSystem(renderer, satMesh);
      window.camSys = camSys;
      
      attitudeControl = new AttitudeControlSystem(satBody, scene);
      attitudeControl.setSatelliteMesh(satMesh);
      
      lampManager = new LampManager(scene, satMesh);

      // Load docking port
      loadDockingPort();

      main(config);
    });
  }

  // Function to load docking port
  function loadDockingPort() {
    // Check if user uploaded a docking port model
    if (window.uploadedFiles && window.uploadedFiles.dockingPort) {
      // Use uploaded file
      const blob = new Blob([window.uploadedFiles.dockingPort], { type: 'model/stl' });
      const file = new File([blob], 'dockingport.stl', { type: 'model/stl' });
      const reader = new FileReader();
      reader.onload = function(e) {
        const geometry = new STLLoader().parse(e.target.result);
        createDockingPort(geometry);
      };
      reader.readAsArrayBuffer(file);
    } else {
      // Create default docking port if no file is provided
      const geometry = new THREE.BoxGeometry(0.2, 0.2, 0.2);
      createDockingPort(geometry);
    }
  }

  // Function to create docking port
  // Function to create docking port
function createDockingPort(geometry) {
  // Create the visual mesh (the solid model you see)
  const material = new THREE.MeshStandardMaterial({ 
    color: 0x00ff00,
    metalness: 0.7,
    roughness: 0.3
  });
  const dockingPortMesh = new THREE.Mesh(geometry, material);
  dockingPortMesh.position.set(0, -2, 5.5);
  scene.add(dockingPortMesh);

  // --- Create a simple bounding box for collision ---

  // 1. Calculate the bounding box of the loaded geometry
  geometry.computeBoundingBox();
  const box = new THREE.Box3().setFromBufferAttribute(geometry.attributes.position);
  
  // 2. Get the size of the box
  const size = new THREE.Vector3();
  box.getSize(size);

  // 3. Get the center of the geometry to calculate the offset
  const center = new THREE.Vector3();
  box.getCenter(center);
  
  // 4. Calculate the offset position: desired world position + geometry center offset
  const offsetX = 0 + center.x;  // 0 is the desired world X position
  const offsetY = -2 + center.y; // -2 is the desired world Y position
  const offsetZ = 5.5 + center.z; // 5.5 is the desired world Z position

  // 5. Create the CANNON.Box shape using the box's half-extents
  const halfExtents = new CANNON.Vec3(size.x / 2, size.y / 2, size.z / 2);
  const boxShape = new CANNON.Box(halfExtents);

  // 6. Create the physics body at the offset position
  const dockingPortBody = new CANNON.Body({
    mass: 0, // static
    position: new CANNON.Vec3(offsetX, offsetY, offsetZ)
  });
  dockingPortBody.addShape(boxShape);
  world.addBody(dockingPortBody);

  // 7. Create the visual representation of the collision box (the red wireframe)
  const collisionGeometry = new THREE.BoxGeometry(size.x, size.y, size.z);
  const collisionMaterial = new THREE.MeshBasicMaterial({
    color: 0xff0000,
    transparent: true,
    opacity: 0.3,
    wireframe: true
  });
  const dockingPortCollisionMesh = new THREE.Mesh(collisionGeometry, collisionMaterial);
  dockingPortCollisionMesh.position.set(offsetX, offsetY, offsetZ);
  dockingPortCollisionMesh.visible = false; // Initially hidden
  scene.add(dockingPortCollisionMesh);

  // Store references globally
  window.dockingPortMesh = dockingPortMesh; // The green model
  window.dockingPortBody = dockingPortBody; // The physics body
  window.dockingPortCollisionMesh = dockingPortCollisionMesh; // The red wireframe box
}
  //const MODEL_PATH = 'gatewaycore.glb'; //testing
  const MODEL_PATH = 'https://raw.githubusercontent.com/nasa/NASA-3D-Resources/11ebb4ee043715aefbba6aeec8a61746fad67fa7/3D%20Models/Gateway/Gateway%20Core.glb'; //deployed
  const loader = new GLTFLoader();
  loader.load(MODEL_PATH, gltf => {
    station = gltf.scene;
    station.scale.set(1,1,1);
    let rot1 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI/180*-25);
    station.quaternion.multiply(rot1);
    let rot2 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI/180*-10);
    station.quaternion.multiply(rot2);  
    station.position.set(0, 0, 0);
    scene.add(station);
  }, undefined, err => console.error('GLTF load error:', err));

  scene.add(new THREE.AmbientLight(0x404040));
  const dirLight = new THREE.DirectionalLight(0xffffff, 1);
  dirLight.position.set(-10,-2,-1);
  scene.add(dirLight);
  scene.add(new THREE.AxesHelper(5));

  let thrusters = [];
  const keyToThrusterIndices = { w:[],s:[],a:[],d:[],q:[],e:[],i:[],k:[],j:[],l:[],u:[],o:[] };

  window.thrusters = thrusters;
  window.keyToThrusterIndices = keyToThrusterIndices;

  function createThrusterVisual(pos, dir){
    const group = new THREE.Group();
    const cone = new THREE.ConeGeometry(0.15/5,0.4/5,8);
    const mat = new THREE.MeshStandardMaterial({
      color:0xff5500, emissive:0x000000, metalness:0.1, roughness:0.8
    });
    const mesh = new THREE.Mesh(cone, mat);
    mesh.position.copy(pos);
    const q = new THREE.Quaternion();
    q.setFromUnitVectors(new THREE.Vector3(0,1,0), new THREE.Vector3(dir.x,dir.y,dir.z));
    mesh.quaternion.copy(q);
    mesh.rotateX(Math.PI);
    group.add(mesh);
    return {group, material:mat};
  }
  window.createThrusterVisual = createThrusterVisual;

  const keys = {};               
  let backtickPressed = false;

  document.addEventListener('keydown', e => {
    if (e.key === 'CapsLock') {
      fineControlMode = !fineControlMode;
      fineControlKeys = {};
      fineControlProcessedKeys = {};
      return;
    }
    
    const k = e.key.toLowerCase();
    if (k === '`') backtickPressed = true;
    
    if (fineControlMode && ['w','s','a','d','q','e','i','k','j','l','u','o'].includes(k)) {
      e.preventDefault();
      if (!fineControlProcessedKeys[k]) {
        fineControlKeys[k] = true;
        fineControlProcessedKeys[k] = true;
        // Record the start time for timed firing
        if (timedFiringEnabled && !fineControlKeyStartTimes[k]) {
          fineControlKeyStartTimes[k] = performance.now();
        }
      }
    } else {
      keys[k] = true;
    }

    if (backtickPressed && k === 'r') resetSimulation();
    if (backtickPressed && k === 'p') {
      if (isDocked && paused) {
        // Undocking: record the time when we start
        isDocked = false;
        hasLeftDockingBoxOnce = true;
        canDock = false;
        updateUIText('docking-status', 'NOT DOCKED');
        // Record undock time when unpausing from docked state
        undockTime = performance.now();
        accumulatedPausedTime = 0; // Reset paused time when undocking
      }
      
      if (paused) {
        // Unpausing: accumulate the time we were paused
        if (pausedStartTime !== null) {
          accumulatedPausedTime += (performance.now() - pausedStartTime);
          pausedStartTime = null;
        }
      } else {
        // Pausing: record when we paused
        pausedStartTime = performance.now();
      }
      
      paused = !paused;
    }
    if (backtickPressed && k === 'f') {
      if (isDocked && paused) {
        // Undocking: record the time when we start
        isDocked = false;
        hasLeftDockingBoxOnce = true;
        canDock = false;
        updateUIText('docking-status', 'NOT DOCKED');
        // Record undock time when unpausing from docked state
        undockTime = performance.now();
        accumulatedPausedTime = 0; // Reset paused time when undocking
      }
      
      if (paused) {
        // Unpausing: accumulate the time we were paused
        if (pausedStartTime !== null) {
          accumulatedPausedTime += (performance.now() - pausedStartTime);
          pausedStartTime = null;
        }
      } else {
        // Pausing: record when we paused
        pausedStartTime = performance.now();
      }
      
      paused = !paused;
    }
    if (backtickPressed && k === 'h') {
      toggleHullVisibility();
      
      // Check the status text to see if hulls are now visible
      const hullStatus = document.getElementById('hull-status').textContent;
      const showHulls = hullStatus === 'Hulls Visible';
      
      // Manually toggle the docking port collision box to match the hulls
      if (window.dockingPortCollisionMesh) {
        window.dockingPortCollisionMesh.visible = showHulls;
      }
      
      toggleSpacecraftBoundingBoxVisibility(showHulls);
    }
    if (backtickPressed && k === 'x') {
      showDistanceInfo = !showDistanceInfo;
      toggleUIVisibility('distance-info', showDistanceInfo);
    }
    if (k === 'c') camSys.switchCameraMode();
    if (k === ' ') stopEverything();
    if (k === 't' && attitudeControl && attitudeControl.loaded) {
      const newMode = attitudeControl.toggleMode();
      updateUIText('control-mode', 
        newMode === 'thrusters' ? 'Thrusters' : 
        newMode === 'reactionwheels' ? 'Reaction Wheels' : 'CMGs');
      toggleUIVisibility('reaction-wheel-status', newMode === 'reactionwheels');
      toggleUIVisibility('cmg-status', newMode === 'cmgs');
    }
    if (k === 'v' && lampManager) {
      if (backtickPressed) {
        lampManager.toggleHelpers();
      } else {
        const lampsVisible = lampManager.toggleLamps();
        updateUIText('lamp-status-text', lampsVisible ? 'ON' : 'OFF');
      }
    }
    if (k === 'g' && attitudeControl && attitudeControl.loaded) {
      attitudeControl.desaturateWithThrusters(thrusters, keyToThrusterIndices);
    }
  });

  document.addEventListener('keyup', e => {
    const k = e.key.toLowerCase();
    if (k === '`') backtickPressed = false;
    if (fineControlMode) {
      delete fineControlProcessedKeys[k];
    } else {
      delete keys[k];
    }
  });

  function stopEverything() {
    if (!satBody) return;
    satBody.velocity.set(0,0,0);
    satBody.angularVelocity.set(0,0,0);
    thrusters.forEach(t => {
      if (t.active) {
        t.active = false;
        t.material.emissive.setHex(0x000000);
      }
    });
  }
  let paused = true; // Start paused so spacecraft stays docked

  function resetSimulation(){
    if (!satBody || !satMesh) return;
    
    satBody.position.copy(initialPosition);
    satBody.velocity.set(0,0,0);
    satBody.angularVelocity.set(0,0,0);
    
    satBody.quaternion.copy(initialOrientation);
    satMesh.quaternion.copy(initialOrientation);
    
    resetFuel();
    
    if (attitudeControl) {
      attitudeControl.mode = 'thrusters';
      updateUIText('control-mode', 'Thrusters');
      toggleUIVisibility('reaction-wheel-status', false);
      toggleUIVisibility('cmg-status', false);
      attitudeControl.reactionWheels.forEach(wheel => wheel.currentAngularMomentum = 0);
      attitudeControl.cmgs.forEach(cmg => cmg.currentAngularMomentum.set(0, 0, 0));
    }
    
    if (lampManager) {
      lampManager.toggleLamps();
      updateUIText('lamp-status-text', 'ON');
      lampManager.helpersVisible = false;
      lampManager.lampHelpers.forEach(helper => helper.visible = false);
    }
    
    camSys.reset();
    thrusters.forEach(t => {
      t.active = false;
      t.material.emissive.setHex(0x000000);
    });
    
    // Reset clock when simulation is reset - reset to docked state
    isDocked = true;
    paused = true;
    canDock = false;
    hasLeftDockingBoxOnce = false;
    undockTime = null;
    pausedStartTime = null;
    accumulatedPausedTime = 0;
    updateUIText('docking-status', 'DOCKED');
    if (clockDisplay) {
      clockDisplay.textContent = '0:00:00.000';
    }
  }

  // Original docking logic - unchanged
  function isInDockingZone() {
    if (!satBody) return { inBox: false };
    
    const positionDiff = {
      x: satBody.position.x - initialPosition.x,
      y: satBody.position.y - initialPosition.y,
      z: satBody.position.z - initialPosition.z
    };
    
    const distance = Math.sqrt(positionDiff.x**2 + positionDiff.y**2 + positionDiff.z**2);
    const inBox = Math.abs(positionDiff.x) <= DOCKING_BOX_SIZE &&
                  Math.abs(positionDiff.y) <= DOCKING_BOX_SIZE &&
                  Math.abs(positionDiff.z) <= DOCKING_BOX_SIZE;
    
    const currentOrientationThree = new THREE.Quaternion(satBody.quaternion.x, satBody.quaternion.y, satBody.quaternion.z, satBody.quaternion.w);
    const angleDiff = currentOrientationThree.angleTo(initialOrientationThree) * (180 / Math.PI);
    const inAngle = angleDiff <= DOCKING_ANGLE_THRESHOLD;
    
    const speed = satBody.velocity.length();
    const xzSpeed = Math.sqrt(satBody.velocity.x**2 + satBody.velocity.z**2);
    const zSpeed = satBody.velocity.z;
    const withinSpeedLimits = xzSpeed <= MAX_XZ_SPEED && zSpeed <= MAX_Z_SPEED;
    
    const angularSpeed = satBody.angularVelocity.length() * (180 / Math.PI);
    const withinAngularSpeedLimit = angularSpeed <= MAX_ANGULAR_SPEED;
    
    return { inBox, inAngle, withinSpeedLimits, withinAngularSpeedLimit, angleDiff, distance, speed, angularSpeed };
  }

  // Function to update the clock display
  function updateClock() {
    if (!clockDisplay) {
      clockDisplay = document.getElementById('clock-display');
      if (!clockDisplay) return;
    }
    
    // If never undocked, show 0:00:00.000
    if (undockTime === null) {
      clockDisplay.textContent = '0:00:00.000';
      return;
    }
    
    // If docked, show the time at which we docked (paused)
    if (isDocked) {
      const elapsedSeconds = lastDockedTime / 1000;
      const hours = Math.floor(elapsedSeconds / 3600);
      const minutes = Math.floor((elapsedSeconds % 3600) / 60);
      const seconds = Math.floor(elapsedSeconds % 60);
      const milliseconds = Math.floor(lastDockedTime % 1000);
      const hoursStr = hours.toString();
      const minutesStr = minutes.toString().padStart(2, '0');
      const secondsStr = seconds.toString().padStart(2, '0');
      const millisecondsStr = milliseconds.toString().padStart(3, '0');
      clockDisplay.textContent = `${hoursStr}:${minutesStr}:${secondsStr}.${millisecondsStr}`;
      return;
    }
    
    // Calculate elapsed time since undock, accounting for paused time
    let currentTime = performance.now();
    
    // If currently paused, subtract the current pause duration from the calculation
    if (paused && pausedStartTime !== null) {
      currentTime = pausedStartTime;
    }
    
    const elapsedMilliseconds = currentTime - undockTime - accumulatedPausedTime;
    const elapsedSeconds = elapsedMilliseconds / 1000;
    
    // Calculate hours, minutes, seconds, and milliseconds
    const hours = Math.floor(elapsedSeconds / 3600);
    const minutes = Math.floor((elapsedSeconds % 3600) / 60);
    const seconds = Math.floor(elapsedSeconds % 60);
    const milliseconds = Math.floor(elapsedMilliseconds % 1000);
    
    // Format as H:MM:SS.mmm
    const hoursStr = hours.toString();
    const minutesStr = minutes.toString().padStart(2, '0');
    const secondsStr = seconds.toString().padStart(2, '0');
    const millisecondsStr = milliseconds.toString().padStart(3, '0');
    
    clockDisplay.textContent = `${hoursStr}:${minutesStr}:${secondsStr}.${millisecondsStr}`;
  }

  async function main(config) {
    initializeUI();
    
    // Set up event listeners for timed firing controls and torque slider
    const timedFiringToggle = document.getElementById('timed-firing-toggle');
    const firingDurationSlider = document.getElementById('firing-duration-slider');
    const firingDurationValue = document.getElementById('firing-duration-value');
    const torqueSlider = document.getElementById('torque-slider');
    const torqueValue = document.getElementById('torque-value');
    
    if (timedFiringToggle) {
      timedFiringToggle.addEventListener('change', (e) => {
        timedFiringEnabled = e.target.checked;
        // Clear key start times when toggling
        fineControlKeyStartTimes = {};
      });
    }
    
    if (firingDurationSlider && firingDurationValue) {
      firingDurationSlider.addEventListener('input', (e) => {
        firingDuration = parseFloat(e.target.value);
        firingDurationValue.textContent = firingDuration.toFixed(2);
      });
    }
    
    // Torque slider event listener
    if (torqueSlider && torqueValue) {
      torqueSlider.addEventListener('input', (e) => {
        torquePercentage = parseInt(e.target.value);
        torqueValue.textContent = torquePercentage;
      });
    }
    
    try {
      // Initialize all systems with the combined configuration
      thrusters = await initializeThrustersWithConfig(config.thrusters, CANNON, satMesh, keyToThrusterIndices, createThrusterVisual);
      
      // Load hulls from the JSON file
      loadConvexHulls(CONVEX_HULLS_PATH, scene, world);
      
      // Load attitude control configuration
      await attitudeControl.initializeWithConfigs(config.reactionwheels, config.cmg);
      
      // Load lamps configuration
      await lampManager.loadLampsWithConfig(config.lamps);
      
      // Load camera configuration
      camSys.loadCamerasWithConfig(config.cameras);
      
      // NEW: Add the docking port collision mesh to the hull system
      if (window.dockingPortBody && window.dockingPortCollisionMesh) {
        addExternalHull(window.dockingPortBody, window.dockingPortCollisionMesh);
      }
      
      if (attitudeControl.loaded) console.log('Attitude control system loaded');
      else console.log('No attitude control systems loaded, using thrusters only');
      
      console.log('Simulation initialized successfully');
      document.getElementById('hull-status').textContent = 'Spacecraft Loaded';
    } catch (error) {
      console.error('Error during initialization:', error);
      document.getElementById('hull-status').textContent = `Error: ${error.message}`;
    }
    
    animate();
  }

  const clock = new THREE.Clock();
  function animate(){
    requestAnimationFrame(animate);
    const dt = clock.getDelta();
    const currentTime = performance.now();
    
    // Handle timed firing: check if any keys have exceeded their firing duration
    if (fineControlMode && timedFiringEnabled) {
      Object.entries(fineControlKeyStartTimes).forEach(([key, startTime]) => {
        const elapsed = (currentTime - startTime) / 1000; // Convert to seconds
        if (elapsed >= firingDuration) {
          // Remove from fineControlKeys to stop firing
          delete fineControlKeys[key];
          delete fineControlKeyStartTimes[key];
        }
      });
    }
    
    // DEBUG: Print inertia matrix every 10 seconds
    if (satBody && currentTime - lastInertiaDebugTime > INERTIA_DEBUG_INTERVAL) {
      console.log("DEBUG: Velocity Matrix (10s interval):", {
        x: satBody.velocity.x,
        y: satBody.velocity.y,
        z: satBody.velocity.z,
        mass: satBody.mass
      });
      lastInertiaDebugTime = currentTime;
    }
    
    if (!paused && satBody){
      if (attitudeControl && attitudeControl.loaded && attitudeControl.mode !== 'thrusters') {
        const torque = new CANNON.Vec3(0, 0, 0);
        const isCMGMode = attitudeControl.mode === 'cmgs';
        
        // Get max torque from the active attitude control system
        let maxTorque = 0.5; // Default fallback
        if (isCMGMode && attitudeControl.cmgs.length > 0) {
          // Use average max torque from all CMGs
          maxTorque = attitudeControl.cmgs.reduce((sum, cmg) => sum + cmg.maxTorque, 0) / attitudeControl.cmgs.length;
        } else if (!isCMGMode && attitudeControl.reactionWheels.length > 0) {
          // Use average max torque from all reaction wheels
          maxTorque = attitudeControl.reactionWheels.reduce((sum, wheel) => sum + wheel.maxTorque, 0) / attitudeControl.reactionWheels.length;
        }
        
        // Calculate torque per axis based on percentage
        const torquePerAxis = maxTorque * (torquePercentage / 100);
        
        if (fineControlMode) {
          // Swap I and K for CMGs
          if (isCMGMode ? fineControlKeys['k'] : fineControlKeys['i']) torque.x += torquePerAxis;
          if (isCMGMode ? fineControlKeys['i'] : fineControlKeys['k']) torque.x -= torquePerAxis;
          // Swap J and L for CMGs
          if (isCMGMode ? fineControlKeys['j'] : fineControlKeys['l']) torque.y += torquePerAxis;
          if (isCMGMode ? fineControlKeys['l'] : fineControlKeys['j']) torque.y -= torquePerAxis;
          // Swap U and O for CMGs
          if (isCMGMode ? fineControlKeys['o'] : fineControlKeys['u']) torque.z += torquePerAxis;
          if (isCMGMode ? fineControlKeys['u'] : fineControlKeys['o']) torque.z -= torquePerAxis;
        } else {
          // Swap I and K for CMGs
          if (isCMGMode ? keys['k'] : keys['i']) torque.x += torquePerAxis;
          if (isCMGMode ? keys['i'] : keys['k']) torque.x -= torquePerAxis;
          // Swap J and L for CMGs
          if (isCMGMode ? keys['j'] : keys['l']) torque.y += torquePerAxis;
          if (isCMGMode ? keys['l'] : keys['j']) torque.y -= torquePerAxis;
          // Swap U and O for CMGs
          if (isCMGMode ? keys['o'] : keys['u']) torque.z += torquePerAxis;
          if (isCMGMode ? keys['u'] : keys['o']) torque.z -= torquePerAxis;
        }
        if (torque.length() > 0) attitudeControl.applyControlTorque(torque);
        if (attitudeControl.desaturationActive) attitudeControl.desaturateWithThrusters(thrusters, keyToThrusterIndices);
      } else {
        Object.entries(keyToThrusterIndices).forEach(([key, indices]) => {
          const keyIsPressed = fineControlMode ? fineControlKeys[key] : keys[key];
          if (keyIsPressed && indices.length && !['w','s','a','d','q','e'].includes(key)) {
            indices.forEach(i => {
              const t = thrusters[i]; if (!t) return;
              const fuelStatus = getFuelStatus();
              if (fuelStatus.fuelMass <= 0) { if (t.active) { t.active = false; t.material.emissive.setHex(0x000000); } return; }
              if (!t.thrust || !t.isp || t.isp <= 0 || isNaN(t.thrust) || isNaN(t.isp)) { console.error("Thruster has invalid properties, skipping.", t); if (t.active) { t.active = false; t.material.emissive.setHex(0x000000); } return; }
              const forceLocal = t.dir.scale(t.thrust);
              satBody.applyLocalForce(forceLocal, t.pos);
              const fuelConsumptionRate = t.thrust / (t.isp * 9.81);
              const fuelConsumed = fuelConsumptionRate * dt;
              const remainingFuel = consumeFuel(fuelConsumed);
              if (remainingFuel <= 0) { if (t.active) { t.active = false; t.material.emissive.setHex(0x000000); } return; }

              // FIX: Visually activate the thruster
              if (!t.active) {
                t.active = true;
                t.material.emissive.setHex(0xff5500);
              }
            });
          }
        });
      }
      
      Object.entries(keyToThrusterIndices).forEach(([key, indices]) => {
        const keyIsPressed = fineControlMode ? fineControlKeys[key] : keys[key];
        if (keyIsPressed && indices.length && ['w','s','a','d','q','e'].includes(key)) {
          indices.forEach(i => {
            const t = thrusters[i]; if (!t) return;
            const fuelStatus = getFuelStatus();
            if (fuelStatus.fuelMass <= 0) { if (t.active) { t.active = false; t.material.emissive.setHex(0x000000); } return; }
            if (!t.thrust || !t.isp || t.isp <= 0 || isNaN(t.thrust) || isNaN(t.isp)) { console.error("Thruster has invalid properties, skipping.", t); if (t.active) { t.active = false; t.material.emissive.setHex(0x000000); } return; }
            const forceLocal = t.dir.scale(t.thrust);
            satBody.applyLocalForce(forceLocal, t.pos);
            const fuelConsumptionRate = t.thrust / (t.isp * 9.81);
            const fuelConsumed = fuelConsumptionRate * dt;
            const remainingFuel = consumeFuel(fuelConsumed);
            if (remainingFuel <= 0) { if (t.active) { t.active = false; t.material.emissive.setHex(0x000000); } return; }

            // FIX: Visually activate the thruster
            if (!t.active) {
              t.active = true;
              t.material.emissive.setHex(0xff5500);
            }
          });
        }
      });
      
      world.step(1/170);
    }

    if (getSpacecraftBody()) {
      updateSpacecraft();
    }

    camSys.update();

    if (lampManager) {
      lampManager.updateLamps();
    }

    thrusters.forEach(t => {
      const stillPressed = Object.entries(keyToThrusterIndices).some(([k,ids])=> {
        const keyIsPressed = fineControlMode ? fineControlKeys[k] : keys[k];
        return keyIsPressed && ids.includes(t.index);
      });
      if (t.active && !stillPressed){
        t.active = false;
        t.material.emissive.setHex(0x000000);
      }
    });

    // Only clear fineControlKeys if timed firing is NOT enabled
    // When timed firing is enabled, keys are cleared by the duration check logic
    if (!timedFiringEnabled) {
      fineControlKeys = {};
    }

    // Original docking logic - unchanged
    const dockingStatus = isInDockingZone();
    if (!dockingStatus.inBox) hasLeftDockingBoxOnce = true;
    
    updateUIText('dock-distance', dockingStatus.distance.toFixed(3));
    updateUIText('angular-diff', dockingStatus.angleDiff.toFixed(2));
    updateUIText('docking-speed', dockingStatus.speed.toFixed(3));
    updateUIText('docking-angular-speed', dockingStatus.angularSpeed.toFixed(3));
    
    if (!isDocked && canDock && hasLeftDockingBoxOnce && dockingStatus.inBox && dockingStatus.inAngle && dockingStatus.withinSpeedLimits && dockingStatus.withinAngularSpeedLimit) {
      isDocked = true; paused = true;
      updateUIText('docking-status', 'DOCKED');
      satBody.velocity.set(0, 0, 0);
      satBody.angularVelocity.set(0, 0, 0);
      // Record the time elapsed when we dock
      let currentTime = performance.now();
      if (pausedStartTime !== null) {
        currentTime = pausedStartTime;
      }
      lastDockedTime = currentTime - undockTime - accumulatedPausedTime;
    }
    if (!canDock && !dockingStatus.inBox && hasLeftDockingBoxOnce) {
      canDock = true;
    }

    const fuelStatus = getFuelStatus();
    updateUI({
      satBody,
      hudElement: document.getElementById('status-panel'),
      isPaused: paused,
      fuelMass: fuelStatus.fuelMass,
      maxFuelMass: fuelStatus.maxFuelMass,
      dryMass: fuelStatus.dryMass,
      attitudeControl,
      lampManager,
      station,
      satMesh,
      raycaster,
      maxDistance,
      showDistanceInfo,
      cameraSystem: camSys,
      fineControlMode,
      isDocked,
      dockingStatus
    });
    
    // Update clock display
    updateClock();
    
    renderer.render(scene, camSys.getCamera());
  }

  window.addEventListener('resize', ()=>{
    renderer.setSize(window.innerWidth, window.innerHeight);
    camSys.handleResize();
  });

  // // Export current position and orientation to JSON file
  // const copyButton = document.getElementById('export-position-button');
  // const positionElement = document.getElementById('position-info');
  // const velocityElement = document.getElementById('velocity-info');
  // const anglerateElement = document.getElementById('angular-velocity-info');
  // const angleElement = document.getElementById('attitude-info');
  // window.addEventListener('exportPosition', async  () => {
  //   if (!satBody) {
  //     console.error('Spacecraft body not available for export');
  //     alert('Spacecraft not loaded yet');
  //     return;
  //   }

  //   const positionData = {
  //     position: {
  //       x: satBody.position.x,
  //       y: satBody.position.y,
  //       z: satBody.position.z
  //     },
  //     orientation: {
  //       x: satBody.quaternion.x,
  //       y: satBody.quaternion.y,
  //       z: satBody.quaternion.z,
  //       w: satBody.quaternion.w
  //     },
  //     dockingBoxSize: DOCKING_BOX_SIZE,
  //     dockingAngleThreshold: DOCKING_ANGLE_THRESHOLD
  //   };
  //   try {
  //       await navigator.clipboard.writeText(positionElement.textContent+velocityElement.textContent+anglerateElement.textContent+angleElement.textContent);
  //       console.log('Text copied to clipboard successfully!');
  //       // Optional: Provide visual feedback to the user
  //       copyButton.textContent = 'Copied!';
  //       setTimeout(() => {
  //           copyButton.textContent = 'Export Current Position & Orientation';
  //       }, 1500);
  //   } catch (err) {
  //       console.error('Failed to copy text: ', err);
  //   }
  //   console.log('Exported position/orientation:', positionData);
  // });
  const positionElement = document.getElementById('position-info');
  const velocityElement = document.getElementById('velocity-info');
  const anglerateElement = document.getElementById('angular-velocity-info');
  const angleElement = document.getElementById('attitude-info');
  // Export current position and orientation to JSON file
  window.addEventListener('exportPosition', () => {
    if (!satBody) {
      console.error('Spacecraft body not available for export');
      alert('Spacecraft not loaded yet');
      return;
    }
    let pos = positionElement.textContent;
    let vel = velocityElement.textContent;
    let angrat = anglerateElement.textContent;
    let ang = angleElement.textContent;
    const positionData = {
      pos+vel+angrat+ang
    };
  
    // Create a blob and download the file
    const dataStr = JSON.stringify(positionData, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = 'currentposdata.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    console.log('Exported position/orientation:', positionData);
  });
  initializeDefaultSpacecraft();
}
















