from flask import Flask, render_template
from flask_cors import CORS

app = Flask(__name__)
CORS(app)  # Enable CORS for all routes to ensure cross-window communication

@app.route('/')
def index():
    """Serve the main HTML page."""
    return render_template('index.html')

@app.route('/simple-test')
def simple_test():
    return render_template('simple-test.html')

@app.route('/electron')
def electron():
    return render_template('electron.html')

if __name__ == '__main__':
    app.run(host='localhost', port=5000, debug=True) 