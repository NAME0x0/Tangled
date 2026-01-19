from flask import Flask, render_template, send_from_directory, request, jsonify
from flask_socketio import SocketIO, emit
import logging
from datetime import datetime
import json
import threading
import queue
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Any
from enum import Enum
import numpy as np
import time

# Configure detailed logging
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger('Tangled')


# =========================================================================
# GPU TIER CONFIGURATION - Server-side mirroring of client GPU tiers
# =========================================================================

class GPUTier(Enum):
    """GPU capability tiers matching client-side detection"""
    LOW = 'low'
    MEDIUM = 'medium'
    HIGH = 'high'
    ULTRA = 'ultra'


@dataclass
class GPUTierConfig:
    """Configuration for each GPU tier"""
    texture_width: int
    tendril_count: int
    dust_count: int
    bloom_quality: str
    max_particles: int = field(init=False)
    
    def __post_init__(self):
        self.max_particles = self.texture_width * self.texture_width


# Tier configurations matching client-side
GPU_TIER_CONFIGS: Dict[GPUTier, GPUTierConfig] = {
    GPUTier.LOW: GPUTierConfig(
        texture_width=256,
        tendril_count=2000,
        dust_count=500,
        bloom_quality='low'
    ),
    GPUTier.MEDIUM: GPUTierConfig(
        texture_width=384,
        tendril_count=4000,
        dust_count=800,
        bloom_quality='medium'
    ),
    GPUTier.HIGH: GPUTierConfig(
        texture_width=512,
        tendril_count=6000,
        dust_count=1200,
        bloom_quality='high'
    ),
    GPUTier.ULTRA: GPUTierConfig(
        texture_width=1024,
        tendril_count=10000,
        dust_count=2000,
        bloom_quality='ultra'
    )
}


# =========================================================================
# COMPUTE TASK CLASSES - For potential GPU offload
# =========================================================================

@dataclass
class ComputeTask:
    """Base class for compute tasks"""
    task_id: str
    client_sid: str
    created_at: datetime = field(default_factory=datetime.now)
    status: str = 'pending'
    result: Optional[Any] = None
    error: Optional[str] = None


@dataclass
class ParticleComputeTask(ComputeTask):
    """Task for computing particle positions"""
    particle_count: int = 0
    positions: Optional[np.ndarray] = None
    velocities: Optional[np.ndarray] = None
    delta_time: float = 0.016


@dataclass
class TendrilComputeTask(ComputeTask):
    """Task for computing tendril paths between windows"""
    source_center: tuple = (0, 0, 0)
    target_centers: List[tuple] = field(default_factory=list)
    tendril_count: int = 4000


class GPUResourceManager:
    """
    Manages GPU compute resources and offload coordination.
    
    This class handles:
    - Client GPU capability tracking
    - Compute task queuing and distribution
    - Fallback to CPU when GPU unavailable
    - Resource allocation based on tier
    """
    
    def __init__(self):
        self.client_gpu_info: Dict[str, dict] = {}  # sid -> GPU info
        self.compute_queue: queue.Queue = queue.Queue()
        self.results_cache: Dict[str, Any] = {}
        self.worker_thread: Optional[threading.Thread] = None
        self.running = False
        self._lock = threading.Lock()
        
        logger.info("GPUResourceManager initialized")
    
    def register_client_gpu(self, sid: str, gpu_info: dict) -> GPUTierConfig:
        """
        Register a client's GPU capabilities.
        
        Args:
            sid: Client session ID
            gpu_info: Dictionary containing GPU detection results
                - tier: str ('low', 'medium', 'high', 'ultra')
                - renderer: str (GPU name)
                - max_texture_size: int
                - estimated_vram: int (in GB)
                - webgl_version: int (1 or 2)
                
        Returns:
            GPUTierConfig for the detected tier
        """
        with self._lock:
            tier_str = gpu_info.get('tier', 'medium')
            try:
                tier = GPUTier(tier_str)
            except ValueError:
                tier = GPUTier.MEDIUM
                logger.warning(f"Unknown GPU tier '{tier_str}', defaulting to MEDIUM")
            
            config = GPU_TIER_CONFIGS[tier]
            
            self.client_gpu_info[sid] = {
                'tier': tier,
                'config': config,
                'renderer': gpu_info.get('renderer', 'Unknown'),
                'max_texture': gpu_info.get('max_texture_size', 4096),
                'vram_gb': gpu_info.get('estimated_vram', 2),
                'webgl': gpu_info.get('webgl_version', 2),
                'registered_at': datetime.now().isoformat()
            }
            
            logger.info(f"Client {sid[:8]} registered with {tier.value.upper()} tier GPU: "
                       f"{gpu_info.get('renderer', 'Unknown')} "
                       f"({config.max_particles:,} particles)")
            
            return config
    
    def unregister_client(self, sid: str) -> None:
        """Remove client GPU registration"""
        with self._lock:
            if sid in self.client_gpu_info:
                info = self.client_gpu_info.pop(sid)
                logger.info(f"Client {sid[:8]} GPU unregistered ({info['tier'].value})")
    
    def get_client_tier(self, sid: str) -> Optional[GPUTier]:
        """Get GPU tier for a client"""
        with self._lock:
            info = self.client_gpu_info.get(sid)
            return info['tier'] if info else None
    
    def get_client_config(self, sid: str) -> Optional[GPUTierConfig]:
        """Get configuration for a client's GPU tier"""
        with self._lock:
            info = self.client_gpu_info.get(sid)
            return info['config'] if info else None
    
    def get_optimal_particle_count(self, sid: str) -> int:
        """Get optimal particle count for client"""
        config = self.get_client_config(sid)
        if config:
            return config.max_particles
        return GPU_TIER_CONFIGS[GPUTier.MEDIUM].max_particles
    
    def queue_compute_task(self, task: ComputeTask) -> str:
        """
        Queue a compute task for processing.
        
        Args:
            task: ComputeTask to queue
            
        Returns:
            Task ID for tracking
        """
        self.compute_queue.put(task)
        logger.debug(f"Queued compute task {task.task_id} for {task.client_sid[:8]}")
        return task.task_id
    
    def get_aggregate_stats(self) -> dict:
        """Get aggregate statistics across all connected GPUs"""
        with self._lock:
            if not self.client_gpu_info:
                return {'total_clients': 0, 'total_particles': 0}
            
            total_particles = sum(
                info['config'].max_particles 
                for info in self.client_gpu_info.values()
            )
            
            tier_counts = {}
            for info in self.client_gpu_info.values():
                tier_name = info['tier'].value
                tier_counts[tier_name] = tier_counts.get(tier_name, 0) + 1
            
            return {
                'total_clients': len(self.client_gpu_info),
                'total_particles': total_particles,
                'tier_distribution': tier_counts,
                'average_particles': total_particles // max(len(self.client_gpu_info), 1)
            }


class PhysicsEngine:
    """
    CPU-based physics calculations as fallback when GPU compute unavailable.
    
    This provides server-side physics simulation for:
    - Position verification
    - Collision detection between windows
    - Tendril path calculation
    """
    
    def __init__(self):
        self.gravity_constant = 0.001
        self.damping = 0.98
        logger.info("PhysicsEngine initialized (CPU fallback)")
    
    def compute_attractor_force(
        self, 
        position: np.ndarray, 
        attractor: np.ndarray, 
        strength: float = 1.0
    ) -> np.ndarray:
        """
        Compute gravitational attraction force.
        
        Args:
            position: Current position (x, y, z)
            attractor: Attractor position (x, y, z)
            strength: Force multiplier
            
        Returns:
            Force vector (fx, fy, fz)
        """
        delta = attractor - position
        dist_sq = np.sum(delta ** 2) + 0.0001  # Prevent division by zero
        dist = np.sqrt(dist_sq)
        
        # Inverse square law with softening
        force_mag = (self.gravity_constant * strength) / (dist_sq + 1.0)
        
        return (delta / dist) * force_mag
    
    def compute_tendril_path(
        self,
        source: np.ndarray,
        target: np.ndarray,
        num_points: int = 100,
        wave_amplitude: float = 5.0
    ) -> np.ndarray:
        """
        Compute tendril path between two points with organic waviness.
        
        Args:
            source: Start position
            target: End position  
            num_points: Number of points along path
            wave_amplitude: Amplitude of wave displacement
            
        Returns:
            Array of positions along tendril
        """
        t = np.linspace(0, 1, num_points)
        
        # Base linear interpolation
        path = np.outer(1 - t, source) + np.outer(t, target)
        
        # Add organic wave displacement
        # Perpendicular direction
        delta = target - source
        perp = np.array([-delta[1], delta[0], 0])
        perp_norm = perp / (np.linalg.norm(perp) + 0.0001)
        
        # Wave with falloff at endpoints
        wave_envelope = np.sin(t * np.pi)  # Zero at ends
        wave = np.sin(t * 4 * np.pi) * wave_envelope * wave_amplitude
        
        path += np.outer(wave, perp_norm)
        
        return path
    
    def verify_position_bounds(
        self,
        positions: np.ndarray,
        max_radius: float = 100.0
    ) -> np.ndarray:
        """
        Verify and clamp positions to valid bounds.
        
        Args:
            positions: Array of positions (N x 3)
            max_radius: Maximum distance from origin
            
        Returns:
            Clamped positions
        """
        distances = np.linalg.norm(positions, axis=1)
        mask = distances > max_radius
        
        if np.any(mask):
            # Normalize and scale back to boundary
            positions[mask] = (positions[mask].T / distances[mask] * max_radius).T
            
        return positions


class WindowCoordinator:
    """
    Coordinates entanglement state between multiple windows.
    
    Handles:
    - Window position tracking
    - Entanglement pair matching
    - Tendril target assignment
    """
    
    def __init__(self):
        self.windows: Dict[str, dict] = {}
        self.entanglements: Dict[str, List[str]] = {}  # sid -> list of entangled sids
        self._lock = threading.Lock()
        logger.info("WindowCoordinator initialized")
    
    def update_window(self, sid: str, window_data: dict) -> None:
        """Update window position/state"""
        with self._lock:
            self.windows[sid] = {
                **window_data,
                'updated_at': datetime.now().isoformat()
            }
    
    def remove_window(self, sid: str) -> None:
        """Remove window and clean up entanglements"""
        with self._lock:
            self.windows.pop(sid, None)
            self.entanglements.pop(sid, None)
            
            # Remove from other windows' entanglement lists
            for other_sid in list(self.entanglements.keys()):
                if sid in self.entanglements[other_sid]:
                    self.entanglements[other_sid].remove(sid)
    
    def get_nearest_windows(self, sid: str, max_count: int = 4) -> List[dict]:
        """Get nearest windows for tendril connections"""
        with self._lock:
            if sid not in self.windows:
                return []
            
            source = self.windows[sid]
            source_center = source.get('center', {'x': 0, 'y': 0})
            
            distances = []
            for other_sid, other_window in self.windows.items():
                if other_sid == sid:
                    continue
                    
                other_center = other_window.get('center', {'x': 0, 'y': 0})
                dist = (
                    (source_center['x'] - other_center['x']) ** 2 +
                    (source_center['y'] - other_center['y']) ** 2
                ) ** 0.5
                
                distances.append((dist, other_sid, other_window))
            
            # Sort by distance and return nearest
            distances.sort(key=lambda x: x[0])
            
            return [
                {'sid': d[1], 'distance': d[0], **d[2]}
                for d in distances[:max_count]
            ]
    
    def create_entanglement(self, sid1: str, sid2: str) -> bool:
        """Create bidirectional entanglement between windows"""
        with self._lock:
            if sid1 not in self.entanglements:
                self.entanglements[sid1] = []
            if sid2 not in self.entanglements:
                self.entanglements[sid2] = []
            
            if sid2 not in self.entanglements[sid1]:
                self.entanglements[sid1].append(sid2)
            if sid1 not in self.entanglements[sid2]:
                self.entanglements[sid2].append(sid1)
            
            logger.info(f"Entanglement created: {sid1[:8]} <-> {sid2[:8]}")
            return True
    
    def get_window_stats(self) -> dict:
        """Get statistics about window coordination"""
        with self._lock:
            entanglement_count = sum(
                len(partners) for partners in self.entanglements.values()
            ) // 2  # Divide by 2 since bidirectional
            
            return {
                'total_windows': len(self.windows),
                'active_entanglements': entanglement_count,
                'windows': {
                    sid[:8]: {
                        'center': w.get('center'),
                        'entangled_with': len(self.entanglements.get(sid, []))
                    }
                    for sid, w in self.windows.items()
                }
            }


# =========================================================================
# GLOBAL INSTANCES
# =========================================================================

gpu_manager = GPUResourceManager()
physics_engine = PhysicsEngine()
window_coordinator = WindowCoordinator()


# Initialize Flask app and SocketIO
app = Flask(__name__)
app.config['SECRET_KEY'] = 'quantum_entanglement_key_2024!'
socketio = SocketIO(app, async_mode='eventlet', cors_allowed_origins="*", logger=True, engineio_logger=True)

# === SIMULATION STATE ===
sim_params = {
    'particle_count': 65536,
    'attractor_pos': {'x': 0, 'y': 0, 'z': 0},
    'particle_color': '#ffffff',
    'bloom_strength': 0.55,
    'tendril_enabled': True,
    'dust_enabled': True,
    'last_updated': None
}

# === CONNECTION TRACKING ===
connected_clients = {}  # sid -> {connected_at, window_info, last_heartbeat}
client_windows = {}     # sid -> {x, y, w, h, center}

# === METRICS ===
metrics = {
    'total_connections': 0,
    'total_disconnections': 0,
    'messages_sent': 0,
    'messages_received': 0,
    'server_start_time': datetime.now().isoformat()
}

def log_event(event_type, details, level='info'):
    """Centralized logging with context"""
    timestamp = datetime.now().isoformat()
    log_data = {
        'timestamp': timestamp,
        'event': event_type,
        'details': details,
        'active_clients': len(connected_clients)
    }
    log_msg = f"[{event_type}] {json.dumps(details)} | Clients: {len(connected_clients)}"
    
    if level == 'debug':
        logger.debug(log_msg)
    elif level == 'warning':
        logger.warning(log_msg)
    elif level == 'error':
        logger.error(log_msg)
    else:
        logger.info(log_msg)
    
    return log_data

@app.route('/')
def index():
    """Serve the main HTML page."""
    log_event('PAGE_REQUEST', {'path': '/', 'remote_addr': request.remote_addr})
    return render_template('index.html')

@app.route('/static/<path:path>')
def send_static(path):
    """Serve static files with logging."""
    log_event('STATIC_REQUEST', {'path': path}, level='debug')
    return send_from_directory('static', path)

@app.route('/api/status')
def api_status():
    """API endpoint for server status and metrics."""
    gpu_stats = gpu_manager.get_aggregate_stats()
    window_stats = window_coordinator.get_window_stats()
    
    status = {
        'status': 'online',
        'uptime_since': metrics['server_start_time'],
        'active_connections': len(connected_clients),
        'metrics': metrics,
        'sim_params': sim_params,
        'gpu_stats': gpu_stats,
        'window_stats': window_stats
    }
    log_event('STATUS_REQUEST', {'requester': request.remote_addr})
    return jsonify(status)

@app.route('/api/clients')
def api_clients():
    """API endpoint for connected clients info."""
    clients_info = []
    for sid, info in connected_clients.items():
        gpu_info = gpu_manager.client_gpu_info.get(sid, {})
        client_data = {
            'sid': sid[:8] + '...',  # Truncate for privacy
            'connected_at': info.get('connected_at'),
            'window_info': client_windows.get(sid, {}),
            'gpu_tier': gpu_info.get('tier', GPUTier.MEDIUM).value if isinstance(gpu_info.get('tier'), GPUTier) else 'unknown',
            'particle_count': gpu_info.get('config', {}).max_particles if hasattr(gpu_info.get('config', {}), 'max_particles') else 0
        }
        clients_info.append(client_data)
    return jsonify({'clients': clients_info, 'count': len(clients_info)})

@app.route('/api/gpu-stats')
def api_gpu_stats():
    """API endpoint for GPU statistics across all clients."""
    stats = gpu_manager.get_aggregate_stats()
    return jsonify(stats)


# === SOCKETIO EVENT HANDLERS ===

@socketio.on('connect')
def handle_connect():
    """Handle new client connection with detailed logging."""
    sid = request.sid
    client_ip = request.remote_addr
    
    connected_clients[sid] = {
        'connected_at': datetime.now().isoformat(),
        'ip': client_ip,
        'last_heartbeat': datetime.now().isoformat()
    }
    
    metrics['total_connections'] += 1
    
    log_event('CLIENT_CONNECT', {
        'sid': sid,
        'ip': client_ip,
        'total_ever': metrics['total_connections']
    })
    
    # Send current parameters and connection confirmation
    emit('update_params', sim_params)
    emit('connection_confirmed', {
        'sid': sid,
        'server_time': datetime.now().isoformat(),
        'active_clients': len(connected_clients),
        'server_capabilities': {
            'gpu_offload': True,
            'physics_engine': True,
            'window_coordination': True
        }
    })
    
    # Broadcast to other clients that a new window connected
    emit('client_joined', {
        'new_client': sid[:8],
        'total_clients': len(connected_clients)
    }, broadcast=True, include_self=False)
    
    metrics['messages_sent'] += 2

@socketio.on('disconnect')
def handle_disconnect():
    """Handle client disconnection with cleanup."""
    sid = request.sid
    
    client_info = connected_clients.pop(sid, {})
    window_info = client_windows.pop(sid, {})
    
    # Clean up GPU and window coordination
    gpu_manager.unregister_client(sid)
    window_coordinator.remove_window(sid)
    
    metrics['total_disconnections'] += 1
    
    log_event('CLIENT_DISCONNECT', {
        'sid': sid,
        'was_connected_at': client_info.get('connected_at'),
        'had_window': bool(window_info)
    })
    
    # Notify other clients
    emit('client_left', {
        'left_client': sid[:8],
        'total_clients': len(connected_clients)
    }, broadcast=True)
    
    metrics['messages_sent'] += 1

@socketio.on('window_update')
def handle_window_update(data):
    """Track window position/size for cross-window coordination."""
    sid = request.sid
    metrics['messages_received'] += 1
    
    window_data = {
        'x': data.get('x', 0),
        'y': data.get('y', 0),
        'w': data.get('w', 800),
        'h': data.get('h', 600),
        'center': data.get('center', {'x': 400, 'y': 300}),
        'updated_at': datetime.now().isoformat()
    }
    
    client_windows[sid] = window_data
    window_coordinator.update_window(sid, window_data)
    
    if sid in connected_clients:
        connected_clients[sid]['last_heartbeat'] = datetime.now().isoformat()
    
    log_event('WINDOW_UPDATE', {
        'sid': sid[:8],
        'position': f"({data.get('x')}, {data.get('y')})",
        'size': f"{data.get('w')}x{data.get('h')}"
    }, level='debug')
    
    # Get nearest windows for tendril targeting
    nearest = window_coordinator.get_nearest_windows(sid, max_count=4)
    
    # Broadcast updated window positions to all clients for tendril targeting
    all_windows = []
    for client_sid, win_info in client_windows.items():
        all_windows.append({
            'sid': client_sid[:8],
            'center': win_info.get('center'),
            'is_self': client_sid == sid
        })
    
    emit('windows_sync', {
        'windows': all_windows,
        'nearest': nearest
    }, broadcast=True)
    metrics['messages_sent'] += 1


@socketio.on('register_gpu')
def handle_register_gpu(data):
    """Register client GPU capabilities for optimal configuration."""
    sid = request.sid
    metrics['messages_received'] += 1
    
    gpu_info = {
        'tier': data.get('tier', 'medium'),
        'renderer': data.get('renderer', 'Unknown'),
        'max_texture_size': data.get('maxTextureSize', 4096),
        'estimated_vram': data.get('estimatedVRAM', 2),
        'webgl_version': data.get('webglVersion', 2)
    }
    
    config = gpu_manager.register_client_gpu(sid, gpu_info)
    
    log_event('GPU_REGISTERED', {
        'sid': sid[:8],
        'tier': gpu_info['tier'],
        'renderer': gpu_info['renderer'],
        'particles': config.max_particles
    })
    
    # Send back optimized configuration
    emit('gpu_config', {
        'tier': gpu_info['tier'],
        'textureWidth': config.texture_width,
        'particleCount': config.max_particles,
        'tendrilCount': config.tendril_count,
        'dustCount': config.dust_count,
        'bloomQuality': config.bloom_quality
    })
    metrics['messages_sent'] += 1


@socketio.on('compute_request')
def handle_compute_request(data):
    """Handle compute offload requests from clients."""
    sid = request.sid
    metrics['messages_received'] += 1
    
    task_type = data.get('type', 'unknown')
    
    log_event('COMPUTE_REQUEST', {
        'sid': sid[:8],
        'task_type': task_type
    }, level='debug')
    
    if task_type == 'tendril_path':
        # Compute tendril path on server (CPU fallback)
        source = np.array(data.get('source', [0, 0, 0]))
        target = np.array(data.get('target', [0, 0, 0]))
        
        path = physics_engine.compute_tendril_path(
            source, target,
            num_points=data.get('numPoints', 100),
            wave_amplitude=data.get('waveAmplitude', 5.0)
        )
        
        emit('compute_result', {
            'type': 'tendril_path',
            'path': path.tolist()
        })
        metrics['messages_sent'] += 1
        
    elif task_type == 'verify_bounds':
        # Verify particle positions are within bounds
        positions = np.array(data.get('positions', []))
        if len(positions) > 0:
            verified = physics_engine.verify_position_bounds(
                positions,
                max_radius=data.get('maxRadius', 100.0)
            )
            emit('compute_result', {
                'type': 'verify_bounds',
                'positions': verified.tolist()
            })
            metrics['messages_sent'] += 1

@socketio.on('request_params')
def handle_request_params(data):
    """Client explicitly requests parameters."""
    sid = request.sid
    metrics['messages_received'] += 1
    
    log_event('PARAMS_REQUEST', {'sid': sid[:8], 'request_data': data})
    
    emit('update_params', sim_params)
    metrics['messages_sent'] += 1

@socketio.on('update_params_request')
def handle_update_params_request(new_params):
    """Handle request from client to update parameters."""
    sid = request.sid
    metrics['messages_received'] += 1
    
    log_event('PARAMS_UPDATE_REQUEST', {
        'sid': sid[:8],
        'requested_changes': new_params
    })
    
    # Validate and merge parameters
    updated_keys = []
    for key, value in new_params.items():
        if key in sim_params:
            old_value = sim_params[key]
            sim_params[key] = value
            updated_keys.append(f"{key}: {old_value} -> {value}")
    
    sim_params['last_updated'] = datetime.now().isoformat()
    
    log_event('PARAMS_UPDATED', {
        'changes': updated_keys,
        'by_client': sid[:8]
    })
    
    # Broadcast to ALL connected clients
    socketio.emit('update_params', sim_params)
    metrics['messages_sent'] += len(connected_clients)

@socketio.on('heartbeat')
def handle_heartbeat(data):
    """Handle client heartbeat for connection health monitoring."""
    sid = request.sid
    
    if sid in connected_clients:
        connected_clients[sid]['last_heartbeat'] = datetime.now().isoformat()
        connected_clients[sid]['fps'] = data.get('fps', 0)
        connected_clients[sid]['particle_count'] = data.get('particle_count', 0)
    
    log_event('HEARTBEAT', {
        'sid': sid[:8],
        'fps': data.get('fps'),
        'particles': data.get('particle_count')
    }, level='debug')
    
    emit('heartbeat_ack', {'server_time': datetime.now().isoformat()})

@socketio.on('entanglement_event')
def handle_entanglement_event(data):
    """Track entanglement events between windows."""
    sid = request.sid
    metrics['messages_received'] += 1
    
    log_event('ENTANGLEMENT_EVENT', {
        'sid': sid[:8],
        'event_type': data.get('type'),
        'target_window': data.get('target'),
        'intensity': data.get('intensity')
    })
    
    # Broadcast entanglement state to enable synchronized effects
    emit('entanglement_sync', {
        'source': sid[:8],
        'data': data
    }, broadcast=True)
    metrics['messages_sent'] += len(connected_clients)

@socketio.on_error_default
def default_error_handler(e):
    """Handle SocketIO errors."""
    log_event('SOCKET_ERROR', {'error': str(e)}, level='error')


if __name__ == '__main__':
    print("=" * 60)
    print("  TANGLED - Quantum Entangled Particle Visualization")
    print("=" * 60)
    print("  Server starting at:", datetime.now().strftime('%Y-%m-%d %H:%M:%S'))
    print("  Listening on: http://0.0.0.0:5000")
    print("  Status API: http://localhost:5000/api/status")
    print("  Clients API: http://localhost:5000/api/clients")
    print("=" * 60)
    
    log_event('SERVER_START', {
        'host': '0.0.0.0',
        'port': 5000,
        'debug': True
    })
    
    socketio.run(app, host='0.0.0.0', port=5000, debug=True) 