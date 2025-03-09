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
            vec4 posTarget = texture2D(posTarget, uv);
            vec4 pos = texture2D(pos, uv);
            vec4 vel = texture2D(vel, uv);

            vec3 p = pos.xyz; // Get position from GPU computation
            float t = time * 0.0003;

            // Generate unique properties for this particle
            float n = hash12(vec2(float(i), 0.0));
            
            // Calculate point size based on velocity and random factor
            float speed = length(vel.xyz);
            float speedFactor = clamp(speed * 2.0, 0.5, 3.0);
            size = mix(1.5, 3.0, pow(n, 2.0)) / speedFactor;
            
            // Calculate alpha based on speed and random factor
            alpha = mix(0.2, 0.8, pow(n, 1.5));
            
            // Special larger particles
            if (n > 0.99) {
                size *= 1.8;
                alpha *= 1.5;
            }
            
            // Calculate color based on velocity and hue
            vec4 a = texture2D(vel, uv);
            float velLen = length(a.xyz);
            
            // Base color derived from hue parameter
            vec3 c1 = vec3(cos(hue * 6.28318), 0.6, 0.5);
            vec3 c2 = vec3(cos(hue * 6.28318 + 2.0), 0.8, 0.3);
            
            // Mix colors based on velocity for dynamic effect
            float s = pow(velLen / 1.0, 3.0);
            s = clamp(s, 0.0, 1.0);
            col = mix(c1, c2, s);
            
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
            // Create soft circular point
            float r = length(gl_PointCoord - vec2(0.5));
            if (r > 0.5) discard;
            
            // Add glow effect with falloff
            float glow = 0.5 - r;
            float finalAlpha = alpha * glow * 2.0;
            
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