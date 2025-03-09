import {hash12} from './glslNoise.js';
import {uvFromIndex} from './glslUtils.js';

let t = THREE;
let dummyTex = new t.Texture();

function createPointsMaterial(nX, nY) {
    let vert = `
        ${hash12}
        ${uvFromIndex}

        uniform sampler2D posTarget;
        uniform sampler2D pos;
        uniform sampler2D vel;
        uniform float time;
        uniform float hue;
        uniform float radius;
        varying float vAlpha;
        varying vec3 vColor;

        // Simple HSL to RGB conversion
        vec3 hsv2rgb(vec3 c) {
            vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
            vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
            return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
        }

        void main() {
            int i = gl_VertexID;
            ivec2 texSize = ivec2(${nX}, ${nX});
            vec2 uv = uvFromIndex(i, texSize);
            
            // Get current position from texture
            vec4 texPos = texture2D(pos, uv);
            vec4 velData = texture2D(vel, uv);
            
            // Calculate point size based on velocity
            float speed = length(velData.xyz);
            float n = hash12(vec2(float(i), 0.0));
            float pointSize = mix(1.5, 3.0, n) / mix(0.5, 2.0, min(1.0, speed * 4.0));
            
            // Calculate alpha
            vAlpha = mix(0.3, 0.8, n);
            
            // Color based on position and velocity
            float h = hue + hash12(uv) * 0.1; // Small random hue variation
            float s = 0.7 + 0.3 * sin(time * 0.001 + n * 6.28);
            float l = 0.5 + 0.2 * cos(time * 0.0007 + n * 6.28);
            
            // Adjust color based on velocity
            l += min(0.3, speed);
            vColor = hsv2rgb(vec3(h, s, l));
            
            // Set position and size
            gl_PointSize = pointSize;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(texPos.xyz, 1.0);
        }
    `;

    let frag = `
        varying float vAlpha;
        varying vec3 vColor;

        void main() {
            // Simple circular point
            float r = length(gl_PointCoord - vec2(0.5));
            if (r > 0.5) discard;
            
            // Soften edges
            float alpha = vAlpha * (1.0 - r * 2.0);
            gl_FragColor = vec4(vColor, alpha);
        }
    `;

    const material = new THREE.ShaderMaterial({
        uniforms: {
            time: { value: 0.0 },
            hue: { value: 0.0 },
            radius: { value: 80.0 },
            posTarget: { value: null },
            acc: { value: null },
            vel: { value: null },
            pos: { value: null }
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