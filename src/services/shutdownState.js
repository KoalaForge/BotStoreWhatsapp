'use strict';

/**
 * Shared shutdown/readiness state module.
 * Used by the graceful shutdown handler and health endpoints
 * to coordinate draining and readiness behavior.
 */

let _isDraining = false;
let _isReady = false;

module.exports = {
    /**
     * Mark the application as ready (bot launched, processing started).
     */
    setReady() {
        _isReady = true;
    },

    /**
     * @returns {boolean}
     */
    isReady() {
        return _isReady;
    },

    /**
     * Set the draining flag to true.
     * Called when graceful shutdown begins — signals health endpoints to return 503.
     */
    setDraining() {
        _isDraining = true;
    },

    /**
     * Check whether the process is currently draining (shutting down).
     * @returns {boolean}
     */
    isShuttingDown() {
        return _isDraining;
    }
};
