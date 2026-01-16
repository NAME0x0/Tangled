// GPGPU Position Update Fragment Shader
varying vec2 vUv;
uniform sampler2D uPositionTexture; // Current position state
uniform sampler2D uVelocityTexture; // New velocity state (updated in previous step)
uniform float uDeltaTime;

// TODO: Add uniforms for bounds checking/respawn

void main() {
    vec4 positionData = texture2D(uPositionTexture, vUv);
    vec3 position = positionData.xyz;
    float age = positionData.w; // Assuming w stores age

    vec4 velocityData = texture2D(uVelocityTexture, vUv);
    vec3 velocity = velocityData.xyz;

    // Simple Euler integration
    position += velocity * uDeltaTime;

    // Increment age
    age += uDeltaTime;

    // --- TODO: Implement boundary checks and particle respawn --- 
    // if (position.y < -10.0 || age > 10.0) { 
    //     // Reset position to origin or random
    //     position = vec3(0.0, 0.0, 0.0); 
    //     // Reset age
    //     age = 0.0;
    //     // Optionally reset velocity too (read from initial velocity texture?)
    // }

    gl_FragColor = vec4(position, age);
} 