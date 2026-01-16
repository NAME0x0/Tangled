# TODO List: Tangled (Entangled Recreation)

Recreation of Bjørn Staal's "Entangled" project - a generative art piece where GPU-accelerated particle simulations in separate browser windows detect and interact with one another based on their relative screen coordinates.

## Project Status: ~45% Complete

The single-window GPGPU particle system is fully functional. The entire multi-window coordination layer (the core "Entangled" feature) is not yet implemented.

---

## I. Foundation (COMPLETE)

- [x] Flask backend server (`app.py`) with eventlet async mode
- [x] Serve HTML (`templates/index.html`), CSS (`static/css/style.css`), JS (`static/js/main.js`)
- [x] Three.js library (r176) with ES6 module imports
- [x] Socket.IO connection (Flask-SocketIO client <-> server)
- [x] Basic Three.js scene (scene, camera, renderer, canvas)
- [x] Animation loop with `requestAnimationFrame`
- [x] OrbitControls for camera navigation
- [x] Window resize handling

## II. GPGPU Particle System (COMPLETE)

- [x] GPUComputationRenderer setup with ping-pong textures
- [x] Position and velocity DataTexture creation (192x192 = 36,864 particles)
- [x] Initial particle spawn (spherical distribution)
- [x] Particle BufferGeometry with UV mapping
- [x] Points mesh with ShaderMaterial
- [x] Additive blending for glow effect

### Velocity Shader Forces (COMPLETE)
- [x] Attractor force with distance-squared falloff
- [x] Repulsion force near attractor core
- [x] Orbit force (tangential) in middle zone
- [x] Outward push force with smoothstep modulation
- [x] Curl noise force (simplex 3D noise with central differences)
- [x] Direct noise force (independent xyz channels)
- [x] Membrane curl noise (surface-specific)
- [x] Ambient jitter force (subtle continuous perturbation)
- [x] Camera rotation inertia force
- [x] Wave force (5 superposed sine waves)
- [x] Membrane boundary forces (push/pull at radius limits)
- [x] Velocity damping with distance modulation
- [x] Velocity clamping (max velocity limit)
- [x] Velocity advection

### Position Shader (COMPLETE)
- [x] Velocity integration (`position += velocity * dt`)
- [x] Age increment tracking

### Render Shaders (PARTIAL)
- [x] Position fetch from GPGPU texture
- [x] Camera matrix transformations
- [x] Point size from uniform
- [ ] Dynamic point size based on velocity/age
- [ ] Color based on attractor proximity (Red/Green split)
- [ ] Alpha fading based on age/velocity

---

## III. Multi-Window System (NOT STARTED - CORE FEATURE)

This is the defining feature of "Entangled" - particles in separate browser windows interact based on screen coordinates.

### WindowManager Class
- [ ] Create `static/js/WindowManager.js` class
- [ ] Generate unique ID for each window instance
- [ ] Poll window properties every frame:
  - `window.screenX`, `window.screenY`
  - `window.innerWidth`, `window.innerHeight`
- [ ] Write window metadata to localStorage
- [ ] Read all window metadata from localStorage
- [ ] Detect and clean up stale/closed windows (timeout-based)
- [ ] Expose list of all active windows with their screen positions

### localStorage Synchronization
- [ ] Define localStorage key schema for window data
- [ ] Implement `storage` event listener for cross-window updates
- [ ] Handle race conditions and initial load states
- [ ] Implement window registration on page load
- [ ] Implement window deregistration on `beforeunload`

### Global Coordinate System
- [ ] Map screen-space coordinates to Three.js world-space
- [ ] Offset camera position based on window.screenX/screenY:
  ```javascript
  camera.position.x = window.screenX + window.innerWidth / 2;
  camera.position.y = window.screenY + window.innerHeight / 2;
  ```
- [ ] Define "World Space" spanning the entire monitor
- [ ] Ensure particles at World Position (X, Y) render correctly across windows
- [ ] Adjust camera frustum dynamically for window size

### Cross-Window Particle Interaction
- [ ] Pass other window positions as uniforms to velocity shader
- [ ] Implement attraction/repulsion forces towards other window centers
- [ ] Particles "reach out" towards particles in other windows
- [ ] Force strength based on distance between window centers

---

## IV. Visual Tendrils (NOT STARTED)

The visual connections between particle clouds in different windows.

- [ ] Design tendril rendering approach:
  - Option A: Dedicated particle stream between windows
  - Option B: `THREE.LineSegments` between window centers
  - Option C: `THREE.TubeGeometry` with animated path
- [ ] Implement tendril geometry creation
- [ ] Animate tendrils based on window positions
- [ ] Color tendrils based on connection strength
- [ ] Tendrils should form "elastic bonds" regardless of window distance

---

## V. Visual Polish (NOT STARTED)

### Particle Coloring
- [ ] Red/Green color split based on attractor proximity
- [ ] Color gradient based on velocity magnitude
- [ ] Color based on particle age

### Particle Rendering
- [ ] Alpha fading based on age
- [ ] Alpha fading based on velocity (faster = more visible?)
- [ ] Dynamic point size based on velocity
- [ ] Point size variation based on depth/distance

### Aesthetic Refinements
- [ ] Fine-tune particle aesthetics (lifespan, speed, size)
- [ ] Adjust force parameters for organic flow
- [ ] Match "Entangled" visual style (fungal gill structures, organic patterns)

---

## VI. Backend Integration (PARTIAL)

- [x] Server stores simulation parameters
- [x] Server broadcasts parameters on client connect
- [x] Server receives parameter update requests
- [x] Server broadcasts updated parameters to all clients
- [ ] Client applies received parameters to shader uniforms (TODO in code)
- [ ] HTML UI controls for parameter adjustment
- [ ] Real-time parameter tweaking from UI

---

## VII. Optimization & Cleanup (NOT STARTED)

- [ ] Optimize shader performance
- [ ] Profile and optimize particle count vs. browser performance
- [ ] Debug any synchronization issues between windows
- [ ] Code cleanup and documentation
- [ ] Remove development console.log statements
- [ ] Test across browsers (Chrome, Firefox, Edge)

---

## Implementation Priority Order

1. **WindowManager.js** - Foundation for multi-window
2. **localStorage synchronization** - Cross-window communication
3. **Global coordinate system** - Screen-to-world mapping
4. **Cross-window particle interaction** - Physics responding to other windows
5. **Visual tendrils** - Visible connections between windows
6. **Visual polish** - Colors, alpha, sizing
7. **Optimization** - Performance and cleanup

---

## Reference: Entangled Architecture

From Bjørn Staal's `multipleWindow3dScene`:

```
WindowManager.js
├── Unique window ID generation
├── localStorage window metadata storage
├── Stale window detection and cleanup
└── Active window list management

main.js
├── Three.js scene initialization
├── Read all window positions from localStorage
├── Convert screen coords to world coords
├── Camera offset based on window.screenX/Y
└── Render particles in global coordinate space

Coordinate Mapping:
- Window at (0,0) with size 500x500
- Window at (500,0) with size 500x500
- Particle at World(250, 250) appears:
  - Right edge of Window A
  - Left edge of Window B
```
