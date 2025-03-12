from flask import Flask, render_template  
from flask_cors import CORS  

app = Flask(__name__, static_folder="static", template_folder="templates")  
CORS(app)  # Enable cross-origin requests  

@app.route('/')  
def index():  
    return render_template('index.html')  

if __name__ == '__main__':  
    app.run(host='localhost', port=5000, debug=True)