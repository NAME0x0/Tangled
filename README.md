# Entangled Project - Quantum Electron Visualization

An interactive visualization of quantum entanglement between electrons across multiple browser windows, inspired by Bjorn Staal's *Entangled* concept, with implementation ideas from [bgstaal/gpuparticles](https://github.com/bgstaal/gpuparticles) and [bgstaal/multiplewindow3dscene](https://github.com/bgstaal/multiplewindow3dscene).

## Features

- Realistic quantum electron visualization with core and electron cloud
- GPU-accelerated particle simulation using `three.js` and `GPUComputationRenderer`
- Quantum mechanical effects including orbital motion and quantum fluctuations
- Cross-window quantum entanglement via `localStorage`
- Electron wave functions and probability-based particle distribution
- Dynamic creation of entangled electron pairs across multiple windows
- Customizable electron color via HSL slider
- Physics-based visualization with orbital mechanics and quantum field effects

## Prerequisites

- **Browser**: Chrome 95+ or Firefox 90+ (WebGL 2.0 required)
- **Python**: Python 3.8+ with Flask and Flask-CORS

## Setup Instructions

1. **Install Dependencies**:

   ```bash
   pip install -r requirements.txt
   ```

2. **Download Libraries**:
   The required JavaScript libraries can be downloaded automatically by running:

   ```bash
   python download_libs.py
   ```

   This will download:
   - `three.min.js` (v0.148.0) from jsdelivr CDN
   - `GPUComputationRenderer.js` from Three.js GitHub repository

3. **Run Server**:

   ```bash
   python app.py
   ```

4. **Access**: Open `http://localhost:5000` in your browser.

## Usage

- Observe the electron visualization with its core and surrounding electron cloud
- Use the Hue slider to change the electron's color
- Click "Create New Window" to spawn a new entangled electron in a separate window
- Watch how the electrons' behaviors influence each other via quantum entanglement

## Visualization Details

### Electron Structure

- **Core**: Denser, brighter central area representing the nucleus area
- **Electron Cloud**: Surrounding probabilistic cloud of particles representing electron's quantum nature
- **Orbital Motion**: Particles follow orbital paths with quantum fluctuations
- **Wave Function**: Oscillating fields affect particle behavior to simulate quantum effects

### Quantum Entanglement

- When two electrons are created as an entangled pair, their states become linked
- Changes in one electron's quantum state affect the corresponding entangled electron
- The entanglement is visually represented through synchronized orbital behaviors
- Each pair of windows maintains its own entanglement relationship

## Project Structure

```plaintext
entangled_project/
├── app.py                  # Flask server
├── download_libs.py        # Helper script to download JS libraries
├── requirements.txt        # Python dependencies
├── static/                 # Static assets
│   ├── css/                # CSS files
│   │   └── style.css       # Styles for UI and layout
│   └── js/                 # JavaScript files
│       ├── three.min.js    # Three.js library
│       ├── GPUComputationRenderer.js  # GPU computation library
│       └── main.js         # Electron visualization and entanglement logic
├── templates/              # HTML templates
│   └── index.html          # Main HTML page
└── README.md               # Project documentation
```

## Technical Implementation

### Electron Simulation

- Core particles: Denser distribution near center with brighter appearance
- Cloud particles: Distributed based on quantum probability functions
- Orbital mechanics: Particles follow physics-based orbital paths with quantum uncertainty
- Wave function: Oscillating fields create electron wave patterns

### Physics-based Entanglement

- Entangled electrons share state information via localStorage
- Changes in one electron's quantum state influence the paired electron
- Entanglement is implemented using stateful synchronization with appropriate quantum behaviors

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Black screen | Check browser console for WebGL errors; ensure WebGL 2.0 is supported |
| No entanglement | Check for localStorage permission errors in browser console |
| Low FPS | Reduce `PARTICLE_COUNT` in `main.js` (line 2) |
| Electron disappears | Adjust `ELECTRON_CLOUD_SIZE` constant if particles are escaping the simulation bounds |

## Credits

Based on the concept by Bjorn Staal. Quantum visualization inspired by modern quantum mechanical principles and implemented using [bgstaal/gpuparticles](https://github.com/bgstaal/gpuparticles) and [bgstaal/multiplewindow3dscene](https://github.com/bgstaal/multiplewindow3dscene) techniques.
