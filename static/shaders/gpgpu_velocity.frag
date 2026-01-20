// GPGPU Velocity Update Fragment Shader
varying vec2 vUv;
uniform sampler2D uVelocityTexture; // Current velocity state
uniform float uDeltaTime;
uniform float uDamping; // Damping factor (e.g., 0.98)

void main() {
    vec4 velocityData = texture2D(uVelocityTexture, vUv);
    vec3 velocity = velocityData.xyz;

    // Apply damping (ensures velocity decreases over time if no forces)
    // Check if damping is valid to avoid issues
    if (uDamping > 0.0 && uDamping < 1.0) {
      velocity *= uDamping;
    }

    // --- TODO: Add forces (attractors, noise) here --- 
    // velocity += force * uDeltaTime;

    gl_FragColor = vec4(velocity, velocityData.w); // Keep w component (unused for now)
} 