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

// Animation Core - Spring physics, easing, breathing rhythm, stagger
import { 
    AnimationManager, 
    Spring, 
    Spring3D, 
    Easing, 
    BreathingRhythm,
    StaggerSystem,
    AnimationGLSL 
} from './AnimationCore.js';

// =============================================================================
// === CODE ARCHITECTURE SYSTEMS ===
// =============================================================================

/**
 * EventEmitter - Lightweight pub/sub event system for loose coupling
 * Enables components to communicate without direct references
 */
class EventEmitter {
    constructor() {
        this._events = new Map();
        this._onceListeners = new Map();
    }
    
    /**
     * Subscribe to an event
     * @param {string} event - Event name
     * @param {Function} listener - Callback function
     * @returns {Function} Unsubscribe function
     */
    on(event, listener) {
        if (!this._events.has(event)) {
            this._events.set(event, new Set());
        }
        this._events.get(event).add(listener);
        
        // Return unsubscribe function
        return () => this.off(event, listener);
    }
    
    /**
     * Subscribe to an event (one time only)
     * @param {string} event - Event name
     * @param {Function} listener - Callback function
     */
    once(event, listener) {
        if (!this._onceListeners.has(event)) {
            this._onceListeners.set(event, new Set());
        }
        this._onceListeners.get(event).add(listener);
    }
    
    /**
     * Unsubscribe from an event
     * @param {string} event - Event name
     * @param {Function} listener - Callback function
     */
    off(event, listener) {
        if (this._events.has(event)) {
            this._events.get(event).delete(listener);
        }
        if (this._onceListeners.has(event)) {
            this._onceListeners.get(event).delete(listener);
        }
    }
    
    /**
     * Emit an event with data
     * @param {string} event - Event name
     * @param {*} data - Event data
     */
    emit(event, data) {
        // Call regular listeners
        if (this._events.has(event)) {
            for (const listener of this._events.get(event)) {
                listener(data);
            }
        }
        
        // Call once listeners and remove them
        if (this._onceListeners.has(event)) {
            for (const listener of this._onceListeners.get(event)) {
                listener(data);
            }
            this._onceListeners.delete(event);
        }
    }
    
    /**
     * Remove all listeners for an event (or all events)
     * @param {string} [event] - Event name (optional)
     */
    removeAllListeners(event) {
        if (event) {
            this._events.delete(event);
            this._onceListeners.delete(event);
        } else {
            this._events.clear();
            this._onceListeners.clear();
        }
    }
    
    /**
     * Get listener count for an event
     * @param {string} event 
     * @returns {number}
     */
    listenerCount(event) {
        let count = 0;
        if (this._events.has(event)) count += this._events.get(event).size;
        if (this._onceListeners.has(event)) count += this._onceListeners.get(event).size;
        return count;
    }
}

// Global event bus for application-wide events
const eventBus = new EventEmitter();

// Standard event types for consistency
const Events = {
    // Window events
    WINDOW_MOVED: 'window:moved',
    WINDOW_RESIZED: 'window:resized',
    WINDOW_ADDED: 'window:added',
    WINDOW_REMOVED: 'window:removed',
    
    // Particle system events
    PARTICLE_SYSTEM_READY: 'particles:ready',
    PARTICLE_COUNT_CHANGED: 'particles:countChanged',
    PARTICLE_QUALITY_CHANGED: 'particles:qualityChanged',
    
    // Animation events
    ANIMATION_STARTED: 'animation:started',
    ANIMATION_COMPLETED: 'animation:completed',
    BREATHING_CYCLE: 'animation:breathingCycle',
    
    // Entanglement events
    ENTANGLEMENT_STARTED: 'entanglement:started',
    ENTANGLEMENT_COMPLETED: 'entanglement:completed',
    ENTANGLEMENT_PROGRESS: 'entanglement:progress',
    
    // Rendering events
    FRAME_START: 'render:frameStart',
    FRAME_END: 'render:frameEnd',
    LOD_CHANGED: 'render:lodChanged',
    
    // Performance events
    FPS_UPDATE: 'performance:fpsUpdate',
    QUALITY_ADJUSTED: 'performance:qualityAdjusted'
};

/**
 * Component - Base class for entity components
 * Components hold data and can be attached to entities
 */
class Component {
    constructor(type) {
        this.type = type;
        this.entity = null;
        this.enabled = true;
    }
    
    /**
     * Called when component is added to an entity
     * @param {Entity} entity 
     */
    onAttach(entity) {
        this.entity = entity;
    }
    
    /**
     * Called when component is removed from an entity
     */
    onDetach() {
        this.entity = null;
    }
    
    /**
     * Update component (override in subclasses)
     * @param {number} deltaTime 
     */
    update(deltaTime) {
        // Override in subclasses
    }
}

/**
 * Entity - Container for components
 * Entities are game objects that can have multiple components attached
 */
class Entity {
    static _nextId = 0;
    
    constructor(name = '') {
        this.id = Entity._nextId++;
        this.name = name || `Entity_${this.id}`;
        this.components = new Map();
        this.tags = new Set();
        this.enabled = true;
        this.children = [];
        this.parent = null;
    }
    
    /**
     * Add a component to this entity
     * @param {Component} component 
     * @returns {Entity} this (for chaining)
     */
    addComponent(component) {
        if (this.components.has(component.type)) {
            console.warn(`Entity ${this.name} already has component of type ${component.type}`);
            return this;
        }
        this.components.set(component.type, component);
        component.onAttach(this);
        return this;
    }
    
    /**
     * Get a component by type
     * @param {string} type 
     * @returns {Component|undefined}
     */
    getComponent(type) {
        return this.components.get(type);
    }
    
    /**
     * Check if entity has a component
     * @param {string} type 
     * @returns {boolean}
     */
    hasComponent(type) {
        return this.components.has(type);
    }
    
    /**
     * Remove a component by type
     * @param {string} type 
     * @returns {Component|undefined}
     */
    removeComponent(type) {
        const component = this.components.get(type);
        if (component) {
            component.onDetach();
            this.components.delete(type);
        }
        return component;
    }
    
    /**
     * Add a tag to this entity
     * @param {string} tag 
     */
    addTag(tag) {
        this.tags.add(tag);
    }
    
    /**
     * Check if entity has a tag
     * @param {string} tag 
     * @returns {boolean}
     */
    hasTag(tag) {
        return this.tags.has(tag);
    }
    
    /**
     * Add a child entity
     * @param {Entity} child 
     */
    addChild(child) {
        if (child.parent) {
            child.parent.removeChild(child);
        }
        child.parent = this;
        this.children.push(child);
    }
    
    /**
     * Remove a child entity
     * @param {Entity} child 
     */
    removeChild(child) {
        const index = this.children.indexOf(child);
        if (index !== -1) {
            this.children.splice(index, 1);
            child.parent = null;
        }
    }
    
    /**
     * Update all components
     * @param {number} deltaTime 
     */
    update(deltaTime) {
        if (!this.enabled) return;
        
        for (const component of this.components.values()) {
            if (component.enabled) {
                component.update(deltaTime);
            }
        }
        
        for (const child of this.children) {
            child.update(deltaTime);
        }
    }
}

/**
 * System - Processes entities with specific components
 * Systems contain the logic for updating entities
 */
class System {
    constructor(name, requiredComponents = []) {
        this.name = name;
        this.requiredComponents = requiredComponents;
        this.enabled = true;
        this.priority = 0; // Lower = runs first
    }
    
    /**
     * Check if an entity matches this system's requirements
     * @param {Entity} entity 
     * @returns {boolean}
     */
    matches(entity) {
        return this.requiredComponents.every(type => entity.hasComponent(type));
    }
    
    /**
     * Update method (override in subclasses)
     * @param {Array<Entity>} entities - Entities that match this system
     * @param {number} deltaTime 
     */
    update(entities, deltaTime) {
        // Override in subclasses
    }
}

/**
 * EntityManager - Manages all entities and systems
 * Central registry for the ECS architecture
 */
class EntityManager {
    constructor() {
        this.entities = new Map();
        this.systems = [];
        this.entitiesByTag = new Map();
        
        // Entity pools for recycling
        this.pools = new Map();
    }
    
    /**
     * Create a new entity
     * @param {string} name 
     * @returns {Entity}
     */
    createEntity(name) {
        const entity = new Entity(name);
        this.entities.set(entity.id, entity);
        return entity;
    }
    
    /**
     * Get an entity by ID
     * @param {number} id 
     * @returns {Entity|undefined}
     */
    getEntity(id) {
        return this.entities.get(id);
    }
    
    /**
     * Remove an entity
     * @param {number} id 
     */
    removeEntity(id) {
        const entity = this.entities.get(id);
        if (entity) {
            // Remove from tag indices
            for (const tag of entity.tags) {
                const taggedEntities = this.entitiesByTag.get(tag);
                if (taggedEntities) {
                    taggedEntities.delete(entity);
                }
            }
            
            // Remove children
            for (const child of entity.children) {
                this.removeEntity(child.id);
            }
            
            this.entities.delete(id);
        }
    }
    
    /**
     * Get all entities with a specific tag
     * @param {string} tag 
     * @returns {Set<Entity>}
     */
    getEntitiesByTag(tag) {
        return this.entitiesByTag.get(tag) || new Set();
    }
    
    /**
     * Get all entities with specific components
     * @param  {...string} componentTypes 
     * @returns {Array<Entity>}
     */
    getEntitiesWithComponents(...componentTypes) {
        return Array.from(this.entities.values()).filter(entity => 
            componentTypes.every(type => entity.hasComponent(type))
        );
    }
    
    /**
     * Add a system
     * @param {System} system 
     */
    addSystem(system) {
        this.systems.push(system);
        this.systems.sort((a, b) => a.priority - b.priority);
    }
    
    /**
     * Remove a system
     * @param {string} name 
     */
    removeSystem(name) {
        this.systems = this.systems.filter(s => s.name !== name);
    }
    
    /**
     * Update all systems
     * @param {number} deltaTime 
     */
    update(deltaTime) {
        for (const system of this.systems) {
            if (!system.enabled) continue;
            
            const matchingEntities = Array.from(this.entities.values())
                .filter(entity => entity.enabled && system.matches(entity));
            
            system.update(matchingEntities, deltaTime);
        }
    }
    
    /**
     * Clear all entities and systems
     */
    clear() {
        this.entities.clear();
        this.systems = [];
        this.entitiesByTag.clear();
    }
}

// Global entity manager
const entityManager = new EntityManager();

/**
 * RenderLayer - A single render layer with its own render target
 * Used by LayerCompositor for advanced rendering effects
 */
class RenderLayer {
    constructor(name, options = {}) {
        this.name = name;
        this.enabled = true;
        this.visible = true;
        this.priority = options.priority || 0;  // Lower = renders first
        
        // Blending options
        this.blendMode = options.blendMode || 'normal'; // normal, additive, multiply, screen
        this.opacity = options.opacity || 1.0;
        
        // Render target (optional - for post-processing)
        this.renderTarget = null;
        if (options.useRenderTarget) {
            const width = options.width || window.innerWidth;
            const height = options.height || window.innerHeight;
            this.renderTarget = new THREE.WebGLRenderTarget(width, height, {
                minFilter: THREE.LinearFilter,
                magFilter: THREE.LinearFilter,
                format: THREE.RGBAFormat
            });
        }
        
        // Objects to render in this layer
        this.objects = [];
        
        // Layer-specific post-processing passes
        this.passes = [];
        
        // Layer mask (for selective rendering)
        this.mask = null;
    }
    
    /**
     * Add an object to this layer
     * @param {THREE.Object3D} object 
     */
    addObject(object) {
        if (!this.objects.includes(object)) {
            this.objects.push(object);
        }
    }
    
    /**
     * Remove an object from this layer
     * @param {THREE.Object3D} object 
     */
    removeObject(object) {
        const index = this.objects.indexOf(object);
        if (index !== -1) {
            this.objects.splice(index, 1);
        }
    }
    
    /**
     * Add a post-processing pass
     * @param {THREE.Pass} pass 
     */
    addPass(pass) {
        this.passes.push(pass);
    }
    
    /**
     * Set layer visibility
     * @param {boolean} visible 
     */
    setVisible(visible) {
        this.visible = visible;
        for (const obj of this.objects) {
            obj.visible = visible;
        }
    }
    
    /**
     * Resize render target
     * @param {number} width 
     * @param {number} height 
     */
    resize(width, height) {
        if (this.renderTarget) {
            this.renderTarget.setSize(width, height);
        }
    }
    
    /**
     * Dispose of resources
     */
    dispose() {
        if (this.renderTarget) {
            this.renderTarget.dispose();
        }
        for (const pass of this.passes) {
            if (pass.dispose) pass.dispose();
        }
    }
}

/**
 * LayerCompositor - Manages multiple render layers and composites them
 * Enables complex multi-layer rendering effects
 */
class LayerCompositor {
    constructor(renderer, scene, camera) {
        this.renderer = renderer;
        this.scene = scene;
        this.camera = camera;
        
        // Render layers (sorted by priority)
        this.layers = new Map();
        this.sortedLayers = [];
        
        // Composite shader for blending layers
        this.compositeShader = {
            uniforms: {
                tBase: { value: null },
                tLayer: { value: null },
                uOpacity: { value: 1.0 },
                uBlendMode: { value: 0 }
            },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform sampler2D tBase;
                uniform sampler2D tLayer;
                uniform float uOpacity;
                uniform int uBlendMode;
                varying vec2 vUv;
                
                vec3 blendNormal(vec3 base, vec3 blend, float opacity) {
                    return mix(base, blend, opacity);
                }
                
                vec3 blendAdditive(vec3 base, vec3 blend, float opacity) {
                    return base + blend * opacity;
                }
                
                vec3 blendMultiply(vec3 base, vec3 blend, float opacity) {
                    return mix(base, base * blend, opacity);
                }
                
                vec3 blendScreen(vec3 base, vec3 blend, float opacity) {
                    return mix(base, 1.0 - (1.0 - base) * (1.0 - blend), opacity);
                }
                
                void main() {
                    vec4 baseColor = texture2D(tBase, vUv);
                    vec4 layerColor = texture2D(tLayer, vUv);
                    
                    vec3 result;
                    if (uBlendMode == 0) {
                        result = blendNormal(baseColor.rgb, layerColor.rgb, uOpacity * layerColor.a);
                    } else if (uBlendMode == 1) {
                        result = blendAdditive(baseColor.rgb, layerColor.rgb, uOpacity);
                    } else if (uBlendMode == 2) {
                        result = blendMultiply(baseColor.rgb, layerColor.rgb, uOpacity);
                    } else {
                        result = blendScreen(baseColor.rgb, layerColor.rgb, uOpacity);
                    }
                    
                    gl_FragColor = vec4(result, 1.0);
                }
            `
        };
        
        // Composition render targets
        this.compositeTargets = [
            new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight),
            new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight)
        ];
        this.currentCompositeTarget = 0;
        
        // Full screen quad for compositing
        this.compositeMaterial = new THREE.ShaderMaterial(this.compositeShader);
        this.compositeQuad = new THREE.Mesh(
            new THREE.PlaneGeometry(2, 2),
            this.compositeMaterial
        );
        this.compositeScene = new THREE.Scene();
        this.compositeScene.add(this.compositeQuad);
        this.compositeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    }
    
    /**
     * Create and add a new render layer
     * @param {string} name 
     * @param {Object} options 
     * @returns {RenderLayer}
     */
    createLayer(name, options = {}) {
        const layer = new RenderLayer(name, options);
        this.layers.set(name, layer);
        this.sortLayers();
        return layer;
    }
    
    /**
     * Get a layer by name
     * @param {string} name 
     * @returns {RenderLayer|undefined}
     */
    getLayer(name) {
        return this.layers.get(name);
    }
    
    /**
     * Remove a layer
     * @param {string} name 
     */
    removeLayer(name) {
        const layer = this.layers.get(name);
        if (layer) {
            layer.dispose();
            this.layers.delete(name);
            this.sortLayers();
        }
    }
    
    /**
     * Sort layers by priority
     */
    sortLayers() {
        this.sortedLayers = Array.from(this.layers.values())
            .sort((a, b) => a.priority - b.priority);
    }
    
    /**
     * Get blend mode as integer for shader
     * @param {string} mode 
     * @returns {number}
     */
    _getBlendModeInt(mode) {
        switch (mode) {
            case 'normal': return 0;
            case 'additive': return 1;
            case 'multiply': return 2;
            case 'screen': return 3;
            default: return 0;
        }
    }
    
    /**
     * Render all layers and composite
     * @returns {THREE.WebGLRenderTarget} Final composited render target
     */
    render() {
        if (this.sortedLayers.length === 0) return null;
        
        // Track which composite target is current
        let currentTarget = 0;
        let firstLayer = true;
        
        for (const layer of this.sortedLayers) {
            if (!layer.enabled || !layer.visible) continue;
            
            // Update object visibility for this layer
            for (const obj of layer.objects) {
                obj.visible = true;
            }
            
            // Render layer to its target or directly
            if (layer.renderTarget) {
                this.renderer.setRenderTarget(layer.renderTarget);
                this.renderer.render(this.scene, this.camera);
                
                // Apply layer-specific passes
                // (Would need a mini-composer per layer for full implementation)
            }
            
            // Restore visibility
            for (const obj of layer.objects) {
                obj.visible = layer.visible;
            }
            
            firstLayer = false;
        }
        
        // Return final composite
        this.renderer.setRenderTarget(null);
        return this.compositeTargets[currentTarget];
    }
    
    /**
     * Resize all render targets
     * @param {number} width 
     * @param {number} height 
     */
    resize(width, height) {
        for (const target of this.compositeTargets) {
            target.setSize(width, height);
        }
        for (const layer of this.layers.values()) {
            layer.resize(width, height);
        }
    }
    
    /**
     * Dispose of all resources
     */
    dispose() {
        for (const target of this.compositeTargets) {
            target.dispose();
        }
        for (const layer of this.layers.values()) {
            layer.dispose();
        }
        this.compositeMaterial.dispose();
        this.compositeQuad.geometry.dispose();
    }
}

// Layer compositor instance (initialized after renderer is created)
let layerCompositor = null;

/**
 * Initialize the layer compositor
 * Call this after renderer, scene, and camera are created
 */
function initLayerCompositor() {
    if (!renderer || !scene || !camera) {
        console.warn('Cannot initialize LayerCompositor: renderer, scene, or camera not ready');
        return;
    }
    
    layerCompositor = new LayerCompositor(renderer, scene, camera);
    
    // Create default layers
    layerCompositor.createLayer('background', { priority: 0 });
    layerCompositor.createLayer('particles', { priority: 10 });
    layerCompositor.createLayer('tendrils', { priority: 20 });
    layerCompositor.createLayer('dust', { priority: 30 });
    layerCompositor.createLayer('effects', { priority: 40, blendMode: 'additive' });
    
    console.log('LayerCompositor initialized with 5 default layers');
}

// Global animation manager instance
const animationManager = new AnimationManager();

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

// === ENHANCED PHYSICS PARAMETERS ===
// Vortex Confinement (turbulence enhancement)
uniform float uVortexConfinementStrength;
// Verlet Integration support
uniform float uDeltaTime;  // Actual delta time for physics
uniform float uPreviousPositionBlend;  // Blend factor for position history

const float MIN_DIST_SQ = 0.01;
const float BEHAVIOR_STIFF = 0.0;
const float BEHAVIOR_FLUID = 1.0;
const float BEHAVIOR_ORBITING = 2.0;

${simplexNoise3d}

// === VORTEX CONFINEMENT ===
// Creates swirling turbulent motion by amplifying rotation in the velocity field
// This is a key technique from fluid simulation that makes motion look more organic
vec3 calculateVortexConfinement(vec3 pos, float strength) {
    // Sample velocity field around this point to estimate vorticity (curl of velocity)
    float eps = 0.5;  // Sampling distance
    
    // Use noise as a proxy for the velocity field
    float noiseScale = 0.08;
    vec3 samplePos = pos * noiseScale + uNoiseTime * 0.3;
    
    // Compute curl of the noise field (approximates vorticity)
    // curl = (dN_z/dy - dN_y/dz, dN_x/dz - dN_z/dx, dN_y/dx - dN_x/dy)
    float nx_yp = snoise(samplePos + vec3(0.0, eps, 0.0) + vec3(0.0, 0.0, 0.0));
    float nx_ym = snoise(samplePos - vec3(0.0, eps, 0.0) + vec3(0.0, 0.0, 0.0));
    float ny_zp = snoise(samplePos + vec3(0.0, 0.0, eps) + vec3(100.0, 0.0, 0.0));
    float ny_zm = snoise(samplePos - vec3(0.0, 0.0, eps) + vec3(100.0, 0.0, 0.0));
    float nz_xp = snoise(samplePos + vec3(eps, 0.0, 0.0) + vec3(0.0, 100.0, 0.0));
    float nz_xm = snoise(samplePos - vec3(eps, 0.0, 0.0) + vec3(0.0, 100.0, 0.0));
    float nx_zp = snoise(samplePos + vec3(0.0, 0.0, eps) + vec3(0.0, 0.0, 0.0));
    float nx_zm = snoise(samplePos - vec3(0.0, 0.0, eps) + vec3(0.0, 0.0, 0.0));
    float ny_xp = snoise(samplePos + vec3(eps, 0.0, 0.0) + vec3(100.0, 0.0, 0.0));
    float ny_xm = snoise(samplePos - vec3(eps, 0.0, 0.0) + vec3(100.0, 0.0, 0.0));
    float nz_yp = snoise(samplePos + vec3(0.0, eps, 0.0) + vec3(0.0, 100.0, 0.0));
    float nz_ym = snoise(samplePos - vec3(0.0, eps, 0.0) + vec3(0.0, 100.0, 0.0));
    
    // Calculate curl (vorticity)
    float invEps2 = 1.0 / (2.0 * eps);
    vec3 omega = vec3(
        (nz_yp - nz_ym - ny_zp + ny_zm) * invEps2,
        (nx_zp - nx_zm - nz_xp + nz_xm) * invEps2,
        (ny_xp - ny_xm - nx_yp + nx_ym) * invEps2
    );
    
    float omegaLen = length(omega);
    if (omegaLen < 0.001) return vec3(0.0);
    
    // Normalize vorticity direction
    vec3 omegaNorm = omega / omegaLen;
    
    // Gradient of vorticity magnitude (points toward vortex centers)
    float om_xp = length(vec3(
        (snoise(samplePos + vec3(eps, eps, 0.0) + vec3(0.0, 100.0, 0.0)) - snoise(samplePos + vec3(eps, -eps, 0.0) + vec3(0.0, 100.0, 0.0))) * invEps2,
        0.0, 0.0
    ));
    float om_xm = length(vec3(
        (snoise(samplePos - vec3(eps, eps, 0.0) + vec3(0.0, 100.0, 0.0)) - snoise(samplePos - vec3(eps, -eps, 0.0) + vec3(0.0, 100.0, 0.0))) * invEps2,
        0.0, 0.0
    ));
    float om_yp = omegaLen;  // Simplified - use current omega
    float om_ym = omegaLen;
    float om_zp = omegaLen;
    float om_zm = omegaLen;
    
    vec3 eta = vec3(om_xp - om_xm, om_yp - om_ym, om_zp - om_zm) * invEps2;
    float etaLen = length(eta);
    if (etaLen < 0.001) return vec3(0.0);
    
    vec3 etaNorm = eta / etaLen;
    
    // Vortex confinement force: cross(eta, omega) * strength
    // This pushes fluid toward vortex cores, counteracting numerical diffusion
    vec3 confinementForce = cross(etaNorm, omega) * strength;
    
    // Modulate by distance from center - less confinement at edges
    float dist = length(pos);
    float distFalloff = smoothstep(uMembraneMaxRadius, uMembraneMinRadius * 0.5, dist);
    
    return confinementForce * distFalloff;
}

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

    // --- Vortex Confinement (enhanced turbulence) ---
    vec3 vortexConfinementForce = calculateVortexConfinement(particlePosition, uVortexConfinementStrength);
    vec3 scaledVortexConfinement = vortexConfinementForce * forceMultiplier;

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
                      clusteringForce +                                    // Particle clustering
                      scaledVortexConfinement;                             // Vortex confinement turbulence

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
// LOD system uniforms (distance-based quality scaling)
uniform float uLODSizeMultiplier;
uniform float uLODAlphaMultiplier;
uniform float uLODComplexity;

// === PARTICLE CHARACTER SYSTEM UNIFORMS ===
uniform float uSquashStretchIntensity;   // How much particles elongate based on velocity (0.0-1.0)
uniform float uSecondaryMotionStrength;  // Drag/momentum effect intensity (0.0-1.0)
uniform float uMoodWaveSpeed;            // Global mood oscillation speed
uniform float uMoodIntensity;            // How much mood affects particle behavior (0.0-1.0)
uniform float uBreathingPhase;           // Global breathing rhythm phase (0-2PI)

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

// === PARTICLE CHARACTER VARYINGS ===
varying float vSquashFactor;         // How elongated this particle is (1.0 = normal, >1 = stretched)
varying float vMood;                 // Per-particle mood value (-1 to 1, affects behavior)
varying vec2 vStretchDirection;      // Direction of velocity-based stretch in screen space
varying float vSecondaryOffset;      // Secondary motion phase offset

// Simple hash for random variation per particle
float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

// Higher quality 2D hash for mood variation
float hash2D(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yxz + 33.33);
    return fract((p3.x + p3.y) * p3.z);
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

    // === PARTICLE CHARACTER SYSTEM CALCULATIONS ===
    // Scale character effects by LOD complexity (reduce at distance)
    float lodComplexity = uLODComplexity;
    
    // --- Per-Particle Mood ---
    // Each particle has a unique "personality" that affects its behavior
    // Mood oscillates with time, creating subtle breathing/pulsing
    float moodSeed = hash2D(uv * 7.31);
    float moodPhase = moodSeed * 6.283 + uTime * uMoodWaveSpeed * (0.5 + moodSeed * 0.5);
    vMood = sin(moodPhase + uBreathingPhase * (0.3 + moodSeed * 0.7)) * uMoodIntensity * lodComplexity;
    // Add age influence - young particles are more "excited", old particles calmer
    float ageNormalized = age / uMaxLifetime;
    float ageMoodModifier = 1.0 - smoothstep(0.0, 0.3, ageNormalized) * 0.3; // Young = energetic
    ageMoodModifier *= 1.0 - smoothstep(0.7, 1.0, ageNormalized) * 0.4;       // Old = calming down
    vMood *= ageMoodModifier;
    
    // --- Squash-Stretch Based on Velocity ---
    // Fast-moving particles elongate in direction of motion (cartoon physics)
    // This creates organic, fluid-like movement
    float speedNormalized = clamp(speed / 2.0, 0.0, 1.0); // Normalize to 0-1
    float stretchAmount = speedNormalized * uSquashStretchIntensity * lodComplexity;
    // Squash-stretch factor: 1.0 = normal, >1.0 = stretched along velocity
    vSquashFactor = 1.0 + stretchAmount * 0.8;
    // Include mood in stretch (excited particles stretch more)
    vSquashFactor *= 1.0 + vMood * 0.1;
    
    // Calculate velocity direction in screen space for fragment shader
    vec4 mvPos = modelViewMatrix * vec4(particlePosition, 1.0);
    vec3 velWorld = normalize(velocity + vec3(0.0001)); // Avoid zero division
    vec4 velEnd = modelViewMatrix * vec4(particlePosition + velWorld * 0.1, 1.0);
    vec2 velScreen = normalize((velEnd.xy / velEnd.w) - (mvPos.xy / mvPos.w) + vec2(0.0001));
    vStretchDirection = velScreen;
    
    // --- Secondary Motion (Momentum/Drag) ---
    // Creates feeling of particles being "pulled" by their velocity
    // Reduce at distance via LOD complexity
    float secondarySeed = hash(uv + vec2(0.123, 0.456));
    vSecondaryOffset = secondarySeed * 6.283; // Random phase offset
    // Secondary motion affects position slightly in direction of velocity
    float secondaryDisplacement = sin(uTime * 8.0 + vSecondaryOffset) * uSecondaryMotionStrength * lodComplexity;
    secondaryDisplacement *= speedNormalized * 0.3; // Scale with speed
    vec3 secondaryMotion = velWorld * secondaryDisplacement;
    particlePosition += secondaryMotion;

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
    
    // === PARTICLE CHARACTER SIZE MODULATION ===
    // Mood affects size (excited particles grow slightly)
    float moodSizeModifier = 1.0 + vMood * 0.15;
    // Squash-stretch affects perpendicular size (stretch = thinner)
    // This is compensated by elongation in fragment shader
    float squashCompensation = 1.0 / sqrt(vSquashFactor);
    
    // Apply LOD-based size reduction for distant views
    float lodSize = uQualityMultiplier * uLODSizeMultiplier;
    
    gl_PointSize = uPointSize * layerBaseSize * baseSizeFromSpeed * sizeFromDist * edgeSizeReduction * randomSize * moodSizeModifier * squashCompensation * lodSize * (300.0 / -mvPosition.z);
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

// === PARTICLE CHARACTER VARYINGS ===
varying float vSquashFactor;
varying float vMood;
varying vec2 vStretchDirection;
varying float vSecondaryOffset;

uniform float uMembraneMaxRadius;
uniform float uCoreGlowStrength;      // Volumetric core glow intensity
uniform float uCoreGlowRadius;        // Radius of core glow effect

void main() {
    // === PARTICLE CHARACTER: SQUASH-STRETCH DEFORMATION ===
    // Transform point coord based on velocity direction to create elongated particles
    vec2 center = gl_PointCoord - vec2(0.5);
    
    // Apply squash-stretch transform
    // Stretch along velocity direction, squash perpendicular
    float stretchScale = vSquashFactor;
    float squashScale = 1.0 / sqrt(stretchScale); // Preserve area
    
    // Create rotation matrix to align with velocity direction
    vec2 stretchDir = normalize(vStretchDirection + vec2(0.0001));
    vec2 perpDir = vec2(-stretchDir.y, stretchDir.x);
    
    // Transform point coordinates
    // Project center onto stretch and perpendicular directions
    float alongStretch = dot(center, stretchDir);
    float perpToStretch = dot(center, perpDir);
    
    // Apply deformation (compress along stretch direction to elongate)
    alongStretch /= stretchScale;
    perpToStretch *= squashScale;
    
    // Reconstruct deformed center
    vec2 deformedCenter = alongStretch * stretchDir + perpToStretch * perpDir;
    float dist = length(deformedCenter);

    // Discard outside deformed circle for clean edges
    if (dist > 0.5) discard;
    
    // --- High Resolution Particle Shape with Character ---
    // Crisp circular core with soft organic outer glow
    
    // Inner core: crisp circular shape with antialiased edge
    // Mood affects core softness - excited particles have slightly sharper edges
    float coreRadius = 0.35;
    float coreSoftness = 0.08 + vMood * 0.02; // Mood affects edge sharpness
    float core = 1.0 - smoothstep(coreRadius - coreSoftness, coreRadius + coreSoftness, dist);
    
    // Outer glow: soft falloff for volumetric cloud feel
    // Stretched particles have more directional glow
    float glowIntensity = 0.5 - (vSquashFactor - 1.0) * 0.15; // Less glow when stretched
    float glow = smoothstep(0.5, 0.15, dist) * glowIntensity;
    
    // Combine core and glow
    float shape = core + glow * (1.0 - core * 0.7);
    
    // Apply gaussian-like density for particle center
    float density = exp(-dist * dist * 6.0);
    shape = mix(shape, density, 0.3); // Blend for organic feel
    
    // Mood affects overall particle intensity
    shape *= 1.0 + vMood * 0.1;

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
    
    // === VOLUMETRIC CORE GLOW ===
    // Particles near the core get enhanced glow based on distance from center
    float coreProximity = 1.0 - smoothstep(0.0, uCoreGlowRadius, vDistFromCenter);
    float coreGlow = coreProximity * uCoreGlowStrength;
    
    // Core particles emit extra light (additive)
    vec3 coreGlowColor = vec3(1.0, 0.95, 0.9) * coreGlow; // Warm white core
    finalColor += coreGlowColor * (0.5 + 0.5 * smoothstep(0.3, 0.0, dist)); // Stronger at particle center
    
    // Core particles have enhanced bloom contribution
    float coreAlphaBoost = coreGlow * 0.3;

    // Boost alpha slightly for rim-lit particles
    float finalAlpha = alpha + vRimLight * 0.1 + coreAlphaBoost;

    gl_FragColor = vec4(finalColor, finalAlpha);
}
`;

// --- Enhanced Post-Processing Shader (Visual Effects Layer) ---
// Includes: Vignette, Chromatic Aberration/Dispersion, Film Grain, Caustics, Radial Blur, DOF
const FilmShader = {
    uniforms: {
        'tDiffuse': { value: null },
        'uTime': { value: 0.0 },
        'uVignetteStrength': { value: 0.30 },    // Subtle organic vignette
        'uVignetteRadius': { value: 0.75 },      // Gentle vignette radius
        'uChromaticAberration': { value: 0.002 }, // Very subtle aberration
        'uFilmGrain': { value: 0.018 },          // Barely perceptible grain
        // === ENHANCED VISUAL EFFECTS ===
        'uCausticsStrength': { value: 0.08 },    // Underwater-like caustics overlay
        'uCausticsScale': { value: 2.5 },        // Scale of caustic patterns
        'uDispersionStrength': { value: 0.003 }, // Rainbow dispersion at edges
        'uRadialBlurStrength': { value: 0.0 },   // Motion blur from center (0 = off)
        'uRadialBlurCenter': { value: null },    // Will be set to Vector2(0.5, 0.5)
        // === DEPTH OF FIELD ===
        'uDofStrength': { value: 0.0 },          // DOF blur strength (0 = off)
        'uDofFocalDistance': { value: 0.5 }      // Focal distance (0-1, 0.5 = center)
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
        uniform float uCausticsStrength;
        uniform float uCausticsScale;
        uniform float uDispersionStrength;
        uniform float uRadialBlurStrength;
        uniform vec2 uRadialBlurCenter;
        uniform float uDofStrength;
        uniform float uDofFocalDistance;
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
        
        // === BOKEH-STYLE DEPTH OF FIELD ===
        vec3 bokehBlur(sampler2D tex, vec2 uv, float blurAmount) {
            vec3 color = vec3(0.0);
            float totalWeight = 0.0;
            
            // Circular bokeh pattern (hexagonal approximation)
            const int samples = 12;
            const float PI = 3.14159265359;
            
            for (int i = 0; i < samples; i++) {
                float angle = float(i) * PI * 2.0 / float(samples);
                vec2 offset = vec2(cos(angle), sin(angle)) * blurAmount;
                
                // Sample at multiple radii for smoother bokeh
                for (float r = 0.3; r <= 1.0; r += 0.35) {
                    vec2 sampleUV = uv + offset * r;
                    vec3 sampleColor = texture2D(tex, sampleUV).rgb;
                    
                    // Bright spots get more weight (bokeh effect)
                    float brightness = dot(sampleColor, vec3(0.299, 0.587, 0.114));
                    float weight = 1.0 + brightness * 2.0;
                    
                    color += sampleColor * weight;
                    totalWeight += weight;
                }
            }
            
            return color / totalWeight;
        }
        
        // === CAUSTICS PATTERN ===
        // Creates underwater-like light patterns
        float causticPattern(vec2 uv, float time) {
            vec2 p = uv * uCausticsScale;
            float t = time * 0.3;
            
            // Multiple layers of animated sine waves
            float caustic = 0.0;
            caustic += sin(p.x * 3.1 + t) * sin(p.y * 3.7 - t * 0.7) * 0.5;
            caustic += sin(p.x * 5.3 - t * 1.3) * sin(p.y * 4.9 + t * 0.9) * 0.3;
            caustic += sin(p.x * 7.1 + p.y * 6.3 + t * 0.5) * 0.2;
            
            // Voronoi-like cells
            vec2 cellUV = fract(p + vec2(sin(t * 0.5), cos(t * 0.4)) * 0.3) - 0.5;
            float cells = 1.0 - smoothstep(0.0, 0.4, length(cellUV));
            caustic += cells * 0.3;
            
            return caustic * 0.5 + 0.5; // Normalize to 0-1
        }
        
        // === CHROMATIC DISPERSION ===
        // Full rainbow spectrum dispersion (more than just R/B split)
        vec3 chromaticDispersion(sampler2D tex, vec2 uv, vec2 center, float dist, float strength) {
            // Sample at different wavelengths (Red, Orange, Yellow, Green, Cyan, Blue, Violet)
            vec2 dir = normalize(center);
            float dispBase = dist * strength;
            
            // Red channel - longest wavelength, least refracted
            float r = texture2D(tex, uv + dir * dispBase * 1.0).r;
            // Green channel
            float g = texture2D(tex, uv + dir * dispBase * 0.0).g;
            // Blue channel - shortest wavelength, most refracted  
            float b = texture2D(tex, uv - dir * dispBase * 1.0).b;
            
            return vec3(r, g, b);
        }
        
        // === RADIAL BLUR ===
        // Motion blur emanating from center (for zoom/movement effects)
        vec3 radialBlur(sampler2D tex, vec2 uv, vec2 center, float strength) {
            vec3 color = vec3(0.0);
            vec2 dir = uv - center;
            float samples = 8.0;
            
            for (float i = 0.0; i < 8.0; i++) {
                float t = i / samples;
                vec2 offset = dir * t * strength;
                color += texture2D(tex, uv - offset).rgb;
            }
            
            return color / samples;
        }

        void main() {
            vec2 uv = vUv;
            vec2 center = uv - 0.5;
            float dist = length(center);

            // === DEPTH OF FIELD (if enabled) ===
            vec3 color;
            if (uDofStrength > 0.001) {
                // Calculate blur amount based on distance from focal point
                // Areas far from focal distance get more blur
                float focalDist = abs(dist - uDofFocalDistance);
                float blurAmount = focalDist * uDofStrength * 0.02;
                
                // Apply bokeh blur
                color = bokehBlur(tDiffuse, uv, blurAmount);
                
                // Apply chromatic aberration on top
                float aberrationStrength = uChromaticAberration * (1.0 + dist * 0.5);
                vec2 offset = center * dist * aberrationStrength;
                color.r = bokehBlur(tDiffuse, uv + offset * 0.5, blurAmount).r;
                color.b = bokehBlur(tDiffuse, uv - offset * 0.5, blurAmount).b;
            }
            // === RADIAL BLUR (if enabled) ===
            else if (uRadialBlurStrength > 0.001) {
                color = radialBlur(tDiffuse, uv, uRadialBlurCenter, uRadialBlurStrength);
            } else {
                // Standard chromatic aberration
                float aberrationStrength = uChromaticAberration * (1.0 + dist * 0.5);
                vec2 offset = center * dist * aberrationStrength;

                float r = texture2D(tDiffuse, uv + offset).r;
                float g = texture2D(tDiffuse, uv).g;
                float b = texture2D(tDiffuse, uv - offset).b;
                color = vec3(r, g, b);
            }
            
            // === CHROMATIC DISPERSION at edges ===
            if (uDispersionStrength > 0.001 && dist > 0.3) {
                float edgeFactor = smoothstep(0.3, 0.7, dist);
                vec3 dispersed = chromaticDispersion(tDiffuse, uv, center, dist, uDispersionStrength);
                color = mix(color, dispersed, edgeFactor * 0.5);
            }
            
            // === CAUSTICS OVERLAY ===
            if (uCausticsStrength > 0.001) {
                float caustics = causticPattern(uv, uTime);
                // Apply caustics more strongly to bright areas
                float luminance = dot(color, vec3(0.299, 0.587, 0.114));
                float causticIntensity = caustics * uCausticsStrength * (0.5 + luminance * 0.5);
                // Add caustics as gentle additive light
                color += vec3(causticIntensity * 0.8, causticIntensity * 0.9, causticIntensity * 1.0);
            }

            // === VIGNETTE ===
            float vignette = 1.0 - smoothstep(uVignetteRadius - 0.1, uVignetteRadius + uVignetteStrength, dist * 1.2);
            vignette = pow(vignette, 1.2);
            color *= vignette;

            // Subtle blue tint in shadows
            float luminance = dot(color, vec3(0.299, 0.587, 0.114));
            vec3 shadowTint = mix(color, color * vec3(0.9, 0.95, 1.05), (1.0 - luminance) * 0.15);
            color = shadowTint;

            // === FILM GRAIN ===
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
// Enhanced Physics - Turbulence
const VORTEX_CONFINEMENT_STRENGTH = 0.15; // Creates swirling vortex structures

// =============================================================================
// PARTICLE CHARACTER SYSTEM CONFIGURATION
// =============================================================================
// Creates organic, living particle behavior with mood and squash-stretch
const SQUASH_STRETCH_INTENSITY = 0.6;   // How much particles elongate when moving fast (0-1)
const SECONDARY_MOTION_STRENGTH = 0.25; // Drag/momentum effect intensity (0-1)
const MOOD_WAVE_SPEED = 0.8;            // Global mood oscillation speed
const MOOD_INTENSITY = 0.5;             // How much mood affects particle behavior (0-1)

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

// =============================================================================
// === LOD (LEVEL OF DETAIL) SYSTEM ===
// =============================================================================
// Distance-based quality scaling for particles, effects, and complexity

/**
 * LOD Configuration
 * Defines quality levels based on distance from camera
 */
const LOD_CONFIG = {
    // Distance thresholds (in world units)
    distances: {
        near: 40,      // Full quality zone
        mid: 80,       // Medium quality zone
        far: 150,      // Low quality zone
        cull: 250      // Particles beyond this are culled
    },
    // Size multipliers per LOD level
    sizeMultipliers: {
        near: 1.0,
        mid: 0.75,
        far: 0.5,
        minimal: 0.25
    },
    // Alpha multipliers per LOD level
    alphaMultipliers: {
        near: 1.0,
        mid: 0.85,
        far: 0.6,
        minimal: 0.3
    },
    // Effect quality multipliers
    effectQuality: {
        near: 1.0,     // Full post-processing
        mid: 0.8,      // Reduced bloom
        far: 0.5,      // Minimal effects
        minimal: 0.2   // Just basic rendering
    },
    // Particle complexity (affects secondary motion, character system)
    complexity: {
        near: 1.0,     // Full squash-stretch, mood, secondary motion
        mid: 0.7,      // Reduced secondary motion
        far: 0.3,      // Minimal character
        minimal: 0.0   // Static particles
    }
};

/**
 * LODManager - Manages level of detail based on camera distance
 * Provides smooth transitions between LOD levels for organic feel
 */
class LODManager {
    constructor(config = LOD_CONFIG) {
        this.config = config;
        
        // Current LOD state (smoothly interpolated)
        this.currentSizeMultiplier = 1.0;
        this.currentAlphaMultiplier = 1.0;
        this.currentEffectQuality = 1.0;
        this.currentComplexity = 1.0;
        
        // Target values (for smooth transitions)
        this.targetSizeMultiplier = 1.0;
        this.targetAlphaMultiplier = 1.0;
        this.targetEffectQuality = 1.0;
        this.targetComplexity = 1.0;
        
        // Transition speed (lower = smoother)
        this.transitionSpeed = 3.0;
        
        // Current LOD level (for debugging/UI)
        this.currentLevel = 'near';
        
        // Frustum culling bounds (updated each frame)
        this.frustum = new THREE.Frustum();
        this.frustumMatrix = new THREE.Matrix4();
    }
    
    /**
     * Update LOD based on camera distance
     * @param {number} distanceFromCamera - Distance from camera to particle cloud center
     * @param {number} deltaTime - Frame delta time for smooth transitions
     */
    update(distanceFromCamera, deltaTime) {
        const { distances, sizeMultipliers, alphaMultipliers, effectQuality, complexity } = this.config;
        
        // Determine LOD level based on distance
        let level, size, alpha, effect, complex;
        
        if (distanceFromCamera < distances.near) {
            level = 'near';
            size = sizeMultipliers.near;
            alpha = alphaMultipliers.near;
            effect = effectQuality.near;
            complex = complexity.near;
        } else if (distanceFromCamera < distances.mid) {
            // Interpolate between near and mid
            const t = (distanceFromCamera - distances.near) / (distances.mid - distances.near);
            level = 'mid';
            size = THREE.MathUtils.lerp(sizeMultipliers.near, sizeMultipliers.mid, t);
            alpha = THREE.MathUtils.lerp(alphaMultipliers.near, alphaMultipliers.mid, t);
            effect = THREE.MathUtils.lerp(effectQuality.near, effectQuality.mid, t);
            complex = THREE.MathUtils.lerp(complexity.near, complexity.mid, t);
        } else if (distanceFromCamera < distances.far) {
            // Interpolate between mid and far
            const t = (distanceFromCamera - distances.mid) / (distances.far - distances.mid);
            level = 'far';
            size = THREE.MathUtils.lerp(sizeMultipliers.mid, sizeMultipliers.far, t);
            alpha = THREE.MathUtils.lerp(alphaMultipliers.mid, alphaMultipliers.far, t);
            effect = THREE.MathUtils.lerp(effectQuality.mid, effectQuality.far, t);
            complex = THREE.MathUtils.lerp(complexity.mid, complexity.far, t);
        } else {
            // Beyond far distance - minimal quality
            const t = Math.min(1.0, (distanceFromCamera - distances.far) / (distances.cull - distances.far));
            level = 'minimal';
            size = THREE.MathUtils.lerp(sizeMultipliers.far, sizeMultipliers.minimal, t);
            alpha = THREE.MathUtils.lerp(alphaMultipliers.far, alphaMultipliers.minimal, t);
            effect = THREE.MathUtils.lerp(effectQuality.far, effectQuality.minimal, t);
            complex = THREE.MathUtils.lerp(complexity.far, complexity.minimal, t);
        }
        
        // Set target values
        this.targetSizeMultiplier = size;
        this.targetAlphaMultiplier = alpha;
        this.targetEffectQuality = effect;
        this.targetComplexity = complex;
        this.currentLevel = level;
        
        // Smoothly interpolate current values toward targets
        const lerpFactor = 1.0 - Math.exp(-this.transitionSpeed * deltaTime);
        this.currentSizeMultiplier += (this.targetSizeMultiplier - this.currentSizeMultiplier) * lerpFactor;
        this.currentAlphaMultiplier += (this.targetAlphaMultiplier - this.currentAlphaMultiplier) * lerpFactor;
        this.currentEffectQuality += (this.targetEffectQuality - this.currentEffectQuality) * lerpFactor;
        this.currentComplexity += (this.targetComplexity - this.currentComplexity) * lerpFactor;
    }
    
    /**
     * Update frustum for culling calculations
     * @param {THREE.Camera} camera 
     */
    updateFrustum(camera) {
        this.frustumMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
        this.frustum.setFromProjectionMatrix(this.frustumMatrix);
    }
    
    /**
     * Check if a bounding sphere is visible
     * @param {THREE.Vector3} center - Center of bounding sphere
     * @param {number} radius - Radius of bounding sphere
     * @returns {boolean} True if visible
     */
    isVisible(center, radius) {
        const sphere = new THREE.Sphere(center, radius);
        return this.frustum.intersectsSphere(sphere);
    }
    
    /**
     * Get LOD values as uniform-ready object
     * @returns {Object} Uniform values
     */
    getUniforms() {
        return {
            uLODSizeMultiplier: this.currentSizeMultiplier,
            uLODAlphaMultiplier: this.currentAlphaMultiplier,
            uLODComplexity: this.currentComplexity
        };
    }
}

// Global LOD manager instance
const lodManager = new LODManager();

// =============================================================================
// === SPATIAL HASHING SYSTEM ===
// =============================================================================
// O(1) neighbor lookups for particle interactions

/**
 * SpatialHash - 3D spatial partitioning for efficient neighbor queries
 * Used for particle-particle interactions, collision detection, and clustering
 */
class SpatialHash {
    /**
     * @param {number} cellSize - Size of each cell (should be >= interaction radius)
     * @param {number} maxParticles - Maximum number of particles to track
     */
    constructor(cellSize = 5.0, maxParticles = 262144) {
        this.cellSize = cellSize;
        this.invCellSize = 1.0 / cellSize;
        this.maxParticles = maxParticles;
        
        // Hash table: Map<cellKey, Set<particleIndex>>
        this.cells = new Map();
        
        // Particle positions for quick lookup
        this.positions = new Float32Array(maxParticles * 3);
        this.activeCount = 0;
        
        // Reusable arrays for queries (avoid allocations)
        this._queryResults = [];
        this._cellKeys = [];
        
        // Statistics for debugging
        this.stats = {
            totalCells: 0,
            avgParticlesPerCell: 0,
            maxParticlesInCell: 0,
            lastQueryTime: 0
        };
    }
    
    /**
     * Hash a 3D position to a cell key
     * @param {number} x 
     * @param {number} y 
     * @param {number} z 
     * @returns {string} Cell key
     */
    hashPosition(x, y, z) {
        const cellX = Math.floor(x * this.invCellSize);
        const cellY = Math.floor(y * this.invCellSize);
        const cellZ = Math.floor(z * this.invCellSize);
        return `${cellX},${cellY},${cellZ}`;
    }
    
    /**
     * Clear the spatial hash (call before rebuilding)
     */
    clear() {
        this.cells.clear();
        this.activeCount = 0;
    }
    
    /**
     * Insert a particle into the hash
     * @param {number} index - Particle index
     * @param {number} x 
     * @param {number} y 
     * @param {number} z 
     */
    insert(index, x, y, z) {
        const key = this.hashPosition(x, y, z);
        
        if (!this.cells.has(key)) {
            this.cells.set(key, new Set());
        }
        this.cells.get(key).add(index);
        
        // Store position
        const i3 = index * 3;
        this.positions[i3] = x;
        this.positions[i3 + 1] = y;
        this.positions[i3 + 2] = z;
        
        this.activeCount = Math.max(this.activeCount, index + 1);
    }
    
    /**
     * Build the spatial hash from a Float32Array of positions
     * @param {Float32Array} positionData - Position data (xyzw per particle)
     * @param {number} count - Number of particles
     * @param {number} stride - Values per particle (default 4 for xyzw)
     */
    buildFromArray(positionData, count, stride = 4) {
        this.clear();
        
        for (let i = 0; i < count; i++) {
            const offset = i * stride;
            const x = positionData[offset];
            const y = positionData[offset + 1];
            const z = positionData[offset + 2];
            this.insert(i, x, y, z);
        }
        
        this.updateStats();
    }
    
    /**
     * Find all particles within a radius of a position
     * @param {number} x - Query position x
     * @param {number} y - Query position y
     * @param {number} z - Query position z
     * @param {number} radius - Search radius
     * @param {number} maxResults - Maximum number of results (0 = unlimited)
     * @returns {Array<{index: number, distSq: number}>} Neighbor particles
     */
    queryRadius(x, y, z, radius, maxResults = 0) {
        const startTime = performance.now();
        this._queryResults.length = 0;
        
        const radiusSq = radius * radius;
        const cellRadius = Math.ceil(radius * this.invCellSize);
        
        const cellX = Math.floor(x * this.invCellSize);
        const cellY = Math.floor(y * this.invCellSize);
        const cellZ = Math.floor(z * this.invCellSize);
        
        // Check all cells within radius
        for (let dx = -cellRadius; dx <= cellRadius; dx++) {
            for (let dy = -cellRadius; dy <= cellRadius; dy++) {
                for (let dz = -cellRadius; dz <= cellRadius; dz++) {
                    const key = `${cellX + dx},${cellY + dy},${cellZ + dz}`;
                    const cell = this.cells.get(key);
                    
                    if (cell) {
                        for (const index of cell) {
                            const i3 = index * 3;
                            const px = this.positions[i3];
                            const py = this.positions[i3 + 1];
                            const pz = this.positions[i3 + 2];
                            
                            const dx2 = px - x;
                            const dy2 = py - y;
                            const dz2 = pz - z;
                            const distSq = dx2 * dx2 + dy2 * dy2 + dz2 * dz2;
                            
                            if (distSq <= radiusSq) {
                                this._queryResults.push({ index, distSq });
                                
                                if (maxResults > 0 && this._queryResults.length >= maxResults) {
                                    this.stats.lastQueryTime = performance.now() - startTime;
                                    return this._queryResults;
                                }
                            }
                        }
                    }
                }
            }
        }
        
        this.stats.lastQueryTime = performance.now() - startTime;
        return this._queryResults;
    }
    
    /**
     * Find K nearest neighbors (sorted by distance)
     * @param {number} x 
     * @param {number} y 
     * @param {number} z 
     * @param {number} k - Number of neighbors
     * @param {number} maxRadius - Maximum search radius
     * @returns {Array<{index: number, distSq: number}>}
     */
    queryKNearest(x, y, z, k, maxRadius = 20.0) {
        const results = this.queryRadius(x, y, z, maxRadius, 0);
        results.sort((a, b) => a.distSq - b.distSq);
        return results.slice(0, k);
    }
    
    /**
     * Get particles in a specific cell
     * @param {string} cellKey 
     * @returns {Set<number>|undefined}
     */
    getCell(cellKey) {
        return this.cells.get(cellKey);
    }
    
    /**
     * Get all cell keys
     * @returns {IterableIterator<string>}
     */
    getCellKeys() {
        return this.cells.keys();
    }
    
    /**
     * Update statistics
     */
    updateStats() {
        this.stats.totalCells = this.cells.size;
        
        let totalParticles = 0;
        let maxParticles = 0;
        
        for (const cell of this.cells.values()) {
            totalParticles += cell.size;
            maxParticles = Math.max(maxParticles, cell.size);
        }
        
        this.stats.avgParticlesPerCell = this.stats.totalCells > 0 
            ? totalParticles / this.stats.totalCells 
            : 0;
        this.stats.maxParticlesInCell = maxParticles;
    }
    
    /**
     * Get density estimate at a position
     * @param {number} x 
     * @param {number} y 
     * @param {number} z 
     * @param {number} radius 
     * @returns {number} Density (particles per unit volume)
     */
    getDensity(x, y, z, radius) {
        const neighbors = this.queryRadius(x, y, z, radius);
        const volume = (4.0 / 3.0) * Math.PI * radius * radius * radius;
        return neighbors.length / volume;
    }
}

// Global spatial hash instance
const spatialHash = new SpatialHash(8.0, 1048576); // 8 unit cells, supports up to 1M particles

/**
 * Optimized batch query for GPU readback scenarios
 * Processes multiple queries efficiently
 */
class SpatialHashBatchQuery {
    constructor(spatialHash) {
        this.hash = spatialHash;
        this.results = new Map(); // particleIndex -> neighbors
    }
    
    /**
     * Query neighbors for multiple particles at once
     * @param {Array<{index: number, x: number, y: number, z: number}>} queries 
     * @param {number} radius 
     */
    batchQuery(queries, radius) {
        this.results.clear();
        
        for (const query of queries) {
            const neighbors = this.hash.queryRadius(query.x, query.y, query.z, radius);
            this.results.set(query.index, neighbors.filter(n => n.index !== query.index));
        }
        
        return this.results;
    }
}

// =============================================================================
// === GPU COMPUTE IMPROVEMENTS ===
// =============================================================================
// Double-buffered textures, acceleration structure caching, async readback

/**
 * GPUComputeManager - Enhanced management for GPGPU compute operations
 * Implements double-buffering and caching for better performance
 */
class GPUComputeManager {
    constructor() {
        // Double-buffer state tracking
        this.currentBuffer = 0;
        this.bufferTextures = {
            position: [null, null],  // Double buffer for positions
            velocity: [null, null]   // Double buffer for velocities
        };
        
        // Acceleration structure cache
        this.accelerationCache = {
            globalForceField: null,      // Cached global force field texture
            neighborGrid: null,          // Cached neighbor grid
            lastUpdateTime: 0,           // Time of last cache update
            updateInterval: 0.1,         // Cache update interval (seconds)
            isDirty: true                // Whether cache needs rebuild
        };
        
        // Readback management (for CPU-side operations)
        this.readbackBuffer = null;
        this.readbackPending = false;
        this.lastReadbackData = null;
        
        // Performance metrics
        this.metrics = {
            computeTime: 0,
            readbackTime: 0,
            cacheHits: 0,
            cacheMisses: 0
        };
        
        // Async readback support (WebGL 2)
        this.asyncReadbackSupported = false;
        this.pendingReadbacks = [];
    }
    
    /**
     * Initialize double buffers for a compute variable
     * @param {GPUComputationRenderer} gpuCompute 
     * @param {string} variableName 
     * @param {THREE.DataTexture} initialTexture 
     */
    initDoubleBuffer(gpuCompute, variableName, initialTexture) {
        // Create two render targets for double buffering
        const size = initialTexture.image.width;
        const options = {
            type: gpuCompute.getDataType ? gpuCompute.getDataType() : THREE.FloatType,
            format: THREE.RGBAFormat,
            minFilter: THREE.NearestFilter,
            magFilter: THREE.NearestFilter
        };
        
        // Note: GPUComputationRenderer handles double buffering internally
        // This method provides a wrapper for additional control
        this.bufferTextures[variableName] = [
            initialTexture,
            initialTexture.clone()
        ];
    }
    
    /**
     * Swap front and back buffers
     */
    swapBuffers() {
        this.currentBuffer = 1 - this.currentBuffer;
    }
    
    /**
     * Get current buffer index
     * @returns {number}
     */
    getCurrentBufferIndex() {
        return this.currentBuffer;
    }
    
    /**
     * Get back buffer index (for reading previous frame)
     * @returns {number}
     */
    getBackBufferIndex() {
        return 1 - this.currentBuffer;
    }
    
    /**
     * Update acceleration cache
     * @param {number} elapsedTime 
     * @param {Object} forceParams - Parameters for force field calculation
     */
    updateAccelerationCache(elapsedTime, forceParams) {
        const timeSinceUpdate = elapsedTime - this.accelerationCache.lastUpdateTime;
        
        if (this.accelerationCache.isDirty || timeSinceUpdate >= this.accelerationCache.updateInterval) {
            // Mark as needing update
            this.accelerationCache.isDirty = false;
            this.accelerationCache.lastUpdateTime = elapsedTime;
            this.metrics.cacheMisses++;
            return true; // Indicates cache was updated
        }
        
        this.metrics.cacheHits++;
        return false; // Cache was still valid
    }
    
    /**
     * Mark acceleration cache as dirty (force update on next frame)
     */
    invalidateCache() {
        this.accelerationCache.isDirty = true;
    }
    
    /**
     * Request async readback of position texture (non-blocking)
     * @param {THREE.WebGLRenderer} renderer 
     * @param {THREE.WebGLRenderTarget} renderTarget 
     * @param {Function} callback - Called with Float32Array when data is ready
     */
    requestAsyncReadback(renderer, renderTarget, callback) {
        if (!renderer.capabilities.isWebGL2) {
            // Fallback to sync readback
            this.syncReadback(renderer, renderTarget, callback);
            return;
        }
        
        const gl = renderer.getContext();
        const width = renderTarget.width;
        const height = renderTarget.height;
        const pixelCount = width * height * 4;
        
        // Create pixel buffer object for async readback
        const buffer = gl.createBuffer();
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer);
        gl.bufferData(gl.PIXEL_PACK_BUFFER, pixelCount * 4, gl.STREAM_READ);
        
        // Bind framebuffer and initiate async read
        renderer.setRenderTarget(renderTarget);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.FLOAT, 0);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
        renderer.setRenderTarget(null);
        
        // Create sync object to detect completion
        const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        
        this.pendingReadbacks.push({
            buffer,
            sync,
            width,
            height,
            callback,
            gl
        });
        
        this.readbackPending = true;
    }
    
    /**
     * Check and process completed async readbacks
     */
    processPendingReadbacks() {
        const completed = [];
        
        for (let i = this.pendingReadbacks.length - 1; i >= 0; i--) {
            const readback = this.pendingReadbacks[i];
            const { buffer, sync, width, height, callback, gl } = readback;
            
            // Check if sync is complete
            const status = gl.clientWaitSync(sync, 0, 0);
            
            if (status === gl.ALREADY_SIGNALED || status === gl.CONDITION_SATISFIED) {
                // Readback is complete - get the data
                const pixelCount = width * height * 4;
                const data = new Float32Array(pixelCount);
                
                gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer);
                gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, data);
                gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
                
                // Cleanup
                gl.deleteSync(sync);
                gl.deleteBuffer(buffer);
                
                // Store and invoke callback
                this.lastReadbackData = data;
                callback(data);
                
                completed.push(i);
            }
        }
        
        // Remove completed readbacks
        for (const index of completed) {
            this.pendingReadbacks.splice(index, 1);
        }
        
        this.readbackPending = this.pendingReadbacks.length > 0;
    }
    
    /**
     * Synchronous readback (blocking - use sparingly)
     * @param {THREE.WebGLRenderer} renderer 
     * @param {THREE.WebGLRenderTarget} renderTarget 
     * @param {Function} callback 
     */
    syncReadback(renderer, renderTarget, callback) {
        const startTime = performance.now();
        
        const width = renderTarget.width;
        const height = renderTarget.height;
        const pixelCount = width * height * 4;
        const data = new Float32Array(pixelCount);
        
        renderer.readRenderTargetPixels(renderTarget, 0, 0, width, height, data);
        
        this.metrics.readbackTime = performance.now() - startTime;
        this.lastReadbackData = data;
        callback(data);
    }
    
    /**
     * Get cached position data (from last readback)
     * @returns {Float32Array|null}
     */
    getCachedPositionData() {
        return this.lastReadbackData;
    }
    
    /**
     * Get performance metrics
     * @returns {Object}
     */
    getMetrics() {
        return { ...this.metrics };
    }
    
    /**
     * Reset metrics
     */
    resetMetrics() {
        this.metrics = {
            computeTime: 0,
            readbackTime: 0,
            cacheHits: 0,
            cacheMisses: 0
        };
    }
}

/**
 * FrameTimeOptimizer - Manages compute workload distribution across frames
 * Prevents frame spikes by spreading heavy operations
 */
class FrameTimeOptimizer {
    constructor(targetFrameTime = 16.67) {
        this.targetFrameTime = targetFrameTime; // 60 FPS = 16.67ms
        this.frameTimeBudget = targetFrameTime * 0.8; // Leave 20% headroom
        
        // Deferred operations queue
        this.deferredOperations = [];
        
        // Frame timing history
        this.frameHistory = [];
        this.maxHistorySize = 30;
        
        // Work scheduling
        this.pendingWork = [];
        this.workBudgetPerFrame = 4; // Max operations per frame
    }
    
    /**
     * Record frame timing
     * @param {number} frameTime - Time taken for current frame (ms)
     */
    recordFrameTime(frameTime) {
        this.frameHistory.push(frameTime);
        if (this.frameHistory.length > this.maxHistorySize) {
            this.frameHistory.shift();
        }
    }
    
    /**
     * Get average frame time
     * @returns {number}
     */
    getAverageFrameTime() {
        if (this.frameHistory.length === 0) return this.targetFrameTime;
        return this.frameHistory.reduce((a, b) => a + b, 0) / this.frameHistory.length;
    }
    
    /**
     * Check if we have budget for additional work
     * @param {number} estimatedCost - Estimated time for operation (ms)
     * @returns {boolean}
     */
    hasBudget(estimatedCost) {
        const avgFrameTime = this.getAverageFrameTime();
        return avgFrameTime + estimatedCost < this.frameTimeBudget;
    }
    
    /**
     * Schedule work for future frame
     * @param {Function} operation - Work to be done
     * @param {number} priority - Higher = more urgent (0-10)
     * @param {number} estimatedCost - Estimated time in ms
     */
    scheduleWork(operation, priority = 5, estimatedCost = 1) {
        this.pendingWork.push({
            operation,
            priority,
            estimatedCost,
            scheduledTime: performance.now()
        });
        
        // Sort by priority (highest first)
        this.pendingWork.sort((a, b) => b.priority - a.priority);
    }
    
    /**
     * Process pending work within budget
     * @returns {number} Number of operations completed
     */
    processPendingWork() {
        let completed = 0;
        const startTime = performance.now();
        
        while (this.pendingWork.length > 0 && completed < this.workBudgetPerFrame) {
            const elapsed = performance.now() - startTime;
            if (elapsed > this.frameTimeBudget * 0.2) break; // Don't exceed 20% of budget
            
            const work = this.pendingWork.shift();
            work.operation();
            completed++;
        }
        
        return completed;
    }
    
    /**
     * Defer an operation to next frame
     * @param {Function} operation 
     */
    deferToNextFrame(operation) {
        this.deferredOperations.push(operation);
    }
    
    /**
     * Execute deferred operations
     */
    executeDeferredOperations() {
        const operations = this.deferredOperations.splice(0);
        for (const op of operations) {
            op();
        }
    }
}

// Global instances
const gpuComputeManager = new GPUComputeManager();
const frameTimeOptimizer = new FrameTimeOptimizer();

let socket;
let clock;

// --- Camera Control Variables (Zoom Only - No Orbit) ---
// Using spring physics for smooth, organic zoom feel
let zoomSpring = null; // Will be initialized in init()
const MIN_ZOOM = 35;           // Closest zoom (smaller = closer)
const MAX_ZOOM = 180;          // Farthest zoom (larger range for bigger cloud)
const ZOOM_SENSITIVITY = 0.05; // Mouse wheel sensitivity (gentler)

// Camera position springs for smooth screen-space movement
let cameraXSpring = null;
let cameraYSpring = null;

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
// Enhanced tendril visual parameters
const TENDRIL_FLOW_FIELD_STRENGTH = 0.15;   // Flow field influence on tendril path
const TENDRIL_CURVATURE_AMOUNT = 0.12;      // Catmull-Rom spline curvature
const TENDRIL_WIDTH_PROFILE_POWER = 1.5;    // Width taper power (higher = sharper taper)
const TENDRIL_TURBULENCE_FREQ = 0.08;       // Turbulence noise frequency
const TENDRIL_TURBULENCE_AMP = 3.0;         // Turbulence displacement amplitude

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

    // Custom film effects pass (vignette, chromatic aberration, film grain, caustics, dispersion)
    filmPass = new ShaderPass(FilmShader);
    // Initialize Vector2 uniform for radial blur center
    filmPass.uniforms.uRadialBlurCenter.value = new THREE.Vector2(0.5, 0.5);
    composer.addPass(filmPass);

    console.log("Post-processing pipeline initialized with enhanced VFX");
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

    // === INITIALIZE ANIMATION SPRINGS ===
    // Zoom spring: stiff for responsive zoom, moderate damping for slight overshoot
    zoomSpring = new Spring({
        initial: 70,
        target: 70,
        stiffness: 120,   // Responsive but not snappy
        damping: 14,      // Slight overshoot for organic feel
        mass: 1
    });
    
    // Camera position springs for smooth screen-space following
    cameraXSpring = new Spring({
        initial: 0,
        target: 0,
        stiffness: 80,    // Softer for smooth camera movement
        damping: 12,
        mass: 1
    });
    cameraYSpring = new Spring({
        initial: 0,
        target: 0,
        stiffness: 80,
        damping: 12,
        mass: 1
    });
    
    // Configure stagger system for breathing effects (radiate from center)
    animationManager.staggerSystem = new StaggerSystem({
        type: 'distance',
        origin: { x: 0, y: 0, z: 0 },
        amount: 0.015,     // 15ms stagger per unit distance
        maxStagger: 1.5    // Max 1.5 second stagger
    });
    
    console.log("Animation Core initialized: springs, easing, breathing rhythm");

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
             // Enhanced Physics - Vortex Confinement
             uVortexConfinementStrength: { value: VORTEX_CONFINEMENT_STRENGTH },
             uDeltaTime: { value: 0.016 },
             uPreviousPositionBlend: { value: 0.0 },
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
            // Quality/LOD uniforms
            uQualityMultiplier: { value: 1.0 },
            // LOD system uniforms (distance-based quality scaling)
            uLODSizeMultiplier: { value: 1.0 },
            uLODAlphaMultiplier: { value: 1.0 },
            uLODComplexity: { value: 1.0 },
            // Layer system uniforms for visual differentiation
            uLayerBaseColor: { value: LAYER_CONFIG.map(l => new THREE.Vector3(...l.baseColor)) },
            uLayerEdgeColor: { value: LAYER_CONFIG.map(l => new THREE.Vector3(...l.edgeColor)) },
            uLayerOpacity: { value: LAYER_CONFIG.map(l => l.opacity) },
            uLayerSizeMin: { value: LAYER_CONFIG.map(l => l.particleSizeMin) },
            uLayerSizeMax: { value: LAYER_CONFIG.map(l => l.particleSizeMax) },
            uLayerInnerRadius: { value: LAYER_CONFIG.map(l => l.innerRadius) },
            uLayerOuterRadius: { value: LAYER_CONFIG.map(l => l.outerRadius) },
            // === PARTICLE CHARACTER SYSTEM UNIFORMS ===
            uSquashStretchIntensity: { value: SQUASH_STRETCH_INTENSITY },
            uSecondaryMotionStrength: { value: SECONDARY_MOTION_STRENGTH },
            uMoodWaveSpeed: { value: MOOD_WAVE_SPEED },
            uMoodIntensity: { value: MOOD_INTENSITY },
            uBreathingPhase: { value: 0.0 },  // Updated from AnimationCore breathing rhythm
            // === VOLUMETRIC CORE GLOW UNIFORMS ===
            uCoreGlowStrength: { value: 0.4 },   // Intensity of core glow
            uCoreGlowRadius: { value: LAYER_CONFIG[1].outerRadius }  // Radius of core glow effect
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
 * Uses spring physics for smooth, organic zoom feel
 */
function setupCameraControls() {
    const canvas = renderer.domElement;

    // Mouse wheel zoom with spring physics
    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const delta = e.deltaY * ZOOM_SENSITIVITY;
        const currentTarget = zoomSpring.target;
        const newTarget = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, currentTarget + delta));
        zoomSpring.setTarget(newTarget);
        
        // Add a small impulse for extra responsiveness on quick scrolls
        if (Math.abs(e.deltaY) > 50) {
            zoomSpring.impulse(delta * 0.5);
        }
    }, { passive: false });

    // Touch support for mobile - pinch zoom only
    let touchStartDistance = 0;
    let initialZoom = 70;

    canvas.addEventListener('touchstart', (e) => {
        if (e.touches.length === 2) {
            // Pinch zoom start
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            touchStartDistance = Math.sqrt(dx * dx + dy * dy);
            initialZoom = zoomSpring.target;
        }
    }, { passive: true });

    canvas.addEventListener('touchmove', (e) => {
        if (e.touches.length === 2 && touchStartDistance > 0) {
            // Pinch zoom
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            const distance = Math.sqrt(dx * dx + dy * dy);
            const scale = touchStartDistance / distance;
            const newTarget = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, initialZoom * scale));
            zoomSpring.setTarget(newTarget);
        }
    }, { passive: true });

    canvas.addEventListener('touchend', () => {
        touchStartDistance = 0;
    });

    console.log("Camera controls initialized with spring physics (scroll/pinch to zoom)");
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
    const frameStartTime = performance.now();
    requestAnimationFrame(animate);
    const deltaTime = clock.getDelta();
    const elapsedTime = clock.getElapsedTime();

    // --- Update Animation Core Systems ---
    animationManager.update(deltaTime);

    // --- Update WindowManager ---
    if (windowManager) {
        windowManager.update();
    }

    // --- Process Deferred Operations from Previous Frame ---
    frameTimeOptimizer.executeDeferredOperations();
    frameTimeOptimizer.processPendingWork();

    // --- Process Async GPU Readbacks ---
    gpuComputeManager.processPendingReadbacks();

    // --- Adaptive Quality Monitoring ---
    updateAdaptiveQuality(deltaTime, elapsedTime);

    // --- LOD System Update ---
    // Calculate distance from camera to particle cloud center
    const cameraZ = camera.position.z;
    lodManager.update(cameraZ, deltaTime);
    lodManager.updateFrustum(camera);

    // --- Get this window info for screen-space positioning ---
    const thisWindow = windowManager ? windowManager.getThisWindow() : null;

    // --- Screen-Space Camera Positioning (bgstaal approach) with Spring Physics ---
    // Camera position is based on window's screen coordinates
    // This makes particles appear static relative to the monitor as windows move
    if (thisWindow) {
        // Camera looks at the window's screen center
        // Y is inverted: screen Y increases downward, world Y increases upward
        const targetCamX = thisWindow.center.x;
        const targetCamY = -thisWindow.center.y;

        // Use spring physics for smooth, organic camera movement
        cameraXSpring.setTarget(targetCamX);
        cameraYSpring.setTarget(targetCamY);
        
        camera.position.x = cameraXSpring.update(deltaTime);
        camera.position.y = cameraYSpring.update(deltaTime);
    }

    // --- Camera Zoom with Spring Physics ---
    // Spring-based zoom for smooth, organic feel with slight overshoot
    camera.position.z = zoomSpring.update(deltaTime);

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
        // === GPU COMPUTE MANAGER: Update acceleration cache ===
        const cacheUpdated = gpuComputeManager.updateAccelerationCache(elapsedTime, {
            windowCenters: otherWindowCenters,
            sceneOffset: sceneOffset
        });
        
        // Update dynamic uniforms for velocity shader
        velocityVariable.material.uniforms.uNoiseTime.value = elapsedTime * NOISE_SPEED;
        velocityVariable.material.uniforms.uTime.value = elapsedTime;
        velocityVariable.material.uniforms.uDeltaTime.value = deltaTime;

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
        
        // === UPDATE LOD UNIFORMS ===
        const lodUniforms = lodManager.getUniforms();
        material.uniforms.uLODSizeMultiplier.value = lodUniforms.uLODSizeMultiplier;
        material.uniforms.uLODAlphaMultiplier.value = lodUniforms.uLODAlphaMultiplier;
        material.uniforms.uLODComplexity.value = lodUniforms.uLODComplexity;
        
        // === UPDATE PARTICLE CHARACTER SYSTEM UNIFORMS ===
        // Get breathing value from AnimationCore (if available)
        if (animationManager && animationManager.breathingRhythm) {
            material.uniforms.uBreathingPhase.value = animationManager.breathingRhythm.getValue();
        } else {
            // Fallback: simple sine wave breathing
            material.uniforms.uBreathingPhase.value = elapsedTime * 0.5;
        }
    }

    // --- 5. Render with Post-Processing ---
    if (filmPass) {
        filmPass.uniforms.uTime.value = elapsedTime;
    }

    // === LOD-BASED POST-PROCESSING QUALITY ===
    // Reduce bloom strength at distance for performance
    if (bloomPass && lodManager) {
        const lodEffect = lodManager.currentEffectQuality;
        bloomPass.strength = BLOOM_STRENGTH * lodEffect * qualityMultiplier;
    }

    if (composer) {
        composer.render();
    } else {
        renderer.render(scene, camera);
    }

    // --- Frame Time Recording for Optimizer ---
    const frameEndTime = performance.now();
    frameTimeOptimizer.recordFrameTime(frameEndTime - frameStartTime);
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
        
        // === ENHANCED TENDRIL UNIFORMS ===
        uniform float uFlowFieldStrength;      // Influence of flow field on tendril path
        uniform float uCurvatureAmount;        // How much tendrils curve (Catmull-Rom tension)
        uniform float uWidthProfilePower;      // Power for width falloff (higher = sharper taper)
        uniform float uTurbulenceFrequency;    // Frequency of turbulent displacement
        uniform float uTurbulenceAmplitude;    // Amplitude of turbulent displacement

        varying float vAlpha;
        varying vec3 vColor;
        varying float vEnergy;
        varying float vProgress;
        varying float vDirection;
        varying float vHelixStrand; // Which of the 3 helix strands (0, 1, 2)
        varying float vNucleusInfluence;
        varying float vWidthProfile;   // NEW: dynamic width for fragment shader

        // Smooth hash function
        float hash(float n) {
            return fract(sin(n) * 43758.5453123);
        }
        
        // 3D hash for flow field
        vec3 hash3(vec3 p) {
            p = vec3(dot(p, vec3(127.1, 311.7, 74.7)),
                     dot(p, vec3(269.5, 183.3, 246.1)),
                     dot(p, vec3(113.5, 271.9, 124.6)));
            return fract(sin(p) * 43758.5453123);
        }
        
        // Simplex-like 3D noise for flow field
        float noise3D(vec3 p) {
            vec3 i = floor(p);
            vec3 f = fract(p);
            f = f * f * (3.0 - 2.0 * f);
            
            float n = dot(i, vec3(1.0, 57.0, 113.0));
            return mix(mix(mix(hash(n + 0.0), hash(n + 1.0), f.x),
                          mix(hash(n + 57.0), hash(n + 58.0), f.x), f.y),
                      mix(mix(hash(n + 113.0), hash(n + 114.0), f.x),
                          mix(hash(n + 170.0), hash(n + 171.0), f.x), f.y), f.z);
        }
        
        // Flow field - returns displacement vector based on position
        vec3 flowField(vec3 p, float time) {
            float scale = 0.02;
            vec3 scaled = p * scale;
            
            // Multi-octave turbulent flow
            vec3 flow = vec3(0.0);
            float amp = 1.0;
            float freq = 1.0;
            
            for (int i = 0; i < 3; i++) {
                flow.x += (noise3D(scaled * freq + time * 0.1) - 0.5) * amp;
                flow.y += (noise3D(scaled * freq + vec3(100.0, 0.0, 0.0) + time * 0.12) - 0.5) * amp;
                flow.z += (noise3D(scaled * freq + vec3(0.0, 100.0, 0.0) + time * 0.08) - 0.5) * amp;
                amp *= 0.5;
                freq *= 2.0;
            }
            
            return flow;
        }
        
        // Catmull-Rom spline interpolation for smooth curves
        vec3 catmullRom(vec3 p0, vec3 p1, vec3 p2, vec3 p3, float t, float tension) {
            float t2 = t * t;
            float t3 = t2 * t;
            
            // Tension affects how tight the curve is (0.5 = standard, 0 = tight, 1 = loose)
            float s = (1.0 - tension) * 0.5;
            
            vec3 v0 = (p2 - p0) * s;
            vec3 v1 = (p3 - p1) * s;
            
            // Hermite basis functions
            float h1 = 2.0 * t3 - 3.0 * t2 + 1.0;
            float h2 = -2.0 * t3 + 3.0 * t2;
            float h3 = t3 - 2.0 * t2 + t;
            float h4 = t3 - t2;
            
            return h1 * p1 + h2 * p2 + h3 * v0 + h4 * v1;
        }
        
        // Dynamic width profile - organic taper with bulges
        float calculateWidth(float t, float connectionStrength) {
            // Base exponential taper from source to destination
            float baseTaper = pow(1.0 - t, uWidthProfilePower);
            
            // Add organic bulges at key points (source emergence, midpoint pulse)
            float sourceBulge = exp(-t * 4.0) * 0.6;  // Bulge at source
            float midBulge = exp(-pow((t - 0.4) * 3.0, 2.0)) * 0.25;  // Gentle mid-pulse
            
            // Combine for organic profile
            float width = baseTaper * (1.0 + sourceBulge + midBulge);
            
            // Scale by connection strength
            return width * connectionStrength;
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

            // === CATMULL-ROM SPLINE PATH ===
            // Create control points for smooth curved tendril path
            vec3 p0 = uThisCenter;  // Before source
            vec3 p1 = uThisCenter + connDir * uNucleusRadius * 1.1;  // Source
            vec3 p3 = targetCenter - connDir * uCloudRadius * 0.35;  // Destination
            vec3 p4 = targetCenter;  // After destination
            
            // Calculate midpoint with curvature offset
            vec3 midPoint = mix(p1, p3, 0.5);
            // Add perpendicular offset for natural curve
            vec3 curveOffset = perpUp * sin(particleID * 0.1) * connectionDist * uCurvatureAmount;
            curveOffset += right * cos(particleID * 0.13 + globalTime * 0.1) * connectionDist * uCurvatureAmount * 0.5;
            vec3 p2 = midPoint + curveOffset;
            
            // Swap for incoming streams
            if (isIncoming) {
                vec3 tempP1 = p1;
                p1 = p3;
                p3 = tempP1;
                vec3 tempP0 = p0;
                p0 = p4;
                p4 = tempP0;
            }

            // Create perpendicular basis vectors (before spline for flow field)
            vec3 up = vec3(0.0, 1.0, 0.0);
            vec3 right = normalize(cross(connDir, up));
            if (length(right) < 0.1) {
                right = normalize(cross(connDir, vec3(1.0, 0.0, 0.0)));
            }
            vec3 perpUp = normalize(cross(connDir, right));

            // Use Catmull-Rom for smooth path
            // Map t to 0-2 range for two-segment spline
            vec3 basePos;
            float localT = smoothT * 2.0;
            if (localT < 1.0) {
                basePos = catmullRom(p0, p1, p2, p3, localT, 0.5 - uCurvatureAmount);
            } else {
                basePos = catmullRom(p1, p2, p3, p4, localT - 1.0, 0.5 - uCurvatureAmount);
            }
            
            // === FLOW FIELD INFLUENCE ===
            // Add turbulent displacement from flow field
            vec3 flowDisplacement = flowField(basePos, globalTime) * uFlowFieldStrength;
            // Flow field influence decreases toward endpoints (keep endpoints stable)
            float flowInfluence = smoothT * (1.0 - smoothT) * 4.0; // Parabola, max at t=0.5
            basePos += flowDisplacement * flowInfluence * connectionDist * 0.3;
            
            // === DYNAMIC WIDTH PROFILE ===
            float widthProfile = calculateWidth(smoothT, strength);
            vWidthProfile = widthProfile;

            // === TAPERED HELIX RADIUS (now uses dynamic width) ===
            float taperCurve = widthProfile;
            float bulgeFactor = exp(-smoothT * 3.0) * 0.5 + 0.5;
            float helixRadius = 8.0 * taperCurve * bulgeFactor + 1.5;

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

            // === TURBULENT DISPLACEMENT ===
            // Add multi-frequency turbulence for organic feel
            vec3 turbulence = vec3(0.0);
            turbulence.x = noise3D(basePos * uTurbulenceFrequency + globalTime * 0.2) - 0.5;
            turbulence.y = noise3D(basePos * uTurbulenceFrequency + vec3(50.0, 0.0, 0.0) + globalTime * 0.15) - 0.5;
            turbulence.z = noise3D(basePos * uTurbulenceFrequency + vec3(0.0, 50.0, 0.0) + globalTime * 0.18) - 0.5;
            helixOffset += turbulence * uTurbulenceAmplitude * taperCurve;

            // === ORGANIC WAVE PERTURBATION ===
            float waveFreq = 2.5;
            float waveAmp = taperCurve * 2.0;
            float wavePhase = globalTime * 0.5 + smoothT * TAU * waveFreq;

            helixOffset += perpUp * sin(wavePhase) * waveAmp * 0.3;
            helixOffset += right * cos(wavePhase * 0.7 + float(strandIdx)) * waveAmp * 0.2;

            // === BREATHING/PULSE ===
            float breathe = 1.0 + sin(globalTime * 0.6) * 0.08;
            helixOffset *= breathe;

            // Combine position
            vec3 pos = basePos + helixOffset;

            // Transform to screen
            vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
            gl_Position = projectionMatrix * mvPosition;

            // === PARTICLE SIZE - DYNAMIC WIDTH ===
            float sizeTaper = widthProfile * bulgeFactor;
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
        varying float vWidthProfile;   // Dynamic width for enhanced rendering

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
            uGlobalTimeOffset: { value: 0.0 },
            // === ENHANCED TENDRIL UNIFORMS ===
            uFlowFieldStrength: { value: 0.15 },      // Influence of flow field on path
            uCurvatureAmount: { value: 0.12 },        // Catmull-Rom curve intensity
            uWidthProfilePower: { value: 1.5 },       // Width taper power
            uTurbulenceFrequency: { value: 0.08 },    // Turbulence noise frequency
            uTurbulenceAmplitude: { value: 3.0 }      // Turbulence displacement amount
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
