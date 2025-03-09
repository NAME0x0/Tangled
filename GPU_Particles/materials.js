import {hash12} from './glslNoise.js';
import {uvFromIndex} from './glslUtils.js';

let t = THREE;
let dummyTex = new t.Texture();

function createPointsMaterial(nX, nY) {
    let vert = `
        uniform sampler2D pos;
        uniform float time;
        uniform float hue;
        uniform float radius;
        varying vec3 vColor;
        
        // Simple HSL to RGB conversion
        vec3 hsl2rgb(vec3 c) {
            vec3 rgb = clamp(abs(mod(c.x*6.0+vec3(0.0,4.0,2.0),6.0)-3.0)-1.0, 0.0, 1.0);
            return c.z + c.y * (rgb-0.5)*(1.0-abs(2.0*c.z-1.0));
        }
        
        void main() {
            // Get index and UV for this vertex
            int i = gl_VertexID;
            float x = float(i % ${nX});
            float y = float(i / ${nX});
            vec2 uv = vec2(x, y) / vec2(${nX}, ${nY});
            
            // Get position from texture
            vec4 texPos = texture2D(pos, uv);
            vec3 position = texPos.xyz;
            
            // Simple deterministic "random" value for this vertex
            float n = fract(sin(float(i) * 0.1) * 43758.5453);
            
            // Particle size and color
            gl_PointSize = mix(1.5, 3.5, n);
            
            // Calculate color - simple HSL
            float h = hue;
            float s = 0.8;
            float l = 0.5 + 0.2 * n;
            vColor = hsl2rgb(vec3(h, s, l));
            
            // Set position
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `;

    let frag = `
        varying vec3 vColor;
        
        void main() {
            // Create circular point with softer edges
            float r = length(gl_PointCoord - vec2(0.5));
            if (r > 0.5) discard;
            
            // Stronger alpha, especially in the center
            float alpha = 0.8 * (1.0 - r * 1.8);
            gl_FragColor = vec4(vColor, alpha);
        }
    `;

    const material = new THREE.ShaderMaterial({
        uniforms: {
            time: { value: 0.0 },
            hue: { value: 0.0 },
            radius: { value: 80.0 },
            pos: { value: null },
            posTarget: { value: null }, // Add missing uniforms
            acc: { value: null },
            vel: { value: null }
        },
        vertexShader: vert,
        fragmentShader: frag,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending
    });

    return material;
}

export {createPointsMaterial};