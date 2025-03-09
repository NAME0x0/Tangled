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
let PARTICLES_PER_SYSTEM = 500; // Default value
let TEXTURE_WIDTH = Math.ceil(Math.sqrt(PARTICLES_PER_SYSTEM));
let TEXTURE_HEIGHT = TEXTURE_WIDTH;
let gpuComputers = [];

// Particle system settings
const SPHERE_RADIUS = 80; // Base radius for particle systems
const LOADING_INTERVAL = 100; // Load particles in batches

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

    function setupUI() {
        const particleCountSlider = document.getElementById('particleCount');
        const particleCountValue = document.getElementById('particleCountValue');
        
        if (particleCountSlider && particleCountValue) {
            let debounceTimer = null;
            
            particleCountSlider.addEventListener('input', () => {
                const newValue = parseInt(particleCountSlider.value);
                particleCountValue.textContent = newValue.toLocaleString();
                
                // Use debouncing to prevent too many updates
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(() => {
                    if (newValue !== PARTICLES_PER_SYSTEM) {
                        console.log(`Changing particle count from ${PARTICLES_PER_SYSTEM} to ${newValue}`);
                        PARTICLES_PER_SYSTEM = newValue;
                        TEXTURE_WIDTH = Math.ceil(Math.sqrt(PARTICLES_PER_SYSTEM));
                        TEXTURE_HEIGHT = TEXTURE_WIDTH;
                        needsParticleUpdate = true;
                    }
                }, 300);
            });
            
            // Initialize with default value
            particleCountValue.textContent = PARTICLES_PER_SYSTEM.toLocaleString();
        }
        
        // Rest of setupUI function...
        
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
        }
        
        // Check for particle count in URL params
        const urlParams = new URLSearchParams(window.location.search);
        const paramParticleCount = urlParams.get('particleCount');
        if (paramParticleCount) {
            const parsedCount = parseInt(paramParticleCount);
            if (!isNaN(parsedCount) && parsedCount >= 100) {
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
        
        console.log("Scene setup complete");
    }

    function setupWindowManager() {
        windowManager = new WindowManager();
        windowManager.setWinShapeChangeCallback(updateWindowShape);
        windowManager.setWinChangeCallback(windowsUpdated);

        // Custom metadata for each window
        let metaData = {foo: "bar"};

        // Init window manager
        windowManager.init(metaData);
        
        // Initial update
        windowsUpdated();
    }

    function windowsUpdated() {
        updateParticleSystems();
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
            
            // Create textures
            const posTargetTex = gpu.createTexture();
            const posTargetVar = gpu.addVariable('posTarget', createPosTargetShader(), posTargetTex);
            
            const accTex = gpu.createTexture();
            const accVar = gpu.addVariable('acc', createAccShader(), accTex);
            
            const velTex = gpu.createTexture();
            const velVar = gpu.addVariable('vel', createVelShader(), velTex);
            
            const posTex = gpu.createTexture();
            const posVar = gpu.addVariable('pos', createPosShader(), posTex);
            
            // Add uniforms to the shaders (not just dependencies)
            posTargetVar.material.uniforms.time = { value: 0.0 };
            posTargetVar.material.uniforms.radius = { value: SPHERE_RADIUS };
            
            accVar.material.uniforms.time = { value: 0.0 };
            accVar.material.uniforms.radius = { value: SPHERE_RADIUS };
            
            velVar.material.uniforms.time = { value: 0.0 };
            
            posVar.material.uniforms.time = { value: 0.0 };
            posVar.material.uniforms.frame = { value: 0 };
            
            // Set dependencies properly - ensure all textures can be accessed by shaders
            gpu.setVariableDependencies(posTargetVar, [posTargetVar]);
            gpu.setVariableDependencies(accVar, [posTargetVar, posVar, accVar]);
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
            console.error("Failed to initialize GPU computation, using fallback sphere");
            return;
        }
        
        system.computation = computation;
        
        try {
            // Create the shader material with simpler settings
            const material = createPointsMaterial(TEXTURE_WIDTH, TEXTURE_HEIGHT);
            
            // Setup uniforms
            material.uniforms.time = { value: 0.0 };
            material.uniforms.hue = { value: hue };
            material.uniforms.radius = { value: system.radius };
            
            // Replace material
            if (system.points.material) system.points.material.dispose();
            system.points.material = material;
            
            system.isInitialized = true;
            system.frame = 0; // Reset frame counter
            console.log(`Particle system ${system.index} initialized`);
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
            
            // Allow slider to work again after loading completes
            setTimeout(() => {
                isLoadingParticles = false;
                console.log("Particle systems updated successfully");
            }, wins.length * LOADING_INTERVAL + 200);
        } catch (error) {
            console.error("Error creating particle systems:", error);
            
            // Fallback to simple spheres if particle creation fails
            createFallbackSpheres();
            
            setTimeout(() => {
                isLoadingParticles = false;
            }, 200);
        }
    }

    // Add a fallback method for when GPU particles fail
    function createFallbackSpheres() {
        const wins = windowManager.getWindows();
        
        for (let i = 0; i < wins.length; i++) {
            const win = wins[i];
            const position = new t.Vector3(
                win.shape.x + (win.shape.w * 0.5),
                win.shape.y + (win.shape.h * 0.5),
                0
            );
            
            // Create a colored sphere
            const color = new t.Color().setHSL(i * 0.1, 1.0, 0.5);
            const geometry = new t.SphereGeometry(50 + i * 10, 16, 16);
            const material = new t.MeshBasicMaterial({
                color: color,
                wireframe: true
            });
            const sphere = new t.Mesh(geometry, material);
            sphere.position.copy(position);
            
            const system = {
                points: sphere,
                index: i,
                targetPosition: position.clone(),
                isInitialized: true,
                isFallback: true
            };
            
            world.add(sphere);
            particleSystems.push(system);
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
            
            // Add gentle rotation
            system.points.rotation.x = Math.sin(currentTime * 0.2) * 0.1;
            system.points.rotation.y = Math.cos(currentTime * 0.3) * 0.1;
            
            // Handle different types of systems
            if (system.isFallback) {
                // Just rotate fallback spheres
                system.points.rotation.x += 0.01;
                system.points.rotation.y += 0.005;
            }
            else if (system.isInitialized && system.computation) {
                try {
                    const gpu = system.computation.gpu;
                    const vars = system.computation.variables;
                    
                    if (!gpu || !vars) continue;
                    
                    // Update uniforms for shaders
                    vars.posTarget.material.uniforms.time.value = currentTime;
                    vars.acc.material.uniforms.time.value = currentTime;
                    vars.vel.material.uniforms.time.value = currentTime;
                    vars.pos.material.uniforms.time.value = currentTime;
                    vars.pos.material.uniforms.frame.value = system.frame;
                    system.frame++;
                    
                    // Perform GPU computation
                    gpu.compute();
                    
                    // Update material uniforms with computed textures
                    const material = system.points.material;
                    if (material && material.uniforms) {
                        material.uniforms.time.value = currentTime;
                        material.uniforms.posTarget.value = gpu.getCurrentRenderTarget(vars.posTarget).texture;
                        material.uniforms.acc.value = gpu.getCurrentRenderTarget(vars.acc).texture;
                        material.uniforms.vel.value = gpu.getCurrentRenderTarget(vars.vel).texture;
                        material.uniforms.pos.value = gpu.getCurrentRenderTarget(vars.pos).texture;
                    }
                } catch (e) {
                    console.error("Error updating GPU system:", e);
                    // If there's an error, mark system for potential replacement
                    system.hasErrors = true;
                }
            }
        }
        
        renderer.render(scene, camera);
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