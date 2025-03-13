/**
 * GPUComputationRenderer - Modified for global use without ES modules
 * Based on original by yomboprime
 */

// Define globally accessible GPUComputationRenderer
window.GPUComputationRenderer = function(sizeX, sizeY, renderer) {
    this.variables = [];
    this.currentTextureIndex = 0;
    
    let dataType = THREE.FloatType;
    
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    
    const passThruUniforms = {
        passThruTexture: { value: null }
    };
    
    const passThruVertexShader = `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `;
    
    const passThruFragmentShader = `
        uniform sampler2D passThruTexture;
        varying vec2 vUv;
        void main() {
            gl_FragColor = texture2D(passThruTexture, vUv);
        }
    `;
    
    const passThruShader = createShaderMaterial(passThruFragmentShader, { 
        uniforms: passThruUniforms,
        vertexShader: passThruVertexShader 
    });
    
    const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(2, 2),
        passThruShader
    );
    scene.add(mesh);
    
    // Create a simple FullScreenQuad substitute
    const fsQuad = {
        material: passThruShader,
        render: function(renderer) {
            renderer.render(scene, camera);
        },
        dispose: function() {
            mesh.geometry.dispose();
            passThruShader.dispose();
        }
    };
    
    this.setDataType = function(type) {
        dataType = type;
        return this;
    };
    
    this.addVariable = function(variableName, computeFragmentShader, initialValueTexture) {
        const material = this.createShaderMaterial(computeFragmentShader);
        
        const variable = {
            name: variableName,
            initialValueTexture: initialValueTexture,
            material: material,
            dependencies: null,
            renderTargets: [],
            wrapS: null,
            wrapT: null,
            minFilter: THREE.NearestFilter,
            magFilter: THREE.NearestFilter
        };
        
        this.variables.push(variable);
        return variable;
    };
    
    this.setVariableDependencies = function(variable, dependencies) {
        variable.dependencies = dependencies;
    };
    
    this.init = function() {
        if (!renderer.capabilities.isWebGL2) {
            return 'No WebGL 2 support';
        }
        
        // Create render targets for each variable
        for (let i = 0; i < this.variables.length; i++) {
            const variable = this.variables[i];
            
            // Create two render targets for ping-pong
            variable.renderTargets[0] = this.createRenderTarget(sizeX, sizeY);
            variable.renderTargets[1] = this.createRenderTarget(sizeX, sizeY);
            
            // Copy initial value
            this.renderTexture(variable.initialValueTexture, variable.renderTargets[0]);
            this.renderTexture(variable.initialValueTexture, variable.renderTargets[1]);
            
            // Set up shader uniforms for dependencies
            const material = variable.material;
            const uniforms = material.uniforms;
            
            if (variable.dependencies !== null) {
                for (let d = 0; d < variable.dependencies.length; d++) {
                    const depVar = variable.dependencies[d];
                    
                    if (depVar.name !== variable.name) {
                        // Check if dependency exists
                        let found = false;
                        
                        for (let j = 0; j < this.variables.length; j++) {
                            if (depVar.name === this.variables[j].name) {
                                found = true;
                                break;
                            }
                        }
                        
                        if (!found) {
                            return 'Dependency not found: ' + variable.name + ' depends on ' + depVar.name;
                        }
                    }
                    
                    uniforms[depVar.name] = { value: null };
                    material.fragmentShader = 
                        '\nuniform sampler2D ' + depVar.name + ';\n' + material.fragmentShader;
                }
            }
            
            // Add resolution definition to shader
            material.defines.resolution = 'vec2(' + sizeX.toFixed(1) + ', ' + sizeY.toFixed(1) + ')';
        }
        
        return null; // No errors
    };
    
    this.compute = function() {
        const currentTextureIndex = this.currentTextureIndex;
        const nextTextureIndex = this.currentTextureIndex === 0 ? 1 : 0;
        
        for (let i = 0; i < this.variables.length; i++) {
            const variable = this.variables[i];
            
            // Set up dependencies
            if (variable.dependencies !== null) {
                const uniforms = variable.material.uniforms;
                
                for (let d = 0; d < variable.dependencies.length; d++) {
                    const depVar = variable.dependencies[d];
                    uniforms[depVar.name].value = depVar.renderTargets[currentTextureIndex].texture;
                }
            }
            
            // Compute the next state
            this.doRenderTarget(variable.material, variable.renderTargets[nextTextureIndex]);
        }
        
        this.currentTextureIndex = nextTextureIndex;
    };
    
    this.getCurrentRenderTarget = function(variable) {
        return variable.renderTargets[this.currentTextureIndex];
    };
    
    this.getAlternateRenderTarget = function(variable) {
        return variable.renderTargets[this.currentTextureIndex === 0 ? 1 : 0];
    };
    
    this.createTexture = function() {
        const data = new Float32Array(sizeX * sizeY * 4);
        const texture = new THREE.DataTexture(data, sizeX, sizeY, THREE.RGBAFormat, dataType);
        texture.needsUpdate = true;
        return texture;
    };
    
    this.createRenderTarget = function(sizeX, sizeY) {
        sizeX = sizeX || this.sizeX;
        sizeY = sizeY || this.sizeY;
        
        const options = {
            wrapS: THREE.ClampToEdgeWrapping,
            wrapT: THREE.ClampToEdgeWrapping,
            minFilter: THREE.NearestFilter,
            magFilter: THREE.NearestFilter,
            format: THREE.RGBAFormat,
            type: dataType,
            depthBuffer: false
        };
        
        return new THREE.WebGLRenderTarget(sizeX, sizeY, options);
    };
    
    this.renderTexture = function(input, output) {
        passThruUniforms.passThruTexture.value = input;
        this.doRenderTarget(passThruShader, output);
    };
    
    this.doRenderTarget = function(material, output) {
        mesh.material = material;
        renderer.setRenderTarget(output);
        renderer.render(scene, camera);
        renderer.setRenderTarget(null);
    };
    
    this.createShaderMaterial = function(computeFragmentShader) {
        const uniforms = {};
        
        const material = new THREE.ShaderMaterial({
            uniforms: uniforms,
            vertexShader: passThruVertexShader,
            fragmentShader: computeFragmentShader
        });
        
        return material;
    };
    
    function createShaderMaterial(fragmentShader, uniforms) {
        return new THREE.ShaderMaterial({
            uniforms: uniforms || {},
            vertexShader: passThruVertexShader,
            fragmentShader: fragmentShader
        });
    }
    
    this.dispose = function() {
        fsQuad.dispose();
        
        for (let i = 0; i < this.variables.length; i++) {
            const variable = this.variables[i];
            
            if (variable.initialValueTexture) variable.initialValueTexture.dispose();
            
            for (let j = 0; j < variable.renderTargets.length; j++) {
                variable.renderTargets[j].dispose();
            }
        }
    };
};

console.log("GPUComputationRenderer defined globally");
