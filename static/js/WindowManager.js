/**
 * WindowManager - Manages multi-window coordination for Tangled
 *
 * Uses localStorage to share window positions and detect other browser windows.
 * Each window polls its screen position and shares it with other windows.
 */

export class WindowManager {
    static STORAGE_KEY = 'tangled_windows';
    static STALE_TIMEOUT = 2000; // ms - windows not updated within this time are considered closed
    static COUNTER_KEY = 'tangled_window_counter';

    constructor() {
        this.id = null;
        this.metaData = null;
        this.windows = {};
        this.winChangeCallback = null;
        this.winShapeChangeCallback = null;
        this.lastShape = { x: 0, y: 0, w: 0, h: 0 };
        this.initialized = false;
    }

    /**
     * Initialize the window manager
     * @param {Object} metaData - Optional metadata to store with this window
     */
    init(metaData = {}) {
        this.metaData = metaData;

        // Generate unique window ID using a counter in localStorage
        this.id = this._getNextId();

        // Get current window shape
        this.lastShape = this._getWindowShape();

        // Register this window
        this._registerWindow();

        // Listen for storage events from other windows
        window.addEventListener('storage', this._onStorageChange.bind(this));

        // Clean up on window close
        window.addEventListener('beforeunload', this._onBeforeUnload.bind(this));

        this.initialized = true;
        console.log(`WindowManager initialized with ID: ${this.id}`);

        return this.id;
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
            this._updateWindowInStorage();

            if (this.winShapeChangeCallback) {
                this.winShapeChangeCallback(currentShape);
            }
        } else {
            // Still update timestamp even if shape hasn't changed
            this._updateWindowInStorage();
        }

        // Clean up stale windows and check for changes
        this._cleanupAndNotify();
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

        const windowInfo = {
            id: this.id,
            shape: this.lastShape,
            center: this._getWindowCenter(this.lastShape),
            metaData: this.metaData,
            updated: Date.now()
        };

        windows[this.id] = windowInfo;
        this.windows = windows;
        this._saveWindows(windows);
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
        this._removeWindow();
    }
}
