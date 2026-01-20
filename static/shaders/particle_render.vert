// Particle Rendering Vertex Shader
attribute vec2 uv; // Texel coordinates for this particle

uniform sampler2D uPositionTexture; // Texture containing particle positions (from GPGPU)
uniform float uPointSize;

varying vec2 vUv; // Pass UV to fragment shader if needed

void main() {
    vUv = uv;

    // Fetch the particle's position from the texture
    vec4 positionData = texture2D(uPositionTexture, uv);
    vec3 particlePosition = positionData.xyz;

    // Calculate the screen position
    vec4 mvPosition = modelViewMatrix * vec4(particlePosition, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    // Set point size (can be made dynamic later)
    gl_PointSize = uPointSize;
} 