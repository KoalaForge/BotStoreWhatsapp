const clc = require('cli-color');

/**
 * SINGLE mode WebSocket QR streaming.
 *
 * GET /ws/qr/:botId - Upgrades to WebSocket. Streams QR events from the
 * single WaConnection instance. Mirrors MULTI mode's /ws/qr/:botId path
 * (the :botId param is ignored — SINGLE has only one connection).
 *
 * Message format (server -> client):
 *   { type: 'qr', data: '<qr-string>' }
 *   { type: 'connected', data: { phone_number } }
 *   { type: 'error', data: { message } }
 *   { type: 'timeout', data: { message } }
 *
 * @param {FastifyInstance} fastify
 * @param {Object} options
 * @param {Object} options.connection - The single WaConnection instance
 */
async function singleWsRoutes(fastify, options) {
    const connection = options.connection;
    const clients = new Set();

    fastify.get('/qr/:botId', { websocket: true }, (socket, request) => {
        if (connection.isRunning) {
            socket.send(JSON.stringify({
                type: 'connected',
                data: { phone_number: connection.phoneNumber }
            }));
            socket.close(1000, 'Already connected');
            return;
        }

        clients.add(socket);

        const onQr = (qr) => {
            if (socket.readyState === 1) {
                socket.send(JSON.stringify({ type: 'qr', data: qr }));
            }
        };

        const onConnected = () => {
            if (socket.readyState === 1) {
                socket.send(JSON.stringify({
                    type: 'connected',
                    data: { phone_number: connection.phoneNumber }
                }));
                socket.close(1000, 'Pairing complete');
            }
        };

        const onLoggedOut = () => {
            if (socket.readyState === 1) {
                socket.send(JSON.stringify({
                    type: 'error',
                    data: { message: 'Pairing failed or session logged out' }
                }));
                socket.close(4001, 'Pairing failed');
            }
        };

        connection.on('qr', onQr);
        connection.on('connected', onConnected);
        connection.on('loggedOut', onLoggedOut);

        const timeout = setTimeout(() => {
            if (socket.readyState === 1) {
                socket.send(JSON.stringify({
                    type: 'timeout',
                    data: { message: 'QR streaming timed out after 3 minutes' }
                }));
                socket.close(4008, 'Timeout');
            }
        }, 180000);

        socket.on('close', () => {
            clearTimeout(timeout);
            connection.removeListener('qr', onQr);
            connection.removeListener('connected', onConnected);
            connection.removeListener('loggedOut', onLoggedOut);
            clients.delete(socket);
        });

        socket.on('message', (data) => {
            const msg = data.toString();
            if (msg === 'ping' && socket.readyState === 1) {
                socket.send(JSON.stringify({ type: 'pong' }));
            }
        });

        console.log(
            clc.cyan.bold('[ WS ]') +
            ` SINGLE QR stream client connected (total: ${clients.size})`
        );
    });
}

module.exports = singleWsRoutes;
