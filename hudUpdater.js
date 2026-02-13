
// File: hudUpdater.js

import * as THREE from 'three';

// UI elements cache to avoid repeated DOM queries
const uiElements = {
  statusPanel: null,
  positionInfo: null,
  velocityInfo: null,
  angularVelocityInfo: null,
  attitudeInfo: null,
  statusInfo: null,
  cameraModeInfo: null,
  fineControlInfo: null,
  fuelPercent: null,
  fuelBar: null,
  dryMass: null,
  fuelMass: null,
  totalMass: null,
  controlMode: null,
  reactionWheelStatus: null,
  rwList: null,
  cmgStatus: null,
  cmgList: null,
  desaturationStatus: null,
  lampStatusText: null,
  lampCount: null,
  distInfo: null,
  distElements: {},
  dockingStatus: null,
  dockDistance: null,
  angularDiff: null,
  dockingSpeed: null,
  dockingAngularSpeed: null
};

// Initialize UI element references
export function initializeUI() {
  uiElements.statusPanel = document.getElementById('status-panel');
  uiElements.positionInfo = document.getElementById('position-info');
  uiElements.velocityInfo = document.getElementById('velocity-info');
  uiElements.angularVelocityInfo = document.getElementById('angular-velocity-info');
  uiElements.attitudeInfo = document.getElementById('attitude-info');
  uiElements.statusInfo = document.getElementById('status-info');
  uiElements.cameraModeInfo = document.getElementById('camera-mode-info');
  uiElements.fineControlInfo = document.getElementById('fine-control-info');
  uiElements.fuelPercent = document.getElementById('fuel-percent');
  uiElements.fuelBar = document.getElementById('fuel-bar');
  uiElements.dryMass = document.getElementById('dry-mass');
  uiElements.fuelMass = document.getElementById('fuel-mass');
  uiElements.totalMass = document.getElementById('total-mass');
  uiElements.controlMode = document.getElementById('control-mode');
  uiElements.reactionWheelStatus = document.getElementById('reaction-wheel-status');
  uiElements.rwList = document.getElementById('rw-list');
  uiElements.cmgStatus = document.getElementById('cmg-status');
  uiElements.cmgList = document.getElementById('cmg-list');
  uiElements.desaturationStatus = document.getElementById('desaturation-status');
  uiElements.lampStatusText = document.getElementById('lamp-status-text');
  uiElements.lampCount = document.getElementById('lamp-count');
  uiElements.distInfo = document.getElementById('distance-info');
  uiElements.dockingStatus = document.getElementById('docking-status');
  uiElements.dockDistance = document.getElementById('dock-distance');
  uiElements.angularDiff = document.getElementById('angular-diff');
  uiElements.dockingSpeed = document.getElementById('docking-speed');
  uiElements.dockingAngularSpeed = document.getElementById('docking-angular-speed');
  
  // Cache distance elements
  ['x-pos', 'x-neg', 'y-pos', 'y-neg', 'z-pos', 'z-neg'].forEach(id => {
    uiElements.distElements[id] = document.getElementById(`dist-${id}`);
  });
}

/**
 * Updates all UI elements in a single call for better organization.
 * @param {object} params - Object containing all necessary parameters
 */
export function updateUI(params) {
  const {
    satBody,
    isPaused,
    fuelMass,
    maxFuelMass,
    dryMass,
    attitudeControl,
    lampManager,
    station,
    satMesh,
    raycaster,
    maxDistance,
    showDistanceInfo,
    cameraSystem,
    fineControlMode,
    isDocked,
    dockingStatus
  } = params;
  
  // Update paused overlay
  togglePausedOverlay(isPaused);
  
  // Update the unified HUD
  updateUnifiedHUD(satBody, isPaused, cameraSystem, fineControlMode, isDocked);
  
  // Update fuel gauge
  updateFuelGauge(fuelMass, maxFuelMass, dryMass);
  
  // Update attitude control status
  updateAttitudeControlStatus(attitudeControl);
  
  // Update lamp status
  updateLampStatus(lampManager);
  
  // Update docking information
  updateDockingInfo(isDocked, dockingStatus);
  
  // Update distance information if enabled
  if (showDistanceInfo) {
    calculateDistancesToWalls(station, satMesh, raycaster, maxDistance);
  }
}

/**
 * Updates the unified HUD with satellite telemetry data, camera mode, and fine control status.
 * @param {object} satBody - The satellite's physics body with position, velocity, etc.
 * @param {boolean} isPaused - The current simulation state (paused or running).
 * @param {object} cameraSystem - The camera system object
 * @param {boolean} fineControlMode - Whether fine control mode is active
 * @param {boolean} isDocked - Whether the spacecraft is docked
 */
function updateUnifiedHUD(satBody, isPaused, cameraSystem, fineControlMode, isDocked) {
  if (!satBody) return;
  
  const p = satBody.position, v = satBody.velocity, av = satBody.angularVelocity;
  const q = satBody.quaternion;
  const euler = new THREE.Euler().setFromQuaternion(
    new THREE.Quaternion(q.x, q.y, q.z, q.w), 'YXZ');
  const rpy = {
    roll: THREE.MathUtils.radToDeg(euler.z),
    pitch: THREE.MathUtils.radToDeg(euler.x),
    yaw: THREE.MathUtils.radToDeg(euler.y)
  };
  
  const cameraModeText = cameraSystem ? cameraSystem.getCameraMode() : 'Unknown';
  const fineControlText = fineControlMode ? 'ON' : 'OFF';
  const fineControlColor = fineControlMode ? '#ff0' : '#0f0';
  
  // Update position info
  if (uiElements.positionInfo) {
    uiElements.positionInfo.textContent = `X: ${p.x.toFixed(7)} Y: ${p.y.toFixed(7)} Z: ${p.z.toFixed(7)}`;
  }
  
  // Update velocity info
  if (uiElements.velocityInfo) {
    uiElements.velocityInfo.textContent = `X: ${v.x.toFixed(7)} Y: ${v.y.toFixed(7)} Z: ${v.z.toFixed(7)}`;
  }
  
  // Update angular velocity info
  if (uiElements.angularVelocityInfo) {
    uiElements.angularVelocityInfo.textContent = `X: ${av.x.toFixed(7)} Y: ${av.y.toFixed(7)} Z: ${av.z.toFixed(7)}`;
  }
  
  // Update attitude info
  if (uiElements.attitudeInfo) {
    uiElements.attitudeInfo.textContent = `Roll: ${rpy.roll.toFixed(7)} ° Pitch: ${rpy.pitch.toFixed(7)} ° Yaw: ${rpy.yaw.toFixed(7)} °`;
  }
  
  // Update status info
  if (uiElements.statusInfo) {
    uiElements.statusInfo.textContent = isPaused ? 'PAUSED' : 'RUNNING';
  }
  
  // Update camera mode info
  if (uiElements.cameraModeInfo) {
    uiElements.cameraModeInfo.textContent = cameraModeText;
  }
  
  // Update fine control info
  if (uiElements.fineControlInfo) {
    uiElements.fineControlInfo.textContent = fineControlText;
    uiElements.fineControlInfo.style.color = fineControlColor;
  }
}

/**
 * Updates the fuel gauge display with current fuel information.
 * @param {number} fuelMass - Current fuel mass
 * @param {number} maxFuelMass - Maximum fuel capacity
 * @param {number} dryMass - Dry mass of the spacecraft
 */
function updateFuelGauge(fuelMass, maxFuelMass, dryMass) {
  if (!uiElements.fuelPercent) return;
  
  const fuelPercent = Math.max(0, (fuelMass / maxFuelMass) * 100);
  uiElements.fuelPercent.textContent = fuelPercent.toFixed(1);
  uiElements.fuelBar.style.width = fuelPercent + '%';
  uiElements.dryMass.textContent = dryMass.toFixed(1);
  uiElements.fuelMass.textContent = fuelMass.toFixed(1);
  uiElements.totalMass.textContent = (dryMass + fuelMass).toFixed(1);
  
  // Change fuel bar color based on fuel level
  if (fuelPercent > 50) {
    uiElements.fuelBar.style.backgroundColor = '#0f0'; // Green
  } else if (fuelPercent > 25) {
    uiElements.fuelBar.style.backgroundColor = '#ff0'; // Yellow
  } else {
    uiElements.fuelBar.style.backgroundColor = '#f00'; // Red
  }
}

/**
 * Updates the attitude control status display.
 * @param {object} attitudeControl - The attitude control system object
 */
function updateAttitudeControlStatus(attitudeControl) {
  if (!attitudeControl || !attitudeControl.loaded) return;
  
  const status = attitudeControl.getStatus();
  
  // Update desaturation status
  uiElements.desaturationStatus.style.display = 
    status.desaturationActive ? 'block' : 'none';
  
  // Update reaction wheel status
  if (status.mode === 'reactionwheels' && status.reactionWheels) {
    uiElements.reactionWheelStatus.style.display = 'block';
    uiElements.cmgStatus.style.display = 'none';
    
    uiElements.rwList.innerHTML = '';
    
    status.reactionWheels.forEach(wheel => {
      const wheelDiv = document.createElement('div');
      wheelDiv.style.fontSize = '9px';
      wheelDiv.style.marginTop = '2px';
      
      const color = Math.abs(wheel.percentage) > 80 ? '#f00' : 
                   Math.abs(wheel.percentage) > 50 ? '#ff0' : '#0f0';
      
      wheelDiv.innerHTML = `
        <div>${wheel.name}: ${wheel.percentage}%</div>
        <div class="momentum-bar-container">
          <div class="momentum-bar" style="width: ${Math.abs(wheel.percentage)}%; background-color: ${color}"></div>
        </div>
      `;
      
      uiElements.rwList.appendChild(wheelDiv);
    });
  }
  
  // Update CMG status
  if (status.mode === 'cmgs' && status.cmgs) {
    uiElements.reactionWheelStatus.style.display = 'none';
    uiElements.cmgStatus.style.display = 'block';
    
    uiElements.cmgList.innerHTML = '';
    
    status.cmgs.forEach(cmg => {
      const cmgDiv = document.createElement('div');
      cmgDiv.style.fontSize = '9px';
      cmgDiv.style.marginTop = '2px';
      
      const color = cmg.percentage > 80 ? '#f00' : 
                   cmg.percentage > 50 ? '#ff0' : '#0f0';
      
      cmgDiv.innerHTML = `
        <div>${cmg.name}: ${cmg.percentage}%</div>
        <div class="momentum-bar-container">
          <div class="momentum-bar" style="width: ${cmg.percentage}%; background-color: ${color}"></div>
        </div>
        <div style="font-size: 8px; margin-top: 1px;">
          H: X:${cmg.momentumX?.toFixed(1) || 0} Y:${cmg.momentumY?.toFixed(1) || 0} Z:${cmg.momentumZ?.toFixed(1) || 0}
        </div>
      `;
      
      uiElements.cmgList.appendChild(cmgDiv);
    });
  }
}

/**
 * Updates the lamp status display.
 * @param {object} lampManager - The lamp manager object
 */
function updateLampStatus(lampManager) {
  if (!uiElements.lampCount) return;
  
  if (lampManager && lampManager.lights.length > 0) {
    uiElements.lampCount.textContent = lampManager.lights.length;
  } else {
    uiElements.lampCount.textContent = '0';
  }
}

/**
 * Updates the docking information display.
 * @param {boolean} isDocked - Whether the spacecraft is docked
 * @param {object} dockingStatus - Object containing docking status information
 */
function updateDockingInfo(isDocked, dockingStatus) {
  if (!dockingStatus) return;
  
  // Update docking status text
  if (isDocked) {
    uiElements.dockingStatus.textContent = 'DOCKED';
    uiElements.dockingStatus.style.color = '#0ff';
  } else {
    uiElements.dockingStatus.textContent = 'NOT DOCKED';
    uiElements.dockingStatus.style.color = '#ff0';
  }
  
  // Update docking metrics
  uiElements.dockDistance.textContent = dockingStatus.distance.toFixed(10);
  uiElements.angularDiff.textContent = dockingStatus.angleDiff.toFixed(2);
  uiElements.dockingSpeed.textContent = dockingStatus.speed.toFixed(3);
  uiElements.dockingAngularSpeed.textContent = dockingStatus.angularSpeed.toFixed(3);
}

/**
 * Calculates distances to walls and updates the display.
 * @param {THREE.Object3D} station - The station model
 * @param {THREE.Object3D} satMesh - The satellite mesh
 * @param {THREE.Raycaster} raycaster - The raycaster for distance calculations
 * @param {number} maxDistance - Maximum distance to check
 */
function calculateDistancesToWalls(station, satMesh, raycaster, maxDistance) {
  if (!station || !satMesh || !uiElements.distInfo) return;
  
  // Get satellite position in world space
  const satPosition = new THREE.Vector3();
  satMesh.getWorldPosition(satPosition);
  
  // Get satellite rotation in world space
  const satRotation = new THREE.Quaternion();
  satMesh.getWorldQuaternion(satRotation);
  
  // Create an array to store all intersectable objects
  const intersectableObjects = [];
  
  // Add station and its children to intersectable objects
  if (station) {
    station.traverse((child) => {
      if (child.isMesh) {
        intersectableObjects.push(child);
      }
    });
  }
  
  // Check distances along each axis (positive and negative)
  const axes = [
    { name: 'x-pos', direction: new THREE.Vector3(1, 0, 0) },
    { name: 'x-neg', direction: new THREE.Vector3(-1, 0, 0) },
    { name: 'y-pos', direction: new THREE.Vector3(0, 1, 0) },
    { name: 'y-neg', direction: new THREE.Vector3(0, -1, 0) },
    { name: 'z-pos', direction: new THREE.Vector3(0, 0, 1) },
    { name: 'z-neg', direction: new THREE.Vector3(0, 0, -1) }
  ];
  
  axes.forEach(axis => {
    // Transform direction to world space
    const worldDirection = axis.direction.clone().applyQuaternion(satRotation);
    
    // Set up raycaster
    raycaster.set(satPosition, worldDirection);
    raycaster.far = maxDistance;
    
    // Check for intersections
    const intersects = raycaster.intersectObjects(intersectableObjects, true);
    
    if (intersects.length > 0) {
      // Get the closest intersection
      const closestIntersection = intersects[0];
      const distance = closestIntersection.distance;
      
      // Update the UI
      if (uiElements.distElements[axis.name]) {
        uiElements.distElements[axis.name].textContent = 
          distance < maxDistance ? distance.toFixed(2) + ' m' : '--';
      }
    } else {
      // No intersection within max distance
      if (uiElements.distElements[axis.name]) {
        uiElements.distElements[axis.name].textContent = '--';
      }
    }
  });
}

// Toggle paused overlay visibility
function togglePausedOverlay(isPaused) {
  const overlay = document.getElementById('paused-overlay');
  if (overlay) {
    overlay.style.display = isPaused ? 'flex' : 'none';
  }
}

// Export a single function to toggle UI visibility
export function toggleUIVisibility(elementId, isVisible) {
  const element = document.getElementById(elementId);
  if (element) {
    element.style.display = isVisible ? 'block' : 'none';
  }
}

// Export a function to update UI text
export function updateUIText(elementId, text) {
  const element = document.getElementById(elementId);
  if (element) {
    element.textContent = text;
  }
}





