function createPosTargetShader() {
    return `
        #define PI 3.1415926535897932384626433832795
        
        uniform float time;
        uniform float radius;
        
        // Simple hash function
        float hash(vec2 p) {
            return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
        }
        
        void main() {
            // Get position in grid
            vec2 uv = gl_FragCoord.xy / resolution.xy;
            float i = gl_FragCoord.y * resolution.x + gl_FragCoord.x;
            
            // Create unique ID for this position
            float id = hash(uv);
            
            // Create spherical coordinates
            float theta = id * 2.0 * PI;
            float phi = acos(2.0 * hash(uv + 0.5) - 1.0);
            
            // Radius with slight variation
            float r = radius * (0.8 + 0.2 * hash(uv + vec2(0.7, 0.4)));
            
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
        uniform float time;
        uniform float radius;
        
        // Simple hash function
        float hash(vec2 p) {
            return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
        }
        
        void main() {
            vec2 uv = gl_FragCoord.xy / resolution.xy;
            vec3 pos = texture2D(pos, uv).xyz;
            
            // Acceleration components
            vec3 acc = vec3(0.0);
            
            // 1. Gravity-like force toward center
            float distFromCenter = length(pos);
            vec3 toCenter = -pos;
            if (distFromCenter > 0.0) toCenter = normalize(toCenter);
            
            // Stronger pull when further from center
            float gravity = mix(0.001, 0.01, smoothstep(0.0, radius * 1.5, distFromCenter));
            acc += toCenter * gravity;
            
            // 2. Small random force for variety
            float t = time * 0.0005;
            float seed = hash(uv + vec2(t));
            acc.x += (hash(uv + vec2(t, 0.1)) * 2.0 - 1.0) * 0.002;
            acc.y += (hash(uv + vec2(0.2, t)) * 2.0 - 1.0) * 0.002;
            acc.z += (hash(uv + vec2(t, 0.3)) * 2.0 - 1.0) * 0.002;
            
            // 3. Swirling motion - rotate around Y axis
            vec3 swirlDir = vec3(-pos.z, 0.0, pos.x); // Cross product with Y axis
            if (length(swirlDir) > 0.0) swirlDir = normalize(swirlDir);
            float swirlStrength = 0.005 * (1.0 - min(1.0, distFromCenter / radius));
            acc += swirlDir * swirlStrength;
            
            gl_FragColor = vec4(acc, 1.0);
        }
    `;
}

function createVelShader() {
    return `
        void main() {
            vec2 uv = gl_FragCoord.xy / resolution.xy;
            vec3 vel = texture2D(vel, uv).xyz;
            vec3 acc = texture2D(acc, uv).xyz;
            vec3 pos = texture2D(pos, uv).xyz;
            
            // Add acceleration to velocity
            vel += acc;
            
            // Apply damping - more damping when further from center
            float dist = length(pos);
            float damping = 0.97;
            vel *= damping;
            
            // Limit max velocity
            float maxVel = 0.5;
            float speed = length(vel);
            if (speed > maxVel) {
                vel = vel * (maxVel / speed);
            }
            
            gl_FragColor = vec4(vel, 1.0);
        }
    `;
}

function createPosShader() {
    return `
        uniform int frame;
        
        // Simple hash function
        float hash(vec2 p) {
            return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
        }
        
        void main() {
            vec2 uv = gl_FragCoord.xy / resolution.xy;
            vec4 pos;
            
            // Initialize from target position in early frames
            if (frame < 5) {
                pos = texture2D(posTarget, uv);
                
                // Add randomization to initial positions
                if (frame == 0) {
                    vec3 rand;
                    rand.x = (hash(uv + vec2(0.1, 0.3)) * 2.0 - 1.0) * 2.0;
                    rand.y = (hash(uv + vec2(0.7, 0.9)) * 2.0 - 1.0) * 2.0;
                    rand.z = (hash(uv + vec2(0.4, 0.2)) * 2.0 - 1.0) * 2.0;
                    pos.xyz += rand;
                }
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