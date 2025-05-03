// Simple pass-through vertex shader for GPGPU
varying vec2 vUv;

void main() {
    vUv = uv;
    // We don't need projection matrix here, just rendering a quad to cover the RT
    gl_Position = vec4(position, 1.0);
} 