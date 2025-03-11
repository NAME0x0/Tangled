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
		uniform vec3 externalBlackHoles[8];
		uniform int externalBlackHoleCount;
		
		varying float alpha;
		varying vec3 col;

		// HSL to RGB conversion for dynamic coloring
		vec3 hsl2rgb(vec3 c) {
			vec3 rgb = clamp(abs(mod(c.x * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
			return c.z + c.y * (rgb - 0.5) * (1.0 - abs(2.0 * c.z - 1.0));
		}

		void main() {
			int i = gl_VertexID;
			ivec2 size = ivec2(${nX}, ${nX});
			vec2 uv = uvFromIndex(i, size);
			vec4 posTarget = texture2D(posTarget, uv);
			vec4 pos = texture2D(pos, uv);
			vec4 velData = texture2D(vel, uv);

			// Get the particle position
			vec3 p = pos.xyz;
			float t = time * 0.0003;

			// Particle size based on hash
			float n = hash12(vec2(float(i), 0.0));
			float ps = pow(n, 2.0) * 2.0; // Base particle size
			
			// Base alpha
			alpha = 0.2 + pow(n, 20.0) * 0.3;
			
			// Special effects for some particles
			if (n > 0.999) {
				ps *= 1.2;
				alpha *= 2.0;
			}
			
			// Check proximity to external black holes to highlight particles
			for (int j = 0; j < 8; j++) {
				if (j >= externalBlackHoleCount) break;
				
				vec3 externalPos = externalBlackHoles[j];
				float dist = length(p - externalPos);
				
				// Enhance particles that are near external black holes
				if (dist < radius * 0.6) {
					// Proximity effect - particles get larger and brighter
					float influence = 1.0 - smoothstep(0.0, radius * 0.6, dist);
					ps *= 1.0 + influence * 0.5;
					alpha *= 1.0 + influence * 0.4;
				}
			}

			// Velocity-based coloring
			vec4 a = texture2D(vel, uv);
			float speed = length(a.xyz);
			
			// Dynamic color based on velocity and position
			vec3 baseColor = vec3(hue, 0.7, 0.5); // HSL color
			
			// Increase saturation for particles moving faster
			baseColor.y = min(0.9, baseColor.y + speed * 0.3);
			
			// Make particles near the center more luminous
			float distFromCenter = length(p);
			baseColor.z = min(0.8, baseColor.z + (1.0 - smoothstep(0.0, radius * 0.7, distFromCenter)) * 0.2);
			
			// Convert to RGB for fragment shader
			col = hsl2rgb(baseColor);
			
			// Interaction effect: make particles slightly larger when acceleration is high
			vec4 acc = texture2D(acc, uv);
			float accMagnitude = length(acc.xyz);
			ps *= 1.0 + min(0.5, accMagnitude * 0.3);

			gl_PointSize = ps;
			gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
		}
	`;

	let frag = `
		uniform float time;
		varying float alpha;
		varying vec3 col;

		void main() {
			// Circular particle shape with soft edge
			vec2 center = gl_PointCoord - 0.5;
			float dist = length(center);
			float fadeEdge = smoothstep(0.5, 0.35, dist);
			
			// Apply circular mask with fade
			float a = alpha * fadeEdge;
			
			// Add slight pulsing effect
			float pulse = 0.05 * sin(time * 0.001 + gl_FragCoord.x * 0.01 + gl_FragCoord.y * 0.01);
			
			gl_FragColor = vec4(col.rgb, a + pulse);
		}
	`;

	const material = new THREE.ShaderMaterial({
		uniforms: {
			time: { value: 1.0 },
			hue: { value: 0.5 },
			radius: { value: 80.0 },
			externalBlackHoles: { value: [] },
			externalBlackHoleCount: { value: 0 }
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

// Create a tether material between windows
function createTetherMaterial() {
	return new THREE.LineDashedMaterial({
		color: 0x66bbff,
		linewidth: 2,
		scale: 1,
		dashSize: 3,
		gapSize: 1,
		transparent: true,
		opacity: 0.6,
		blending: THREE.AdditiveBlending
	});
}

export { createPointsMaterial, createTetherMaterial };