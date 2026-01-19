# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Tangled is a recreation of Bjørn Staal's "Entangled" project - a generative art piece where GPU-accelerated particle simulations in separate browser windows detect and interact with one another based on their relative screen coordinates.

**Tech Stack:**
- Backend: Python/Flask with Flask-SocketIO (eventlet async mode)
- Frontend: Vanilla JavaScript (ES6 modules), Three.js (r176)
- Graphics: WebGL with custom GLSL shaders for GPU particle physics
- Synchronization: localStorage for cross-window state sharing (primary), Socket.IO for server parameters

## Development Commands

```bash
# Install dependencies
pip install -r requirements.txt

# Run development server (serves at http://localhost:5000)
python app.py

# API endpoints for debugging
# http://localhost:5000/api/status  - Server status and metrics
# http://localhost:5000/api/clients - Connected clients info
```

No frontend build step - static files are served directly by Flask.

## Architecture

### Multi-Window Coordination

The core innovation is **inter-window communication** via localStorage:

1. **WindowManager** (`static/js/WindowManager.js`): Each window polls `screenX`/`screenY`/`innerWidth`/`innerHeight` to localStorage, detecting other windows and stale/closed windows (2s timeout)

2. **Global Coordinate System**: Screen-space maps to world-space so particles appear static relative to the monitor:
   ```javascript
   camera.position.x = window.screenX + window.innerWidth / 2;
   camera.position.y = -(window.screenY + window.innerHeight / 2); // Y inverted
   ```

3. **Cross-Window Rendering**: Ghost clouds render simplified representations of other windows' particle clouds; tendrils connect clouds between windows

### GPGPU Particle Pipeline

Uses ping-pong texture technique for GPU-based simulation (65,536 particles in a 256×256 texture):

1. **Velocity Update**: Forces (attractor, curl noise, breathing, heartbeat, membrane ripple, internal currents, micro-movements, cross-window attraction)
2. **Position Update**: Velocity integration, boundary checks, respawn within layer shells
3. **Render Pass**: Layer-specific colors/sizes, rim lighting, subsurface scattering, soft gaussian falloff

### Six-Layer Particle System

Particles are organized in concentric layers with distinct behaviors:
- **Nucleus** (0-6): Stiff, warm amber core
- **Inner Plasma** (7.5-14): Fluid, coral/peach
- **Cytoplasm** (15-24): Fluid with slow orbit, greenish-white
- **Membrane** (25.5-35): Fluid, blue-green bioluminescent
- **Outer Membrane** (37-48): Orbiting, silver-lavender
- **Halo** (51-65): Stiff, ghostly outer aura

### Key Files

- `app.py` - Flask server with Socket.IO, connection tracking, verbose logging
- `static/js/main.js` - Main application: GPGPU setup, all shaders inline, animation loop, tendril/dust/ghost systems
- `static/js/WindowManager.js` - localStorage-based multi-window detection
- `templates/index.html` - Entry point with Three.js imports

### Data Flow

```
localStorage <---> WindowManager <---> main.js (particle positions, window shapes)
Server (app.py) --[Socket.IO]--> Clients (parameter sync, entanglement events)
```

## Working with Shaders

All GLSL shaders are defined inline in `main.js` as template literals. Key shader sections:

- **Velocity shader** (~lines 130-950): All force calculations including curl noise, breathing, heartbeat pulse, membrane ripple, internal currents, cross-window forces
- **Position shader** (~lines 960-1040): Velocity integration, layer-based respawn
- **Particle render shader** (~lines 1045-1270): Layer colors, lighting, soft gaussian falloff
- **Tendril shader** (~lines 2415-2685): Helical waves, energy pulses, bioluminescent colors
- **Dust shader** (~lines 2730-2840): Atmospheric particles
- **Film post-processing** (~lines 1270-1350): Vignette, chromatic aberration, film grain

**Shader guidelines:**
- Prefer mathematical operations over conditionals - use `smoothstep`, `mix`, `exp` for organic behavior
- Unroll loops for GPU performance (see heartbeat pulse implementation)
- Use pre-computed constants where possible (e.g., `invEps2 = 1.0 / (2.0 * eps)`)

## Cross-Window Tendrils

Tendrils connect particle clouds between windows:
- Coordinates are in screen-space pixels (100-3000+ range)
- Distance fade must account for large pixel distances: `smoothstep(2500.0, 150.0, distance)`
- Y coordinate is inverted: `worldY = -win.center.y`
- Use `depthTest: false` and `renderOrder: 100` to ensure visibility

## AI Assistant Guidelines

- **Be Iterative**: Generate code sequentially - structure first, then particle system, then shader forces
- **Be Specific**: Reference exact line numbers and shader sections when discussing changes
- **Preserve Existing Code**: The shader code is complex and interdependent - don't remove unrelated sections
- **Debug Systematically**: Add console.log statements sparingly; check uniform values, connection states
- **Test Multi-Window**: Always test with 2+ browser windows to verify cross-window features
