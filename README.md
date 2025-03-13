# Entangled Project

An interactive art piece with synchronized 3D particle systems across multiple browser windows, based on Bjorn Staal's *Entangled*, with additional inspiration from [bgstaal/gpuparticles](https://github.com/bgstaal/gpuparticles).

## Features

- Real-time GPU-accelerated particle simulation using `three.js` and `GPUComputationRenderer`
- Advanced curl noise algorithms for organic, fluid-like particle movement
- Cross-window synchronization via `localStorage` with an "entanglement value" derived from particle positions
- Dynamic window spawning with bidirectional influence between paired systems
- Customizable particle color via HSL slider
- Responsive design with GPU texture resizing
- Velocity-based particle coloring for enhanced visual impact

## Prerequisites

- **Browser**: Chrome 95+ or Firefox 90+ (WebGL 2.0 required)
- **Python**: Python 3.10+ with Flask

## Setup Instructions

1. **Install Dependencies**:

   ```bash
   pip install flask flask-cors
   ```

2. **Download Libraries**:
   - Download `three.min.js` (v0.148.0) from [CDN link](https://cdn.jsdelivr.net/npm/three@0.148.0/build/three.min.js) and place it in `static/js/`
   - Download `GPUComputationRenderer.js` from [Direct source](https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/jsm/misc/GPUComputationRenderer.js) and place it in `static/js/`

3. **Directory Structure**:

   ```plaintext
   entangled_project/
   ├── static/
   │   ├── css/
   │   │   └── style.css
   │   └── js/
   │       ├── three.min.js         # v0.148.0
   │       ├── GPUComputationRenderer.js
   │       └── main.js
   ├── templates/
   │   └── index.html
   ├── app.py
   └── README.md
   ```

4. **Run Server**:

   ```bash
   python app.py
   ```

5. **Access**: Open `http://localhost:5000` in your browser.

## Usage

- Move your mouse to interact with the particles
- Use the Hue slider to change the color of the particles
- Click "Spawn Entangled Window" to create a new window that synchronizes with the current one
- Watch as particle systems in different windows influence each other through entanglement forces

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Black screen | Confirm `three.min.js` and `GPUComputationRenderer.js` are in `static/js/` |
| No synchronization | Enable CORS in Flask and disable browser security flags (e.g., `chrome://flags/#block-insecure-private-network-requests`) |
| Low FPS | Reduce `PARTICLE_COUNT` to 16384 (128x128 grid) in `main.js` |
| GPU compatibility issues | The system will automatically fall back to CPU mode with fewer particles |

## Performance Optimization

- Particle sampling for `localStorage` sync is limited to small texture regions
- Particle count is optimized for balance between visual density and performance
- Damping factors prevent exponential growth of forces between windows
- Velocity limits prevent unstable particle behavior
- Curl noise provides organic movement patterns while maintaining computational efficiency

## Credits

Based on the concept by Bjorn Staal. Implementation follows the specification from the Entangled Project, with additional techniques inspired by [bgstaal/gpuparticles](https://github.com/bgstaal/gpuparticles) (MIT License).
