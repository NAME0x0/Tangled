// Main JavaScript file for the Tangled application

// Initialize global variables
let scene, camera, renderer, orb1, orb2, link;
let dragControls, orbitControls;
let socket;
let windowId = Math.random().toString(36).substring(2, 9);
let particleSystem1, particleSystem2;
let isFirstWindow = true; // Track if this is the first window opened
let lastOpened = Date.now();
let windowCount = 0;
let cameraAnimation = true;

// Update debug info if the function exists
function debug(message) {
    console.log(message);
    if (typeof updateDebug === 'function') {
        updateDebug(message);
    }
}

// Constants for visual settings
const ORB_RADIUS = 0.5;
const ORB1_COLOR = 0x3498db;  // Blue
const ORB2_COLOR = 0xe74c3c;  // Red
const LINK_CLOSE_COLOR = 0x2ecc71;  // Green (close)
const LINK_FAR_COLOR = 0xe74c3c;    // Red (far)
const DISTANCE_THRESHOLD = 5;       // Distance threshold for color change as per spec
const PARTICLE_COUNT = 500;         // Number of particles around each orb

// Initialize the application
function init() {
    try {
        console.log("Initializing Tangled application...");
        
        // Check if all dependencies are loaded
        if (typeof THREE === 'undefined') {
            throw new Error("THREE.js not loaded");
        }
        
        if (typeof io === 'undefined') {
            throw new Error("Socket.IO not loaded");
        }
        
        // Check if OrbitControls is available
        if (typeof THREE.OrbitControls === 'undefined') {
            debug("Warning: THREE.OrbitControls not available");
        }
        
        // Check if DragControls is available
        if (typeof THREE.DragControls === 'undefined') {
            debug("Warning: THREE.DragControls not available");
        }
        
        initThreeJS();
        initSocketIO();
        initEventListeners();
        animate();
        
        console.log("Application initialized successfully");
    } catch (error) {
        console.error("Error initializing application:", error);
        alert("Error initializing application: " + error.message);
    }
}

// Initialize Three.js
function initThreeJS() {
    // Create scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    scene.fog = new THREE.FogExp2(0x000000, 0.035);

    // Create camera
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 10;  // Position camera to match spec
    camera.position.y = 2;   // Slightly elevated view

    // Create renderer with post-processing capabilities
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    document.getElementById('container').appendChild(renderer.domElement);

    // Create lighting
    const ambientLight = new THREE.AmbientLight(0x111111, 0.5);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(1, 1, 1);
    directionalLight.castShadow = true;
    scene.add(directionalLight);
    
    // Add point light for dramatic effect
    const pointLight1 = new THREE.PointLight(0x3498db, 1, 10);
    pointLight1.position.set(-2, 2, 2);
    scene.add(pointLight1);
    
    const pointLight2 = new THREE.PointLight(0xe74c3c, 1, 10);
    pointLight2.position.set(2, -2, -2);
    scene.add(pointLight2);

    // Create the orbs with an artistic glow effect
    createOrbs();
    
    // Add stars to the background
    createStarField();
    
    // Setup controls if available
    setupControls();

    // Handle window resize
    window.addEventListener('resize', onWindowResize, false);
}

// Create orbs and particle systems
function createOrbs() {
    // Create orbs based on window sequence
    isFirstWindow = !sessionStorage.getItem('tangled_window_opened');
    if (isFirstWindow) {
        // First window - store flag in session storage
        sessionStorage.setItem('tangled_window_opened', 'true');
        debug("This is the first window - showing single orb");
        windowCount = 1;
    } else {
        debug("This is a secondary window - showing both orbs");
        windowCount = 2;
    }
    
    // Create the orbs with glowing material
    const sphereGeometry = new THREE.SphereGeometry(ORB_RADIUS, 32, 32);
    
    // Create materials with glow effect
    const orb1Material = new THREE.MeshPhongMaterial({ 
        color: ORB1_COLOR, 
        shininess: 100,
        emissive: ORB1_COLOR,
        emissiveIntensity: 0.5,
        transparent: true,
        opacity: 0.9
    });
    
    const orb2Material = new THREE.MeshPhongMaterial({ 
        color: ORB2_COLOR, 
        shininess: 100,
        emissive: ORB2_COLOR,
        emissiveIntensity: 0.5,
        transparent: true,
        opacity: 0.9
    });
    
    // Create orbs
    orb1 = new THREE.Mesh(sphereGeometry, orb1Material);
    orb1.position.set(0, 0, 0);
    orb1.castShadow = true;
    orb1.userData.id = 'orb1';
    orb1.userData.pulsePhase = 0;
    scene.add(orb1);
    
    orb2 = new THREE.Mesh(sphereGeometry, orb2Material);
    
    if (isFirstWindow) {
        // In first window, hide orb2 inside orb1
        orb2.position.set(0, 0, 0);
        orb2.scale.set(0.01, 0.01, 0.01); // Almost invisible
    } else {
        // In other windows, position orb2 normally
        orb2.position.set(5, 0, 0);
        orb2.scale.set(1, 1, 1);
    }
    
    orb2.castShadow = true;
    orb2.userData.id = 'orb2';
    orb2.userData.pulsePhase = Math.PI; // Out of phase with orb1
    scene.add(orb2);

    // Create the link between orbs with more artistic style
    createLink();
    
    // Add particle systems around orbs
    createParticles();
}

// Create an artistic link between orbs
function createLink() {
    // Create curve for the link with multiple control points for more organic feel
    const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(orb1.position.x, orb1.position.y, orb1.position.z),
        new THREE.Vector3(
            (orb1.position.x + orb2.position.x) / 2, 
            (orb1.position.y + orb2.position.y) / 2 + 0.5, 
            (orb1.position.z + orb2.position.z) / 2 + 0.5
        ),
        new THREE.Vector3(orb2.position.x, orb2.position.y, orb2.position.z)
    ]);
    
    const linkGeometry = new THREE.TubeGeometry(
        curve,
        64,  // tubular segments for smoother look
        0.05,  // radius
        12,  // radial segments for smoother tube
        false  // closed
    );
    
    const linkMaterial = new THREE.MeshPhongMaterial({ 
        color: isFirstWindow ? LINK_CLOSE_COLOR : LINK_FAR_COLOR,
        shininess: 100,
        transparent: true,
        opacity: 0.7
    });
    
    link = new THREE.Mesh(linkGeometry, linkMaterial);
    scene.add(link);
}

// Create particle systems around orbs
function createParticles() {
    const particleGeometry1 = new THREE.BufferGeometry();
    const particleGeometry2 = new THREE.BufferGeometry();
    
    const positions1 = new Float32Array(PARTICLE_COUNT * 3);
    const positions2 = new Float32Array(PARTICLE_COUNT * 3);
    const colors1 = new Float32Array(PARTICLE_COUNT * 3);
    const colors2 = new Float32Array(PARTICLE_COUNT * 3);
    const sizes1 = new Float32Array(PARTICLE_COUNT);
    const sizes2 = new Float32Array(PARTICLE_COUNT);
    
    // Generate random particles around orb1
    const color1 = new THREE.Color(ORB1_COLOR);
    const radius1 = ORB_RADIUS * 3;
    
    for (let i = 0; i < PARTICLE_COUNT; i++) {
        // Random position in a sphere around orb1
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        const r = radius1 * Math.cbrt(Math.random()); // Cube root for uniform distribution
        
        positions1[i * 3] = orb1.position.x + r * Math.sin(phi) * Math.cos(theta);
        positions1[i * 3 + 1] = orb1.position.y + r * Math.sin(phi) * Math.sin(theta);
        positions1[i * 3 + 2] = orb1.position.z + r * Math.cos(phi);
        
        // Varying colors, brighter toward center
        const intensity = 0.5 + 0.5 * (1 - r / radius1);
        colors1[i * 3] = color1.r * intensity;
        colors1[i * 3 + 1] = color1.g * intensity;
        colors1[i * 3 + 2] = color1.b * intensity;
        
        // Random sizes, smaller toward edges
        sizes1[i] = 0.05 + 0.05 * Math.random() * (1 - r / radius1);
    }
    
    particleGeometry1.setAttribute('position', new THREE.BufferAttribute(positions1, 3));
    particleGeometry1.setAttribute('color', new THREE.BufferAttribute(colors1, 3));
    particleGeometry1.setAttribute('size', new THREE.BufferAttribute(sizes1, 1));
    
    // Same for orb2
    const color2 = new THREE.Color(ORB2_COLOR);
    const radius2 = ORB_RADIUS * 3;
    
    for (let i = 0; i < PARTICLE_COUNT; i++) {
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        const r = radius2 * Math.cbrt(Math.random());
        
        positions2[i * 3] = orb2.position.x + r * Math.sin(phi) * Math.cos(theta);
        positions2[i * 3 + 1] = orb2.position.y + r * Math.sin(phi) * Math.sin(theta);
        positions2[i * 3 + 2] = orb2.position.z + r * Math.cos(phi);
        
        const intensity = 0.5 + 0.5 * (1 - r / radius2);
        colors2[i * 3] = color2.r * intensity;
        colors2[i * 3 + 1] = color2.g * intensity;
        colors2[i * 3 + 2] = color2.b * intensity;
        
        sizes2[i] = 0.05 + 0.05 * Math.random() * (1 - r / radius2);
    }
    
    particleGeometry2.setAttribute('position', new THREE.BufferAttribute(positions2, 3));
    particleGeometry2.setAttribute('color', new THREE.BufferAttribute(colors2, 3));
    particleGeometry2.setAttribute('size', new THREE.BufferAttribute(sizes2, 1));
    
    // Create shader material for particles
    const particleMaterial = new THREE.PointsMaterial({
        size: 0.1,
        vertexColors: true,
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true
    });
    
    // Create particle systems
    particleSystem1 = new THREE.Points(particleGeometry1, particleMaterial);
    particleSystem1.userData.orbId = 'orb1';
    scene.add(particleSystem1);
    
    particleSystem2 = new THREE.Points(particleGeometry2, particleMaterial);
    particleSystem2.userData.orbId = 'orb2';
    particleSystem2.visible = !isFirstWindow; // Only show in secondary windows
    scene.add(particleSystem2);
}

// Create a field of background stars
function createStarField() {
    const starsGeometry = new THREE.BufferGeometry();
    const starCount = 2000;
    
    const positions = new Float32Array(starCount * 3);
    const sizes = new Float32Array(starCount);
    
    for (let i = 0; i < starCount; i++) {
        // Random position in a large sphere around the scene
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        const r = 50 + Math.random() * 50; // Between 50-100 units away
        
        positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
        positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
        positions[i * 3 + 2] = r * Math.cos(phi);
        
        // Random sizes for stars
        sizes[i] = 0.05 + Math.random() * 0.1;
    }
    
    starsGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    starsGeometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    
    const starsMaterial = new THREE.PointsMaterial({
        color: 0xffffff,
        size: 0.1,
        transparent: true,
        opacity: 0.8,
        sizeAttenuation: true
    });
    
    const starField = new THREE.Points(starsGeometry, starsMaterial);
    scene.add(starField);
}

// Setup OrbitControls and DragControls if available
function setupControls() {
    try {
        // Setup orbit controls if available
        if (typeof THREE.OrbitControls !== 'undefined') {
            debug("Setting up OrbitControls");
            orbitControls = new THREE.OrbitControls(camera, renderer.domElement);
            orbitControls.enableDamping = true;
            orbitControls.dampingFactor = 0.05;
            orbitControls.autoRotate = true;
            orbitControls.autoRotateSpeed = 0.5;
            orbitControls.enableZoom = true;
            orbitControls.minDistance = 3;
            orbitControls.maxDistance = 20;
        } else {
            debug("OrbitControls not available - navigation disabled");
        }
        
        // Setup drag controls if available
        if (typeof THREE.DragControls !== 'undefined') {
            debug("Setting up DragControls");
            
            // Only allow dragging the visible orbs
            const draggableObjects = [orb1];
            if (!isFirstWindow) {
                draggableObjects.push(orb2);
            }
            
            dragControls = new THREE.DragControls(draggableObjects, camera, renderer.domElement);
            
            // Disable orbit controls during drag if orbit controls exist
            if (orbitControls) {
                dragControls.addEventListener('dragstart', function() {
                    orbitControls.enabled = false;
                });
                
                dragControls.addEventListener('dragend', function(event) {
                    orbitControls.enabled = true;
                    const orb = event.object;
                    updateOrbPosition(orb);
                });
            } else {
                // If no orbit controls, still update position on drag end
                dragControls.addEventListener('dragend', function(event) {
                    const orb = event.object;
                    updateOrbPosition(orb);
                });
            }
            
            // Update link during drag
            dragControls.addEventListener('drag', function() {
                updateLink();
                updateParticles();
            });
        } else {
            debug("DragControls not available - orb dragging disabled");
        }
    } catch (error) {
        debug("Error setting up controls: " + error.message);
    }
}

// Initialize Socket.IO connection
function initSocketIO() {
    debug("Initializing Socket.IO connection...");
    
    // Connect to the Socket.IO server
    socket = io({
        transports: ['websocket', 'polling'],
        reconnectionAttempts: 5,
        reconnectionDelay: 1000
    });
    
    // Listen for connection events
    socket.on('connect', function() {
        debug('Connected to server with ID: ' + socket.id);
        socket.emit('get_state');
    });
    
    // Listen for state updates
    socket.on('state_update', function(state) {
        debug('Received state update');
        updateOrbsFromState(state);
    });
    
    // Handle connection errors
    socket.on('connect_error', function(error) {
        debug('Connection Error: ' + error);
    });
    
    socket.on('reconnect_attempt', function(attemptNumber) {
        debug('Trying to reconnect, attempt: ' + attemptNumber);
    });
    
    socket.on('reconnect_failed', function() {
        debug('Failed to reconnect to server');
        alert('Failed to connect to the server. Please refresh the page.');
    });
}

// Initialize event listeners
function initEventListeners() {
    console.log("Setting up event listeners...");
    
    // Listen for key presses for special actions
    document.addEventListener('keydown', function(event) {
        // Toggle camera animation with spacebar
        if (event.code === 'Space') {
            if (orbitControls) {
                cameraAnimation = !cameraAnimation;
                orbitControls.autoRotate = cameraAnimation;
                debug("Camera animation: " + (cameraAnimation ? "ON" : "OFF"));
            }
        }
    });
    
    // Listen for new window button click
    const newWindowButton = document.getElementById('newWindow');
    
    if (newWindowButton) {
        console.log("New window button found, attaching event listener");
        
        newWindowButton.addEventListener('click', function(event) {
            console.log("New window button clicked via event listener");
            if (isFirstWindow) {
                // If this is the first window, trigger mitosis animation before opening
                triggerMitosis();
                // Delay window opening slightly for dramatic effect
                setTimeout(openNewWindow, 800);
            } else {
                openNewWindow();
            }
        });
    } else {
        console.error("New window button not found in the DOM!");
    }
}

// Trigger mitosis animation when first window opens a second one
function triggerMitosis() {
    if (!isFirstWindow) return;
    
    debug("Triggering mitosis animation!");
    
    // Show orb2
    orb2.visible = true;
    particleSystem2.visible = true;
    
    // Animate mitosis
    const startTime = Date.now();
    const duration = 800; // ms
    
    function animateMitosis() {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);
        
        // Ease function: cubic ease-out
        const eased = 1 - Math.pow(1 - progress, 3);
        
        // Move orb2 away from orb1
        const targetX = 5; // Final position
        orb2.position.x = eased * targetX;
        
        // Grow orb2 from nearly invisible to full size
        const scale = 0.01 + eased * 0.99;
        orb2.scale.set(scale, scale, scale);
        
        // Update the link and particles
        updateLink();
        updateParticles();
        
        if (progress < 1) {
            requestAnimationFrame(animateMitosis);
        }
    }
    
    animateMitosis();
}

// Animation loop
function animate() {
    requestAnimationFrame(animate);
    
    // Animate particles
    animateParticles();
    
    // Animate orb pulsing
    animateOrbPulse();
    
    if (orbitControls) {
        orbitControls.update();
    }
    
    renderer.render(scene, camera);
}

// Animate orbs with a subtle pulsing effect
function animateOrbPulse() {
    const now = Date.now() / 1000; // Convert to seconds
    
    // Pulse orb1
    const scale1 = 1 + 0.05 * Math.sin(now * 2 + orb1.userData.pulsePhase);
    orb1.scale.set(scale1, scale1, scale1);
    
    // Only pulse orb2 if it's visible
    if (!isFirstWindow || orb2.scale.x > 0.1) {
        const scale2 = 1 + 0.05 * Math.sin(now * 2 + orb2.userData.pulsePhase);
        
        // Don't override scale during mitosis animation
        if (!isFirstWindow) {
            orb2.scale.set(scale2, scale2, scale2);
        } else if (orb2.scale.x > 0.1) {
            // Only apply pulsing once the orb is large enough during mitosis
            orb2.scale.multiplyScalar(1 + 0.02 * Math.sin(now * 2 + orb2.userData.pulsePhase));
        }
    }
    
    // Make the link more dynamic with slight movement
    if (link) {
        // Update the link to follow orb positions with some added organic movement
        updateLink(0.2 * Math.sin(now * 1.5), 0.2 * Math.cos(now * 2.3));
    }
}

// Animate particles with flowing motion
function animateParticles() {
    if (!particleSystem1 || !particleSystem2) return;
    
    const now = Date.now() / 1000;
    
    // Animate first particle system
    const positions1 = particleSystem1.geometry.attributes.position.array;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
        const ix = i * 3;
        const iy = i * 3 + 1;
        const iz = i * 3 + 2;
        
        // Get current position relative to orb1
        const x = positions1[ix] - orb1.position.x;
        const y = positions1[iy] - orb1.position.y;
        const z = positions1[iz] - orb1.position.z;
        
        // Calculate distance from center
        const dist = Math.sqrt(x*x + y*y + z*z);
        
        // Rotate around orb with speed inversely proportional to distance
        const angle = now * (0.5 / Math.max(0.1, dist));
        const newX = x * Math.cos(angle) - y * Math.sin(angle);
        const newY = x * Math.sin(angle) + y * Math.cos(angle);
        
        // Add some wavy motion in z direction
        const newZ = z + 0.01 * Math.sin(dist * 5 + now * 2);
        
        // Update position
        positions1[ix] = newX + orb1.position.x;
        positions1[iy] = newY + orb1.position.y;
        positions1[iz] = newZ + orb1.position.z;
    }
    particleSystem1.geometry.attributes.position.needsUpdate = true;
    
    // Only animate second particle system if it's visible
    if (!isFirstWindow || particleSystem2.visible) {
        const positions2 = particleSystem2.geometry.attributes.position.array;
        for (let i = 0; i < PARTICLE_COUNT; i++) {
            const ix = i * 3;
            const iy = i * 3 + 1;
            const iz = i * 3 + 2;
            
            // Get current position relative to orb2
            const x = positions2[ix] - orb2.position.x;
            const y = positions2[iy] - orb2.position.y;
            const z = positions2[iz] - orb2.position.z;
            
            // Calculate distance from center
            const dist = Math.sqrt(x*x + y*y + z*z);
            
            // Rotate around orb with speed inversely proportional to distance
            // Use opposite direction to orb1 for contrast
            const angle = -now * (0.5 / Math.max(0.1, dist));
            const newX = x * Math.cos(angle) - y * Math.sin(angle);
            const newY = x * Math.sin(angle) + y * Math.cos(angle);
            
            // Add some wavy motion in z direction (different phase from orb1)
            const newZ = z + 0.01 * Math.sin(dist * 5 + now * 2 + Math.PI);
            
            // Update position
            positions2[ix] = newX + orb2.position.x;
            positions2[iy] = newY + orb2.position.y;
            positions2[iz] = newZ + orb2.position.z;
        }
        particleSystem2.geometry.attributes.position.needsUpdate = true;
    }
}

// Update particles to follow orbs
function updateParticles() {
    if (!particleSystem1 || !particleSystem2) return;
    
    // Update first particle system to follow orb1
    const positions1 = particleSystem1.geometry.attributes.position.array;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
        const ix = i * 3;
        const iy = i * 3 + 1;
        const iz = i * 3 + 2;
        
        // Get current position relative to the original orb position
        const x = positions1[ix] - particleSystem1.userData.lastOrbX || 0;
        const y = positions1[iy] - particleSystem1.userData.lastOrbY || 0;
        const z = positions1[iz] - particleSystem1.userData.lastOrbZ || 0;
        
        // Update position to follow the orb
        positions1[ix] = x + orb1.position.x;
        positions1[iy] = y + orb1.position.y;
        positions1[iz] = z + orb1.position.z;
    }
    
    // Store current orb position for next update
    particleSystem1.userData.lastOrbX = orb1.position.x;
    particleSystem1.userData.lastOrbY = orb1.position.y;
    particleSystem1.userData.lastOrbZ = orb1.position.z;
    
    particleSystem1.geometry.attributes.position.needsUpdate = true;
    
    // Do the same for second particle system if it's visible
    if (!isFirstWindow || particleSystem2.visible) {
        const positions2 = particleSystem2.geometry.attributes.position.array;
        for (let i = 0; i < PARTICLE_COUNT; i++) {
            const ix = i * 3;
            const iy = i * 3 + 1;
            const iz = i * 3 + 2;
            
            const x = positions2[ix] - particleSystem2.userData.lastOrbX || 0;
            const y = positions2[iy] - particleSystem2.userData.lastOrbY || 0;
            const z = positions2[iz] - particleSystem2.userData.lastOrbZ || 0;
            
            positions2[ix] = x + orb2.position.x;
            positions2[iy] = y + orb2.position.y;
            positions2[iz] = z + orb2.position.z;
        }
        
        particleSystem2.userData.lastOrbX = orb2.position.x;
        particleSystem2.userData.lastOrbY = orb2.position.y;
        particleSystem2.userData.lastOrbZ = orb2.position.z;
        
        particleSystem2.geometry.attributes.position.needsUpdate = true;
    }
}

// Handle window resize
function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// Send orb position update to server
function updateOrbPosition(orb) {
    const orbId = orb.userData.id;
    const position = {
        x: orb.position.x,
        y: orb.position.y,
        z: orb.position.z
    };
    
    socket.emit('update_state', {
        orb_id: orbId,
        position: position
    });
}

// Update orbs positions from server state
function updateOrbsFromState(state) {
    // Update orb1
    orb1.position.set(
        state.orb1.x,
        state.orb1.y,
        state.orb1.z
    );
    
    // Update orb2
    orb2.position.set(
        state.orb2.x,
        state.orb2.y,
        state.orb2.z
    );
    
    // If this is the first window and orb2 is still hidden,
    // check if we should trigger mitosis based on orb2 position
    if (isFirstWindow && orb2.scale.x < 0.1) {
        const distance = orb1.position.distanceTo(orb2.position);
        if (distance > 0.1) {
            // Someone moved orb2 in another window, show it here too
            triggerMitosis();
        }
    }
    
    // Update link and particles
    updateLink();
    updateParticles();
}

// Update the link between orbs
function updateLink(yOffset = 0, zOffset = 0) {
    // Remove old link
    if (link) {
        scene.remove(link);
    }
    
    // Calculate distance between orbs
    const distance = orb1.position.distanceTo(orb2.position);
    
    // Set color based on threshold (green if close, red if far) as per spec
    const color = distance < DISTANCE_THRESHOLD ? LINK_CLOSE_COLOR : LINK_FAR_COLOR;
    
    // Calculate thickness based on distance (thinner when far)
    const thickness = 0.05 * (1 - (Math.min(distance / 10, 1) * 0.5));
    
    // Create more organic link with control points
    const midPoint = new THREE.Vector3(
        (orb1.position.x + orb2.position.x) / 2,
        (orb1.position.y + orb2.position.y) / 2 + yOffset,
        (orb1.position.z + orb2.position.z) / 2 + zOffset
    );
    
    const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(orb1.position.x, orb1.position.y, orb1.position.z),
        midPoint,
        new THREE.Vector3(orb2.position.x, orb2.position.y, orb2.position.z)
    ]);
    
    // Create new link geometry with more segments for smoother look
    const linkGeometry = new THREE.TubeGeometry(
        curve,
        64,  // tubular segments
        thickness,  // radius
        12,  // radial segments
        false  // closed
    );
    
    // Create new link material with updated color and glow
    const linkMaterial = new THREE.MeshPhongMaterial({ 
        color: color,
        shininess: 100,
        transparent: true,
        opacity: 0.7,
        emissive: color,
        emissiveIntensity: 0.3
    });
    
    // Create new link mesh
    link = new THREE.Mesh(linkGeometry, linkMaterial);
    scene.add(link);
    
    // Only show link if orb2 is visible (after mitosis in first window)
    link.visible = !isFirstWindow || orb2.scale.x > 0.1;
}

// Global function to open a new window
window.openNewWindow = function() {
    debug("Opening new window...");
    try {
        // Use a direct URL rather than window.location.href for better reliability
        const url = window.location.origin + window.location.pathname;
        debug(`Opening URL: ${url}`);
        
        const newWindow = window.open(url, '_blank');
        
        if (!newWindow || newWindow.closed || typeof newWindow.closed === 'undefined') {
            debug("Popup blocked!");
            alert('Popup blocked! Please allow popups for this website to open a new window.');
        } else {
            debug("New window opened successfully");
            lastOpened = Date.now();
        }
    } catch (error) {
        debug(`Error opening window: ${error.message}`);
        alert('Error opening new window: ' + error.message);
    }
};

// Start the application when the DOM is fully loaded
document.addEventListener('DOMContentLoaded', function() {
    console.log("DOM fully loaded");
    setTimeout(init, 100); // Small delay to ensure DOM is fully processed
});

// Fallback for older browsers
window.onload = function() {
    console.log("Window fully loaded");
    if (!scene) { // Check if app is already initialized
        init();
    }
};