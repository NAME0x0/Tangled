# Entangled Project

An interactive art piece with synchronized 3D particle systems across multiple browser windows, based on Bjorn Staal's *Entangled*.

## Features

- Real-time GPU-accelerated particle simulation using `three.js` and `GPUComputationRenderer`
- Cross-window synchronization via `localStorage` with an "entanglement value" derived from particle positions
- Dynamic window spawning with bidirectional influence between paired systems
- Customizable particle color via HSL slider
- Responsive design with GPU texture resizing

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
- Watch as particle systems in different windows influence each other

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Black screen | Confirm `three.min.js` and `GPUComputationRenderer.js` are in `static/js/` |
| No synchronization | Enable CORS in Flask and disable browser security flags (e.g., `chrome://flags/#block-insecure-private-network-requests`) |
| Low FPS | Reduce `PARTICLE_COUNT` to 4096 (64x64 grid) in `main.js` |

## Performance Optimization

- Particle sampling for `localStorage` sync is limited to small texture regions
- Particle count is optimized for balance between visual density and performance
- Damping factors prevent exponential growth of forces between windows

## Credits

Based on the concept by Bjorn Staal. Implementation follows the specification from the Entangled Project.
