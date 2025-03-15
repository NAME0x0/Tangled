// Import Three.js
import * as THREE from 'three';

// Constants and configuration - modified to match description
const PARTICLE_COUNT = 15000; // Reduced to match description's "10,000 to 1 million"
const SAMPLE_COUNT = 256; // Increased to 16x16 per description (for entanglement calculation)
const BASE_RADIUS = 2.0; // Set initial distribution radius to 2.0 as per description
const DAMPENING_FACTOR = 0.97; // Increased dampening to prevent drift
const ENTANGLEMENT_FORCE = 0.01; // Force of entanglement attraction
const NOISE_SCALE = 0.08; // Reduced noise for more predictable orbits
const DEFAULT_HUE = 128; // Default hue (blue-green) as per description
const CENTER_FORCE = 0.003; // Increased center attraction force
const TARGET_FORCE = 0.0003; // Reduced target force
const CENTER_STORAGE_KEY = 'electron_visualization_center'; // Key for storing center position
const INITIAL_STABILIZATION_TICKS = 50; // Number of simulation ticks to run on init for stability

// Black hole constants
const BLACK_HOLE_RADIUS = 0.25; // Visual size of black hole
const BLACK_HOLE_MASS = 10.0; // Mass for gravitational calculations
const GRAVITATIONAL_CONSTANT = 0.015; // Strength of gravity
const EVENT_HORIZON_RADIUS = 0.3; // Distance at which particles are consumed
const ACCRETION_DISK_INTENSITY = 0.7; // Intensity of the glowing accretion disk
const ORBITAL_VELOCITY_FACTOR = 0.8; // Initial orbital velocity factor

// Scene setup
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.z = 5;
const renderer = new THREE.WebGLRenderer({ 
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance'
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x000000, 0);
renderer.setPixelRatio(window.devicePixelRatio);
document.getElementById('container').appendChild(renderer.domElement);

// Add ambient light for better visibility
const ambientLight = new THREE.AmbientLight(0x333344, 1.0);
scene.add(ambientLight);

// Center position for particle system - determined based on screen center
let centerPosition = new THREE.Vector3(0, 0, 0);
let screenCenterPosition = new THREE.Vector3(0, 0, 0);

// Calculate the center of the screen in world coordinates
function calculateScreenCenter() {
    // Get the center of the screen in normalized device coordinates (-1 to +1)
    screenCenterPosition.set(0, 0, 0);
    
    // Convert NDC to world coordinates through camera unprojection
    screenCenterPosition.unproject(camera);
    
    // For perspective camera, we need to set z to a value in front of the camera
    screenCenterPosition.z = 0;
    
    console.log("Screen center calculated at:", screenCenterPosition);
    return screenCenterPosition;
}

// Initialize or load center position from localStorage
function initializeCenter() {
    try {
        // Always calculate the current screen center first
        calculateScreenCenter();
        
        // Check if we have a stored center
        const storedCenter = localStorage.getItem(CENTER_STORAGE_KEY);
        if (storedCenter) {
            const center = JSON.parse(storedCenter);
            // Use the screen center z-coordinate to ensure visibility
            centerPosition.set(center.x, center.y, screenCenterPosition.z);
            console.log('Loaded center position from localStorage:', centerPosition);
        } else {
            // Use screen center as the initial center
            centerPosition.copy(screenCenterPosition);
            saveCenter();
            console.log('Set initial center position to screen center:', centerPosition);
        }
    } catch (e) {
        console.error('Error loading center position from localStorage:', e);
        // Fallback to screen center
        centerPosition.copy(screenCenterPosition);
    }
}

// Save center position to localStorage
function saveCenter() {
    try {
        const centerData = {
            x: centerPosition.x,
            y: centerPosition.y,
            z: centerPosition.z
        };
        localStorage.setItem(CENTER_STORAGE_KEY, JSON.stringify(centerData));
    } catch (e) {
        console.error('Error saving center position to localStorage:', e);
    }
}

// Create black hole visualization
function createBlackHole() {
    // Create the black hole sphere (event horizon)
    const blackHoleGeometry = new THREE.SphereGeometry(BLACK_HOLE_RADIUS, 32, 32);
    const blackHoleMaterial = new THREE.MeshBasicMaterial({ 
        color: 0x000000,
        transparent: true,
        opacity: 0.9
    });
    const blackHole = new THREE.Mesh(blackHoleGeometry, blackHoleMaterial);
    blackHole.position.copy(centerPosition);
    scene.add(blackHole);
    
    // Create gravitational lensing effect (distortion ring)
    const distortionRingGeometry = new THREE.RingGeometry(
        BLACK_HOLE_RADIUS * 1.1, 
        BLACK_HOLE_RADIUS * 1.6, 
        64
    );
    const distortionRingMaterial = new THREE.MeshBasicMaterial({
        color: 0x6699ff,
        transparent: true,
        opacity: 0.2,
        side: THREE.DoubleSide
    });
    const distortionRing = new THREE.Mesh(distortionRingGeometry, distortionRingMaterial);
    distortionRing.position.copy(centerPosition);
    distortionRing.rotation.x = Math.PI / 2;
    scene.add(distortionRing);
    
    // Create accretion disk (glowing ring around black hole)
    const accretionDiskGeometry = new THREE.RingGeometry(
        BLACK_HOLE_RADIUS * 1.2,
        BLACK_HOLE_RADIUS * 3.0,
        64
    );
    
    // Custom shader material for accretion disk
    const accretionDiskMaterial = new THREE.ShaderMaterial({
        uniforms: {
            time: { value: 0 },
            innerRadius: { value: BLACK_HOLE_RADIUS * 1.2 },
            outerRadius: { value: BLACK_HOLE_RADIUS * 3.0 },
            intensity: { value: ACCRETION_DISK_INTENSITY }
        },
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform float time;
            uniform float innerRadius;
            uniform float outerRadius;
            uniform float intensity;
            varying vec2 vUv;
            
            void main() {
                // Calculate radius (0 to 1) within the ring
                float radius = distance(vUv, vec2(0.5, 0.5)) * 2.0;
                
                // Normalized position within the ring (0 at inner edge, 1 at outer edge)
                float normalizedPos = (radius - 0.5) * 2.0;
                
                // Create swirling pattern based on angle and time
                float angle = atan(vUv.y - 0.5, vUv.x - 0.5);
                float swirl = sin(angle * 8.0 + time * 0.5 + normalizedPos * 5.0) * 0.5 + 0.5;
                
                // Gradient from inner to outer edge (hotter near black hole)
                float heat = mix(1.0, 0.0, normalizedPos);
                
                // Combine effects
                vec3 color = mix(
                    vec3(0.8, 0.5, 0.0), // Orange-red (inner, hotter)
                    vec3(0.1, 0.2, 0.8), // Blue (outer, cooler)
                    normalizedPos
                );
                
                // Apply swirl pattern
                color *= (0.7 + swirl * 0.4);
                
                // Fade out at edges
                float alpha = (1.0 - normalizedPos) * intensity;
                alpha *= (0.7 + swirl * 0.3);
                
                gl_FragColor = vec4(color, alpha);
            }
        `,
        transparent: true,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });
    
    const accretionDisk = new THREE.Mesh(accretionDiskGeometry, accretionDiskMaterial);
    accretionDisk.position.copy(centerPosition);
    accretionDisk.rotation.x = Math.PI / 2;
    scene.add(accretionDisk);
    
    // Return references for animation
    return {
        blackHole,
        distortionRing,
        accretionDisk
    };
}

// Create point particle texture with soft edges
const particleTexture = new THREE.CanvasTexture(generateParticleTexture());

// Function to generate a soft particle texture
function generateParticleTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const context = canvas.getContext('2d');

    // Clear canvas
    context.fillStyle = 'black';
    context.fillRect(0, 0, canvas.width, canvas.height);

    // Create radial gradient
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const radius = canvas.width / 2;
    
    const gradient = context.createRadialGradient(
        centerX, centerY, 0,
        centerX, centerY, radius
    );
    
    // Simple white to transparent gradient for point-like particles
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
    gradient.addColorStop(0.2, 'rgba(255, 255, 255, 0.8)');
    gradient.addColorStop(0.5, 'rgba(200, 200, 255, 0.5)');
    gradient.addColorStop(1, 'rgba(0, 30, 100, 0)');

    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);
    
    return canvas;
}

// Perlin noise implementation for natural movement
function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
function lerp(a, b, t) { return a + t * (b - a); }

// Simplex noise implementation
function noise3D(x, y, z) {
    // Simple hash function
    const simpleHash = (x, y, z) => {
        return Math.sin(x * 12.9898 + y * 78.233 + z * 43.2364) * 43758.5453 % 1;
    };
    
    // Get integer coordinates
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const zi = Math.floor(z);
    
    // Get fractional parts
    const xf = x - xi;
    const yf = y - yi;
    const zf = z - zi;
    
    // Smooth interpolation factors
    const u = fade(xf);
    const v = fade(yf);
    const w = fade(zf);
    
    // Hash coordinates of the 8 cube corners
    const aaa = simpleHash(xi, yi, zi);
    const aba = simpleHash(xi, yi+1, zi);
    const aab = simpleHash(xi, yi, zi+1);
    const abb = simpleHash(xi, yi+1, zi+1);
    const baa = simpleHash(xi+1, yi, zi);
    const bba = simpleHash(xi+1, yi+1, zi);
    const bab = simpleHash(xi+1, yi, zi+1);
    const bbb = simpleHash(xi+1, yi+1, zi+1);
    
    // Tri-linear interpolation
    const x1 = lerp(
        lerp(lerp(aaa, baa, u), lerp(aba, bba, u), v),
        lerp(lerp(aab, bab, u), lerp(abb, bbb, u), v),
        w
    );
    
    return x1 * 2 - 1; // Transform from [0,1] to [-1,1]
}

// Combined simplex noise function with balanced directional influence
function simplex3D(x, y, z) {
    // Ensure balanced noise by using different frequency components
    const noise1 = noise3D(x * 0.01, y * 0.01, z * 0.01);
    const noise2 = noise3D(x * 0.02, y * 0.02, z * 0.02) * 0.5;
    const noise3 = noise3D(x * 0.04, y * 0.04, z * 0.04) * 0.25;
    
    // Calculate raw noise
    let noiseValue = (noise1 + noise2 + noise3);
    
    return noiseValue;
}

// Initialize center before creating particles
initializeCenter();

// Create the black hole
const blackHoleObjects = createBlackHole();

// Create particle system
const particles = [];
const particleGeometry = new THREE.BufferGeometry();
const particlePositions = new Float32Array(PARTICLE_COUNT * 3);
const particleVelocities = new Float32Array(PARTICLE_COUNT * 3);
const particleSizes = new Float32Array(PARTICLE_COUNT);
const particleColors = new Float32Array(PARTICLE_COUNT * 3);

// Initialize particles with positions, sizes, and velocities
// Using spherical distribution with radius 2.0 as described
for (let i = 0; i < PARTICLE_COUNT; i++) {
    const i3 = i * 3;
    
    // Random spherical coordinates as mentioned in the description
    const radius = BASE_RADIUS * (0.5 + Math.random() * 0.5); // Random radius from 1.0 to 2.0 for better initial orbits
    const theta = Math.acos(2 * Math.random() - 1); // Random theta angle
    const phi = 2 * Math.PI * Math.random();      // Random phi angle
    
    // Convert to Cartesian coordinates (centered around centerPosition)
    particlePositions[i3] = centerPosition.x + radius * Math.sin(theta) * Math.cos(phi);
    particlePositions[i3 + 1] = centerPosition.y + radius * Math.sin(theta) * Math.sin(phi);
    particlePositions[i3 + 2] = centerPosition.z + radius * Math.cos(theta);
    
    // Calculate initial velocity for stable orbit around black hole
    // Get direction vector from black hole to particle (radial direction)
    const dirX = particlePositions[i3] - centerPosition.x;
    const dirY = particlePositions[i3 + 1] - centerPosition.y;
    const dirZ = particlePositions[i3 + 2] - centerPosition.z;
    
    // Calculate tangential direction (perpendicular to radial)
    // For orbital motion, we need a velocity perpendicular to the radius vector
    // Create a random rotation axis perpendicular to the radial direction
    const rotationAxis = new THREE.Vector3();
    rotationAxis.set(
        Math.random() * 2 - 1,
        Math.random() * 2 - 1,
        Math.random() * 2 - 1
    );
    rotationAxis.normalize();
    
    // Make the rotation axis perpendicular to the radial direction
    const radialDir = new THREE.Vector3(dirX, dirY, dirZ).normalize();
    const perpVector = new THREE.Vector3().crossVectors(radialDir, rotationAxis).normalize();
    
    // Calculate orbital velocity magnitude based on distance (GM/r)^0.5
    const distance = Math.sqrt(dirX*dirX + dirY*dirY + dirZ*dirZ);
    const orbitalSpeed = Math.sqrt(GRAVITATIONAL_CONSTANT * BLACK_HOLE_MASS / distance) * ORBITAL_VELOCITY_FACTOR;
    
    // Apply orbital velocity in perpendicular direction
    particleVelocities[i3] = perpVector.x * orbitalSpeed;
    particleVelocities[i3 + 1] = perpVector.y * orbitalSpeed;
    particleVelocities[i3 + 2] = perpVector.z * orbitalSpeed;
    
    // Store particle data including noise offset for natural movement
    particles.push({
        noiseOffsetX: Math.random() * 100,
        noiseOffsetY: Math.random() * 100,
        noiseOffsetZ: Math.random() * 100,
        size: 0.1, // Fixed size of 0.1 units as mentioned
        noiseScale: 0.1 + Math.random() * 0.2, // Slightly varied noise influence
        rotationAxis: perpVector, // Store rotation axis for consistent orbits
        consumed: false // Flag to track if particle has been consumed by black hole
    });
    
    // Set fixed particle size (as described: "typically set to 0.1 units")
    particleSizes[i] = 0.1;
    
    // Initialize with default color
    const color = new THREE.Color();
    color.setHSL(DEFAULT_HUE / 255, 1.0, 0.5); // Default blue-green as described
    
    particleColors[i3] = color.r;
    particleColors[i3 + 1] = color.g;
    particleColors[i3 + 2] = color.b;
}

// Assign attributes to geometry
particleGeometry.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
particleGeometry.setAttribute('size', new THREE.BufferAttribute(particleSizes, 1));
particleGeometry.setAttribute('color', new THREE.BufferAttribute(particleColors, 3));

// Create particle material with proper blending
const particleMaterial = new THREE.ShaderMaterial({
    uniforms: {
        particleTexture: { value: particleTexture },
        time: { value: 0 }
    },
    vertexShader: `
        attribute float size;
        varying vec3 vColor;
        varying float vDistance;
        uniform float time;
        
        void main() {
            vColor = color;
            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
            
            // Simple distance-based sizing
            vDistance = length(mvPosition.xyz);
            float distanceFactor = 350.0 / vDistance;
            
            gl_PointSize = size * distanceFactor;
            gl_Position = projectionMatrix * mvPosition;
        }
    `,
    fragmentShader: `
        uniform sampler2D particleTexture;
        varying vec3 vColor;
        varying float vDistance;
        
        void main() {
            vec4 texColor = texture2D(particleTexture, gl_PointCoord);
            gl_FragColor = vec4(vColor, 1.0) * texColor;
            
            if (gl_FragColor.a < 0.05) discard;
        }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexColors: true
});

// Create the point cloud
const pointCloud = new THREE.Points(particleGeometry, particleMaterial);
scene.add(pointCloud);

// Window ID and pairing for entanglement
const windowId = Math.random().toString(36).substr(2, 9);
const urlParams = new URLSearchParams(window.location.search);
const pairId = urlParams.get('pairId');

// Animation and physics variables
let time = 0;
let lastSyncTime = 0;
const SYNC_INTERVAL = 100; // ms
let targetPosition = new THREE.Vector3(); // For circular movement
let entanglementValue = new THREE.Vector3(); // Average position from paired window
let stabilizationTicks = INITIAL_STABILIZATION_TICKS; // For initial stabilization

// Animation loop
function animate() {
    requestAnimationFrame(animate);
    time += 0.016; // ~60 FPS
    
    // Update material time
    particleMaterial.uniforms.time.value = time;
    
    // Update black hole accretion disk
    if (blackHoleObjects.accretionDisk) {
        blackHoleObjects.accretionDisk.material.uniforms.time.value = time;
        blackHoleObjects.accretionDisk.rotation.z += 0.002; // Rotate the accretion disk
    }
    
    // Update target position (used for entanglement)
    targetPosition.copy(centerPosition);
    
    // Update particle positions based on physics
    const positions = pointCloud.geometry.attributes.position.array;
    let consumedCount = 0; // Track how many particles have been consumed
    
    for (let i = 0; i < PARTICLE_COUNT; i++) {
        const i3 = i * 3;
        const particle = particles[i];
        
        // Skip consumed particles
        if (particle.consumed) {
            consumedCount++;
            continue;
        }
        
        // Update noise offsets for natural movement (slower updates)
        particle.noiseOffsetX += 0.002;
        particle.noiseOffsetY += 0.002;
        particle.noiseOffsetZ += 0.002;
        
        // Calculate current position
        const posX = positions[i3];
        const posY = positions[i3 + 1];
        const posZ = positions[i3 + 2];
        
        // Vector from particle to black hole
        const dirX = centerPosition.x - posX;
        const dirY = centerPosition.y - posY;
        const dirZ = centerPosition.z - posZ;
        
        // Distance from particle to black hole
        const distFromCenter = Math.sqrt(dirX*dirX + dirY*dirY + dirZ*dirZ);
        
        // Check if particle is within event horizon (consumed by black hole)
        if (distFromCenter <= EVENT_HORIZON_RADIUS) {
            // Mark particle as consumed
            particle.consumed = true;
            
            // Move particle to a position inside black hole (will be respawned later)
            positions[i3] = centerPosition.x;
            positions[i3 + 1] = centerPosition.y;
            positions[i3 + 2] = centerPosition.z;
            
            particleVelocities[i3] = 0;
            particleVelocities[i3 + 1] = 0;
            particleVelocities[i3 + 2] = 0;
            
            continue;
        }
        
        // Calculate gravity (inverse square law)
        const gravityStrength = GRAVITATIONAL_CONSTANT * BLACK_HOLE_MASS / (distFromCenter * distFromCenter);
        
        // Normalize direction vector
        const invDist = 1.0 / distFromCenter;
        const normalizedDirX = dirX * invDist;
        const normalizedDirY = dirY * invDist;
        const normalizedDirZ = dirZ * invDist;
        
        // Apply gravity force
        const gravityForceX = normalizedDirX * gravityStrength;
        const gravityForceY = normalizedDirY * gravityStrength;
        const gravityForceZ = normalizedDirZ * gravityStrength;
        
        // Calculate subtle noise influence for natural movement
        const noiseX = simplex3D(
            particle.noiseOffsetX, 
            particle.noiseOffsetY + 31.416, 
            particle.noiseOffsetZ + 42.123
        ) * NOISE_SCALE * particle.noiseScale;
        
        const noiseY = simplex3D(
            particle.noiseOffsetX + 43.3, 
            particle.noiseOffsetY + 17.1, 
            particle.noiseOffsetZ + 23.5
        ) * NOISE_SCALE * particle.noiseScale;
        
        const noiseZ = simplex3D(
            particle.noiseOffsetX + 83.3, 
            particle.noiseOffsetY + 47.7, 
            particle.noiseOffsetZ + 63.2
        ) * NOISE_SCALE * particle.noiseScale;
        
        // Add entanglement influence if paired
        let entanglementInfluenceX = 0;
        let entanglementInfluenceY = 0;
        let entanglementInfluenceZ = 0;
        
        if (entanglementValue.lengthSq() > 0) {
            const entanglementDistance = Math.sqrt(
                Math.pow(entanglementValue.x - posX, 2) +
                Math.pow(entanglementValue.y - posY, 2) +
                Math.pow(entanglementValue.z - posZ, 2)
            );
            
            if (entanglementDistance > 0) {
                // Normalize and apply entanglement force
                entanglementInfluenceX = (entanglementValue.x - posX) / entanglementDistance * ENTANGLEMENT_FORCE;
                entanglementInfluenceY = (entanglementValue.y - posY) / entanglementDistance * ENTANGLEMENT_FORCE;
                entanglementInfluenceZ = (entanglementValue.z - posZ) / entanglementDistance * ENTANGLEMENT_FORCE;
            }
        }
        
        // Update velocities based on all influences
        particleVelocities[i3] = particleVelocities[i3] * DAMPENING_FACTOR + 
                                gravityForceX + noiseX + entanglementInfluenceX;
        particleVelocities[i3 + 1] = particleVelocities[i3 + 1] * DAMPENING_FACTOR + 
                                    gravityForceY + noiseY + entanglementInfluenceY;
        particleVelocities[i3 + 2] = particleVelocities[i3 + 2] * DAMPENING_FACTOR + 
                                    gravityForceZ + noiseZ + entanglementInfluenceZ;
        
        // Hard velocity limit to prevent runaway acceleration
        const maxVelocity = 0.15; // Higher max velocity for orbital motion
        const velocityMagnitude = Math.sqrt(
            particleVelocities[i3] * particleVelocities[i3] + 
            particleVelocities[i3 + 1] * particleVelocities[i3 + 1] + 
            particleVelocities[i3 + 2] * particleVelocities[i3 + 2]
        );
        
        if (velocityMagnitude > maxVelocity) {
            const scaleFactor = maxVelocity / velocityMagnitude;
            particleVelocities[i3] *= scaleFactor;
            particleVelocities[i3 + 1] *= scaleFactor;
            particleVelocities[i3 + 2] *= scaleFactor;
        }
        
        // Update positions based on velocities
        positions[i3] += particleVelocities[i3];
        positions[i3 + 1] += particleVelocities[i3 + 1];
        positions[i3 + 2] += particleVelocities[i3 + 2];
    }
    
    // Respawn some consumed particles (emission from black hole jets)
    if (consumedCount > 0) {
        const respawnCount = Math.min(5, consumedCount); // Respawn up to 5 particles per frame
        
        let respawned = 0;
        for (let i = 0; i < PARTICLE_COUNT && respawned < respawnCount; i++) {
            if (particles[i].consumed) {
                const i3 = i * 3;
                
                // Generate random position on a sphere at a safe distance
                const respawnRadius = BASE_RADIUS * 1.5;
                const theta = Math.acos(2 * Math.random() - 1);
                const phi = 2 * Math.PI * Math.random();
                
                // Position particle
                positions[i3] = centerPosition.x + respawnRadius * Math.sin(theta) * Math.cos(phi);
                positions[i3 + 1] = centerPosition.y + respawnRadius * Math.sin(theta) * Math.sin(phi);
                positions[i3 + 2] = centerPosition.z + respawnRadius * Math.cos(theta);
                
                // Calculate orbital velocity for new position
                const dirX = positions[i3] - centerPosition.x;
                const dirY = positions[i3 + 1] - centerPosition.y;
                const dirZ = positions[i3 + 2] - centerPosition.z;
                
                // Create a new rotation axis for orbital motion
                const rotationAxis = new THREE.Vector3();
                rotationAxis.set(
                    Math.random() * 2 - 1,
                    Math.random() * 2 - 1,
                    Math.random() * 2 - 1
                );
                rotationAxis.normalize();
                
                // Make the rotation axis perpendicular to the radial direction
                const radialDir = new THREE.Vector3(dirX, dirY, dirZ).normalize();
                const perpVector = new THREE.Vector3().crossVectors(radialDir, rotationAxis).normalize();
                
                // Calculate orbital velocity magnitude
                const distance = respawnRadius;
                const orbitalSpeed = Math.sqrt(GRAVITATIONAL_CONSTANT * BLACK_HOLE_MASS / distance) * ORBITAL_VELOCITY_FACTOR;
                
                // Apply orbital velocity
                particleVelocities[i3] = perpVector.x * orbitalSpeed;
                particleVelocities[i3 + 1] = perpVector.y * orbitalSpeed;
                particleVelocities[i3 + 2] = perpVector.z * orbitalSpeed;
                
                // Reset particle properties
                particles[i].consumed = false;
                particles[i].rotationAxis.copy(perpVector);
                particles[i].noiseOffsetX = Math.random() * 100;
                particles[i].noiseOffsetY = Math.random() * 100;
                particles[i].noiseOffsetZ = Math.random() * 100;
                
                respawned++;
            }
        }
    }
    
    // Update geometry
    pointCloud.geometry.attributes.position.needsUpdate = true;
    
    // Synchronization - throttled to reduce localStorage operations
    const now = performance.now();
    if (now - lastSyncTime > SYNC_INTERVAL) {
        // Calculate average position (center of mass) using sampling
        // 16x16 sample as mentioned in description
        let sumX = 0, sumY = 0, sumZ = 0;
        for (let i = 0; i < SAMPLE_COUNT; i++) {
            const idx = Math.floor(Math.random() * PARTICLE_COUNT);
            sumX += positions[idx * 3];
            sumY += positions[idx * 3 + 1];
            sumZ += positions[idx * 3 + 2];
        }
        
        // Calculate average
        const avgX = sumX / SAMPLE_COUNT;
        const avgY = sumY / SAMPLE_COUNT;
        const avgZ = sumZ / SAMPLE_COUNT;
        
        // Store entanglement value in localStorage as described
        const currentEntanglement = {
            x: avgX,
            y: avgY,
            z: avgZ,
            t: time
        };
        
        localStorage.setItem(`entanglement_${windowId}`, JSON.stringify(currentEntanglement));
        
        // If paired, get the paired window's entanglement value
        if (pairId) {
            const pairedData = localStorage.getItem(`entanglement_${pairId}`);
            if (pairedData) {
                try {
                    const pairedValue = JSON.parse(pairedData);
                    entanglementValue.set(pairedValue.x, pairedValue.y, pairedValue.z);
                } catch (e) {
                    console.error('Error parsing paired data:', e);
                }
            }
        }
        
        lastSyncTime = now;
    }
    
    renderer.render(scene, camera);
}

// Update particle colors based on HSL value (as described)
function updateColor(hue) {
    const h = hue / 255; // Normalize to 0-1 range
    
    // Update particle colors
    const colors = pointCloud.geometry.attributes.color.array;
    
    for (let i = 0; i < PARTICLE_COUNT; i++) {
        const i3 = i * 3;
        
        // Create color with HSL (saturation=1, lightness=0.5) as per description
        const color = new THREE.Color();
        color.setHSL(h, 1.0, 0.5);
        
        colors[i3] = color.r;
        colors[i3 + 1] = color.g;
        colors[i3 + 2] = color.b;
    }
    
    pointCloud.geometry.attributes.color.needsUpdate = true;
}

// Create new window for entanglement
function openNewWindow() {
    const newUrl = `${window.location.origin}${window.location.pathname}?pairId=${encodeURIComponent(windowId)}`;
    window.open(newUrl, '_blank', 'width=800,height=600');
}

// Resize handling
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    
    // Recalculate screen center on resize
    calculateScreenCenter();
    
    // Update center position to stay in view
    centerPosition.z = screenCenterPosition.z;
    saveCenter();
    
    // Update black hole position
    if (blackHoleObjects.blackHole) {
        blackHoleObjects.blackHole.position.copy(centerPosition);
    }
    if (blackHoleObjects.distortionRing) {
        blackHoleObjects.distortionRing.position.copy(centerPosition);
    }
    if (blackHoleObjects.accretionDisk) {
        blackHoleObjects.accretionDisk.position.copy(centerPosition);
    }
});

// Connect the event handlers
document.getElementById('colorSlider').addEventListener('input', function() {
    updateColor(this.value);
});

document.getElementById('newWindowBtn').addEventListener('click', openNewWindow);

// Initialize with default color
updateColor(DEFAULT_HUE);

// Start animation loop
animate();

console.log("Black hole visualization loaded - particles orbiting at the center"); 