from flask import Flask, render_template, jsonify
import os
import logging

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize Flask application
app = Flask(__name__)
app.config['SECRET_KEY'] = 'entangled_secret_key'

@app.route('/')
def index():
    """Render the main Entangled page"""
    logger.info("Index page requested")
    return render_template('index.html')

@app.route('/healthcheck')
def healthcheck():
    """Simple health check endpoint for monitoring"""
    return jsonify({"status": "healthy"})

if __name__ == '__main__':
    # Get port from environment or use 5000 as default
    port = int(os.environ.get('PORT', 5000))
    logger.info(f"Starting Entangled server on port {port}")
    
    # Run the Flask application
    app.run(host='0.0.0.0', port=port, debug=True) 