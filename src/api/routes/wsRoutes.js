const clc = require('cli-color');

/**
 * WebSocket routes for QR code streaming during bot pairing.
 *
 * GET /ws/qr/:botId - Upgrades to WebSocket.
 * Streams QR data from WaConnection 'qr' events to all connected clients.
 * Sends 'connected' when pairing completes, then closes.
 * Sends 'error' on pairing failure, then closes.
 *
 * Message format (server -> client):
 *   { type: 'qr', data: '<qr-string>' }
 *   { type: 'connected', data: { bot_id, phone_number } }
 *   { type: 'error', data: { message } }
 *   { type: 'timeout', data: { message } }
 *
 * @param {FastifyInstance} fastify
 * @param {Object} options
 * @param {Object} options.waBotManager - WaBotManager instance
 */
async function wsRoutes(fastify, options) {
    const waBotManager = options.waBotManager;

    // Track connected WebSocket clients per botId
    const clientsByBot = new Map(); // Map<botId, Set<WebSocket>>

    fastify.get('/qr/:botId', { websocket: true }, (socket, request) => {
        const { botId } = request.params;

        const connection = waBotManager.getBotInstance(botId);
        if (!connection) {
            socket.send(JSON.stringify({
                type: 'error',
                data: { message: 'Bot not found or not running' }
            }));
            socket.close(4004, 'Bot not found');
            return;
        }

        // If already connected, notify and close
        if (connection.isRunning) {
            socket.send(JSON.stringify({
                type: 'connected',
                data: { bot_id: botId, phone_number: connection.phoneNumber }
            }));
            socket.close(1000, 'Already connected');
            return;
        }

        // Register this client
        if (!clientsByBot.has(botId)) {
            clientsByBot.set(botId, new Set());
        }
        clientsByBot.get(botId).add(socket);

        // QR event listener
        const onQr = (qr) => {
            if (socket.readyState === 1) { // WebSocket.OPEN
                socket.send(JSON.stringify({ type: 'qr', data: qr }));
            }
        };

        // Connection success
        const onConnected = () => {
            if (socket.readyState === 1) {
                socket.send(JSON.stringify({
                    type: 'connected',
                    data: { bot_id: botId, phone_number: connection.phoneNumber }
                }));
                socket.close(1000, 'Pairing complete');
            }
        };

        // Logged out / pairing failed
        const onLoggedOut = () => {
            if (socket.readyState === 1) {
                socket.send(JSON.stringify({
                    type: 'error',
                    data: { message: 'Pairing failed or session logged out' }
                }));
                socket.close(4001, 'Pairing failed');
            }
        };

        // Max reconnect failed
        const onMaxReconnectFailed = () => {
            if (socket.readyState === 1) {
                socket.send(JSON.stringify({
                    type: 'error',
                    data: { message: 'Connection failed after maximum reconnect attempts' }
                }));
                socket.close(4002, 'Max reconnect failed');
            }
        };

        // Bind events
        connection.on('qr', onQr);
        connection.on('connected', onConnected);
        connection.on('loggedOut', onLoggedOut);
        connection.on('maxReconnectFailed', onMaxReconnectFailed);

        // Auto-close after 3 minutes (QR codes expire)
        const timeout = setTimeout(() => {
            if (socket.readyState === 1) {
                socket.send(JSON.stringify({
                    type: 'timeout',
                    data: { message: 'QR streaming timed out after 3 minutes' }
                }));
                socket.close(4008, 'Timeout');
            }
        }, 180000);

        // Cleanup on client disconnect
        socket.on('close', () => {
            clearTimeout(timeout);
            connection.removeListener('qr', onQr);
            connection.removeListener('connected', onConnected);
            connection.removeListener('loggedOut', onLoggedOut);
            connection.removeListener('maxReconnectFailed', onMaxReconnectFailed);

            const clients = clientsByBot.get(botId);
            if (clients) {
                clients.delete(socket);
                if (clients.size === 0) {
                    clientsByBot.delete(botId);
                }
            }
        });

        // Handle incoming messages from client (ping/pong or ignore)
        socket.on('message', (data) => {
            const msg = data.toString();
            if (msg === 'ping') {
                if (socket.readyState === 1) {
                    socket.send(JSON.stringify({ type: 'pong' }));
                }
            }
        });

        console.log(
            clc.cyan.bold('[ WS ]') +
            ` QR stream client connected for bot ${botId} (total: ${clientsByBot.get(botId).size})`
        );
    });
}

module.exports = wsRoutes;
