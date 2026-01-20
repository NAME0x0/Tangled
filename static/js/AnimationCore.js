/**
 * AnimationCore.js - Advanced Animation Systems for Tangled
 * 
 * Provides:
 * - Spring physics with damping and stiffness
 * - Comprehensive easing library (cubic-bezier, elastic, bounce, spring)
 * - Anticipation and follow-through system
 * - Global breathing rhythm (60/120 BPM sync)
 * - Per-particle stagger system based on distance
 * - Animation timeline and sequencing
 */

// =============================================================================
// SPRING PHYSICS CLASS
// =============================================================================

/**
 * Spring physics simulation for organic motion
 * Uses a damped harmonic oscillator model
 */
export class Spring {
    constructor(options = {}) {
        this.value = options.initial ?? 0;
        this.target = options.target ?? 0;
        this.velocity = 0;
        
        // Spring parameters
        this.stiffness = options.stiffness ?? 180;  // Higher = snappier
        this.damping = options.damping ?? 12;       // Higher = less bouncy
        this.mass = options.mass ?? 1;
        
        // Precision threshold for "at rest" detection
        this.precision = options.precision ?? 0.001;
        this.velocityPrecision = options.velocityPrecision ?? 0.001;
        
        this.isAtRest = true;
    }
    
    /**
     * Set a new target value
     */
    setTarget(target) {
        if (Math.abs(this.target - target) > this.precision) {
            this.target = target;
            this.isAtRest = false;
        }
    }
    
    /**
     * Instantly set the value (no animation)
     */
    setValue(value) {
        this.value = value;
        this.target = value;
        this.velocity = 0;
        this.isAtRest = true;
    }
    
    /**
     * Update the spring physics (call each frame)
     * @param {number} deltaTime - Time since last update in seconds
     * @returns {number} Current value
     */
    update(deltaTime) {
        if (this.isAtRest) return this.value;
        
        // Clamp deltaTime to prevent instability
        const dt = Math.min(deltaTime, 0.064);
        
        // Spring force: F = -k * x (Hooke's law)
        const displacement = this.value - this.target;
        const springForce = -this.stiffness * displacement;
        
        // Damping force: F = -c * v
        const dampingForce = -this.damping * this.velocity;
        
        // Total acceleration: a = F / m
        const acceleration = (springForce + dampingForce) / this.mass;
        
        // Integrate velocity and position (semi-implicit Euler)
        this.velocity += acceleration * dt;
        this.value += this.velocity * dt;
        
        // Check if at rest
        if (Math.abs(displacement) < this.precision && 
            Math.abs(this.velocity) < this.velocityPrecision) {
            this.value = this.target;
            this.velocity = 0;
            this.isAtRest = true;
        }
        
        return this.value;
    }
    
    /**
     * Apply an impulse (instant velocity change)
     */
    impulse(force) {
        this.velocity += force / this.mass;
        this.isAtRest = false;
    }
}

/**
 * 3D Spring for vector values
 */
export class Spring3D {
    constructor(options = {}) {
        const initial = options.initial ?? { x: 0, y: 0, z: 0 };
        const target = options.target ?? { x: 0, y: 0, z: 0 };
        
        this.x = new Spring({ ...options, initial: initial.x, target: target.x });
        this.y = new Spring({ ...options, initial: initial.y, target: target.y });
        this.z = new Spring({ ...options, initial: initial.z, target: target.z });
    }
    
    setTarget(x, y, z) {
        this.x.setTarget(x);
        this.y.setTarget(y);
        this.z.setTarget(z);
    }
    
    setValue(x, y, z) {
        this.x.setValue(x);
        this.y.setValue(y);
        this.z.setValue(z);
    }
    
    update(deltaTime) {
        return {
            x: this.x.update(deltaTime),
            y: this.y.update(deltaTime),
            z: this.z.update(deltaTime)
        };
    }
    
    get value() {
        return { x: this.x.value, y: this.y.value, z: this.z.value };
    }
    
    get isAtRest() {
        return this.x.isAtRest && this.y.isAtRest && this.z.isAtRest;
    }
    
    impulse(fx, fy, fz) {
        this.x.impulse(fx);
        this.y.impulse(fy);
        this.z.impulse(fz);
    }
}

// =============================================================================
// EASING LIBRARY
// =============================================================================

/**
 * Comprehensive easing functions for smooth animations
 * All functions take t (0-1) and return transformed t (0-1)
 */
export const Easing = {
    // Linear (no easing)
    linear: t => t,
    
    // Quadratic
    easeInQuad: t => t * t,
    easeOutQuad: t => t * (2 - t),
    easeInOutQuad: t => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,
    
    // Cubic
    easeInCubic: t => t * t * t,
    easeOutCubic: t => (--t) * t * t + 1,
    easeInOutCubic: t => t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1,
    
    // Quartic
    easeInQuart: t => t * t * t * t,
    easeOutQuart: t => 1 - (--t) * t * t * t,
    easeInOutQuart: t => t < 0.5 ? 8 * t * t * t * t : 1 - 8 * (--t) * t * t * t,
    
    // Quintic
    easeInQuint: t => t * t * t * t * t,
    easeOutQuint: t => 1 + (--t) * t * t * t * t,
    easeInOutQuint: t => t < 0.5 ? 16 * t * t * t * t * t : 1 + 16 * (--t) * t * t * t * t,
    
    // Sinusoidal
    easeInSine: t => 1 - Math.cos(t * Math.PI / 2),
    easeOutSine: t => Math.sin(t * Math.PI / 2),
    easeInOutSine: t => -(Math.cos(Math.PI * t) - 1) / 2,
    
    // Exponential
    easeInExpo: t => t === 0 ? 0 : Math.pow(2, 10 * (t - 1)),
    easeOutExpo: t => t === 1 ? 1 : 1 - Math.pow(2, -10 * t),
    easeInOutExpo: t => {
        if (t === 0) return 0;
        if (t === 1) return 1;
        if (t < 0.5) return Math.pow(2, 20 * t - 10) / 2;
        return (2 - Math.pow(2, -20 * t + 10)) / 2;
    },
    
    // Circular
    easeInCirc: t => 1 - Math.sqrt(1 - t * t),
    easeOutCirc: t => Math.sqrt(1 - (--t) * t),
    easeInOutCirc: t => t < 0.5
        ? (1 - Math.sqrt(1 - 4 * t * t)) / 2
        : (Math.sqrt(1 - Math.pow(-2 * t + 2, 2)) + 1) / 2,
    
    // Elastic (spring-like overshoot)
    easeInElastic: (t, amplitude = 1, period = 0.3) => {
        if (t === 0 || t === 1) return t;
        const s = period / (2 * Math.PI) * Math.asin(1 / amplitude);
        return -(amplitude * Math.pow(2, 10 * (t - 1)) * Math.sin((t - 1 - s) * (2 * Math.PI) / period));
    },
    easeOutElastic: (t, amplitude = 1, period = 0.3) => {
        if (t === 0 || t === 1) return t;
        const s = period / (2 * Math.PI) * Math.asin(1 / amplitude);
        return amplitude * Math.pow(2, -10 * t) * Math.sin((t - s) * (2 * Math.PI) / period) + 1;
    },
    easeInOutElastic: (t, amplitude = 1, period = 0.45) => {
        if (t === 0 || t === 1) return t;
        const s = period / (2 * Math.PI) * Math.asin(1 / amplitude);
        if (t < 0.5) {
            return -(amplitude * Math.pow(2, 20 * t - 10) * Math.sin((20 * t - 11.125) * (2 * Math.PI) / period)) / 2;
        }
        return (amplitude * Math.pow(2, -20 * t + 10) * Math.sin((20 * t - 11.125) * (2 * Math.PI) / period)) / 2 + 1;
    },
    
    // Bounce
    easeInBounce: t => 1 - Easing.easeOutBounce(1 - t),
    easeOutBounce: t => {
        const n1 = 7.5625;
        const d1 = 2.75;
        if (t < 1 / d1) {
            return n1 * t * t;
        } else if (t < 2 / d1) {
            return n1 * (t -= 1.5 / d1) * t + 0.75;
        } else if (t < 2.5 / d1) {
            return n1 * (t -= 2.25 / d1) * t + 0.9375;
        } else {
            return n1 * (t -= 2.625 / d1) * t + 0.984375;
        }
    },
    easeInOutBounce: t => t < 0.5
        ? (1 - Easing.easeOutBounce(1 - 2 * t)) / 2
        : (1 + Easing.easeOutBounce(2 * t - 1)) / 2,
    
    // Back (overshoot)
    easeInBack: (t, overshoot = 1.70158) => t * t * ((overshoot + 1) * t - overshoot),
    easeOutBack: (t, overshoot = 1.70158) => {
        t = t - 1;
        return t * t * ((overshoot + 1) * t + overshoot) + 1;
    },
    easeInOutBack: (t, overshoot = 1.70158) => {
        const s = overshoot * 1.525;
        if (t < 0.5) {
            return (Math.pow(2 * t, 2) * ((s + 1) * 2 * t - s)) / 2;
        }
        return (Math.pow(2 * t - 2, 2) * ((s + 1) * (t * 2 - 2) + s) + 2) / 2;
    },
    
    // Custom cubic-bezier (like CSS transitions)
    cubicBezier: (x1, y1, x2, y2) => {
        // Newton-Raphson iteration to solve for t given x
        const NEWTON_ITERATIONS = 4;
        const NEWTON_MIN_SLOPE = 0.001;
        const SUBDIVISION_PRECISION = 0.0000001;
        const SUBDIVISION_MAX_ITERATIONS = 10;
        
        const ax = 3 * x1 - 3 * x2 + 1;
        const bx = 3 * x2 - 6 * x1;
        const cx = 3 * x1;
        
        const ay = 3 * y1 - 3 * y2 + 1;
        const by = 3 * y2 - 6 * y1;
        const cy = 3 * y1;
        
        const sampleCurveX = t => ((ax * t + bx) * t + cx) * t;
        const sampleCurveY = t => ((ay * t + by) * t + cy) * t;
        const sampleCurveDerivativeX = t => (3 * ax * t + 2 * bx) * t + cx;
        
        const solveCurveX = x => {
            let t2 = x;
            for (let i = 0; i < NEWTON_ITERATIONS; i++) {
                const slope = sampleCurveDerivativeX(t2);
                if (Math.abs(slope) < NEWTON_MIN_SLOPE) break;
                const currentX = sampleCurveX(t2) - x;
                t2 -= currentX / slope;
            }
            return t2;
        };
        
        return x => sampleCurveY(solveCurveX(x));
    },
    
    // Spring physics easing (critically damped)
    spring: (t, mass = 1, stiffness = 100, damping = 10) => {
        const w0 = Math.sqrt(stiffness / mass);
        const zeta = damping / (2 * Math.sqrt(stiffness * mass));
        
        if (zeta < 1) {
            // Underdamped
            const wd = w0 * Math.sqrt(1 - zeta * zeta);
            return 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + (zeta * w0 / wd) * Math.sin(wd * t));
        } else if (zeta === 1) {
            // Critically damped
            return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
        } else {
            // Overdamped
            const s1 = -w0 * (zeta + Math.sqrt(zeta * zeta - 1));
            const s2 = -w0 * (zeta - Math.sqrt(zeta * zeta - 1));
            return 1 - (s2 * Math.exp(s1 * t) - s1 * Math.exp(s2 * t)) / (s2 - s1);
        }
    }
};

// =============================================================================
// ANTICIPATION & FOLLOW-THROUGH SYSTEM
// =============================================================================

/**
 * Creates anticipation (wind-up) and follow-through (overshoot/settle) for animations
 * Based on Disney's 12 principles of animation
 */
export class AnticipationFollowThrough {
    constructor(options = {}) {
        this.anticipationRatio = options.anticipationRatio ?? 0.15;  // 15% of motion for anticipation
        this.followThroughRatio = options.followThroughRatio ?? 0.2; // 20% overshoot
        this.settleOscillations = options.settleOscillations ?? 2;   // Number of settle bounces
        this.duration = options.duration ?? 1.0;                     // Total animation duration
        
        this.startValue = 0;
        this.endValue = 1;
        this.currentTime = 0;
        this.isPlaying = false;
    }
    
    /**
     * Start an animation from startValue to endValue
     */
    start(startValue, endValue, duration = this.duration) {
        this.startValue = startValue;
        this.endValue = endValue;
        this.duration = duration;
        this.currentTime = 0;
        this.isPlaying = true;
    }
    
    /**
     * Update and get current value
     * @returns {number} Current animated value with anticipation/follow-through
     */
    update(deltaTime) {
        if (!this.isPlaying) return this.endValue;
        
        this.currentTime += deltaTime;
        const t = Math.min(this.currentTime / this.duration, 1);
        
        if (t >= 1) {
            this.isPlaying = false;
            return this.endValue;
        }
        
        // Phase breakdown:
        // 0 - anticipationEnd: Anticipation (move opposite to target)
        // anticipationEnd - mainEnd: Main motion
        // mainEnd - 1: Follow-through (overshoot and settle)
        
        const anticipationEnd = this.anticipationRatio;
        const mainEnd = 1 - this.followThroughRatio;
        
        let progress;
        const range = this.endValue - this.startValue;
        
        if (t < anticipationEnd) {
            // Anticipation phase - move backward slightly
            const localT = t / anticipationEnd;
            const anticipationAmount = -0.1 * range; // Move back 10% of total distance
            progress = Easing.easeOutQuad(localT) * anticipationAmount / range;
        } else if (t < mainEnd) {
            // Main motion phase
            const localT = (t - anticipationEnd) / (mainEnd - anticipationEnd);
            progress = Easing.easeInOutCubic(localT);
        } else {
            // Follow-through phase (overshoot and settle)
            const localT = (t - mainEnd) / this.followThroughRatio;
            const overshootAmount = this.followThroughRatio * 0.5; // Overshoot by half the follow-through ratio
            
            // Damped oscillation for settling
            const decay = Math.exp(-localT * 4);
            const oscillation = Math.cos(localT * Math.PI * 2 * this.settleOscillations);
            progress = 1 + overshootAmount * decay * oscillation;
        }
        
        return this.startValue + progress * range;
    }
    
    /**
     * Get current value without updating time (for reading)
     */
    getValue() {
        return this.update(0);
    }
}

// =============================================================================
// GLOBAL BREATHING RHYTHM
// =============================================================================

/**
 * Global breathing/pulse system synchronized across the entire visualization
 * Uses musical tempo concepts (60 BPM, 120 BPM) for natural rhythms
 */
export class BreathingRhythm {
    constructor(options = {}) {
        // Primary rhythm: 60 BPM = 1 beat per second (resting heart rate)
        this.primaryBPM = options.primaryBPM ?? 60;
        // Secondary rhythm: 120 BPM = 2 beats per second (active heart rate)
        this.secondaryBPM = options.secondaryBPM ?? 120;
        // Tertiary rhythm: slower breath (4 second cycle)
        this.breathCycleSeconds = options.breathCycleSeconds ?? 4;
        
        // Amplitudes for each rhythm layer
        this.primaryAmplitude = options.primaryAmplitude ?? 0.03;
        this.secondaryAmplitude = options.secondaryAmplitude ?? 0.015;
        this.breathAmplitude = options.breathAmplitude ?? 0.05;
        
        // Phase offsets for variation
        this.phaseOffset = 0;
        
        // Global time (can be synchronized across windows)
        this.globalTime = 0;
    }
    
    /**
     * Update with delta time
     */
    update(deltaTime) {
        this.globalTime += deltaTime;
    }
    
    /**
     * Set global time (for cross-window sync via BroadcastChannel)
     */
    setGlobalTime(time) {
        this.globalTime = time;
    }
    
    /**
     * Get the combined breathing value
     * @param {number} localPhase - Optional local phase offset (0-1) for stagger
     * @returns {number} Breathing multiplier (typically 0.9 - 1.1)
     */
    getValue(localPhase = 0) {
        const t = this.globalTime + localPhase * this.breathCycleSeconds;
        
        // Primary heartbeat (60 BPM)
        const primaryFreq = (this.primaryBPM / 60) * Math.PI * 2;
        const primary = Math.sin(t * primaryFreq) * this.primaryAmplitude;
        
        // Secondary faster pulse (120 BPM)
        const secondaryFreq = (this.secondaryBPM / 60) * Math.PI * 2;
        const secondary = Math.sin(t * secondaryFreq + 0.5) * this.secondaryAmplitude;
        
        // Slow breath cycle
        const breathFreq = (1 / this.breathCycleSeconds) * Math.PI * 2;
        const breath = Math.sin(t * breathFreq) * this.breathAmplitude;
        
        // Combine with slight non-linearity for organic feel
        const combined = primary + secondary + breath;
        return 1.0 + combined;
    }
    
    /**
     * Get individual rhythm components (for more control)
     */
    getComponents(localPhase = 0) {
        const t = this.globalTime + localPhase * this.breathCycleSeconds;
        
        return {
            primary: Math.sin(t * (this.primaryBPM / 60) * Math.PI * 2),
            secondary: Math.sin(t * (this.secondaryBPM / 60) * Math.PI * 2 + 0.5),
            breath: Math.sin(t * (1 / this.breathCycleSeconds) * Math.PI * 2),
            time: t
        };
    }
    
    /**
     * Get GLSL code for breathing rhythm (for shader integration)
     */
    static getGLSLCode() {
        return `
// Breathing rhythm function
// primaryBPM, secondaryBPM, breathCycleSeconds, amplitudes passed as uniforms
float getBreathingValue(float time, float localPhase, 
                        float primaryBPM, float secondaryBPM, float breathCycleSeconds,
                        float primaryAmp, float secondaryAmp, float breathAmp) {
    float t = time + localPhase * breathCycleSeconds;
    
    float primaryFreq = (primaryBPM / 60.0) * 6.28318530718;
    float primary = sin(t * primaryFreq) * primaryAmp;
    
    float secondaryFreq = (secondaryBPM / 60.0) * 6.28318530718;
    float secondary = sin(t * secondaryFreq + 0.5) * secondaryAmp;
    
    float breathFreq = (1.0 / breathCycleSeconds) * 6.28318530718;
    float breath = sin(t * breathFreq) * breathAmp;
    
    return 1.0 + primary + secondary + breath;
}
`;
    }
}

// =============================================================================
// STAGGER SYSTEM
// =============================================================================

/**
 * Per-element stagger system for wave-like animation propagation
 * Calculates delay based on distance, index, or custom function
 */
export class StaggerSystem {
    constructor(options = {}) {
        this.staggerType = options.type ?? 'distance';  // 'distance', 'index', 'radial', 'custom'
        this.staggerAmount = options.amount ?? 0.1;     // Seconds of stagger per unit
        this.maxStagger = options.maxStagger ?? 2.0;    // Maximum stagger delay
        this.origin = options.origin ?? { x: 0, y: 0, z: 0 };  // Origin point for distance calculations
        this.direction = options.direction ?? { x: 1, y: 0, z: 0 }; // Direction for directional stagger
        this.customFunction = options.customFunction ?? null;
    }
    
    /**
     * Calculate stagger delay for a position
     * @param {Object} position - {x, y, z} position
     * @param {number} index - Element index (optional)
     * @param {number} total - Total element count (optional)
     * @returns {number} Delay in seconds
     */
    getDelay(position, index = 0, total = 1) {
        let delay = 0;
        
        switch (this.staggerType) {
            case 'distance':
                // Stagger based on distance from origin
                const dx = position.x - this.origin.x;
                const dy = position.y - this.origin.y;
                const dz = position.z - this.origin.z;
                const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
                delay = distance * this.staggerAmount;
                break;
                
            case 'index':
                // Stagger based on element index
                delay = index * this.staggerAmount;
                break;
                
            case 'radial':
                // Stagger based on angle from origin (creates spiral effect)
                const angle = Math.atan2(position.y - this.origin.y, position.x - this.origin.x);
                const normalizedAngle = (angle + Math.PI) / (Math.PI * 2); // 0-1
                delay = normalizedAngle * this.maxStagger;
                break;
                
            case 'directional':
                // Stagger based on projection onto direction vector
                const dirLength = Math.sqrt(
                    this.direction.x * this.direction.x +
                    this.direction.y * this.direction.y +
                    this.direction.z * this.direction.z
                );
                if (dirLength > 0) {
                    const projection = (
                        (position.x - this.origin.x) * this.direction.x +
                        (position.y - this.origin.y) * this.direction.y +
                        (position.z - this.origin.z) * this.direction.z
                    ) / dirLength;
                    delay = Math.max(0, projection) * this.staggerAmount;
                }
                break;
                
            case 'random':
                // Pseudo-random stagger based on position (deterministic)
                const hash = Math.sin(position.x * 12.9898 + position.y * 78.233 + position.z * 37.719) * 43758.5453;
                delay = (hash - Math.floor(hash)) * this.maxStagger;
                break;
                
            case 'custom':
                if (this.customFunction) {
                    delay = this.customFunction(position, index, total);
                }
                break;
        }
        
        return Math.min(delay, this.maxStagger);
    }
    
    /**
     * Get normalized phase (0-1) for an element
     * Useful for shader integration
     */
    getPhase(position, index = 0, total = 1) {
        const delay = this.getDelay(position, index, total);
        return delay / this.maxStagger;
    }
    
    /**
     * Get GLSL code for stagger calculations
     */
    static getGLSLCode() {
        return `
// Stagger calculation functions
float getDistanceStagger(vec3 pos, vec3 origin, float staggerAmount, float maxStagger) {
    float dist = length(pos - origin);
    return min(dist * staggerAmount, maxStagger);
}

float getRadialStagger(vec3 pos, vec3 origin, float maxStagger) {
    float angle = atan(pos.y - origin.y, pos.x - origin.x);
    float normalizedAngle = (angle + 3.14159265359) / 6.28318530718;
    return normalizedAngle * maxStagger;
}

float getDirectionalStagger(vec3 pos, vec3 origin, vec3 direction, float staggerAmount, float maxStagger) {
    vec3 toPos = pos - origin;
    float projection = max(0.0, dot(toPos, normalize(direction)));
    return min(projection * staggerAmount, maxStagger);
}

// Pseudo-random stagger based on position
float getRandomStagger(vec3 pos, float maxStagger) {
    float hash = fract(sin(dot(pos, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    return hash * maxStagger;
}
`;
    }
}

// =============================================================================
// ANIMATION MANAGER (ties everything together)
// =============================================================================

/**
 * Central animation manager that coordinates all animation systems
 */
export class AnimationManager {
    constructor() {
        this.springs = new Map();
        this.breathingRhythm = new BreathingRhythm();
        this.staggerSystem = new StaggerSystem();
        this.anticipationAnimations = new Map();
        
        this.globalTime = 0;
        this.deltaTime = 0;
        
        // For cross-window sync
        this.syncOffset = 0;
    }
    
    /**
     * Update all animation systems
     */
    update(deltaTime) {
        this.deltaTime = deltaTime;
        this.globalTime += deltaTime;
        
        // Update breathing rhythm
        this.breathingRhythm.update(deltaTime);
        
        // Update all springs
        for (const spring of this.springs.values()) {
            spring.update(deltaTime);
        }
        
        // Update anticipation animations
        for (const anim of this.anticipationAnimations.values()) {
            anim.update(deltaTime);
        }
    }
    
    /**
     * Create a named spring
     */
    createSpring(name, options = {}) {
        const spring = new Spring(options);
        this.springs.set(name, spring);
        return spring;
    }
    
    /**
     * Create a named 3D spring
     */
    createSpring3D(name, options = {}) {
        const spring = new Spring3D(options);
        this.springs.set(name, spring);
        return spring;
    }
    
    /**
     * Get a spring by name
     */
    getSpring(name) {
        return this.springs.get(name);
    }
    
    /**
     * Create an anticipation/follow-through animation
     */
    createAnticipation(name, options = {}) {
        const anim = new AnticipationFollowThrough(options);
        this.anticipationAnimations.set(name, anim);
        return anim;
    }
    
    /**
     * Get breathing value with optional stagger
     */
    getBreathingValue(position = null) {
        if (position) {
            const phase = this.staggerSystem.getPhase(position);
            return this.breathingRhythm.getValue(phase);
        }
        return this.breathingRhythm.getValue();
    }
    
    /**
     * Get uniforms for shader integration
     */
    getShaderUniforms() {
        return {
            uGlobalTime: { value: this.globalTime },
            uBreathingPrimaryBPM: { value: this.breathingRhythm.primaryBPM },
            uBreathingSecondaryBPM: { value: this.breathingRhythm.secondaryBPM },
            uBreathingCycleSeconds: { value: this.breathingRhythm.breathCycleSeconds },
            uBreathingPrimaryAmp: { value: this.breathingRhythm.primaryAmplitude },
            uBreathingSecondaryAmp: { value: this.breathingRhythm.secondaryAmplitude },
            uBreathingBreathAmp: { value: this.breathingRhythm.breathAmplitude },
            uStaggerOrigin: { value: [this.staggerSystem.origin.x, this.staggerSystem.origin.y, this.staggerSystem.origin.z] },
            uStaggerAmount: { value: this.staggerSystem.staggerAmount },
            uMaxStagger: { value: this.staggerSystem.maxStagger }
        };
    }
    
    /**
     * Synchronize with another window's time
     */
    syncTime(remoteTime) {
        this.syncOffset = remoteTime - this.globalTime;
        this.breathingRhythm.setGlobalTime(remoteTime);
    }
    
    /**
     * Get synchronized global time
     */
    getSyncedTime() {
        return this.globalTime + this.syncOffset;
    }
}

// =============================================================================
// GLSL SHADER CODE EXPORTS
// =============================================================================

/**
 * Combined GLSL code for all animation systems
 * Include this in your shaders for consistent animation behavior
 */
export const AnimationGLSL = {
    breathingRhythm: BreathingRhythm.getGLSLCode(),
    stagger: StaggerSystem.getGLSLCode(),
    
    // Combined code for easy inclusion
    all: `
// =============================================================================
// ANIMATION CORE - GLSL Functions
// =============================================================================

${BreathingRhythm.getGLSLCode()}

${StaggerSystem.getGLSLCode()}

// Combined breathing with stagger
float getAnimatedBreathing(vec3 pos, vec3 origin, float time,
                           float primaryBPM, float secondaryBPM, float breathCycleSeconds,
                           float primaryAmp, float secondaryAmp, float breathAmp,
                           float staggerAmount, float maxStagger) {
    float stagger = getDistanceStagger(pos, origin, staggerAmount, maxStagger);
    float phase = stagger / max(maxStagger, 0.001);
    return getBreathingValue(time, phase, primaryBPM, secondaryBPM, breathCycleSeconds,
                             primaryAmp, secondaryAmp, breathAmp);
}
`
};

// Export default AnimationManager instance for convenience
export const animationManager = new AnimationManager();
export default AnimationManager;
