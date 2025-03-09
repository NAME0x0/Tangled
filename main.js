import WindowManager from './WindowManager.js'
import {createPointsMaterial} from './GPU_Particles/materials.js'
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
let PARTICLES_PER_SYSTEM = 500; // Reduced to 500 for better performance on low-end systems
let TEXTURE_WIDTH = Math.ceil(Math.sqrt(PARTICLES_PER_SYSTEM));
let TEXTURE_HEIGHT = TEXTURE_WIDTH;
let gpuComputers = [];
let useGPUComputation = true; // Flag to enable/disable GPU computation

// Particle system settings
const SPHERE_RADIUS = 80; // Base radius for particle systems

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

    function setupUI() {
        // Setup the particle count slider
        const particleCountSlider = document.getElementById('particleCount');
        const particleCountValue = document.getElementById('particleCountValue');
        
        if (particleCountSlider && particleCountValue) {
            let debounceTimer = null;
            
            particleCountSlider.addEventListener('input', () => {
                const newValue = parseInt(particleCountSlider.value);
                particleCountValue.textContent = newValue.toLocaleString();
                
                // Update immediately for small changes
                if (Math.abs(newValue - PARTICLES_PER_SYSTEM) < 1000) {
                    PARTICLES_PER_SYSTEM = newValue;
                    TEXTURE_WIDTH = Math.ceil(Math.sqrt(PARTICLES_PER_SYSTEM));
                    TEXTURE_HEIGHT = TEXTURE_WIDTH;
                    needsParticleUpdate = true;
                } else {
                    // Debounce for large changes to avoid excessive updates
                    clearTimeout(debounceTimer);
                    debounceTimer = setTimeout(() => {
                        PARTICLES_PER_SYSTEM = newValue;
                        TEXTURE_WIDTH = Math.ceil(Math.sqrt(PARTICLES_PER_SYSTEM));
                        TEXTURE_HEIGHT = TEXTURE_WIDTH;
                        needsParticleUpdate = true;
                    }, 200);
                }
            });
            
            // Initialize with default value
            particleCountValue.textContent = PARTICLES_PER_SYSTEM.toLocaleString();
        }
        
        // Setup the new window button
        const newWindowBtn = document.getElementById('newWindowBtn');
        if (newWindowBtn) {
            newWindowBtn.addEventListener('click', () => {
                // Calculate a position offset from the current window
                const offsetX = Math.floor(Math.random() * 300) - 150;
                const offsetY = Math.floor(Math.random() * 300) - 150;
                
                // Pass the current particle count as a URL parameter
                const url = new URL(window.location.href);
                url.searchParams.set('particleCount', PARTICLES_PER_SYSTEM);
                
                // Open a new window with same URL
                const newWindow = window.open(
                    url.toString(), 
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
        } else {
            console.error("Button with ID 'newWindowBtn' not found!");
        }
        
        // Check for particle count in URL params
        const urlParams = new URLSearchParams(window.location.search);
        const paramParticleCount = urlParams.get('particleCount');
        if (paramParticleCount) {
            const parsedCount = parseInt(paramParticleCount);
            if (!isNaN(parsedCount) && parsedCount >= 1000 && parsedCount <= 50000) {
                PARTICLES_PER_SYSTEM = parsedCount;
                TEXTURE_WIDTH = Math.ceil(Math.sqrt(PARTICLES_PER_SYSTEM));
                TEXTURE_HEIGHT = TEXTURE_WIDTH;
                
                // Update the slider to match
                if (particleCountSlider) {
                    particleCountSlider.value = parsedCount;
                }
                if (particleCountValue) {
                    particleCountValue.textContent = parsedCount.toLocaleString();
                }
            }
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
        // Create perspective camera instead of orthographic for better 3D view
        camera = new t.PerspectiveCamera(60, window.innerWidth/window.innerHeight, 1, 10000);
        camera.position.z = 500; // Move camera back to see particles
        
        scene = new t.Scene();
        scene.background = new t.Color(0x000000);
        scene.add(camera);

        renderer = new t.WebGLRenderer({antialias: true, depthBuffer: true});
        renderer.setPixelRatio(pixR);
        
        world = new t.Object3D();
        scene.add(world);

        // Remove axes helper
        // const axesHelper = new t.AxesHelper(100);
        // world.add(axesHelper);

        renderer.domElement.setAttribute("id", "scene");
        document.body.appendChild(renderer.domElement);

        // Test if GPU computation is possible
        try {
            // Simple test to see if we can create GPU compute textures
            const testGpu = new GPUComputationRenderer(4, 4, renderer);
            const testTex = testGpu.createTexture();
            useGPUComputation = true;
            console.log("GPU computation available");
        } catch (e) {
            useGPUComputation = false;
            console.warn("GPU computation not available, falling back to CPU", e);
        }
    }

    function setupWindowManager() {
        windowManager = new WindowManager();
        windowManager.setWinShapeChangeCallback(updateWindowShape);
        windowManager.setWinChangeCallback(windowsUpdated);

        // here you can add your custom metadata to each windows instance
        let metaData = {foo: "bar"};

        // this will init the windowmanager and add this window to the centralised pool of windows
        windowManager.init(metaData);

        // call update windows initially (it will later be called by the win change callback)
        windowsUpdated();
    }

    function windowsUpdated() {
        updateParticleSystems();
    }

    // Setup GPU computation for a particle system
    function setupGpuComputation(index) {
        const gpu = new GPUComputationRenderer(TEXTURE_WIDTH, TEXTURE_HEIGHT, renderer);
        
        // Create position target texture
        const posTargetTex = gpu.createTexture();
        const posTargetVar = gpu.addVariable('posTarget', createPosTargetShader(), posTargetTex);
        
        // Create acceleration texture
        const accTex = gpu.createTexture();
        const accVar = gpu.addVariable('acc', createAccShader(), accTex);
        
        // Create velocity texture
        const velTex = gpu.createTexture();
        const velVar = gpu.addVariable('vel', createVelShader(), velTex);
        
        // Create position texture
        const posTex = gpu.createTexture();
        const posVar = gpu.addVariable('pos', createPosShader(), posTex);
        
        // Set variable dependencies
        gpu.setVariableDependencies(accVar, [posTargetVar, posVar, accVar]);
        gpu.setVariableDependencies(velVar, [accVar, velVar]);
        gpu.setVariableDependencies(posVar, [accVar, velVar, posVar, posTargetVar]);
        
        // Check for completeness
        const error = gpu.init();
        if (error !== null) {
            console.error(error);
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
    }

    function createCPUParticleSystem(index, position, hue) {
        // Create geometry with positions for points
        const geometry = new t.BufferGeometry();
        const positions = new Float32Array(PARTICLES_PER_SYSTEM * 3);
        const velocities = new Float32Array(PARTICLES_PER_SYSTEM * 3); // Store velocities
        const accelerations = new Float32Array(PARTICLES_PER_SYSTEM * 3); // Store accelerations
        const ids = new Float32Array(PARTICLES_PER_SYSTEM); // For randomization
        
        // Initialize positions randomly within a sphere
        const radius = SPHERE_RADIUS + index * 15; // Slightly increase radius for each window
        for (let i = 0; i < PARTICLES_PER_SYSTEM; i++) {
            const i3 = i * 3;
            // Random position inside sphere with slight variation for natural look
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);
            // Use cube root for more even distribution
            const r = radius * Math.cbrt(Math.random()) * (0.8 + Math.random() * 0.4);
            
            positions[i3] = r * Math.sin(phi) * Math.cos(theta);
            positions[i3 + 1] = r * Math.sin(phi) * Math.sin(theta);
            positions[i3 + 2] = r * Math.cos(phi);
            
            // Initialize velocities to zero
            velocities[i3] = 0;
            velocities[i3 + 1] = 0;
            velocities[i3 + 2] = 0;
            
            // Set random ID
            ids[i] = Math.random();
        }
        
        geometry.setAttribute('position', new t.BufferAttribute(positions, 3));
        geometry.setAttribute('velocity', new t.BufferAttribute(velocities, 3));
        geometry.setAttribute('acceleration', new t.BufferAttribute(accelerations, 3));
        geometry.setAttribute('id', new t.BufferAttribute(ids, 1));
        
        // Create simplified point material
        const material = new t.PointsMaterial({
            size: 3.0,
            color: new t.Color().setHSL(hue, 0.8, 0.5),
            blending: t.AdditiveBlending,
            transparent: true,
            opacity: 0.7
        });
        
        // Create points object
        const points = new t.Points(geometry, material);
        points.position.copy(position);
        
        return {
            points,
            index,
            targetPosition: new t.Vector3().copy(position),
            radius,
            type: "cpu"
        };
    }

    function createParticleSystem(index, position, hue) {
        if (useGPUComputation) {
            // Use GPU implementation
            const geometry = new t.BufferGeometry();
            const positions = new Float32Array(PARTICLES_PER_SYSTEM * 3);
            
            // Initialize positions randomly within a sphere
            const radius = SPHERE_RADIUS + index * 15; // Slightly increase radius for each window
            for (let i = 0; i < PARTICLES_PER_SYSTEM; i++) {
                const i3 = i * 3;
                // Random position inside sphere with slight variation for natural look
                const theta = Math.random() * Math.PI * 2;
                const phi = Math.acos(2 * Math.random() - 1);
                // Use cube root for more even distribution
                const r = radius * Math.cbrt(Math.random()) * (0.8 + Math.random() * 0.4); // Add variation 80-120%
                
                positions[i3] = r * Math.sin(phi) * Math.cos(theta);
                positions[i3 + 1] = r * Math.sin(phi) * Math.sin(theta);
                positions[i3 + 2] = r * Math.cos(phi);
            }
            
            geometry.setAttribute('position', new t.BufferAttribute(positions, 3));
            
            // Create the particle material
            const material = createPointsMaterial(TEXTURE_WIDTH, TEXTURE_HEIGHT);
            
            // Setup uniforms
            material.uniforms.time = { value: 0.0 };
            material.uniforms.posTarget = { value: null };
            material.uniforms.acc = { value: null };
            material.uniforms.vel = { value: null };
            material.uniforms.pos = { value: null };
            material.uniforms.hue = { value: hue };
            material.uniforms.radius = { value: radius };
            
            // Create points object
            const points = new t.Points(geometry, material);
            points.position.copy(position);
            
            // Setup GPU computation
            const computation = setupGpuComputation(index);
            
            // Set custom uniforms for the GPU computation
            const vars = computation.variables;
            if (vars.acc && vars.acc.material && vars.acc.material.uniforms) {
                vars.acc.material.uniforms.radius = { value: radius };
            }
            
            return {
                points,
                computation,
                index,
                targetPosition: new t.Vector3().copy(position),
                radius
            };
        } else {
            // Use CPU implementation
            return createCPUParticleSystem(index, position, hue);
        }
    }

    function updateParticleSystems() {
        // Remove existing particle systems
        particleSystems.forEach(system => {
            world.remove(system.points);
            // Properly dispose GPU resources
            if (system.computation && system.computation.gpu) {
                // Cleanup if needed
                // This is simplified - you might need more complex disposal logic
            }
        });
        
        particleSystems = [];
        gpuComputers = [];
        
        // Create new particle systems based on window positions
        const wins = windowManager.getWindows();
        
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
            gpuComputers.push(system.computation);
        }
        
        needsParticleUpdate = false;
    }

    function updateCPUParticles(system, currentTime) {
        const positions = system.points.geometry.attributes.position;
        const velocities = system.points.geometry.attributes.velocity;
        const accelerations = system.points.geometry.attributes.acceleration;
        const ids = system.points.geometry.attributes.id;
        
        const center = new t.Vector3(0, 0, 0);
        
        // Update each particle
        for (let i = 0; i < PARTICLES_PER_SYSTEM; i++) {
            const i3 = i * 3;
            
            // Get current position and velocity
            const x = positions.array[i3];
            const y = positions.array[i3 + 1];
            const z = positions.array[i3 + 2];
            
            const vx = velocities.array[i3];
            const vy = velocities.array[i3 + 1];
            const vz = velocities.array[i3 + 2];
            
            // Calculate position relative to center
            const pos = new t.Vector3(x, y, z);
            const distToCenter = pos.length();
            
            // Reset acceleration
            let ax = 0, ay = 0, az = 0;
            
            // Add some turbulence
            const id = ids.array[i];
            const noiseScale = 0.01;
            const turbulenceStrength = 0.05;
            
            // Simple noise simulation (not as good as shader-based but works)
            const nx = Math.sin(x * noiseScale + currentTime * 0.1 + id * 10) * turbulenceStrength;
            const ny = Math.cos(y * noiseScale + currentTime * 0.11 + id * 20) * turbulenceStrength;
            const nz = Math.sin(z * noiseScale + currentTime * 0.09 + id * 30) * turbulenceStrength;
            
            ax += nx;
            ay += ny;
            az += nz;
            
            // Add gravity towards center
            const toCenter = center.clone().sub(pos).normalize();
            const gravitationalStrength = 0.004 * (1 + distToCenter / system.radius);
            
            ax += toCenter.x * gravitationalStrength;
            ay += toCenter.y * gravitationalStrength;
            az += toCenter.z * gravitationalStrength;
            
            // Add vortex effect - make particles swirl
            const vortexStrength = 0.015 * (1 - Math.min(1, distToCenter / (system.radius * 1.5)));
            const tangent = new t.Vector3(-pos.z, 0, pos.x).normalize().multiplyScalar(vortexStrength);
            
            ax += tangent.x;
            ay += tangent.y;
            az += tangent.z;
            
            // Store acceleration
            accelerations.array[i3] = ax;
            accelerations.array[i3 + 1] = ay;
            accelerations.array[i3 + 2] = az;
            
            // Update velocity with damping
            const damping = 0.97;
            velocities.array[i3] = vx * damping + ax;
            velocities.array[i3 + 1] = vy * damping + ay;
            velocities.array[i3 + 2] = vz * damping + az;
            
            // Limit velocity
            const maxVel = 1.0;
            const velocity = new t.Vector3(
                velocities.array[i3],
                velocities.array[i3 + 1],
                velocities.array[i3 + 2]
            );
            
            if (velocity.length() > maxVel) {
                velocity.normalize().multiplyScalar(maxVel);
                velocities.array[i3] = velocity.x;
                velocities.array[i3 + 1] = velocity.y;
                velocities.array[i3 + 2] = velocity.z;
            }
            
            // Update position
            positions.array[i3] += velocities.array[i3];
            positions.array[i3 + 1] += velocities.array[i3 + 1];
            positions.array[i3 + 2] += velocities.array[i3 + 2];
        }
        
        // Mark attributes as needing update
        positions.needsUpdate = true;
        velocities.needsUpdate = true;
        accelerations.needsUpdate = true;
    }

    function updateWindowShape(easing = true) {
        // storing the actual offset in a proxy that we update against in the render function
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
        
        // calculate the new position based on the delta between current offset and new offset times a falloff value
        let falloff = .05;
        sceneOffset.x = sceneOffset.x + ((sceneOffsetTarget.x - sceneOffset.x) * falloff);
        sceneOffset.y = sceneOffset.y + ((sceneOffsetTarget.y - sceneOffset.y) * falloff);
        
        // set the world position to the offset
        world.position.x = sceneOffset.x;
        world.position.y = sceneOffset.y;
        
        const wins = windowManager.getWindows();
        
        // Update particle systems
        for (let i = 0; i < particleSystems.length && i < wins.length; i++) {
            const system = particleSystems[i];
            const win = wins[i];
            
            // Update target position
            system.targetPosition.x = win.shape.x + (win.shape.w * 0.5);
            system.targetPosition.y = win.shape.y + (win.shape.h * 0.5);
            
            // Move points with smooth easing
            system.points.position.x = system.points.position.x + (system.targetPosition.x - system.points.position.x) * falloff;
            system.points.position.y = system.points.position.y + (system.targetPosition.y - system.points.position.y) * falloff;
            
            if (system.type === "cpu") {
                // Update CPU particles
                updateCPUParticles(system, currentTime);
            } else {
                // Update GPU particles
                const gpu = system.computation.gpu;
                const vars = system.computation.variables;
                
                // Update uniforms for shaders
                vars.posTarget.material.uniforms.time = { value: currentTime };
                vars.posTarget.material.uniforms.windowIndex = { value: i };
                
                vars.acc.material.uniforms.time = { value: currentTime };
                vars.acc.material.uniforms.radius = { value: system.radius };
                
                vars.pos.material.uniforms.time = { value: currentTime };
                vars.pos.material.uniforms.frame = { value: system.frame || 0 };
                system.frame = (system.frame || 0) + 1;
                
                // Perform GPU computation
                gpu.compute();
                
                // Update material uniforms with computed textures
                const material = system.points.material;
                material.uniforms.time.value = currentTime;
                material.uniforms.posTarget.value = gpu.getCurrentRenderTarget(vars.posTarget).texture;
                material.uniforms.acc.value = gpu.getCurrentRenderTarget(vars.acc).texture;
                material.uniforms.vel.value = gpu.getCurrentRenderTarget(vars.vel).texture;
                material.uniforms.pos.value = gpu.getCurrentRenderTarget(vars.pos).texture;
            }
        }
        
        renderer.render(scene, camera);
        requestAnimationFrame(render);
    }

    // Update the resize function to maintain perspective camera
    function resize() {
        let width = window.innerWidth;
        let height = window.innerHeight;
        
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height);
    }
}