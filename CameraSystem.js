
//CameraSystem.js
// Import necessary Three.js modules
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// Camera System Class
export class CameraSystem {
    constructor(renderer, targetObject) {
        // Initialize camera
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.defaultFov = 75; // Store original FOV
        
        // Camera modes: 0: orbit, 1: selfie stick, 2+: first-person cameras
        this.cameraMode = 0;
        
        // Target object to follow
        this.targetObject = targetObject;
        
        // First-person camera configurations
        this.firstPersonCameras = [];
        
        // Initialize orbit controls
        this.controls = new OrbitControls(this.camera, renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.rotateSpeed = 0.5;
        this.controls.zoomSpeed = 1.0;
        this.controls.minDistance = 0.1;
        this.controls.maxDistance = 100;
        
        // Set initial camera position and target
        this.controls.target.set(-2.5, 0, 4.5);
        this.camera.position.set(-2.5, 0.5, 7.5);
        this.controls.update();
        
        // Store initial camera offset relative to target
        this.cameraOffset = new THREE.Vector3().subVectors(this.camera.position, this.controls.target);
        
        // Track previous target position for smooth following
        this.previousTarget = this.controls.target.clone();
        
        // Manual mouse handling for selfie mode
        this.isDragging = false;
        this.mouseDownX = 0;
        this.mouseDownY = 0;
        
        // Setup event listeners
        this.setupEventListeners(renderer);
        
        // Setup window resize handler
        window.addEventListener('resize', this.handleResize.bind(this));
        
        // Load camera configurations - now using the new method
        this.initializeCameras();
    }
    
    // New method to initialize cameras (checks for uploaded files first)
    async initializeCameras() {
        // Check if there's an uploaded camera configuration
        if (window.uploadedFiles && window.uploadedFiles.config && window.uploadedFiles.config.cameras) {
            console.log('Using uploaded camera configuration');
            // Pass the cameras array directly
            this.loadCamerasWithConfig(window.uploadedFiles.config.cameras);
        } else {
            // Fall back to loading from file
            console.log('Loading camera configuration from file');
            await this.loadCameraConfigurations();
        }
    }
    
    loadCameraConfigurations() {
        // Hardcoded filename as requested
        const filename = 'cameras.json';
        
        fetch(filename)
            .then(response => {
                if (!response.ok) {
                    throw new Error(`Failed to load camera configurations: ${response.status}`);
                }
                return response.json();
            })
            .then(data => {
                // Check if data is an array (direct cameras) or an object with cameras property
                if (Array.isArray(data)) {
                    this.processCameraConfig(data);
                } else if (data && data.cameras) {
                    this.processCameraConfig(data.cameras);
                } else {
                    console.warn('Invalid camera configuration format, using default');
                    this.processCameraConfig([{
                        name: "Default",
                        position: { x: 0, y: 0, z: 0 },
                        rotation: { x: 0, "y": Math.PI, "z": 0 },
                        "fov": 75
                    }]);
                }
                console.log(`Loaded ${this.firstPersonCameras.length} camera configurations`);
            })
            .catch(error => {
                console.error('Error loading camera configurations:', error);
                // Fallback to default camera if loading fails
                this.processCameraConfig([{
                    name: "Default",
                    position: { x: 0, y: 0, z: 0 },
                    rotation: { x: 0, "y": Math.PI, "z": 0 },
                    "fov": 75
                }]);
            });
    }
    
    // New function to load cameras from a configuration object
    loadCamerasWithConfig(cameraConfig) {
        // Check if cameraConfig is an array (direct cameras) or an object with cameras property
        if (Array.isArray(cameraConfig)) {
            this.processCameraConfig(cameraConfig);
        } else if (cameraConfig && cameraConfig.cameras) {
            this.processCameraConfig(cameraConfig.cameras);
        } else {
            console.warn('Invalid camera configuration format, using default');
            this.processCameraConfig([{
                name: "Default",
                position: { x: 0, y: 0, z: 0 },
                rotation: { x: 0, "y": Math.PI, "z": 0 },
                "fov": 75
            }]);
        }
        console.log(`Loaded ${this.firstPersonCameras.length} camera configurations from config`);
    }
    
    // Common function to process camera configuration
    processCameraConfig(data) {
        // Ensure data is an array
        if (Array.isArray(data)) {
            this.firstPersonCameras = data;
        } else {
            console.warn('Camera configuration data is not an array');
            this.firstPersonCameras = [];
        }
    }
    
    setupEventListeners(renderer) {
        renderer.domElement.addEventListener('mousedown', this.onMouseDown.bind(this));
        renderer.domElement.addEventListener('mouseup', this.onMouseUp.bind(this));
        renderer.domElement.addEventListener('mousemove', this.onMouseMove.bind(this));
        renderer.domElement.addEventListener('wheel', this.onWheel.bind(this), { passive: false });
    }
    
    onMouseDown(e) {
        if (this.cameraMode !== 1) return;
        this.isDragging = true;
        this.mouseDownX = e.clientX;
        this.mouseDownY = e.clientY;
    }
    
    onMouseUp(e) {
        if (this.cameraMode !== 1) return;
        this.isDragging = false;
    }
    
    onMouseMove(e) {
        if (this.cameraMode !== 1 || !this.isDragging) return;
        const deltaX = e.clientX - this.mouseDownX;
        const deltaY = e.clientY - this.mouseDownY;
        const spherical = this.controls._spherical;
        spherical.theta -= (2 * Math.PI * deltaX / window.innerWidth) * this.controls.rotateSpeed;
        spherical.phi += (2 * Math.PI * deltaY / window.innerHeight) * this.controls.rotateSpeed;
        spherical.phi = Math.max(0.0001, Math.min(Math.PI - 0.0001, spherical.phi));
        this.mouseDownX = e.clientX;
        this.mouseDownY = e.clientY;
    }
    
    onWheel(e) {
        if (this.cameraMode !== 1) return;
        e.preventDefault();
        const scale = e.deltaY / 100.0 * this.controls.zoomSpeed;
        this.controls._spherical.radius *= (1 + scale);
        this.controls._spherical.radius = Math.max(this.controls.minDistance, Math.min(this.controls.maxDistance, this.controls._spherical.radius));
    }
    
    handleResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
    }
    
    setSphericalFromVector(vec) {
        const radius = vec.length();
        if (radius === 0) return;
        const v = vec.clone().normalize();
        const phi = Math.acos(THREE.MathUtils.clamp(v.y, -1, 1));
        const theta = Math.atan2(v.z, v.x);
        this.controls._spherical.radius = radius;
        this.controls._spherical.phi = phi;
        this.controls._spherical.theta = theta;
    }
    
    switchCameraMode() {
        const oldMode = this.cameraMode;
        const totalModes = 2 + this.firstPersonCameras.length; // 2 for orbit and selfie stick + N for first-person cameras
        
        // Cycle through all modes
        this.cameraMode = (this.cameraMode + 1) % totalModes;

        // If we looped back to orbit mode, reset FOV
        if (oldMode === totalModes - 1 && this.cameraMode === 0) {
            this.camera.fov = this.defaultFov;
            this.camera.updateProjectionMatrix();
        }
        
        this.controls.enabled = (this.cameraMode === 0); // Only enable controls for orbit mode
        
        if (this.cameraMode === 0) {
            // Orbit mode
            this.controls.target.copy(this.targetObject.position);
            this.previousTarget.copy(this.targetObject.position);
            let initOffset;
            if (oldMode > 1) { // Coming from a first-person camera
                initOffset = this.cameraOffset.clone();
            } else {
                initOffset = this.camera.position.clone().sub(this.targetObject.position);
            }
            this.camera.position.copy(this.targetObject.position).add(initOffset);
            this.controls.update();
        } else if (this.cameraMode === 1) {
            // Selfie stick mode
            this.controls.enabled = false;
            this.controls.target.copy(this.targetObject.position);
            this.previousTarget.copy(this.targetObject.position);
            let initOffset;
            if (oldMode > 1) { // Coming from a first-person camera
                initOffset = this.cameraOffset.clone();
            } else {
                initOffset = this.camera.position.clone().sub(this.targetObject.position);
            }
            const invQuat = this.targetObject.quaternion.clone().invert();
            const localInit = initOffset.clone().applyQuaternion(invQuat);
            this.setSphericalFromVector(localInit);
            
            // Manually set camera for immediate effect
            const spherical = this.controls._spherical;
            const radius = spherical.radius;
            const phi = spherical.phi;
            const theta = spherical.theta;
            const sinPhi = Math.sin(phi);
            const cosPhi = Math.cos(phi);
            const sinTheta = Math.sin(theta);
            const cosTheta = Math.cos(theta);
            const localOffset = new THREE.Vector3(radius * sinPhi * cosTheta, radius * cosPhi, radius * sinPhi * sinTheta);
            const worldOffset = localOffset.clone().applyQuaternion(this.targetObject.quaternion);
            const idealPos = this.targetObject.position.clone().add(worldOffset);
            const worldUp = new THREE.Vector3(0, 1, 0).applyQuaternion(this.targetObject.quaternion).normalize();
            const idealMat = new THREE.Matrix4().lookAt(idealPos, this.targetObject.position, worldUp);
            const idealQuat = new THREE.Quaternion().setFromRotationMatrix(idealMat);
            this.camera.position.copy(idealPos);
            this.camera.quaternion.copy(idealQuat);
        } else if (this.cameraMode > 1) {
            // First-person camera modes
            const cameraIndex = this.cameraMode - 2;
            if (cameraIndex < this.firstPersonCameras.length) {
                console.log(`Switched to camera: ${this.firstPersonCameras[cameraIndex].name}`);
            }
        }
    }
    
    update() {
        if (this.cameraMode === 0) {
            // Orbit camera around target
            const delta = new THREE.Vector3().subVectors(this.targetObject.position, this.previousTarget);
            this.camera.position.add(delta);
            this.controls.target.copy(this.targetObject.position);
            this.previousTarget.copy(this.targetObject.position);
            this.controls.update();
        } else if (this.cameraMode === 1) {
            // Selfie stick: orbit relative to target's local frame with damping inertia
            const spherical = this.controls._spherical;
            const radius = spherical.radius;
            const phi = spherical.phi;
            const theta = spherical.theta;
            const sinPhi = Math.sin(phi);
            const cosPhi = Math.cos(phi);
            const sinTheta = Math.sin(theta);
            const cosTheta = Math.cos(theta);
            const localOffset = new THREE.Vector3(radius * sinPhi * cosTheta, radius * cosPhi, radius * sinPhi * sinTheta);
            const worldOffset = localOffset.clone().applyQuaternion(this.targetObject.quaternion);
            const idealPos = this.targetObject.position.clone().add(worldOffset);
            const worldUp = new THREE.Vector3(0, 1, 0).applyQuaternion(this.targetObject.quaternion).normalize();
            const idealMat = new THREE.Matrix4().lookAt(idealPos, this.targetObject.position, worldUp);
            const idealQuat = new THREE.Quaternion().setFromRotationMatrix(idealMat);
            if (this.controls.enableDamping) {
                this.camera.position.lerp(idealPos, this.controls.dampingFactor);
                this.camera.quaternion.slerp(idealQuat, this.controls.dampingFactor);
            } else {
                this.camera.position.copy(idealPos);
                this.camera.quaternion.copy(idealQuat);
            }
        } else if (this.cameraMode > 1) {
            // First-person (mounted on target, using current camera configuration)
            const cameraIndex = this.cameraMode - 2;
            if (cameraIndex < this.firstPersonCameras.length) {
                const currentCamera = this.firstPersonCameras[cameraIndex];
                
                // Adjust local position by centerOfMass offset
                const centerOfMassOffset = this.targetObject.userData?.centerOfMassOffset || {x: 0, y: 0, z: 0};
                
                // Set camera position relative to target (convert strings to numbers, adjust for centerOfMass)
                const localPosition = new THREE.Vector3(
                    parseFloat(currentCamera.position.x) - (centerOfMassOffset.x || 0),
                    parseFloat(currentCamera.position.y) - (centerOfMassOffset.y || 0),
                    parseFloat(currentCamera.position.z) - (centerOfMassOffset.z || 0)
                );
                const worldPosition = localPosition.applyQuaternion(this.targetObject.quaternion);
                this.camera.position.copy(this.targetObject.position).add(worldPosition);
                
                // Set camera rotation (convert strings to numbers)
                const localRotation = new THREE.Euler(
                    parseFloat(currentCamera.rotation.x),
                    parseFloat(currentCamera.rotation.y),
                    parseFloat(currentCamera.rotation.z)
                );
                const localQuaternion = new THREE.Quaternion().setFromEuler(localRotation);
                const worldQuaternion = this.targetObject.quaternion.clone().multiply(localQuaternion);
                this.camera.quaternion.copy(worldQuaternion);
                
                // Set field of view if specified (convert strings to numbers)
                if (currentCamera.fov !== undefined) {
                    this.camera.fov = parseFloat(currentCamera.fov);
                    this.camera.updateProjectionMatrix();
                }
            }
        }
    }
    
    reset() {
        this.cameraMode = 0;
        this.controls.target.set(-2.5, 0, 4.5);
        this.camera.position.copy(this.controls.target.clone().add(this.cameraOffset));
        this.previousTarget.copy(this.controls.target);
        this.controls.update();
    }
    
    getCamera() {
        return this.camera;
    }
    
    getCameraMode() {
        if (this.cameraMode === 0) {
            return "Orbit";
        } else if (this.cameraMode === 1) {
            return "Selfie Stick";
        } else if (this.cameraMode > 1) {
            const cameraIndex = this.cameraMode - 2;
            if (cameraIndex < this.firstPersonCameras.length) {
                return this.firstPersonCameras[cameraIndex].name;
            }
        }
        return "Unknown";
    }
}
