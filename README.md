# Entangled

A web-based generative art project that recreates Bjørn Ståål's "Entangled" work. This interactive 3D experience features glowing orbs connected by tethers that respond to the physical positions of browser windows on your screen.

![Entangled Demo](https://via.placeholder.com/800x400.png?text=Entangled+Demo+Screenshot)

## Features

- **Window-Aware Tethers**: Tethers point in the exact direction of other browser windows based on their physical position on your screen
- **Multi-Generational Connections**: Windows maintain connections to both their parent and all children simultaneously
- **Color Degradation**: Child windows show progressively less saturated orbs to visually indicate their generation
- **Full 360° Orientation**: Tethers accurately reflect the position of other windows in any direction
- **Particle Effects**: Each orb is surrounded by a cloud of animated particles to enhance the visual experience
- **Cross-Window Synchronization**: Real-time updates across all windows using localStorage to track window positions
- **Interactive Orbs**: Mouse over the orbs to see them react to your presence

## Controls

- **Mouse Movement**: Hover over the orb to interact with it
- **Open New Window**: Click the button to create a new entangled window
- **Space Bar**: Toggle tether visibility (useful for debugging)
- **Debug Panel**: Click "Show Debug" for detailed information

## Technologies Used

- **Backend**: Python with Flask serving the application
- **Frontend**: JavaScript with Three.js for 3D rendering and effects
- **Synchronization**: HTML5 localStorage for cross-window communication
- **Animation**: Simplex noise for organic particle movement
- **Visual Effects**: Custom shader materials and dynamic tether orientation

## Getting Started

### Prerequisites

- Python 3.6 or higher
- pip (Python package manager)
- A modern web browser that supports WebGL and localStorage (Chrome, Firefox, Edge, Safari)

### Installation

#### Windows

1. Clone the repository:

   ```batch
   git clone https://github.com/yourusername/entangled.git
   cd entangled
   ```

2. Install the required Python packages:

   ```batch
   pip install -r requirements.txt
   ```

3. Run the application:

   ```batch
   python app.py
   ```

#### macOS/Linux

1. Clone the repository:

   ```bash
   git clone https://github.com/yourusername/entangled.git
   cd entangled
   ```

2. It's recommended to use a virtual environment:

   ```bash
   python -m venv venv
   source venv/bin/activate  # On macOS/Linux
   ```

3. Install the required Python packages:

   ```bash
   pip install -r requirements.txt
   ```

4. Run the application:

   ```bash
   python app.py
   ```

### Accessing the Application

1. Open your web browser and navigate to:

   ```plaintext
   http://localhost:5000
   ```

2. Click the "Open New Window" button to create a new window.

3. Position the new window anywhere on your screen - the tether will automatically adjust to point in the correct direction.

4. For the best experience, try arranging multiple windows in different positions to create a network of entangled orbs.

## Project Structure

```plaintext
entangled/
├── app.py                 # Flask application
├── requirements.txt       # Python dependencies
├── static/
│   └── js/
│       └── entangled.js   # Main JavaScript for window tracking and visualization
├── templates/
│   └── index.html         # HTML template with instructions and setup
└── README.md              # Project documentation
```

## Troubleshooting

### Common Issues

- **Tethers Not Appearing**: Make sure you've allowed popup windows and positioned them differently on your screen.
- **WebGL Not Supported**: Check if your browser supports WebGL at [WebGL Report](https://webglreport.com).
- **Performance Issues**: If animation is slow, try reducing the number of open windows or use a more powerful computer.

## How It Works

### 1. Window Position Detection

The application uses the `window.screenX`, `window.screenY`, `window.outerWidth`, and `window.outerHeight` properties to determine the exact position and size of each browser window on your screen.

### 2. Cross-Window Communication

When a window is opened or moved, it stores its position data in localStorage:

```javascript
localStorage.setItem('entangledWindows', JSON.stringify(windowData));
```

Other windows detect this change through the `storage` event and update their tethers accordingly:

```javascript
window.addEventListener('storage', function(e) {
    if (e.key === 'entangledWindows') {
        checkWindowPosition();
    }
});
```

### 3. Tether Orientation

The application calculates the exact angle between windows and orients the tether to point in that direction:

```javascript
// Calculate normalized direction
const dirX = deltaX / distance;
const dirY = deltaY / distance;

// Convert screen coordinates to 3D world coordinates
const worldDirX = dirX;
const worldDirY = -dirY; // Invert Y axis
```

### 4. Color Degradation

Each generation of windows receives a less saturated version of the original color:

```javascript
// Adjust color saturation and lightness based on generation
const color = new THREE.Color(CONFIG.primaryColor);
const hsl = {};
color.getHSL(hsl);
hsl.s = Math.max(0.2, hsl.s - (generation * 0.2)); // Reduce saturation
hsl.l = Math.min(0.8, hsl.l + (generation * 0.15)); // Increase lightness
color.setHSL(hsl.h, hsl.s, hsl.l);
```

### 5. Multi-Generational Connections

Each window maintains connections to both its parent and all of its children:

```javascript
// Create tether to parent if we have one
if (parentPosition) {
    createTether(parentPosition, "parent");
}

// Create tethers to all children
for (const childId in childPositions) {
    createTether(childPositions[childId], "child");
}
```

## Inspiration

This project is directly inspired by Bjørn Ståål's "Entangled" generative art piece, which explores the concept of quantum entanglement through visual connections between browser windows. The original work creates an ethereal sense of connection between separate browser windows positioned on the same screen.

You can find more of Bjørn Ståål's work:

- [Personal Website](https://nonfigurativ.com/)
- [Twitter: @_nonfigurativ_](https://twitter.com/_nonfigurativ_)
- [GitHub: bgstaal](https://github.com/bgstaal)

## License

MIT License

## Acknowledgments

- Bjørn Ståål ([@_nonfigurativ_](https://twitter.com/_nonfigurativ_)) for the original concept
- [Three.js](https://threejs.org/) for the 3D rendering library
- [Flask](https://flask.palletsprojects.com/) for the backend framework
