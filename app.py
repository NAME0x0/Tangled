from flask import Flask, render_template, send_from_directory, request
from flask_socketio import SocketIO, emit
import gevent # Use gevent for async mode (eventlet is deprecated)

# Initialize Flask app and SocketIO
app = Flask(__name__)
app.config['SECRET_KEY'] = 'your_secret_key!' # Change this in production!
socketio = SocketIO(app, async_mode='eventlet')

# Store simulation parameters (example)
sim_params = {
    'particle_count': 10000,
    'attractor_pos': {'x': 0, 'y': 0, 'z': 0},
    'particle_color': '#ffffff'
}

@app.route('/')
def index():
    """Serve the main HTML page."""
    return render_template('index.html')

# Serve static files (CSS, JS, shaders, vendor libs)
@app.route('/static/<path:path>')
def send_static(path):
    return send_from_directory('static', path)


# --- SocketIO Event Handlers ---

@socketio.on('connect')
def handle_connect():
    """Handle new client connection."""
    print('Client connected:', request.sid)
    # Send current parameters to the newly connected client
    emit('update_params', sim_params)

@socketio.on('disconnect')
def handle_disconnect():
    """Handle client disconnection."""
    print('Client disconnected:', request.sid)

@socketio.on('request_params')
def handle_request_params(json):
    """Client explicitly requests parameters."""
    print('Received param request:', json)
    emit('update_params', sim_params)

@socketio.on('update_params_request')
def handle_update_params_request(new_params):
    """Handle request from client to update parameters."""
    print('Received update request:', new_params)
    # Basic validation/merging (implement more robustly as needed)
    for key, value in new_params.items():
        if key in sim_params:
            sim_params[key] = value # Update server state
    # Broadcast the updated parameters to ALL connected clients
    socketio.emit('update_params', sim_params)
    print('Broadcasting updated params:', sim_params)


if __name__ == '__main__':
    print("Starting Flask server with SocketIO...")
    # Use eventlet to run the server
    socketio.run(app, host='0.0.0.0', port=5000, debug=True)
    # Alternatively, use Flask's development server (less performant for websockets)
    # app.run(debug=True, port=5000) 