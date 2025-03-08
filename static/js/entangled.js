// Entangled - Inspired by Bjørn Ståål's work
// This implementation creates orbs that are connected across browser windows
// with tethers that reflect the physical position of the windows

// Global variables
let scene, camera, renderer;
let mainOrb; // The orb that belongs to this window
let tetherLines = []; // Array of tethers connecting to parent and children windows
let particles = []; // Particles surrounding the orb
let clock;
let noise;
let windowId, parentId;
let isFirstWindow = true;
let windowPosition = { x: 0, y: 0 }; // Position of this window on screen
let childPositions = {}; // Map of child window IDs to their positions
let parentPosition = null; // Position of the parent window
let raycaster, mouse;
let composer; // For post-processing effects
let bloom, unrealBloom;
let usePostProcessing = false; // Flag to indicate if post-processing is available

// Visual configuration
const CONFIG = {
    // Core colors
    primaryColor: 0x00ff73, // Gamma green
    colors: {
        orb: 0x00ff73,      // Main orb color (gamma green)
        tether: 0x7affb5,   // Tether color
        parentTether: 0x60efff, // Color for tether to parent (slightly blue)
        childTether: 0xb0ff9a, // Color for tether to children (slightly green)
        particles: [
            0x00ff73,       // Green (matching main orb)
            0x60efff,       // Cyan
            0xff00ff,       // Magenta
            0xffffff        // White
        ],
        background: 0x000000 // Black background
    },
    
    // Sizes and distances
    orbRadius: 0.7,
    particleCount: 400, // Increased from 150
    particleSizeRange: { min: 0.03, max: 0.12 },
    particleDistanceRange: { min: 0.9, max: 3.5 },
    tetherWidth: 0.1,
    
    // Animation
    orbPulseSpeed: 0.8,
    orbPulseAmount: 0.1,
    particleMovementSpeed: 0.2,
    tetherPulseSpeed: 1.5,
    
    // Effects
    glowIntensity: 1.2,
    bloomStrength: 1.5,
    bloomRadius: 0.7,
    bloomThreshold: 0.2,
    
    // Intervals
    syncInterval: 100, // ms between state updates
    positionCheckInterval: 500, // ms between window position checks

    // Particle flow settings
    particleFlow: {
        flowCount: 30,             // Number of particles that can flow between orbs
        flowSpeed: 0.2,            // Base speed of traveling particles
        flowVariation: 0.1,        // Random variation in flow speed
        transferProbability: 0.01, // Probability per frame of a particle starting to travel
        gravitationalPull: 0.02,   // Strength of gravitational attraction
        orbitRadius: 1.5,          // Average radius for orbiting
        orbitSpeed: 0.5,           // Base orbital speed
        flowTrailLength: 4,        // Length of trail for flowing particles
        particleColors: {
            traveling: 0xffffff,   // Color for particles in transit
            orbiting: null         // Will use the orb's color by default
        }
    },

    // Physics configuration
    physics: {
        enabled: true,              // Enable physics simulation
        gravitationalConstant: 0.5, // G in Newton's law (adjusted for simulation scale)
        orbMass: 10.0,              // Mass of the main orb
        particleMass: 0.01,         // Mass of each particle
        dampingFactor: 0.995,       // Velocity damping (simulates minor friction)
        timeStep: 1/60,             // Physics simulation step (for consistent physics regardless of framerate)
        maxSpeed: 0.15,             // Maximum particle speed to prevent instability
        minDistance: 0.5,           // Minimum distance to prevent singularity
        transferInfluence: 3.0,     // Strength of tether gravitational influence
        tetherAttractionRange: 0.8, // Range around tether where particles are influenced
        tetherPathDeviation: 0.15,  // How much particles deviate from the tether path (randomness)
        particleInteractionRange: 0.3, // Range for particle-particle interactions
        particleRepulsion: 0.01,    // Strength of particle-particle repulsion
        minOrbitalDistance: 0.8,     // Minimum distance particles can get to an orb
        flowProbability: 0.01,      // Doubled from 0.005 for more visible flow
        transferInterval: 500,       // Minimum ms between flow attempts for a particle
    },

    // Tether/Aura configuration (updated for better visibility)
    aura: {
        width: 1.8,           // Increased width (was 1.2)
        coreSize: 0.2,        // Increased core size (was 0.1)
        segments: 128,        // Detail of the aura
        maxOpacity: 0.85,     // Increased opacity (was 0.6)
        fadeDistance: 0.5,    // Reduced fade distance for more visible aura (was 0.7)
        edgeFeather: 0.4,     // Increased edge feathering (was 0.3)
        colorIntensity: 1.8,  // Increased color intensity (was 1.2)
        edgeGlow: 0.7,        // Increased edge glow (was 0.4)
        verticalSpread: 2.0,  // Increased vertical spread (was 1.5)
        flowPathOffset: 0.8,  // Increased flow path offset (was 0.6)
        pulseSpeed: 1.2,      // New: Speed of aura pulsing
        pulseIntensity: 0.3   // New: Intensity of aura pulsing
    }
};

// Debug utility function
function debug(message) {
    console.log(message);
    if (typeof updateDebug === 'function') {
        updateDebug(message);
    }
}

// Initialize the application
function init() {
    debug('Initializing Entangled application...');
    
    // Check dependencies
    if (!checkDependencies()) return;
    
    // Set up unique ID for this window and determine if it's the first
    setupWindowIdentity();
    
    // Initialize Three.js scene
    setupScene();
    
    // Create the orb and tether
    createVisuals();
    
    // Set up event listeners
    setupEventListeners();
    
    // Start the animation loop
    clock = new THREE.Clock();
    clock.start();
    animate();
    
    // Periodically update window position
    checkWindowPosition();
    setInterval(checkWindowPosition, CONFIG.positionCheckInterval);
    
    debug('Initialization complete');
}

// Check if all required libraries are loaded
function checkDependencies() {
    if (typeof THREE === 'undefined') {
        debug('ERROR: THREE.js not loaded');
        alert('THREE.js is required but not loaded. Please check your internet connection and try again.');
        return false;
    }
    
    if (typeof SimplexNoise === 'undefined') {
        debug('WARNING: SimplexNoise not loaded, using fallback');
        window.SimplexNoise = function() {
            this.noise2D = function(x, y) {
                return Math.sin(x * 0.5) * Math.cos(y * 0.5) * 0.5;
            };
            this.noise3D = function(x, y, z) {
                return Math.sin(x * 0.5) * Math.cos(y * 0.5) * Math.sin(z * 0.3) * 0.5;
            };
        };
    }
    
    noise = new SimplexNoise();
    
    // Check if post-processing effects are available, create fallbacks if needed
    if (typeof THREE.EffectComposer === 'undefined' || 
        typeof THREE.RenderPass === 'undefined' || 
        typeof THREE.UnrealBloomPass === 'undefined' ||
        typeof THREE.FilmPass === 'undefined') {
        debug('WARNING: Post-processing modules not loaded, visual quality will be reduced');
        createFallbackEffects();
    } else {
        usePostProcessing = true;
        debug('Post-processing modules loaded successfully');
    }
    
    return true;
}

// Set up window identity and parent-child relationships
function setupWindowIdentity() {
    // Generate a unique ID for this window
    windowId = 'window_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
    debug(`Window ID: ${windowId}`);
    
    // Check if there's already a parent window
    const storedWindowData = localStorage.getItem('entangledWindows');
    
    if (storedWindowData) {
        try {
            const windowData = JSON.parse(storedWindowData);
            const windowKeys = Object.keys(windowData);
            
            if (windowKeys.length > 0) {
                // This is not the first window, find the most recently active parent
                const sortedWindows = windowKeys
                    .map(key => ({ id: key, lastActive: windowData[key].lastActive }))
                    .sort((a, b) => b.lastActive - a.lastActive);
                
                parentId = sortedWindows[0].id;
                isFirstWindow = false;
                
                debug(`This is a child window with parent: ${parentId}`);
                
                // Set a different color based on the generation (whiter/less saturated)
                const generation = windowData[parentId].generation + 1;
                
                // Adjust color saturation and lightness based on generation
                const color = new THREE.Color(CONFIG.primaryColor);
                // Convert to HSL to reduce saturation and increase lightness
                const hsl = {};
                color.getHSL(hsl);
                hsl.s = Math.max(0.2, hsl.s - (generation * 0.2)); // Reduce saturation
                hsl.l = Math.min(0.8, hsl.l + (generation * 0.15)); // Increase lightness
                color.setHSL(hsl.h, hsl.s, hsl.l);
                
                CONFIG.colors.orb = color.getHex();
                CONFIG.colors.tether = color.getHex();
                
                // Store parent position
                if (windowData[parentId]) {
                    parentPosition = windowData[parentId].position;
                }
            } else {
                isFirstWindow = true;
                debug('This is the first window');
            }
        } catch (e) {
            debug(`Error parsing window data: ${e.message}`);
            isFirstWindow = true;
        }
    } else {
        isFirstWindow = true;
        debug('This is the first window (no existing windows)');
    }
    
    // Store this window's data
    updateWindowData();
    
    // Set the initial position
    checkWindowPosition();
}

// Update window position and save to localStorage
function checkWindowPosition() {
    const prevX = windowPosition.x;
    const prevY = windowPosition.y;
    
    // Get window position
    windowPosition = {
        x: window.screenX || window.screenLeft,
        y: window.screenY || window.screenTop,
        width: window.outerWidth,
        height: window.outerHeight
    };
    
    // Only update if position has changed
    if (prevX !== windowPosition.x || prevY !== windowPosition.y) {
        debug(`Window position: ${windowPosition.x}, ${windowPosition.y}`);
        updateWindowData();
    }
    
    // Retrieve child and parent window positions
    const storedWindowData = localStorage.getItem('entangledWindows');
    if (storedWindowData) {
        try {
            const windowData = JSON.parse(storedWindowData);
            
            // Find all windows that have this window as parent
            childPositions = {};
            for (const winId in windowData) {
                if (winId !== windowId && windowData[winId].parentId === windowId) {
                    childPositions[winId] = {
                        x: windowData[winId].position.x,
                        y: windowData[winId].position.y,
                        width: windowData[winId].position.width || 800,
                        height: windowData[winId].position.height || 600,
                        lastActive: windowData[winId].lastActive
                    };
                }
            }
            
            // Update parent position
            if (parentId && windowData[parentId]) {
                parentPosition = windowData[parentId].position;
            } else {
                parentPosition = null;
            }
            
            // Clean up old child windows (more than 10 seconds inactive)
            const now = Date.now();
            for (const childId in childPositions) {
                if (now - childPositions[childId].lastActive > 10000) {
                    delete childPositions[childId];
                    debug(`Removed inactive child window: ${childId}`);
                }
            }
            
            // Update tethers for both parent and child connections
            updateTethers();
        } catch (e) {
            debug(`Error retrieving window positions: ${e.message}`);
        }
    }
}

// Update window data in localStorage
function updateWindowData() {
    const storedWindowData = localStorage.getItem('entangledWindows');
    let windowData = {};
    
    if (storedWindowData) {
        try {
            windowData = JSON.parse(storedWindowData);
        } catch (e) {
            debug(`Error parsing window data: ${e.message}`);
        }
    }
    
    // Update this window's data
    windowData[windowId] = {
        position: windowPosition,
        lastActive: Date.now(),
        parentId: parentId || null,
        generation: parentId ? (windowData[parentId]?.generation + 1 || 1) : 0
    };
    
    // Clean up old windows (more than 30 seconds inactive)
    const now = Date.now();
    for (const winId in windowData) {
        if (now - windowData[winId].lastActive > 30000) {
            delete windowData[winId];
        }
    }
    
    // Save back to localStorage
    localStorage.setItem('entangledWindows', JSON.stringify(windowData));
}

// Set up the Three.js scene
function setupScene() {
    debug('Setting up 3D scene');
    
    // Create scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(CONFIG.colors.background);
    scene.fog = new THREE.FogExp2(0x000813, 0.035);
    
    // Create camera
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 10;
    
    // Fixed camera position (no rotation animation)
    camera.position.x = 0;
    camera.position.y = 1;
    camera.lookAt(0, 0, 0);
    
    // Create renderer with antialiasing
    renderer = new THREE.WebGLRenderer({ 
        antialias: true,
        powerPreference: "high-performance"
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // Limit pixel ratio for performance
    document.getElementById('container').appendChild(renderer.domElement);
    
    // Setup post-processing if available
    if (usePostProcessing) {
        try {
            setupPostProcessing();
        } catch (error) {
            debug(`Error setting up post-processing: ${error.message}`);
            usePostProcessing = false;
        }
    }
    
    // Add lights
    addLights();
    
    // Add starfield background
    createStarfield();
    
    // Setup raycaster for mouse interaction
    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();
}

// Setup post-processing effects
function setupPostProcessing() {
    try {
        // Create composer for post-processing
        composer = new THREE.EffectComposer(renderer);
        
        // Add render pass
        const renderPass = new THREE.RenderPass(scene, camera);
        composer.addPass(renderPass);
        
        // Add bloom pass for glow effect
        unrealBloom = new THREE.UnrealBloomPass(
            new THREE.Vector2(window.innerWidth, window.innerHeight),
            CONFIG.bloomStrength,
            CONFIG.bloomRadius,
            CONFIG.bloomThreshold
        );
        composer.addPass(unrealBloom);
        
        // Add film grain pass for artistic effect
        const filmPass = new THREE.FilmPass(0.25, 0.5, 1500, false);
        filmPass.renderToScreen = true;
        composer.addPass(filmPass);
        
        debug('Post-processing setup complete');
    } catch (error) {
        debug(`Failed to set up post-processing: ${error.message}`);
        usePostProcessing = false;
    }
}

// Add lights to the scene
function addLights() {
    // Ambient light (soft overall illumination)
    const ambientLight = new THREE.AmbientLight(0x111111, 0.8);
    scene.add(ambientLight);
    
    // Directional light
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(0, 1, 1);
    scene.add(directionalLight);
    
    // Add colored point lights for dramatic effect
    const colors = [
        CONFIG.colors.orb,
        0x0077ff,
        0xff00ff
    ];
    
    const positions = [
        [0, 0, 2],
        [-4, 2, 0],
        [4, -2, 0]
    ];
    
    for (let i = 0; i < colors.length; i++) {
        const pointLight = new THREE.PointLight(colors[i], 1.5, 15);
        pointLight.position.set(...positions[i]);
        scene.add(pointLight);
    }
}

// Create a starfield background
function createStarfield() {
    const starCount = 500;
    const starField = new THREE.Group();
    
    // Create stars at random positions
    for (let i = 0; i < starCount; i++) {
        const starGeometry = new THREE.SphereGeometry(Math.random() * 0.1 + 0.05, 8, 8);
        const starMaterial = new THREE.MeshBasicMaterial({
            color: new THREE.Color(Math.random(), Math.random(), Math.random()).multiplyScalar(0.5).addScalar(0.5),
            transparent: true,
            opacity: Math.random() * 0.5 + 0.5
        });
        
        const star = new THREE.Mesh(starGeometry, starMaterial);
        
        // Random position in a sphere
        const radius = 50 + Math.random() * 30;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        
        star.position.set(
            radius * Math.sin(phi) * Math.cos(theta),
            radius * Math.sin(phi) * Math.sin(theta),
            radius * Math.cos(phi)
        );
        
        starField.add(star);
    }
    
    scene.add(starField);
}

// Create the orb, particles, and tether
function createVisuals() {
    // Create the main orb
    createMainOrb();
    
    // Create particles around the orb
    createParticles();
}

// Create the main orb with glowing effect
function createMainOrb() {
    const orbGeometry = new THREE.SphereGeometry(CONFIG.orbRadius, 32, 32);
    
    let orbMaterial;
    
    if (usePostProcessing) {
        // Create a custom shader material for the orb with glow effect
        orbMaterial = new THREE.ShaderMaterial({
            uniforms: {
                time: { value: 0 },
                color: { value: new THREE.Color(CONFIG.colors.orb) },
                glowColor: { value: new THREE.Color(CONFIG.colors.orb) },
                glowIntensity: { value: CONFIG.glowIntensity }
            },
            vertexShader: `
                varying vec3 vNormal;
                varying vec3 vPosition;
                
                void main() {
                    vNormal = normalize(normalMatrix * normal);
                    vPosition = (modelViewMatrix * vec4(position, 1.0)).xyz;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform float time;
                uniform vec3 color;
                uniform vec3 glowColor;
                uniform float glowIntensity;
                
                varying vec3 vNormal;
                varying vec3 vPosition;
                
                void main() {
                    // Calculate rim lighting effect for glow
                    float rimFactor = abs(dot(normalize(-vPosition), vNormal));
                    rimFactor = smoothstep(0.0, 1.0, 1.0 - rimFactor);
                    
                    // Pulsing effect
                    float pulse = 0.5 * sin(time * 3.0) + 0.5;
                    
                    // Final color with glow
                    vec3 finalColor = mix(color, glowColor, rimFactor * glowIntensity * (0.8 + 0.2 * pulse));
                    
                    gl_FragColor = vec4(finalColor, 1.0);
                }
            `,
            transparent: true
        });
    } else {
        // Fallback to standard material if shaders aren't working
        orbMaterial = new THREE.MeshPhongMaterial({
            color: CONFIG.colors.orb,
            emissive: CONFIG.colors.orb,
            emissiveIntensity: 0.5,
            shininess: 30,
            specular: 0xffffff
        });
    }
    
    mainOrb = new THREE.Mesh(orbGeometry, orbMaterial);
    mainOrb.castShadow = true;
    mainOrb.receiveShadow = true;
    scene.add(mainOrb);
    
    debug(`Created main orb with color: ${CONFIG.colors.orb.toString(16)}`);
}

// Create particles surrounding the orb
function createParticles() {
    const particleGroup = new THREE.Group();
    particles = []; // Reset particles array
    
    // Create all particles
    for (let i = 0; i < CONFIG.particleCount; i++) {
        // Create a small sphere for each particle
        const size = CONFIG.particleSizeRange.min + 
            Math.random() * (CONFIG.particleSizeRange.max - CONFIG.particleSizeRange.min);
        
        const particleGeometry = new THREE.SphereGeometry(size, 8, 8);
        
        // Choose a random color from the palette
        const colorIndex = Math.floor(Math.random() * CONFIG.colors.particles.length);
        const color = CONFIG.colors.particles[colorIndex];
        
        const particleMaterial = new THREE.MeshPhongMaterial({
            color: color,
            emissive: color,
            emissiveIntensity: 0.5,
            transparent: true,
            opacity: 0.7 + Math.random() * 0.3
        });
        
        const particle = new THREE.Mesh(particleGeometry, particleMaterial);
        
        // Initial position in a spherical distribution around the orb, 
        // but avoid having all particles at the same distance
        const phi = Math.acos(2 * Math.random() - 1);
        const theta = Math.random() * Math.PI * 2;
        
        // Use a distribution that creates more interesting orbital patterns
        // Use cubic distribution to get more particles at different distances
        const distanceFactor = Math.pow(Math.random(), 1/3);
        const distance = CONFIG.particleDistanceRange.min + 
            distanceFactor * (CONFIG.particleDistanceRange.max - CONFIG.particleDistanceRange.min);
        
        particle.position.set(
            distance * Math.sin(phi) * Math.cos(theta),
            distance * Math.sin(phi) * Math.sin(theta),
            distance * Math.cos(phi)
        );
        
        // Add physics properties for the particle
        particle.userData = {
            // Visual properties
            originalSize: size,
            originalColor: color,
            movementOffset: Math.random() * 100,
            
            // Physics properties
            mass: CONFIG.physics.particleMass * (0.8 + Math.random() * 0.4), // Variation in mass
            velocity: new THREE.Vector3(
                (Math.random() - 0.5) * 0.03, 
                (Math.random() - 0.5) * 0.03,
                (Math.random() - 0.5) * 0.03
            ),
            acceleration: new THREE.Vector3(0, 0, 0),
            
            // State tracking
            state: 'orbiting',         // orbiting, transferring, captured
            orbTarget: 'main',         // main, remote
            remoteOrbId: null,         // ID of remote orb if orbiting a remote
            tetherPath: null,          // Tether path when transferring
            flowAbove: Math.random() > 0.5,  // Whether to flow above or below the tether
            tetherProgress: 0,         // Progress along tether (0-1)
            lastFlowAttempt: 0,        // Time of last flow attempt
            lastPosition: new THREE.Vector3(), // Last position for trails
            trail: [],                 // Trail points
            
            // Orbit parameters - will be calculated
            orbitalEnergy: 0,         // Total orbital energy
            angularMomentum: 0,       // Angular momentum
            eccentricity: 0,          // Orbit eccentricity
            
            // Interaction properties
            lastInteractionTime: 0     // Time of last interaction with other particles
        };
        
        // Initialize particle with orbital velocity for a circular orbit
        const orbitalSpeed = Math.sqrt(CONFIG.physics.gravitationalConstant * 
                                      CONFIG.physics.orbMass / distance);
        
        // Create a random perpendicular vector to the radial direction for orbital velocity
        const radialDir = particle.position.clone().normalize();
        const perpAxis = new THREE.Vector3(Math.random()-0.5, Math.random()-0.5, Math.random()-0.5)
            .cross(radialDir)
            .normalize();
        
        // Calculate orbital velocity vector (perpendicular to radius)
        const orbitalVelocity = new THREE.Vector3()
            .crossVectors(perpAxis, radialDir)
            .normalize()
            .multiplyScalar(orbitalSpeed * (0.8 + Math.random() * 0.4)); // Add variation
        
        particle.userData.velocity.copy(orbitalVelocity);
        
        // Create particle trail
        if (Math.random() < 0.3) { // 30% of particles have visible trails
            const trailLength = Math.floor(3 + Math.random() * 5); // 3-7 trail points
            for (let t = 0; t < trailLength; t++) {
                const trailGeometry = new THREE.SphereGeometry(size * (0.6 - t * 0.1), 4, 4);
                const trailMaterial = new THREE.MeshBasicMaterial({
                    color: color,
                    transparent: true,
                    opacity: 0.4 - (t * 0.4 / trailLength)
                });
                const trailPoint = new THREE.Mesh(trailGeometry, trailMaterial);
                trailPoint.position.copy(particle.position);
                scene.add(trailPoint);
                particle.userData.trail.push(trailPoint);
            }
        }
        
        particleGroup.add(particle);
        particles.push(particle);
    }
    
    scene.add(particleGroup);
    debug(`Created ${CONFIG.particleCount} particles with physical properties`);
}

// Create an improved aura connector between orbs
function createTether(targetPosition, relationship) {
    // Calculate direction vector from this window to target
    const deltaX = targetPosition.x - windowPosition.x;
    const deltaY = targetPosition.y - windowPosition.y;
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    
    if (distance === 0) {
        return null; // Skip if distance is zero
    }
    
    // Normalize direction
    const dirX = deltaX / distance;
    const dirY = deltaY / distance;
    
    // Convert screen coordinates to 3D world coordinates
    const worldDirX = dirX;
    const worldDirY = -dirY; // Invert Y because screen Y is down, but world Y is up
    
    // Determine color based on relationship
    const tetherColor = relationship === "parent" ? 
        CONFIG.colors.parentTether : 
        CONFIG.colors.childTether;
    
    // Create aura effect with custom geometry and shader
    // Create a custom curve for the path with more natural bending
    const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 0, 0), // Start at orb center
        new THREE.Vector3(
            worldDirX * 2,  // Control point closer to start
            worldDirY * 2, 
            (worldDirX * worldDirY) * 0.4
        ),
        new THREE.Vector3(
            worldDirX * 4,  // Middle control point
            worldDirY * 4,
            (worldDirX * worldDirY) * 0.2
        ),
        new THREE.Vector3(
            worldDirX * 6, // End point
            worldDirY * 6,
            0
        )
    ]);
    
    // Create more points along the curve for smoother aura
    const pathPoints = curve.getPoints(CONFIG.aura.segments);
    
    // Create a custom geometry for the aura
    const auraGeometry = new THREE.BufferGeometry();
    const positions = [];
    const colors = [];
    const opacities = [];
    const indices = [];
    
    // Create a ribbon-like geometry along the curve with varying width
    const baseColor = new THREE.Color(tetherColor);
    
    // Enhance the base color for more vibrant aura
    const enhancedColor = baseColor.clone().multiplyScalar(CONFIG.aura.colorIntensity);
    
    // Create cross-section points perpendicular to curve
    for (let i = 0; i < pathPoints.length; i++) {
        const point = pathPoints[i];
        const progress = i / (pathPoints.length - 1); // 0 to 1
        
        // Calculate tangent at this point
        const tangent = curve.getTangent(progress);
        
        // Create a perpendicular vector in the xz plane for width
        const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
        const binormal = new THREE.Vector3().crossVectors(tangent, normal).normalize();
        
        // Create bell curve distribution for width: wider near orbs, thinner in middle
        // Modified to be less thin in the middle for better visibility
        const widthMultiplier = 1 - Math.pow(Math.sin(progress * Math.PI), 0.7) * 0.5;
        const width = CONFIG.aura.width * widthMultiplier;
        
        // Height increases near orbs
        const heightMultiplier = 1 - Math.pow(Math.sin(progress * Math.PI), 0.6) * 0.3;
        const height = CONFIG.aura.verticalSpread * heightMultiplier;
        
        // Create cross-section vertices with more points for smoother aura
        const crossSectionPoints = 12; // Increased from 8 for smoother shape
        for (let j = 0; j < crossSectionPoints; j++) {
            const angle = (j / crossSectionPoints) * Math.PI * 2;
            
            // Elliptical cross-section: wider than tall
            const x = Math.cos(angle) * width;
            const y = Math.sin(angle) * height;
            
            // Calculate position
            const pos = new THREE.Vector3(
                point.x + normal.x * x + binormal.x * y,
                point.y + normal.y * x + binormal.y * y,
                point.z + normal.z * x + binormal.z * y
            );
            
            positions.push(pos.x, pos.y, pos.z);
            
            // Calculate color and opacity based on distance from center and progress
            const distFromCenter = Math.sqrt(x*x + y*y);
            const maxDist = Math.max(width, height);
            
            // Modified opacity calculation for more visible aura
            // Less fade-out in the middle, stronger overall
            let opacity = 1 - (distFromCenter / maxDist); // Fade from center
            opacity *= 1 - Math.pow(Math.sin(progress * Math.PI), 0.2) * 0.7; // Less fade in middle
            opacity = Math.max(0, opacity);
            
            // Add enhanced glow at the edges
            if (distFromCenter > maxDist * (1 - CONFIG.aura.edgeFeather)) {
                const edgeFactor = (distFromCenter - maxDist * (1 - CONFIG.aura.edgeFeather)) / 
                                  (maxDist * CONFIG.aura.edgeFeather);
                opacity *= (1 - edgeFactor * (1 - CONFIG.aura.edgeGlow));
            }
            
            // Overall stronger opacity
            opacities.push(opacity * CONFIG.aura.maxOpacity);
            
            // Enhanced color transitions based on distance from core
            const colorIntensity = 1 - (distFromCenter / maxDist) * CONFIG.aura.fadeDistance;
            const color = enhancedColor.clone();
            
            // Make edges more intense and brighter
            const hsl = {};
            color.getHSL(hsl);
            hsl.l = Math.min(1, hsl.l + (1 - colorIntensity) * 0.5); // Lighter at edges
            hsl.s = Math.max(0.1, hsl.s - (1 - colorIntensity) * 0.3); // Less saturated at edges
            color.setHSL(hsl.h, hsl.s, hsl.l);
            
            colors.push(color.r, color.g, color.b);
        }
    }
    
    // Create indices for triangles
    const crossSectionPoints = 12; // Match the number used above
    for (let i = 0; i < pathPoints.length - 1; i++) {
        const baseIndex = i * crossSectionPoints;
        for (let j = 0; j < crossSectionPoints; j++) {
            const nextJ = (j + 1) % crossSectionPoints;
            
            // First triangle
            indices.push(
                baseIndex + j,
                baseIndex + nextJ,
                baseIndex + j + crossSectionPoints
            );
            
            // Second triangle
            indices.push(
                baseIndex + nextJ,
                baseIndex + nextJ + crossSectionPoints,
                baseIndex + j + crossSectionPoints
            );
        }
    }
    
    // Set attributes to the geometry
    auraGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    auraGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    auraGeometry.setAttribute('opacity', new THREE.Float32BufferAttribute(opacities, 1));
    auraGeometry.setIndex(indices);
    
    // Create improved material for the aura with more dynamic effects
    const auraMaterial = new THREE.ShaderMaterial({
        uniforms: {
            time: { value: 0 },
            baseColor: { value: new THREE.Color(tetherColor) },
            pulseSpeed: { value: CONFIG.aura.pulseSpeed },
            pulseIntensity: { value: CONFIG.aura.pulseIntensity }
        },
        vertexShader: `
            attribute float opacity;
            varying vec3 vColor;
            varying float vOpacity;
            
            void main() {
                vColor = color;
                vOpacity = opacity;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform float time;
            uniform vec3 baseColor;
            uniform float pulseSpeed;
            uniform float pulseIntensity;
            varying vec3 vColor;
            varying float vOpacity;
            
            void main() {
                // Enhanced flow and pulse effects
                float flow = sin(time * pulseSpeed) * 0.5 + 0.5;
                float pulse = cos(time * 0.7) * 0.5 + 0.5;
                
                // Combine multiple sine waves for more organic pulsing
                float organicPulse = 
                    (sin(time * 1.1) * 0.3 + 
                     sin(time * 2.3) * 0.2 + 
                     sin(time * 3.7) * 0.1) * 
                    pulseIntensity + 1.0;
                
                // Final color with enhanced pulsing effects
                vec3 finalColor = vColor * (0.7 + flow * 0.3) * organicPulse;
                
                gl_FragColor = vec4(finalColor, vOpacity * (0.9 + pulse * 0.1));
            }
        `,
        transparent: true,
        vertexColors: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide // Render both sides of the aura
    });
    
    // Create the aura mesh
    const tetherLine = new THREE.Mesh(auraGeometry, auraMaterial);
    
    // Store the curve for particle movement with improved flow paths
    tetherLine.userData = {
        targetId: targetPosition.id || 'unknown',
        relationship: relationship,
        targetPosition: targetPosition,
        curve: curve, // Store the curve for particle movement
        flowPath: {
            above: createFlowPath(curve, CONFIG.aura.flowPathOffset, 0.2), // Add slight sideways offset
            below: createFlowPath(curve, -CONFIG.aura.flowPathOffset, -0.2)
        }
    };
    
    tetherLine.visible = true;
    scene.add(tetherLine);
    tetherLines.push(tetherLine);
    
    debug(`Created aura tether to ${relationship}: direction (${worldDirX.toFixed(2)}, ${worldDirY.toFixed(2)})`);
    return tetherLine;
}

// Create an improved offset flow path along the tether
function createFlowPath(baseCurve, verticalOffset, sidewaysOffset = 0) {
    const points = baseCurve.getPoints(30); // Sample points from the base curve
    const offsetPoints = [];
    
    for (let i = 0; i < points.length; i++) {
        const t = i / (points.length - 1);
        const tangent = baseCurve.getTangent(t);
        
        // Create offset perpendicular to tangent with additional sideways component
        // This creates more separation between up and down paths
        const sideVector = new THREE.Vector3(tangent.y, -tangent.x, 0).normalize();
        
        const offset = new THREE.Vector3(
            -tangent.z * verticalOffset + sideVector.x * sidewaysOffset,
            verticalOffset + sideVector.y * sidewaysOffset,
            tangent.x * verticalOffset + sidewaysOffset
        );
        
        // Add offset to point with slight variation based on position along curve
        // More variation in the middle, less at endpoints
        const variation = Math.sin(t * Math.PI) * 0.15;
        const jitterOffset = new THREE.Vector3(
            (Math.random() - 0.5) * variation,
            (Math.random() - 0.5) * variation,
            (Math.random() - 0.5) * variation
        );
        
        offsetPoints.push(points[i].clone().add(offset).add(jitterOffset));
    }
    
    // Create a smoother curve through these points
    return new THREE.CatmullRomCurve3(offsetPoints);
}

// Update tethers for both parent and child connections
function updateTethers() {
    // Remove all existing tethers
    while (tetherLines.length > 0) {
        const tether = tetherLines.pop();
        scene.remove(tether);
    }
    
    // Check if we have a parent to connect to
    if (parentPosition) {
        createTether(parentPosition, "parent");
    }
    
    // Create tethers to all children
    for (const childId in childPositions) {
        const childPosition = childPositions[childId];
        childPosition.id = childId; // Store ID with position
        createTether(childPosition, "child");
    }
    
    // If no connections at all, log it
    if (!parentPosition && Object.keys(childPositions).length === 0) {
        debug("No connections to other windows");
    }
    
    // Update any flowing particles to use the new tethers
    for (const particle of particles) {
        if (particle.userData.state === 'transferring') {
            if (particle.userData.trail) {
                particle.userData.trail.forEach(t => t.visible = false);
            }
            // Force back to orbit since tethers have changed
            returnToMainOrbit(particle);
        }
    }
}

// Improve particle flow visibility
function startParticleTransfer(particle, tether) {
    // Use either the above or below curve based on direction
    // This is now consistently applied - outgoing always use top path, incoming always use bottom
    const targetIsMain = particle.userData.orbTarget === 'main';
    const flowPath = targetIsMain ? 
                    tether.userData.flowPath.below :  // If returning to main orb, use below path
                    tether.userData.flowPath.above;   // If going to remote orb, use above path
    
    // Store remote orb ID
    particle.userData.remoteOrbId = tether.userData.targetId;
    
    // Initialize transfer state
    particle.userData.state = 'transferring';
    particle.userData.tetherPath = flowPath;
    
    // For new transfers, start at the appropriate end of the path
    if (targetIsMain) {
        // If returning to main, start at the far end (1.0)
        particle.userData.tetherProgress = 0.98;
    } else {
        // If going to remote, start at the near end (0.0)
        particle.userData.tetherProgress = 0.02;
        // Position at the beginning of the path
        const pathStart = flowPath.getPointAt(0.02);
        particle.position.copy(pathStart);
    }
    
    // Adjust particle appearance for transfer - different colors based on direction
    let transferColor;
    if (targetIsMain) {
        transferColor = new THREE.Color(0x60efff); // Blue for returning particles
    } else {
        transferColor = new THREE.Color(0xffcc00); // Gold for outgoing particles
    }
    
    // Apply the color with higher intensity
    particle.material.color.set(transferColor);
    particle.material.emissive.set(transferColor);
    particle.material.emissiveIntensity = 2.0; // Make it glow brighter
    
    // Make particle larger and fully opaque during transfer
    particle.scale.set(2.0, 2.0, 2.0); // Bigger for more visibility
    particle.material.opacity = 1.0;
    
    // Create a fresh trail if one doesn't exist or refresh existing trail
    createOrRefreshTrail(particle, transferColor);
    
    debug(`Particle began transfer along ${targetIsMain ? 'bottom' : 'top'} path to ${tether.userData.targetId}`);
}

// Create or refresh particle trail
function createOrRefreshTrail(particle, color) {
    // If trail already exists, just update colors
    if (particle.userData.trail && particle.userData.trail.length > 0) {
        particle.userData.trail.forEach((trailPoint, i) => {
            // Update trail colors
            const trailOpacity = 0.7 - (i * 0.7 / particle.userData.trail.length);
            trailPoint.material.color.set(color);
            trailPoint.material.opacity = trailOpacity;
            trailPoint.visible = true;
            
            // Make trail points larger for better visibility
            trailPoint.scale.set(0.8 - (i * 0.1), 0.8 - (i * 0.1), 0.8 - (i * 0.1));
        });
        return;
    }
    
    // Create new trail
    const trailLength = 8; // Longer trail for better visibility
    particle.userData.trail = [];
    
    for (let t = 0; t < trailLength; t++) {
        const size = particle.userData.originalSize * (0.8 - t * 0.05);
        const trailGeometry = new THREE.SphereGeometry(size, 6, 6);
        
        // Calculate decreasing opacity for trail
        const trailOpacity = 0.7 - (t * 0.7 / trailLength);
        
        const trailMaterial = new THREE.MeshBasicMaterial({
            color: color,
            transparent: true,
            opacity: trailOpacity,
            blending: THREE.AdditiveBlending // Add glow effect
        });
        
        const trailPoint = new THREE.Mesh(trailGeometry, trailMaterial);
        trailPoint.position.copy(particle.position);
        scene.add(trailPoint);
        particle.userData.trail.push(trailPoint);
    }
}

// Update particles with improved flow dynamics
function updateParticles(elapsedTime) {
    // Apply physics simulation with fixed timestep for stability
    const timeStep = CONFIG.physics.timeStep;
    const orbMass = CONFIG.physics.orbMass;
    
    // Get all active tethers
    const activeTethers = tetherLines.filter(tether => tether.visible);
    
    // Update tether material time uniform for flow effect
    for (const tether of activeTethers) {
        if (tether.material && tether.material.uniforms && tether.material.uniforms.time) {
            tether.material.uniforms.time.value = elapsedTime;
        }
    }
    
    // Add this: Force more frequent particle flows for demonstration
    // Periodically force particle flows along each tether for visual effect
    if (Math.random() < 0.02 && particles.length > 0 && activeTethers.length > 0) { // 2% chance each frame
        // Select random tether and particle for forced flow
        const tether = activeTethers[Math.floor(Math.random() * activeTethers.length)];
        
        // Filter suitable particles (orbiting and not recently transferred)
        const suitableParticles = particles.filter(p => 
            p.userData.state === 'orbiting' && 
            (elapsedTime * 1000) - (p.userData.lastFlowAttempt || 0) > CONFIG.physics.transferInterval
        );
        
        if (suitableParticles.length > 0) {
            const particle = suitableParticles[Math.floor(Math.random() * suitableParticles.length)];
            startParticleTransfer(particle, tether);
        }
    }
    
    // Update particles based on gravitational forces and tether influence
    for (const particle of particles) {
        const { mass, velocity, acceleration, state, orbTarget } = particle.userData;
        
        // Reset acceleration
        acceleration.set(0, 0, 0);
        
        // Calculate gravitational force from main orb
        if (state !== 'transferring' || orbTarget === 'main') {
            applyGravitationalForce(particle, mainOrb.position, orbMass);
        }
        
        // Randomly select particles to flow along tethers
        if (state === 'orbiting' && activeTethers.length > 0) {
            const now = elapsedTime * 1000; // Convert to ms
            const timeSinceLastAttempt = now - (particle.userData.lastFlowAttempt || 0);
            
            // Only attempt flow if enough time has passed since last attempt
            if (timeSinceLastAttempt > CONFIG.physics.transferInterval) {
                particle.userData.lastFlowAttempt = now;
                
                // Random chance to start flowing, higher chance when closer to orbit edge
                // This helps create natural flow from the edges rather than the center
                const distanceFromOrb = particle.position.length();
                const orbitPosition = (distanceFromOrb - CONFIG.physics.minOrbitalDistance) / 
                                    (CONFIG.particleDistanceRange.max - CONFIG.physics.minOrbitalDistance);
                
                // Higher probability for particles near outer edge
                const flowProb = CONFIG.physics.flowProbability * (0.2 + 0.8 * Math.pow(orbitPosition, 2));
                
                if (Math.random() < flowProb) {
                    // Select a random active tether
                    const tether = activeTethers[Math.floor(Math.random() * activeTethers.length)];
                    startParticleTransfer(particle, tether);
                }
            }
        }
        
        // Handle particles transferring along tethers
        if (state === 'transferring') {
            // If tether is no longer available, return to orbiting
            if (!particle.userData.tetherPath || 
                !activeTethers.some(t => t.userData.targetId === particle.userData.remoteOrbId)) {
                particle.userData.state = 'orbiting';
                particle.userData.orbTarget = 'main';
            } else {
                // Continue transferring along tether
                updateParticleTransfer(particle, elapsedTime, timeStep);
                continue; // Skip regular physics update
            }
        }
        
        // Add inter-particle interactions (subtle repulsion/attraction)
        if (Math.random() < 0.2) { // Process only a subset for performance
            for (const otherParticle of particles) {
                if (particle === otherParticle) continue;
                
                const distance = particle.position.distanceTo(otherParticle.position);
                
                // Only interact with nearby particles
                if (distance < CONFIG.physics.particleInteractionRange) {
                    // Apply a small repulsive force
                    const force = particle.position.clone().sub(otherParticle.position).normalize()
                        .multiplyScalar(CONFIG.physics.particleRepulsion / (distance * distance));
                    
                    acceleration.add(force);
                    
                    // If particles are very close, they can affect each other's color
                    if (distance < 0.1 && Math.random() < 0.05) {
                        // Occasionally blend colors
                        blendParticleColors(particle, otherParticle);
                    }
                }
            }
        }
        
        // Apply velocity verlet integration
        velocity.add(acceleration.clone().multiplyScalar(timeStep));
        velocity.multiplyScalar(CONFIG.physics.dampingFactor);
        
        // Limit maximum velocity for simulation stability
        const speed = velocity.length();
        if (speed > CONFIG.physics.maxSpeed) {
            velocity.multiplyScalar(CONFIG.physics.maxSpeed / speed);
        }
        
        // Update position
        particle.position.add(velocity.clone().multiplyScalar(timeStep));
        
        // Prevent particles from getting too close to the center (enforce minimum orbit)
        if (state === 'orbiting') {
            const toCenter = particle.position.clone();
            const distToCenter = toCenter.length();
            
            if (distToCenter < CONFIG.physics.minOrbitalDistance) {
                // Push the particle outward to maintain minimum orbital distance
                toCenter.normalize()
                       .multiplyScalar(CONFIG.physics.minOrbitalDistance - distToCenter);
                particle.position.add(toCenter);
                
                // Adjust velocity to be more tangential (prevent direct fall into center)
                const radialVelocity = particle.position.clone().normalize()
                    .multiplyScalar(particle.position.clone().normalize().dot(velocity));
                
                const tangentialVelocity = velocity.clone().sub(radialVelocity);
                
                // Increase tangential component and reduce radial component
                velocity.copy(tangentialVelocity.multiplyScalar(1.1).sub(radialVelocity.multiplyScalar(0.4)));
            }
        }
        
        // Update particle trail
        updateParticleTrail(particle);
        
        // Calculate and update orbital parameters
        updateOrbitalParameters(particle);
        
        // Visual effects based on orbital parameters
        applyVisualEffects(particle, elapsedTime);
        
        // For transferring particles, increase their visibility and motion
        if (particle.userData.state === 'transferring') {
            // Make transferring particles pulse more visibly
            const pulse = 1.0 + 0.2 * Math.sin(elapsedTime * 10 + particle.userData.movementOffset);
            particle.scale.set(pulse * 1.5, pulse * 1.5, pulse * 1.5);
            
            // Make trail more visible
            if (particle.userData.trail && particle.userData.trail.length > 0) {
                particle.userData.trail.forEach(t => {
                    if (t.visible) {
                        t.material.opacity *= 1.2; // Boost opacity
                    }
                });
            }
        }
    }
}

// Apply gravitational force to a particle from a center of mass
function applyGravitationalForce(particle, centerPosition, centerMass) {
    // Calculate vector from particle to center
    const forceVector = centerPosition.clone().sub(particle.position);
    const distance = Math.max(forceVector.length(), CONFIG.physics.minDistance);
    
    // Newton's law of gravitation: F = G * (m1 * m2) / r^2
    const forceMagnitude = CONFIG.physics.gravitationalConstant * 
        centerMass * particle.userData.mass / (distance * distance);
    
    // Convert to acceleration: a = F / m
    const acceleration = forceVector.normalize().multiplyScalar(forceMagnitude / particle.userData.mass);
    
    // Add to particle's acceleration
    particle.userData.acceleration.add(acceleration);
}

// Update a transferring particle with smoother movement
function updateParticleTransfer(particle, elapsedTime, timeStep) {
    const tetherPath = particle.userData.tetherPath;
    
    if (!tetherPath) return;
    
    // Current progress along path (0-1)
    let progress = particle.userData.tetherProgress;
    
    // Determine direction based on orbit target
    const isReturning = particle.userData.orbTarget === 'main';
    const direction = isReturning ? -1 : 1; // -1 when returning, 1 when going out
    
    // Determine speed based on progress with smoother acceleration/deceleration
    // Speed is higher in the middle, slower at ends
    const speedCurve = Math.sin((progress * Math.PI) * 0.8 + Math.PI * 0.1); // Shifted sine curve
    const speedBase = 0.008; // Increased base speed for more visible flow
    const speed = speedBase * (0.5 + speedCurve * 0.5) * direction;
    
    // Update progress
    progress += speed;
    
    // Constrain progress between 0 and 1
    progress = Math.max(0.001, Math.min(0.999, progress));
    particle.userData.tetherProgress = progress;
    
    // Get position along path with slight random offset for natural movement
    const pathPoint = tetherPath.getPointAt(progress);
    const pathTangent = tetherPath.getTangentAt(progress);
    
    // Add slight perpendicular oscillation for more interesting movement
    const perpVector = new THREE.Vector3(pathTangent.y, -pathTangent.x, 0).normalize();
    const oscAmount = Math.sin(elapsedTime * 5 + particle.userData.movementOffset) * 0.1;
    
    // Add some randomness to the path
    const deviation = CONFIG.physics.tetherPathDeviation * (1 - Math.abs(progress - 0.5) * 1.5); // More in middle
    const randomOffset = new THREE.Vector3(
        (Math.random() - 0.5) * deviation,
        (Math.random() - 0.5) * deviation,
        (Math.random() - 0.5) * deviation
    );
    
    // Apply oscillation and randomness to position
    const finalPosition = pathPoint.clone()
        .add(perpVector.multiplyScalar(oscAmount))
        .add(randomOffset);
    
    // Update position
    particle.position.copy(finalPosition);
    
    // Update trail with staggered positions
    updateParticleTrail(particle);
    
    // Check for transfer completion
    if ((direction > 0 && progress > 0.98) || (direction < 0 && progress < 0.02)) {
        completeParticleTransfer(particle, elapsedTime);
    }
}

// Complete particle transfer with smooth transition to orbiting
function completeParticleTransfer(particle, elapsedTime) {
    const isReturningToMain = particle.userData.orbTarget === 'main';
    
    if (isReturningToMain) {
        // Returned to main orb - resume normal orbiting
        returnToMainOrbit(particle);
    } else {
        // Reached remote orb - orbit temporarily before returning
        particle.userData.state = 'orbiting';
        particle.userData.orbTarget = 'remote';
        
        // Reset to original color with enhanced brightness
        const originalColor = new THREE.Color(particle.userData.originalColor);
        particle.material.color.set(originalColor);
        particle.material.emissive.set(originalColor);
        particle.material.emissiveIntensity = 0.8;
        
        // Position correctly at the remote orb position
        // Use the end point of the tether path as the remote orb center
        const tetherEnd = particle.userData.tetherPath.getPoint(1);
        
        // Create an orbit around the remote orb location
        const orbitRadius = CONFIG.physics.minOrbitalDistance * 1.2;
        const randomDir = new THREE.Vector3().randomDirection();
        
        // Calculate position and set it
        const orbitPosition = tetherEnd.clone().add(
            randomDir.multiplyScalar(orbitRadius + Math.random() * 0.5)
        );
        
        particle.position.copy(orbitPosition);
        
        // Generate proper orbital velocity for circular orbit
        const orbSpeed = Math.sqrt(CONFIG.physics.gravitationalConstant * 
                                  CONFIG.physics.orbMass / orbitRadius);
        
        // Calculate tangential velocity vector
        const toCenter = tetherEnd.clone().sub(orbitPosition).normalize();
        const perpDir = new THREE.Vector3().crossVectors(toCenter, new THREE.Vector3(0, 1, 0)).normalize();
        
        if (perpDir.lengthSq() < 0.1) {
            perpDir.crossVectors(toCenter, new THREE.Vector3(1, 0, 0)).normalize();
        }
        
        // Set orbital velocity
        particle.userData.velocity.copy(perpDir.multiplyScalar(orbSpeed * 0.8));
        
        // Hide trail gradually
        if (particle.userData.trail) {
            let i = 0;
            const fadeInterval = setInterval(() => {
                if (i >= particle.userData.trail.length) {
                    clearInterval(fadeInterval);
                    return;
                }
                particle.userData.trail[i].visible = false;
                i++;
            }, 50);
        }
        
        // After a while, send it back to main orb
        setTimeout(() => {
            if (particle.userData.state === 'orbiting' && particle.userData.orbTarget === 'remote') {
                // Find tether back to main orb
                const tethers = tetherLines.filter(t => t.visible);
                if (tethers.length > 0) {
                    // Switch direction to coming back
                    particle.userData.orbTarget = 'main';
                    
                    // Start transfer back using the appropriate tether
                    startParticleTransfer(particle, tethers[0]);
                }
            }
        }, 1500 + Math.random() * 2000); // 1.5-3.5 seconds at remote orb (reduced for more active flow)
    }
}

// Return particle to orbiting around main orb
function returnToMainOrbit(particle) {
    // Reset state
    particle.userData.state = 'orbiting';
    particle.userData.orbTarget = 'main';
    particle.userData.tetherPath = null;
    particle.userData.remoteOrbId = null;
    
    // Reset to original color
    const originalColor = new THREE.Color(particle.userData.originalColor);
    particle.material.color.set(originalColor);
    particle.material.emissive.set(originalColor);
    
    // Reset size
    particle.scale.set(1, 1, 1);
    particle.material.opacity = 0.7 + Math.random() * 0.3;
    
    // Position it in orbit around the main orb (not too close)
    const distance = CONFIG.physics.minOrbitalDistance + Math.random() * 1.5;
    const direction = new THREE.Vector3().randomDirection();
    
    particle.position.copy(direction).multiplyScalar(distance);
    
    // Give it a proper orbital velocity that's tangential to the radius
    const orbitalSpeed = Math.sqrt(CONFIG.physics.gravitationalConstant * 
                                  CONFIG.physics.orbMass / distance);
    
    // Create orbital velocity perpendicular to radial direction
    const radialDir = particle.position.clone().normalize();
    const perpAxis = new THREE.Vector3(0, 1, 0);
    if (Math.abs(radialDir.dot(perpAxis)) > 0.9) {
        perpAxis.set(1, 0, 0); // Use x-axis if too close to y-axis
    }
    
    // Calculate orbital velocity vector
    const orbitalVelocity = new THREE.Vector3()
        .crossVectors(radialDir, perpAxis)
        .normalize()
        .multiplyScalar(orbitalSpeed * (0.8 + Math.random() * 0.2));
    
    particle.userData.velocity.copy(orbitalVelocity);
}

// Find closest point on a curve to a given position
function getClosestPointOnPath(position, path, segments = 50) {
    let closestPoint = null;
    let closestDistance = Infinity;
    let closestProgress = 0;
    
    // Sample points along the path
    for (let i = 0; i <= segments; i++) {
        const progress = i / segments;
        const point = path.getPointAt(progress);
        const distance = position.distanceTo(point);
        
        if (distance < closestDistance) {
            closestDistance = distance;
            closestPoint = point;
            closestProgress = progress;
        }
    }
    
    return { point: closestPoint, distance: closestDistance, progress: closestProgress };
}

// Update particle trail positions
function updateParticleTrail(particle) {
    const trail = particle.userData.trail;
    if (!trail || trail.length === 0) return;
    
    // Current position becomes position of first trail point
    const positions = [particle.position.clone()];
    
    // Get previous positions from existing trail
    for (let i = 0; i < trail.length - 1; i++) {
        positions.push(trail[i].position.clone());
    }
    
    // Update trail positions
    for (let i = 0; i < trail.length; i++) {
        trail[i].position.copy(positions[i]);
    }
}

// Calculate and update orbital parameters for visualization
function updateOrbitalParameters(particle) {
    if (particle.userData.state !== 'orbiting' || particle.userData.orbTarget !== 'main') return;
    
    const G = CONFIG.physics.gravitationalConstant;
    const M = CONFIG.physics.orbMass;
    const m = particle.userData.mass;
    
    // Position and velocity relative to central body
    const position = particle.position.clone();
    const velocity = particle.userData.velocity.clone();
    
    // Calculate distance and speed
    const r = position.length();
    const v = velocity.length();
    
    // Skip if too close to center
    if (r < CONFIG.physics.minDistance) return;
    
    // Calculate specific orbital energy (energy per unit mass)
    // E = v²/2 - G*M/r
    const orbitalEnergy = 0.5 * v * v - G * M / r;
    
    // Calculate specific angular momentum (angular momentum per unit mass)
    // L = r × v
    const angularMomentum = position.clone().cross(velocity).length();
    
    // Calculate eccentricity vector
    // e = ((v² - G*M/r)r - (r·v)v) / (G*M)
    const rdotv = position.dot(velocity);
    
    const eccentricity = Math.sqrt(
        1 + (2 * orbitalEnergy * angularMomentum * angularMomentum) / (G * G * M * M)
    );
    
    // Store orbital parameters
    particle.userData.orbitalEnergy = orbitalEnergy;
    particle.userData.angularMomentum = angularMomentum;
    particle.userData.eccentricity = eccentricity;
}

// Apply visual effects based on orbital parameters
function applyVisualEffects(particle, elapsedTime) {
    if (particle.userData.state !== 'orbiting') return;
    
    const { eccentricity, orbitalEnergy } = particle.userData;
    
    // Determine particle opacity based on energy
    // Higher energy = more transparent (moving faster or further out)
    if (orbitalEnergy > 0) {
        // Positive energy = hyperbolic/escape orbit
        particle.material.opacity = Math.max(0.3, 0.8 - orbitalEnergy * 10);
    } else {
        // Negative energy = elliptical orbit
        // More negative = more bound = more opaque
        particle.material.opacity = Math.min(0.9, 0.6 - orbitalEnergy * 5);
    }
    
    // Determine particle color based on eccentricity
    if (eccentricity > 0.8) {
        // High eccentricity orbits shift toward red
        const originalColor = new THREE.Color(particle.userData.originalColor);
        const highEccentricityColor = new THREE.Color(0xff5500);
        const blend = Math.min(1, (eccentricity - 0.8) * 5);
        
        particle.material.color.lerpColors(originalColor, highEccentricityColor, blend);
        particle.material.emissive.lerpColors(originalColor, highEccentricityColor, blend);
    }
    
    // Pulse size based on time
    const pulse = 1 + 0.1 * Math.sin(elapsedTime * 2 + particle.userData.movementOffset);
    const sizeScale = particle.userData.originalSize * pulse;
    
    // Apply pulsing effect
    particle.scale.set(sizeScale, sizeScale, sizeScale);
}

// Blend colors between two interacting particles
function blendParticleColors(particle1, particle2) {
    // Get current colors
    const color1 = particle1.material.color.clone();
    const color2 = particle2.material.color.clone();
    
    // Blend colors slightly
    const blendFactor = 0.1;
    const blendedColor1 = new THREE.Color().lerpColors(color1, color2, blendFactor);
    const blendedColor2 = new THREE.Color().lerpColors(color2, color1, blendFactor);
    
    // Apply blended colors
    particle1.material.color.copy(blendedColor1);
    particle1.material.emissive.copy(blendedColor1);
    
    particle2.material.color.copy(blendedColor2);
    particle2.material.emissive.copy(blendedColor2);
}

// Set up event listeners
function setupEventListeners() {
    // Listen for window resize
    window.addEventListener('resize', onWindowResize, false);
    
    // Listen for mouse movement for interaction
    window.addEventListener('mousemove', onMouseMove, false);
    
    // Listen for keyboard controls
    window.addEventListener('keydown', event => {
        if (event.code === 'Space') {
            // Toggle tether visibility for debugging
            for (const tether of tetherLines) {
                tether.visible = !tether.visible;
            }
            debug(`Tether visibility toggled`);
        }
    });
    
    // Listen for window storage events (for cross-window communication)
    window.addEventListener('storage', event => {
        if (event.key === 'entangledWindows') {
            debug('Detected window data change');
            checkWindowPosition();
        }
    });
    
    // Listen for window close to clean up
    window.addEventListener('beforeunload', () => {
        // Remove this window from the registry
        const storedWindowData = localStorage.getItem('entangledWindows');
        if (storedWindowData) {
            try {
                const windowData = JSON.parse(storedWindowData);
                delete windowData[windowId];
                localStorage.setItem('entangledWindows', JSON.stringify(windowData));
            } catch (e) {
                debug(`Error during cleanup: ${e.message}`);
            }
        }
    });
}

// Handle window resize
function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    
    renderer.setSize(window.innerWidth, window.innerHeight);
    
    if (usePostProcessing && composer) {
        composer.setSize(window.innerWidth, window.innerHeight);
    }
}

// Handle mouse movement for interactive effects
function onMouseMove(event) {
    // Convert mouse position to normalized device coordinates (-1 to +1)
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    
    // Project mouse into 3D space
    raycaster.setFromCamera(mouse, camera);
    
    // Find intersections with the orb
    const intersects = raycaster.intersectObject(mainOrb);
    
    if (intersects.length > 0) {
        // When mouse is over the orb, make it slightly larger
        const hoverScale = 1.1;
        mainOrb.scale.lerp(new THREE.Vector3(hoverScale, hoverScale, hoverScale), 0.1);
    } else {
        // Reset to normal size when not hovering (while preserving the pulse effect)
        const currentPulse = 1 + Math.sin(clock.getElapsedTime() * CONFIG.orbPulseSpeed) * CONFIG.orbPulseAmount;
        mainOrb.scale.lerp(new THREE.Vector3(currentPulse, currentPulse, currentPulse), 0.1);
    }
}

// Create fallbacks for missing Three.js post-processing passes
function createFallbackEffects() {
    debug('Creating fallback effects for missing post-processing');
    
    // Fallback Unreal Bloom Pass
    if (typeof THREE.UnrealBloomPass === 'undefined') {
        THREE.UnrealBloomPass = function(resolution, strength, radius, threshold) {
            this.renderToScreen = false;
            this.strength = strength !== undefined ? strength : 1;
            this.radius = radius !== undefined ? radius : 0;
            this.threshold = threshold !== undefined ? threshold : 0;
        };
        
        THREE.UnrealBloomPass.prototype.render = function() {};
    }
    
    // Fallback Film Pass
    if (typeof THREE.FilmPass === 'undefined') {
        THREE.FilmPass = function() {
            this.renderToScreen = false;
        };
        
        THREE.FilmPass.prototype.render = function() {};
    }
    
    // Fallback Effect Composer with basic rendering
    if (typeof THREE.EffectComposer === 'undefined') {
        THREE.EffectComposer = function(renderer) {
            this.renderer = renderer;
        };
        
        THREE.EffectComposer.prototype.addPass = function() {};
        THREE.EffectComposer.prototype.setSize = function() {};
        THREE.EffectComposer.prototype.render = function() {
            this.renderer.render(scene, camera);
        };
    }
    
    // Fallback Render Pass
    if (typeof THREE.RenderPass === 'undefined') {
        THREE.RenderPass = function(scene, camera) {
            this.scene = scene;
            this.camera = camera;
            this.renderToScreen = false;
        };
    }
}

// Improved animation loop with more frequent particle updates
function animate() {
    requestAnimationFrame(animate);
    
    const elapsedTime = clock.getElapsedTime();
    
    // Update orb pulse with more pronounced effect
    if (mainOrb) {
        if (usePostProcessing && mainOrb.material.uniforms) {
            mainOrb.material.uniforms.time.value = elapsedTime;
        }
        
        // Enhanced pulsing effect
        const pulse = 1 + Math.sin(elapsedTime * CONFIG.orbPulseSpeed) * CONFIG.orbPulseAmount * 1.2;
        mainOrb.scale.set(pulse, pulse, pulse);
    }
    
    // Update particles with physics simulation
    updateParticles(elapsedTime);
    
    // Update aura animations with more dynamic time values
    for (const tetherLine of tetherLines) {
        if (tetherLine.material && tetherLine.material.uniforms) {
            // Use a combination of frequencies for more organic look
            tetherLine.material.uniforms.time.value = elapsedTime;
        }
    }
    
    // Periodically update window data
    if (Math.floor(elapsedTime * 1000) % CONFIG.syncInterval === 0) {
        updateWindowData();
    }
    
    // Render scene with post-processing if available
    if (usePostProcessing && composer) {
        try {
            composer.render();
        } catch (e) {
            debug(`Error in composer.render(): ${e.message}. Falling back to standard rendering.`);
            usePostProcessing = false;
            renderer.render(scene, camera);
        }
    } else {
        renderer.render(scene, camera);
    }
}

// Initialize everything once the DOM is ready
document.addEventListener('DOMContentLoaded', init);