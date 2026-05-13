const fp = require('fastify-plugin');
const crypto = require('crypto');

/**
 * API Key authentication middleware
 * Validates X-API-Key header against environment variable.
 * Uses constant-time comparison to prevent timing attacks.
 */
async function apiAuthPlugin(fastify, options) {
    fastify.addHook('onRequest', async (request, reply) => {
        // Skip auth for health, readiness, WebSocket, and docs endpoints
        if (request.url === '/health' || request.url === '/ready' || request.url.startsWith('/ws/') || request.url.startsWith('/api/docs')) {
            return;
        }

        const apiKey = request.headers['x-api-key'];
        const validApiKey = process.env.API_KEY;

        if (!apiKey || !validApiKey) {
            return reply.code(401).send({
                success: false,
                code: 401,
                message: 'Unauthorized: Invalid or missing API key',
                data: null
            });
        }

        // Constant-time comparison to prevent timing attacks
        const a = Buffer.from(apiKey);
        const b = Buffer.from(validApiKey);

        if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
            return reply.code(401).send({
                success: false,
                code: 401,
                message: 'Unauthorized: Invalid or missing API key',
                data: null
            });
        }
    });
}

module.exports = fp(apiAuthPlugin);
