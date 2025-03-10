from flask import Flask, send_from_directory, jsonify
import os
import logging

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize Flask application
# Use the current directory for static files instead of the default /static folder
app = Flask(__name__, static_url_path='', static_folder='.')
app.config['SECRET_KEY'] = 'entangled_secret_key'

@app.route('/')
def index():
    """Serve the main index.html file"""
    logger.info("Index page requested")
    return send_from_directory('.', 'index.html')

@app.route('/<path:filename>')
def serve_static(filename):
    """Serve any static files from the root directory"""
    logger.info(f"Static file requested: {filename}")
    return send_from_directory('.', filename)

@app.route('/healthcheck')
def healthcheck():
    """Simple health check endpoint for monitoring"""
    return jsonify({"status": "healthy"})

if __name__ == '__main__':
    # Get port from environment or use 5000 as default
    port = int(os.environ.get('PORT', 5000))
    logger.info(f"Starting server on port {port}")
    
    # Run the Flask application
    app.run(host='0.0.0.0', port=port, debug=True)