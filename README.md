# Tangled

A web application utilizing Three.js for 3D rendering and Socket.IO for real-time communication.

## Overview

Tangled Web is a web-based application featuring a 3D scene rendered using Three.js within an HTML canvas. It incorporates Socket.IO to enable real-time interactions or data synchronization between clients and the server, or potentially between different browser windows.

Key technologies include:

- **Frontend**: HTML, CSS, JavaScript
- **3D Rendering**: Three.js
- **Real-time Communication**: Socket.IO
- **Backend (Assumed)**: Python/Flask for serving files and handling Socket.IO events.

## Prerequisites

- Modern web browser with WebGL support
- Python 3.7+ (for the server, if using Flask)
- Node.js and npm (if frontend build steps are involved, not explicitly shown but common)

## Installation

1.  Clone the repository:

    ```bash
    git clone https://github.com/yourusername/tangled.git
    cd tangled
    ```

2.  Install Python dependencies (if using Flask backend):

    ```bash
    pip install -r requirements.txt
    ```

3.  Install Node.js dependencies (if applicable):

    ```bash
    # npm install
    # npm run build
    ```

4.  Start the server (example using Flask):

    ```bash
    python app.py
    ```

5.  Open in your browser:

    ```
    http://localhost:5000 # <-- Or the port your server runs on
    ```

## Usage

-   Navigate to the application URL in your web browser after starting the server.
-   Interact with the 3D scene rendered on the canvas.
-   (Add specific interaction details here as the project develops, e.g., mouse controls, UI elements).

## Technical Details

-   **Client-side**: Uses `index.html` as the entry point, loading CSS (`style.css`), Three.js library, and the main application logic (`main.js`).
-   **Three.js**: Manages the WebGL rendering context, scene graph, camera, and rendering loop.
-   **Socket.IO**: Establishes a WebSocket connection for real-time, bidirectional communication. Used for synchronizing state or events.
-   **Server-side (Assumed)**: A backend (like Flask) serves the static files (`index.html`, CSS, JS) and manages Socket.IO connections and event handling.

## Troubleshooting

-   **3D Scene not rendering**: Ensure your browser supports WebGL and that there are no JavaScript errors in the console.
-   **Real-time updates not working**: Check the browser's network tab and console for Socket.IO connection errors. Verify the server is running and accessible.
-   **Performance Issues**: Optimize Three.js scene complexity or rendering settings. Check for bottlenecks in JavaScript execution or network communication.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

-   Powered by THREE.js
-   Utilizes Socket.IO for real-time features
