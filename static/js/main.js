// Generate a unique window ID
const WINDOW_ID = Math.random().toString(36).slice(2);
let pairedWindows = [];

// Get paired window ID from URL if available
const urlParams = new URLSearchParams(window.location.search);
const pairId = urlParams.get('pairId');
if (pairId) {
    pairedWindows.push(pairId);
    localStorage.setItem('entangledPairs', JSON.stringify(pairedWindows));
} else {
    // Initialize from localStorage if exists
    const storedPairs = localStorage.getItem('entangledPairs');
    if (storedPairs) pairedWindows = JSON.parse(storedPairs);
}

// -------------------- SCENE SETUP --------------------
// Scene
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.z = 5;

// Renderer
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
document.getElementById('canvas-container').appendChild(renderer.domElement);

// -------------------- GPU COMPUTATION SETUP --------------------
const PARTICLE_COUNT = 16384; // 128x128 grid
const GRID_SIZE = 128;
let gpuCompute;
let positionVariable, velocityVariable;
let particleSystem;
let tempArray = new Float32Array(4); // For reading render target

function initGPUComputation() {
    gpuCompute = new THREE.GPUComputationRenderer(GRID_SIZE, GRID_SIZE, renderer);

    // Position texture (spiral initialization)
    const positionTexture = gpuCompute.createTexture();
    const posArray = positionTexture.image.data;
    for (let i = 0; i < posArray.length; i += 4) {
        const theta = (i / posArray.length) * Math.PI * 4;
        const radius = Math.sqrt(i / posArray.length) * 2;
        posArray[i] = radius * Math.cos(theta);     // x
        posArray[i + 1] = radius * Math.sin(theta); // y
        posArray[i + 2] = (Math.random() - 0.5) * 0.1; // z
        posArray[i + 3] = 1.0;
    }

    // Velocity texture (zero-initialized)
    const velocityTexture = gpuCompute.createTexture();
    const velArray = velocityTexture.image.data;
    for (let i = 0; i < velArray.length; i++) {
        velArray[i] = 0;
    }

    // Create computational variables
    positionVariable = gpuCompute.addVariable('posTexture', positionShader(), positionTexture);
    velocityVariable = gpuCompute.addVariable('velTexture', velocityShader(), velocityTexture);

    // Set variable dependencies
    gpuCompute.setVariableDependencies(positionVariable, [positionVariable, velocityVariable]);
    gpuCompute.setVariableDependencies(velocityVariable, [positionVariable, velocityVariable]);

    // Add custom uniforms
    positionVariable.material.uniforms.time = { value: 0.0 };
    positionVariable.material.uniforms.pairedForce = { value: new THREE.Vector3(0, 0, 0) };
    velocityVariable.material.uniforms.time = { value: 0.0 };
    velocityVariable.material.uniforms.mousePos = { value: new THREE.Vector3(0, 0, 0) };

    // Initialize
    const error = gpuCompute.init();
    if (error !== null) {
        console.error(error);
    }
}

// -------------------- SHADER DEFINITIONS --------------------
function positionShader() {
    return `
    uniform float time;
    uniform vec3 pairedForce;

    void main() {
        vec2 uv = gl_FragCoord.xy / resolution.xy;
        vec4 pos = texture2D(posTexture, uv);
        vec4 vel = texture2D(velTexture, uv);

        // Apply entanglement force
        vec3 toEntangled = normalize(pairedForce - pos.xyz) * 0.01;
        
        // Only apply if we have a paired window
        float hasPaired = length(pairedForce) > 0.001 ? 1.0 : 0.0;
        
        // Update position
        pos.xyz += vel.xyz + toEntangled * hasPaired;
        
        // Damping
        pos.xyz *= 0.995;
        
        gl_FragColor = pos;
    }
    `;
}

function velocityShader() {
    return `
    uniform float time;
    uniform vec3 mousePos;

    void main() {
        vec2 uv = gl_FragCoord.xy / resolution.xy;
        vec4 pos = texture2D(posTexture, uv);
        vec4 vel = texture2D(velTexture, uv);
        
        // Apply mouse attraction
        vec3 toMouse = mousePos - pos.xyz;
        float dist = length(toMouse);
        float influence = 1.0 / (1.0 + dist * dist * 0.1);
        vec3 mouseForce = normalize(toMouse) * influence * 0.05;
        
        // Random jitter
        vec3 random = vec3(
            sin(uv.x * 100.0 + time),
            cos(uv.y * 100.0 + time),
            sin(uv.x * uv.y * 100.0 + time)
        ) * 0.001;
        
        // Update velocity
        vel.xyz += mouseForce + random;
        
        // Damping
        vel.xyz *= 0.95;
        
        gl_FragColor = vel;
    }
    `;
}

// -------------------- PARTICLE SYSTEM --------------------
function createParticleSystem() {
    const positions = new Float32Array(PARTICLE_COUNT * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    // Read initial positions
    const initialPositionRenderTarget = gpuCompute.getCurrentRenderTarget(positionVariable);
    renderer.readRenderTargetPixels(
        initialPositionRenderTarget, 
        0, 0, 
        GRID_SIZE, GRID_SIZE, 
        new Float32Array(GRID_SIZE * GRID_SIZE * 4)
    );

    // Create material
    const particleMaterial = new THREE.PointsMaterial({
        size: 0.05,
        color: new THREE.Color().setHSL(0.5, 0.8, 0.5),
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false
    });

    // Create particle system
    particleSystem = new THREE.Points(geometry, particleMaterial);
    scene.add(particleSystem);

    // Store material for later color updates
    window.particleMaterial = particleMaterial;
}

// -------------------- ENTANGLEMENT SYNC --------------------
function updateEntanglement() {
    // Calculate average particle position
    const avgPos = new THREE.Vector3();
    const positions = gpuCompute.getCurrentRenderTarget(positionVariable).texture;
    
    // Sample a small region (for performance)
    renderer.readRenderTargetPixels(
        gpuCompute.getCurrentRenderTarget(positionVariable),
        0, 0, 1, 1, 
        tempArray
    );
    
    avgPos.set(tempArray[0], tempArray[1], tempArray[2]);

    // Store our position for paired windows
    localStorage.setItem(`entangled_${WINDOW_ID}`, JSON.stringify({
        x: avgPos.x,
        y: avgPos.y,
        z: avgPos.z
    }));
    
    // Calculate net force from all paired windows
    const netForce = new THREE.Vector3();
    let pairsFound = 0;
    
    pairedWindows.forEach(id => {
        const data = localStorage.getItem(`entangled_${id}`);
        if (data) {
            const parsed = JSON.parse(data);
            netForce.add(new THREE.Vector3(parsed.x, parsed.y, parsed.z));
            pairsFound++;
        }
    });
    
    // Only apply force if we have paired windows
    if (pairsFound > 0) {
        netForce.divideScalar(pairsFound);
        positionVariable.material.uniforms.pairedForce.value.copy(netForce);
    }
}

// -------------------- MOUSE INTERACTION --------------------
const mouse = new THREE.Vector3(0, 0, 0);
let mouseActive = false;

function onMouseMove(event) {
    // Normalize mouse position
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    mouse.z = 0;
    
    // Project mouse to 3D space
    const vector = new THREE.Vector3(mouse.x, mouse.y, 0.5);
    vector.unproject(camera);
    
    const dir = vector.sub(camera.position).normalize();
    const distance = -camera.position.z / dir.z;
    const pos = camera.position.clone().add(dir.multiplyScalar(distance));
    
    // Set mouse position in shader
    velocityVariable.material.uniforms.mousePos.value.copy(pos);
    mouseActive = true;
}

function onMouseLeave() {
    mouseActive = false;
}

// -------------------- ANIMATION & RENDERING --------------------
let lastTime = 0;

function render(time) {
    time *= 0.001; // Convert to seconds
    const deltaTime = time - lastTime;
    lastTime = time;
    
    // Update GPU computation
    positionVariable.material.uniforms.time.value = time;
    velocityVariable.material.uniforms.time.value = time;
    
    // If mouse is inactive, move it away
    if (!mouseActive) {
        velocityVariable.material.uniforms.mousePos.value.set(999, 999, 999);
    }
    
    // Run GPU computation
    gpuCompute.compute();
    
    // Update particles
    const positions = particleSystem.geometry.attributes.position.array;
    const positionTexture = gpuCompute.getCurrentRenderTarget(positionVariable).texture;
    
    // Read position texture and update geometry
    renderer.readRenderTargetPixels(
        gpuCompute.getCurrentRenderTarget(positionVariable),
        0, 0, 
        GRID_SIZE, GRID_SIZE, 
        new Float32Array(GRID_SIZE * GRID_SIZE * 4)
    );
    
    // For performance, we'll update positions directly without reading from GPU
    // This is simplified - in a production version, we'd use a custom shader
    // to display particles directly from the texture
    for (let i = 0; i < positions.length; i += 3) {
        const idx = i / 3;
        const x = (idx % GRID_SIZE) / GRID_SIZE;
        const y = Math.floor(idx / GRID_SIZE) / GRID_SIZE;
        
        tempArray.fill(0);
        renderer.readRenderTargetPixels(
            gpuCompute.getCurrentRenderTarget(positionVariable),
            Math.floor(x * GRID_SIZE), 
            Math.floor(y * GRID_SIZE), 
            1, 1, 
            tempArray
        );
        
        positions[i] = tempArray[0];
        positions[i + 1] = tempArray[1];
        positions[i + 2] = tempArray[2];
    }
    
    particleSystem.geometry.attributes.position.needsUpdate = true;
    
    // Update entanglement
    updateEntanglement();
    
    renderer.render(scene, camera);
    requestAnimationFrame(render);
}

// -------------------- EVENT HANDLERS --------------------
// Window resize
function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// Color slider
document.getElementById('hueSlider').addEventListener('input', (e) => {
    window.particleMaterial.color.setHSL(e.target.value, 0.8, 0.5);
});

// Spawn new window
document.getElementById('spawnWindow').addEventListener('click', () => {
    const newId = Math.random().toString(36).slice(2);
    pairedWindows.push(WINDOW_ID);
    localStorage.setItem('entangledPairs', JSON.stringify(pairedWindows));
    window.open(window.location.href + `?pairId=${WINDOW_ID}`, '_blank');
});

// Add event listeners
window.addEventListener('resize', onWindowResize);
window.addEventListener('mousemove', onMouseMove);
window.addEventListener('mouseleave', onMouseLeave);

// -------------------- INITIALIZATION --------------------
initGPUComputation();
createParticleSystem();
requestAnimationFrame(render);