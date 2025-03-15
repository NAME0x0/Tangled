/**
 * GPUComputationRenderer, based on code by Bjorn Staal
 */

import * as THREE from 'three';

class GPUComputationRenderer {

	/**
	 * Constructs a new GPU computation renderer.
	 *
	 * @param {number} sizeX - Computation problem size is always 2d: sizeX * sizeY elements.
	 * @param {number} sizeY - Computation problem size is always 2d: sizeX * sizeY elements.
	 * @param {WebGLRenderer} renderer - The renderer.
	 */
	constructor( sizeX, sizeY, renderer ) {

		this.variables = [];

		this.currentTextureIndex = 0;

		let dataType = THREE.FloatType;

		this.sizeX = sizeX;
		this.sizeY = sizeY;

		this.renderer = renderer;

		this.scene = new THREE.Scene();

		this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

		this.passThruUniforms = {
			passThruTexture: { value: null }
		};

		this.passThruShader = this.createShaderMaterial( this.getPassThroughFragmentShader(), this.passThruUniforms );

		this.mesh = new THREE.Mesh( new THREE.PlaneGeometry(2, 2), this.passThruShader );
		this.scene.add( this.mesh );

		/**
		 * Sets the data type of the internal textures.
		 *
		 * @param {(FloatType|HalfFloatType)} type - The type to set.
		 * @return {GPUComputationRenderer} A reference to this renderer.
		 */
		this.setDataType = function ( type ) {

			dataType = type;
			return this;

		};

		/**
		 * Adds a compute variable to the renderer.
		 *
		 * @param {string} variableName - The variable name.
		 * @param {string} computeFragmentShader - The compute (fragment) shader source.
		 * @param {Texture} initialValueTexture - The initial value texture.
		 * @return {Object} The compute variable.
		 */
		this.addVariable = function ( variableName, computeFragmentShader, initialValueTexture ) {

			const material = this.createShaderMaterial( computeFragmentShader );

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

			this.variables.push( variable );

			return variable;

		};

		/**
		 * Sets variable dependencies.
		 *
		 * @param {Object} variable - The compute variable.
		 * @param {Array<Object>} dependencies - Other compute variables that represents the dependencies.
		 */
		this.setVariableDependencies = function ( variable, dependencies ) {

			variable.dependencies = dependencies;

		};

		/**
		 * Initializes the renderer.
		 *
		 * @return {?string} Returns `null` if no errors are detected. Otherwise returns the error message.
		 */
		this.init = function () {

			if ( ! this.renderer.capabilities.isWebGL2 ) {

				console.error( 'WebGL 2.0 not available' );
				return 'WebGL 2.0 not available';

			}

			if ( this.renderer.capabilities.maxVertexTextures === 0 ) {

				console.error( 'No support for vertex textures' );
				return 'No support for vertex textures';

			}

			for ( let i = 0; i < this.variables.length; i ++ ) {

				const variable = this.variables[ i ];

				// Creates ping-pong render targets for this variable
				variable.renderTargets[ 0 ] = this.createRenderTarget( this.sizeX, this.sizeY, variable.wrapS, variable.wrapT, variable.minFilter, variable.magFilter );
				variable.renderTargets[ 1 ] = this.createRenderTarget( this.sizeX, this.sizeY, variable.wrapS, variable.wrapT, variable.minFilter, variable.magFilter );

				// Initializes the variable with the texture passed as an argument
				this.renderTexture( variable.initialValueTexture, variable.renderTargets[ 0 ] );
				this.renderTexture( variable.initialValueTexture, variable.renderTargets[ 1 ] );

				// Adds dependencies uniforms to the ShaderMaterial
				const material = variable.material;
				const uniforms = material.uniforms;

				for ( let j = 0; j < variable.dependencies.length; j ++ ) {

					const depVar = variable.dependencies[ j ];

					if ( depVar.name !== variable.name ) {

						// Checks if variable exists
						let found = false;
						for ( let k = 0; k < this.variables.length; k ++ ) {

							if ( depVar.name === this.variables[ k ].name ) {

								found = true;
								break;

							}

						}

						if ( ! found ) {

							console.error( 'Variable dependency not found. Dependency: ', depVar.name, ' does not exist.' );

						}

					}

					uniforms[ depVar.name ] = { value: null };

				}

				uniforms[ 'resolution' ] = { value: new THREE.Vector2( this.sizeX, this.sizeY ) };

			}

			return null;

		};

		/**
		 * Executes the compute. This method is usually called in the animation loop.
		 */
		this.compute = function () {

			const currentTextureIndex = this.currentTextureIndex;
			const nextTextureIndex = this.currentTextureIndex === 0 ? 1 : 0;

			for ( let i = 0, il = this.variables.length; i < il; i ++ ) {

				const variable = this.variables[ i ];

				// Sets texture dependencies uniforms
				if ( variable.dependencies !== null ) {

					const uniforms = variable.material.uniforms;

					for ( let j = 0, jl = variable.dependencies.length; j < jl; j ++ ) {

						const depVar = variable.dependencies[ j ];

						uniforms[ depVar.name ].value = depVar.renderTargets[ currentTextureIndex ].texture;

					}

				}

				// Performs computation
				this.doRenderTarget( variable.material, variable.renderTargets[ nextTextureIndex ] );

			}

			this.currentTextureIndex = nextTextureIndex;

		};

		/**
		 * Returns the current render target for the given compute variable.
		 *
		 * @param {Object} variable - The compute variable.
		 * @return {WebGLRenderTarget} The current render target.
		 */
		this.getCurrentRenderTarget = function ( variable ) {

			return variable.renderTargets[ this.currentTextureIndex ];

		};

		/**
		 * Returns the alternate render target for the given compute variable.
		 *
		 * @param {Object} variable - The compute variable.
		 * @return {WebGLRenderTarget} The alternate render target.
		 */
		this.getAlternateRenderTarget = function ( variable ) {

			return variable.renderTargets[ this.currentTextureIndex === 0 ? 1 : 0 ];

		};

		/**
		 * Frees all internal resources. Call this method if you don't need the
		 * renderer anymore.
		 */
		this.dispose = function () {

			this.mesh.material.dispose();

			const variables = this.variables;

			for ( let i = 0; i < variables.length; i ++ ) {

				const variable = variables[ i ];

				if ( variable.initialValueTexture ) variable.initialValueTexture.dispose();

				const renderTargets = variable.renderTargets;

				for ( let j = 0; j < renderTargets.length; j ++ ) {

					const renderTarget = renderTargets[ j ];
					renderTarget.dispose();

				}

			}

		};

		/**
		 * Creates a new render target from the given parameters.
		 *
		 * @param {number} sizeXTexture - The width of the render target.
		 * @param {number} sizeYTexture - The height of the render target.
		 * @param {number} wrapS - The wrapS value.
		 * @param {number} wrapT - The wrapS value.
		 * @param {number} minFilter - The minFilter value.
		 * @param {number} magFilter - The magFilter value.
		 * @return {WebGLRenderTarget} The new render target.
		 */
		this.createRenderTarget = function ( sizeXTexture, sizeYTexture, wrapS, wrapT, minFilter, magFilter ) {

			sizeXTexture = sizeXTexture || this.sizeX;
			sizeYTexture = sizeYTexture || this.sizeY;

			wrapS = wrapS || THREE.ClampToEdgeWrapping;
			wrapT = wrapT || THREE.ClampToEdgeWrapping;

			minFilter = minFilter || THREE.NearestFilter;
			magFilter = magFilter || THREE.NearestFilter;

			const renderTarget = new THREE.WebGLRenderTarget( sizeXTexture, sizeYTexture, {
				wrapS: wrapS,
				wrapT: wrapT,
				minFilter: minFilter,
				magFilter: magFilter,
				format: THREE.RGBAFormat,
				type: dataType,
				depthBuffer: false
			} );

			return renderTarget;

		};

		/**
		 * Creates a new data texture.
		 *
		 * @return {DataTexture} The new data texture.
		 */
		this.createTexture = function ( sizeXTexture, sizeYTexture ) {

			const data = new Float32Array( sizeXTexture * sizeYTexture * 4 );
			const texture = new THREE.DataTexture( data, sizeXTexture, sizeYTexture, THREE.RGBAFormat, dataType );
			texture.needsUpdate = true;
			return texture;

		};

		/**
		 * Renders the given texture into the given render target.
		 *
		 * @param {Texture} input - The input.
		 * @param {WebGLRenderTarget} output - The output.
		 */
		this.renderTexture = function ( input, output ) {

			this.passThruUniforms.passThruTexture.value = input;

			this.doRenderTarget( this.passThruShader, output );

			this.passThruUniforms.passThruTexture.value = null;

		};

		/**
		 * Renders the given material into the given render target
		 * with a full-screen pass.
		 *
		 * @param {Material} material - The material.
		 * @param {WebGLRenderTarget} output - The output.
		 */
		this.doRenderTarget = function ( material, output ) {

			this.mesh.material = material;
			const oldRenderTarget = this.renderer.getRenderTarget();
			this.renderer.setRenderTarget( output );
			this.renderer.render( this.scene, this.camera );
			this.renderer.setRenderTarget( oldRenderTarget );

		};

		// Shaders

		this.getPassThroughVertexShader = function () {

			return `
				varying vec2 vUv;
				void main() {
					vUv = uv;
					gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
				}
			`;

		};

		this.getPassThroughFragmentShader = function () {

			return `
				uniform sampler2D passThruTexture;
				varying vec2 vUv;
				void main() {
					vec4 color = texture2D( passThruTexture, vUv );
					gl_FragColor = color;
				}
			`;

		};

		this.createShaderMaterial = function ( computeFragmentShader, uniforms ) {
			uniforms = uniforms || {};

			const material = new THREE.ShaderMaterial({
				uniforms: uniforms,
				vertexShader: this.getPassThroughVertexShader(),
				fragmentShader: computeFragmentShader
			});

			return material;
		};

	}

}

export { GPUComputationRenderer };
