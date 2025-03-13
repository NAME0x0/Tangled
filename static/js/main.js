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

// Debug helper for WebGL context
function checkWebGLSupport() {
    try {
        console.log("Checking WebGL capabilities...");
        console.log("WebGL2 supported:", renderer.capabilities.isWebGL2);
        
        // Safely check for extensions
        let extensionsSupported = false;
        try {
            // In some Three.js versions, the context is accessible this way
            if (renderer.getContext) {
                const context = renderer.getContext();
                if (context && context.getSupportedExtensions) {
                    console.log("Available WebGL extensions:", context.getSupportedExtensions());
                    extensionsSupported = true;
                }
            }
        } catch (extError) {
            console.log("Could not access WebGL extensions listing:", extError);
        }
        
        if (!renderer.capabilities.isWebGL2) {
            console.error("WebGL 2 not supported. GPUComputationRenderer requires WebGL 2.");
            document.getElementById('canvas-container').innerHTML = 
                '<div style="color:red; padding:20px;">WebGL 2 not supported by your browser. Please use Chrome 95+, Firefox 90+ or another WebGL 2 compatible browser.</div>';
            return false;
        }
        
        // Check for float texture support more safely
        let floatTextureSupported = false;
        try {
            // Try checking for extension support through renderer capabilities and extensions
            if (renderer.extensions) {
                const floatExtensions = {
                    'EXT_color_buffer_float': renderer.extensions.get('EXT_color_buffer_float'),
                    'OES_texture_float_linear': renderer.extensions.get('OES_texture_float_linear'),
                    'OES_texture_float': renderer.extensions.get('OES_texture_float')
                };
                
                console.log("Float texture extensions status:", floatExtensions);
                
                if (floatExtensions['EXT_color_buffer_float'] || floatExtensions['OES_texture_float']) {
                    floatTextureSupported = true;
                }
            }
        } catch (extensionError) {
            console.log("Could not check float texture support through extensions:", extensionError);
        }
        
        // Additional capability check
        if (renderer.capabilities) {
            console.log("Floating point textures capability:", renderer.capabilities.floatFragmentTextures);
            if (renderer.capabilities.floatFragmentTextures) {
                floatTextureSupported = true;
            }
        }
        
        if (!floatTextureSupported) {
            console.warn("Float texture rendering may not be supported. Trying half float...");
        }
        
        console.log("WebGL support verification complete");
        return true;
    } catch (e) {
        console.error("WebGL error:", e);
        document.getElementById('canvas-container').innerHTML = 
            '<div style="color:red; padding:20px;">WebGL error: ' + e.message + '</div>';
        return false;
    }
}

// -------------------- GPU COMPUTATION SETUP --------------------
const PARTICLE_COUNT = 65536; // 256x256 grid
const GRID_SIZE = 256;
// Reduced grid size for better compatibility
const SAFE_GRID_SIZE = 128; 
let gpuCompute;
let positionVariable, velocityVariable;
let particleSystem;
let tempArray = new Float32Array(4); // For reading render target

// Ensure GPUComputationRenderer is accessible
function getGPUComputationRenderer() {
    // Check if GPUComputationRenderer is available as a global
    if (typeof GPUComputationRenderer !== 'undefined') {
        console.log("Using global GPUComputationRenderer");
        return GPUComputationRenderer;
    }
    
    // Check if it's been attached to THREE
    if (THREE && typeof THREE.GPUComputationRenderer !== 'undefined') {
        console.log("Using THREE.GPUComputationRenderer");
        return THREE.GPUComputationRenderer;
    }
    
    // Last resort - try to import it manually if it's an ES module
    console.error("GPUComputationRenderer not found. Creating fallback implementation.");
    
    // Create a basic fallback that will show an error but not crash
    return function FallbackGPURenderer() {
        document.getElementById('canvas-container').innerHTML = 
            '<div style="color:red; padding:20px;">ERROR: GPUComputationRenderer could not be loaded. Please check browser console for details.</div>';
        throw new Error("GPUComputationRenderer not available");
    };
}

function initGPUComputation() {
    const gpu = getGPUComputationRenderer();
    if (!gpu) return false;
    
    gpuCompute = gpu;
    
    // Create position texture with initial random positions
    const posTexture = gpuCompute.createTexture();
    const velTexture = gpuCompute.createTexture();
    
    fillPositionTexture(posTexture);
    fillVelocityTexture(velTexture);
    
    // Add variables to GPU compute
    positionVariable = gpuCompute.addVariable('texturePosition', positionShader(), posTexture);
    velocityVariable = gpuCompute.addVariable('textureVelocity', velocityShader(), velTexture);
    
    // Set variable dependencies
    gpuCompute.setVariableDependencies(positionVariable, [positionVariable, velocityVariable]);
    gpuCompute.setVariableDependencies(velocityVariable, [positionVariable, velocityVariable]);
    
    // Add custom uniforms
    const posUniforms = positionVariable.material.uniforms;
    const velUniforms = velocityVariable.material.uniforms;
    
    posUniforms.time = { value: 0.0 };
    posUniforms.delta = { value: 0.0 };
    
    velUniforms.time = { value: 0.0 };
    velUniforms.delta = { value: 0.0 };
    velUniforms.mousePos = { value: new THREE.Vector3(0, 0, 0) };
    velUniforms.mouseForce = { value: 0.0 };
    velUniforms.entanglementForce = { value: new THREE.Vector3(0, 0, 0) };
    
    // Texture size check and init
    const error = gpuCompute.init();
    if (error !== null) {
        console.error('GPUComputationRenderer error:', error);
        return false;
    }
    
    return true;
}

// Add advanced noise functions for particle animation
const noisePermute = `vec4 permute(vec4 x){return mod(((x*34.0)+1.0)*x, 289.0);}`;
const noise3D = `
${noisePermute}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314 * r;}

float snoise(vec3 v){
    const vec2  C = vec2(1.0/6.0, 1.0/3.0) ;
    const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);

    vec3 i  = floor(v + dot(v, C.yyy) );
    vec3 x0 =   v - i + dot(i, C.xxx) ;

    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min( g.xyz, l.zxy );
    vec3 i2 = max( g.xyz, l.zxy );

    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;

    i = mod( i, 289.0 );
    vec4 p = permute( permute( permute(
               i.z + vec4(0.0, i1.z, i2.z, 1.0 ))
             + i.y + vec4(0.0, i1.y, i2.y, 1.0 ))
             + i.x + vec4(0.0, i1.x, i2.x, 1.0 ));

    float n_ = 0.142857142857;
    vec3  ns = n_ * D.wyz - D.xzx;

    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_ );

    vec4 x = x_ *ns.x + ns.yyyy;
    vec4 y = y_ *ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);

    vec4 b0 = vec4( x.xy, y.xy );
    vec4 b1 = vec4( x.zw, y.zw );

    vec4 s0 = floor(b0)*2.0 + 1.0;
    vec4 s1 = floor(b1)*2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));

    vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy ;
    vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww ;

    vec3 p0 = vec3(a0.xy,h.x);
    vec3 p1 = vec3(a0.zw,h.y);
    vec3 p2 = vec3(a1.xy,h.z);
    vec3 p3 = vec3(a1.zw,h.w);

    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
    p0 *= norm.x;
    p1 *= norm.y;
    p2 *= norm.z;
    p3 *= norm.w;

    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1),
                                  dot(p2,x2), dot(p3,x3) ) );
}

vec3 curlNoise(vec3 p) {
    const float step = 0.01;
    float ddx = snoise(p + vec3(step, 0.0, 0.0)) - snoise(p - vec3(step, 0.0, 0.0));
    float ddy = snoise(p + vec3(0.0, step, 0.0)) - snoise(p - vec3(0.0, step, 0.0));
    float ddz = snoise(p + vec3(0.0, 0.0, step)) - snoise(p - vec3(0.0, 0.0, step));
    
    return normalize(vec3(
        ddy - ddz,
        ddz - ddx,
        ddx - ddy
    ));
}
`;

// Random hash function for initialization
const hashFunctions = `
float hash12(vec2 p) {
  vec3 p3  = fract(vec3(p.xyx) * .1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}`;

// Fill textures with initial data
function fillPositionTexture(texture) {
    const pixels = texture.image.data;
    const size = GRID_SIZE * GRID_SIZE;
    
    for (let i = 0; i < size; i++) {
        const i4 = i * 4;
        
        // Create particles in a spherical distribution
        const radius = 1.0 * Math.random();
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos((Math.random() * 2) - 1);
        
        pixels[i4 + 0] = radius * Math.sin(phi) * Math.cos(theta); // x
        pixels[i4 + 1] = radius * Math.sin(phi) * Math.sin(theta); // y
        pixels[i4 + 2] = radius * Math.cos(phi); // z
        pixels[i4 + 3] = 1.0; // w (life)
    }
}

function fillVelocityTexture(texture) {
    const pixels = texture.image.data;
    const size = GRID_SIZE * GRID_SIZE;
    
    for (let i = 0; i < size; i++) {
        const i4 = i * 4;
        
        // Initial velocities - small random values
        pixels[i4 + 0] = (Math.random() - 0.5) * 0.01;
        pixels[i4 + 1] = (Math.random() - 0.5) * 0.01;
        pixels[i4 + 2] = (Math.random() - 0.5) * 0.01;
        pixels[i4 + 3] = 0.0; // w (unused)
    }
}

// -------------------- SHADER DEFINITIONS --------------------
function positionShader() {
    return `
    uniform float time;
    uniform float delta;

    void main() {
        // Get current position and velocity
        vec4 pos = texture2D(texturePosition, gl_FragCoord.xy / resolution.xy);
        vec4 vel = texture2D(textureVelocity, gl_FragCoord.xy / resolution.xy);
        
        // Update position based on velocity
        pos.xyz += vel.xyz * delta;
        
        // Store updated position
        gl_FragColor = pos;
    }
    `;
}

function velocityShader() {
    return `
    ${noise3D}
    uniform float time;
    uniform float delta;
    uniform vec3 mousePos;
    uniform float mouseForce;
    uniform vec3 entanglementForce;

    void main() {
        // Get current position and velocity
        vec4 pos = texture2D(texturePosition, gl_FragCoord.xy / resolution.xy);
        vec4 vel = texture2D(textureVelocity, gl_FragCoord.xy / resolution.xy);
        
        // Apply curl noise for organic movement
        vec3 noisePos = pos.xyz * 0.5 + time * 0.05;
        vec3 curl = curlNoise(noisePos) * 0.3;
        
        // Apply mouse attraction force if mouse is active
        vec3 mouseDir = mousePos - pos.xyz;
        float mouseDist = length(mouseDir);
        
        if (mouseForce > 0.0 && mouseDist < 2.0) {
            float mouseStrength = mouseForce * (1.0 - mouseDist / 2.0);
            mouseDir = normalize(mouseDir) * mouseStrength;
            curl += mouseDir;
        }
        
        // Apply entanglement force
        if (length(entanglementForce) > 0.0) {
            curl += entanglementForce * 0.05;
        }
        
        // Add a centering force to prevent particles from drifting too far
        vec3 centerDir = -pos.xyz;
        float centerDist = length(centerDir);
        vec3 centerForce = normalize(centerDir) * centerDist * 0.01;
        
        // Update velocity with curl noise influence and damping
        vel.xyz = vel.xyz * 0.95 + curl * delta * 2.0 + centerForce;
        
        // Limit velocity to prevent extreme movement
        float speedLimit = 2.0;
        float speed = length(vel.xyz);
        if (speed > speedLimit) {
            vel.xyz = vel.xyz * (speedLimit / speed);
        }
        
        // Store updated velocity
        gl_FragColor = vel;
    }
    `;
}

// -------------------- PARTICLE SYSTEM --------------------
function createParticleSystem() {
    try {
        console.log("Creating particle system...");
        
        // Create geometry
        const geometry = new THREE.BufferGeometry();
        
        // Create arrays for attributes
        const positions = new Float32Array(PARTICLE_COUNT * 3);
        const uvs = new Float32Array(PARTICLE_COUNT * 2);
        
        // Fill position and UV attributes
        for (let i = 0; i < PARTICLE_COUNT; i++) {
            // Initial positions (will be updated in render loop)
            positions[i * 3] = 0;
            positions[i * 3 + 1] = 0;
            positions[i * 3 + 2] = 0;
            
            // UVs for lookup in position texture
            const x = (i % GRID_SIZE) / GRID_SIZE;
            const y = Math.floor(i / GRID_SIZE) / GRID_SIZE;
            
            uvs[i * 2] = x;
            uvs[i * 2 + 1] = y;
        }
        
        // Add attributes to geometry
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
        
        // Create custom shader material
        const material = new THREE.ShaderMaterial({
            uniforms: {
                positionTexture: { value: null },
                velocityTexture: { value: null },
                pointSize: { value: 1.5 },
                particleColor: { value: new THREE.Color(0x88ccff) }
            },
            vertexShader: `
                uniform sampler2D positionTexture;
                uniform sampler2D velocityTexture;
                uniform float pointSize;
                
                varying vec3 vVelocity;
                
                void main() {
                    // Get position from texture
                    vec4 posTemp = texture2D(positionTexture, uv);
                    vec4 velTemp = texture2D(velocityTexture, uv);
                    
                    // Pass velocity to fragment shader
                    vVelocity = velTemp.xyz;
                    
                    // Calculate point size based on distance to camera
                    vec4 mvPosition = modelViewMatrix * vec4(posTemp.xyz, 1.0);
                    float distanceToCamera = length(mvPosition.xyz);
                    gl_PointSize = pointSize * (30.0 / distanceToCamera);
                    
                    // Project position
                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                varying vec3 vVelocity;
                uniform vec3 particleColor;
                
                void main() {
                    // Calculate speed for coloring
                    float speed = length(vVelocity);
                    
                    // Color gradient based on speed
                    vec3 color = mix(particleColor * 0.8, vec3(1.0, 1.0, 1.0), min(speed * 2.0, 1.0));
                    
                    // Circular particle with soft edge
                    float r = 0.0;
                    vec2 cxy = 2.0 * gl_PointCoord - 1.0;
                    r = dot(cxy, cxy);
                    if (r > 1.0) {
                        discard;
                    }
                    
                    // Fade out towards edges
                    float alpha = 1.0 - r;
                    
                    gl_FragColor = vec4(color, alpha);
                }
            `,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            transparent: true,
        });
        
        // Create particle system and add to scene
        particleSystem = new THREE.Points(geometry, material);
        scene.add(particleSystem);
        
        console.log("Particle system created with", PARTICLE_COUNT, "particles");
        return true;
    } catch (e) {
        console.error("Error creating particle system:", e);
        return false;
    }
}

// -------------------- FALLBACK SYSTEM --------------------
function createFallbackSystem() {
    console.log("Creating fallback particle system...");
    
    // Create a basic particle system without GPU computation
    const geometry = new THREE.BufferGeometry();
    const particleCount = 500; // Much smaller count for CPU
    
    // Create array of positions, colors, and sizes
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);
    
    // Initialize with a simple spiral pattern
    for (let i = 0; i < particleCount; i++) {
        const angle = (i / particleCount) * Math.PI * 20;
        const radius = 0.1 + (i / particleCount) * 3;
        
        // Position
        positions[i * 3] = Math.cos(angle) * radius;
        positions[i * 3 + 1] = Math.sin(angle) * radius;
        positions[i * 3 + 2] = (Math.random() - 0.5) * 0.2;
        
        // Color - blue to cyan gradient
        colors[i * 3] = 0.3 + (i / particleCount) * 0.4;
        colors[i * 3 + 1] = 0.7 + (i / particleCount) * 0.3;
        colors[i * 3 + 2] = 1.0;
    }
    
    // Add attributes
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    
    // Create material
    const material = new THREE.PointsMaterial({
        size: 0.15,
        vertexColors: true,
        blending: THREE.AdditiveBlending,
        transparent: true,
        opacity: 0.7,
        sizeAttenuation: true
    });
    
    // Create particles
    particleSystem = new THREE.Points(geometry, material);
    scene.add(particleSystem);
    
    console.log("Fallback system created with", particleCount, "particles");
    
    // Add reference sphere
    const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(0.2, 16, 16),
        new THREE.MeshBasicMaterial({ color: 0xff0000 })
    );
    scene.add(sphere);
    
    return true;
}

// -------------------- ENTANGLEMENT SYNC --------------------
function updateEntanglement() {
    // Calculate average particle position
    const avgPos = new THREE.Vector3();
    
    // Sample multiple positions for better representation
    const samplePoints = 5;
    let totalSampled = 0;
    
    for (let i = 0; i < samplePoints; i++) {
        for (let j = 0; j < samplePoints; j++) {
            // Sample at different areas of the texture
            const x = Math.floor((i / samplePoints) * GRID_SIZE);
            const y = Math.floor((j / samplePoints) * GRID_SIZE);
            
            renderer.readRenderTargetPixels(
                gpuCompute.getCurrentRenderTarget(positionVariable),
                x, y, 1, 1, 
                tempArray
            );
            
            avgPos.x += tempArray[0];
            avgPos.y += tempArray[1];
            avgPos.z += tempArray[2];
            totalSampled++;
        }
    }
    
    // Calculate average
    if (totalSampled > 0) {
        avgPos.divideScalar(totalSampled);
    }

    // Calculate average velocity for energy transfer
    const avgVel = new THREE.Vector3();
    
    for (let i = 0; i < samplePoints; i++) {
        for (let j = 0; j < samplePoints; j++) {
            const x = Math.floor((i / samplePoints) * GRID_SIZE);
            const y = Math.floor((j / samplePoints) * GRID_SIZE);
            
            renderer.readRenderTargetPixels(
                gpuCompute.getCurrentRenderTarget(velocityVariable),
                x, y, 1, 1, 
                tempArray
            );
            
            avgVel.x += tempArray[0];
            avgVel.y += tempArray[1];
            avgVel.z += tempArray[2];
        }
    }
    
    if (totalSampled > 0) {
        avgVel.divideScalar(totalSampled);
    }

    // Store our position and velocity for paired windows
    localStorage.setItem(`entangled_${WINDOW_ID}`, JSON.stringify({
        x: avgPos.x,
        y: avgPos.y,
        z: avgPos.z,
        vx: avgVel.x,
        vy: avgVel.y,
        vz: avgVel.z
    }));
    
    // Calculate net force from all paired windows
    const netForce = new THREE.Vector3();
    let pairsFound = 0;
    
    pairedWindows.forEach(id => {
        const data = localStorage.getItem(`entangled_${id}`);
        if (data) {
            try {
                const parsed = JSON.parse(data);
                const otherPos = new THREE.Vector3(parsed.x, parsed.y, parsed.z);
                const otherVel = new THREE.Vector3(parsed.vx || 0, parsed.vy || 0, parsed.vz || 0);
                
                // Calculate force based on distance and entanglement strength
                const direction = new THREE.Vector3().subVectors(otherPos, avgPos);
                const distance = direction.length();
                
                // Apply force based on inverse square law with limits
                if (distance > 0.01) {  // Prevent division by very small numbers
                    const forceMagnitude = Math.min(1.0 / (distance * distance), 2.0);
                    direction.normalize().multiplyScalar(forceMagnitude);
                    
                    // Add velocity influence from other system
                    const velInfluence = otherVel.clone().multiplyScalar(0.1);
                    direction.add(velInfluence);
                    
                    netForce.add(direction);
                    pairsFound++;
                }
            } catch (e) {
                console.warn("Error parsing entanglement data:", e);
            }
        }
    });
    
    // Apply the net force to the velocity shader
    if (pairsFound > 0) {
        netForce.divideScalar(pairsFound);
        // Scale down force to prevent chaotic behavior
        netForce.multiplyScalar(0.5);
    }
    
    // Update the uniform in the velocity shader
    if (velocityVariable && velocityVariable.material.uniforms.entanglementForce) {
        velocityVariable.material.uniforms.entanglementForce.value.copy(netForce);
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
let frameCount = 0;
// Buffer for position data
const positionData = new Float32Array(GRID_SIZE * GRID_SIZE * 4);

function animateFallbackSystem(time) {
    // Animate the fallback particle system without GPU
    if (particleSystem) {
        const positions = particleSystem.geometry.attributes.position.array;
        const particleCount = positions.length / 3;
        
        // Update positions with simple animation
        for (let i = 0; i < particleCount; i++) {
            const idx = i * 3;
            const x = positions[idx];
            const y = positions[idx + 1];
            const z = positions[idx + 2];
            
            // Apply simple rotation
            const angle = time * 0.2;
            const newX = x * Math.cos(angle) - y * Math.sin(angle);
            const newY = x * Math.sin(angle) + y * Math.cos(angle);
            
            positions[idx] = newX;
            positions[idx + 1] = newY;
            positions[idx + 2] = z + Math.sin(time + i * 0.01) * 0.002;
        }
        
        particleSystem.geometry.attributes.position.needsUpdate = true;
        particleSystem.rotation.z = Math.sin(time * 0.5) * 0.1;
    }
}

function render(time) {
    time *= 0.001; // Convert to seconds
    const deltaTime = time - lastTime;
    lastTime = time;
    frameCount++;
    
    try {
        if (gpuCompute) {
            // GPU-based rendering
            try {
                // Update entanglement forces
                updateEntanglement();
                
                // Update shader time
                if (velocityVariable && velocityVariable.material && 
                    velocityVariable.material.uniforms && 
                    velocityVariable.material.uniforms.time) {
                    velocityVariable.material.uniforms.time.value = time;
                    velocityVariable.material.uniforms.frame = { value: frameCount };
                }
                
                // Update mouse state - set far away when inactive
                if (!mouseActive && velocityVariable.material && velocityVariable.material.uniforms.mousePos) {
                    velocityVariable.material.uniforms.mousePos.value.set(1000, 1000, 1000);
                }
                
                // Compute
                gpuCompute.compute();
                
                // Update particles
                if (particleSystem) {
                    const positions = particleSystem.geometry.attributes.position.array;
                    
                    try {
                        // Get position data from GPU
                        const posTarget = gpuCompute.getCurrentRenderTarget(positionVariable);
                        if (posTarget) {
                            const localPositionData = new Float32Array(SAFE_GRID_SIZE * SAFE_GRID_SIZE * 4);
                            
                            renderer.readRenderTargetPixels(
                                posTarget, 0, 0, SAFE_GRID_SIZE, SAFE_GRID_SIZE, localPositionData
                            );
                            
                            // Update particle positions
                            const limit = Math.min(positions.length / 3, SAFE_GRID_SIZE * SAFE_GRID_SIZE);
                            for (let i = 0; i < limit; i++) {
                                positions[i * 3] = localPositionData[i * 4];
                                positions[i * 3 + 1] = localPositionData[i * 4 + 1];
                                positions[i * 3 + 2] = localPositionData[i * 4 + 2];
                            }
                            
                            particleSystem.geometry.attributes.position.needsUpdate = true;
                        }
                    } catch (readError) {
                        console.warn("Error reading GPU texture:", readError);
                    }
                }
            } catch (computeError) {
                console.error("Error in GPU computation:", computeError);
            }
        } else {
            // CPU-based fallback animation
            animateFallbackSystem(time);
        }
    } catch (e) {
        console.error("Error in render loop:", e);
    }
    
    // Always render the scene
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
    if (!particleSystem || !particleSystem.material) return;
    
    const hue = parseFloat(e.target.value);
    
    // For ShaderMaterial particle system
    if (particleSystem.material.type === 'ShaderMaterial') {
        // Convert HSL to RGB and set as uniform
        const color = new THREE.Color().setHSL(hue, 0.8, 0.6);
        particleSystem.material.uniforms.particleColor.value = color;
    } 
    // For fallback PointsMaterial system with vertex colors
    else if (particleSystem.geometry.attributes.color) {
        const colors = particleSystem.geometry.attributes.color.array;
        
        for (let i = 0; i < colors.length / 3; i++) {
            const saturation = 0.7 + Math.random() * 0.3;
            const lightness = 0.5 + Math.random() * 0.2;
            const color = new THREE.Color().setHSL(hue, saturation, lightness);
            
            colors[i * 3] = color.r;
            colors[i * 3 + 1] = color.g;
            colors[i * 3 + 2] = color.b;
        }
        
        particleSystem.geometry.attributes.color.needsUpdate = true;
    }
});

// Spawn new window
document.getElementById('spawnWindow').addEventListener('click', () => {
    const newId = Math.random().toString(36).slice(2);
    pairedWindows.push(WINDOW_ID);
    localStorage.setItem('entangledPairs', JSON.stringify(pairedWindows));
    window.open(window.location.href + `?pairId=${WINDOW_ID}`, '_blank');
});

// -------------------- INITIALIZATION --------------------
function init() {
    try {
        console.log("Starting initialization...");
        
        // Try GPU computation first
        let gpuInitialized = false;
        try {
            gpuInitialized = initGPUComputation();
            
            // Initialize missing uniforms
            if (gpuInitialized && positionVariable && velocityVariable) {
                // Add missing uniforms for position variable
                positionVariable.material.uniforms.pairedForce = { value: new THREE.Vector3(0, 0, 0) };
                
                // Add missing uniforms for velocity variable
                velocityVariable.material.uniforms.mousePos = { value: new THREE.Vector3(1000, 1000, 1000) };
                velocityVariable.material.uniforms.frame = { value: 0 };
                
                // Use more appropriate shaders instead of minimal ones
                positionVariable.material.fragmentShader = positionShader();
                velocityVariable.material.fragmentShader = velocityShader();
                
                console.log("Initialized shader uniforms and updated shader code");
            }
        } catch (e) {
            console.error("GPU computation failed:", e);
            gpuInitialized = false;
        }
        
        console.log("GPU Computation initialized:", gpuInitialized);
        
        // Regardless of GPU init result, create a particle system
        let particlesCreated;
        if (gpuInitialized) {
            particlesCreated = createParticleSystem();
        } else {
            particlesCreated = createFallbackSystem();
        }
        
        console.log("Particles created:", particlesCreated);
        
        if (particlesCreated) {
            // Add event listeners
            window.addEventListener('resize', onWindowResize);
            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseleave', onMouseLeave);
            
            // Start render loop
            console.log("Starting render loop...");
            requestAnimationFrame(render);
        }
    } catch (e) {
        console.error("Error during initialization:", e);
        document.getElementById('canvas-container').innerHTML = 
            '<div style="color:red; padding:20px;">Initialization error: ' + e.message + '</div>';
    }
}

// Start the application with a delay to ensure DOM is fully loaded
window.addEventListener('DOMContentLoaded', () => {
    console.log("DOM content loaded, initializing application after short delay...");
    // Short delay to ensure browser is ready
    setTimeout(init, 100);
});