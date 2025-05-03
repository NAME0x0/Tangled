# TODO List: Tangled Web (Entangled Recreation)

This list outlines the steps needed to transition from the current foundational Flask/SocketIO/Three.js setup (rotating cube) to the target visualization inspired by Bjørn Staal's "Entangled" project, focusing on multi-window GPU particles.

## I. Foundational Setup (Partially Completed)

-   [x] Set up Flask backend server (`app.py`).
-   [x] Serve basic HTML (`index.html`), CSS (`style.css`), and JS (`main.js`).
-   [x] Include Three.js library (r176, using `three.module.js` via import map).
-   [x] Establish WebSocket connection (Flask-SocketIO client <-> server using `eventlet`).
-   [x] Set up basic Three.js scene (scene, camera, renderer, canvas) in `main.js`.
-   [x] Implement basic animation loop (`requestAnimationFrame`) in `main.js`.
-   [x] Render a placeholder object (currently a rotating, color-cycling cube).

## II. Core GPU Particle System Implementation (GPGPU in Three.js)

-   [ ] **Research & Setup GPGPU:**
    -   [x] Study Three.js examples for GPU-Compute / GPGPU particle systems (using `WebGLRenderTarget` and `DataTexture`).
    -   [x] Design data structure for particle state (position, velocity, age, etc.) to be stored in textures.
    -   [x] Create `WebGLRenderTarget` instances for ping-ponging particle state textures during updates.
    -   [x] Create initial `DataTexture` instances to hold the starting state of particles.
-   [ ] **Particle Update Shaders (GLSL):**
    -   [x] Create `gpgpu_passthru.vert` shader (simple pass-through usually).
    -   [x] Create `gpgpu_velocity.frag` shader containing basic damping logic:
        -   [x] Read previous particle state (velocity) from input texture uniform.
        -   [ ] Implement velocity integration (forces to be added later).
        -   [x] Implement damping/friction (`velocity *= dampingFactor`).
        -   [x] Implement attractor force logic (calculate vector towards attractor uniforms, apply force).
        -   [ ] Implement 3D noise (Perlin/Curl) force logic (sample noise field, apply force).
        -   [ ] Implement particle lifespan check and respawn logic (reset position/velocity if age > maxAge).
        -   [x] Write updated particle state (velocity) to `gl_FragColor`.
    -   [x] Create `gpgpu_position.frag` shader containing basic position update logic:
        -   [x] Read previous particle state (position) and updated velocity state.
        -   [x] Implement basic velocity integration (`newPos = oldPos + velocity * deltaTime`).
        -   [x] Implement particle lifespan check and respawn logic (reset position/velocity if age > maxAge).
        -   [x] Write updated particle state (position, age) to `gl_FragColor`.
-   [ ] **Particle Rendering Shaders (GLSL):**
    -   [x] Create `particle_render.vert` shader:
        -   [x] Read particle position from GPGPU state texture (using particle index/ID).
        -   [x] Set `gl_Position` based on particle position and camera matrices.
        -   [x] Set `gl_PointSize` (can be varied based on uniforms or attributes like age/velocity passed from GPGPU texture).
    -   [x] Create `particle_render.frag` shader:
        -   [x] Set `gl_FragColor`. Implement base particle color.
        -   [ ] Implement logic for Red/Green coloring based on proximity/influence of attractors (passed as uniforms).
        -   [ ] Implement alpha fading (based on age/velocity?).
-   [ ] **Integrate GPGPU into `main.js`:**
    -   [x] Create `BufferGeometry` for the particles (just need indices/IDs).
    -   [x] Create `ShaderMaterial` for the GPGPU update pass, linking the update shaders and state textures.
    -   [x] Create `ShaderMaterial` for rendering, linking the render shaders and the *current* GPGPU state texture.
    -   [x] In the animation loop:
        -   [x] Run the GPGPU update pass (render update shader to the *next* state texture).
        -   [x] Swap the ping-pong textures.
        -   [x] Render the `Points` object using the *current* state texture and render shaders.
    -   [x] Remove the placeholder cube rendering.
    -   [x] Enable additive blending for the renderer: `renderer.setBlending(THREE.AdditiveBlending);`.

## III. Implementing "Entangled" Visual Specifics

-   [x] **Attractors:**
    -   [x] Define positions for at least two main attractors in `main.js`. (Initially two, now one)
    -   [x] Pass attractor positions and strengths as uniforms to the GPGPU update shader.
    -   [ ] Pass attractor positions to the render fragment shader for color logic.
-   [x] **Noise Field:**
    -   [x] Pass noise parameters (scale, strength, time/evolution) as uniforms to the GPGPU update shader.
-   [ ] **Coloring:**
    -   [ ] Refine the Red/Green split logic in the render fragment shader.
-   [ ] **"Tendril" Connection:**
    -   [ ] Design and implement the visual link (e.g., dedicated particle stream, `LineSegments`, or `TubeGeometry` between attractors).
-   [x] **Particle Physics Refinements (Added):**
    -   [x] Implement boundary check/respawn.
    -   [x] Implement repulsion force near attractor core.
    -   [x] Implement orbit force near attractor.
    -   [x] Implement outward push force for 'membrane' effect.

## IV. Multi-Window Simulation / Synchronization

-   [ ] **Strategy:** Decide on synchronization method (localStorage, BroadcastChannel, Server Relay via WebSocket). *Start with localStorage for simplicity.*
-   [ ] **Window Management:**
    -   [ ] Implement logic in `main.js` to detect if it's the primary window or a secondary window (e.g., check `window.opener` or a URL parameter).
    -   [ ] Add a button or mechanism in the primary window to open secondary windows (`window.open`).
-   [ ] **State Synchronization:**
    -   [ ] Define which parameters need syncing (likely attractor positions, noise settings, colors, time).
    -   [ ] Implement writing key simulation parameters to localStorage from the primary window.
    -   [ ] Implement reading parameters from localStorage in secondary windows and updating their simulation/uniforms accordingly.
    -   [ ] Ensure smooth synchronization (handle potential race conditions or initial load states).
-   [ ] **Views:**
    -   [ ] Adjust initial camera positions in primary/secondary windows to frame their respective attractors/regions.

## V. Interaction & Backend Integration (WebSocket Enhancement)

-   [x] **Add Camera Controls:** Implement OrbitControls for user navigation.
-   [ ] **Server State:**
    -   [ ] Move the canonical simulation parameters (attractor positions, noise settings, etc.) to the server (`app.py`).
    -   [ ] Send these parameters to new clients on connection via SocketIO.
-   [ ] **Client Updates:**
    -   [ ] Refine client-side SocketIO listeners (`main.js`) to update shader uniforms when parameters are received from the server.
-   [ ] **User Controls (Optional but Recommended):**
    -   [ ] Add HTML sliders/buttons to `index.html` to control parameters (e.g., attractor X/Y/Z, noise strength).
    -   [ ] Add event listeners in `main.js` to detect UI changes.
    -   [ ] Emit SocketIO messages from the client to the server when the user changes a parameter.
-   [ ] **Server Broadcast:**
    -   [ ] Implement SocketIO listeners on the server (`app.py`) to receive parameter change requests.
    -   [ ] Update the server-side state.
    -   [ ] Broadcast the *updated* parameters to *all* connected clients.

## VI. Refinement and Optimization

-   [ ] Fine-tune particle aesthetics (lifespan, speed, size variations, alpha fades).
-   [ ] Adjust force parameters (attractor strength, noise influence) for the desired visual flow.
-   [ ] Optimize shader performance.
-   [ ] Optimize particle count vs. browser performance.
-   [ ] Debug synchronization issues between windows.
-   [ ] Code cleanup, commenting, and documentation.