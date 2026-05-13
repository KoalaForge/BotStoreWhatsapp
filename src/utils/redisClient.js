/**
 * Optional Redis client singleton.
 *
 * Returns a connected Redis client when REDIS_URL is set, or null otherwise.
 * All callers must handle null gracefully (fall back to MongoDB / in-memory).
 *
 * Usage:
 *   const { getRedisClient } = require('./redisClient');
 *   const redis = await getRedisClient();
 *   if (redis) { ... } else { // fallback }
 *
 * To enable Redis: set REDIS_URL=redis://redis:6379 in .env
 */

let _client = null;
let _connectPromise = null;

async function getRedisClient() {
    if (!process.env.REDIS_URL) return null;

    if (_client && _client.isReady) return _client;
    if (_connectPromise) return _connectPromise;

    _connectPromise = (async () => {
        let createClient;
        try {
            ({ createClient } = require('redis'));
        } catch (err) {
            console.error('[Redis] redis package not installed — falling back to MongoDB:', err.message);
            _connectPromise = null;
            return null;
        }

        const client = createClient({ url: process.env.REDIS_URL });
        client.on('error', err => console.error('[Redis]', err.message));

        try {
            await client.connect();
            _client = client;
            _connectPromise = null;
            console.log('[Redis] Connected');
            return client;
        } catch (err) {
            console.error('[Redis] Connection failed, falling back to MongoDB:', err.message);
            _connectPromise = null;
            return null;
        }
    })();

    return _connectPromise;
}

module.exports = { getRedisClient };
