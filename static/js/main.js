import * as THREE from 'three';
// Import the GPGPU utility
import { GPUComputationRenderer } from 'three/addons/misc/GPUComputationRenderer.js';
// Import WindowManager for multi-window coordination
import { WindowManager } from './WindowManager.js';
// Import post-processing modules
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

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

// Cloud Deformation (proximity effects)
uniform float uDeformationStrength;
uniform float uDeformationFalloff;

// Breathing Animation
uniform float uBreathingSpeed;
uniform float uBreathingAmplitude;
uniform float uBreathingPhaseOffset;

// Internal Currents/Vortex
uniform float uVortexStrength;
uniform float uVortexSpeed;
uniform float uInternalCurrentStrength;

// Micro-movements
uniform float uMicroMovementStrength;
uniform float uMicroMovementSpeed;

// Heartbeat Pulse - radial waves from nucleus
uniform float uHeartbeatSpeed;
uniform float uHeartbeatStrength;
uniform float uHeartbeatWaveCount;

// Membrane Ripple - surface waves
uniform float uMembraneRippleStrength;
uniform float uMembraneRippleSpeed;

// Fluid Dynamics
uniform float uSurfaceTensionStrength;
uniform float uViscosityBase;
uniform float uViscosityVariation;
uniform float uClusteringStrength;

// Layer System (6 layers max)
#define LAYER_COUNT 8
uniform float uLayerInnerRadius[LAYER_COUNT];
uniform float uLayerOuterRadius[LAYER_COUNT];
uniform float uLayerBehavior[LAYER_COUNT];     // 0=stiff, 1=fluid, 2=orbiting
uniform float uLayerOrbitSpeed[LAYER_COUNT];
uniform float uLayerFluidStrength[LAYER_COUNT];
uniform float uLayerStiffness[LAYER_COUNT];
uniform float uTime;

const float MIN_DIST_SQ = 0.01;
const float BEHAVIOR_STIFF = 0.0;
const float BEHAVIOR_FLUID = 1.0;
const float BEHAVIOR_ORBITING = 2.0;

${simplexNoise3d}

// Helper to get layer index from velocity.w
int getLayerIndex(float layerFloat) {
    return int(clamp(layerFloat, 0.0, float(LAYER_COUNT - 1)));
}

// Calculate orbiting force for a particle
vec3 calculateOrbitForce(vec3 pos, float orbitSpeed) {
    // Orbit around Y axis
    vec3 toCenter = -pos;
    toCenter.y = 0.0; // Only orbit in XZ plane
    float dist = length(toCenter);
    if (dist < 0.1) return vec3(0.0);

    // Tangent direction (perpendicular to radius in XZ plane)
    vec3 tangent = normalize(vec3(-pos.z, 0.0, pos.x));
    return tangent * orbitSpeed * dist * 0.1;
}

// Calculate layer boundary force (keeps particle in its layer)
vec3 calculateLayerBoundaryForce(vec3 pos, float innerR, float outerR, float stiffness) {
    float dist = length(pos);
    vec3 dir = normalize(pos);
    vec3 force = vec3(0.0);

    float boundaryStrength = 2.0 * (1.0 - stiffness * 0.5); // Stiffer layers have gentler boundaries

    if (dist < innerR) {
        // Push outward
        force = dir * (innerR - dist) * boundaryStrength;
    } else if (dist > outerR) {
        // Push inward
        force = -dir * (dist - outerR) * boundaryStrength;
    }

    return force;
}

// Apply layer-specific behavior modulation
float getLayerForceMultiplier(float behavior, float fluidStrength, float stiffness) {
    if (behavior < 0.5) {
        // Stiff: minimal force application
        return (1.0 - stiffness) * 0.3;
    } else if (behavior < 1.5) {
        // Fluid: full force with fluid strength multiplier
        return fluidStrength;
    } else {
        // Orbiting: moderate forces + orbit
        return fluidStrength * 0.7;
    }
}

// Function to calculate Curl Noise force (Optimized - reduced noise samples)
// Uses vector potential approach: F = curl(A) where A is derived from noise
vec3 calculateCurlNoiseForce(vec3 pos) {
    float eps = uNoiseEpsilon;
    float invEps2 = 1.0 / (2.0 * eps);

    // Offset vectors for vector potential components (creates divergence-free field)
    vec3 offset1 = vec3(13.7, 5.9, -4.1);
    vec3 offset2 = vec3(-8.3, 1.7, 9.5);

    // Sample noise for derivatives (6 samples total - optimized from 24+)
    // We compute partial derivatives of the vector potential A
    float Ax_yp = snoise(pos + vec3(0.0, eps, 0.0));
    float Ax_ym = snoise(pos - vec3(0.0, eps, 0.0));
    float Ax_zp = snoise(pos + vec3(0.0, 0.0, eps));
    float Ax_zm = snoise(pos - vec3(0.0, 0.0, eps));

    float Ay_xp = snoise(pos + offset1 + vec3(eps, 0.0, 0.0));
    float Ay_xm = snoise(pos + offset1 - vec3(eps, 0.0, 0.0));
    float Ay_zp = snoise(pos + offset1 + vec3(0.0, 0.0, eps));
    float Ay_zm = snoise(pos + offset1 - vec3(0.0, 0.0, eps));

    float Az_xp = snoise(pos + offset2 + vec3(eps, 0.0, 0.0));
    float Az_xm = snoise(pos + offset2 - vec3(eps, 0.0, 0.0));
    float Az_yp = snoise(pos + offset2 + vec3(0.0, eps, 0.0));
    float Az_ym = snoise(pos + offset2 - vec3(0.0, eps, 0.0));

    // Curl components: curl(A) = (dAz/dy - dAy/dz, dAx/dz - dAz/dx, dAy/dx - dAx/dy)
    float curlX = (Az_yp - Az_ym - Ay_zp + Ay_zm) * invEps2;
    float curlY = (Ax_zp - Ax_zm - Az_xp + Az_xm) * invEps2;
    float curlZ = (Ay_xp - Ay_xm - Ax_yp + Ax_ym) * invEps2;

    vec3 curlForce = vec3(curlX, curlY, curlZ);
    float len = length(curlForce);
    return (len > 0.001) ? (curlForce / len) * uNoiseStrength : vec3(0.0);
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

// Function to calculate breathing/pulsing force
vec3 calculateBreathingForce(vec3 pos, float time) {
    float dist = length(pos);
    vec3 dirFromOrigin = normalize(pos);

    // Multi-layered breathing for organic feel
    // Primary slow breath
    float primaryBreath = sin(time * uBreathingSpeed) * 0.6;
    // Secondary faster pulse
    float secondaryBreath = sin(time * uBreathingSpeed * 2.3 + 1.2) * 0.25;
    // Tertiary subtle flutter
    float tertiaryBreath = sin(time * uBreathingSpeed * 4.7 + 2.8) * 0.15;

    float breathCycle = primaryBreath + secondaryBreath + tertiaryBreath;

    // Breathing force varies by distance from center
    // Core particles move less, membrane particles move more (like a balloon)
    float distanceModulation = smoothstep(0.0, uMembraneMaxRadius * 0.8, dist);

    // Add slight phase variation based on position for organic wave-like expansion
    float phaseOffset = length(pos.xy) * uBreathingPhaseOffset;
    breathCycle = sin(time * uBreathingSpeed + phaseOffset) * 0.6 +
                  sin(time * uBreathingSpeed * 2.3 + 1.2 + phaseOffset * 0.7) * 0.25 +
                  sin(time * uBreathingSpeed * 4.7 + 2.8 + phaseOffset * 0.3) * 0.15;

    // Radial breathing force (positive = expand, negative = contract)
    vec3 breathForce = dirFromOrigin * breathCycle * uBreathingAmplitude * distanceModulation;

    return breathForce;
}

// Function to calculate heartbeat pulse - radial waves emanating from nucleus
// Optimized: loop unrolled for GPU performance
vec3 calculateHeartbeatPulse(vec3 pos, float time) {
    float dist = length(pos);
    vec3 dirFromOrigin = normalize(pos);
    float maxRadius = uMembraneMaxRadius * 1.2;
    float basePhase = time * uHeartbeatSpeed;

    // Wave 1 (phase offset 0)
    float waveRadius1 = mod(basePhase * 15.0, maxRadius);
    float distFromWave1 = abs(dist - waveRadius1);
    float wavePulse1 = exp(-distFromWave1 * distFromWave1 * 0.015625); // 1/64 = 8^2
    float attenuation1 = exp(-waveRadius1 * 0.02);

    // Wave 2 (phase offset 2.094)
    float waveRadius2 = mod((basePhase + 2.094) * 15.0, maxRadius);
    float distFromWave2 = abs(dist - waveRadius2);
    float wavePulse2 = exp(-distFromWave2 * distFromWave2 * 0.01); // 1/100 = 10^2
    float attenuation2 = exp(-waveRadius2 * 0.02);

    // Wave 3 (phase offset 4.188)
    float waveRadius3 = mod((basePhase + 4.188) * 15.0, maxRadius);
    float distFromWave3 = abs(dist - waveRadius3);
    float wavePulse3 = exp(-distFromWave3 * distFromWave3 * 0.00694); // 1/144 = 12^2
    float attenuation3 = exp(-waveRadius3 * 0.02);

    float pulseForce = wavePulse1 * attenuation1 + wavePulse2 * attenuation2 + wavePulse3 * attenuation3;

    return dirFromOrigin * pulseForce * uHeartbeatStrength;
}

// Function to calculate membrane ripple - surface waves on the outer membrane
vec3 calculateMembraneRipple(vec3 pos, float time) {
    float dist = length(pos);
    vec3 dirFromOrigin = normalize(pos);

    // Only affects particles near the membrane
    float membraneProximity = smoothstep(uMembraneMinRadius * 0.7, uMembraneMaxRadius, dist);
    membraneProximity *= smoothstep(uMembraneMaxRadius * 1.3, uMembraneMaxRadius, dist);

    if (membraneProximity < 0.01) return vec3(0.0);

    // Calculate angle in XY plane for wave propagation
    float angle = atan(pos.y, pos.x);

    // Multiple overlapping surface waves
    float ripple1 = sin(angle * 3.0 + time * uMembraneRippleSpeed * 1.0) * 0.4;
    float ripple2 = sin(angle * 5.0 - time * uMembraneRippleSpeed * 0.7 + 1.5) * 0.3;
    float ripple3 = sin(angle * 2.0 + time * uMembraneRippleSpeed * 1.3 + 3.0) * 0.3;

    // Vertical wave component (creates undulation)
    float verticalRipple = sin(pos.z * 0.3 + time * uMembraneRippleSpeed * 0.5) * 0.2;

    float totalRipple = (ripple1 + ripple2 + ripple3 + verticalRipple) * membraneProximity;

    // Ripple creates radial displacement
    return dirFromOrigin * totalRipple * uMembraneRippleStrength;
}

// Function to calculate internal currents and vortex fields
vec3 calculateInternalCurrents(vec3 pos, float time) {
    float dist = length(pos);
    vec3 currentForce = vec3(0.0);

    // --- Primary rotating vortex around Y axis ---
    // Creates a gentle spinning motion in the horizontal plane
    float vortexAngle = time * uVortexSpeed;
    // Tangential direction for vortex (perpendicular to radial in XZ plane)
    vec3 tangent = normalize(vec3(-pos.z, 0.0, pos.x));
    // Vortex strength varies by height and distance
    float heightFactor = 1.0 - abs(pos.y) / (uMembraneMaxRadius * 0.8);
    heightFactor = max(heightFactor, 0.0);
    float radialFactor = smoothstep(uRepulsionRadius, uMembraneMinRadius * 0.7, dist);
    radialFactor *= smoothstep(uMembraneMaxRadius, uMembraneMinRadius, dist);
    currentForce += tangent * uVortexStrength * heightFactor * radialFactor;

    // --- Secondary tilted vortex (creates more complex motion) ---
    vec3 tiltedAxis = normalize(vec3(0.3, 0.9, 0.2));
    vec3 radialFromTilted = pos - dot(pos, tiltedAxis) * tiltedAxis;
    vec3 tangent2 = normalize(cross(tiltedAxis, radialFromTilted));
    float dist2 = length(radialFromTilted);
    float tiltedFactor = smoothstep(5.0, 15.0, dist2) * smoothstep(35.0, 20.0, dist2);
    currentForce += tangent2 * uVortexStrength * 0.4 * tiltedFactor * sin(time * uVortexSpeed * 0.7);

    // --- Layered internal currents (flowing streams within the cloud) ---
    // Use noise-based vector field for organic flow
    vec3 flowCoord = pos * 0.08 + time * 0.15;

    // Three orthogonal noise samples for 3D flow direction
    float flowX = snoise(flowCoord + vec3(100.0, 0.0, 0.0));
    float flowY = snoise(flowCoord + vec3(0.0, 100.0, 0.0));
    float flowZ = snoise(flowCoord + vec3(0.0, 0.0, 100.0));

    vec3 internalFlow = normalize(vec3(flowX, flowY, flowZ)) * uInternalCurrentStrength;

    // Flow strength varies - stronger in mid-region, weaker at core and edges
    float flowModulation = smoothstep(uRepulsionRadius * 1.5, uOrbitRadius * 1.5, dist);
    flowModulation *= smoothstep(uMembraneMaxRadius, uMembraneMinRadius * 0.8, dist);
    internalFlow *= flowModulation;

    // --- Convection-like rising/falling currents ---
    // Particles below center tend to rise, above tend to fall
    float convectionStrength = 0.03;
    float verticalBias = -pos.y / uMembraneMaxRadius; // Negative when above, positive when below
    currentForce.y += verticalBias * convectionStrength * smoothstep(0.0, uMembraneMinRadius * 0.5, dist);

    return currentForce + internalFlow;
}

// Function to calculate per-particle micro-movements (unique trembling)
vec3 calculateMicroMovements(vec3 pos, vec2 particleUV, float time) {
    // Use UV as unique seed for each particle - creates unique movement patterns
    float uniqueSeed1 = fract(sin(dot(particleUV, vec2(12.9898, 78.233))) * 43758.5453);
    float uniqueSeed2 = fract(sin(dot(particleUV, vec2(93.9898, 67.345))) * 23421.6312);
    float uniqueSeed3 = fract(sin(dot(particleUV, vec2(45.1234, 89.567))) * 65432.1234);

    float t = time * uMicroMovementSpeed;

    // Multi-frequency trembling unique to each particle
    // Layer 1: Slow drift
    float drift1X = sin(t * 0.7 + uniqueSeed1 * 6.28) * 0.4;
    float drift1Y = sin(t * 0.6 + uniqueSeed2 * 6.28) * 0.4;
    float drift1Z = sin(t * 0.8 + uniqueSeed3 * 6.28) * 0.4;

    // Layer 2: Medium vibration
    float vib2X = sin(t * 2.3 + uniqueSeed2 * 12.56) * 0.3;
    float vib2Y = sin(t * 2.1 + uniqueSeed3 * 12.56) * 0.3;
    float vib2Z = sin(t * 2.5 + uniqueSeed1 * 12.56) * 0.3;

    // Layer 3: Fast jitter
    float jit3X = sin(t * 5.7 + uniqueSeed3 * 25.12) * 0.2;
    float jit3Y = sin(t * 6.1 + uniqueSeed1 * 25.12) * 0.2;
    float jit3Z = sin(t * 5.3 + uniqueSeed2 * 25.12) * 0.2;

    // Layer 4: Very fast flutter
    float flut4X = sin(t * 12.3 + uniqueSeed1 * 50.0) * 0.1;
    float flut4Y = sin(t * 11.7 + uniqueSeed2 * 50.0) * 0.1;
    float flut4Z = sin(t * 13.1 + uniqueSeed3 * 50.0) * 0.1;

    vec3 microMove = vec3(
        drift1X + vib2X + jit3X + flut4X,
        drift1Y + vib2Y + jit3Y + flut4Y,
        drift1Z + vib2Z + jit3Z + flut4Z
    ) * uMicroMovementStrength;

    return microMove;
}

// Function to calculate cloud deformation towards other windows
vec3 calculateCloudDeformation(vec3 pos) {
    vec3 deformForce = vec3(0.0);
    float dist = length(pos);

    // Only particles near the membrane edge are affected by deformation
    float edgeFactor = smoothstep(uMembraneMinRadius * 0.6, uMembraneMaxRadius, dist);

    if (edgeFactor < 0.01) return deformForce;

    // Direction from origin to particle (normalized)
    vec3 particleDir = normalize(pos);

    // Check each active window and calculate deformation towards it
    // Window 0
    if (uOtherWindow0Active > 0.5) {
        vec2 windowDir2D = normalize(uOtherWindow0Center);
        vec3 windowDir = normalize(vec3(windowDir2D.x, -windowDir2D.y, 0.0));
        float windowDist = length(uOtherWindow0Center);

        // How aligned is this particle's direction with the window direction?
        float alignment = max(dot(particleDir, windowDir), 0.0);
        alignment = pow(alignment, 2.0); // Sharpen the alignment effect

        // Proximity factor - closer windows cause more deformation
        float proximityFactor = smoothstep(uDeformationFalloff, 0.0, windowDist);

        // Pull particles towards the window direction
        deformForce += windowDir * alignment * edgeFactor * proximityFactor * uDeformationStrength;
    }

    // Window 1
    if (uOtherWindow1Active > 0.5) {
        vec2 windowDir2D = normalize(uOtherWindow1Center);
        vec3 windowDir = normalize(vec3(windowDir2D.x, -windowDir2D.y, 0.0));
        float windowDist = length(uOtherWindow1Center);
        float alignment = max(dot(particleDir, windowDir), 0.0);
        alignment = pow(alignment, 2.0);
        float proximityFactor = smoothstep(uDeformationFalloff, 0.0, windowDist);
        deformForce += windowDir * alignment * edgeFactor * proximityFactor * uDeformationStrength;
    }

    // Window 2
    if (uOtherWindow2Active > 0.5) {
        vec2 windowDir2D = normalize(uOtherWindow2Center);
        vec3 windowDir = normalize(vec3(windowDir2D.x, -windowDir2D.y, 0.0));
        float windowDist = length(uOtherWindow2Center);
        float alignment = max(dot(particleDir, windowDir), 0.0);
        alignment = pow(alignment, 2.0);
        float proximityFactor = smoothstep(uDeformationFalloff, 0.0, windowDist);
        deformForce += windowDir * alignment * edgeFactor * proximityFactor * uDeformationStrength;
    }

    // Window 3
    if (uOtherWindow3Active > 0.5) {
        vec2 windowDir2D = normalize(uOtherWindow3Center);
        vec3 windowDir = normalize(vec3(windowDir2D.x, -windowDir2D.y, 0.0));
        float windowDist = length(uOtherWindow3Center);
        float alignment = max(dot(particleDir, windowDir), 0.0);
        alignment = pow(alignment, 2.0);
        float proximityFactor = smoothstep(uDeformationFalloff, 0.0, windowDist);
        deformForce += windowDir * alignment * edgeFactor * proximityFactor * uDeformationStrength;
    }

    return deformForce;
}

// Function to calculate surface tension force (keeps particles at membrane)
vec3 calculateSurfaceTension(vec3 pos) {
    float dist = length(pos);
    vec3 dirFromOrigin = normalize(pos);

    // Surface tension acts on particles near the membrane edge
    // Pulls them towards an ideal surface distance
    float idealSurfaceDist = (uMembraneMinRadius + uMembraneMaxRadius) * 0.5;
    float surfaceZone = smoothstep(uMembraneMinRadius * 0.7, uMembraneMinRadius, dist) *
                        smoothstep(uMembraneMaxRadius * 1.2, uMembraneMaxRadius, dist);

    // Force towards the ideal surface
    float distFromIdeal = dist - idealSurfaceDist;
    vec3 tensionForce = -dirFromOrigin * distFromIdeal * uSurfaceTensionStrength * surfaceZone;

    // Add tangential cohesion (particles at surface stick together laterally)
    // This is approximated by reducing radial velocity component at the surface
    return tensionForce;
}

// Function to calculate viscosity-based damping (varies by region)
float calculateLocalViscosity(vec3 pos) {
    float dist = length(pos);

    // Core has higher viscosity (more damping)
    float coreFactor = smoothstep(uOrbitRadius, uRepulsionRadius, dist);

    // Membrane zone has medium viscosity
    float membraneFactor = smoothstep(uMembraneMinRadius * 0.8, uMembraneMaxRadius, dist);

    // Combine: high viscosity at core, lower in cytoplasm, medium at membrane
    float viscosity = uViscosityBase;
    viscosity += coreFactor * uViscosityVariation * 0.5;         // Core boost
    viscosity -= (1.0 - membraneFactor) * uViscosityVariation * 0.3; // Cytoplasm reduction

    return clamp(viscosity, 0.9, 0.999);
}

// Function to calculate clustering force (particles form small groups)
vec3 calculateClusteringForce(vec3 pos, vec2 particleUV, float time) {
    // Create a noise-based clustering field
    // Particles are attracted to local cluster centers defined by noise

    // Cluster centers move slowly over time
    vec3 clusterCoord = pos * 0.15 + time * 0.05;

    // Sample noise to find cluster center offset
    float clusterX = snoise(clusterCoord + vec3(50.0, 0.0, 0.0));
    float clusterY = snoise(clusterCoord + vec3(0.0, 50.0, 0.0));
    float clusterZ = snoise(clusterCoord + vec3(0.0, 0.0, 50.0));

    vec3 clusterOffset = vec3(clusterX, clusterY, clusterZ) * 5.0;

    // Force towards cluster center
    vec3 toCluster = clusterOffset; // Relative to current position
    float clusterDist = length(toCluster);

    // Only cluster within a certain range
    float clusterInfluence = smoothstep(8.0, 2.0, clusterDist);

    vec3 clusterForce = normalize(toCluster + vec3(0.001)) * clusterInfluence * uClusteringStrength;

    // Modulate by distance from center (less clustering at core and edge)
    float dist = length(pos);
    float zoneModulation = smoothstep(uRepulsionRadius, uOrbitRadius, dist) *
                           smoothstep(uMembraneMaxRadius, uMembraneMinRadius * 0.9, dist);

    return clusterForce * zoneModulation;
}

void main() {
    // Read previous state
    vec4 previousVelocityData = texture2D(uVelocityTexture, vUv);
    vec3 particleVelocity = previousVelocityData.xyz;
    float layerFloat = previousVelocityData.w; // Layer index stored in velocity.w

    vec4 previousPositionData = texture2D(uPositionTexture, vUv);
    vec3 particlePosition = previousPositionData.xyz;

    // Get layer properties
    int layerIdx = getLayerIndex(layerFloat);
    float layerInnerR = uLayerInnerRadius[layerIdx];
    float layerOuterR = uLayerOuterRadius[layerIdx];
    float layerBehavior = uLayerBehavior[layerIdx];
    float layerOrbitSpeed = uLayerOrbitSpeed[layerIdx];
    float layerFluidStrength = uLayerFluidStrength[layerIdx];
    float layerStiffness = uLayerStiffness[layerIdx];

    // Calculate force multiplier based on layer behavior
    float forceMultiplier = getLayerForceMultiplier(layerBehavior, layerFluidStrength, layerStiffness);

    // Calculate distance/direction to attractor
    vec3 dirToAttractor = uAttractorPos - particlePosition;
    float distSq = max(dot(particlePosition, particlePosition), MIN_DIST_SQ);
    float dist = sqrt(distSq);
    vec3 normalizedDirToAttractor = normalize(dirToAttractor);
    vec3 normalizedDirFromOrigin = normalize(particlePosition);

    // --- Layer Boundary Force (replaces global membrane) ---
    vec3 layerBoundaryForce = calculateLayerBoundaryForce(particlePosition, layerInnerR, layerOuterR, layerStiffness);

    // --- Orbit Force (for orbiting layers) ---
    vec3 orbitForce = vec3(0.0);
    if (layerBehavior > 1.5) { // Orbiting behavior
        orbitForce = calculateOrbitForce(particlePosition, layerOrbitSpeed);
    }

    // --- Base Force (gentle center attraction) ---
    vec3 baseForce = normalizedDirToAttractor * uAttractorStrength * 0.1 / max(distSq, 1.0);

    // --- Outward Push Force (scaled by layer) ---
    float pushModulation = smoothstep(layerInnerR, layerOuterR, dist);
    vec3 outwardForce = normalizedDirFromOrigin * uOutwardPushStrength * pushModulation * forceMultiplier;

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

    // --- Coherent Wave Force ---
    vec3 waveForce = calculateWaveForce(particlePosition, uNoiseTime);

    // --- Cross-Window Attraction Force ---
    vec3 crossWindowForce = calculateCrossWindowForce(particlePosition);

    // --- Breathing Force ---
    vec3 breathingForce = calculateBreathingForce(particlePosition, uNoiseTime);

    // --- Heartbeat Pulse (radial waves from nucleus) ---
    vec3 heartbeatForce = calculateHeartbeatPulse(particlePosition, uNoiseTime);

    // --- Membrane Ripple (surface waves) ---
    vec3 membraneRippleForce = calculateMembraneRipple(particlePosition, uNoiseTime);

    // --- Internal Currents and Vortex ---
    vec3 internalCurrentsForce = calculateInternalCurrents(particlePosition, uNoiseTime);

    // --- Per-Particle Micro-Movements ---
    vec3 microMovementForce = calculateMicroMovements(particlePosition, vUv, uNoiseTime);

    // --- Cloud Deformation (proximity bulging towards other windows) ---
    vec3 deformationForce = calculateCloudDeformation(particlePosition);

    // --- Fluid Dynamics Forces ---
    vec3 surfaceTensionForce = calculateSurfaceTension(particlePosition);
    vec3 clusteringForce = calculateClusteringForce(particlePosition, vUv, uNoiseTime);
    float localViscosity = calculateLocalViscosity(particlePosition);

    // --- Modify Forces within Membrane Zone ---
    // Reduce Wave force strength, increase Membrane Curl and Jitter strengths within the membrane zone
    float membraneWaveReductionFactor = 1.0 - membraneZoneFactor * 0.9; // Reduce wave by up to 90%
    float membraneCurlBoostFactor = 1.0 + membraneZoneFactor * 3.0; // Boost curl by up to 3x
    float membraneJitterBoostFactor = 1.0 + membraneZoneFactor * 2.0; // Boost jitter by up to 2x

    vec3 modifiedWaveForce = waveForce * membraneWaveReductionFactor;
    vec3 modifiedMembraneCurlForce = membraneCurlNoiseForce * membraneCurlBoostFactor;
    vec3 modifiedAmbientJitterForce = ambientJitterForce * membraneJitterBoostFactor;

    // --- Combine Forces (Layer-aware) ---
    // Scale noise/turbulence forces by layer's force multiplier
    vec3 scaledCurlNoise = curlNoiseForce * forceMultiplier;
    vec3 scaledDirectNoise = directNoiseForce * forceMultiplier;
    vec3 scaledMembraneCurl = modifiedMembraneCurlForce * forceMultiplier;
    vec3 scaledJitter = modifiedAmbientJitterForce * forceMultiplier;
    vec3 scaledWave = modifiedWaveForce * uWaveForceStrength * forceMultiplier;
    vec3 scaledBreathing = breathingForce * forceMultiplier;
    vec3 scaledHeartbeat = heartbeatForce * forceMultiplier;
    vec3 scaledRipple = membraneRippleForce * forceMultiplier;
    vec3 scaledCurrents = internalCurrentsForce * forceMultiplier;
    vec3 scaledMicro = microMovementForce * forceMultiplier;

    vec3 totalForce = baseForce + outwardForce +                           // Core structure
                      layerBoundaryForce +                                 // Layer containment (replaces membrane)
                      orbitForce +                                         // Orbital motion for orbiting layers
                      scaledCurlNoise + scaledDirectNoise +                // General noise (scaled by layer)
                      scaledMembraneCurl + scaledJitter +                  // Membrane noise (scaled)
                      scaledWave +                                         // Wave Force (scaled)
                      crossWindowForce +                                   // Cross-Window attraction
                      scaledBreathing +                                    // Breathing animation (scaled)
                      scaledHeartbeat +                                    // Heartbeat pulse (radial waves)
                      scaledRipple +                                       // Membrane ripples (surface waves)
                      scaledCurrents +                                     // Internal currents (scaled)
                      scaledMicro +                                        // Per-particle micro-movements (scaled)
                      deformationForce +                                   // Cloud deformation towards other windows
                      surfaceTensionForce +                                // Surface tension at membrane
                      clusteringForce;                                     // Particle clustering

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
    // Use local viscosity for position-dependent damping (fluid dynamics)
    particleVelocity *= localViscosity; // Apply local viscosity as damping

    // Preserve layer index in w component
    gl_FragColor = vec4(particleVelocity, layerFloat);
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

// Lifecycle uniforms
uniform float uMaxLifetime;
uniform float uRespawnRadius;
uniform float uTime;

// Layer system uniforms for respawning
#define LAYER_COUNT 8
uniform float uLayerInnerRadius[LAYER_COUNT];
uniform float uLayerOuterRadius[LAYER_COUNT];

${randomShaderFunc}

// Respawn within a specific layer shell
vec3 randomShellPoint(vec2 seed, float time, float innerR, float outerR) {
    // Random direction (uniform on sphere)
    float u = random(seed + vec2(time * 0.1, 0.0)) * 2.0 - 1.0;
    float theta = random(seed + vec2(0.0, time * 0.1)) * 6.28318530718;

    // Random radius within shell (cube root for uniform volume distribution)
    float rnd = random(seed + vec2(time * 0.05, time * 0.05));
    float r3Inner = innerR * innerR * innerR;
    float r3Outer = outerR * outerR * outerR;
    float r = pow(rnd * (r3Outer - r3Inner) + r3Inner, 1.0 / 3.0);

    float sqrtOneMinusUSq = sqrt(1.0 - u * u);
    return vec3(
        sqrtOneMinusUSq * cos(theta),
        sqrtOneMinusUSq * sin(theta),
        u
    ) * r;
}

int getLayerIndexFromFloat(float layerFloat) {
    return int(clamp(layerFloat, 0.0, float(LAYER_COUNT - 1)));
}

void main() {
    vec4 positionData = texture2D(uPositionTexture, vUv);
    vec3 particlePosition = positionData.xyz;
    float particleAge = positionData.w;

    vec4 velocityData = texture2D(uVelocityTexture, vUv);
    vec3 particleVelocity = velocityData.xyz;
    float layerFloat = velocityData.w; // Layer index stored in velocity.w

    // Integrate velocity
    particlePosition += particleVelocity * 0.1;
    particleAge += 0.016;

    // Particle Lifecycle - respawn when particle exceeds max lifetime
    // Add some randomness to lifetime so particles don't all respawn at once
    float lifetimeVariation = random(vUv) * 5.0; // 0-5 seconds variation
    float effectiveMaxLifetime = uMaxLifetime + lifetimeVariation;

    if (particleAge > effectiveMaxLifetime) {
        // Respawn within the particle's assigned layer
        int layerIdx = getLayerIndexFromFloat(layerFloat);
        float innerR = uLayerInnerRadius[layerIdx];
        float outerR = uLayerOuterRadius[layerIdx];

        particlePosition = randomShellPoint(vUv, uTime, innerR, outerR);
        particleAge = 0.0; // Reset age
    }

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
// Lifecycle uniforms
uniform float uMaxLifetime;
uniform float uFadeInTime;
uniform float uFadeOutTime;
// Lighting uniforms
uniform vec3 uLightDirection;
uniform float uRimLightStrength;
uniform float uAmbientOcclusionStrength;
// Quality/LOD
uniform float uQualityMultiplier;

// Layer system uniforms for visual differentiation
#define LAYER_COUNT 8
uniform vec3 uLayerBaseColor[LAYER_COUNT];
uniform vec3 uLayerEdgeColor[LAYER_COUNT];
uniform float uLayerOpacity[LAYER_COUNT];
uniform float uLayerSizeMin[LAYER_COUNT];
uniform float uLayerSizeMax[LAYER_COUNT];
uniform float uLayerInnerRadius[LAYER_COUNT];
uniform float uLayerOuterRadius[LAYER_COUNT];

varying float vDistFromCenter;
varying float vSpeed;
varying float vAge;
varying vec3 vColor;
varying float vDepthFade;
varying float vEdgeFade;
varying float vAgeFade;
varying float vRimLight;
varying float vAmbientOcclusion;
varying float vSubsurfaceScatter;
varying float vLayerOpacity;

// Simple hash for random variation per particle
float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

int getLayerIdx(float layerFloat) {
    return int(clamp(layerFloat, 0.0, float(LAYER_COUNT - 1)));
}

void main() {
    vec4 positionData = texture2D(uPositionTexture, uv);
    vec3 particlePosition = positionData.xyz;
    float age = positionData.w;

    vec4 velocityData = texture2D(uVelocityTexture, uv);
    vec3 velocity = velocityData.xyz;
    float layerFloat = velocityData.w; // Layer index stored in velocity.w
    float speed = length(velocity);

    // Get layer index
    int layerIdx = getLayerIdx(layerFloat);

    // Calculate distance from attractor/center
    float distFromCenter = length(particlePosition - uAttractorPos);

    // Random variation per particle (using UV as seed)
    float randomSeed = hash(uv);
    float randomSize = 0.7 + randomSeed * 0.6;        // Size varies 0.7 to 1.3
    float randomBrightness = 0.8 + randomSeed * 0.2;  // Brightness varies 0.8 to 1.0

    // Pass to fragment shader
    vDistFromCenter = distFromCenter;
    vSpeed = speed;
    vAge = age;
    vLayerOpacity = uLayerOpacity[layerIdx];

    // --- Edge Fade for Soft Cloud Boundaries ---
    // Particles fade out as they approach the membrane edge
    // Start fading at 70% of membrane radius, fully faded at 100%
    float edgeFadeStart = uMembraneMinRadius * 0.85;
    float edgeFadeEnd = uMembraneMaxRadius * 1.1;
    vEdgeFade = 1.0 - smoothstep(edgeFadeStart, edgeFadeEnd, distFromCenter);
    // Add random variation to edge fade for natural fuzzy look
    float edgeRandomness = hash(uv + vec2(0.5, 0.3)) * 0.3;
    vEdgeFade = clamp(vEdgeFade + edgeRandomness * (1.0 - vEdgeFade) * 0.5, 0.0, 1.0);

    // --- Age-based Fade (Lifecycle) ---
    // Fade in at birth, fade out near death
    // Add randomness to effective max lifetime per particle
    float lifetimeVariation = hash(uv + vec2(0.7, 0.9)) * 5.0;
    float effectiveMaxLifetime = uMaxLifetime + lifetimeVariation;
    float fadeInEnd = uFadeInTime;
    float fadeOutStart = effectiveMaxLifetime - uFadeOutTime;

    // Fade in: 0 at age=0, 1 at age=fadeInEnd
    float fadeIn = smoothstep(0.0, fadeInEnd, age);
    // Fade out: 1 before fadeOutStart, 0 at effectiveMaxLifetime
    float fadeOut = 1.0 - smoothstep(fadeOutStart, effectiveMaxLifetime, age);

    vAgeFade = fadeIn * fadeOut;

    // --- Lighting Calculations ---
    vec3 particleNormal = normalize(particlePosition); // Normal pointing outward from cloud center

    // Rim lighting - particles at edge lit from behind
    float rimDot = 1.0 - abs(dot(particleNormal, normalize(cameraPosition - particlePosition)));
    vRimLight = pow(rimDot, 2.0) * uRimLightStrength * vEdgeFade;

    // Ambient Occlusion - core is darker due to particle density
    float normalizedDist = distFromCenter / uMembraneMaxRadius;
    vAmbientOcclusion = smoothstep(0.0, 0.5, normalizedDist); // Darker at core
    vAmbientOcclusion = mix(1.0 - uAmbientOcclusionStrength, 1.0, vAmbientOcclusion);

    // Subsurface Scattering - light penetrating the cloud
    // Stronger for particles on the side facing the light
    float lightDot = dot(particleNormal, uLightDirection);
    float backLight = max(-lightDot, 0.0); // Light coming through from behind
    float frontLight = max(lightDot, 0.0) * 0.3; // Direct light (less intense)
    vSubsurfaceScatter = (backLight * 0.7 + frontLight) * (1.0 - normalizedDist * 0.5);

    // --- Layer-specific Color Calculation ---
    // Get layer colors
    vec3 layerBaseColor = uLayerBaseColor[layerIdx];
    vec3 layerEdgeColor = uLayerEdgeColor[layerIdx];
    float layerInnerR = uLayerInnerRadius[layerIdx];
    float layerOuterR = uLayerOuterRadius[layerIdx];

    // Calculate position within layer (0 = inner edge, 1 = outer edge)
    float layerPosition = smoothstep(layerInnerR, layerOuterR, distFromCenter);

    // Interpolate between base and edge color based on position in layer
    vec3 layerColor = mix(layerBaseColor, layerEdgeColor, layerPosition);
    
    // === ENHANCED MEMBRANE BOUNDARY EFFECTS ===
    // Add subtle glow at layer boundaries for visible layer structure
    float boundaryGlow = 0.0;
    
    // Check proximity to layer edges
    float distToInner = abs(distFromCenter - layerInnerR);
    float distToOuter = abs(distFromCenter - layerOuterR);
    float minBoundaryDist = min(distToInner, distToOuter);
    
    // Glow intensity at boundaries - creates visible "shells"
    float boundaryWidth = 1.5; // Width of boundary glow zone
    boundaryGlow = smoothstep(boundaryWidth, 0.0, minBoundaryDist) * 0.2;
    
    // Add boundary glow to color (soft white-cyan)
    layerColor += vec3(0.15, 0.2, 0.25) * boundaryGlow;
    
    // Layer transition shimmer - particles at edges have subtle iridescence
    float layerShimmer = smoothstep(0.7, 1.0, layerPosition) * 0.15;
    layerShimmer += smoothstep(0.3, 0.0, layerPosition) * 0.1;
    float shimmerPhase = distFromCenter * 0.5 + uTime * 0.3;
    vec3 shimmerColor = vec3(
        0.5 + 0.5 * sin(shimmerPhase),
        0.5 + 0.5 * sin(shimmerPhase + 2.094),
        0.5 + 0.5 * sin(shimmerPhase + 4.188)
    );
    layerColor = mix(layerColor, shimmerColor, layerShimmer * 0.15);

    // Apply speed influence (brighter when moving faster)
    float speedInfluence = smoothstep(0.0, 1.5, speed);
    float baseBrightness = mix(0.85, 1.0, speedInfluence) * randomBrightness;

    // Apply lighting to color
    float lightContribution = vAmbientOcclusion * (1.0 + vSubsurfaceScatter * 0.3);
    float brightness = baseBrightness * lightContribution;
    vColor = layerColor * brightness;

    // --- Layer-specific Size Calculation ---
    float layerSizeMin = uLayerSizeMin[layerIdx];
    float layerSizeMax = uLayerSizeMax[layerIdx];
    float layerBaseSize = mix(layerSizeMin, layerSizeMax, randomSeed);

    // Normalized distance for additional size calculation
    float sizeNormalizedDist = smoothstep(0.0, uMembraneMaxRadius, distFromCenter);

    vec4 mvPosition = modelViewMatrix * vec4(particlePosition, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    // Depth-based fade (particles farther from camera are more transparent)
    float depth = -mvPosition.z;
    vDepthFade = smoothstep(150.0, 30.0, depth);  // Fade from z=150 to z=30

    // Dynamic point size with layer-specific base size
    // Edge particles are smaller for softer boundaries
    float edgeSizeReduction = mix(1.0, 0.6, 1.0 - vEdgeFade);
    float baseSizeFromSpeed = mix(0.8, 1.3, speedInfluence);
    float sizeFromDist = mix(1.0, 0.85, sizeNormalizedDist);
    gl_PointSize = uPointSize * layerBaseSize * baseSizeFromSpeed * sizeFromDist * edgeSizeReduction * randomSize * uQualityMultiplier * (300.0 / -mvPosition.z);
}
`;

const particleFragmentShader = `
// Particle Rendering Fragment Shader - High Resolution
precision highp float;

varying float vDistFromCenter;
varying float vSpeed;
varying float vAge;
varying vec3 vColor;
varying float vDepthFade;
varying float vEdgeFade;
varying float vAgeFade;
varying float vRimLight;
varying float vAmbientOcclusion;
varying float vSubsurfaceScatter;
varying float vLayerOpacity;

uniform float uMembraneMaxRadius;

void main() {
    // High quality circular particle with crisp edges when zoomed
    vec2 center = gl_PointCoord - vec2(0.5);
    float dist = length(center);

    // Discard outside circle for clean edges
    if (dist > 0.5) discard;
    
    // --- High Resolution Particle Shape ---
    // Crisp circular core with soft organic outer glow
    // This creates sharp particles that don't blur when zoomed in
    
    // Inner core: crisp circular shape with antialiased edge
    float coreRadius = 0.35;
    float coreSoftness = 0.08; // Thin antialiased edge
    float core = 1.0 - smoothstep(coreRadius - coreSoftness, coreRadius + coreSoftness, dist);
    
    // Outer glow: soft falloff for volumetric cloud feel
    float glow = smoothstep(0.5, 0.15, dist) * 0.5;
    
    // Combine core and glow
    float shape = core + glow * (1.0 - core * 0.7);
    
    // Apply gaussian-like density for particle center
    float density = exp(-dist * dist * 6.0);
    shape = mix(shape, density, 0.3); // Blend for organic feel

    // Base opacity with depth fade for volumetric feel, scaled by layer opacity
    float baseAlpha = 0.18 * vLayerOpacity;
    float alpha = baseAlpha * vDepthFade * shape;

    // Edge fade for soft cloud boundaries
    alpha *= vEdgeFade;

    // Age fade (lifecycle: fade in at birth, fade out near death)
    alpha *= vAgeFade;

    if (alpha < 0.006) discard;

    // --- Enhanced Color ---
    vec3 finalColor = vColor;
    
    // Apply rim lighting as additive glow
    finalColor += vec3(vRimLight * 0.35);

    // Subtle subsurface scattering warmth
    finalColor += vec3(0.06, 0.03, 0.01) * vSubsurfaceScatter;

    // Bright center for particle definition
    float centerBright = smoothstep(0.25, 0.0, dist) * 0.15;
    finalColor = mix(finalColor, finalColor * 1.4, centerBright);
    
    // Subtle color shift at edges for depth
    float edgeColor = smoothstep(0.2, 0.45, dist) * 0.1;
    finalColor = mix(finalColor, finalColor * vec3(0.9, 0.95, 1.0), edgeColor);

    // Boost alpha slightly for rim-lit particles
    float finalAlpha = alpha + vRimLight * 0.1;

    gl_FragColor = vec4(finalColor, finalAlpha);
}
`;

// --- Custom Post-Processing Shader (Vignette + Chromatic Aberration + Film Grain) ---
const FilmShader = {
    uniforms: {
        'tDiffuse': { value: null },
        'uTime': { value: 0.0 },
        'uVignetteStrength': { value: 0.30 },    // Subtle organic vignette
        'uVignetteRadius': { value: 0.75 },      // Gentle vignette radius
        'uChromaticAberration': { value: 0.002 }, // Very subtle aberration
        'uFilmGrain': { value: 0.018 }           // Barely perceptible grain
    },
    vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float uTime;
        uniform float uVignetteStrength;
        uniform float uVignetteRadius;
        uniform float uChromaticAberration;
        uniform float uFilmGrain;
        varying vec2 vUv;

        // Improved noise function for film grain
        float random(vec2 co) {
            return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
        }

        // Film grain with temporal noise
        float filmGrain(vec2 uv, float time) {
            float grain = random(uv + fract(time * 0.1));
            grain += random(uv * 2.0 - fract(time * 0.15)) * 0.5;
            grain += random(uv * 4.0 + fract(time * 0.2)) * 0.25;
            return grain / 1.75;
        }

        void main() {
            vec2 uv = vUv;

            // Chromatic aberration - offset R and B channels slightly
            vec2 center = uv - 0.5;
            float dist = length(center);
            float aberrationStrength = uChromaticAberration * (1.0 + dist * 0.5);
            vec2 offset = center * dist * aberrationStrength;

            float r = texture2D(tDiffuse, uv + offset).r;
            float g = texture2D(tDiffuse, uv).g;
            float b = texture2D(tDiffuse, uv - offset).b;
            vec3 color = vec3(r, g, b);

            // Soft vignette with smoother falloff
            float vignette = 1.0 - smoothstep(uVignetteRadius - 0.1, uVignetteRadius + uVignetteStrength, dist * 1.2);
            vignette = pow(vignette, 1.2); // Subtle curve adjustment
            color *= vignette;

            // Subtle blue tint in shadows
            float luminance = dot(color, vec3(0.299, 0.587, 0.114));
            vec3 shadowTint = mix(color, color * vec3(0.9, 0.95, 1.05), (1.0 - luminance) * 0.15);
            color = shadowTint;

            // Film grain - subtle and organic
            float grain = filmGrain(uv * 3.0, uTime) * uFilmGrain;
            color += grain - uFilmGrain * 0.5;

            // Very subtle color grading - slightly warmer highlights
            color.r += luminance * 0.02;
            color.b -= luminance * 0.01;

            gl_FragColor = vec4(color, 1.0);
        }
    `
};

// --- Simulation Constants ---
// Size of the texture storing particle data (WIDTH x WIDTH particles)
// GPU Tier system - auto-detect based on capabilities
let GPU_TIER = 'high'; // 'low', 'medium', 'high', 'ultra'
let TEXTURE_WIDTH = 512; // Default to high (512*512 = 262,144 particles)
let PARTICLE_COUNT = TEXTURE_WIDTH * TEXTURE_WIDTH;
let USE_GPU_COMPUTE = true; // Will be set to false if WebGL2 or compute unavailable

// Parent/Child Color Scheme
// Parent window: Pure white ethereal
// Child windows: Gamma green (radioactive/quantum green)
const PARENT_COLOR_SCHEME = {
    core: [1.0, 1.0, 1.0],           // Pure white core
    inner: [0.95, 0.98, 1.0],        // White with hint of cyan
    mid: [0.9, 0.95, 1.0],           // Soft white-blue
    outer: [0.85, 0.9, 0.98],        // Ethereal white
    halo: [0.8, 0.85, 0.95]          // Faint white-lavender
};

const CHILD_COLOR_SCHEME = {
    core: [0.6, 1.0, 0.4],           // Bright gamma green
    inner: [0.4, 0.95, 0.3],         // Radioactive green
    mid: [0.3, 0.85, 0.25],          // Deep quantum green
    outer: [0.25, 0.75, 0.2],        // Forest quantum
    halo: [0.2, 0.65, 0.15]          // Faint green glow
};

let currentColorScheme = PARENT_COLOR_SCHEME; // Will be set based on window type
let isParentWindow = true; // Track parent/child status

// GPU Tier Configuration
const GPU_TIER_CONFIG = {
    low: {
        textureWidth: 256,      // 65,536 particles
        tendrilCount: 2000,
        dustCount: 2000,
        ghostCount: 400,
        bloomEnabled: false
    },
    medium: {
        textureWidth: 384,      // 147,456 particles
        tendrilCount: 4000,
        dustCount: 4000,
        ghostCount: 800,
        bloomEnabled: true
    },
    high: {
        textureWidth: 512,      // 262,144 particles
        tendrilCount: 6000,
        dustCount: 6000,
        ghostCount: 1200,
        bloomEnabled: true
    },
    ultra: {
        textureWidth: 1024,     // 1,048,576 particles (1M+)
        tendrilCount: 10000,
        dustCount: 8000,
        ghostCount: 2000,
        bloomEnabled: true
    }
};

const DAMPING = 0.988;            // Higher damping for smoother, more viscous motion
const ATTRACTOR_STRENGTH = 0.75;  // Gentle attraction towards center
const REPULSION_RADIUS = 4.0;     // Core repulsion zone
const REPULSION_STRENGTH = 2.8;   // Gentle core repulsion
const ORBIT_RADIUS = 12.0;        // Orbit zone
const ORBIT_STRENGTH = 0.35;      // Subtle orbital motion
const OUTWARD_PUSH_STRENGTH = 0.025; // Very gentle outward push
// Membrane - SOFT boundaries for organic jelly-like feel
const MEMBRANE_MIN_RADIUS = 22.0; // Inner soft boundary (particles can go inside)
const MEMBRANE_MAX_RADIUS = 75.0; // Outer soft boundary - larger for quantum presence
const MEMBRANE_PUSH_STRENGTH = 0.75; // Very soft push back when outside
const MEMBRANE_PULL_STRENGTH = 0.45; // Very soft pull when inside
const MAX_VELOCITY = 1.8;         // Slightly higher for more dynamic motion
// Noise - Higher values for more organic individual movement
const NOISE_SCALE = 0.055;        // Noise spatial frequency
const NOISE_STRENGTH = 0.4;       // Stronger curl noise for organic swirling
const DIRECT_NOISE_STRENGTH = 0.1; // Direct random nudges
const NOISE_SPEED = 0.45;         // Noise evolution speed
const NOISE_EPSILON = 0.01;
// Membrane Curl Noise - Surface turbulence (subtle organic flow)
const MEMBRANE_CURL_NOISE_SCALE = 0.14;
const MEMBRANE_CURL_NOISE_STRENGTH = 0.22;
// =============================================================================
// LIFE-LIKE MOVEMENT PARAMETERS - Enhanced for organic realism
// =============================================================================
// Ambient Jitter - Individual particle autonomy (like organelles moving)
const AMBIENT_JITTER_STRENGTH = 0.045;   // Each particle has its own subtle movement
const MICRO_MOVEMENT_STRENGTH = 0.035;   // Fine-scale trembling - gives "life"
const MICRO_MOVEMENT_SPEED = 4.0;        // Slower, more organic micro-movements
// Advection - Fluid-like particle flow
const ADVECTION_FACTOR = 0.10;           // Smoother advection
// Wave Force - Gentle undulating motion like breathing membrane
const WAVE_FORCE_STRENGTH = 0.6;         // Gentler waves
// Spawn
const INITIAL_SPAWN_RADIUS = 30.0;
// Cross-Window Forces
const CROSS_WINDOW_ATTRACTION_STRENGTH = 1.2;
const CROSS_WINDOW_ATTRACTION_RADIUS = 600.0;
const CROSS_WINDOW_TENDRIL_STRENGTH = 0.5;
// Cloud Deformation (proximity bulging)
const DEFORMATION_STRENGTH = 0.25;
const DEFORMATION_FALLOFF = 400.0;
// Breathing Animation - Slow, rhythmic like a heartbeat (multiple overlapping rhythms)
const BREATHING_SPEED = 0.4;           // Slightly faster for more life
const BREATHING_AMPLITUDE = 0.09;      // More visible expansion/contraction
const BREATHING_PHASE_OFFSET = 0.018;  // Organic wave variation
// Heartbeat Pulse - Radial waves emanating from nucleus
const HEARTBEAT_SPEED = 0.6;           // Heartbeat rhythm
const HEARTBEAT_STRENGTH = 0.055;      // More visible pulse waves
const HEARTBEAT_WAVE_COUNT = 3.0;      // More concentric waves
// Internal Currents & Vortex - Cytoplasmic streaming effect
const VORTEX_STRENGTH = 0.055;         // More visible rotating motion
const VORTEX_SPEED = 0.15;             // Slightly faster rotation
const INTERNAL_CURRENT_STRENGTH = 0.08; // Stronger flowing internal streams
// Membrane Ripple - Waves on the surface
const MEMBRANE_RIPPLE_STRENGTH = 0.045; // More visible surface waves
const MEMBRANE_RIPPLE_SPEED = 1.0;      // Faster wave propagation
// Fluid Dynamics - Organic viscosity
const SURFACE_TENSION_STRENGTH = 0.02;  // Softer membrane cohesion
const VISCOSITY_BASE = 0.990;           // Higher for smoother, more fluid motion
const VISCOSITY_VARIATION = 0.020;
const CLUSTERING_STRENGTH = 0.012;      // Subtle organelle-like clustering
// Lighting & Atmosphere - Bioluminescent glow
const RIM_LIGHT_STRENGTH = 0.5;         // Subtle rim glow
const AMBIENT_OCCLUSION_STRENGTH = 0.35; // Softer core shadows
const LIGHT_DIRECTION = new THREE.Vector3(0.3, 0.8, 0.5).normalize();
// Particle Lifecycle - Longer for stability
const PARTICLE_MAX_LIFETIME = 20.0;
const PARTICLE_FADE_IN_TIME = 1.5;     // Fade in duration
const PARTICLE_FADE_OUT_TIME = 2.0;    // Fade out duration
const PARTICLE_RESPAWN_RADIUS = 25.0;  // Radius for respawning particles

// =============================================================================
// MULTI-LAYER SYSTEM CONFIGURATION - QUANTUM ENTANGLEMENT AESTHETIC
// =============================================================================
// Designed for ethereal quantum appearance with deep blues, magentas, cyans
// Colors flow from warm quantum core to cool ethereal membrane
const LAYER_COUNT = 8;
// LAYER_CONFIG will be updated dynamically based on parent/child status
let LAYER_CONFIG = [
    {
        name: 'Quantum Core',
        innerRadius: 0,
        outerRadius: 5,
        gapAfter: 1.0,
        behavior: 'stiff',
        particleRatio: 0.08,
        orbitSpeed: 0,
        fluidStrength: 0.12,
        stiffness: 0.95,
        // Colors set dynamically based on window type
        baseColor: [1.0, 1.0, 1.0],
        edgeColor: [0.95, 0.98, 1.0],
        opacity: 1.0,
        particleSizeMin: 2.2,
        particleSizeMax: 3.2
    },
    {
        name: 'Inner Glow',
        innerRadius: 6,
        outerRadius: 10,
        gapAfter: 1.0,
        behavior: 'stiff',
        particleRatio: 0.10,
        orbitSpeed: 0.01,
        fluidStrength: 0.2,
        stiffness: 0.88,
        baseColor: [0.98, 0.99, 1.0],
        edgeColor: [0.95, 0.97, 1.0],
        opacity: 0.95,
        particleSizeMin: 1.8,
        particleSizeMax: 2.6
    },
    {
        name: 'Plasma Field',
        innerRadius: 11,
        outerRadius: 18,
        gapAfter: 1.2,
        behavior: 'fluid',
        particleRatio: 0.14,
        orbitSpeed: 0.02,
        fluidStrength: 0.7,
        stiffness: 0.22,
        baseColor: [0.95, 0.97, 1.0],
        edgeColor: [0.92, 0.95, 1.0],
        opacity: 0.9,
        particleSizeMin: 1.0,
        particleSizeMax: 1.7
    },
    {
        name: 'Entanglement Zone',
        innerRadius: 19.2,
        outerRadius: 28,
        gapAfter: 1.5,
        behavior: 'fluid',
        particleRatio: 0.16,
        orbitSpeed: -0.015,
        fluidStrength: 0.85,
        stiffness: 0.18,
        baseColor: [0.92, 0.95, 0.98],
        edgeColor: [0.88, 0.92, 0.98],
        opacity: 0.85,
        particleSizeMin: 0.8,
        particleSizeMax: 1.5
    },
    {
        name: 'Probability Cloud',
        innerRadius: 29.5,
        outerRadius: 40,
        gapAfter: 2,
        behavior: 'fluid',
        particleRatio: 0.18,
        orbitSpeed: 0.025,
        fluidStrength: 0.75,
        stiffness: 0.2,
        baseColor: [0.88, 0.92, 0.96],
        edgeColor: [0.85, 0.90, 0.95],
        opacity: 0.75,
        particleSizeMin: 0.65,
        particleSizeMax: 1.3
    },
    {
        name: 'Wave Function',
        innerRadius: 42,
        outerRadius: 52,
        gapAfter: 2.5,
        behavior: 'orbiting',
        particleRatio: 0.14,
        orbitSpeed: -0.02,
        fluidStrength: 0.6,
        stiffness: 0.3,
        baseColor: [0.85, 0.90, 0.95],
        edgeColor: [0.82, 0.88, 0.94],
        opacity: 0.6,
        particleSizeMin: 0.55,
        particleSizeMax: 1.1
    },
    {
        name: 'Decoherence Shell',
        innerRadius: 54.5,
        outerRadius: 68,
        gapAfter: 3,
        behavior: 'orbiting',
        particleRatio: 0.12,
        orbitSpeed: 0.012,
        fluidStrength: 0.45,
        stiffness: 0.4,
        baseColor: [0.82, 0.87, 0.93],
        edgeColor: [0.80, 0.85, 0.92],
        opacity: 0.45,
        particleSizeMin: 0.45,
        particleSizeMax: 0.95
    },
    {
        name: 'Quantum Halo',
        innerRadius: 71,
        outerRadius: 88,
        gapAfter: 0,
        behavior: 'stiff',
        particleRatio: 0.08,
        orbitSpeed: -0.008,
        fluidStrength: 0.25,
        stiffness: 0.85,
        baseColor: [0.78, 0.83, 0.90],
        edgeColor: [0.75, 0.80, 0.88],
        opacity: 0.22,
        particleSizeMin: 0.25,
        particleSizeMax: 0.55
    }
];

/**
 * Apply color scheme to LAYER_CONFIG based on parent/child status
 */
function applyColorScheme(isParent) {
    const scheme = isParent ? PARENT_COLOR_SCHEME : CHILD_COLOR_SCHEME;
    
    if (isParent) {
        // Parent: Pure white ethereal gradient
        LAYER_CONFIG[0].baseColor = [1.0, 1.0, 1.0];
        LAYER_CONFIG[0].edgeColor = [0.98, 0.99, 1.0];
        LAYER_CONFIG[1].baseColor = [0.98, 0.99, 1.0];
        LAYER_CONFIG[1].edgeColor = [0.96, 0.98, 1.0];
        LAYER_CONFIG[2].baseColor = [0.96, 0.98, 1.0];
        LAYER_CONFIG[2].edgeColor = [0.94, 0.96, 0.99];
        LAYER_CONFIG[3].baseColor = [0.94, 0.96, 0.99];
        LAYER_CONFIG[3].edgeColor = [0.92, 0.95, 0.98];
        LAYER_CONFIG[4].baseColor = [0.92, 0.95, 0.98];
        LAYER_CONFIG[4].edgeColor = [0.90, 0.93, 0.97];
        LAYER_CONFIG[5].baseColor = [0.90, 0.93, 0.97];
        LAYER_CONFIG[5].edgeColor = [0.88, 0.91, 0.96];
        LAYER_CONFIG[6].baseColor = [0.88, 0.91, 0.96];
        LAYER_CONFIG[6].edgeColor = [0.85, 0.89, 0.95];
        LAYER_CONFIG[7].baseColor = [0.85, 0.89, 0.95];
        LAYER_CONFIG[7].edgeColor = [0.82, 0.87, 0.93];
    } else {
        // Child: Gamma green radioactive gradient
        LAYER_CONFIG[0].baseColor = [0.7, 1.0, 0.5];       // Bright gamma green core
        LAYER_CONFIG[0].edgeColor = [0.6, 0.98, 0.45];
        LAYER_CONFIG[1].baseColor = [0.55, 0.95, 0.4];     // Radioactive inner
        LAYER_CONFIG[1].edgeColor = [0.5, 0.92, 0.35];
        LAYER_CONFIG[2].baseColor = [0.45, 0.88, 0.32];    // Deep green plasma
        LAYER_CONFIG[2].edgeColor = [0.4, 0.85, 0.28];
        LAYER_CONFIG[3].baseColor = [0.38, 0.82, 0.25];    // Quantum green zone
        LAYER_CONFIG[3].edgeColor = [0.35, 0.78, 0.22];
        LAYER_CONFIG[4].baseColor = [0.32, 0.75, 0.2];     // Probability cloud
        LAYER_CONFIG[4].edgeColor = [0.28, 0.70, 0.18];
        LAYER_CONFIG[5].baseColor = [0.28, 0.68, 0.17];    // Wave function
        LAYER_CONFIG[5].edgeColor = [0.25, 0.62, 0.15];
        LAYER_CONFIG[6].baseColor = [0.24, 0.58, 0.14];    // Decoherence
        LAYER_CONFIG[6].edgeColor = [0.22, 0.52, 0.12];
        LAYER_CONFIG[7].baseColor = [0.20, 0.48, 0.11];    // Outer halo
        LAYER_CONFIG[7].edgeColor = [0.18, 0.42, 0.10];
    }
    
    console.log(`Applied ${isParent ? 'WHITE (Parent)' : 'GAMMA GREEN (Child)'} color scheme`);
}

/**
 * Detect GPU capabilities and set appropriate tier
 */
function detectGPUCapabilities() {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    
    if (!gl) {
        console.warn('WebGL not available - using CPU fallback');
        USE_GPU_COMPUTE = false;
        GPU_TIER = 'low';
        return 'low';
    }
    
    // Check for required extensions
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    let renderer = 'Unknown';
    let vendor = 'Unknown';
    
    if (debugInfo) {
        renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
        vendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL);
        console.log(`GPU Detected: ${vendor} - ${renderer}`);
    }
    
    // Check max texture size
    const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    const maxRenderbufferSize = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE);
    
    // Check for float texture support (required for GPGPU)
    const floatTextureExt = gl.getExtension('OES_texture_float') || 
                            gl.getExtension('EXT_color_buffer_float');
    
    if (!floatTextureExt && !gl.getExtension('EXT_color_buffer_half_float')) {
        console.warn('Float textures not fully supported - using medium tier');
        GPU_TIER = 'medium';
        return 'medium';
    }
    
    // Estimate VRAM based on renderer string (rough heuristic)
    const rendererLower = renderer.toLowerCase();
    let estimatedVRAM = 2; // Default 2GB assumption
    
    // Try to detect VRAM from common GPU naming patterns
    if (rendererLower.includes('rtx 40') || rendererLower.includes('rtx 30')) {
        estimatedVRAM = 8;
    } else if (rendererLower.includes('rtx 20') || rendererLower.includes('gtx 16')) {
        estimatedVRAM = 6;
    } else if (rendererLower.includes('gtx 10') || rendererLower.includes('rx 5')) {
        estimatedVRAM = 4;
    } else if (rendererLower.includes('intel') || rendererLower.includes('integrated')) {
        estimatedVRAM = 1;
    }
    
    // User mentioned 4GB VRAM - set tier accordingly
    // 4GB can handle 1M+ particles comfortably
    if (maxTextureSize >= 2048 && estimatedVRAM >= 4) {
        GPU_TIER = 'ultra';
    } else if (maxTextureSize >= 1024 && estimatedVRAM >= 2) {
        GPU_TIER = 'high';
    } else if (maxTextureSize >= 512) {
        GPU_TIER = 'medium';
    } else {
        GPU_TIER = 'low';
    }
    
    console.log(`GPU Tier: ${GPU_TIER.toUpperCase()} (Max Texture: ${maxTextureSize}, Est. VRAM: ${estimatedVRAM}GB)`);
    
    return GPU_TIER;
}

/**
 * Initialize particle system based on GPU tier
 */
function initializeGPUSettings() {
    const tier = detectGPUCapabilities();
    const config = GPU_TIER_CONFIG[tier];
    
    TEXTURE_WIDTH = config.textureWidth;
    PARTICLE_COUNT = TEXTURE_WIDTH * TEXTURE_WIDTH;
    
    console.log(`Particle System: ${PARTICLE_COUNT.toLocaleString()} particles (${TEXTURE_WIDTH}x${TEXTURE_WIDTH})`);
    
    return config;
}

// Calculate cumulative particle ratios for layer assignment
let cumulativeRatios = [];
let sum = 0;
for (let i = 0; i < LAYER_CONFIG.length; i++) {
    sum += LAYER_CONFIG[i].particleRatio;
    cumulativeRatios.push(sum);
}
// Normalize if ratios don't add up to 1
if (Math.abs(sum - 1.0) > 0.001) {
    cumulativeRatios = cumulativeRatios.map(r => r / sum);
}

// Helper function to get layer index from particle index
function getLayerForParticle(particleIndex, totalParticles) {
    const normalizedIndex = particleIndex / totalParticles;
    for (let i = 0; i < cumulativeRatios.length; i++) {
        if (normalizedIndex < cumulativeRatios[i]) {
            return i;
        }
    }
    return LAYER_CONFIG.length - 1;
}

let scene, camera, renderer;
let composer; // Post-processing composer
let bloomPass; // Bloom pass for entanglement effects
let filmPass;  // Custom film effects pass

// --- Post-Processing Settings ---
const BLOOM_STRENGTH = 0.72;   // Enhanced ethereal bloom for quantum glow
const BLOOM_RADIUS = 0.75;     // Wider bloom spread for dreamy effect
const BLOOM_THRESHOLD = 0.25;  // Lower threshold for more luminescence

// --- Adaptive Quality System ---
const QUALITY_LEVELS = {
    high: { particleSize: 1.0, dustAlpha: 1.0, bloomStrength: 1.0 },
    medium: { particleSize: 0.8, dustAlpha: 0.7, bloomStrength: 0.7 },
    low: { particleSize: 0.6, dustAlpha: 0.4, bloomStrength: 0.4 }
};
const TARGET_FPS = 55;              // Target frame rate
const FPS_SAMPLE_SIZE = 30;         // Frames to average for FPS calculation
const QUALITY_ADJUST_INTERVAL = 2.0; // Seconds between quality adjustments
let currentQuality = 'high';
let qualityMultiplier = 1.0;
let fpsHistory = [];
let lastQualityAdjustTime = 0;

let socket;
let clock;

// --- Camera Control Variables (Zoom Only - No Orbit) ---
let targetZoom = 70;           // Target camera Z position (farther for larger cloud)
let currentZoom = 70;          // Current camera Z position
const MIN_ZOOM = 35;           // Closest zoom (smaller = closer)
const MAX_ZOOM = 180;          // Farthest zoom (larger range for bigger cloud)
const ZOOM_SPEED = 0.1;        // Zoom interpolation speed (smoother)
const ZOOM_SENSITIVITY = 0.05; // Mouse wheel sensitivity (gentler)

// --- GPGPU Variables ---
let gpuCompute;
let positionVariable;
let velocityVariable;

// --- Particle Rendering Variables ---
let particlePoints;
let particleMaterial; // Store reference for dynamic updates

// --- Attractor Position (Single Attractor at Origin) ---
const attractorPos = new THREE.Vector3(0, 0, 0);

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
const TENDRIL_PARTICLE_COUNT = 4000; // Particles per tendril stream
const TENDRIL_MAX_CONNECTIONS = 8;   // 8 connections: 4 outgoing + 4 incoming for TRUE bidirection
const TENDRIL_OUTGOING_COUNT = 4;    // First 4 are outgoing (this → other)
const TENDRIL_INCOMING_COUNT = 4;    // Last 4 are incoming (other → this, simulated)

// --- Ambient Dust System ---
let dustPoints;
let dustGeometry;
let dustMaterial;
const DUST_PARTICLE_COUNT = 4000;     // More dust for quantum atmosphere
const DUST_SPREAD = 280.0;            // Wider spread for depth perception
const DUST_SIZE = 1.2;                // Slightly larger

/**
 * Update particle material uniforms with current LAYER_CONFIG colors
 * Call this after applyColorScheme() and after particle geometry is initialized
 */
function updateParticleMaterialColors() {
    if (!particleMaterial) {
        console.warn('Particle material not yet initialized, cannot update colors');
        return;
    }
    
    // Update layer color uniforms
    particleMaterial.uniforms.uLayerBaseColor.value = LAYER_CONFIG.map(l => new THREE.Vector3(...l.baseColor));
    particleMaterial.uniforms.uLayerEdgeColor.value = LAYER_CONFIG.map(l => new THREE.Vector3(...l.edgeColor));
    particleMaterial.uniforms.uLayerOpacity.value = LAYER_CONFIG.map(l => l.opacity);
    
    // Also update tendril nucleus color if tendril material exists
    if (tendrilMaterial) {
        tendrilMaterial.uniforms.uNucleusColor.value.set(...LAYER_CONFIG[0].baseColor);
    }
    
    console.log(`Material colors updated for ${isParentWindow ? 'PARENT' : 'CHILD'} window`);
}
const DUST_ALPHA = 0.12;              // Subtle - atmospheric only
const DUST_DRIFT_SPEED = 0.015;       // Slower, more ethereal drift

// --- Ghost Cloud System (renders other windows' clouds) ---
// These are simplified visual representations of other windows' particle clouds
const ghostClouds = [];  // Array of {mesh, windowId}
const MAX_GHOST_CLOUDS = 4;
const GHOST_CLOUD_PARTICLE_COUNT = 800;  // More particles for better representation

// --- Entanglement Animation System ---
// Tracks when child windows approach/merge with parent window
const entanglementStates = {};  // windowId -> { progress: 0-1, isEntangling: bool }
const ENTANGLEMENT_DISTANCE_THRESHOLD = 350;  // Pixels - distance at which entanglement begins
const ENTANGLEMENT_MERGE_DISTANCE = 80;       // Pixels - distance for full merge
const ENTANGLEMENT_SPEED = 1.0;               // How fast the entanglement progresses

// --- Connection Transition State ---
const connectionStates = [0, 0, 0, 0, 0, 0, 0, 0]; // 8 smoothed connection strengths (0-1)
const CONNECTION_FADE_SPEED = 2.5;    // Fade speed (units per second)

/**
 * Initialize post-processing pipeline
 */
function initPostProcessing() {
    // Create the effect composer
    composer = new EffectComposer(renderer);

    // Render pass - renders the scene
    const renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);

    // Bloom pass - subtle ethereal glow
    bloomPass = new UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight),
        BLOOM_STRENGTH,
        BLOOM_RADIUS,
        BLOOM_THRESHOLD
    );
    composer.addPass(bloomPass);

    // Custom film effects pass (vignette, chromatic aberration, film grain)
    filmPass = new ShaderPass(FilmShader);
    composer.addPass(filmPass);

    console.log("Post-processing pipeline initialized");
}

/**
 * Show a user-friendly error message overlay
 */
function showErrorMessage(message) {
    const overlay = document.createElement('div');
    overlay.id = 'error-overlay';
    overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(5, 5, 8, 0.95);
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        z-index: 1000;
        color: #fff;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `;
    overlay.innerHTML = `
        <div style="font-size: 48px; margin-bottom: 20px;">⚠️</div>
        <h2 style="margin: 0 0 10px 0; font-weight: 300;">Unable to Initialize</h2>
        <p style="margin: 0; opacity: 0.7; max-width: 400px; text-align: center; line-height: 1.5;">${message}</p>
    `;
    document.body.appendChild(overlay);
    console.error('Tangled Error:', message);
}

/**
 * Show loading indicator while initializing
 */
function showLoadingIndicator() {
    const loader = document.createElement('div');
    loader.id = 'loading-overlay';
    loader.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(5, 5, 8, 1);
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        z-index: 999;
        color: #fff;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        transition: opacity 0.8s ease-out;
    `;
    loader.innerHTML = `
        <div id="loading-spinner" style="
            width: 40px;
            height: 40px;
            border: 2px solid rgba(255,255,255,0.1);
            border-top-color: rgba(255,255,255,0.6);
            border-radius: 50%;
            animation: spin 1s linear infinite;
        "></div>
        <style>@keyframes spin { to { transform: rotate(360deg); } }</style>
        <p style="margin-top: 20px; opacity: 0.5; font-weight: 300;">Initializing...</p>
    `;
    document.body.appendChild(loader);
}

/**
 * Hide loading indicator with fade
 */
function hideLoadingIndicator() {
    const loader = document.getElementById('loading-overlay');
    if (loader) {
        loader.style.opacity = '0';
        setTimeout(() => {
            if (loader.parentNode) {
                loader.parentNode.removeChild(loader);
            }
        }, 800);
    }
}

function init() {
    // --- WebGL Availability Check ---
    const canvas = document.getElementById('webgl-canvas');

    // Check WebGL support
    try {
        const testContext = canvas.getContext('webgl2') || canvas.getContext('webgl');
        if (!testContext) {
            showErrorMessage('WebGL is not supported in your browser. Please use a modern browser with WebGL support.');
            return;
        }
    } catch (e) {
        showErrorMessage('WebGL initialization failed: ' + e.message);
        return;
    }

    // Show loading indicator
    showLoadingIndicator();

    // --- GPU Tier Detection & Optimization ---
    const gpuConfig = initializeGPUSettings();
    console.log(`GPU Config Applied: ${GPU_TIER} tier - ${PARTICLE_COUNT.toLocaleString()} particles, ${gpuConfig.tendrilCount} tendrils`);

    // --- Basic Three.js Setup ---
    clock = new THREE.Clock();
    scene = new THREE.Scene();

    // Set a subtle dark gradient background (not pure black)
    scene.background = new THREE.Color(0x050508);  // Very dark blue-gray

    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 50;

    // --- Setup Post-Processing Pipeline ---
    initPostProcessing();

    // --- Initialize WindowManager for multi-window coordination ---
    windowManager = new WindowManager();
    windowManager.init({ particleColor: '#ffffff' });
    
    // === APPLY COLOR SCHEME BASED ON PARENT/CHILD STATUS ===
    isParentWindow = windowManager.isParentWindow();
    applyColorScheme(isParentWindow);
    currentColorScheme = isParentWindow ? PARENT_COLOR_SCHEME : CHILD_COLOR_SCHEME;
    console.log(`Window Role: ${isParentWindow ? 'PARENT (White)' : 'CHILD (Gamma Green)'}`);
    
    windowManager.setWinChangeCallback((otherWindows) => {
        console.log(`WindowManager: detected ${otherWindows.length} other window(s)`);
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
    initDust();
    initGhostClouds();

    // === UPDATE MATERIAL COLORS AFTER ALL GEOMETRY INITIALIZED ===
    // Now that materials exist, apply the color scheme
    updateParticleMaterialColors();

    // Handle window resize
    window.addEventListener('resize', onWindowResize, false);

    // --- Camera Controls Setup ---
    setupCameraControls();

    // --- Socket.IO Setup (optional - only when backend is available) ---
    const isStaticHosting = window.location.hostname.includes('github.io') ||
                            window.location.hostname.includes('gitlab.io') ||
                            window.location.hostname.includes('netlify.app') ||
                            window.location.hostname.includes('vercel.app') ||
                            window.location.protocol === 'file:';

    if (isStaticHosting) {
        console.log("Static hosting detected - Socket.IO disabled (running in standalone mode)");
    } else if (typeof io !== 'undefined') {
        console.log("Attempting to connect to Socket.IO server...");
        socket = io({
            reconnectionAttempts: 3,  // Limit retry attempts
            timeout: 5000             // 5 second timeout
        });

        socket.on('connect', () => {
            console.log('Connected to server with ID:', socket.id);
        });

        socket.on('disconnect', (reason) => {
            console.log('Disconnected from server:', reason);
        });

        socket.on('connect_error', (error) => {
            console.warn('Socket.IO connection failed:', error.message);
        });

        socket.on('reconnect_failed', () => {
            console.log('Socket.IO reconnection failed - continuing in standalone mode');
            socket.disconnect();
        });

        socket.on('update_params', (params) => {
            console.log('Received params update:', params);
            if (params.particle_count) {
                 console.log("Need to update particle count to:", params.particle_count);
            }
        });
    } else {
        console.log("Socket.IO not available - running in standalone mode");
    }

    // Hide loading indicator and start the animation loop
    hideLoadingIndicator();
    animate();
    console.log("Tangled initialized successfully");
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

    // Spawn particles within their assigned layers
    for (let i = 0; i < PARTICLE_COUNT; i++) {
        const i4 = i * 4;

        // Determine which layer this particle belongs to
        const layerIndex = getLayerForParticle(i, PARTICLE_COUNT);
        const layer = LAYER_CONFIG[layerIndex];

        // Spawn within layer's radius bounds (shell distribution)
        const innerR = layer.innerRadius;
        const outerR = layer.outerRadius;
        // Uniform distribution within shell: r = cbrt(rand * (outer^3 - inner^3) + inner^3)
        const r3Inner = innerR * innerR * innerR;
        const r3Outer = outerR * outerR * outerR;
        const r = Math.cbrt(Math.random() * (r3Outer - r3Inner) + r3Inner);

        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos((Math.random() * 2) - 1);
        initialPositionData[i4 + 0] = r * Math.sin(phi) * Math.cos(theta);
        initialPositionData[i4 + 1] = r * Math.sin(phi) * Math.sin(theta);
        initialPositionData[i4 + 2] = r * Math.cos(phi);
        initialPositionData[i4 + 3] = Math.random() * 5.0; // Age with random offset

        // Initial velocity (small, varies by layer behavior)
        const velMag = layer.behavior === 'stiff' ? 0.01 : 0.1 * Math.random();
        const vTheta = Math.random() * Math.PI * 2;
        const vPhi = Math.acos((Math.random() * 2) - 1);
        initialVelocityData[i4 + 0] = velMag * Math.sin(vPhi) * Math.cos(vTheta);
        initialVelocityData[i4 + 1] = velMag * Math.sin(vPhi) * Math.sin(vTheta);
        initialVelocityData[i4 + 2] = velMag * Math.cos(vPhi);
        initialVelocityData[i4 + 3] = layerIndex; // Store layer index in velocity.w
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
            uMaxLifetime: { value: PARTICLE_MAX_LIFETIME },
            uRespawnRadius: { value: PARTICLE_RESPAWN_RADIUS },
            uTime: { value: 0.0 },
            // Layer system uniforms for respawning
            uLayerInnerRadius: { value: LAYER_CONFIG.map(l => l.innerRadius) },
            uLayerOuterRadius: { value: LAYER_CONFIG.map(l => l.outerRadius) }
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
             uCrossWindowAttractionRadius: { value: CROSS_WINDOW_ATTRACTION_RADIUS },
             // Cloud deformation
             uDeformationStrength: { value: DEFORMATION_STRENGTH },
             uDeformationFalloff: { value: DEFORMATION_FALLOFF },
             // Breathing animation
             uBreathingSpeed: { value: BREATHING_SPEED },
             uBreathingAmplitude: { value: BREATHING_AMPLITUDE },
             uBreathingPhaseOffset: { value: BREATHING_PHASE_OFFSET },
             // Heartbeat pulse - radial waves
             uHeartbeatSpeed: { value: HEARTBEAT_SPEED },
             uHeartbeatStrength: { value: HEARTBEAT_STRENGTH },
             uHeartbeatWaveCount: { value: HEARTBEAT_WAVE_COUNT },
             // Membrane ripple - surface waves
             uMembraneRippleStrength: { value: MEMBRANE_RIPPLE_STRENGTH },
             uMembraneRippleSpeed: { value: MEMBRANE_RIPPLE_SPEED },
             // Internal currents & vortex
             uVortexStrength: { value: VORTEX_STRENGTH },
             uVortexSpeed: { value: VORTEX_SPEED },
             uInternalCurrentStrength: { value: INTERNAL_CURRENT_STRENGTH },
             // Micro-movements
             uMicroMovementStrength: { value: MICRO_MOVEMENT_STRENGTH },
             uMicroMovementSpeed: { value: MICRO_MOVEMENT_SPEED },
             // Fluid dynamics
             uSurfaceTensionStrength: { value: SURFACE_TENSION_STRENGTH },
             uViscosityBase: { value: VISCOSITY_BASE },
             uViscosityVariation: { value: VISCOSITY_VARIATION },
             uClusteringStrength: { value: CLUSTERING_STRENGTH },
             // Layer system uniforms
             uLayerInnerRadius: { value: LAYER_CONFIG.map(l => l.innerRadius) },
             uLayerOuterRadius: { value: LAYER_CONFIG.map(l => l.outerRadius) },
             uLayerBehavior: { value: LAYER_CONFIG.map(l => l.behavior === 'stiff' ? 0.0 : l.behavior === 'fluid' ? 1.0 : 2.0) },
             uLayerOrbitSpeed: { value: LAYER_CONFIG.map(l => l.orbitSpeed) },
             uLayerFluidStrength: { value: LAYER_CONFIG.map(l => l.fluidStrength) },
             uLayerStiffness: { value: LAYER_CONFIG.map(l => l.stiffness) },
             uTime: { value: 0.0 }
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
    // Create shader material - assign to module-level variable for dynamic color updates
    particleMaterial = new THREE.ShaderMaterial({
        uniforms: {
            uPositionTexture: { value: null },
            uVelocityTexture: { value: null },
            uPointSize: { value: 0.7 },  // Increased for better visibility when zoomed
            uTime: { value: 0.0 },
            uAttractorPos: { value: attractorPos },
            uMembraneMinRadius: { value: MEMBRANE_MIN_RADIUS },
            uMembraneMaxRadius: { value: MEMBRANE_MAX_RADIUS },
            // Lifecycle uniforms
            uMaxLifetime: { value: PARTICLE_MAX_LIFETIME },
            uFadeInTime: { value: PARTICLE_FADE_IN_TIME },
            uFadeOutTime: { value: PARTICLE_FADE_OUT_TIME },
            // Lighting uniforms
            uLightDirection: { value: LIGHT_DIRECTION },
            uRimLightStrength: { value: RIM_LIGHT_STRENGTH },
            uAmbientOcclusionStrength: { value: AMBIENT_OCCLUSION_STRENGTH },
            // Quality/LOD uniform
            uQualityMultiplier: { value: 1.0 },
            // Layer system uniforms for visual differentiation
            uLayerBaseColor: { value: LAYER_CONFIG.map(l => new THREE.Vector3(...l.baseColor)) },
            uLayerEdgeColor: { value: LAYER_CONFIG.map(l => new THREE.Vector3(...l.edgeColor)) },
            uLayerOpacity: { value: LAYER_CONFIG.map(l => l.opacity) },
            uLayerSizeMin: { value: LAYER_CONFIG.map(l => l.particleSizeMin) },
            uLayerSizeMax: { value: LAYER_CONFIG.map(l => l.particleSizeMax) },
            uLayerInnerRadius: { value: LAYER_CONFIG.map(l => l.innerRadius) },
            uLayerOuterRadius: { value: LAYER_CONFIG.map(l => l.outerRadius) }
        },
        vertexShader: particleVertexShader,
        fragmentShader: particleFragmentShader,
        // Normal blending - particles render individually without brightening overlap
        blending: THREE.NormalBlending,
        transparent: true,
        depthTest: true,
        depthWrite: false
    });

    particlePoints = new THREE.Points(geometry, particleMaterial);
    scene.add(particlePoints);
    console.log("Particle Geometry Initialized with ShaderMaterial");
}

/**
 * Monitor frame rate and adjust quality adaptively
 */
function updateAdaptiveQuality(deltaTime, elapsedTime) {
    // Calculate current FPS
    const currentFPS = 1.0 / Math.max(deltaTime, 0.001);
    fpsHistory.push(currentFPS);

    // Keep only recent samples
    if (fpsHistory.length > FPS_SAMPLE_SIZE) {
        fpsHistory.shift();
    }

    // Only adjust quality periodically
    if (elapsedTime - lastQualityAdjustTime < QUALITY_ADJUST_INTERVAL) {
        return;
    }
    lastQualityAdjustTime = elapsedTime;

    // Calculate average FPS
    if (fpsHistory.length < FPS_SAMPLE_SIZE / 2) return;

    const avgFPS = fpsHistory.reduce((a, b) => a + b, 0) / fpsHistory.length;

    // Determine quality adjustment
    let newQuality = currentQuality;

    if (avgFPS < TARGET_FPS * 0.7) {
        // Significant frame drop - reduce quality
        if (currentQuality === 'high') newQuality = 'medium';
        else if (currentQuality === 'medium') newQuality = 'low';
    } else if (avgFPS > TARGET_FPS * 0.95 && currentQuality !== 'high') {
        // Good performance - try increasing quality
        if (currentQuality === 'low') newQuality = 'medium';
        else if (currentQuality === 'medium') newQuality = 'high';
    }

    // Apply quality change if needed
    if (newQuality !== currentQuality) {
        currentQuality = newQuality;
        qualityMultiplier = QUALITY_LEVELS[newQuality].particleSize;
        applyQualitySettings(newQuality);
        console.log(`Quality adjusted to: ${newQuality} (avg FPS: ${avgFPS.toFixed(1)})`);
    }
}

/**
 * Apply quality settings to all relevant materials
 */
function applyQualitySettings(quality) {
    const settings = QUALITY_LEVELS[quality];

    // Update particle quality multiplier (LOD)
    if (particlePoints && particlePoints.material) {
        particlePoints.material.uniforms.uQualityMultiplier.value = settings.particleSize;
    }

    // Update dust opacity
    if (dustMaterial) {
        dustMaterial.uniforms.uBaseAlpha.value = DUST_ALPHA * settings.dustAlpha;
    }

    // Update bloom if available
    if (composer && composer.passes) {
        for (const pass of composer.passes) {
            if (pass.strength !== undefined) {
                pass.strength = BLOOM_STRENGTH * settings.bloomStrength;
            }
        }
    }
}

/**
 * Calculate distance-based LOD multiplier for particle size
 */
function calculateLODMultiplier(distanceFromCamera) {
    // Near: full size, Far: reduced size
    const nearDist = 50;
    const farDist = 200;
    const minMultiplier = 0.5;

    if (distanceFromCamera <= nearDist) return 1.0;
    if (distanceFromCamera >= farDist) return minMultiplier;

    const t = (distanceFromCamera - nearDist) / (farDist - nearDist);
    return 1.0 - t * (1.0 - minMultiplier);
}

/**
 * Setup camera controls - Zoom only (no orbit)
 */
function setupCameraControls() {
    const canvas = renderer.domElement;

    // Mouse wheel zoom
    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const delta = e.deltaY * ZOOM_SENSITIVITY;
        targetZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, targetZoom + delta));
    }, { passive: false });

    // Touch support for mobile - pinch zoom only
    let touchStartDistance = 0;
    let initialZoom = targetZoom;

    canvas.addEventListener('touchstart', (e) => {
        if (e.touches.length === 2) {
            // Pinch zoom start
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            touchStartDistance = Math.sqrt(dx * dx + dy * dy);
            initialZoom = targetZoom;
        }
    }, { passive: true });

    canvas.addEventListener('touchmove', (e) => {
        if (e.touches.length === 2 && touchStartDistance > 0) {
            // Pinch zoom
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            const distance = Math.sqrt(dx * dx + dy * dy);
            const scale = touchStartDistance / distance;
            targetZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, initialZoom * scale));
        }
    }, { passive: true });

    canvas.addEventListener('touchend', () => {
        touchStartDistance = 0;
    });

    console.log("Camera controls initialized (scroll/pinch to zoom)");
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);

    // Resize post-processing composer
    if (composer) {
        composer.setSize(window.innerWidth, window.innerHeight);
    }
}

function animate() {
    requestAnimationFrame(animate);
    const deltaTime = clock.getDelta();
    const elapsedTime = clock.getElapsedTime();

    // --- Update WindowManager ---
    if (windowManager) {
        windowManager.update();
    }

    // --- Adaptive Quality Monitoring ---
    updateAdaptiveQuality(deltaTime, elapsedTime);

    // --- Get this window info for screen-space positioning ---
    const thisWindow = windowManager ? windowManager.getThisWindow() : null;

    // --- Screen-Space Camera Positioning (bgstaal approach) ---
    // Camera position is based on window's screen coordinates
    // This makes particles appear static relative to the monitor as windows move
    if (thisWindow) {
        // Camera looks at the window's screen center
        // Y is inverted: screen Y increases downward, world Y increases upward
        const targetCamX = thisWindow.center.x;
        const targetCamY = -thisWindow.center.y;

        // Smooth camera movement
        camera.position.x += (targetCamX - camera.position.x) * 0.15;
        camera.position.y += (targetCamY - camera.position.y) * 0.15;
    }

    // --- Camera Zoom (No Orbit) ---
    // Smooth zoom interpolation
    currentZoom += (targetZoom - currentZoom) * ZOOM_SPEED;
    camera.position.z = currentZoom;

    // Camera always looks at the particle cloud center
    if (thisWindow) {
        camera.lookAt(thisWindow.center.x, -thisWindow.center.y, 0);
    } else {
        camera.lookAt(0, 0, 0);
    }

    // --- Smoothly interpolate scene offset (legacy, for shader cross-window calculations) ---
    sceneOffset.x += (sceneOffsetTarget.x - sceneOffset.x) * 0.1;
    sceneOffset.y += (sceneOffsetTarget.y - sceneOffset.y) * 0.1;

    // --- 1. Update GPGPU Simulation ---
    if (gpuCompute) {
        // Update dynamic uniforms for velocity shader
        velocityVariable.material.uniforms.uNoiseTime.value = elapsedTime * NOISE_SPEED;
        velocityVariable.material.uniforms.uTime.value = elapsedTime;

        // Update time for position shader (particle lifecycle)
        positionVariable.material.uniforms.uTime.value = elapsedTime;

        // Update cross-window uniforms
        velocityVariable.material.uniforms.uSceneOffset.value.set(sceneOffset.x, sceneOffset.y);

        // Update this window's center (using thisWindow from outer scope)
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

    // --- 2. Update Particle Position (Screen-Space) ---
    // Position particle cloud at this window's screen center (bgstaal approach)
    // This makes the particles appear anchored to the screen as window moves
    if (particlePoints && thisWindow) {
        const cloudX = thisWindow.center.x;
        const cloudY = -thisWindow.center.y;  // Y inverted
        particlePoints.position.set(cloudX, cloudY, 0);
    }

    // --- 3. Update Tendrils ---
    if (tendrilPoints && windowManager) {
        updateTendrils(elapsedTime, deltaTime);
    }

    // --- 3.25 Update Ghost Clouds (other windows' visual representations) ---
    if (windowManager && ghostClouds.length > 0) {
        const otherWindows = windowManager.getOtherWindows();
        updateGhostClouds(otherWindows);
        // Update time uniform for ghost cloud animations
        for (let i = 0; i < ghostClouds.length; i++) {
            if (ghostClouds[i].mesh.material.uniforms) {
                ghostClouds[i].mesh.material.uniforms.uTime.value = elapsedTime;
            }
        }
    }

    // --- 3.3 Update Entanglement Animation ---
    if (windowManager) {
        updateEntanglement(deltaTime);
        applyEntanglementEffects(elapsedTime);
    }

    // --- 3.5 Update Dust ---
    if (dustMaterial) {
        dustMaterial.uniforms.uTime.value = elapsedTime;
    }

    // --- 4. Render Particles ---
    if (particlePoints && gpuCompute) {
        const material = particlePoints.material;
        // IMPORTANT: Use the *updated* textures for rendering
        material.uniforms.uPositionTexture.value = gpuCompute.getCurrentRenderTarget(positionVariable).texture;
        material.uniforms.uVelocityTexture.value = gpuCompute.getCurrentRenderTarget(velocityVariable).texture;
        material.uniforms.uTime.value = elapsedTime;
    }

    // --- 5. Render with Post-Processing ---
    if (filmPass) {
        filmPass.uniforms.uTime.value = elapsedTime;
    }

    if (composer) {
        composer.render();
    } else {
        renderer.render(scene, camera);
    }
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

    // Tendril shader material - TRI-HELICAL QUANTUM TETHERS
    // Three intertwined helix strands that taper from origin to middle
    // Fades out as windows approach for merging behavior
    const tendrilVertexShader = `
        attribute float age;
        attribute float connectionIndex;
        attribute float randomSeed;

        uniform float uTime;
        uniform vec3 uThisCenter;
        uniform vec3 uTargetCenters[8];
        uniform float uTargetActive[8];
        uniform float uCloudRadius;
        uniform float uNucleusRadius;
        uniform vec3 uNucleusColor;
        uniform vec3 uTargetColors[8];
        uniform float uConnectionStrengths[8];
        uniform float uEntanglementProgress[8]; // 0=far, 1=merged (fade out tendrils)
        uniform float uGlobalTimeOffset; // For cross-window coherent animation

        varying float vAlpha;
        varying vec3 vColor;
        varying float vEnergy;
        varying float vProgress;
        varying float vDirection;
        varying float vHelixStrand; // Which of the 3 helix strands (0, 1, 2)
        varying float vNucleusInfluence;

        // Smooth hash function
        float hash(float n) {
            return fract(sin(n) * 43758.5453123);
        }

        // Constants for tri-helix
        const float PI = 3.14159265359;
        const float TAU = 6.28318530718;
        const int NUM_HELIX_STRANDS = 3;

        void main() {
            int connIdx = int(connectionIndex);

            // Determine flow direction (0-3 outgoing, 4-7 incoming)
            bool isIncoming = connIdx >= 4;
            float flowDir = isIncoming ? -1.0 : 1.0;
            vDirection = flowDir;

            // Get connection data
            float isActive = uTargetActive[connIdx];
            vec3 targetCenter = uTargetCenters[connIdx];
            vec3 targetColor = uTargetColors[connIdx];
            float strength = uConnectionStrengths[connIdx];
            float entanglement = uEntanglementProgress[connIdx];

            // === ENTANGLEMENT-BASED FADE ===
            // When windows are close (high entanglement), fade out tendrils
            float entanglementFade = 1.0 - smoothstep(0.3, 0.8, entanglement);

            if (isActive < 0.01 || entanglementFade < 0.01) {
                gl_Position = vec4(0.0, 0.0, -1000.0, 1.0);
                gl_PointSize = 0.0;
                vAlpha = 0.0;
                return;
            }

            // Unique particle ID
            float particleID = randomSeed * 1000.0 + float(connIdx) * 100.0;

            // === TRI-HELIX STRAND ASSIGNMENT ===
            // Assign each particle to one of 3 helix strands based on its ID
            int strandIdx = int(mod(particleID, 3.0));
            float strandPhase = float(strandIdx) * TAU / 3.0; // 120 degrees apart
            vHelixStrand = float(strandIdx);

            // === CONNECTION GEOMETRY ===
            vec3 delta = targetCenter - uThisCenter;
            float connectionDist = length(delta);
            vec3 connDir = normalize(delta);

            // Connection endpoints
            vec3 sourcePoint = uThisCenter + connDir * uNucleusRadius * 1.1;
            vec3 destPoint = targetCenter - connDir * uCloudRadius * 0.35;

            // Swap for incoming streams
            if (isIncoming) {
                vec3 temp = sourcePoint;
                sourcePoint = destPoint;
                destPoint = temp;
            }

            // === COHERENT FLOW ANIMATION ===
            // Use global time offset for cross-window synchronization
            // All windows see the same animation phase at the same real-world time
            float globalTime = uTime + uGlobalTimeOffset;

            // Flow along the tendril with consistent speed
            float flowSpeed = 0.08; // Unified speed for coherent feel
            float particleOffset = hash(particleID * 0.19);
            float t = fract(age + globalTime * flowSpeed + particleOffset * 0.3);

            // Quintic easing for smooth motion
            float smoothT = t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
            vProgress = smoothT;

            // === TRI-HELICAL GEOMETRY ===
            // Base position along the connection axis
            vec3 basePos = mix(sourcePoint, destPoint, smoothT);

            // Create perpendicular basis vectors
            vec3 up = vec3(0.0, 1.0, 0.0);
            vec3 right = normalize(cross(connDir, up));
            if (length(right) < 0.1) {
                right = normalize(cross(connDir, vec3(1.0, 0.0, 0.0)));
            }
            vec3 perpUp = normalize(cross(connDir, right));

            // === TAPERED HELIX RADIUS ===
            // Bigger at origin (t=0), smaller at middle (t=0.5) and end (t=1)
            // Creates the "bigger at origin, smaller at ends/middle" effect
            float taperCurve = 1.0 - smoothT; // Linear taper from 1 to 0
            // Add a slight bulge near the source for organic feel
            float bulgeFactor = exp(-smoothT * 3.0) * 0.5 + 0.5; // Exponential decay
            float helixRadius = 8.0 * taperCurve * bulgeFactor + 1.5; // 1.5-8 range

            // === HELIX ROTATION ===
            // Helix winds around the axis with coherent animation
            float helixTurns = 4.0; // Number of full rotations along tendril
            float helixAngle = smoothT * TAU * helixTurns + strandPhase;

            // Add gentle rotation animation (synchronized across windows)
            float rotationSpeed = 0.3;
            helixAngle += globalTime * rotationSpeed;

            // Calculate helix offset
            vec3 helixOffset = right * cos(helixAngle) * helixRadius +
                               perpUp * sin(helixAngle) * helixRadius;

            // === ORGANIC WAVE PERTURBATION ===
            // Add gentle wave motion for organic feel
            float waveFreq = 2.5;
            float waveAmp = taperCurve * 2.0; // Waves stronger near origin
            float wavePhase = globalTime * 0.5 + smoothT * TAU * waveFreq;

            helixOffset += perpUp * sin(wavePhase) * waveAmp * 0.3;
            helixOffset += right * cos(wavePhase * 0.7 + float(strandIdx)) * waveAmp * 0.2;

            // === BREATHING/PULSE ===
            // Gentle breathing synchronized across strands
            float breathe = 1.0 + sin(globalTime * 0.6) * 0.08;
            helixOffset *= breathe;

            // Combine position
            vec3 pos = basePos + helixOffset;

            // Transform to screen
            vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
            gl_Position = projectionMatrix * mvPosition;

            // === PARTICLE SIZE - TAPERED ===
            // Bigger at origin, smaller toward middle/end
            float sizeTaper = taperCurve * bulgeFactor; // Same taper as radius
            float baseSize = 1.2 + hash(particleID * 0.37) * 0.3;

            // Strand variation (center strand slightly larger)
            float strandSize = 1.0 - abs(float(strandIdx) - 1.0) * 0.15;

            // Gentle pulse
            float pulse = 1.0 + sin(globalTime * 2.5 + smoothT * 6.0) * 0.08;

            float size = baseSize * sizeTaper * strandSize * pulse * strength;
            size *= entanglementFade; // Shrink as windows get close
            gl_PointSize = max(0.5, size * (450.0 / max(-mvPosition.z, 1.0)));

            // === ENERGY/GLOW ===
            float energy = 0.0;

            // Traveling energy pulse - coherent across windows
            float pulseSpeed = 0.4;
            float pulsePos = fract(globalTime * pulseSpeed);
            float pulseDist = abs(smoothT - pulsePos);
            pulseDist = min(pulseDist, 1.0 - pulseDist);
            energy += smoothstep(0.12, 0.0, pulseDist) * 0.6;

            // Second pulse traveling opposite direction
            float pulse2Pos = fract(-globalTime * pulseSpeed * 0.8 + 0.5);
            float pulse2Dist = abs(smoothT - pulse2Pos);
            pulse2Dist = min(pulse2Dist, 1.0 - pulse2Dist);
            energy += smoothstep(0.1, 0.0, pulse2Dist) * 0.4;

            // Origin glow - brighter at source
            float originGlow = exp(-smoothT * 4.0) * 0.5;
            energy += originGlow;

            // === NUCLEUS INFLUENCE ===
            float distFromNucleus = length(pos - uThisCenter);
            float nucleusProximity = 1.0 - smoothstep(uNucleusRadius * 0.8, uNucleusRadius * 2.5, distFromNucleus);
            float nucleusPulse = sin(globalTime * 3.0 + float(connIdx) * 0.5) * 0.5 + 0.5;
            nucleusProximity *= (0.7 + nucleusPulse * 0.5);
            energy += nucleusProximity * 0.5;
            vNucleusInfluence = nucleusProximity;

            vEnergy = energy * strength;

            // === ALPHA ===
            float distFade = smoothstep(2000.0, 200.0, connectionDist);
            float densityVar = 0.75 + hash(particleID * 0.41) * 0.25;

            // Alpha also tapers - more opaque at origin
            float alphaTaper = 0.4 + sizeTaper * 0.6;

            float alpha = alphaTaper * (0.8 + energy * 0.4) * distFade * densityVar;
            alpha *= isActive * strength * 1.5 * entanglementFade;
            if (isIncoming) alpha *= 0.85;
            vAlpha = max(alpha, 0.08 * sizeTaper * distFade * isActive * entanglementFade);

            // === COLOR ===
            vec3 srcColor = isIncoming ? targetColor : uNucleusColor;
            vec3 dstColor = isIncoming ? uNucleusColor : targetColor;

            // Gradient along strand with strand-specific tint
            vec3 baseColor = mix(srcColor, dstColor, smoothT);

            // Each strand has subtle color variation
            vec3 strandTints[3];
            strandTints[0] = vec3(1.0, 0.95, 0.9);  // Warm
            strandTints[1] = vec3(0.95, 1.0, 0.98); // Neutral
            strandTints[2] = vec3(0.9, 0.95, 1.0);  // Cool
            baseColor *= strandTints[strandIdx];

            // Energy brightens toward white
            baseColor = mix(baseColor, vec3(1.0), energy * 0.35);

            float brightness = 0.85 + energy * 0.2 + sizeTaper * 0.15;
            vColor = baseColor * brightness;
        }
    `;

    const tendrilFragmentShader = `
        precision highp float;

        varying float vAlpha;
        varying vec3 vColor;
        varying float vEnergy;
        varying float vProgress;
        varying float vDirection;
        varying float vHelixStrand; // 0, 1, or 2 for tri-helix
        varying float vNucleusInfluence;

        // Simplex noise for plasma effects
        vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
        vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
        vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }
        float snoise(vec2 v) {
            const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
            vec2 i = floor(v + dot(v, C.yy));
            vec2 x0 = v - i + dot(i, C.xx);
            vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
            vec4 x12 = x0.xyxy + C.xxzz;
            x12.xy -= i1;
            i = mod289(i);
            vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
            vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
            m = m*m; m = m*m;
            vec3 x = 2.0 * fract(p * C.www) - 1.0;
            vec3 h = abs(x) - 0.5;
            vec3 ox = floor(x + 0.5);
            vec3 a0 = x - ox;
            m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
            vec3 g;
            g.x = a0.x * x0.x + h.x * x0.y;
            g.yz = a0.yz * x12.xz + h.yz * x12.yw;
            return 130.0 * dot(m, g);
        }

        void main() {
            if (vAlpha < 0.005) discard;

            vec2 center = gl_PointCoord - vec2(0.5);
            float dist = length(center);
            if (dist > 0.5) discard;

            // === ENHANCED PARTICLE SHAPE ===
            // Ultra-soft gaussian falloff with sharp core
            float softness = exp(-dist * dist * 8.0);
            
            // Bright crystalline core for quantum sparkle
            float core = smoothstep(0.18, 0.0, dist);
            float innerCore = smoothstep(0.08, 0.0, dist) * 0.8;
            
            // Expanded outer glow for visibility
            float glow = smoothstep(0.5, 0.1, dist) * 0.55;
            
            // === PLASMA/ENERGY EFFECTS ===
            // Dynamic plasma distortion for complexity
            vec2 noiseCoord = center * 3.0 + vec2(vProgress * 2.0, vHelixStrand * 2.0);
            float plasma = snoise(noiseCoord) * 0.15 + 0.5;
            
            // Energy ripples emanating from core
            float ripple = sin(dist * 25.0 - vEnergy * 8.0) * 0.1 + 0.9;
            ripple = mix(1.0, ripple, vEnergy);
            
            // === NUCLEUS INFLUENCE - brighter glow near nucleus ===
            float nucleusGlow = vNucleusInfluence * 0.5;
            
            // === GAMMA CORRECTION & VISIBILITY BOOST ===
            // Apply gamma for increased visibility (MAJOR OPACITY BOOST)
            float gammaBoost = 2.2; // Increase gamma significantly
            float energyBoost = 1.0 + vEnergy * 0.8 + nucleusGlow;
            
            float shape = (softness * 0.7 + core * 0.6 + innerCore + glow) * energyBoost * plasma * ripple;
            
            // DRAMATICALLY INCREASED BASE ALPHA (was 0.01 threshold, now 0.005)
            float baseAlpha = vAlpha * 2.8; // TRIPLE the alpha multiplier
            baseAlpha = pow(baseAlpha, 1.0 / gammaBoost); // Gamma lift
            float finalAlpha = baseAlpha * shape;
            
            // Nucleus proximity boosts alpha
            finalAlpha += vNucleusInfluence * 0.15;
            
            // Ensure minimum visibility for active tendrils
            finalAlpha = max(finalAlpha, 0.15 * smoothstep(0.5, 0.2, dist) * step(0.01, vAlpha));

            // === ENHANCED COLOR ===
            vec3 finalColor = vColor;
            
            // Nucleus influence adds bright white core glow
            float nucleusBright = vNucleusInfluence * smoothstep(0.3, 0.0, dist) * 0.6;
            finalColor = mix(finalColor, vec3(1.0, 1.0, 0.95), nucleusBright);
            
            // Intense center brightening
            float centerBright = smoothstep(0.15, 0.0, dist) * 0.45;
            finalColor = mix(finalColor, vec3(1.0), centerBright);
            
            // Add quantum shimmer based on position
            float shimmer = snoise(center * 8.0 + vec2(vProgress * 3.0, 0.0)) * 0.08;
            finalColor += shimmer;
            
            // === CHROMATIC ABERRATION for ethereal depth ===
            float edgeChroma = smoothstep(0.12, 0.45, dist) * 0.12;
            if (vDirection > 0.0) {
                // Warm outgoing - gold/amber tint
                finalColor.r += edgeChroma * 0.5;
                finalColor.g += edgeChroma * 0.25;
            } else {
                // Cool incoming - cyan/blue tint  
                finalColor.b += edgeChroma * 0.6;
                finalColor.g += edgeChroma * 0.35;
            }
            
            // Energy adds spectral color
            vec3 energyColor = mix(vec3(0.8, 0.9, 1.0), vec3(1.0, 0.95, 0.85), vDirection * 0.5 + 0.5);
            finalColor = mix(finalColor, energyColor, vEnergy * 0.3);
            
            // Final brightness boost
            finalColor *= 1.15;
            
            // Saturate to prevent over-bright
            finalColor = clamp(finalColor, 0.0, 1.2);

            gl_FragColor = vec4(finalColor, finalAlpha);
        }
    `;

    tendrilMaterial = new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0.0 },
            uThisCenter: { value: new THREE.Vector3(0, 0, 0) },
            // 8 connections: 0-3 outgoing, 4-7 incoming
            uTargetCenters: { value: [
                new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 0),
                new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 0),
                new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 0),
                new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 0)
            ]},
            uTargetActive: { value: [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0] },
            uCloudRadius: { value: MEMBRANE_MAX_RADIUS },
            uNucleusRadius: { value: LAYER_CONFIG[0].outerRadius },
            uNucleusColor: { value: new THREE.Vector3(...LAYER_CONFIG[0].baseColor) },
            // Target cloud colors for bidirectional color blending (8 connections)
            uTargetColors: { value: [
                new THREE.Vector3(0.4, 0.9, 1.0), new THREE.Vector3(0.4, 0.9, 1.0),
                new THREE.Vector3(0.4, 0.9, 1.0), new THREE.Vector3(0.4, 0.9, 1.0),
                new THREE.Vector3(1.0, 0.5, 0.9), new THREE.Vector3(1.0, 0.5, 0.9),
                new THREE.Vector3(1.0, 0.5, 0.9), new THREE.Vector3(1.0, 0.5, 0.9)
            ]},
            // Connection strength per target (8 connections)
            uConnectionStrengths: { value: [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0] },
            // Entanglement progress per connection (0 = far apart, 1 = merged)
            // Used to fade out tendrils as windows get close
            uEntanglementProgress: { value: [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0] },
            // Global time sync offset for coherent cross-window animation
            uGlobalTimeOffset: { value: 0.0 }
        },
        vertexShader: tendrilVertexShader,
        fragmentShader: tendrilFragmentShader,
        blending: THREE.AdditiveBlending,  // Ethereal glowing appearance
        transparent: true,
        depthTest: false,  // Don't depth test - always draw
        depthWrite: false
    });

    tendrilPoints = new THREE.Points(tendrilGeometry, tendrilMaterial);
    tendrilPoints.renderOrder = 100; // Render after main particles
    tendrilPoints.frustumCulled = false; // Always render, don't cull
    scene.add(tendrilPoints);

    console.log("Tendril system initialized with", TENDRIL_PARTICLE_COUNT * TENDRIL_MAX_CONNECTIONS, "particles");
}

/**
 * Initialize ambient dust particle system for atmospheric depth
 */
function initDust() {
    dustGeometry = new THREE.BufferGeometry();

    // Attributes for dust particles
    const positions = new Float32Array(DUST_PARTICLE_COUNT * 3);
    const randomSeeds = new Float32Array(DUST_PARTICLE_COUNT);
    const sizes = new Float32Array(DUST_PARTICLE_COUNT);

    for (let i = 0; i < DUST_PARTICLE_COUNT; i++) {
        // Distribute dust throughout a larger volume around the scene
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        const r = Math.random() * DUST_SPREAD;

        positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
        positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
        positions[i * 3 + 2] = r * Math.cos(phi);

        // Random seed for animation variation
        randomSeeds[i] = Math.random();

        // Varying sizes for depth
        sizes[i] = DUST_SIZE * (0.3 + Math.random() * 0.7);
    }

    dustGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    dustGeometry.setAttribute('randomSeed', new THREE.BufferAttribute(randomSeeds, 1));
    dustGeometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    // Dust shader - simple atmospheric particles
    const dustVertexShader = `
        attribute float randomSeed;
        attribute float size;

        uniform float uTime;
        uniform float uDriftSpeed;
        uniform vec3 uSceneCenter;

        varying float vAlpha;
        varying float vDepth;

        // Simple pseudo-random
        float hash(float n) {
            return fract(sin(n) * 43758.5453123);
        }

        void main() {
            vec3 pos = position;

            // Gentle drift based on time and seed
            float drift = uTime * uDriftSpeed;
            float seedX = hash(randomSeed * 12.9898);
            float seedY = hash(randomSeed * 78.233);
            float seedZ = hash(randomSeed * 37.719);

            // Multi-frequency drift for organic feel
            pos.x += sin(drift * (0.5 + seedX * 0.5) + seedX * 6.28) * 3.0;
            pos.y += sin(drift * (0.3 + seedY * 0.4) + seedY * 6.28 + 1.0) * 2.0;
            pos.z += cos(drift * (0.4 + seedZ * 0.3) + seedZ * 6.28) * 2.5;

            // Subtle swirl around origin
            float angle = uTime * 0.02 + seedX * 6.28;
            float dist = length(pos.xz);
            float swirlStrength = smoothstep(100.0, 0.0, dist) * 0.3;
            pos.x += cos(angle) * swirlStrength;
            pos.z += sin(angle) * swirlStrength;

            vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
            gl_Position = projectionMatrix * mvPosition;

            // Size attenuation with distance
            gl_PointSize = size * (300.0 / -mvPosition.z);

            // Alpha based on distance from camera and depth
            vDepth = -mvPosition.z;
            float distFromCenter = length(pos);

            // Fade near edges of dust volume and near camera
            float edgeFade = 1.0 - smoothstep(${(DUST_SPREAD * 0.7).toFixed(1)}, ${DUST_SPREAD.toFixed(1)}, distFromCenter);
            float nearFade = smoothstep(10.0, 40.0, vDepth);
            float farFade = 1.0 - smoothstep(200.0, 300.0, vDepth);

            vAlpha = edgeFade * nearFade * farFade;

            // Subtle twinkle
            float twinkle = 0.7 + 0.3 * sin(uTime * 2.0 + randomSeed * 100.0);
            vAlpha *= twinkle;
        }
    `;

    const dustFragmentShader = `
        uniform float uBaseAlpha;

        varying float vAlpha;
        varying float vDepth;

        void main() {
            // Soft circular particle
            vec2 center = gl_PointCoord - vec2(0.5);
            float dist = length(center);

            // Very soft falloff for dust
            float alpha = smoothstep(0.5, 0.0, dist);
            alpha *= vAlpha * uBaseAlpha;

            // Subtle color - slightly warm grey/white
            vec3 dustColor = vec3(0.9, 0.88, 0.85);

            // Add slight depth-based color shift (cooler in distance)
            float depthShift = smoothstep(50.0, 200.0, vDepth);
            dustColor = mix(dustColor, vec3(0.7, 0.75, 0.85), depthShift * 0.3);

            gl_FragColor = vec4(dustColor, alpha);
        }
    `;

    dustMaterial = new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0.0 },
            uDriftSpeed: { value: DUST_DRIFT_SPEED },
            uBaseAlpha: { value: DUST_ALPHA },
            uSceneCenter: { value: new THREE.Vector3(0, 0, 0) }
        },
        vertexShader: dustVertexShader,
        fragmentShader: dustFragmentShader,
        blending: THREE.NormalBlending,
        transparent: true,
        depthTest: true,
        depthWrite: false
    });

    dustPoints = new THREE.Points(dustGeometry, dustMaterial);
    scene.add(dustPoints);

    console.log("Ambient dust system initialized");
}

/**
 * Update tendril target positions from other windows
 * TRUE Bidirectional: 8 connections (4 outgoing + 4 incoming)
 * Outgoing (0-3): Particles flow FROM this cloud TO other windows
 * Incoming (4-7): Particles flow FROM other windows TO this cloud (simulated)
 */
function updateTendrilTargets(otherWindows, deltaTime, elapsedTime) {
    if (!tendrilMaterial) return;

    const targets = tendrilMaterial.uniforms.uTargetCenters.value;
    const active = tendrilMaterial.uniforms.uTargetActive.value;
    const targetColors = tendrilMaterial.uniforms.uTargetColors.value;
    const connectionStrengths = tendrilMaterial.uniforms.uConnectionStrengths.value;
    const entanglementProgress = tendrilMaterial.uniforms.uEntanglementProgress.value;
    const thisWindow = windowManager.getThisWindow();

    // 8 connection states: 0-3 outgoing, 4-7 incoming
    const targetStates = [0, 0, 0, 0, 0, 0, 0, 0];

    if (thisWindow) {
        const centerX = thisWindow.center.x;
        const centerY = -thisWindow.center.y; // Y inverted for world coords

        if (otherWindows.length > 0) {
            const count = Math.min(otherWindows.length, TENDRIL_OUTGOING_COUNT);

            for (let i = 0; i < count; i++) {
                const win = otherWindows[i];
                const worldX = win.center.x;
                const worldY = -win.center.y;

                // Calculate distance and strength
                const dx = worldX - centerX;
                const dy = worldY - centerY;
                const dist = Math.sqrt(dx * dx + dy * dy);
                const normalizedDist = Math.min(1.0, dist / 2500.0);
                const strength = 1.0 - normalizedDist * 0.4; // 0.6 - 1.0

                // === GET ENTANGLEMENT STATE FOR THIS WINDOW ===
                const windowId = win.id;
                const entState = entanglementStates[windowId];
                const entProgress = entState ? entState.progress : 0.0;

                // === OUTGOING CONNECTIONS (0-3) ===
                targets[i].set(worldX, worldY, 0);
                targetStates[i] = 1;
                connectionStrengths[i] = strength;
                entanglementProgress[i] = entProgress;

                // Outgoing color: use nucleus color (white for parent, green for child)
                targetColors[i].set(0.5 + i * 0.1, 0.9, 1.0);

                // === INCOMING CONNECTIONS (4-7) ===
                const incomingIdx = i + TENDRIL_OUTGOING_COUNT;
                targets[incomingIdx].set(worldX, worldY, 0);
                targetStates[incomingIdx] = 1;
                connectionStrengths[incomingIdx] = strength * 0.95;
                entanglementProgress[incomingIdx] = entProgress;

                // Incoming color: magenta-pink quantum stream
                targetColors[incomingIdx].set(1.0, 0.5 + i * 0.08, 0.9);

                // Verbose logging with entanglement info
                if (Math.random() < 0.003) {
                    console.log(`[Tendril] Window ${win.id}: dist=${dist.toFixed(0)}px | ` +
                                `strength=${strength.toFixed(2)} | entanglement=${entProgress.toFixed(2)}`);
                }
            }
        }

        // Update this center uniform
        tendrilMaterial.uniforms.uThisCenter.value.set(centerX, centerY, 0);
    }

    // Smooth connection state transitions for all 8 connections
    const dt = deltaTime || 0.016;
    for (let i = 0; i < TENDRIL_MAX_CONNECTIONS; i++) {
        const target = targetStates[i];
        const current = connectionStates[i];

        if (target > current) {
            connectionStates[i] = Math.min(target, current + CONNECTION_FADE_SPEED * dt);
        } else if (target < current) {
            connectionStates[i] = Math.max(target, current - CONNECTION_FADE_SPEED * dt);
        }

        active[i] = connectionStates[i];
    }
}

/**
 * Update tendrils each frame
 */
function updateTendrils(elapsedTime, deltaTime) {
    if (!tendrilMaterial || !windowManager) return;

    // Update time uniform
    tendrilMaterial.uniforms.uTime.value = elapsedTime;

    // Get other windows for tendril connections
    const otherWindows = windowManager.getOtherWindows();
    const thisWindow = windowManager.getThisWindow();

    // Log connection state periodically
    if (otherWindows.length > 0 && Math.random() < 0.008) {
        const activeCount = connectionStates.filter(s => s > 0.1).length;
        console.log(`[Tendrils] ${otherWindows.length} window(s) detected | ` +
                    `Active connections: ${activeCount} | ` +
                    `States: [${connectionStates.map(s => s.toFixed(2)).join(', ')}]`);
    }

    // Log when connections form/break
    const prevActiveCount = connectionStates.filter(s => s > 0.5).length;
    updateTendrilTargets(otherWindows, deltaTime, elapsedTime);
    const newActiveCount = connectionStates.filter(s => s > 0.5).length;

    if (newActiveCount !== prevActiveCount) {
        console.log(`[Tendrils] Connection change: ${prevActiveCount} → ${newActiveCount} active`);
    }

    // Position at world origin (shader handles absolute positioning)
    tendrilPoints.position.set(0, 0, 0);
}

/**
 * Initialize ghost clouds for rendering other windows' particle clouds
 * Uses custom ShaderMaterial for circular particles (not squares)
 */
function initGhostClouds() {
    // Ghost cloud shader for soft circular particles
    const ghostCloudVertexShader = `
        attribute float size;
        attribute float randomSeed;
        
        uniform float uTime;
        uniform float uOpacity;
        
        varying vec3 vColor;
        varying float vAlpha;
        varying float vSize;
        
        void main() {
            vColor = color;
            
            // Gentle animation - breathing and subtle movement
            vec3 pos = position;
            float seed = randomSeed * 6.28318;
            float breathe = sin(uTime * 0.5 + seed) * 0.03 + 1.0;
            pos *= breathe;
            
            // Subtle drift
            float drift = sin(uTime * 0.3 + seed * 2.0) * 2.0;
            pos.x += drift * 0.5;
            pos.y += cos(uTime * 0.25 + seed) * 1.5;
            
            vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
            gl_Position = projectionMatrix * mvPosition;
            
            // Size with distance attenuation
            float baseSize = size * (400.0 / max(-mvPosition.z, 1.0));
            gl_PointSize = baseSize;
            vSize = baseSize;
            
            // Alpha based on distance from camera
            float depth = -mvPosition.z;
            float depthFade = smoothstep(300.0, 50.0, depth);
            vAlpha = uOpacity * depthFade;
        }
    `;
    
    const ghostCloudFragmentShader = `
        precision highp float;
        
        varying vec3 vColor;
        varying float vAlpha;
        varying float vSize;
        
        void main() {
            // Circular soft particle
            vec2 center = gl_PointCoord - vec2(0.5);
            float dist = length(center);
            
            // Discard outside circle
            if (dist > 0.5) discard;
            
            // Soft gaussian-like falloff for cloud-like appearance
            float softness = exp(-dist * dist * 8.0);
            
            // Subtle glow at edges
            float glow = smoothstep(0.5, 0.2, dist) * 0.4;
            
            float alpha = vAlpha * (softness + glow);
            
            // Slight color variation at edges
            vec3 finalColor = vColor;
            float edgeTint = smoothstep(0.2, 0.5, dist) * 0.15;
            finalColor = mix(finalColor, vec3(0.8, 0.9, 1.0), edgeTint);
            
            gl_FragColor = vec4(finalColor, alpha);
        }
    `;

    for (let i = 0; i < MAX_GHOST_CLOUDS; i++) {
        // Create a simple point cloud to represent another window's particles
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(GHOST_CLOUD_PARTICLE_COUNT * 3);
        const colors = new Float32Array(GHOST_CLOUD_PARTICLE_COUNT * 3);
        const sizes = new Float32Array(GHOST_CLOUD_PARTICLE_COUNT);
        const randomSeeds = new Float32Array(GHOST_CLOUD_PARTICLE_COUNT);

        // Generate spherical distribution of particles for the ghost cloud
        for (let j = 0; j < GHOST_CLOUD_PARTICLE_COUNT; j++) {
            const phi = Math.acos(2 * Math.random() - 1);
            const theta = Math.random() * Math.PI * 2;

            // Distribute across all layers for a full cloud effect
            const r = Math.pow(Math.random(), 0.4) * MEMBRANE_MAX_RADIUS * 0.9;

            positions[j * 3] = r * Math.sin(phi) * Math.cos(theta);
            positions[j * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
            positions[j * 3 + 2] = r * Math.cos(phi);

            // Use quantum cyan-magenta gradient based on radius
            const radiusNorm = r / MEMBRANE_MAX_RADIUS;
            // Core: white-cyan, Outer: soft lavender
            colors[j * 3] = 0.7 + radiusNorm * 0.2;     // R
            colors[j * 3 + 1] = 0.85 - radiusNorm * 0.1; // G
            colors[j * 3 + 2] = 0.95;                    // B

            sizes[j] = 1.5 + Math.random() * 1.0; // Slightly larger for better visibility
            randomSeeds[j] = Math.random();
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('randomSeed', new THREE.BufferAttribute(randomSeeds, 1));

        // Custom shader material for circular soft particles
        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0.0 },
                uOpacity: { value: 0.35 }
            },
            vertexShader: ghostCloudVertexShader,
            fragmentShader: ghostCloudFragmentShader,
            vertexColors: true,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            depthTest: true
        });

        const points = new THREE.Points(geometry, material);
        points.visible = false;  // Hidden until another window is detected

        scene.add(points);
        ghostClouds.push({
            mesh: points,
            windowId: null,
            targetPosition: new THREE.Vector3()
        });
    }

    console.log(`Ghost cloud system initialized (${MAX_GHOST_CLOUDS} slots with circular particles)`);
}

/**
 * Update ghost clouds to match other windows' positions
 * Implements cloud merging behavior - when windows get close,
 * the ghost cloud (other window's representation) moves toward and merges into this cloud
 */
function updateGhostClouds(otherWindows) {
    const thisWindow = windowManager ? windowManager.getThisWindow() : null;
    const thisCenter = thisWindow ? new THREE.Vector3(thisWindow.center.x, -thisWindow.center.y, 0) : null;

    for (let i = 0; i < MAX_GHOST_CLOUDS; i++) {
        const ghost = ghostClouds[i];

        if (i < otherWindows.length) {
            const otherWindow = otherWindows[i];

            // Show and position the ghost cloud
            ghost.mesh.visible = true;
            ghost.windowId = otherWindow.id;

            // Base target position at the other window's screen center (Y inverted)
            const baseTargetX = otherWindow.center.x;
            const baseTargetY = -otherWindow.center.y;

            // === ENTANGLEMENT-BASED CLOUD MERGING ===
            const entState = entanglementStates[otherWindow.id];
            const entProgress = entState ? entState.progress : 0.0;

            // When entanglement is high, ghost cloud moves TOWARD this window's cloud
            // This creates the effect of the child cloud "merging into" the parent cloud
            let finalTargetX = baseTargetX;
            let finalTargetY = baseTargetY;

            if (thisCenter && entProgress > 0.1) {
                // Calculate merge trajectory - ghost moves toward this cloud's center
                const mergeStrength = smoothstep(0.1, 0.9, entProgress);

                // Interpolate between base position and this cloud's position
                finalTargetX = lerp(baseTargetX, thisCenter.x, mergeStrength * 0.95);
                finalTargetY = lerp(baseTargetY, thisCenter.y, mergeStrength * 0.95);

                // Add slight spiral motion during merge for visual interest
                const spiralAngle = entProgress * Math.PI * 4 + performance.now() * 0.002;
                const spiralRadius = (1.0 - mergeStrength) * 30;
                finalTargetX += Math.cos(spiralAngle) * spiralRadius;
                finalTargetY += Math.sin(spiralAngle) * spiralRadius;
            }

            // Smooth movement towards target (faster when merging)
            ghost.targetPosition.set(finalTargetX, finalTargetY, 0);
            const lerpSpeed = entProgress > 0.3 ? 0.15 : 0.08;
            ghost.mesh.position.lerp(ghost.targetPosition, lerpSpeed);

            // === SCALE AND OPACITY DURING MERGE ===
            if (entProgress > 0) {
                // Scale down progressively as clouds merge
                // Starts at 1.0, goes to 0.15 at full merge
                const scale = Math.max(0.15, 1.0 - entProgress * 0.85);
                ghost.mesh.scale.setScalar(scale);

                // Opacity: fade slightly then pulse at full merge
                const baseFade = 1.0 - entProgress * 0.5;
                const mergePulse = entProgress > 0.7 ? Math.sin(performance.now() * 0.01) * 0.15 : 0;
                ghost.mesh.material.uniforms.uOpacity.value = 0.35 * (baseFade + mergePulse);

                // Log merge progress periodically
                if (Math.random() < 0.005 && entProgress > 0.2) {
                    console.log(`[Merge] Window ${otherWindow.id}: progress=${(entProgress * 100).toFixed(0)}%, ` +
                                `scale=${scale.toFixed(2)}, pos=(${finalTargetX.toFixed(0)}, ${finalTargetY.toFixed(0)})`);
                }
            } else {
                ghost.mesh.scale.setScalar(1.0);
                ghost.mesh.material.uniforms.uOpacity.value = 0.35;
            }
        } else {
            // No corresponding window, hide the ghost
            ghost.mesh.visible = false;
            ghost.windowId = null;
        }
    }
}

// Helper functions for smooth interpolation
function lerp(a, b, t) {
    return a + (b - a) * t;
}

function smoothstep(edge0, edge1, x) {
    const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
}

/**
 * Calculate distance between two window centers
 */
function getWindowDistance(window1, window2) {
    const dx = window1.center.x - window2.center.x;
    const dy = window1.center.y - window2.center.y;
    return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Update entanglement states for ALL windows (bidirectional)
 * Both parent and child windows track entanglement with each other
 * This enables the merging animation to work from both perspectives
 */
function updateEntanglement(deltaTime) {
    if (!windowManager) return;

    const thisWindow = windowManager.getThisWindow();
    const otherWindows = windowManager.getOtherWindows();

    if (!thisWindow) return;

    // Process entanglement with ALL other windows (not just parent/child)
    for (const otherWindow of otherWindows) {
        const windowId = otherWindow.id;
        const distance = getWindowDistance(thisWindow, otherWindow);

        // Initialize state if not exists
        if (!entanglementStates[windowId]) {
            entanglementStates[windowId] = {
                progress: 0,
                isEntangling: false,
                peakIntensity: 0
            };
        }

        const state = entanglementStates[windowId];

        // Determine if windows are close enough for entanglement
        if (distance < ENTANGLEMENT_DISTANCE_THRESHOLD) {
            state.isEntangling = true;

            // Calculate target progress based on distance
            // Closer = higher progress (0 at threshold, 1 at merge distance)
            const normalizedDist = Math.max(0, (ENTANGLEMENT_DISTANCE_THRESHOLD - distance) /
                (ENTANGLEMENT_DISTANCE_THRESHOLD - ENTANGLEMENT_MERGE_DISTANCE));
            const targetProgress = Math.min(1, normalizedDist);

            // Smoothly interpolate progress
            state.progress += (targetProgress - state.progress) * ENTANGLEMENT_SPEED * deltaTime * 2;
            state.peakIntensity = Math.max(state.peakIntensity, state.progress);

            // Log when entanglement starts
            if (state.progress > 0.1 && state.progress < 0.15) {
                console.log(`[Entanglement] Window ${windowId} entering range, distance: ${distance.toFixed(0)}px`);
            }

            // Log merge threshold
            if (state.progress > 0.85 && state.peakIntensity < 0.9) {
                console.log(`[Entanglement] Window ${windowId} MERGING! progress: ${(state.progress * 100).toFixed(0)}%`);
            }
        } else {
            // Windows moving apart - gradually reduce entanglement
            state.isEntangling = false;
            state.progress *= Math.max(0.92, 1 - deltaTime * ENTANGLEMENT_SPEED * 0.8);

            if (state.progress < 0.01) {
                state.progress = 0;
                state.peakIntensity = 0;
            }
        }
    }

    // Clean up states for windows that no longer exist
    const otherIds = otherWindows.map(w => String(w.id));
    for (const windowId in entanglementStates) {
        if (!otherIds.includes(String(windowId))) {
            delete entanglementStates[windowId];
        }
    }
}

/**
 * Get the total entanglement intensity (for visual effects)
 */
function getTotalEntanglementIntensity() {
    let total = 0;
    for (const windowId in entanglementStates) {
        total += entanglementStates[windowId].progress;
    }
    return Math.min(1, total);
}

/**
 * Apply entanglement visual effects to the main particle cloud
 * Enhanced with more dramatic effects during merging
 */
function applyEntanglementEffects(elapsedTime) {
    const intensity = getTotalEntanglementIntensity();

    if (intensity > 0 && particlePoints) {
        // === PULSE EFFECT ===
        // Faster and stronger pulse as entanglement increases
        const pulseFreq = 3.0 + intensity * 8.0;
        const pulseAmp = 0.03 + intensity * 0.12;
        const pulse = 1.0 + Math.sin(elapsedTime * pulseFreq) * pulseAmp;

        // === EXPANSION DURING MERGE ===
        // Cloud expands slightly to "receive" the merging cloud
        const mergeExpansion = 1.0 + intensity * 0.15;

        // === BREATHING EFFECT ===
        // Slower breathing overlaid on the pulse
        const breathe = 1.0 + Math.sin(elapsedTime * 0.8) * 0.02 * intensity;

        const finalScale = pulse * mergeExpansion * breathe;
        particlePoints.scale.setScalar(finalScale);

        // Update particle material if it has entanglement uniform
        if (particlePoints.material.uniforms && particlePoints.material.uniforms.uEntanglementIntensity) {
            particlePoints.material.uniforms.uEntanglementIntensity.value = intensity;
        }

        // === BLOOM ENHANCEMENT DURING MERGE ===
        // Increase bloom strength during merge for dramatic glow effect
        if (bloomPass && intensity > 0.3) {
            const bloomBoost = 1.0 + (intensity - 0.3) * 0.5; // Subtle bloom increase
            bloomPass.strength = BLOOM_STRENGTH * bloomBoost;
        }

        // === LOG HIGH ENTANGLEMENT STATES ===
        if (intensity > 0.8 && Math.random() < 0.01) {
            console.log(`[Entanglement] HIGH INTENSITY: ${(intensity * 100).toFixed(0)}% - ` +
                        `scale=${finalScale.toFixed(3)}`);
        }
    } else if (particlePoints) {
        particlePoints.scale.setScalar(1.0);

        // Reset bloom to default
        if (bloomPass) {
            bloomPass.strength = BLOOM_STRENGTH;
        }
    }
}

// Initialize everything
init();
