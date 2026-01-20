/**
 * WindowManager - Manages multi-window coordination for Tangled
 *
 * Uses BroadcastChannel for instant cross-window messaging (primary)
 * with localStorage as fallback for browsers without BroadcastChannel support.
 * Each window shares its screen position and receives updates instantly.
 */

export class WindowManager {
    static STORAGE_KEY = 'tangled_windows';
    static STALE_TIMEOUT = 2000; // ms - windows not updated within this time are considered closed
    static COUNTER_KEY = 'tangled_window_counter';
    static CHANNEL_NAME = 'tangled_window_channel';  // BroadcastChannel name

    // Message types for BroadcastChannel
    static MSG_REGISTER = 'register';      // New window joining
    static MSG_UPDATE = 'update';          // Window position/shape update
    static MSG_UNREGISTER = 'unregister';  // Window closing
    static MSG_HEARTBEAT = 'heartbeat';    // Keep-alive ping
    static MSG_SYNC_REQUEST = 'sync_request';   // Request full sync from all windows
    static MSG_SYNC_RESPONSE = 'sync_response'; // Response with window data
    static MSG_CUSTOM = 'custom';          // Custom application messages

    constructor() {
        this.id = null;
        this.metaData = null;
        this.windows = {};
        this.winChangeCallback = null;
        this.winShapeChangeCallback = null;
        this.customMessageCallback = null;  // NEW: callback for custom messages
        this.lastShape = { x: 0, y: 0, w: 0, h: 0 };
        this.initialized = false;
        this.isParent = false;  // True if this is the first/parent window
        this.createdAt = null;  // Timestamp when this window was created
        
        // BroadcastChannel support
        this.channel = null;
        this.useBroadcastChannel = typeof BroadcastChannel !== 'undefined';
        this.heartbeatInterval = null;
        this.lastHeartbeatTimes = {};  // Track last heartbeat from each window
    }

    /**
     * Initialize the window manager
     * @param {Object} metaData - Optional metadata to store with this window
     */
    init(metaData = {}) {
        this.metaData = metaData;
        this.createdAt = Date.now();

        // FIRST: Clean up stale windows before checking parent/child status
        // This prevents false positives from previous sessions
        let existingWindows = this._loadWindows();
        const now = Date.now();
        let cleaned = false;
        
        for (const id in existingWindows) {
            if (now - existingWindows[id].updated > WindowManager.STALE_TIMEOUT) {
                console.log(`Cleaning stale window at init: ${id}`);
                delete existingWindows[id];
                cleaned = true;
            }
        }
        
        if (cleaned) {
            this._saveWindows(existingWindows);
        }
        
        const existingCount = Object.keys(existingWindows).length;

        // First window becomes the parent (after stale cleanup)
        this.isParent = existingCount === 0;

        // Generate unique window ID using a counter in localStorage
        this.id = this._getNextId();

        // Get current window shape
        this.lastShape = this._getWindowShape();

        // === INITIALIZE BROADCAST CHANNEL ===
        if (this.useBroadcastChannel) {
            this._initBroadcastChannel();
        }

        // Register this window
        this._registerWindow();

        // Listen for storage events from other windows (fallback/backup)
        window.addEventListener('storage', this._onStorageChange.bind(this));

        // Clean up on window close
        window.addEventListener('beforeunload', this._onBeforeUnload.bind(this));

        // Start heartbeat for liveness detection
        this._startHeartbeat();

        this.initialized = true;
        const commMode = this.useBroadcastChannel ? 'BroadcastChannel' : 'localStorage';
        console.log(`WindowManager initialized with ID: ${this.id} (${this.isParent ? 'PARENT' : 'CHILD'}) [${commMode}]`);

        // Request sync from other windows
        if (this.useBroadcastChannel) {
            this._broadcast(WindowManager.MSG_SYNC_REQUEST, { requesterId: this.id });
        }

        return this.id;
    }

    /**
     * Initialize BroadcastChannel for instant cross-window messaging
     */
    _initBroadcastChannel() {
        try {
            this.channel = new BroadcastChannel(WindowManager.CHANNEL_NAME);
            this.channel.onmessage = this._onBroadcastMessage.bind(this);
            this.channel.onmessageerror = (e) => {
                console.warn('BroadcastChannel message error:', e);
            };
            console.log('BroadcastChannel initialized');
        } catch (e) {
            console.warn('Failed to initialize BroadcastChannel, falling back to localStorage:', e);
            this.useBroadcastChannel = false;
            this.channel = null;
        }
    }

    /**
     * Handle incoming BroadcastChannel messages
     */
    _onBroadcastMessage(event) {
        const { type, data, senderId } = event.data;
        
        // Ignore our own messages
        if (senderId === this.id) return;
        
        switch (type) {
            case WindowManager.MSG_REGISTER:
                // New window joined - add to our local cache
                this._handleWindowRegister(data);
                break;
                
            case WindowManager.MSG_UPDATE:
                // Window position update - instant update
                this._handleWindowUpdate(data);
                break;
                
            case WindowManager.MSG_UNREGISTER:
                // Window closing - remove from cache
                this._handleWindowUnregister(data);
                break;
                
            case WindowManager.MSG_HEARTBEAT:
                // Update last heartbeat time for this window
                this.lastHeartbeatTimes[senderId] = Date.now();
                break;
                
            case WindowManager.MSG_SYNC_REQUEST:
                // Another window is requesting sync - send our info
                this._broadcast(WindowManager.MSG_SYNC_RESPONSE, this._getWindowInfo());
                break;
                
            case WindowManager.MSG_SYNC_RESPONSE:
                // Received sync data from another window
                this._handleWindowUpdate(data);
                break;
                
            case WindowManager.MSG_CUSTOM:
                // Custom application message
                if (this.customMessageCallback) {
                    this.customMessageCallback(data, senderId);
                }
                break;
        }
    }

    /**
     * Broadcast a message to all other windows
     */
    _broadcast(type, data) {
        if (!this.channel) return;
        
        try {
            this.channel.postMessage({
                type,
                data,
                senderId: this.id,
                timestamp: Date.now()
            });
        } catch (e) {
            console.warn('Failed to broadcast message:', e);
        }
    }

    /**
     * Send a custom message to all other windows
     * @param {Object} data - Custom data to send
     */
    sendMessage(data) {
        if (this.useBroadcastChannel) {
            this._broadcast(WindowManager.MSG_CUSTOM, data);
        }
        // Could also store in localStorage for fallback
    }

    /**
     * Set callback for custom messages from other windows
     * @param {Function} callback - Called with (data, senderId)
     */
    setCustomMessageCallback(callback) {
        this.customMessageCallback = callback;
    }

    /**
     * Handle a window registration message
     */
    _handleWindowRegister(windowInfo) {
        const windowId = windowInfo.id;
        const wasEmpty = Object.keys(this.windows).filter(id => String(id) !== String(this.id)).length === 0;
        
        this.windows[windowId] = windowInfo;
        this.lastHeartbeatTimes[windowId] = Date.now();
        
        // Also update localStorage for persistence
        this._updateLocalStorage();
        
        // Notify callback if this is a new window
        if (wasEmpty || !this.windows[windowId]) {
            this._notifyWindowChange();
        }
    }

    /**
     * Handle a window update message
     */
    _handleWindowUpdate(windowInfo) {
        const windowId = windowInfo.id;
        const oldWindow = this.windows[windowId];
        
        this.windows[windowId] = windowInfo;
        this.lastHeartbeatTimes[windowId] = Date.now();
        
        // Check if position changed significantly
        if (oldWindow) {
            const dx = Math.abs((oldWindow.center?.x || 0) - (windowInfo.center?.x || 0));
            const dy = Math.abs((oldWindow.center?.y || 0) - (windowInfo.center?.y || 0));
            
            if (dx > 2 || dy > 2) {
                this._notifyWindowChange();
            }
        } else {
            this._notifyWindowChange();
        }
        
        // Update localStorage periodically (not every message)
        this._updateLocalStorage();
    }

    /**
     * Handle a window unregister message
     */
    _handleWindowUnregister(data) {
        const windowId = data.id;
        if (this.windows[windowId]) {
            delete this.windows[windowId];
            delete this.lastHeartbeatTimes[windowId];
            this._updateLocalStorage();
            this._notifyWindowChange();
        }
    }

    /**
     * Start heartbeat interval for liveness detection
     */
    _startHeartbeat() {
        // Send heartbeat every 500ms
        this.heartbeatInterval = setInterval(() => {
            if (this.useBroadcastChannel) {
                this._broadcast(WindowManager.MSG_HEARTBEAT, { id: this.id });
            }
            
            // Check for stale windows (no heartbeat in STALE_TIMEOUT)
            this._checkStaleWindows();
        }, 500);
    }

    /**
     * Check for and remove stale windows
     */
    _checkStaleWindows() {
        const now = Date.now();
        let changed = false;
        
        for (const windowId in this.windows) {
            if (String(windowId) === String(this.id)) continue;
            
            const lastHeartbeat = this.lastHeartbeatTimes[windowId] || 0;
            if (now - lastHeartbeat > WindowManager.STALE_TIMEOUT) {
                console.log(`Removing stale window (no heartbeat): ${windowId}`);
                delete this.windows[windowId];
                delete this.lastHeartbeatTimes[windowId];
                changed = true;
            }
        }
        
        if (changed) {
            this._updateLocalStorage();
            this._notifyWindowChange();
        }
    }

    /**
     * Notify the window change callback
     */
    _notifyWindowChange() {
        if (this.winChangeCallback) {
            const otherWindows = this.getOtherWindows();
            this.winChangeCallback(otherWindows);
        }
    }

    /**
     * Update localStorage with current window state
     */
    _updateLocalStorage() {
        this._saveWindows(this.windows);
    }

    /**
     * Get this window's info object
     */
    _getWindowInfo() {
        return {
            id: this.id,
            shape: this.lastShape,
            center: this._getWindowCenter(this.lastShape),
            metaData: this.metaData,
            updated: Date.now(),
            createdAt: this.createdAt,
            isParent: this.isParent
        };
    }

    /**
     * Update window state - call this every frame
     */
    update() {
        if (!this.initialized) return;

        const currentShape = this._getWindowShape();

        // Check if window shape changed
        const shapeChanged = (
            currentShape.x !== this.lastShape.x ||
            currentShape.y !== this.lastShape.y ||
            currentShape.w !== this.lastShape.w ||
            currentShape.h !== this.lastShape.h
        );

        if (shapeChanged) {
            this.lastShape = currentShape;
            
            // Update our local cache
            this.windows[this.id] = this._getWindowInfo();
            
            // Broadcast instant update via BroadcastChannel
            if (this.useBroadcastChannel) {
                this._broadcast(WindowManager.MSG_UPDATE, this._getWindowInfo());
            }
            
            // Also update localStorage (for persistence/fallback)
            this._updateWindowInStorage();

            if (this.winShapeChangeCallback) {
                this.winShapeChangeCallback(currentShape);
            }
        } else {
            // Still update timestamp even if shape hasn't changed
            this._updateWindowInStorage();
        }

        // Clean up stale windows and check for changes (localStorage fallback)
        if (!this.useBroadcastChannel) {
            this._cleanupAndNotify();
        }
    }

    /**
     * Get all active windows including this one
     * @returns {Object} Map of window ID to window info
     */
    getWindows() {
        return { ...this.windows };
    }

    /**
     * Get all other active windows (excluding this one)
     * @returns {Array} Array of window info objects
     */
    getOtherWindows() {
        return Object.values(this.windows).filter(w => String(w.id) !== String(this.id));
    }

    /**
     * Get this window's info
     * @returns {Object} This window's info
     */
    getThisWindow() {
        return this.windows[this.id] || null;
    }

    /**
     * Set callback for when other windows change
     * @param {Function} callback - Called with array of other windows
     */
    setWinChangeCallback(callback) {
        this.winChangeCallback = callback;
    }

    /**
     * Set callback for when this window's shape changes
     * @param {Function} callback - Called with new shape object
     */
    setWinShapeChangeCallback(callback) {
        this.winShapeChangeCallback = callback;
    }

    // --- Private Methods ---

    _getNextId() {
        let counter = parseInt(localStorage.getItem(WindowManager.COUNTER_KEY) || '0', 10);
        counter++;
        localStorage.setItem(WindowManager.COUNTER_KEY, counter.toString());
        return counter;
    }

    _getWindowShape() {
        return {
            x: window.screenX || window.screenLeft || 0,
            y: window.screenY || window.screenTop || 0,
            w: window.innerWidth,
            h: window.innerHeight
        };
    }

    _getWindowCenter(shape) {
        return {
            x: shape.x + shape.w / 2,
            y: shape.y + shape.h / 2
        };
    }

    _registerWindow() {
        const windows = this._loadWindows();
        const windowInfo = this._getWindowInfo();

        windows[this.id] = windowInfo;
        this.windows = windows;
        this._saveWindows(windows);
        
        // Broadcast registration via BroadcastChannel
        if (this.useBroadcastChannel) {
            this._broadcast(WindowManager.MSG_REGISTER, windowInfo);
        }
    }

    /**
     * Check if this window is the parent (first) window
     * @returns {boolean}
     */
    isParentWindow() {
        return this.isParent;
    }

    /**
     * Get the parent window info (the first/oldest window)
     * @returns {Object|null} Parent window info or null if this is the parent
     */
    getParentWindow() {
        if (this.isParent) {
            return this.getThisWindow();
        }

        // Find the oldest window (parent)
        let parentWindow = null;
        let oldestTime = Infinity;

        for (const id in this.windows) {
            const win = this.windows[id];
            if (win.createdAt && win.createdAt < oldestTime) {
                oldestTime = win.createdAt;
                parentWindow = win;
            }
        }

        return parentWindow;
    }

    /**
     * Get child windows (all windows except the parent)
     * @returns {Array} Array of child window info objects
     */
    getChildWindows() {
        const parentWindow = this.getParentWindow();
        if (!parentWindow) return [];

        return Object.values(this.windows).filter(w => w.id !== parentWindow.id);
    }

    _updateWindowInStorage() {
        const windows = this._loadWindows();

        if (windows[this.id]) {
            windows[this.id].shape = this.lastShape;
            windows[this.id].center = this._getWindowCenter(this.lastShape);
            windows[this.id].updated = Date.now();
            this.windows = windows;
            this._saveWindows(windows);
        } else {
            // Window was removed, re-register
            this._registerWindow();
        }
    }

    _removeWindow() {
        const windows = this._loadWindows();
        delete windows[this.id];
        this._saveWindows(windows);
    }

    _loadWindows() {
        try {
            const data = localStorage.getItem(WindowManager.STORAGE_KEY);
            return data ? JSON.parse(data) : {};
        } catch (e) {
            console.warn('Failed to load windows from localStorage:', e);
            return {};
        }
    }

    _saveWindows(windows) {
        try {
            localStorage.setItem(WindowManager.STORAGE_KEY, JSON.stringify(windows));
        } catch (e) {
            console.warn('Failed to save windows to localStorage:', e);
        }
    }

    _cleanupAndNotify() {
        const windows = this._loadWindows();
        const now = Date.now();
        let changed = false;

        // Remove stale windows
        for (const id in windows) {
            if (now - windows[id].updated > WindowManager.STALE_TIMEOUT) {
                console.log(`Removing stale window: ${id}`);
                delete windows[id];
                changed = true;
            }
        }

        // Check if windows changed compared to our cached version
        const myId = String(this.id);
        const oldOtherCount = Object.keys(this.windows).filter(id => id !== myId).length;
        const newOtherCount = Object.keys(windows).filter(id => id !== myId).length;

        if (oldOtherCount !== newOtherCount) {
            changed = true;
        }

        // Also check if any window positions have changed significantly
        for (const id in windows) {
            if (id !== myId && this.windows[id]) {
                const oldCenter = this.windows[id].center;
                const newCenter = windows[id].center;
                if (oldCenter && newCenter) {
                    const dx = Math.abs(oldCenter.x - newCenter.x);
                    const dy = Math.abs(oldCenter.y - newCenter.y);
                    if (dx > 5 || dy > 5) {
                        changed = true;
                    }
                }
            }
        }

        this.windows = windows;

        if (changed) {
            this._saveWindows(windows);

            if (this.winChangeCallback) {
                const otherWindows = this.getOtherWindows();
                console.log(`Other windows changed: ${otherWindows.length}`);
                this.winChangeCallback(otherWindows);
            }
        }
    }

    _onStorageChange(event) {
        if (event.key === WindowManager.STORAGE_KEY) {
            // Another window updated the storage, refresh our view
            this._cleanupAndNotify();
        }
    }

    _onBeforeUnload() {
        // Broadcast unregister message for instant notification
        if (this.useBroadcastChannel) {
            this._broadcast(WindowManager.MSG_UNREGISTER, { id: this.id });
        }
        
        // Stop heartbeat
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
        }
        
        // Close BroadcastChannel
        if (this.channel) {
            this.channel.close();
        }
        
        // Remove from localStorage
        this._removeWindow();
    }
    
    /**
     * Clean up and destroy the WindowManager
     */
    destroy() {
        this._onBeforeUnload();
        window.removeEventListener('storage', this._onStorageChange.bind(this));
        window.removeEventListener('beforeunload', this._onBeforeUnload.bind(this));
        this.initialized = false;
    }
}