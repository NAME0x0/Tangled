// Fallback controls for Three.js in case the CDN version doesn't load correctly

// Create the OrbitControls if it doesn't exist
if (typeof THREE !== 'undefined' && typeof THREE.OrbitControls === 'undefined') {
    console.log('Adding fallback OrbitControls');
    
    THREE.OrbitControls = function(camera, domElement) {
        this.camera = camera;
        this.domElement = domElement || document;
        this.enabled = true;
        this.enableDamping = false;
        this.dampingFactor = 0.05;
        
        // Simple implementation that just handles basic rotation
        var scope = this;
        var rotateStart = new THREE.Vector2();
        var rotateEnd = new THREE.Vector2();
        var rotateDelta = new THREE.Vector2();
        var isDragging = false;
        
        function onMouseDown(event) {
            if (!scope.enabled) return;
            
            rotateStart.set(event.clientX, event.clientY);
            isDragging = true;
            
            document.addEventListener('mousemove', onMouseMove, false);
            document.addEventListener('mouseup', onMouseUp, false);
        }
        
        function onMouseMove(event) {
            if (!scope.enabled) return;
            if (!isDragging) return;
            
            rotateEnd.set(event.clientX, event.clientY);
            rotateDelta.subVectors(rotateEnd, rotateStart);
            
            // Rotate based on mouse movement
            scope.camera.rotation.y -= rotateDelta.x * 0.01;
            scope.camera.rotation.x -= rotateDelta.y * 0.01;
            
            rotateStart.copy(rotateEnd);
        }
        
        function onMouseUp() {
            isDragging = false;
            document.removeEventListener('mousemove', onMouseMove, false);
            document.removeEventListener('mouseup', onMouseUp, false);
        }
        
        this.domElement.addEventListener('mousedown', onMouseDown, false);
        
        // Update method (called in animation loop)
        this.update = function() {
            // In this simplified version, we don't need to do anything in update
            return false;
        };
        
        this.dispose = function() {
            this.domElement.removeEventListener('mousedown', onMouseDown, false);
        };
    };
}

// Create the DragControls if it doesn't exist
if (typeof THREE !== 'undefined' && typeof THREE.DragControls === 'undefined') {
    console.log('Adding fallback DragControls');
    
    THREE.DragControls = function(objects, camera, domElement) {
        this.objects = objects || [];
        this.camera = camera;
        this.domElement = domElement || document;
        
        var scope = this;
        var _selected = null;
        var _raycaster = new THREE.Raycaster();
        var _mouse = new THREE.Vector2();
        var _offset = new THREE.Vector3();
        var _intersection = new THREE.Vector3();
        
        function activate() {
            domElement.addEventListener('mousedown', onDocumentMouseDown, false);
        }
        
        function deactivate() {
            domElement.removeEventListener('mousedown', onDocumentMouseDown, false);
        }
        
        function onDocumentMouseDown(event) {
            event.preventDefault();
            
            _mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
            _mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
            
            _raycaster.setFromCamera(_mouse, camera);
            
            var intersects = _raycaster.intersectObjects(scope.objects);
            
            if (intersects.length > 0) {
                _selected = intersects[0].object;
                
                _raycaster.ray.at(intersects[0].distance, _intersection);
                _offset.copy(_intersection).sub(_selected.position);
                
                scope.dispatchEvent({type: 'dragstart', object: _selected});
                
                document.addEventListener('mousemove', onDocumentMouseMove, false);
                document.addEventListener('mouseup', onDocumentMouseUp, false);
            }
        }
        
        function onDocumentMouseMove(event) {
            event.preventDefault();
            
            _mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
            _mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
            
            _raycaster.setFromCamera(_mouse, camera);
            
            if (_selected) {
                _raycaster.ray.at(10, _intersection); // Fixed distance plane
                _selected.position.copy(_intersection.sub(_offset));
                
                scope.dispatchEvent({type: 'drag', object: _selected});
            }
        }
        
        function onDocumentMouseUp(event) {
            event.preventDefault();
            
            if (_selected) {
                scope.dispatchEvent({type: 'dragend', object: _selected});
                _selected = null;
            }
            
            document.removeEventListener('mousemove', onDocumentMouseMove, false);
            document.removeEventListener('mouseup', onDocumentMouseUp, false);
        }
        
        activate();
        
        // EventDispatcher functionality
        var _listeners = {};
        
        this.addEventListener = function(type, listener) {
            if (_listeners[type] === undefined) {
                _listeners[type] = [];
            }
            if (_listeners[type].indexOf(listener) === -1) {
                _listeners[type].push(listener);
            }
        };
        
        this.dispatchEvent = function(event) {
            var listenerArray = _listeners[event.type];
            if (listenerArray !== undefined) {
                var array = listenerArray.slice(0);
                for (var i = 0; i < array.length; i++) {
                    array[i].call(this, event);
                }
            }
        };
    };
}

console.log('Fallback controls loaded'); 