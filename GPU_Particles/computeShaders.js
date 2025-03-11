import {hash12, cnoise4} from './glslNoise.js';
import {PI} from './glslUtils.js';

function createPosTargetShader ()
{
	return `
		${PI}
		${hash12}

		uniform float time;
		uniform float radius;

		void main ()
		{
			float nPoints = resolution.x * resolution.y;
			float i = (gl_FragCoord.y * resolution.x) + gl_FragCoord.x;
			vec2 uv = gl_FragCoord.xy / resolution.xy;

			vec3 pos = vec3(0.0);
			float angle = (i / nPoints) * PI * 2.0;
			float rad = sin(time * 0.0001) * 200.0;
			rad = radius + hash12(vec2(i * 0.123, i * 3.453)) * radius;
			pos.x = cos(angle) * rad;
			pos.y = sin(angle) * rad;
			pos.z = 0.0;

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
        uniform float blackHoleMass;
        uniform vec3 externalBlackHoles[8]; // Support up to 8 external black holes
        uniform float externalMasses[8];
        uniform int externalBlackHoleCount;

        void main() {
            float nPoints = resolution.x * resolution.y;
            float i = (gl_FragCoord.y * resolution.x) + gl_FragCoord.x;
            vec2 uv = gl_FragCoord.xy / resolution.xy;

            vec3 a = vec3(0.0);
            vec4 p = texture2D(pos, uv);
            vec4 tar = texture2D(posTarget, uv);

            // Small turbulence for natural motion
            vec3 turb;
            float t = time * 0.0001;
            float n = hash12(uv * 0.02 + i);
            float s = .2;

            turb.x = cnoise(vec4(p.xyz * 0.006 + n * 35.4, t));
            turb.y = cnoise(vec4(p.xyz * 0.007 + n * 32.3, t));
            turb.z = cnoise(vec4(p.xyz * 0.006 + n * 43.3, t));
            turb *= pow(cnoise(vec4(p.xyz * 0.01, time * 0.0003)), 3.0) * s * 20.0;
            a += turb;

            // Pull toward target position (original system behavior)
            vec3 back = tar.xyz - p.xyz;
            back *= ((1.0 + pow(cnoise(vec4(tar.xyz * 0.002, time * 0.0001)), 1.0)) / 2.0) * 0.003;
            a += back;

            // MAIN BLACK HOLE EFFECT: Strong gravitational pull toward center
            vec3 toCenter = vec3(0.0) - p.xyz;  // Vector pointing from particle to center
            float distToCenter = length(toCenter);
            
            // Normalize direction vector
            toCenter = normalize(toCenter);
            
            // Inverse square law for gravity (stronger when closer)
            float minDist = 20.0; // To prevent particles from accelerating too much near the center
            float safeDistance = max(distToCenter, minDist);
            float gravityStrength = blackHoleMass / (safeDistance * safeDistance);
            
            // Apply gravitational force
            vec3 gravityForce = toCenter * gravityStrength;
            
            // Add angular momentum effect (allows for orbital motion)
            vec3 orbital = cross(vec3(0.0, 0.0, 1.0), normalize(p.xyz));
            float orbitalFactor = 0.1 * min(1.0, distToCenter / 100.0);
            a += gravityForce + orbital * orbitalFactor;

            // EXTERNAL BLACK HOLES: Apply gravity from other windows
            for (int j = 0; j < 8; j++) {
                if (j >= externalBlackHoleCount) break;
                
                vec3 externalPos = externalBlackHoles[j];
                float mass = externalMasses[j];
                
                vec3 toExternal = externalPos - p.xyz;
                float distToExternal = length(toExternal);
                
                if (distToExternal > 0.1) {
                    // Apply inverse square law with reduced effect for external black holes
                    float safeExternalDist = max(distToExternal, minDist * 2.0);
                    float externalStrength = mass / (safeExternalDist * safeExternalDist);
                    
                    // Add force toward external black hole
                    a += normalize(toExternal) * externalStrength * 0.5;
                    
                    // Create some swirling effect around external black holes
                    vec3 externalOrbital = cross(vec3(0.0, 0.0, 1.0), normalize(toExternal));
                    a += externalOrbital * externalStrength * 0.03;
                }
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
            float nPoints = resolution.x * resolution.y;
            float i = (gl_FragCoord.y * resolution.x) + gl_FragCoord.x;
            vec2 uv = gl_FragCoord.xy / resolution.xy;

            vec4 a = texture2D(acc, uv);
            vec4 v = texture2D(vel, uv);
            vec4 p = texture2D(pos, uv);
            
            // Apply acceleration
            v += a;
            
            // Distance-based damping
            float distToCenter = length(p.xyz);
            float orbitalZone = clamp((distToCenter - 30.0) / 100.0, 0.0, 1.0);
            float dampingFactor = mix(0.97, 0.995, orbitalZone);
            v *= dampingFactor; 
            
            // Hard speed limit to prevent unstable behavior
            float maxSpeed = 2.5;
            float speed = length(v.xyz);
            if (speed > maxSpeed) {
                v.xyz = normalize(v.xyz) * maxSpeed;
            }

            gl_FragColor = vec4(v.xyz, 1.0);
        }
    `;
}

function createPosShader ()
{
	return `
		${PI}

		uniform float time;
		uniform int frame;

		void main ()
		{
			float nPoints = resolution.x * resolution.y;
			float i = (gl_FragCoord.y * resolution.x) + gl_FragCoord.x;
			vec2 uv = gl_FragCoord.xy / resolution.xy;

			vec4 p;

			if (frame < 2)
			{
				p = texture2D(posTarget, uv);
			}
			else
			{
				p = texture2D(pos, uv);
				p += texture2D(vel, uv);
			}
			
			gl_FragColor = vec4(p.xyz, 1.0);
		}
	`;
}

export {createPosTargetShader, createAccShader, createVelShader, createPosShader};