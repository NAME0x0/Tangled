import WindowManager from './WindowManager.js'
import {createPointsMaterial, createTetherMaterial} from './GPU_Particles/materials.js'
import GPUComputationRenderer from './GPU_Particles/GPUComputationRenderer.js'
import {createPosTargetShader, createAccShader, createVelShader, createPosShader} from './GPU_Particles/computeShaders.js'

const t = THREE;
let camera, scene, renderer, world;
let near, far;
let pixR = window.devicePixelRatio ? window.devicePixelRatio : 1;
let particleSystems = [];
let sceneOffsetTarget = {x: 0, y: 0};
let sceneOffset = {x: 0, y: 0};

// GPU computation variables
const MAX_PARTICLES_PER_SYSTEM = 1000000; // Maximum particles per system
let PARTICLES_PER_SYSTEM = MAX_PARTICLES_PER_SYSTEM; // Dynamically adjusted
const TEXTURE_WIDTH = Math.ceil(Math.sqrt(MAX_PARTICLES_PER_SYSTEM));
const TEXTURE_HEIGHT = TEXTURE_WIDTH;
let gpuComputers = [];

// Window interaction variables
let tethers = []; // Visual connections between windows
const MAX_EXTERNAL_BLACK_HOLES = 8; // Maximum external black holes to consider
let externalBlackHolePositions = [];
let externalBlackHoleMasses = [];

// Particle system settings
const SPHERE_RADIUS = 80; // Base radius for particle systems
const LOADING_INTERVAL = 100; // Load particles in batches
const BLACK_HOLE_MASS = 45; // Base black hole mass

let today = new Date();
today.setHours(0);
today.setMinutes(0);
today.setSeconds(0);
today.setMilliseconds(0);
today = today.getTime();

let internalTime = getTime();
let windowManager;
let initialized = false;
let needsParticleUpdate = false;
let isLoadingParticles = false;

// get time in seconds since beginning of the day (so that all windows use the same time)
function getTime() {
    return (new Date().getTime() - today) / 1000.0;
}

if (new URLSearchParams(window.location.search).get("clear")) {
    localStorage.clear();
} else {    
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState != 'hidden' && !initialized) {
            init();
        }
    });

    window.onload = () => {
        if (document.visibilityState != 'hidden') {
            init();
            setupUI();
        }
    };

    // Simplify setupUI function to only handle the new window button
    function setupUI() {
        // Only setup the new window button
        const newWindowBtn = document.getElementById('newWindowBtn');
        if (newWindowBtn) {
            newWindowBtn.addEventListener('click', () => {
                // Calculate a position offset from the current window
                const offsetX = Math.floor(Math.random() * 300) - 150;
                const offsetY = Math.floor(Math.random() * 300) - 150;
                
                // Open a new window with the same URL (no parameters needed)
                const newWindow = window.open(
                    window.location.href, 
                    '_blank',
                    `width=${window.outerWidth},height=${window.outerHeight},left=${window.screenX + offsetX},top=${window.screenY + offsetY}`
                );
                
                // Focus the new window if browser allows
                if (newWindow) {
                    newWindow.focus();
                }
                
                // Add button press animation
                newWindowBtn.style.transform = 'scale(0.95)';
                setTimeout(() => {
                    newWindowBtn.style.transform = '';
                }, 150);
            });
        }
    }

    function init() {
        initialized = true;

        // add a short timeout because window.offsetX reports wrong values before a short period 
        setTimeout(() => {
            setupScene();
            setupWindowManager();
            resize();
            updateWindowShape(false);
            render();
            window.addEventListener('resize', resize);
        }, 500);
    }

    function setupScene() {
        // Setup orthographic camera - works better for cross-window positioning
        camera = new t.OrthographicCamera(0, window.innerWidth, 0, window.innerHeight, -10000, 10000);
        camera.position.z = 500;
        
        scene = new t.Scene();
        scene.background = new t.Color(0x000000);
        scene.add(camera);

        renderer = new t.WebGLRenderer({antialias: true, depthBuffer: true});
        renderer.setPixelRatio(pixR);
        
        world = new t.Object3D();
        scene.add(world);

        renderer.domElement.setAttribute("id", "scene");
        document.body.appendChild(renderer.domElement);
    }

    function setupWindowManager() {
        windowManager = new WindowManager();
        windowManager.setWinShapeChangeCallback(updateWindowShape);
        windowManager.setWinChangeCallback(windowsUpdated);

        // Custom metadata for each window
        let metaData = {
            createdAt: Date.now(),
            windowIndex: 0  // Will be set during update
        };

        // Init window manager
        windowManager.init(metaData);
        
        // Initial update
        windowsUpdated();
    }

    function windowsUpdated() {
        // Determine if we need to update particle systems
        const windowCount = windowManager.getWindowCount();
        
        // Scale down particles based on window count (with some minimum)
        const newParticleCount = Math.max(100000, Math.floor(MAX_PARTICLES_PER_SYSTEM / windowCount));
        
        // Only update if significant change (>10% difference)
        if (Math.abs(PARTICLES_PER_SYSTEM - newParticleCount) / PARTICLES_PER_SYSTEM > 0.1) {
            PARTICLES_PER_SYSTEM = newParticleCount;
            console.log(`Adjusted particles to ${PARTICLES_PER_SYSTEM} based on ${windowCount} windows`);
            needsParticleUpdate = true;
        }
        
        updateParticleSystems();
        updateTethers();
        updateExternalBlackHoles();
    }

    function updateTethers() {
        // Remove old tethers
        tethers.forEach(tether => {
            if (tether.line) {
                scene.remove(tether.line);
                if (tether.line.geometry) tether.line.geometry.dispose();
                if (tether.line.material) tether.line.material.dispose();
            }
        });
        tethers = [];
        
        // Get all windows and their positions
        const windows = windowManager.getWindows();
        const thisWindowId = windowManager.getThisWindowID();
        const thisWindowData = windowManager.getThisWindowData();
        
        if (!thisWindowData || !thisWindowData.shape) return;
        
        // Current window center
        const center = {
            x: thisWindowData.shape.x + thisWindowData.shape.w / 2,
            y: thisWindowData.shape.y + thisWindowData.shape.h / 2,
            z: 0
        };
        
        // For each other window, create a tether
        windows.forEach(win => {
            if (win.id === thisWindowId) return;
            
            // Calculate other window center
            const otherCenter = {
                x: win.shape.x + win.shape.w / 2,
                y: win.shape.y + win.shape.h / 2,
                z: 0
            };
            
            // Calculate distance for special effects
            const distance = Math.sqrt(
                Math.pow(otherCenter.x - center.x, 2) + 
                Math.pow(otherCenter.y - center.y, 2)
            );
            
            // Create curved path for more organic tether effect
            const curveFactor = Math.min(0.3, 100 / distance);
            const midPoint = new t.Vector3(
                (otherCenter.x - center.x) * 0.5,
                (otherCenter.y - center.y) * 0.5,
                (Math.random() - 0.5) * distance * curveFactor
            );
            
            // Create a curve path with slight arc
            const curve = new t.QuadraticBezierCurve3(
                new t.Vector3(0, 0, 0),
                midPoint,
                new t.Vector3(otherCenter.x - center.x, otherCenter.y - center.y, 0)
            );
            
            // Create geometry from curve with multiple points for smoother curve
            const points = curve.getPoints(20);
            const lineGeometry = new t.BufferGeometry().setFromPoints(points);
            
            // Create enhanced tether material
            const lineMaterial = createTetherMaterial();
            
            // Configure to show dashed pattern
            const line = new t.Line(lineGeometry, lineMaterial);
            line.computeLineDistances(); // Required for dashed lines
            scene.add(line);
            
            // Store the tether
            tethers.push({
                fromId: thisWindowId,
                toId: win.id,
                line,
                fromCenter: center,
                toCenter: otherCenter,
                lastUpdate: Date.now(),
                distance: distance
            });
        });
    }

    function updateExternalBlackHoles() {
        // Get positions of black holes from other windows
        const externalSystems = windowManager.getExternalParticleSystems();
        
        // Reset arrays
        externalBlackHolePositions = [];
        externalBlackHoleMasses = [];
        
        // Get the thisWindow center position for relative positioning
        const thisWindowData = windowManager.getThisWindowData();
        if (!thisWindowData || !thisWindowData.shape) return;
        
        const thisCenter = {
            x: thisWindowData.shape.x + thisWindowData.shape.w / 2,
            y: thisWindowData.shape.y + thisWindowData.shape.h / 2,
            z: 0
        };
        
        // Add external black holes (limit to MAX_EXTERNAL_BLACK_HOLES)
        let count = 0;
        for (const [id, data] of Object.entries(externalSystems)) {
            if (count >= MAX_EXTERNAL_BLACK_HOLES) break;
            
            if (data && data.blackHolePosition) {
                // Position relative to this window
                const relPos = {
                    x: data.blackHolePosition.x - thisCenter.x,
                    y: data.blackHolePosition.y - thisCenter.y,
                    z: data.blackHolePosition.z || 0
                };
                
                externalBlackHolePositions.push(new t.Vector3(relPos.x, relPos.y, relPos.z));
                
                // Decrease influence based on distance for stability
                const distance = Math.sqrt(relPos.x * relPos.x + relPos.y * relPos.y);
                const scaledMass = BLACK_HOLE_MASS * Math.min(1.0, 200 / Math.max(distance, 1));
                externalBlackHoleMasses.push(scaledMass);
                
                count++;
            }
        }
        
        // Update the current window's position in the particle system data
        windowManager.updateParticleSystem(thisCenter, PARTICLES_PER_SYSTEM);
    }

    // Setup GPU computation for a particle system
    function setupGpuComputation(index) {
        try {
            console.log(`Setting up GPU computation for system ${index} with ${PARTICLES_PER_SYSTEM} particles`);
            const gpu = new GPUComputationRenderer(TEXTURE_WIDTH, TEXTURE_HEIGHT, renderer);
            
            if (!gpu) {
                console.error("Failed to create GPUComputationRenderer");
                return null;
            }
            
            // Initialize textures with random data
            const posTargetTex = gpu.createTexture();
            initPositionTexture(posTargetTex, index);
            
            const accTex = gpu.createTexture();
            const velTex = gpu.createTexture();
            const posTex = gpu.createTexture();
            initPositionTexture(posTex, index); // Initialize position texture too
            
            // Add variables with the initialized textures
            const posTargetVar = gpu.addVariable('posTarget', createPosTargetShader(), posTargetTex);
            const accVar = gpu.addVariable('acc', createAccShader(), accTex);
            const velVar = gpu.addVariable('vel', createVelShader(), velTex);
            const posVar = gpu.addVariable('pos', createPosShader(), posTex);
            
            // Add critical uniforms
            const curTime = getTime();
            posTargetVar.material.uniforms.time = { value: curTime };
            posTargetVar.material.uniforms.radius = { value: SPHERE_RADIUS };
            
            accVar.material.uniforms.time = { value: curTime };
            accVar.material.uniforms.radius = { value: SPHERE_RADIUS };
            accVar.material.uniforms.blackHoleMass = { value: BLACK_HOLE_MASS };
            
            // External black holes uniforms
            accVar.material.uniforms.externalBlackHoleCount = { value: 0 };
            accVar.material.uniforms.externalBlackHoles = { value: [] };
            accVar.material.uniforms.externalMasses = { value: [] };
            
            velVar.material.uniforms.time = { value: curTime };
            
            posVar.material.uniforms.time = { value: curTime };
            posVar.material.uniforms.frame = { value: 0 };
            
            // Important: Set dependencies correctly
            gpu.setVariableDependencies(posTargetVar, [posTargetVar]);
            gpu.setVariableDependencies(accVar, [posTargetVar, posVar]);
            gpu.setVariableDependencies(velVar, [accVar, velVar, posVar]);
            gpu.setVariableDependencies(posVar, [velVar, posVar, posTargetVar]);
            
            // Check for errors
            const error = gpu.init();
            if (error !== null) {
                console.error(`GPU computation init error: ${error}`);
                return null;
            }
            
            return {
                gpu,
                variables: {
                    posTarget: posTargetVar,
                    acc: accVar,
                    vel: velVar,
                    pos: posVar
                }
            };
        } catch (e) {
            console.error("Error setting up GPU computation:", e);
            return null;
        }
    }

    function createParticleSystem(index, position, hue) {
        // Create geometry with positions for points
        const geometry = new t.BufferGeometry();
        const positions = new Float32Array(PARTICLES_PER_SYSTEM * 3);
        
        // Initialize positions randomly within a sphere
        const radius = SPHERE_RADIUS + index * 15;
        for (let i = 0; i < PARTICLES_PER_SYSTEM; i++) {
            const i3 = i * 3;
            // Random position inside sphere
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);
            const r = radius * Math.cbrt(Math.random());
            
            positions[i3] = r * Math.sin(phi) * Math.cos(theta);
            positions[i3 + 1] = r * Math.sin(phi) * Math.sin(theta);
            positions[i3 + 2] = r * Math.cos(phi);
        }
        
        geometry.setAttribute('position', new t.BufferAttribute(positions, 3));
        
        // Create basic particle material for initial rendering
        const initialMaterial = new t.PointsMaterial({
            size: 2,
            color: new t.Color().setHSL(hue, 0.7, 0.5),
            transparent: true,
            opacity: 0.6,
            blending: t.AdditiveBlending
        });
        
        const points = new t.Points(geometry, initialMaterial);
        points.position.copy(position);
        
        // Create actual system
        const system = {
            points,
            index,
            targetPosition: new t.Vector3().copy(position),
            radius,
            hue,
            isInitialized: false,
            frame: 0
        };
        
        // Asynchronously initialize GPU computation
        setTimeout(() => {
            initParticleComputation(system, position, hue);
        }, index * LOADING_INTERVAL);
        
        return system;
    }

    // Initialize GPU computation asynchronously
    function initParticleComputation(system, position, hue) {
        // Create GPU computation
        const computation = setupGpuComputation(system.index);
        if (!computation) {
            console.error("Failed to initialize GPU computation for system", system.index);
            return;
        }
        
        system.computation = computation;
        
        try {
            // Create shader material
            const material = createPointsMaterial(TEXTURE_WIDTH, TEXTURE_HEIGHT);
            
            // Ensure all uniform values are properly initialized
            material.uniforms.time = { value: getTime() };
            material.uniforms.hue = { value: hue };
            material.uniforms.radius = { value: system.radius };
            
            // Initialize texture references
            const gpu = computation.gpu;
            const vars = computation.variables;
            
            if (vars.posTarget) {
                material.uniforms.posTarget = { value: gpu.getCurrentRenderTarget(vars.posTarget).texture };
            }
            
            if (vars.acc) {
                material.uniforms.acc = { value: gpu.getCurrentRenderTarget(vars.acc).texture };
            }
            
            if (vars.vel) {
                material.uniforms.vel = { value: gpu.getCurrentRenderTarget(vars.vel).texture };
            }
            
            if (vars.pos) {
                material.uniforms.pos = { value: gpu.getCurrentRenderTarget(vars.pos).texture };
            }
            
            // Replace the material
            if (system.points.material) {
                system.points.material.dispose();
            }
            system.points.material = material;
            
            // Initialize the system and perform first compute
            system.isInitialized = true;
            system.frame = 0;
            
            // Do an initial compute to populate the textures
            gpu.compute();
            
            console.log(`Particle system ${system.index} initialized with GPU computation`);
        } catch (e) {
            console.error("Error initializing particle material:", e);
        }
    }

    function updateParticleSystems() {
        console.log("Updating particle systems with", PARTICLES_PER_SYSTEM, "particles per system");
        isLoadingParticles = true;
        
        // First, properly dispose of existing resources
        particleSystems.forEach(system => {
            world.remove(system.points);
            
            // Proper disposal of resources
            if (system.points) {
                if (system.points.geometry) system.points.geometry.dispose();
                if (system.points.material) {
                    if (system.points.material.map) system.points.material.map.dispose();
                    system.points.material.dispose();
                }
            }
            
            // Cleanup GPU computation resources if they exist
            if (system.computation && system.computation.gpu) {
                // GPU Computation Renderer doesn't have a direct dispose method,
                // but we can manually clean up its render targets
                const variables = system.computation.variables;
                if (variables) {
                    Object.values(variables).forEach(variable => {
                        if (variable.renderTargets) {
                            variable.renderTargets.forEach(rt => {
                                if (rt && rt.texture) rt.texture.dispose();
                                if (rt) rt.dispose();
                            });
                        }
                    });
                }
            }
        });
        
        particleSystems = [];
        gpuComputers = [];
        
        // Create new particle systems based on window positions
        const wins = windowManager.getWindows();
        
        try {
            for (let i = 0; i < wins.length; i++) {
                const win = wins[i];
                const position = new t.Vector3(
                    win.shape.x + (win.shape.w * 0.5),
                    win.shape.y + (win.shape.h * 0.5),
                    0
                );
                
                // Create hue based on window index
                const hue = i * 0.1;
                
                // Create particle system
                const system = createParticleSystem(i, position, hue);
                world.add(system.points);
                particleSystems.push(system);
            }
            
            needsParticleUpdate = false;
            
            // Allow update to work again after loading completes
            setTimeout(() => {
                isLoadingParticles = false;
                console.log("Particle systems updated successfully");
            }, wins.length * LOADING_INTERVAL + 200);
        } catch (error) {
            console.error("Error creating particle systems:", error);
            
            setTimeout(() => {
                isLoadingParticles = false;
            }, 200);
        }
    }

    function updateWindowShape(easing = true) {
        sceneOffsetTarget = {x: -window.screenX, y: -window.screenY};
        if (!easing) sceneOffset = sceneOffsetTarget;
    }

    function render() {
        const currentTime = getTime();
        
        windowManager.update();
        
        // Check if we need to update particle systems
        if (needsParticleUpdate) {
            updateParticleSystems();
        }
        
        // calculate the new position based on the delta between current offset and new offset
        let falloff = .05;
        sceneOffset.x = sceneOffset.x + ((sceneOffsetTarget.x - sceneOffset.x) * falloff);
        sceneOffset.y = sceneOffset.y + ((sceneOffsetTarget.y - sceneOffset.y) * falloff);
        
        // set the world position to the offset
        world.position.x = sceneOffset.x;
        world.position.y = sceneOffset.y;
        
        const wins = windowManager.getWindows();
        
        // Update particle systems - ensure this runs EVERY frame
        for (let i = 0; i < particleSystems.length && i < wins.length; i++) {
            const system = particleSystems[i];
            const win = wins[i];
            
            // Update target position
            system.targetPosition.x = win.shape.x + (win.shape.w * 0.5);
            system.targetPosition.y = win.shape.y + (win.shape.h * 0.5);
            
            // Move points with smooth easing
            system.points.position.x = system.points.position.x + (system.targetPosition.x - system.points.position.x) * falloff;
            system.points.position.y = system.points.position.y + (system.targetPosition.y - system.points.position.y) * falloff;
            
            // Add gentle rotation
            system.points.rotation.x = Math.sin(currentTime * 0.2) * 0.1;
            system.points.rotation.y = Math.cos(currentTime * 0.3) * 0.1;
            
            // Ensure all systems are visible
            system.points.visible = true;
            
            // Handle different types of systems
            if (system.computation && system.computation.gpu) {
                try {
                    const gpu = system.computation.gpu;
                    const vars = system.computation.variables;
                    
                    // Skip if GPU or variables are missing
                    if (!gpu || !vars) continue;
                    
                    // Update uniforms for shaders
                    if (vars.posTarget && vars.posTarget.material) {
                        vars.posTarget.material.uniforms.time.value = currentTime;
                    }
                    
                    if (vars.acc && vars.acc.material) {
                        vars.acc.material.uniforms.time.value = currentTime;
                        
                        // Update external black hole positions
                        if (externalBlackHolePositions.length > 0) {
                            vars.acc.material.uniforms.externalBlackHoleCount = { 
                                value: Math.min(externalBlackHolePositions.length, MAX_EXTERNAL_BLACK_HOLES) 
                            };
                            vars.acc.material.uniforms.externalBlackHoles = { 
                                value: externalBlackHolePositions 
                            };
                            vars.acc.material.uniforms.externalMasses = { 
                                value: externalBlackHoleMasses 
                            };
                        } else {
                            vars.acc.material.uniforms.externalBlackHoleCount = { value: 0 };
                        }
                    }
                    
                    if (vars.vel && vars.vel.material) {
                        vars.vel.material.uniforms.time.value = currentTime;
                    }
                    
                    if (vars.pos && vars.pos.material) {
                        vars.pos.material.uniforms.time.value = currentTime;
                        vars.pos.material.uniforms.frame.value = system.frame || 0;
                    }
                    
                    // Increment frame counter
                    system.frame = (system.frame || 0) + 1;
                    
                    // Always compute every frame
                    gpu.compute();
                    
                    // Update material uniforms with computed textures
                    const material = system.points.material;
                    if (material && material.uniforms) {
                        material.uniforms.time.value = currentTime;
                        
                        // Make sure textures are properly assigned
                        if (vars.posTarget) {
                            material.uniforms.posTarget.value = gpu.getCurrentRenderTarget(vars.posTarget).texture;
                        }
                        
                        if (vars.acc) {
                            material.uniforms.acc.value = gpu.getCurrentRenderTarget(vars.acc).texture;
                        }
                        
                        if (vars.vel) {
                            material.uniforms.vel.value = gpu.getCurrentRenderTarget(vars.vel).texture;
                        }
                        
                        if (vars.pos) {
                            material.uniforms.pos.value = gpu.getCurrentRenderTarget(vars.pos).texture;
                        }
                        
                        // Force material update
                        material.needsUpdate = true;
                    }
                } catch (e) {
                    console.error("Error updating GPU system:", e);
                }
            }
            // If the system is created but computation is not ready yet, do nothing
            else if (!system.isInitialized) {
                // System is still initializing
                console.log("Waiting for system", i, "to initialize");
            }
        }
        
        // Update tethers between windows with dynamic effects
        tethers.forEach(tether => {
            if (tether.line) {
                // Make the line pulse slightly based on time and distance
                const pulseFreq = 0.5 / (tether.distance * 0.001 + 1.0); // Faster pulse for closer windows
                const pulseIntensity = 0.2 + 0.15 * Math.sin(currentTime * pulseFreq);
                tether.line.material.opacity = 0.3 + pulseIntensity;
                
                // Dynamically adjust dash pattern based on activity
                const dashScale = 0.5 + 0.5 * Math.sin(currentTime * 0.3);
                tether.line.material.dashSize = 3 + dashScale;
                tether.line.material.gapSize = 1 + (1 - dashScale) * 2;
                tether.line.material.needsUpdate = true;
                
                // Gradually shift color based on distance
                const hue = 0.55 + Math.sin(currentTime * 0.001) * 0.05;
                const saturation = Math.min(1.0, 400 / tether.distance);
                tether.line.material.color.setHSL(hue, saturation, 0.5);
            }
        });
        
        // Render the scene
        renderer.render(scene, camera);
        
        // Continue the render loop
        requestAnimationFrame(render);
    }

    function resize() {
        let width = window.innerWidth;
        let height = window.innerHeight;
        
        camera = new t.OrthographicCamera(0, width, 0, height, -10000, 10000);
        camera.updateProjectionMatrix();
        renderer.setSize(width, height);
    }
}

// Helper function to initialize position texture
function initPositionTexture(texture, systemIndex) {
    const radius = SPHERE_RADIUS + systemIndex * 15;
    const positions = texture.image.data;
    
    // Fill the texture with initial particle positions
    for (let i = 0; i < positions.length; i += 4) {
        // Create a random point in a sphere
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        const r = radius * Math.cbrt(Math.random());
        
        positions[i] = r * Math.sin(phi) * Math.cos(theta); // X
        positions[i+1] = r * Math.sin(phi) * Math.sin(theta); // Y
        positions[i+2] = r * Math.cos(phi); // Z
        positions[i+3] = 1.0; // W
    }
}