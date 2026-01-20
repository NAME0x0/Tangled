// Particle Rendering Fragment Shader
varying vec2 vUv; // Comes from vertex shader

// TODO: Add uniforms for attractors, age texture, etc. for coloring/fading

void main() {
    // Simple white color for now
    gl_FragColor = vec4(1.0, 1.0, 1.0, 1.0); // White, fully opaque

    // --- TODO: Implement color logic based on attractors --- 
    // --- TODO: Implement alpha fading based on age/velocity --- 
} 