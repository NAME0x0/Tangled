import * as THREE from 'three';
// Import the GPGPU utility
import { GPUComputationRenderer } from 'three/addons/misc/GPUComputationRenderer.js'; // Adjust path if needed
// Import OrbitControls
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'; // Adjust path if needed
// Import WindowManager for multi-window coordination
import { WindowManager } from './WindowManager.js';

// Define the pass-through vertex shader once
const defaultPassThruVertexShader = `
varying vec2 vUv;
void main() {
	vUv = uv;
	gl_Position = vec4( position, 1.0 );
}
`;

// Shader code (Load externally in production if possible)
const passthruVertexShader = `
// Simple pass-through vertex shader for GPGPU
varying vec2 vUv;

void main() {
    vUv = uv;
    // We don't need projection matrix here, just rendering a quad to cover the RT
    gl_Position = vec4(position, 1.0);
}
`;

// GLSL Noise function (Simplex 3D) - Based on work by Stefan Gustavson and Ashima Arts
const simplexNoise3d = `
vec3 mod289(vec3 x) {
  return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec4 mod289(vec4 x) {
  return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec4 permute(vec4 x) {
     return mod289(((x*34.0)+1.0)*x);
}

vec4 taylorInvSqrt(vec4 r)
{
  return 1.79284291400159 - 0.85373472095314 * r;
}

float snoise(vec3 v)
{
  const vec2  C = vec2(1.0/6.0, 1.0/3.0) ;
  const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);

// First corner
  vec3 i  = floor(v + dot(v, C.yyy) );
  vec3 x0 =   v - i + dot(i, C.xxx) ;

// Other corners
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min( g.xyz, l.zxy );
  vec3 i2 = max( g.xyz, l.zxy );

  //   x0 = x0 - 0.0 + 0.0 * C.xxx;
  //   x1 = x0 - i1  + 1.0 * C.xxx;
  //   x2 = x0 - i2  + 2.0 * C.xxx;
  //   x3 = x0 - 1.0 + 3.0 * C.xxx;
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy; // 2.0*C.x = 1/3 = C.y
  vec3 x3 = x0 - D.yyy;      // -1.0+3.0*C.x = -0.5 = -D.y

// Permutations
  i = mod289(i);
  vec4 p = permute( permute( permute(
             i.z + vec4(0.0, i1.z, i2.z, 1.0 ))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0 ))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0 ));

// Gradients: 7x7 points over a square, mapped onto an octahedron.
// The ring size 17*17 = 289 is close to a multiple of 49 (49*6 = 294)
  float n_ = 0.142857142857; // 1.0/7.0
  vec3  ns = n_ * D.wyz - D.xzx;

  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);  //  mod(p,7*7)

  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_ );    // mod(j,N)

  vec4 x = x_ *ns.x + ns.yyyy;
  vec4 y = y_ *ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);

  vec4 b0 = vec4( x.xy, y.xy );
  vec4 b1 = vec4( x.zw, y.zw );

  //vec4 s0 = vec4(lessThan(b0,0.0))*2.0 - 1.0;
  //vec4 s1 = vec4(lessThan(b1,0.0))*2.0 - 1.0;
  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));

  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy ;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww ;

  vec3 p0 = vec3(a0.xy,h.x);
  vec3 p1 = vec3(a0.zw,h.y);
  vec3 p2 = vec3(a1.xy,h.z);
  vec3 p3 = vec3(a1.zw,h.w);

//Normalise gradients
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;

// Mix final noise value
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1),
                                dot(p2,x2), dot(p3,x3) ) );
}
`;

// Simplified Compute Shaders
const velocityFragmentShader = `
// GPGPU Velocity Update Fragment Shader
precision highp float;
varying vec2 vUv;

// Textures provided automatically
// uniform sampler2D uVelocityTexture;
// uniform sampler2D uPositionTexture;

// Attractor, Physics, Membrane parameters
uniform vec3 uAttractorPos;
uniform float uAttractorStrength;
uniform float uDamping;
uniform float uRepulsionRadius;
uniform float uRepulsionStrength;
uniform float uOrbitRadius;
uniform float uOrbitStrength;
uniform float uOutwardPushStrength;
uniform float uMembraneMinRadius;
uniform float uMembraneMaxRadius;
uniform float uMembranePushStrength;
uniform float uMembranePullStrength;

// General Noise parameters
uniform float uNoiseScale;
uniform float uNoiseStrength;
uniform float uDirectNoiseStrength;
uniform float uNoiseTime;
uniform float uNoiseEpsilon;
// Membrane Curl Noise parameters
uniform float uMembraneCurlNoiseScale;
uniform float uMembraneCurlNoiseStrength;
// Ambient Jitter
uniform float uAmbientJitterStrength;

// Inertia parameters
uniform vec3 uCameraRotationAxis;
uniform float uCameraRotationAngle;
uniform float uInertiaStrength;

uniform float uMaxVelocity;

// Advection
uniform float uAdvectionFactor;
uniform vec2 uTextureDimensions;

// Wave Force Strength
uniform float uWaveForceStrength;

// Cross-Window Forces
uniform vec2 uSceneOffset;
uniform vec2 uThisWindowCenter;
uniform vec2 uOtherWindow0Center;
uniform float uOtherWindow0Active;
uniform vec2 uOtherWindow1Center;
uniform float uOtherWindow1Active;
uniform vec2 uOtherWindow2Center;
uniform float uOtherWindow2Active;
uniform vec2 uOtherWindow3Center;
uniform float uOtherWindow3Active;
uniform float uCrossWindowAttractionStrength;
uniform float uCrossWindowAttractionRadius;

const float MIN_DIST_SQ = 0.01;

${simplexNoise3d}

// Function to calculate Curl Noise force
vec3 calculateCurlNoiseForce(vec3 pos) {
    float eps = uNoiseEpsilon;

    // Calculate noise potential at slightly offset points
    float n1 = snoise(pos + vec3(eps, 0.0, 0.0));
    float n2 = snoise(pos - vec3(eps, 0.0, 0.0));
    float n3 = snoise(pos + vec3(0.0, eps, 0.0));
    float n4 = snoise(pos - vec3(0.0, eps, 0.0));
    float n5 = snoise(pos + vec3(0.0, 0.0, eps));
    float n6 = snoise(pos - vec3(0.0, 0.0, eps));

    // Calculate derivatives using central differences
    float dPotential_dx = (n1 - n2) / (2.0 * eps);
    float dPotential_dy = (n3 - n4) / (2.0 * eps);
    float dPotential_dz = (n5 - n6) / (2.0 * eps);

    // Calculate curl: curl(F) = (dFz/dy - dFy/dz, dFx/dz - dFz/dx, dFy/dx - dFx/dy)
    // Since our force is derived from a scalar potential field (noise), the components are derivatives of the potential
    // Example: Calculate curl.x by sampling noise for d/dy(potential.z) and d/dz(potential.y)
    // We simplify by directly calculating the curl of the *potential field itself*
    float curl_x = (snoise(pos + vec3(0.0, eps, 0.0)) - snoise(pos - vec3(0.0, eps, 0.0)))
                 - (snoise(pos + vec3(0.0, 0.0, eps)) - snoise(pos - vec3(0.0, 0.0, eps)));
    float curl_y = (snoise(pos + vec3(0.0, 0.0, eps)) - snoise(pos - vec3(0.0, 0.0, eps)))
                 - (snoise(pos + vec3(eps, 0.0, 0.0)) - snoise(pos - vec3(eps, 0.0, 0.0)));
    float curl_z = (snoise(pos + vec3(eps, 0.0, 0.0)) - snoise(pos - vec3(eps, 0.0, 0.0)))
                 - (snoise(pos + vec3(0.0, eps, 0.0)) - snoise(pos - vec3(0.0, eps, 0.0)));

    // Corrected Curl Calculation (using central differences for derivatives)
    // Re-sample points for derivatives needed for curl formula
    float n1_y = snoise(pos + vec3(0.0, eps, 0.0)); // Pot at y+eps
    float n2_y = snoise(pos - vec3(0.0, eps, 0.0)); // Pot at y-eps
    float n1_z = snoise(pos + vec3(0.0, 0.0, eps)); // Pot at z+eps
    float n2_z = snoise(pos - vec3(0.0, 0.0, eps)); // Pot at z-eps
    float n1_x = snoise(pos + vec3(eps, 0.0, 0.0)); // Pot at x+eps
    float n2_x = snoise(pos - vec3(eps, 0.0, 0.0)); // Pot at x-eps

    // Recalculate derivatives
    float dz_dy = (snoise(pos + vec3(0.0, eps, eps)) - snoise(pos - vec3(0.0, eps, eps))) / (2.0 * eps);
    float dy_dz = (snoise(pos + vec3(0.0, eps, eps)) - snoise(pos - vec3(0.0, eps, eps))) / (2.0 * eps);
    // These aren't quite right for curl components - need derivatives of *components* if F was a vector field
    // Since we start with scalar potential (noise), we calculate curl of the gradient of the potential.
    // Curl(gradient(potential)) is always zero mathematically.
    // What we really want is a divergence-free field based on noise.
    // A common way is F = curl(A), where A is a vector potential derived from noise.
    // Let A = (snoise(pos), snoise(pos + offset1), snoise(pos + offset2))

    vec3 offset1 = vec3(13.7, 5.9, -4.1);
    vec3 offset2 = vec3(-8.3, 1.7, 9.5);

    // Calculate derivatives of A components
    float dAy_dz = (snoise(pos + offset1 + vec3(0.0, 0.0, eps)) - snoise(pos + offset1 - vec3(0.0, 0.0, eps))) / (2.0 * eps);
    float dAz_dy = (snoise(pos + offset2 + vec3(0.0, eps, 0.0)) - snoise(pos + offset2 - vec3(0.0, eps, 0.0))) / (2.0 * eps);

    float dAz_dx = (snoise(pos + offset2 + vec3(eps, 0.0, 0.0)) - snoise(pos + offset2 - vec3(eps, 0.0, 0.0))) / (2.0 * eps);
    float dAx_dz = (snoise(pos + vec3(0.0, 0.0, eps)) - snoise(pos - vec3(0.0, 0.0, eps))) / (2.0 * eps);

    float dAx_dy = (snoise(pos + vec3(0.0, eps, 0.0)) - snoise(pos - vec3(0.0, eps, 0.0))) / (2.0 * eps);
    float dAy_dx = (snoise(pos + offset1 + vec3(eps, 0.0, 0.0)) - snoise(pos + offset1 - vec3(eps, 0.0, 0.0))) / (2.0 * eps);

    return normalize(vec3(dAz_dy - dAy_dz, dAx_dz - dAz_dx, dAy_dx - dAx_dy)) * uNoiseStrength;
}

// Function to calculate force based on sum of sine waves
vec3 calculateWaveForce(vec3 pos, float time) {
    vec3 totalWaveForce = vec3(0.0);

    // Wave 1 Parameters
    vec2 D1 = normalize(vec2(1.0, 0.5)); // Direction
    float f1 = 0.2; // Frequency (controls wavelength)
    float A1 = 0.3; // Amplitude
    float s1 = 0.8; // Speed

    // Wave 2 Parameters
    vec2 D2 = normalize(vec2(-0.7, 0.8));
    float f2 = 0.15;
    float A2 = 0.4;
    float s2 = 0.6;

    // Wave 3 Parameters
    vec2 D3 = normalize(vec2(0.2, -1.0));
    float f3 = 0.25;
    float A3 = 0.25;
    float s3 = 1.0;

    // Wave 4 Parameters (NEW)
    vec2 D4 = normalize(vec2(-0.9, -0.4));
    float f4 = 0.18;
    float A4 = 0.35;
    float s4 = 0.7;

    // Wave 5 Parameters (NEW)
    vec2 D5 = normalize(vec2(0.6, -0.8));
    float f5 = 0.22;
    float A5 = 0.3;
    float s5 = 0.9;

    // Calculate force for Wave 1 (proportional to negative gradient)
    float waveArg1 = dot(D1, pos.xz) * f1 + time * s1;
    totalWaveForce += -normalize(vec3(D1.x, 0.0, D1.y)) * A1 * f1 * cos(waveArg1);

    // Calculate force for Wave 2
    float waveArg2 = dot(D2, pos.xz) * f2 + time * s2;
    totalWaveForce += -normalize(vec3(D2.x, 0.0, D2.y)) * A2 * f2 * cos(waveArg2);

    // Calculate force for Wave 3
    float waveArg3 = dot(D3, pos.xz) * f3 + time * s3;
    totalWaveForce += -normalize(vec3(D3.x, 0.0, D3.y)) * A3 * f3 * cos(waveArg3);

    // Calculate force for Wave 4 (NEW)
    float waveArg4 = dot(D4, pos.xz) * f4 + time * s4;
    totalWaveForce += -normalize(vec3(D4.x, 0.0, D4.y)) * A4 * f4 * cos(waveArg4);

    // Calculate force for Wave 5 (NEW)
    float waveArg5 = dot(D5, pos.xz) * f5 + time * s5;
    totalWaveForce += -normalize(vec3(D5.x, 0.0, D5.y)) * A5 * f5 * cos(waveArg5);

    return totalWaveForce;
}

// Function to calculate Cross-Window attraction force
vec3 calculateCrossWindowForce(vec3 particlePos) {
    vec3 totalForce = vec3(0.0);

    // Convert particle position to screen space
    vec2 particleScreen = particlePos.xy - uSceneOffset;

    // Helper function inline - calculate force towards a window center
    // For each active window, attract particles towards that window's center
    float radius = uCrossWindowAttractionRadius;
    float strength = uCrossWindowAttractionStrength;

    // Window 0
    if (uOtherWindow0Active > 0.5) {
        vec2 toWindow = uOtherWindow0Center - particleScreen;
        float dist = length(toWindow);
        if (dist > 1.0 && dist < radius) {
            vec2 dir = toWindow / dist;
            // Smooth falloff - stronger when closer to edge of attraction radius
            float falloff = smoothstep(radius, 0.0, dist);
            // Also reduce force when very close to prevent instability
            float nearFalloff = smoothstep(0.0, 100.0, dist);
            totalForce.xy += dir * strength * falloff * nearFalloff;
        }
    }

    // Window 1
    if (uOtherWindow1Active > 0.5) {
        vec2 toWindow = uOtherWindow1Center - particleScreen;
        float dist = length(toWindow);
        if (dist > 1.0 && dist < radius) {
            vec2 dir = toWindow / dist;
            float falloff = smoothstep(radius, 0.0, dist);
            float nearFalloff = smoothstep(0.0, 100.0, dist);
            totalForce.xy += dir * strength * falloff * nearFalloff;
        }
    }

    // Window 2
    if (uOtherWindow2Active > 0.5) {
        vec2 toWindow = uOtherWindow2Center - particleScreen;
        float dist = length(toWindow);
        if (dist > 1.0 && dist < radius) {
            vec2 dir = toWindow / dist;
            float falloff = smoothstep(radius, 0.0, dist);
            float nearFalloff = smoothstep(0.0, 100.0, dist);
            totalForce.xy += dir * strength * falloff * nearFalloff;
        }
    }

    // Window 3
    if (uOtherWindow3Active > 0.5) {
        vec2 toWindow = uOtherWindow3Center - particleScreen;
        float dist = length(toWindow);
        if (dist > 1.0 && dist < radius) {
            vec2 dir = toWindow / dist;
            float falloff = smoothstep(radius, 0.0, dist);
            float nearFalloff = smoothstep(0.0, 100.0, dist);
            totalForce.xy += dir * strength * falloff * nearFalloff;
        }
    }

    return totalForce;
}

void main() {
    // Read previous state
    vec4 previousVelocityData = texture2D(uVelocityTexture, vUv);
    vec3 particleVelocity = previousVelocityData.xyz;

    vec4 previousPositionData = texture2D(uPositionTexture, vUv);
    vec3 particlePosition = previousPositionData.xyz;

    // Calculate distance/direction to attractor
    vec3 dirToAttractor = uAttractorPos - particlePosition;
    float distSq = max(dot(particlePosition, particlePosition), MIN_DIST_SQ);
    float dist = sqrt(distSq);
    vec3 normalizedDirToAttractor = normalize(dirToAttractor);
    vec3 normalizedDirFromOrigin = normalize(particlePosition);

    vec3 baseForce = vec3(0.0);
    float repulsionRadiusSq = uRepulsionRadius * uRepulsionRadius;
    float orbitRadiusSq = uOrbitRadius * uOrbitRadius;

    // --- Base Force Logic (Attraction/Repulsion/Orbit) ---
    if (distSq < repulsionRadiusSq) {
        baseForce = normalizedDirFromOrigin * uRepulsionStrength / distSq;
    } else if (distSq < orbitRadiusSq) {
        vec3 attractiveForce = normalizedDirToAttractor * uAttractorStrength / distSq;
        vec3 tangent = normalize(cross(dirToAttractor, particleVelocity));
         if (length(tangent) < 0.1) { tangent = normalize(cross(dirToAttractor, vec3(0.0, 1.0, 0.0))); }
         if (length(tangent) < 0.1) { tangent = normalize(cross(dirToAttractor, vec3(1.0, 0.0, 0.0))); }
        vec3 tangentialForce = tangent * uOrbitStrength;
        baseForce = attractiveForce + tangentialForce;
    } else {
        baseForce = normalizedDirToAttractor * uAttractorStrength / distSq;
    }

    // --- Outward Push Force ---
    // Modulate push strength - less push near the core, max push near membrane
    float pushModulation = smoothstep(uOrbitRadius, uMembraneMinRadius, dist); // Ramp up push in cytoplasm
    vec3 outwardForce = normalizedDirFromOrigin * uOutwardPushStrength * pushModulation;

    // --- Calculate Noise Modulation based on Distance ---
    float generalNoiseModulation = 1.0;
    generalNoiseModulation *= smoothstep(uRepulsionRadius * 0.9, uRepulsionRadius * 1.8, dist);
    generalNoiseModulation *= (1.0 - smoothstep(uMembraneMinRadius * 0.9, uMembraneMaxRadius * 0.95, dist));
    generalNoiseModulation = max(generalNoiseModulation * 0.8, 0.0); // Reduce peak cytoplasm noise slightly, ensure non-negative

    // --- General Noise Forces (Quieter Cytoplasm turbulence) ---
    vec3 generalNoiseCoord = particlePosition * uNoiseScale + uNoiseTime;
    vec3 curlNoiseForce = calculateCurlNoiseForce(generalNoiseCoord) * uNoiseStrength * generalNoiseModulation;
    vec3 directNoiseForce = vec3(
        snoise(generalNoiseCoord + vec3(1.1, 2.3, 3.4)),
        snoise(generalNoiseCoord + vec3(4.5, 5.6, 6.7)),
        snoise(generalNoiseCoord + vec3(7.8, 8.9, 9.0))
    ) * uDirectNoiseStrength * generalNoiseModulation;

    // --- Membrane Curl Noise Force (Slower, broader surface flow) ---
    float membraneZoneFactor = smoothstep(uMembraneMinRadius * 0.8, uMembraneMinRadius, dist) * (1.0 - smoothstep(uMembraneMaxRadius, uMembraneMaxRadius * 1.1, dist));
    vec3 membraneNoiseCoord = particlePosition * uMembraneCurlNoiseScale + uNoiseTime * 0.8; // Slower evolution (was 1.0)
    vec3 membraneCurlNoiseForce = calculateCurlNoiseForce(membraneNoiseCoord) * uMembraneCurlNoiseStrength * membraneZoneFactor;

    // --- Ambient Jitter Force (Subtle continuous nudge) ---
    vec3 jitterCoord = particlePosition * 15.0 + uNoiseTime * 6.0;
    vec3 ambientJitterForce = vec3(
        snoise(jitterCoord + vec3(15.1, -25.3, 55.4)),
        snoise(jitterCoord + vec3(-45.5, 55.6, -65.7)),
        snoise(jitterCoord + vec3(75.8, -85.9, 95.0))
    ) * uAmbientJitterStrength;

    // --- Inertia Force (Rotation based - uniform strength) ---
    vec3 inertiaForce = cross(uCameraRotationAxis, particlePosition) * uCameraRotationAngle * uInertiaStrength;

    // --- Membrane Boundary Forces ---
    vec3 membraneForceBoundary = vec3(0.0);
    if (dist > uMembraneMaxRadius) {
        membraneForceBoundary += normalizedDirToAttractor * uMembranePushStrength * (dist - uMembraneMaxRadius);
    } else if (dist < uMembraneMinRadius) {
        membraneForceBoundary += normalizedDirFromOrigin * uMembranePullStrength * (uMembraneMinRadius - dist);
    }

    // --- Weaken Boundary during Rotation (Slosh Effect) ---
    // Map rotation angle to a weakening factor (0 = no rotation/no weaken, 1 = max weaken)
    float boundaryWeakeningFactor = smoothstep(0.01, 0.15, uCameraRotationAngle);
    // Apply weakening (e.g., reduce boundary force by up to 85% during fast rotation)
    membraneForceBoundary *= (1.0 - boundaryWeakeningFactor * 0.85);

    // --- Coherent Wave Force ---
    vec3 waveForce = calculateWaveForce(particlePosition, uNoiseTime);

    // --- Cross-Window Attraction Force ---
    vec3 crossWindowForce = calculateCrossWindowForce(particlePosition);

    // --- Modify Forces within Membrane Zone ---
    // Reduce Wave force strength, increase Membrane Curl and Jitter strengths within the membrane zone
    float membraneWaveReductionFactor = 1.0 - membraneZoneFactor * 0.9; // Reduce wave by up to 90%
    float membraneCurlBoostFactor = 1.0 + membraneZoneFactor * 3.0; // Boost curl by up to 3x
    float membraneJitterBoostFactor = 1.0 + membraneZoneFactor * 2.0; // Boost jitter by up to 2x

    vec3 modifiedWaveForce = waveForce * membraneWaveReductionFactor;
    vec3 modifiedMembraneCurlForce = membraneCurlNoiseForce * membraneCurlBoostFactor;
    vec3 modifiedAmbientJitterForce = ambientJitterForce * membraneJitterBoostFactor;

    // --- Combine Forces ---
    vec3 totalForce = baseForce + outwardForce + membraneForceBoundary +   // Core structure
                      curlNoiseForce + directNoiseForce +                  // General Cytoplasm noise
                      modifiedMembraneCurlForce + modifiedAmbientJitterForce + // Modified Membrane noise
                      inertiaForce +                                       // Inertia
                      modifiedWaveForce * uWaveForceStrength +             // Modified Wave Force
                      crossWindowForce;                                    // Cross-Window attraction

    // --- Apply Forces to Velocity ---
    particleVelocity += totalForce;

    // --- Simplified Velocity Advection --- 
    // Look up velocity slightly upstream based on *updated* velocity
    // Small constant factor instead of actual deltaTime for simplicity/stability here
    const float advectionTimeStep = 0.05; 
    vec2 uvDelta = (particleVelocity.xy / uTextureDimensions) * advectionTimeStep;
    // Simple clamp to prevent excessive lookups across the texture
    uvDelta = clamp(uvDelta, -0.05, 0.05); 
    vec2 prevUv = vUv - uvDelta;
    // Read the velocity from the previous frame texture at the calculated upstream UV
    vec3 advectedVelocity = texture2D(uVelocityTexture, prevUv).xyz; 
    // Blend the force-updated velocity with the advected velocity
    particleVelocity = mix(particleVelocity, advectedVelocity, uAdvectionFactor); 

    // --- Clamp Speed & Apply Damping ---
    float speed = length(particleVelocity);
    if (speed > uMaxVelocity) { particleVelocity = normalize(particleVelocity) * uMaxVelocity; }
    float modulatedDamping = mix(uDamping, uDamping * 0.9, smoothstep(uOrbitRadius, uMembraneMaxRadius * 0.7, dist)); // Stronger effect
    particleVelocity *= modulatedDamping; // Apply modulated damping *after* advection

    gl_FragColor = vec4(particleVelocity, 1.0);
}
`;

// Function to generate pseudo-random float between 0.0 and 1.0
const randomShaderFunc = `
float random(vec2 st) {
    return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
}
`;

const positionFragmentShader = `
// GPGPU Position Update Fragment Shader
precision highp float;
varying vec2 vUv;

// Textures provided automatically
// uniform sampler2D uPositionTexture;
// uniform sampler2D uVelocityTexture;

// Removed boundary uniforms: uMaxRadius, uRespawnRadius

${randomShaderFunc} // Keep random for potential future use, though unused now

void main() {
    vec4 positionData = texture2D(uPositionTexture, vUv);
    vec3 particlePosition = positionData.xyz;
    float particleAge = positionData.w;

    vec4 velocityData = texture2D(uVelocityTexture, vUv);
    vec3 particleVelocity = velocityData.xyz;

    // Integrate velocity
    particlePosition += particleVelocity * 0.1;
    particleAge += 0.016;

    // REMOVED Boundary Check (Respawn logic handled by forces in velocity shader now)
    /*
    if (length(particlePosition) > uMaxRadius) {
       ... respawn logic ...
    }
    */

    gl_FragColor = vec4(particlePosition, particleAge);
}
`;

// Shader code (Rendering)
const particleVertexShader = `
// Particle Rendering Vertex Shader
// attribute vec2 uv; // Provided by Three.js

uniform sampler2D uPositionTexture;
uniform sampler2D uVelocityTexture;
uniform float uPointSize;
uniform float uTime;
uniform vec3 uAttractorPos;
uniform float uMembraneMinRadius;
uniform float uMembraneMaxRadius;

varying float vDistFromCenter;
varying float vSpeed;
varying float vAge;
varying vec3 vColor;

void main() {
    vec4 positionData = texture2D(uPositionTexture, uv);
    vec3 particlePosition = positionData.xyz;
    float age = positionData.w;

    vec4 velocityData = texture2D(uVelocityTexture, uv);
    vec3 velocity = velocityData.xyz;
    float speed = length(velocity);

    // Calculate distance from attractor/center
    float distFromCenter = length(particlePosition - uAttractorPos);

    // Pass to fragment shader
    vDistFromCenter = distFromCenter;
    vSpeed = speed;
    vAge = age;

    // Color based on position and velocity
    // Core: warm colors (red/orange), Membrane: cool colors (cyan/blue)
    float normalizedDist = smoothstep(0.0, uMembraneMaxRadius, distFromCenter);

    // Base color gradient from warm to cool
    vec3 coreColor = vec3(1.0, 0.3, 0.1);      // Orange-red
    vec3 midColor = vec3(1.0, 0.8, 0.4);       // Golden yellow
    vec3 membraneColor = vec3(0.2, 0.8, 1.0);  // Cyan

    // Two-stage gradient
    if (normalizedDist < 0.4) {
        vColor = mix(coreColor, midColor, normalizedDist / 0.4);
    } else {
        vColor = mix(midColor, membraneColor, (normalizedDist - 0.4) / 0.6);
    }

    // Add velocity-based color intensity
    float speedInfluence = smoothstep(0.0, 1.5, speed);
    vColor = mix(vColor * 0.6, vColor * 1.2, speedInfluence);

    vec4 mvPosition = modelViewMatrix * vec4(particlePosition, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    // Dynamic point size based on speed and distance
    float baseSizeFromSpeed = mix(0.8, 2.0, speedInfluence);
    float sizeFromDist = mix(1.2, 0.8, normalizedDist); // Slightly larger near core
    gl_PointSize = uPointSize * baseSizeFromSpeed * sizeFromDist * (300.0 / -mvPosition.z);
}
`;

const particleFragmentShader = `
// Particle Rendering Fragment Shader
precision highp float;

varying float vDistFromCenter;
varying float vSpeed;
varying float vAge;
varying vec3 vColor;

uniform float uMembraneMaxRadius;

void main() {
    // Soft circular particle
    vec2 center = gl_PointCoord - vec2(0.5);
    float dist = length(center);

    // Soft edge falloff
    float alpha = 1.0 - smoothstep(0.2, 0.5, dist);

    // Fade based on speed (faster = more visible)
    float speedAlpha = smoothstep(0.02, 0.8, vSpeed);
    alpha *= mix(0.3, 1.0, speedAlpha);

    // Slight fade at extreme membrane edge
    float edgeFade = 1.0 - smoothstep(uMembraneMaxRadius * 0.9, uMembraneMaxRadius * 1.1, vDistFromCenter);
    alpha *= mix(0.5, 1.0, edgeFade);

    // Add subtle glow effect
    float glow = exp(-dist * 4.0) * 0.5;
    vec3 finalColor = vColor + vec3(glow);

    if (alpha < 0.01) discard;

    gl_FragColor = vec4(finalColor, alpha);
}
`;

// --- Simulation Constants ---
// Size of the texture storing particle data (WIDTH x WIDTH particles)
const TEXTURE_WIDTH = 256; // Increased particle count (256*256 = 65536)
const PARTICLE_COUNT = TEXTURE_WIDTH * TEXTURE_WIDTH;
const DAMPING = 0.975;            // Slightly less damping for more fluid motion
const ATTRACTOR_STRENGTH = 1.8;   // Slightly reduce attraction to balance membrane forces
// const MAX_RADIUS = 40.0;        // Replaced by membrane radii
// const RESPAWN_RADIUS = 5.0;     // Replaced by membrane forces
const REPULSION_RADIUS = 2.0;   // Slightly larger nucleus repulsion
const REPULSION_STRENGTH = 6.0; // Reduced for smoother core
const ORBIT_RADIUS = 8.0;     // Larger orbit zone for more swirling
const ORBIT_STRENGTH = 0.8;   // Stronger orbital motion
const OUTWARD_PUSH_STRENGTH = 0.08; // Slightly more push
const MEMBRANE_MIN_RADIUS = 34.0; // Tightened range
const MEMBRANE_MAX_RADIUS = 40.0; // Slightly larger
const MEMBRANE_PUSH_STRENGTH = 4.0;
const MEMBRANE_PULL_STRENGTH = 3.0; // Stronger pull (jelly)
const MAX_VELOCITY = 2.5; // Slightly higher velocity limit
const NOISE_SCALE = 0.08;  // More noise influence
const NOISE_STRENGTH = 0.15;        // Increased for more organic movement
const DIRECT_NOISE_STRENGTH = 0.03; // Increased
const NOISE_SPEED = 0.6;  // Faster noise evolution
const NOISE_EPSILON = 0.01;
// Membrane Curl Noise
const MEMBRANE_CURL_NOISE_SCALE = 0.3;
const MEMBRANE_CURL_NOISE_STRENGTH = 0.12; // Increased for surface flow
// Ambient Jitter
const AMBIENT_JITTER_STRENGTH = 0.015; // More subtle movement
// Inertia
const INERTIA_STRENGTH = 60.0;  // More responsive to camera rotation
// Advection
const ADVECTION_FACTOR = 0.25;  // More coherent flow
// Wave Force
const WAVE_FORCE_STRENGTH = 3.0;     // Stronger wave force
// Spawn
const INITIAL_SPAWN_RADIUS = 25.0;  // Larger initial spread
// Cross-Window Forces
const CROSS_WINDOW_ATTRACTION_STRENGTH = 1.5;  // Much stronger attraction
const CROSS_WINDOW_ATTRACTION_RADIUS = 800.0;  // Larger attraction radius
const CROSS_WINDOW_TENDRIL_STRENGTH = 0.6;

let scene, camera, renderer;
let socket;
let clock;

// --- GPGPU Variables ---
let gpuCompute;
let positionVariable;
let velocityVariable;
let lastCameraQuaternion = new THREE.Quaternion();
let cameraRotationAxis = new THREE.Vector3(); // Rotation Axis
let cameraRotationAngle = 0.0; // Rotation Angle

// --- Particle Rendering Variables ---
let particlePoints;

// --- Attractor Position (Single Attractor at Origin) ---
const attractorPos = new THREE.Vector3(0, 0, 0);
// const attractor2Pos = new THREE.Vector3(-20, 0, 0); // Removed

// --- Control Variables ---
let controls;

// --- Multi-Window Variables ---
let windowManager;
let sceneOffset = { x: 0, y: 0 };
let sceneOffsetTarget = { x: 0, y: 0 };
const MAX_OTHER_WINDOWS = 4;
// Store other window centers for cross-window forces
let otherWindowCenters = [
    { x: 0, y: 0, active: false },
    { x: 0, y: 0, active: false },
    { x: 0, y: 0, active: false },
    { x: 0, y: 0, active: false }
];

// --- Tendril System Variables ---
let tendrilPoints;
let tendrilGeometry;
let tendrilMaterial;
const TENDRIL_PARTICLE_COUNT = 3000; // Particles per tendril connection (increased)
const TENDRIL_MAX_CONNECTIONS = 4;

function init() {
    // --- Basic Three.js Setup ---
    clock = new THREE.Clock();
    scene = new THREE.Scene();

    const canvas = document.getElementById('webgl-canvas');
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 50;

    // --- Initialize Controls ---
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; // Optional: Smooths out the controls
    controls.dampingFactor = 0.05;
    // controls.target.set(0, 0, 0); // Target is origin by default

    // --- Initialize WindowManager for multi-window coordination ---
    windowManager = new WindowManager();
    windowManager.init({ particleColor: '#ffffff' });
    windowManager.setWinChangeCallback((otherWindows) => {
        updateOtherWindowUniforms(otherWindows);
    });
    windowManager.setWinShapeChangeCallback((shape) => {
        // Update target scene offset when window moves
        // Convert screen coords (origin top-left, Y down) to world coords (origin center, Y up)
        sceneOffsetTarget.x = -shape.x - shape.w / 2;
        sceneOffsetTarget.y = shape.y + shape.h / 2;
    });

    // Set initial scene offset based on current window position
    const initialShape = {
        x: window.screenX || 0,
        y: window.screenY || 0,
        w: window.innerWidth,
        h: window.innerHeight
    };
    sceneOffsetTarget.x = -initialShape.x - initialShape.w / 2;
    sceneOffsetTarget.y = initialShape.y + initialShape.h / 2;
    sceneOffset.x = sceneOffsetTarget.x;
    sceneOffset.y = sceneOffsetTarget.y;

    // --- Initialize GPGPU ---
    initComputeRenderer();
    initParticleGeometry();
    initTendrils();

    // Handle window resize
    window.addEventListener('resize', onWindowResize, false);

    // --- Socket.IO Setup (Optional - for server synchronization) ---
    if (typeof io !== 'undefined') {
        console.log("Attempting to connect to Socket.IO server...");
        try {
            socket = io();

            socket.on('connect', () => {
                console.log('Connected to server with ID:', socket.id);
            });

            socket.on('disconnect', (reason) => {
                console.log('Disconnected from server:', reason);
            });

            socket.on('connect_error', (error) => {
                console.warn('Socket.IO connection error (server may not be available):', error.message);
            });

            socket.on('update_params', (params) => {
                console.log('Received params update:', params);
                // --- TODO: Update GPGPU shader uniforms based on received params --- 
                if (params.particle_count) {
                     console.log("Need to update particle count to:", params.particle_count); // TODO: Re-init needed?
                }
                // --------------------------------------------------------
            });
        } catch (e) {
            console.warn('Socket.IO initialization failed:', e.message);
            socket = null;
        }
    } else {
        console.log("Socket.IO not available - running in standalone mode");
        socket = null;
    }

    // Start the animation loop
    animate();
}

function initComputeRenderer() {
    gpuCompute = new GPUComputationRenderer(TEXTURE_WIDTH, TEXTURE_WIDTH, renderer);

    if (renderer.capabilities.isWebGL2 === false) {
        gpuCompute.setDataType(THREE.HalfFloatType);
        console.warn("WebGL 2 not supported, using HalfFloatType for GPGPU.");
    } else {
         gpuCompute.setDataType(THREE.FloatType);
         console.log("Using FloatType for GPGPU (WebGL 2 detected).");
    }

    // Create Data Textures for initial state
    const initialPositionData = new Float32Array(PARTICLE_COUNT * 4);
    const initialVelocityData = new Float32Array(PARTICLE_COUNT * 4);

    const spawnRadius = INITIAL_SPAWN_RADIUS; // Use new constant
    for (let i = 0; i < PARTICLE_COUNT; i++) {
        const i4 = i * 4;

        // Initial position (random sphere)
        const r = spawnRadius * Math.cbrt(Math.random()); // Use adjusted radius
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos((Math.random() * 2) - 1);
        initialPositionData[i4 + 0] = r * Math.sin(phi) * Math.cos(theta);
        initialPositionData[i4 + 1] = r * Math.sin(phi) * Math.sin(theta);
        initialPositionData[i4 + 2] = r * Math.cos(phi);
        initialPositionData[i4 + 3] = Math.random() * 5.0;

        // Initial velocity
        const velMag = 0.1 * Math.random();
        const vTheta = Math.random() * Math.PI * 2;
        const vPhi = Math.acos((Math.random() * 2) - 1);
        initialVelocityData[i4 + 0] = velMag * Math.sin(vPhi) * Math.cos(vTheta);
        initialVelocityData[i4 + 1] = velMag * Math.sin(vPhi) * Math.sin(vTheta);
        initialVelocityData[i4 + 2] = velMag * Math.cos(vPhi);
        initialVelocityData[i4 + 3] = 0.0;
    }

    const positionTexture = gpuCompute.createTexture();
    const velocityTexture = gpuCompute.createTexture();
    positionTexture.image.data.set(initialPositionData);
    velocityTexture.image.data.set(initialVelocityData);
    positionTexture.needsUpdate = true;
    velocityTexture.needsUpdate = true;

    // --- Create compute materials manually ---
    const positionComputeMaterial = new THREE.ShaderMaterial({
        vertexShader: defaultPassThruVertexShader,
        fragmentShader: positionFragmentShader,
        uniforms: {
        }
    });
    const velocityComputeMaterial = new THREE.ShaderMaterial({
        vertexShader: defaultPassThruVertexShader,
        fragmentShader: velocityFragmentShader,
        uniforms: {
             uAttractorPos: { value: attractorPos },
             uAttractorStrength: { value: ATTRACTOR_STRENGTH },
             uDamping: { value: DAMPING },
             uRepulsionRadius: { value: REPULSION_RADIUS },
             uRepulsionStrength: { value: REPULSION_STRENGTH },
             uOrbitRadius: { value: ORBIT_RADIUS },
             uOrbitStrength: { value: ORBIT_STRENGTH },
             uOutwardPushStrength: { value: OUTWARD_PUSH_STRENGTH },
             uMembraneMinRadius: { value: MEMBRANE_MIN_RADIUS },
             uMembraneMaxRadius: { value: MEMBRANE_MAX_RADIUS },
             uMembranePushStrength: { value: MEMBRANE_PUSH_STRENGTH },
             uMembranePullStrength: { value: MEMBRANE_PULL_STRENGTH },
             uMaxVelocity: { value: MAX_VELOCITY },
             uNoiseScale: { value: NOISE_SCALE },
             uNoiseStrength: { value: NOISE_STRENGTH },
             uDirectNoiseStrength: { value: DIRECT_NOISE_STRENGTH },
             uNoiseTime: { value: 0.0 },
             uNoiseEpsilon: { value: NOISE_EPSILON },
             uMembraneCurlNoiseScale: { value: MEMBRANE_CURL_NOISE_SCALE },
             uMembraneCurlNoiseStrength: { value: MEMBRANE_CURL_NOISE_STRENGTH },
             uAmbientJitterStrength: { value: AMBIENT_JITTER_STRENGTH },
             uCameraRotationAxis: { value: new THREE.Vector3() },
             uCameraRotationAngle: { value: 0.0 },
             uInertiaStrength: { value: INERTIA_STRENGTH },
             uAdvectionFactor: { value: ADVECTION_FACTOR },
             uTextureDimensions: { value: new THREE.Vector2(TEXTURE_WIDTH, TEXTURE_WIDTH) },
             uWaveForceStrength: { value: WAVE_FORCE_STRENGTH },
             // Cross-Window uniforms
             uSceneOffset: { value: new THREE.Vector2(0, 0) },
             uThisWindowCenter: { value: new THREE.Vector2(0, 0) },
             uOtherWindow0Center: { value: new THREE.Vector2(0, 0) },
             uOtherWindow0Active: { value: 0.0 },
             uOtherWindow1Center: { value: new THREE.Vector2(0, 0) },
             uOtherWindow1Active: { value: 0.0 },
             uOtherWindow2Center: { value: new THREE.Vector2(0, 0) },
             uOtherWindow2Active: { value: 0.0 },
             uOtherWindow3Center: { value: new THREE.Vector2(0, 0) },
             uOtherWindow3Active: { value: 0.0 },
             uCrossWindowAttractionStrength: { value: CROSS_WINDOW_ATTRACTION_STRENGTH },
             uCrossWindowAttractionRadius: { value: CROSS_WINDOW_ATTRACTION_RADIUS }
        }
    });
    // ---------------------------------------

    positionVariable = gpuCompute.addVariable("uPositionTexture", null, positionTexture);
    velocityVariable = gpuCompute.addVariable("uVelocityTexture", null, velocityTexture);
    positionVariable.material = positionComputeMaterial;
    velocityVariable.material = velocityComputeMaterial;
    gpuCompute.setVariableDependencies(positionVariable, [positionVariable, velocityVariable]);
    gpuCompute.setVariableDependencies(velocityVariable, [velocityVariable, positionVariable]);

    const error = gpuCompute.init();
    if (error !== null) {
        console.error("GPUComputationRenderer Error: " + error);
    }

    console.log(`GPUComputationRenderer Initialized (${PARTICLE_COUNT} particles, Sine Wave Force Attempt)`);
}

function initParticleGeometry() {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(PARTICLE_COUNT * 3);
    const uvs = new Float32Array(PARTICLE_COUNT * 2);

    for (let i = 0; i < PARTICLE_COUNT; i++) {
        // Initial placeholder positions (can be 0,0,0)
        positions[i * 3 + 0] = 0;
        positions[i * 3 + 1] = 0;
        positions[i * 3 + 2] = 0;

        // UVs map particle index to texture coordinates
        uvs[i * 2 + 0] = (i % TEXTURE_WIDTH) / TEXTURE_WIDTH;
        uvs[i * 2 + 1] = Math.floor(i / TEXTURE_WIDTH) / TEXTURE_WIDTH;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));

    // Create ShaderMaterial for rendering particles
    const particleMaterial = new THREE.ShaderMaterial({
        uniforms: {
            uPositionTexture: { value: null },
            uVelocityTexture: { value: null },
            uPointSize: { value: 1.5 },
            uTime: { value: 0.0 },
            uAttractorPos: { value: attractorPos },
            uMembraneMinRadius: { value: MEMBRANE_MIN_RADIUS },
            uMembraneMaxRadius: { value: MEMBRANE_MAX_RADIUS }
        },
        vertexShader: particleVertexShader,
        fragmentShader: particleFragmentShader,
        // Optional: Add blending and transparency
        blending: THREE.AdditiveBlending, // Ensure material also uses additive blending
        transparent: true,
        depthWrite: false // Often needed for additive blending
    });

    particlePoints = new THREE.Points(geometry, particleMaterial);
    scene.add(particlePoints);
    console.log("Particle Geometry Initialized with ShaderMaterial");
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    // controls.handleResize(); // OrbitControls usually handles resize automatically
}

function animate() {
    requestAnimationFrame(animate);
    const deltaTime = clock.getDelta();
    const elapsedTime = clock.getElapsedTime();

    // --- Update WindowManager ---
    if (windowManager) {
        windowManager.update();
    }

    // --- Smoothly interpolate scene offset ---
    sceneOffset.x += (sceneOffsetTarget.x - sceneOffset.x) * 0.1;
    sceneOffset.y += (sceneOffsetTarget.y - sceneOffset.y) * 0.1;

    // --- Calculate Camera Rotation Delta ---
    const currentQuaternion = camera.quaternion.clone();
    const deltaQuaternion = currentQuaternion.clone().multiply(lastCameraQuaternion.clone().invert());
    cameraRotationAngle = 2 * Math.acos(THREE.MathUtils.clamp(deltaQuaternion.w, -1, 1)); // Clamp w
    if (cameraRotationAngle > 0.0001) { // Avoid issues near zero angle / normalization
        cameraRotationAxis.set(deltaQuaternion.x, deltaQuaternion.y, deltaQuaternion.z).normalize();
    } else {
        cameraRotationAxis.set(0, 1, 0); // Default axis if no rotation
        cameraRotationAngle = 0.0;
    }
    lastCameraQuaternion.copy(currentQuaternion);

    // --- Update Controls ---
    controls.update();

    // --- 1. Update GPGPU Simulation ---
    if (gpuCompute) {
        // Update dynamic uniforms
        velocityVariable.material.uniforms.uNoiseTime.value = elapsedTime * NOISE_SPEED;
        velocityVariable.material.uniforms.uCameraRotationAxis.value.copy(cameraRotationAxis);
        velocityVariable.material.uniforms.uCameraRotationAngle.value = cameraRotationAngle;

        // Update cross-window uniforms
        velocityVariable.material.uniforms.uSceneOffset.value.set(sceneOffset.x, sceneOffset.y);

        // Update this window's center
        const thisWindow = windowManager ? windowManager.getThisWindow() : null;
        if (thisWindow) {
            velocityVariable.material.uniforms.uThisWindowCenter.value.set(
                thisWindow.center.x,
                thisWindow.center.y
            );
        }

        // Update other window centers
        for (let i = 0; i < MAX_OTHER_WINDOWS; i++) {
            const centerUniform = velocityVariable.material.uniforms[`uOtherWindow${i}Center`];
            const activeUniform = velocityVariable.material.uniforms[`uOtherWindow${i}Active`];
            if (otherWindowCenters[i].active) {
                centerUniform.value.set(otherWindowCenters[i].x, otherWindowCenters[i].y);
                activeUniform.value = 1.0;
            } else {
                activeUniform.value = 0.0;
            }
        }

        gpuCompute.compute();
    }

    // --- 2. Update Particle Position for Screen-Space Alignment ---
    if (particlePoints) {
        // Apply scene offset so particles appear fixed relative to screen coordinates
        // X offset moves particles left when window moves right (so they stay on screen)
        // Y offset: screen Y increases downward, world Y increases upward
        particlePoints.position.set(sceneOffset.x, sceneOffset.y, 0);
    }

    // --- 3. Update Tendrils ---
    if (tendrilPoints && windowManager) {
        updateTendrils(elapsedTime);
    }

    // --- 4. Render Particles ---
    if (particlePoints && gpuCompute) {
        const material = particlePoints.material;
        // IMPORTANT: Use the *updated* textures for rendering
        material.uniforms.uPositionTexture.value = gpuCompute.getCurrentRenderTarget(positionVariable).texture;
        material.uniforms.uVelocityTexture.value = gpuCompute.getCurrentRenderTarget(velocityVariable).texture;
        material.uniforms.uTime.value = elapsedTime;
    }

    renderer.render(scene, camera);
}

/**
 * Update the other window centers array from WindowManager data
 */
function updateOtherWindowUniforms(otherWindows) {
    // Reset all windows to inactive
    for (let i = 0; i < MAX_OTHER_WINDOWS; i++) {
        otherWindowCenters[i].active = false;
    }

    // Set active windows (up to MAX_OTHER_WINDOWS)
    const count = Math.min(otherWindows.length, MAX_OTHER_WINDOWS);
    for (let i = 0; i < count; i++) {
        const win = otherWindows[i];
        otherWindowCenters[i].x = win.center.x;
        otherWindowCenters[i].y = win.center.y;
        otherWindowCenters[i].active = true;
    }

    // Update tendril targets
    updateTendrilTargets(otherWindows);
}

/**
 * Initialize the tendril particle system
 */
function initTendrils() {
    const totalParticles = TENDRIL_PARTICLE_COUNT * TENDRIL_MAX_CONNECTIONS;

    tendrilGeometry = new THREE.BufferGeometry();

    // Attributes: position, age (progress along tendril), connectionIndex, randomSeed
    const positions = new Float32Array(totalParticles * 3);
    const ages = new Float32Array(totalParticles);
    const connectionIndices = new Float32Array(totalParticles);
    const randomSeeds = new Float32Array(totalParticles);

    for (let c = 0; c < TENDRIL_MAX_CONNECTIONS; c++) {
        for (let i = 0; i < TENDRIL_PARTICLE_COUNT; i++) {
            const idx = c * TENDRIL_PARTICLE_COUNT + i;

            // Initial positions at origin (will be updated by shader/CPU)
            positions[idx * 3] = 0;
            positions[idx * 3 + 1] = 0;
            positions[idx * 3 + 2] = 0;

            // Age represents position along tendril (0 = start, 1 = end)
            ages[idx] = i / TENDRIL_PARTICLE_COUNT;

            // Which connection this particle belongs to
            connectionIndices[idx] = c;

            // Random seed for wave variation
            randomSeeds[idx] = Math.random();
        }
    }

    tendrilGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    tendrilGeometry.setAttribute('age', new THREE.BufferAttribute(ages, 1));
    tendrilGeometry.setAttribute('connectionIndex', new THREE.BufferAttribute(connectionIndices, 1));
    tendrilGeometry.setAttribute('randomSeed', new THREE.BufferAttribute(randomSeeds, 1));

    // Tendril shader material
    const tendrilVertexShader = `
        attribute float age;
        attribute float connectionIndex;
        attribute float randomSeed;

        uniform float uTime;
        uniform vec3 uThisCenter;
        uniform vec3 uTargetCenters[4];
        uniform float uTargetActive[4];

        varying float vAlpha;
        varying vec3 vColor;
        varying float vWaveIntensity;

        void main() {
            int connIdx = int(connectionIndex);

            // Check if this connection is active
            float isActive = 0.0;
            vec3 targetCenter = vec3(0.0);

            // Manual array indexing (GLSL ES limitations)
            if (connIdx == 0) {
                isActive = uTargetActive[0];
                targetCenter = uTargetCenters[0];
            } else if (connIdx == 1) {
                isActive = uTargetActive[1];
                targetCenter = uTargetCenters[1];
            } else if (connIdx == 2) {
                isActive = uTargetActive[2];
                targetCenter = uTargetCenters[2];
            } else if (connIdx == 3) {
                isActive = uTargetActive[3];
                targetCenter = uTargetCenters[3];
            }

            if (isActive < 0.5) {
                // Hide inactive particles
                gl_Position = vec4(0.0, 0.0, -1000.0, 1.0);
                gl_PointSize = 0.0;
                vAlpha = 0.0;
                return;
            }

            // Interpolate position along the tendril path
            vec3 startPos = uThisCenter;
            vec3 endPos = targetCenter;
            vec3 direction = endPos - startPos;
            float distance = length(direction);

            // Animated progress along tendril (flowing effect)
            float flowSpeed = 0.3;
            float animatedAge = fract(age + uTime * flowSpeed);

            // Base position along the line
            vec3 pos = mix(startPos, endPos, animatedAge);

            // Add wave motion perpendicular to the connection
            vec3 perpendicular = normalize(cross(direction, vec3(0.0, 0.0, 1.0)));
            if (length(perpendicular) < 0.1) {
                perpendicular = normalize(cross(direction, vec3(0.0, 1.0, 0.0)));
            }

            // Wave amplitude strongest in middle, zero at endpoints
            float waveEnvelope = sin(animatedAge * 3.14159);
            waveEnvelope = pow(waveEnvelope, 0.7); // Broader envelope

            // Multiple wave frequencies for organic, flowing look
            float wave1 = sin(animatedAge * 25.0 + uTime * 4.0 + randomSeed * 6.28) * 20.0;
            float wave2 = sin(animatedAge * 40.0 - uTime * 3.0 + randomSeed * 3.14) * 12.0;
            float wave3 = sin(animatedAge * 12.0 + uTime * 2.0) * 25.0;
            float wave4 = sin(animatedAge * 60.0 + uTime * 5.0 + randomSeed * 2.0) * 8.0;

            float totalWave = (wave1 + wave2 + wave3 + wave4) * waveEnvelope;
            vWaveIntensity = abs(totalWave) / 50.0;

            // Also add some Z variation for depth
            float zWave = sin(animatedAge * 18.0 + uTime * 3.0 + randomSeed * 4.0) * 15.0 * waveEnvelope;

            pos += perpendicular * totalWave;
            pos.z += zWave;

            // Transform to view space
            vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
            gl_Position = projectionMatrix * mvPosition;

            // Size based on wave envelope and position
            float sizeFromWave = 1.0 + vWaveIntensity * 0.5;
            gl_PointSize = (2.0 + waveEnvelope * 1.5) * sizeFromWave * (300.0 / -mvPosition.z);

            // Alpha: fade at endpoints, based on distance between windows
            float distanceFade = smoothstep(1200.0, 300.0, distance);
            vAlpha = waveEnvelope * 0.8 * distanceFade;

            // Dynamic color gradient - flowing rainbow effect
            float colorPhase = animatedAge + uTime * 0.2;
            vec3 colorStart = vec3(0.0, 0.9, 1.0);    // Bright cyan
            vec3 colorMid = vec3(0.8, 0.3, 1.0);      // Purple
            vec3 colorEnd = vec3(1.0, 0.4, 0.6);      // Pink

            // Three-stage color gradient
            if (colorPhase < 0.5) {
                vColor = mix(colorStart, colorMid, colorPhase * 2.0);
            } else {
                vColor = mix(colorMid, colorEnd, (colorPhase - 0.5) * 2.0);
            }

            // Brighten based on wave intensity
            vColor *= (1.0 + vWaveIntensity * 0.5);
        }
    `;

    const tendrilFragmentShader = `
        precision highp float;

        varying float vAlpha;
        varying vec3 vColor;
        varying float vWaveIntensity;

        void main() {
            if (vAlpha < 0.01) discard;

            // Soft circular particle with glow
            vec2 center = gl_PointCoord - vec2(0.5);
            float dist = length(center);

            // Core and glow
            float core = 1.0 - smoothstep(0.0, 0.3, dist);
            float glow = exp(-dist * 3.0) * 0.6;
            float alpha = (core + glow) * vAlpha;

            // Add slight color variation based on wave intensity
            vec3 finalColor = vColor + vec3(vWaveIntensity * 0.3);

            gl_FragColor = vec4(finalColor, alpha);
        }
    `;

    tendrilMaterial = new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0.0 },
            uThisCenter: { value: new THREE.Vector3(0, 0, 0) },
            uTargetCenters: { value: [
                new THREE.Vector3(0, 0, 0),
                new THREE.Vector3(0, 0, 0),
                new THREE.Vector3(0, 0, 0),
                new THREE.Vector3(0, 0, 0)
            ]},
            uTargetActive: { value: [0.0, 0.0, 0.0, 0.0] }
        },
        vertexShader: tendrilVertexShader,
        fragmentShader: tendrilFragmentShader,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false
    });

    tendrilPoints = new THREE.Points(tendrilGeometry, tendrilMaterial);
    scene.add(tendrilPoints);

    console.log("Tendril system initialized");
}

/**
 * Update tendril target positions from other windows
 */
function updateTendrilTargets(otherWindows) {
    if (!tendrilMaterial) return;

    const targets = tendrilMaterial.uniforms.uTargetCenters.value;
    const active = tendrilMaterial.uniforms.uTargetActive.value;

    // Reset all to inactive
    for (let i = 0; i < TENDRIL_MAX_CONNECTIONS; i++) {
        active[i] = 0.0;
    }

    // Set active targets
    const count = Math.min(otherWindows.length, TENDRIL_MAX_CONNECTIONS);
    for (let i = 0; i < count; i++) {
        const win = otherWindows[i];
        // Convert screen coordinates to world coordinates
        // Screen: origin top-left, Y down
        // World: origin center, Y up
        // Other window center in world coords = (-screenCenterX, screenCenterY)
        // But we also need to account for the fact that particlePoints has sceneOffset applied
        // So the relative position is what matters
        const worldX = -win.center.x;
        const worldY = win.center.y;
        targets[i].set(worldX, worldY, 0);
        active[i] = 1.0;
    }
}

/**
 * Update tendrils each frame
 */
function updateTendrils(elapsedTime) {
    if (!tendrilMaterial || !windowManager) return;

    // Update time
    tendrilMaterial.uniforms.uTime.value = elapsedTime;

    // Update this window's center in world space
    const thisWindow = windowManager.getThisWindow();
    if (thisWindow) {
        // This window's center in world coords
        const worldX = -thisWindow.center.x;
        const worldY = thisWindow.center.y;
        tendrilMaterial.uniforms.uThisCenter.value.set(worldX, worldY, 0);
    }

    // Update target centers (other windows may have moved)
    const otherWindows = windowManager.getOtherWindows();
    updateTendrilTargets(otherWindows);

    // Apply same position offset as main particle system
    tendrilPoints.position.set(sceneOffset.x, sceneOffset.y, 0);
}

// Initialize everything
init();
