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
            
            // Use hash to create unique starting positions for each particle
            float seedX = hash12(vec2(i * 0.123, i * 0.867));
            float seedY = hash12(vec2(i * 0.513, i * 0.339));
            float seedZ = hash12(vec2(i * 0.761, i * 0.157));
            
            // Convert to spherical coordinates for better distribution
            float theta = seedX * PI * 2.0; // Azimuth angle
            float phi = acos(2.0 * seedY - 1.0); // Polar angle
            float r = 80.0 * pow(seedZ, 0.33); // Cube root for uniform distribution
            
            // Add some variation to the radius
            r *= (0.8 + hash12(vec2(i * 0.291, time * 0.01)) * 0.4);
            
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
            vec4 tar = texture2D(posTarget, uv); // Target position for centering force
            
            // Create unique ID for each particle
            float id = hash12(uv);
            
            // 1. Add some turbulence with noise
            vec3 turb;
            float t = time * 0.0001;
            float s = 0.15; // Reduced turbulence strength
            
            // Different noise parameters for each dimension for more organic movement
            turb.x = cnoise(vec4(p.xyz * 0.006 + id * 35.4, t));
            turb.y = cnoise(vec4(p.xyz * 0.007 + id * 32.3, t + 10.0));
            turb.z = cnoise(vec4(p.xyz * 0.006 + id * 43.3, t + 20.0));
            
            // Scale noise by distance-based factor
            float turbMod = pow(cnoise(vec4(p.xyz * 0.01, time * 0.0003)), 3.0);
            turb *= turbMod * s * 20.0;
            a += turb;
            
            // 2. Gravity-like force toward center (stronger when further away)
            vec3 toCenter = tar.xyz - p.xyz;
            float distToCenter = length(toCenter);
            
            // Add gravity pull toward center (stronger when further away)
            float gravityStrength = 0.002;
            if (distToCenter > radius * 0.7) {
                // Stronger pull outside the main sphere radius
                gravityStrength = mix(0.002, 0.005, min(1.0, (distToCenter - radius * 0.7) / (radius * 0.3)));
            }
            
            // Apply gravity (normalized direction * strength * noise variation)
            float noise = (1.0 + pow(cnoise(vec4(p.xyz * 0.002, time * 0.0001)), 1.0)) / 2.0;
            vec3 gravity = normalize(toCenter) * gravityStrength * noise;
            a += gravity;
            
            // 3. Add small random movement
            float randStr = 0.0005;
            vec3 rand;
            rand.x = hash12(vec2(id, time * 0.001)) * 2.0 - 1.0;
            rand.y = hash12(vec2(id + 0.1, time * 0.001 + 0.1)) * 2.0 - 1.0;
            rand.z = hash12(vec2(id + 0.2, time * 0.001 + 0.2)) * 2.0 - 1.0;
            a += rand * randStr;
            
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
            
            // Add acceleration to velocity
            v += a;
            
            // Apply damping for stability
            v *= 0.98; 

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