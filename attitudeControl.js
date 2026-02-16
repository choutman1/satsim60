
// attitudeControl.js
import * as THREE from 'three';
import * as CANNON from 'cannon-es';

// Attitude control system manager
class AttitudeControlSystem {
    constructor(satBody, scene) {
        this.satBody = satBody;
        this.scene = scene;
        this.mode = 'thrusters'; // 'thrusters', 'reactionwheels', or 'cmgs'
        this.reactionWheels = [];
        this.cmgs = [];
        this.loaded = false;
        this.desaturationActive = false;
        this.centerOfMassOffset = {x: 0, y: 0, z: 0};
    }

    // Method to set center of mass offset and update existing reaction wheels
    setCenterOfMassOffset(offset) {
        this.centerOfMassOffset = {
            x: offset.x || 0,
            y: offset.y || 0,
            z: offset.z || 0
        };
        // Update existing reaction wheels positions
        this.reactionWheels.forEach(wheel => {
            wheel.position.x -= this.centerOfMassOffset.x;
            wheel.position.y -= this.centerOfMassOffset.y;
            wheel.position.z -= this.centerOfMassOffset.z;
        });
    }

    // Dummy method to maintain compatibility with existing code
    setSatelliteMesh(satMesh) {
        // No visualization code needed since we've removed all visuals
    }

    async initialize() {
        try {
            await this.loadReactionWheels();
            console.log('Reaction wheels loaded successfully');
        } catch (error) {
            console.warn('Failed to load reaction wheels:', error);
        }

        try {
            await this.loadCMGs();
            console.log('CMGs loaded successfully');
        } catch (error) {
            console.warn('Failed to load CMGs:', error);
        }

        this.loaded = this.reactionWheels.length > 0 || this.cmgs.length > 0;
        return this.loaded;
    }

    // New function to initialize with configuration objects
    async initializeWithConfigs(reactionWheelsConfig, cmgConfig) {
        try {
            if (reactionWheelsConfig) {
                this.processReactionWheelsConfig(reactionWheelsConfig);
                console.log('Reaction wheels loaded successfully from config');
            }
        } catch (error) {
            console.warn('Failed to load reaction wheels from config:', error);
        }

        try {
            if (cmgConfig) {
                this.processCMGsConfig(cmgConfig);
                console.log('CMGs loaded successfully from config');
            }
        } catch (error) {
            console.warn('Failed to load CMGs from config:', error);
        }

        this.loaded = this.reactionWheels.length > 0 || this.cmgs.length > 0;
        return this.loaded;
    }

    async loadReactionWheels() {
        const response = await fetch('reactionwheels.json');
        if (!response.ok) throw new Error('Reaction wheels file not found');
        
        const data = await response.json();
        this.processReactionWheelsConfig(data);
    }

    processReactionWheelsConfig(data) {
        data.wheels.forEach((wheelConfig, index) => {
            const rawOrientation = new CANNON.Vec3(
                parseFloat(wheelConfig.orientation?.x) ?? 0,
                parseFloat(wheelConfig.orientation?.y) ?? 0,
                parseFloat(wheelConfig.orientation?.z) ?? 1
            );
            const normalizedOrientation = rawOrientation.unit();

            const wheel = {
                index: index,
                name: wheelConfig.name || `RW${index}`,
                orientation: normalizedOrientation,
                position: new CANNON.Vec3(
                    parseFloat(wheelConfig.position?.x ?? 0) - (this.centerOfMassOffset?.x || 0),
                    parseFloat(wheelConfig.position?.y ?? 0) - (this.centerOfMassOffset?.y || 0),
                    parseFloat(wheelConfig.position?.z ?? 0) - (this.centerOfMassOffset?.z || 0)
                ),
                maxAngularMomentum: parseFloat(wheelConfig.maxAngularMomentum) ?? 10,
                maxTorque: parseFloat(wheelConfig.maxTorque) ?? 0.5,
                currentAngularMomentum: 0
            };
            
            this.reactionWheels.push(wheel);
        });
    }

    async loadCMGs() {
        const response = await fetch('cmg.json');
        if (!response.ok) throw new Error('CMG file not found');
        
        const data = await response.json();
        this.processCMGsConfig(data);
    }

    processCMGsConfig(data) {
        // Check if CMG configuration exists
        // data can be either { cmgs: [...] } or { cmg: { cmgs: [...] } }
        const cmgsArray = data.cmgs || (data.cmg && data.cmg.cmgs);
        
        if (!cmgsArray || cmgsArray.length === 0) {
            console.log('No CMG configuration found, CMG system not initialized');
            return;
        }
        
        // New CMG format: array of CMGs, each with its own properties
        cmgsArray.forEach((cmgConfig, index) => {
            const cmg = {
                index: index,
                name: cmgConfig.name || `CMG${index}`,
                maxAngularMomentum: parseFloat(cmgConfig.maxAngularMomentum) ?? 200,
                maxTorque: parseFloat(cmgConfig.maxTorque) ?? 5,
                currentAngularMomentum: new CANNON.Vec3(0, 0, 0)
            };
            
            this.cmgs.push(cmg);
        });
    }

    toggleMode() {
        if (!this.loaded) {
            console.warn('No attitude control systems loaded');
            return 'thrusters';
        }
        
        if (this.mode === 'thrusters') {
            this.mode = 'reactionwheels';
        } else if (this.mode === 'reactionwheels' && this.cmgs.length > 0) {
            this.mode = 'cmgs';
        } else {
            this.mode = 'thrusters';
        }
        
        return this.mode;
    }

    applyControlTorque(torque) {
        if (this.mode === 'reactionwheels') {
            this.applyReactionWheelControl(torque);
        } else if (this.mode === 'cmgs') {
            this.applyCMGControl(torque);
        }
    }

    applyReactionWheelControl(torque) {
        // Apply torque using reaction wheels
        this.reactionWheels.forEach(wheel => {
            const wheelAxis = wheel.orientation;
            const requestedTorqueAlongWheel = wheelAxis.dot(torque);

            // Determine how much torque wheel can actually apply before saturating
            let actualTorqueApplied = 0;
            const dt = 1/60; // Time step

            if (requestedTorqueAlongWheel > 0) {
                // Requesting positive torque, check against max momentum
                const momentumCapacity = wheel.maxAngularMomentum - wheel.currentAngularMomentum;
                const maxPossibleTorque = momentumCapacity / dt;
                actualTorqueApplied = Math.min(requestedTorqueAlongWheel, maxPossibleTorque);
            } else if (requestedTorqueAlongWheel < 0) {
                // Requesting negative torque, check against min momentum
                const momentumCapacity = wheel.currentAngularMomentum - (-wheel.maxAngularMomentum);
                const maxPossibleTorque = momentumCapacity / dt;
                actualTorqueApplied = Math.max(requestedTorqueAlongWheel, -maxPossibleTorque);
            }

            // Update wheel's angular momentum based on ACTUAL torque applied
            const deltaMomentum = actualTorqueApplied * dt;
            wheel.currentAngularMomentum += deltaMomentum;
            
            // Apply reaction torque to satellite (opposite to ACTUAL torque applied to wheel)
            const reactionTorque = wheelAxis.scale(-actualTorqueApplied);

            // Convert local torque to world coordinates correctly
            const worldTorque = new CANNON.Vec3();
            this.satBody.quaternion.vmult(reactionTorque, worldTorque);
            this.satBody.applyTorque(worldTorque);
        });
    }

    applyCMGControl(torque) {
        const dt = 1/60; // Physics timestep
        const desiredLocalTorque = torque;
        
        // Check if CMGs exist
        if (this.cmgs.length === 0) return;

        // Apply torque to each CMG
        this.cmgs.forEach(cmg => {
            // Calculate current total angular momentum magnitude
            const currentMomentumMag = cmg.currentAngularMomentum.length();
            
            // Limit torque based on available momentum capacity (magnitude-based, not per-axis)
            let actualTorque = new CANNON.Vec3(desiredLocalTorque.x, desiredLocalTorque.y, desiredLocalTorque.z);
            
            // Calculate the momentum change that would result from applying full torque
            // Note: deltaMomentum = -torque * dt (momentum is stored opposite to torque on spacecraft)
            const desiredDeltaMomentum = actualTorque.scale(dt * -1);
            const desiredDeltaMomentumMag = desiredDeltaMomentum.length();
            
            // Check if torque would increase or decrease momentum magnitude
            const dotProduct = cmg.currentAngularMomentum.dot(desiredDeltaMomentum);
            
            // If torque would increase momentum (dot product > 0) and we're at max, scale it down
            if (dotProduct > 0 && currentMomentumMag >= cmg.maxAngularMomentum) {
                // Calculate how much momentum we can add
                const availableMomentum = cmg.maxAngularMomentum - currentMomentumMag;
                // Scale torque so we don't exceed max momentum
                const scaleFactor = availableMomentum / (dotProduct);
                actualTorque.scale(scaleFactor, actualTorque);
            }
            
            // Also clamp to max torque limit
            const actualTorqueMag = actualTorque.length();
            if (actualTorqueMag > cmg.maxTorque) {
                actualTorque.scale(cmg.maxTorque / actualTorqueMag, actualTorque);
            }
            
            // Update CMG angular momentum (opposite to torque applied to spacecraft)
            const deltaMomentum = actualTorque.scale(dt * -1);
            cmg.currentAngularMomentum.vadd(deltaMomentum, cmg.currentAngularMomentum);
            
            // Apply torque to satellite body
            const worldTorque = new CANNON.Vec3();
            this.satBody.quaternion.vmult(actualTorque, worldTorque);
            this.satBody.applyTorque(worldTorque);
        });
    }

    desaturateWithThrusters(thrusters, keyToThrusterIndices) {
        if (this.mode === 'reactionwheels') {
            this.desaturationActive = true;
            
            let totalMomentum = new CANNON.Vec3(0, 0, 0);
            this.reactionWheels.forEach(wheel => {
                const momentum = wheel.orientation.scale(wheel.currentAngularMomentum);
                totalMomentum.vadd(momentum, totalMomentum);
            });
            
            if (totalMomentum.length() > 0.1) {
                const thrustDirection = totalMomentum.unit().scale(-1);
                
                thrusters.forEach((thruster, index) => {
                    const torqueDirection = thruster.pos.cross(thruster.dir);
                    const alignment = torqueDirection.dot(thrustDirection);
                    
                    if (alignment > 0.5) {
                        const force = thruster.dir.scale(thruster.thrust * 0.5);
                        this.satBody.applyLocalForce(force, thruster.pos);
                        
                        this.reactionWheels.forEach(wheel => {
                            const reduction = wheel.orientation.scale(alignment * 0.01);
                            const newMomentum = wheel.currentAngularMomentum - reduction.length();
                            wheel.currentAngularMomentum = Math.max(
                                -wheel.maxAngularMomentum,
                                Math.min(wheel.maxAngularMomentum, newMomentum)
                            );
                        });
                    }
                });
            }
            
            let maxMomentum = 0;
            this.reactionWheels.forEach(wheel => {
                maxMomentum = Math.max(maxMomentum, Math.abs(wheel.currentAngularMomentum));
            });
            
            if (maxMomentum < 0.5) {
                this.desaturationActive = false;
            }
        } else if (this.mode === 'cmgs') {
            this.desaturationActive = true;
            
            // Calculate total momentum across all CMGs
            let totalMomentum = new CANNON.Vec3(0, 0, 0);
            this.cmgs.forEach(cmg => {
                totalMomentum.vadd(cmg.currentAngularMomentum, totalMomentum);
            });
            
            const totalMomentumMag = totalMomentum.length();
            
            // If total momentum is above threshold, use thrusters to desaturate all CMGs
            if (totalMomentumMag > 10) {  // Threshold for desaturation
                const momentumDir = totalMomentum.unit().scale(-1);
                
                thrusters.forEach((thruster, index) => {
                    const torqueDirection = thruster.pos.cross(thruster.dir);
                    const alignment = torqueDirection.dot(momentumDir);
                    
                    if (alignment > 0.5) {
                        const force = thruster.dir.scale(thruster.thrust * 0.3);
                        this.satBody.applyLocalForce(force, thruster.pos);
                        
                        // Reduce all CMGs' momentum
                        const reductionFactor = 0.02;
                        this.cmgs.forEach(cmg => {
                            const reduction = momentumDir.scale(reductionFactor);
                            cmg.currentAngularMomentum.vsub(reduction, cmg.currentAngularMomentum);
                        });
                    }
                });
            }
            
            // Recalculate total momentum
            totalMomentum = new CANNON.Vec3(0, 0, 0);
            this.cmgs.forEach(cmg => {
                totalMomentum.vadd(cmg.currentAngularMomentum, totalMomentum);
            });
            
            if (totalMomentum.length() < 5) {
                this.desaturationActive = false;
            }
        }
    }

    getStatus() {
        const status = {
            mode: this.mode,
            loaded: this.loaded,
            desaturationActive: this.desaturationActive
        };
        
        if (this.mode === 'reactionwheels' && this.reactionWheels.length > 0) {
            status.reactionWheels = this.reactionWheels.map(wheel => ({
                name: wheel.name,
                momentum: wheel.currentAngularMomentum,
                maxMomentum: wheel.maxAngularMomentum,
                percentage: (wheel.currentAngularMomentum / wheel.maxAngularMomentum * 100).toFixed(1)
            }));
        } else if (this.mode === 'cmgs' && this.cmgs.length > 0) {
            // Handle multiple CMGs
            status.cmgs = this.cmgs.map(cmg => {
                const momentumMag = cmg.currentAngularMomentum.length();
                return {
                    name: cmg.name,
                    momentum: momentumMag,
                    maxMomentum: cmg.maxAngularMomentum,
                    momentumX: cmg.currentAngularMomentum.x,
                    momentumY: cmg.currentAngularMomentum.y,
                    momentumZ: cmg.currentAngularMomentum.z,
                    percentage: (momentumMag / cmg.maxAngularMomentum * 100).toFixed(1)
                };
            });
        }
        
        return status;
    }
}

export { AttitudeControlSystem };
