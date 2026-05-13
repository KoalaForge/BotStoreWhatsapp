/**
 * Async lazy loader for baileys v7 (ESM-only) from this CJS project.
 * Cached after first call.
 *
 * Usage:
 *   const { loadBaileys } = require('./baileysLoader');
 *   const { default: makeWASocket, proto, initAuthCreds, DisconnectReason } = await loadBaileys();
 */

let _cached = null;
let _pending = null;

async function loadBaileys() {
    if (_cached) return _cached;
    if (_pending) return _pending;
    _pending = (async () => {
        const mod = await import('baileys');
        // ESM module — surface both default and named exports.
        // baileys default export = makeWASocket; named exports = proto, initAuthCreds, etc.
        _cached = mod;
        return mod;
    })();
    return _pending;
}

module.exports = { loadBaileys };
