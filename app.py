from flask import Flask, render_template
from flask_cors import CORS

app = Flask(__name__)
# Enable CORS for all routes to allow entangled windows to communicate
CORS(app)

@app.route('/')
def index():
    return render_template('index.html')

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)