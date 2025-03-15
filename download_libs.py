import os
import urllib.request

# Create directories if they don't exist
js_dir = 'static/js'
os.makedirs(js_dir, exist_ok=True)

# URLs for the libraries
threejs_url = 'https://cdn.jsdelivr.net/npm/three@0.148.0/build/three.min.js'
gpu_compute_url = 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/jsm/misc/GPUComputationRenderer.js'

# Download Three.js
print(f"Downloading Three.js from {threejs_url}...")
urllib.request.urlretrieve(threejs_url, os.path.join(js_dir, 'three.min.js'))
print("Three.js downloaded successfully!")

# Download GPUComputationRenderer.js
print(f"Downloading GPUComputationRenderer.js from {gpu_compute_url}...")
urllib.request.urlretrieve(gpu_compute_url, os.path.join(js_dir, 'GPUComputationRenderer.js'))
print("GPUComputationRenderer.js downloaded successfully!")

print("All libraries downloaded successfully!") 