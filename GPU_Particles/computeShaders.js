import {hash12} from './glslNoise.js';
import {PI} from './glslUtils.js';

function createPosTargetShader() {
    return `
        ${PI}
        ${hash12}

        uniform float time;
        uniform float radius;

        void main() {
            float i = (gl_FragCoord.y * resolution.x) + gl_FragCoord.x;
            vec2 uv = gl_FragCoord.xy / resolution.xy;

            // Create unique ID for this texel
            float id = hash12(uv);
            
            // Generate spherical coordinates
            float theta = id * 2.0 * PI;
            float phi = acos(2.0 * hash12(uv + 0.5) - 1.0);
            
            // Calculate radius with some variation
            float r = radius * (0.8 + 0.2 * hash12(uv + 0.7));
            
            // Convert to Cartesian coordinates
            vec3 pos;
            pos.x = r * sin(phi) * cos(theta);
            pos.y = r * sin(phi) * sin(theta);
            pos.z = r * cos(phi);

            gl_FragColor = vec4(pos, 1.0);
        }
    `;
}

function createAccShader() {
    return `
        ${PI}
        ${hash12}

        uniform float time;
        uniform float radius;

        void main() {
            vec2 uv = gl_FragCoord.xy / resolution.xy;
            vec3 pos = texture2D(pos, uv).xyz;
            vec3 target = texture2D(posTarget, uv).xyz;
            
            // Create unique ID for this texel
            float id = hash12(uv);
            
            // Acceleration components
            vec3 acc = vec3(0.0);
            
            // 1. Gravity pull toward center/target
            float distFromCenter = length(pos);
            vec3 toCenter = normalize(-pos);
            float gravity = mix(0.001, 0.01, smoothstep(0.0, radius * 1.5, distFromCenter));
            acc += toCenter * gravity;
            
            // 2. Random jitter for natural movement
            float t = time * 0.001;
            float jitterStrength = 0.002;
            acc.x += (hash12(uv + t * 0.1) * 2.0 - 1.0) * jitterStrength;
            acc.y += (hash12(uv + t * 0.2) * 2.0 - 1.0) * jitterStrength;
            acc.z += (hash12(uv + t * 0.3) * 2.0 - 1.0) * jitterStrength;
            
            // 3. Swirl effect - rotation around y-axis
            float swirlStrength = 0.01 * (1.0 - min(1.0, distFromCenter / radius));
            vec3 swirlDir = cross(vec3(0.0, 1.0, 0.0), pos);
            acc += normalize(swirlDir) * swirlStrength;
            
            // Limit maximum acceleration
            float maxAcc = 0.05;
            if (length(acc) > maxAcc) {
                acc = normalize(acc) * maxAcc;
            }
            
            gl_FragColor = vec4(acc, 1.0);
        }
    `;
}

function createVelShader() {
    return `
        uniform float time;

        void main() {
            vec2 uv = gl_FragCoord.xy / resolution.xy;
            vec3 pos = texture2D(pos, uv).xyz;
            vec3 vel = texture2D(vel, uv).xyz;
            vec3 acc = texture2D(acc, uv).xyz;
            
            // Add acceleration to velocity
            vel += acc;
            
            // Apply damping - stronger when farther from center
            float dist = length(pos);
            float damping = mix(0.98, 0.95, smoothstep(0.0, 80.0, dist));
            vel *= damping;
            
            // Limit max velocity
            float maxVel = 0.5;
            float speed = length(vel);
            if (speed > maxVel) {
                vel = normalize(vel) * maxVel;
            }
            
            gl_FragColor = vec4(vel, 1.0);
        }
    `;
}

function createPosShader() {
    return `
        ${hash12}

        uniform float time;
        uniform int frame;

        void main() {
            vec2 uv = gl_FragCoord.xy / resolution.xy;
            vec4 pos;
            
            // Initialize from target position in early frames
            if (frame < 5) {
                pos = texture2D(posTarget, uv);
                
                // Add slight randomness to initial positions
                float id = hash12(uv);
                vec3 offset;
                offset.x = (hash12(uv + 0.1) * 2.0 - 1.0) * 2.0;
                offset.y = (hash12(uv + 0.2) * 2.0 - 1.0) * 2.0;
                offset.z = (hash12(uv + 0.3) * 2.0 - 1.0) * 2.0;
                pos.xyz += offset;
            } else {
                // Regular update: position += velocity
                pos = texture2D(pos, uv);
                vec3 vel = texture2D(vel, uv).xyz;
                pos.xyz += vel;
            }
            
            gl_FragColor = pos;
        }
    `;
}

export {createPosTargetShader, createAccShader, createVelShader, createPosShader};