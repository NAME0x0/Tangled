# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Tangled is a recreation of Bjørn Staal's "Entangled" project - a generative art piece where GPU-accelerated particle simulations in separate browser windows detect and interact with one another based on their relative screen coordinates.

**Tech Stack:**
- Backend: Python/Flask with Flask-SocketIO (eventlet async mode)
- Frontend: Vanilla JavaScript (ES6 modules), Three.js (r176)
- Graphics: WebGL with custom GLSL shaders for GPU particle physics
- Synchronization: localStorage for cross-window state sharing (primary), Socket.IO for server parameters

## Target: Entangled Behavior

The core innovation is **inter-window communication**: particles from one window "reach out" to particles in another window using visual tendrils, forming elastic bonds. Moving or resizing windows alters the physics and visual outcomes.

### Key Components to Implement

1. **WindowManager**: Assigns unique ID per window, polls `screenX`/`screenY`/`innerWidth`/`innerHeight` to localStorage, detects stale/closed windows

2. **Global Coordinate System**: Map screen-space to 3D world-space so objects appear static relative to the monitor while windows move:
   ```javascript
   // Window writes its metadata to localStorage
   const windowInfo = {
       id: windowId,
       shape: { x: window.screenX, y: window.screenY, w: window.innerWidth, h: window.innerHeight },
       updated: Date.now()
   };

   // Camera offset based on screen position
   camera.position.x = window.screenX + window.innerWidth / 2;
   camera.position.y = window.screenY + window.innerHeight / 2;
   ```

3. **Cross-Window Particle Interaction**: Read all active window positions from localStorage, particles in one window respond to particles/attractors in other windows

4. **Visual Tendrils**: Draw connections between particle clouds in different windows (dedicated particle streams, LineSegments, or TubeGeometry)

## Development Commands

```bash
# Install dependencies
pip install -r requirements.txt

# Run development server (serves at http://localhost:5000)
python app.py
```

No frontend build step - static files are served directly by Flask.

## Architecture

### GPGPU Particle Pipeline

The core visualization uses a ping-pong texture technique for GPU-based particle simulation:

1. **Velocity Update** (`static/shaders/gpgpu_velocity.frag`): Computes forces (attractor, noise, damping) and updates particle velocities
2. **Position Update** (`static/shaders/gpgpu_position.frag`): Integrates velocity to update positions, handles respawn logic
3. **Render Pass** (`static/shaders/particle_render.vert/frag`): Draws particles using computed positions with additive blending

### Key Components

- `app.py` - Flask server managing Socket.IO connections and simulation parameter broadcasting
- `static/js/main.js` - Main application: Three.js scene setup, GPGPU initialization, animation loop
- `static/shaders/` - GLSL shaders for particle physics and rendering
- `static/js/vendor/` - Three.js library and extensions (OrbitControls, GPUComputationRenderer)

### Data Flow

```
Server (app.py) --[Socket.IO]--> Client (main.js)
                                    |
                                    v
                            Update shader uniforms
                                    |
                                    v
                            GPGPU compute pass
                                    |
                                    v
                            Render particles
```

## Current Implementation Status

**Completed:**
- Flask/SocketIO server with parameter broadcasting
- Basic Three.js scene with GPGPU particle system (ping-pong textures)
- Velocity shader: attractor forces, simplex noise, damping, orbit/repulsion effects
- Position shader: velocity integration, boundary checks, respawn
- Particle rendering with additive blending
- OrbitControls for camera navigation

**Not Yet Implemented:**
- WindowManager class for multi-window coordination
- localStorage-based cross-window synchronization
- Global coordinate system (screen-space to world-space mapping)
- Cross-window particle interaction (particles responding to other windows)
- Visual tendrils connecting particle clouds between windows
- Red/Green coloring based on attractor proximity
- Particle alpha fading based on age/velocity

## Working with Shaders

GLSL shaders are critical for the visual style. When modifying:

- **Velocity shader** (`gpgpu_velocity.frag`): Attractor forces, curl noise, damping, orbit effects
- **Position shader** (`gpgpu_position.frag`): Velocity integration, boundary checks, respawn mechanics
- **Render shaders** (`particle_render.vert/frag`): Size, color based on attractor proximity, alpha

Prefer mathematical operations over conditional logic (`if` statements) - use smooth interpolation and vector math for more organic behavior.

## AI Assistant Guidelines (from project rules)

- **Be Iterative**: Generate code sequentially (e.g., "Set up structure first," then "Initialize particle system," then "Implement force in shader")
- **Be Specific**: Instead of "It doesn't look right," say "The particles aren't swirling - add curl noise to the update shader"
- **Provide Context**: Reference specific files and code blocks when asking for modifications
- **Debug Systematically**: Step through issues ("Check if attractor uniform is passed correctly," "Draw attractor positions for debugging")
- **Preserve Existing Code**: Don't remove unrelated code or functionalities
- **Single Chunk Edits**: Provide all edits in one consolidated update
