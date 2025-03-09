import {cnoise3, hash12} from './glslNoise.js';
import {uvFromIndex} from './glslUtils.js';

let t = THREE;
let dummyTex = new t.Texture();

function createPointsMaterial(nX, nY) {
    let vert = `
        ${cnoise3}
        ${hash12}
        ${uvFromIndex}

        uniform sampler2D posTarget;
        uniform sampler2D acc;
        uniform sampler2D vel;
        uniform sampler2D pos;
        uniform float time;
        uniform float hue;
        uniform float radius;
        varying float alpha;
        varying vec3 col;
        varying float size;

        void main() 
        {
            int i = gl_VertexID;
            ivec2 size = ivec2(${nX}, ${nX});
            vec2 uv = uvFromIndex(i, size);
            vec4 pos = texture2D(pos, uv);
            vec4 vel = texture2D(vel, uv);

            vec3 p = pos.xyz;
            
            // Generate unique properties for this particle
            float n = hash12(vec2(float(i), 0.0));
            
            // Make particles larger for better visibility
            float baseSize = 3.0; // Increased base size
            float speed = length(vel.xyz);
            float speedFactor = clamp(speed * 1.5, 0.5, 2.0);
            size = baseSize * mix(0.8, 1.5, pow(n, 1.5)) / speedFactor;
            
            // Higher base alpha for better visibility
            alpha = mix(0.4, 1.0, pow(n, 1.2));
            
            // Special larger particles for nebula core effect
            if (n > 0.97) {
                size *= 2.5;
                alpha *= 1.8;
            }
            
            // Calculate color based on velocity and hue
            float velLen = length(vel.xyz);
            
            // Create warmer nebula colors (blues, purples, pinks)
            vec3 c1 = vec3(cos(hue * 6.28318 + 2.0), 0.7, 0.9); // Base color
            vec3 c2 = vec3(cos(hue * 6.28318 + 4.0), 0.9, 0.6); // Accent color
            
            // Mix colors based on velocity for dynamic effect
            float s = pow(velLen / 0.5, 2.0);
            s = clamp(s, 0.0, 1.0);
            col = mix(c1, c2, s);
            
            // Make particles in center area brighter
            float distFromCenter = length(p.xyz);
            float centerBoost = 1.0 + 0.5 * smoothstep(radius * 0.8, 0.0, distFromCenter);
            alpha *= centerBoost;
            
            // Set position and size
            gl_PointSize = size;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
    `;

    let frag = `
        uniform float time;
        varying float alpha;
        varying vec3 col;
        varying float size;

        void main() 
        {
            // Create soft circular point with stronger center glow
            float r = length(gl_PointCoord - vec2(0.5));
            if (r > 0.5) discard;
            
            // Create stronger glow effect
            float glow = pow(0.5 - r, 1.5) * 2.5;
            float finalAlpha = alpha * glow;
            
            // Output color with alpha
            gl_FragColor = vec4(col.rgb, finalAlpha);
        }
    `;

    const material = new THREE.ShaderMaterial({
        uniforms: {
            time: { value: 1.0 },
            hue: { value: 0.0 },
            radius: { value: 80.0 },
            posTarget: { value: dummyTex },
            acc: { value: dummyTex },
            vel: { value: dummyTex },
            pos: { value: dummyTex }
        },
        vertexShader: vert,
        fragmentShader: frag,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending
    });

    return material;
}

export {createPointsMaterial};