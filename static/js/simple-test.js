// Import Three.js
import * as THREE from 'three';

// Create a basic scene
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.z = 5;

// Create renderer
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.getElementById('container').appendChild(renderer.domElement);

// Create a cube
const geometry = new THREE.BoxGeometry(1, 1, 1);
const material = new THREE.MeshNormalMaterial();
const cube = new THREE.Mesh(geometry, material);
scene.add(cube);

// Animation function
function animate() {
    requestAnimationFrame(animate);
    
    // Rotate the cube
    cube.rotation.x += 0.01;
    cube.rotation.y += 0.01;
    
    renderer.render(scene, camera);
}

// Handle window resize
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// Add message to page
const message = document.createElement('div');
message.style.position = 'absolute';
message.style.top = '10px';
message.style.left = '10px';
message.style.color = 'white';
message.style.fontFamily = 'Arial, sans-serif';
message.innerHTML = 'If you can see a rotating cube, Three.js is working correctly.';
document.body.appendChild(message);

// Start animation
animate();

console.log("Simple test loaded successfully"); 