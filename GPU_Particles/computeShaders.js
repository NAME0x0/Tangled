import {hash12, cnoise4} from './glslNoise.js';
import {PI} from './glslUtils.js';

function createPosTargetShader() {
    return `
        ${PI}
        ${hash12}

        uniform float time;
        uniform float radius;

        void main() {
            float nPoints = resolution.x * resolution.y;
            float i = (gl_FragCoord.y * resolution.x) + gl_FragCoord.x;
            vec2 uv = gl_FragCoord.xy / resolution.xy;

            vec3 pos = vec3(0.0);
            
            // Create spiral-like distribution for a more active nebula feel
            float seedX = hash12(vec2(i * 0.123, i * 0.867));
            float seedY = hash12(vec2(i * 0.513, i * 0.339));
            float seedZ = hash12(vec2(i * 0.761, i * 0.157));
            
            // Create spiraling coordinates
            float spiral = seedX * 2.0 * PI + seedY * 4.0;
            float theta = spiral;
            float phi = acos(2.0 * seedZ - 1.0); // Full sphere distribution
            
            // Radius with some variation
            float baseRadius = 50.0;
            float r = baseRadius * (0.5 + 0.5 * pow(seedY, 0.5));
            
            // Convert to Cartesian coordinates
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
        ${cnoise4}
        ${hash12}

        uniform float time;
        uniform float radius;

        void main() {
            float nPoints = resolution.x * resolution.y;
            float i = (gl_FragCoord.y * resolution.x) + gl_FragCoord.x;
            vec2 uv = gl_FragCoord.xy / resolution.xy;

            vec3 a = vec3(0.0); // Acceleration
            vec4 p = texture2D(pos, uv); // Current position
            vec4 tar = texture2D(posTarget, uv); // Target position
            
            // Create unique ID for each particle
            float id = hash12(uv);
            
            // Get current particle position
            vec3 pos = p.xyz;
            
            // 1. Turbulence - create swirling, nebula-like motion
            vec3 turb;
            float t = time * 0.0002; // Slightly faster animation
            
            // Use noise with different frequencies per dimension
            turb.x = cnoise(vec4(pos * 0.01 + id * 35.4, t)) * 0.3;
            turb.y = cnoise(vec4(pos * 0.012 + id * 32.3, t + 10.0)) * 0.3;
            turb.z = cnoise(vec4(pos * 0.014 + id * 43.3, t + 20.0)) * 0.3;
            
            a += turb;
            
            // 2. Vortex force - create spiraling nebula effect
            float distFromCenter = length(pos);
            vec3 toCenter = normalize(-pos); // Direction to center
            vec3 perpendicular = normalize(cross(toCenter, vec3(0.0, 1.0, 0.0))); // Perpendicular to center direction
            
            // Add rotational force around center (stronger toward center)
            float vortexStrength = 0.02 * max(0.0, 1.0 - distFromCenter / (radius * 1.2));
            a += perpendicular * vortexStrength;
            
            // 3. Core attraction - keep particles in a roughly spherical shape
            float distFactor = smoothstep(0.0, radius * 1.5, distFromCenter);
            float attraction = mix(0.001, 0.01, distFactor);
            a += toCenter * attraction;
            
            // 4. Small random jitter for natural movement
            vec3 jitter;
            jitter.x = hash12(vec2(id, time * 0.001)) * 2.0 - 1.0;
            jitter.y = hash12(vec2(id + 0.1, time * 0.001 + 0.1)) * 2.0 - 1.0;
            jitter.z = hash12(vec2(id + 0.2, time * 0.001 + 0.2)) * 2.0 - 1.0;
            a += jitter * 0.001;
            
            // Limit maximum acceleration
            float maxAcc = 0.1;
            if (length(a) > maxAcc) {
                a = normalize(a) * maxAcc;
            }
            
            gl_FragColor = vec4(a, 1.0);
        }
    `;
}

function createVelShader() {
    return `
        ${PI}

        uniform float time;

        void main() {
            vec2 uv = gl_FragCoord.xy / resolution.xy;

            vec4 a = texture2D(acc, uv);
            vec4 v = texture2D(vel, uv);
            vec4 p = texture2D(pos, uv);
            
            // Add acceleration to velocity
            v += a;
            
            // Variable damping - particles slow down more at edges to prevent escaping
            float distFromCenter = length(p.xyz);
            float damping = mix(0.98, 0.95, smoothstep(0.0, 100.0, distFromCenter));
            
            // Apply damping
            v.xyz *= damping;
            
            // Limit maximum velocity to prevent explosive motion
            float maxVel = 0.8;
            float velMag = length(v.xyz);
            if (velMag > maxVel) {
                v.xyz = normalize(v.xyz) * maxVel;
            }

            gl_FragColor = vec4(v.xyz, 1.0);
        }
    `;
}

function createPosShader() {
    return `
        ${PI}
        ${hash12}

        uniform float time;
        uniform int frame;

        void main() {
            vec2 uv = gl_FragCoord.xy / resolution.xy;
            
            vec4 p;
            
            // Initialize positions from target in first few frames
            if (frame < 10) {
                p = texture2D(posTarget, uv);
                
                // Add slight random offset to prevent all particles starting at exact same spot
                if (frame == 0) {
                    float id = hash12(uv);
                    float randX = hash12(vec2(id, 0.123)) * 2.0 - 1.0;
                    float randY = hash12(vec2(id, 0.456)) * 2.0 - 1.0;
                    float randZ = hash12(vec2(id, 0.789)) * 2.0 - 1.0;
                    p.xyz += vec3(randX, randY, randZ) * 5.0;
                }
            } else {
                // Normal update: position += velocity
                p = texture2D(pos, uv);
                vec4 vel = texture2D(vel, uv);
                p += vel;
            }
            
            gl_FragColor = vec4(p.xyz, 1.0);
        }
    `;
}

export {createPosTargetShader, createAccShader, createVelShader, createPosShader};